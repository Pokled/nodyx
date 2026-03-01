use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// ── Message types ─────────────────────────────────────────────────────────────

/// Messages sent from the relay client to the relay server.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// First message after TCP connection — authenticate and claim a slug.
    Register { slug: String, token: String },
    /// HTTP response for a forwarded request.
    Response {
        id: String,
        status: u16,
        headers: HashMap<String, String>,
        /// Base64-encoded response body.
        body_b64: String,
    },
    /// Keep-alive ping reply.
    Heartbeat,
}

/// Messages sent from the relay server to the relay client.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Confirmation (or rejection) of a Register message.
    Registered { ok: bool, error: Option<String> },
    /// An HTTP request that the client must forward to its local server.
    Request {
        /// Correlation ID — must be echoed in the Response.
        id: String,
        method: String,
        path: String,
        headers: HashMap<String, String>,
        /// Base64-encoded request body (empty string if no body).
        body_b64: String,
    },
    /// Server-initiated keep-alive.
    Ping,
}

// ── Framing: [u32 big-endian length][JSON bytes] ──────────────────────────────

/// Write a framed JSON message to any AsyncWrite.
pub async fn write_msg<W, M>(writer: &mut W, msg: &M) -> std::io::Result<()>
where
    W: AsyncWriteExt + Unpin,
    M: Serialize,
{
    let json = serde_json::to_vec(msg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let len = json.len() as u32;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(&json).await?;
    Ok(())
}

/// Read a framed JSON message from any AsyncRead.
/// Returns `None` on clean EOF (connection closed by peer).
pub async fn read_msg<R, M>(reader: &mut R) -> std::io::Result<Option<M>>
where
    R: AsyncReadExt + Unpin,
    M: for<'de> Deserialize<'de>,
{
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 16 * 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("frame too large: {len} bytes"),
        ));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    let msg = serde_json::from_slice(&buf)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(Some(msg))
}
