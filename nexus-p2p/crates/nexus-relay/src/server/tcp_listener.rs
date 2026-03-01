use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_postgres::Client as PgClient;
use tracing::{error, info, warn};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

use crate::protocol::{ClientMessage, ServerMessage, read_msg, write_msg};
use super::registry::{PendingRequest, Registry, RelayResponse, TunnelHandle};

// ── Entry point ───────────────────────────────────────────────────────────────

pub async fn run(
    bind: &str,
    registry: Registry,
    pg: Arc<PgClient>,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind).await?;
    info!("TCP relay listener on {bind}");

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                info!("Relay client connected from {addr}");
                let registry = registry.clone();
                let pg = pg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(stream, registry, pg).await {
                        warn!("Relay client {addr} disconnected: {e}");
                    }
                });
            }
            Err(e) => error!("Accept error: {e}"),
        }
    }
}

// ── Per-client handler ────────────────────────────────────────────────────────

async fn handle_client(
    mut stream: TcpStream,
    registry: Registry,
    pg: Arc<PgClient>,
) -> anyhow::Result<()> {
    // 1. Expect Register as the very first message.
    let Some(ClientMessage::Register { slug, token }) =
        read_msg::<_, ClientMessage>(&mut stream).await?
    else {
        write_msg(
            &mut stream,
            &ServerMessage::Registered {
                ok: false,
                error: Some("Expected register message".into()),
            },
        )
        .await?;
        return Ok(());
    };

    // 2. Validate token against directory_instances.
    let row = pg
        .query_opt(
            "SELECT id FROM directory_instances WHERE slug = $1 AND token = $2 AND status = 'active'",
            &[&slug, &token],
        )
        .await?;

    if row.is_none() {
        write_msg(
            &mut stream,
            &ServerMessage::Registered {
                ok: false,
                error: Some("Invalid slug or token".into()),
            },
        )
        .await?;
        return Ok(());
    }

    // 3. Register in the in-memory registry.
    let (tx, mut rx) = mpsc::channel::<PendingRequest>(64);
    registry.insert(slug.clone(), TunnelHandle { tx });
    info!("Slug '{slug}' registered in relay");

    write_msg(&mut stream, &ServerMessage::Registered { ok: true, error: None }).await?;

    // 4. Split the stream for concurrent read + write.
    let (mut reader, mut writer) = stream.into_split();

    // Pending requests awaiting a client Response.
    let pending: Arc<dashmap::DashMap<String, tokio::sync::oneshot::Sender<RelayResponse>>> =
        Arc::new(dashmap::DashMap::new());

    // Task A — receive outgoing requests from the HTTP proxy and forward to client.
    let pending_a = pending.clone();
    let slug_a = slug.clone();
    let write_task = tokio::spawn(async move {
        while let Some(PendingRequest { msg, reply_tx }) = rx.recv().await {
            let id = match &msg {
                ServerMessage::Request { id, .. } => id.clone(),
                ServerMessage::Ping => {
                    // Just forward the ping, no pending entry needed.
                    if write_msg(&mut writer, &msg).await.is_err() {
                        break;
                    }
                    continue;
                }
                _ => continue,
            };
            pending_a.insert(id, reply_tx);
            if write_msg(&mut writer, &msg).await.is_err() {
                break;
            }
        }
        info!("Write task for '{slug_a}' ended");
    });

    // Task B — receive responses from the client and route to pending requests.
    let pending_b = pending.clone();
    let slug_b = slug.clone();
    let registry_b = registry.clone();
    let read_task = tokio::spawn(async move {
        loop {
            match read_msg::<_, ClientMessage>(&mut reader).await {
                Ok(Some(ClientMessage::Response { id, status, headers, body_b64 })) => {
                    let body = B64.decode(&body_b64).unwrap_or_default();
                    if let Some((_, tx)) = pending_b.remove(&id) {
                        let _ = tx.send(RelayResponse { status, headers, body });
                    }
                }
                Ok(Some(ClientMessage::Heartbeat)) => {
                    // No-op — keep-alive acknowledged.
                }
                Ok(Some(ClientMessage::Register { .. })) => {
                    warn!("Unexpected Register from '{slug_b}' — ignoring");
                }
                Ok(None) | Err(_) => break,
            }
        }
        registry_b.remove(&slug_b);
        info!("Slug '{slug_b}' unregistered from relay");
    });

    // 5. Keep-alive: ping every 30 s.
    let slug_c = slug.clone();
    let registry_c = registry.clone();
    let ping_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            if let Some(handle) = registry_c.get(&slug_c) {
                let (dummy_tx, _) = tokio::sync::oneshot::channel();
                let _ = handle.tx.send(PendingRequest {
                    msg: ServerMessage::Ping,
                    reply_tx: dummy_tx,
                }).await;
            } else {
                break;
            }
        }
    });

    // Wait until either task finishes (client disconnected).
    tokio::select! {
        _ = write_task => {}
        _ = read_task  => {}
        _ = ping_task  => {}
    }

    registry.remove(&slug);
    Ok(())
}
