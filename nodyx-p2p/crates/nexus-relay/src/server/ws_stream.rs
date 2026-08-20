//! Reading a WebSocket as a byte stream.
//!
//! # Why an adapter rather than a second protocol
//!
//! The relay speaks one wire format: a big-endian length followed by JSON, over
//! anything that reads and writes bytes. WebSocket is message-oriented instead,
//! so the two do not meet on their own.
//!
//! There were two ways out. Write a second pair of encode/decode functions that
//! send one JSON per WebSocket message, or teach the WebSocket to behave like a
//! byte stream. The first duplicates the protocol, and a duplicated protocol
//! drifts: a fix on one side silently misses the other. This adapter takes the
//! second road, so [`crate::protocol`] stays the single description of the wire
//! and both doors inherit every change made to it.
//!
//! The length prefix then rides inside WebSocket framing, which is redundant but
//! costs four bytes per message and keeps one implementation instead of two.
//!
//! # Behaviour worth knowing
//!
//! * Writes are buffered and emitted on flush, as one binary message per flush.
//!   [`crate::protocol::write_msg`] flushes at the end of every message, so one
//!   protocol message maps to one WebSocket message.
//! * Control frames are not the caller's business: pings are answered by
//!   tungstenite itself, and pongs are skipped here.
//! * A close frame reads as clean end-of-file, which is what the session loop
//!   already treats as "the client went away".

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use futures_util::{Sink, Stream};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

/// A [`WebSocketStream`] dressed up as a byte stream.
pub struct WsByteStream<S> {
    inner: WebSocketStream<S>,
    /// Bytes received but not yet handed to the reader.
    pending_read: Vec<u8>,
    /// Offset into `pending_read`, so a partial read does not shift the buffer.
    read_at: usize,
    /// Bytes written but not yet flushed as a message.
    pending_write: Vec<u8>,
}

impl<S> WsByteStream<S> {
    /// Wrap an established WebSocket.
    pub fn new(inner: WebSocketStream<S>) -> Self {
        Self {
            inner,
            pending_read: Vec::new(),
            read_at: 0,
            pending_write: Vec::new(),
        }
    }
}

/// Map a tungstenite error onto the `io::Error` the async traits expect.
fn to_io(e: WsError) -> io::Error {
    match e {
        // A peer that vanishes mid-message is a disconnection, not corruption:
        // the session loop already knows how to end on end-of-file.
        WsError::ConnectionClosed | WsError::AlreadyClosed => {
            io::Error::new(io::ErrorKind::UnexpectedEof, e)
        }
        WsError::Io(io_err) => io_err,
        other => io::Error::new(io::ErrorKind::InvalidData, other),
    }
}

impl<S> AsyncRead for WsByteStream<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        loop {
            // Serve whatever the last message left over before asking for more.
            if self.read_at < self.pending_read.len() {
                let me = &mut *self;
                let available = &me.pending_read[me.read_at..];
                let taken = available.len().min(buf.remaining());
                buf.put_slice(&available[..taken]);
                me.read_at += taken;
                if me.read_at == me.pending_read.len() {
                    me.pending_read.clear();
                    me.read_at = 0;
                }
                return Poll::Ready(Ok(()));
            }

            match Pin::new(&mut self.inner).poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                // Clean end of stream: no more messages will arrive.
                Poll::Ready(None) => return Poll::Ready(Ok(())),
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(to_io(e))),
                Poll::Ready(Some(Ok(msg))) => match msg {
                    Message::Binary(bytes) => {
                        self.pending_read = bytes.to_vec();
                        self.read_at = 0;
                        // Loop round to serve it, so an empty message does not
                        // read as end-of-file.
                    }
                    // Accepted for tolerance: nothing we send is text, but a
                    // client that sends some should not break the stream.
                    Message::Text(text) => {
                        self.pending_read = text.as_bytes().to_vec();
                        self.read_at = 0;
                    }
                    // Close reads as end-of-file, which the session already
                    // treats as "the client went away".
                    Message::Close(_) => return Poll::Ready(Ok(())),
                    // Control frames: pings are answered by tungstenite itself.
                    Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
                },
            }
        }
    }
}

