mod forwarder;

use std::time::Duration;
use tokio::net::TcpStream;
use tracing::{error, info, warn};

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

    info!("nexus-relay client starting");
    info!("  Server    : {server_addr}");
    info!("  Slug      : {slug}");
    info!("  Local     : localhost:{local_port}");

    loop {
        info!("Connecting to relay server {server_addr}...");
        match TcpStream::connect(server_addr).await {
            Ok(stream) => {
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
            info!("Relay registered — '{slug}.nexusnode.app' is live");
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

    // 3. Process incoming requests until the connection drops.
    let (mut reader, mut writer) = stream.into_split();

    loop {
        match read_msg::<_, ServerMessage>(&mut reader).await? {
            Some(ServerMessage::Request { id, method, path, headers, body_b64 }) => {
                let writer_ref = &mut writer;
                forwarder::handle_request(
                    writer_ref,
                    id,
                    method,
                    path,
                    headers,
                    body_b64,
                    local_port,
                )
                .await?;
            }
            Some(ServerMessage::Ping) => {
                write_msg(&mut writer, &ClientMessage::Heartbeat).await?;
            }
            Some(ServerMessage::Registered { .. }) => {
                warn!("Unexpected Registered message — ignoring");
            }
            None => {
                info!("Server closed the connection");
                return Ok(());
            }
        }
    }
}
