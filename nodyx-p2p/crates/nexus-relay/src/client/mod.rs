mod forwarder;

use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::keepalive::{self, READ_DEADLINE};
use crate::protocol::{ClientMessage, ServerMessage, read_msg, write_msg};

// ── Entry point with reconnect loop ──────────────────────────────────────────

pub async fn run(
    server_addr: &str,
    slug: &str,
    token: &str,
    local_port: u16,
) -> anyhow::Result<()> {
    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(30);

    info!("nodyx-relay client starting");
    info!("  Server    : {server_addr}");
    info!("  Slug      : {slug}");
    info!("  Local     : localhost:{local_port}");

    loop {
        info!("Connecting to relay server {server_addr}...");
        match TcpStream::connect(server_addr).await {
            Ok(stream) => {
                if let Err(e) = keepalive::enable(&stream) {
                    warn!("Failed to enable TCP keepalive: {e}");
                }
                backoff = Duration::from_secs(1); // reset on successful connect
                info!("Connected. Registering slug '{slug}'...");
                if let Err(e) = handle_session(stream, slug, token, local_port).await {
                    warn!("Session ended: {e}");
                }
            }
            Err(e) => {
                error!("Connection failed: {e}");
            }
        }

        info!("Reconnecting in {}s...", backoff.as_secs());
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
    }
}

// ── Single session ────────────────────────────────────────────────────────────

async fn handle_session(
    mut stream: TcpStream,
    slug: &str,
    token: &str,
    local_port: u16,
) -> anyhow::Result<()> {
    // 1. Send Register.
    write_msg(
        &mut stream,
        &ClientMessage::Register {
            slug: slug.to_owned(),
            token: token.to_owned(),
        },
    )
    .await?;

    // 2. Wait for Registered confirmation.
    match read_msg::<_, ServerMessage>(&mut stream).await? {
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

    // 3. Split stream: concurrent reader + serialized writer.
    let (mut reader, mut writer) = stream.into_split();

    // Channel to serialize all writes back to the relay server.
    // Multiple concurrent request handlers send their responses here;
    // the write task drains it in order so writes are never concurrent.
    let (resp_tx, mut resp_rx) = mpsc::channel::<ClientMessage>(256);

    // Write task — drains the response channel and writes to TCP stream.
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