impl<S> AsyncWrite for WsByteStream<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_write(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        // Accumulate. The message is emitted on flush, so a length prefix and
        // its payload travel together rather than as two WebSocket messages.
        self.pending_write.extend_from_slice(buf);
        Poll::Ready(Ok(buf.len()))
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if !self.pending_write.is_empty() {
            // A sink must be asked before it is fed.
            match Pin::new(&mut self.inner).poll_ready(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(to_io(e))),
                Poll::Ready(Ok(())) => {}
            }
            let payload = std::mem::take(&mut self.pending_write);
            if let Err(e) = Pin::new(&mut self.inner).start_send(Message::binary(payload)) {
                return Poll::Ready(Err(to_io(e)));
            }
        }
        Pin::new(&mut self.inner).poll_flush(cx).map_err(to_io)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        // Flush first: a message still buffered at shutdown would be lost.
        match self.as_mut().poll_flush(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
            Poll::Ready(Ok(())) => {}
        }
        Pin::new(&mut self.inner).poll_close(cx).map_err(to_io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ClientMessage, ServerMessage, read_msg, write_msg};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::tungstenite::protocol::Role;

    /// A pair of adapters joined by an in-memory duplex, standing in for a
    /// client and a server that have already shaken hands.
    async fn joined_pair() -> (WsByteStream<tokio::io::DuplexStream>, WsByteStream<tokio::io::DuplexStream>) {
        let (a, b) = tokio::io::duplex(64 * 1024);
        let server = WebSocketStream::from_raw_socket(a, Role::Server, None).await;
        let client = WebSocketStream::from_raw_socket(b, Role::Client, None).await;
        (WsByteStream::new(server), WsByteStream::new(client))
    }

    #[tokio::test]
    async fn bytes_survive_the_round_trip() {
        let (mut server, mut client) = joined_pair().await;

        client.write_all(b"hello relay").await.unwrap();
        client.flush().await.unwrap();

        let mut buf = [0u8; 11];
        server.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"hello relay");
    }

    #[tokio::test]
    async fn the_existing_protocol_works_unchanged_over_websocket() {
        // The whole point of the adapter: one wire format, two doors. This is
        // the same `write_msg`/`read_msg` the raw-TCP listener uses.
        let (mut server, mut client) = joined_pair().await;

        write_msg(
            &mut client,
            &ClientMessage::Register { slug: "waazaa".into(), token: "secret".into() },
        )
        .await
        .unwrap();

        let got: Option<ClientMessage> = read_msg(&mut server).await.unwrap();
        match got {
            Some(ClientMessage::Register { slug, token }) => {
                assert_eq!(slug, "waazaa");
                assert_eq!(token, "secret");
            }
            other => panic!("expected a Register message, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn several_messages_keep_their_order_and_boundaries() {
        // A length prefix read across two WebSocket messages would corrupt the
        // stream, so the framing has to survive back-to-back sends.
        let (mut server, mut client) = joined_pair().await;

        for _ in 0..3 {
            write_msg(&mut client, &ServerMessage::Ping).await.unwrap();
        }
        write_msg(&mut client, &ServerMessage::Registered { ok: true, error: None })
            .await
            .unwrap();

        for _ in 0..3 {
            let msg: Option<ServerMessage> = read_msg(&mut server).await.unwrap();
            assert!(matches!(msg, Some(ServerMessage::Ping)));
        }
        let last: Option<ServerMessage> = read_msg(&mut server).await.unwrap();
        assert!(matches!(last, Some(ServerMessage::Registered { ok: true, .. })));
    }

    #[tokio::test]
    async fn a_partial_read_leaves_the_rest_available() {
        // The reader is allowed to take less than a message holds; the balance
        // must wait rather than be dropped.
        let (mut server, mut client) = joined_pair().await;

        client.write_all(b"0123456789").await.unwrap();
        client.flush().await.unwrap();

        let mut first = [0u8; 4];
        server.read_exact(&mut first).await.unwrap();
        assert_eq!(&first, b"0123");

        let mut rest = [0u8; 6];
        server.read_exact(&mut rest).await.unwrap();
        assert_eq!(&rest, b"456789");
    }

    #[tokio::test]
    async fn a_payload_larger_than_one_read_is_reassembled() {
        // Bodies are base64-encoded and routinely exceed any single read.
        let (mut server, mut client) = joined_pair().await;
        let big = vec![b'x'; 40 * 1024];

        client.write_all(&big).await.unwrap();
        client.flush().await.unwrap();

        let mut got = vec![0u8; big.len()];
        server.read_exact(&mut got).await.unwrap();
        assert_eq!(got, big);
    }

    #[tokio::test]
    async fn closing_reads_as_end_of_file() {
        // `read_msg` returns None on clean end-of-file, which the session loop
        // treats as a departure rather than an error.
        let (mut server, mut client) = joined_pair().await;
        client.shutdown().await.unwrap();

        let msg: Option<ClientMessage> = read_msg(&mut server).await.unwrap();
        assert!(msg.is_none(), "a closed socket should read as end-of-file");
    }
}
