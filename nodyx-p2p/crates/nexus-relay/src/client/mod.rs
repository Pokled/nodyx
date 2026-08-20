mod forwarder;
pub mod target;

use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpStream, lookup_host};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use tokio_tungstenite::MaybeTlsStream;

use crate::keepalive::{self, READ_DEADLINE};
use crate::ws_stream::WsByteStream;
use target::Target;
use crate::protocol::{ClientMessage, ServerMessage, read_msg, write_msg};

/// How long one address gets before we move to the next one.
///
/// `TcpStream::connect("host:port")` resolves to several addresses and tries them
/// inside a SINGLE future, with no per-address bound. On a host whose IPv6 is
/// configured but has no route, the AAAA attempt is blackholed and that one future
/// stalls for the kernel's TCP timeout, roughly two minutes, before IPv4 is ever
/// tried. The reconnect loop then collapses.
///
/// That failure mode only appeared once `relay.nodyx.org` gained an AAAA record,
/// so the timeout ships WITH it, not after.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/// Connect to the first address that answers, giving each one a bounded attempt.
///
/// Resolution order is the resolver's (glibc already applies RFC 6724, so a host
/// without a global IPv6 address is not offered AAAA at all). We simply refuse to
/// let any single address hold the whole reconnect loop hostage.
async fn connect_any(server_addr: &str) -> std::io::Result<TcpStream> {
    let addrs: Vec<_> = lookup_host(server_addr).await?.collect();
    if addrs.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AddrNotAvailable,
            format!("{server_addr} resolved to no address"),
        ));
    }

    let mut last: Option<std::io::Error> = None;
    for addr in &addrs {
        match tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => {
                info!("Connected via {addr}");
                return Ok(stream);
            }
            Ok(Err(e)) => {
                warn!("{addr} refused the connection: {e}");
                last = Some(e);
            }
            Err(_) => {
                warn!("{addr} did not answer within {}s, trying the next address", CONNECT_TIMEOUT.as_secs());
                last = Some(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    format!("{addr} timed out"),
                ));
            }
        }
    }

    Err(last.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "no address reachable")
    }))
}

// ── Entry point with reconnect loop ──────────────────────────────────────────

pub async fn run(
    server_addr: &str,
    slug: &str,
    token: &str,
    local_port: u16,
) -> anyhow::Result<()> {
    // Refused up front rather than on every retry: an address the client cannot
    // read will never become readable, and looping on it would bury the reason
    // under reconnect noise.
    let target = Target::parse(server_addr)?;

    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(30);

    info!("nodyx-relay client starting");
    info!("  Server    : {target} ({} door)", target.door());
    info!("  Slug      : {slug}");
    info!("  Local     : localhost:{local_port}");

    loop {
        info!("Connecting to relay server {target}...");
        let outcome = match &target {
            Target::Tcp(addr) => match connect_any(addr).await {
                Ok(stream) => {
                    // Only meaningful on a raw socket: over WebSocket the far
                    // end is Cloudflare, and the application ping is what keeps
                    // the path alive.
                    if let Err(e) = keepalive::enable(&stream) {
                        warn!("Failed to enable TCP keepalive: {e}");
                    }
                    Some(Session::Tcp(stream))
                }
                Err(e) => {
                    error!("Connection failed: {e}");
                    None
                }
            },
            Target::WebSocket(url) => match connect_websocket(url).await {
                Ok(stream) => Some(Session::Ws(Box::new(stream))),
                Err(e) => {
                    error!("Connection failed: {e}");
                    None
                }
            },
        };

        if let Some(session) = outcome {
            backoff = Duration::from_secs(1); // reset on successful connect
            info!("Connected. Registering slug '{slug}'...");
            let ended = match session {
                Session::Tcp(s) => handle_session(s, slug, token, local_port).await,
                Session::Ws(s) => handle_session(*s, slug, token, local_port).await,
            };
            if let Err(e) = ended {
                warn!("Session ended: {e}");
            }
        }

        info!("Reconnecting in {}s...", backoff.as_secs());
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
    }
}

/// An established connection, whichever door it came through.
///
/// Boxed on the WebSocket side because a TLS stream is far larger than a plain
/// socket, and this value sits on the stack of the reconnect loop.
enum Session {
    Tcp(TcpStream),
    Ws(Box<WsByteStream<MaybeTlsStream<TcpStream>>>),
}

/// Dial the WebSocket door.
///
/// The certificate is validated by rustls with its default policy. That is the
/// whole point of this door: a tunnel that accepted any certificate would hand
/// away the very confidentiality it exists to provide, and would do it silently.
async fn connect_websocket(
    url: &str,
) -> anyhow::Result<WsByteStream<MaybeTlsStream<TcpStream>>> {
    let (ws, response) = tokio_tungstenite::connect_async(url).await?;
    info!("WebSocket established, server answered {}", response.status());
    Ok(WsByteStream::new(ws))
}

// ── Single session ────────────────────────────────────────────────────────────

