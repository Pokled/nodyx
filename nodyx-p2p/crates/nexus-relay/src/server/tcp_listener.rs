use dashmap::DashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use super::db::DbPool;
use tracing::{error, info, warn};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

use crate::keepalive::{self, READ_DEADLINE};
use crate::protocol::{ClientMessage, ServerMessage, read_msg, write_msg};
use super::registry::{PendingRequest, Registry, RelayResponse, TunnelHandle};

// ── Auth failure rate limiter ─────────────────────────────────────────────────
// Protects against token brute-force attempts on the TCP relay port (7443).

/// Max failed auth attempts from a single IP within AUTH_WINDOW_SECS before banning.
const MAX_AUTH_FAILURES:  u32 = 5;
/// Time window for counting failures (seconds).
const AUTH_WINDOW_SECS:   u64 = 60;
/// How long a banned IP is refused connections (seconds).
const BAN_DURATION_SECS:  u64 = 300;  // 5 minutes

/// Maps source IP → (failed_attempts, first_failure_unix_secs).
type BanMap = Arc<DashMap<IpAddr, (u32, u64)>>;

fn auth_now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn is_auth_banned(ban_map: &DashMap<IpAddr, (u32, u64)>, ip: IpAddr) -> bool {
    if let Some(entry) = ban_map.get(&ip) {
        let (attempts, since) = *entry;
        attempts >= MAX_AUTH_FAILURES && auth_now_secs().saturating_sub(since) < BAN_DURATION_SECS
    } else {
        false
    }
}

fn record_auth_failure(ban_map: &DashMap<IpAddr, (u32, u64)>, ip: IpAddr) {
    let now = auth_now_secs();
    ban_map.entry(ip)
        .and_modify(|(count, since)| {
            if now.saturating_sub(*since) > AUTH_WINDOW_SECS {
                // Reset: first failure in a new window
                *count = 1;
                *since = now;
            } else {
                *count += 1;
            }
        })
        .or_insert((1, now));
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub async fn run(
    bind: &str,
    registry: Registry,
    pg: Arc<DbPool>,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind).await?;
    info!("TCP relay listener on {bind}");

    let ban_map: BanMap = Arc::new(DashMap::new());

    // Periodic cleanup: remove ban entries that have fully expired.
    {
        let ban_map_c = ban_map.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(BAN_DURATION_SECS)).await;
                let now = auth_now_secs();
                ban_map_c.retain(|_, (_, since)| now.saturating_sub(*since) < BAN_DURATION_SECS);
            }
        });
    }

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                // Reject connections from banned IPs before doing any I/O or DB work.
                if is_auth_banned(&ban_map, addr.ip()) {
                    warn!("Relay: auth-banned IP {} — dropping connection", addr.ip());
                    drop(stream);
                    continue;
                }

                info!("Relay client connected from {addr}");
                let registry = registry.clone();
                let pg       = pg.clone();
                let ban_map  = ban_map.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(stream, addr, registry, pg, ban_map).await {
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
    addr: SocketAddr,
    registry: Registry,
    pg: Arc<DbPool>,
    ban_map: BanMap,
) -> anyhow::Result<()> {
    // Aggressive TCP keepalive so we detect dead peers in ~60s instead
    // of the kernel default of ~2 hours.
    if let Err(e) = keepalive::enable(&stream) {
        warn!("Failed to enable TCP keepalive on {addr}: {e}");
    }

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
        record_auth_failure(&ban_map, addr.ip());
        warn!("Relay: auth failure from {} (slug='{}') — {} attempt(s)",
              addr.ip(), slug,
              ban_map.get(&addr.ip()).map(|e| e.0).unwrap_or(1));
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
    // Wrapped in a deadline: clients reply Heartbeat to our 30s ping, so a
    // 90s silence means the connection is dead and we should reap it.
    let pending_b = pending.clone();
    let slug_b = slug.clone();
    let registry_b = registry.clone();
    let read_task = tokio::spawn(async move {
        loop {
            let next = tokio::time::timeout(
                READ_DEADLINE,
                read_msg::<_, ClientMessage>(&mut reader),
            )
            .await;

            match next {
                Err(_elapsed) => {
                    warn!(
                        "No traffic from '{slug_b}' in {}s — closing dead session",
                        READ_DEADLINE.as_secs()
                    );
                    break;
                }
                Ok(Ok(Some(ClientMessage::Response { id, status, headers, body_b64 }))) => {
                    let body = B64.decode(&body_b64).unwrap_or_else(|e| {
                        warn!("Relay: base64 decode error on response id={id}: {e}");
                        vec![]
                    });
                    if let Some((_, tx)) = pending_b.remove(&id) {
                        let _ = tx.send(RelayResponse { status, headers, body });
                    }
                }
                Ok(Ok(Some(ClientMessage::Heartbeat))) => {
                    // No-op — keep-alive acknowledged.
                }
                Ok(Ok(Some(ClientMessage::Register { .. }))) => {
                    warn!("Unexpected Register from '{slug_b}' — ignoring");
                }
                Ok(Ok(None)) | Ok(Err(_)) => break,
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