async fn handle_session<S>(
    stream: S,
    slug: &str,
    token: &str,
    local_port: u16,
) -> anyhow::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    // Split up front: the same conversation then runs over a raw socket or a
    // WebSocket without knowing which, exactly as it does on the server side.
    let (mut reader, mut writer) = tokio::io::split(stream);

    // 1. Send Register.
    write_msg(
        &mut writer,
        &ClientMessage::Register {
            slug: slug.to_owned(),
            token: token.to_owned(),
        },
    )
    .await?;

    // 2. Wait for Registered confirmation.
    match read_msg::<_, ServerMessage>(&mut reader).await? {
        Some(ServerMessage::Registered { ok: true, .. }) => {
            info!("Relay registered — '{slug}.nodyx.org' is live");
        }
        Some(ServerMessage::Registered { ok: false, error }) => {
            return Err(anyhow::anyhow!(
                "Registration rejected: {}",
                error.unwrap_or_else(|| "unknown error".into())
            ));
        }
        other => {
            return Err(anyhow::anyhow!("Unexpected message: {other:?}"));
        }
    }

    // Channel to serialize all writes back to the relay server.
    // Multiple concurrent request handlers send their responses here;
    // the write task drains it in order so writes are never concurrent.
    let (resp_tx, mut resp_rx) = mpsc::channel::<ClientMessage>(256);

    // Write task, drains the response channel and writes to the relay.
    let write_task = tokio::spawn(async move {
        while let Some(msg) = resp_rx.recv().await {
            if write_msg(&mut writer, &msg).await.is_err() {
                break;
            }
        }
    });

    // Read task — reads requests from the relay server and spawns a concurrent
    // handler per request so that long-polling GETs don't block other requests.
    // Wrapped in a deadline so a silently-dead TCP connection (NAT timeout,
    // peer crash before keepalive fires) doesn't keep the client hung forever.
    let read_task = tokio::spawn(async move {
        loop {
            let next = tokio::time::timeout(
                READ_DEADLINE,
                read_msg::<_, ServerMessage>(&mut reader),
            )
            .await;

            match next {
                Err(_elapsed) => {
                    warn!(
                        "No traffic from relay server in {}s — assuming dead session",
                        READ_DEADLINE.as_secs()
                    );
                    break;
                }
                Ok(Ok(Some(ServerMessage::Request { id, method, path, headers, body_b64 }))) => {
                    let tx = resp_tx.clone();
                    tokio::spawn(async move {
                        let msg = forwarder::handle_request(
                            id, method, path, headers, body_b64, local_port,
                        )
                        .await;
                        let _ = tx.send(msg).await;
                    });
                }
                Ok(Ok(Some(ServerMessage::Ping))) => {
                    let _ = resp_tx.send(ClientMessage::Heartbeat).await;
                }
                Ok(Ok(Some(ServerMessage::Registered { .. }))) => {
                    warn!("Unexpected Registered message — ignoring");
                }
                Ok(Ok(None)) => {
                    info!("Server closed the connection");
                    break;
                }
                Ok(Err(e)) => {
                    warn!("Read error: {e}");
                    break;
                }
            }
        }
    });

    // Wait until either task ends (connection dropped or error).
    tokio::select! {
        _ = write_task => {}
        _ = read_task  => {}
    }

    Ok(())
}

#[cfg(test)]
mod connect_tests {
    use super::{CONNECT_TIMEOUT, connect_any};
    use tokio::net::TcpListener;

    /// The reason `connect_any` exists. `localhost` resolves to `::1` first and
    /// `127.0.0.1` second on this platform. With a listener bound ONLY on IPv4,
    /// reaching it proves the first address was tried, rejected, and the second
    /// one used, instead of the whole attempt dying on the first family.
    ///
    /// This is the shape of the failure an AAAA record on `relay.nodyx.org`
    /// introduces for the 24 deployed instances.
    #[tokio::test]
    async fn falls_through_to_the_address_that_answers() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = l.accept().await;
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        });

        let s = connect_any(&format!("localhost:{port}"))
            .await
            .expect("no address answered, the fallback did not happen");
        assert_eq!(s.peer_addr().unwrap().port(), port);
    }

    #[tokio::test]
    async fn reports_a_name_that_resolves_to_nothing_usable() {
        // A port nobody listens on: every address refuses, and the error surfaces
        // instead of the loop hanging.
        let err = connect_any("localhost:1").await.unwrap_err();
        assert!(
            !format!("{err}").is_empty(),
            "the failure must carry a reason for the operator"
        );
    }

    #[tokio::test]
    async fn the_per_address_bound_is_short_enough_to_retry() {
        // A two minute kernel timeout is what made the reconnect loop collapse.
        // Anything above ~15s defeats the purpose of the loop's own backoff.
        assert!(
            CONNECT_TIMEOUT.as_secs() <= 15 && CONNECT_TIMEOUT.as_secs() >= 3,
            "unreasonable per-address timeout: {:?}",
            CONNECT_TIMEOUT
        );
    }
}
