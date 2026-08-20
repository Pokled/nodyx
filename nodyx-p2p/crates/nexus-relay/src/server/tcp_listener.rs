//! The legacy door: raw TCP on port 7443.
//!
//! Kept working untouched. Every instance installed before the WebSocket
//! transport existed dials this port, and several have been dormant for months:
//! closing it before the deprecation telemetry shows it deserted would cut
//! people off silently.
//!
//! This module owns the accept loop and nothing else. The conversation itself
//! lives in [`super::session`], shared with the WebSocket door so neither can
//! drift from the other.

use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::{error, info, warn};

use super::db::DbPool;
use super::registry::Registry;
use super::session::{BanMap, Transport, is_auth_banned, run as run_session};
use crate::client_ip::client_ip;
use crate::keepalive;

pub async fn run(
    bind: &str,
    registry: Registry,
    pg: Arc<DbPool>,
    ban_map: BanMap,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind).await?;
    // The address actually obtained, not the one requested: a `[::]` socket that
    // silently ended up IPv6-only (bindv6only=1) is invisible otherwise, and every
    // IPv4 instance would fail to connect without a single error on this side.
    match listener.local_addr() {
        Ok(addr) => info!("TCP relay listener on {addr} (requested {bind})"),
        Err(e) => info!("TCP relay listener on {bind} (local_addr unavailable: {e})"),
    }


    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                // The address a ban is keyed on. On this listener the peer *is*
                // the client: it is reached directly, with no proxy in front, so
                // there are no forwarding headers to consult and the lookup is
                // empty by construction.
                //
                // Going through `client_ip` anyway is deliberate. The WebSocket
                // door arrives through Caddy, where the peer is always localhost
                // and the real caller lives in a header. Both doors asking the
                // same question means neither can be forgotten.
                let culprit = client_ip(addr.ip(), |_| None);

                // Refuse banned callers before any I/O or database work.
                if is_auth_banned(&ban_map, culprit) {
                    warn!("Relay: auth-banned {culprit} - dropping connection");
                    drop(stream);
                    continue;
                }

                // Aggressive TCP keepalive so a dead peer is noticed in ~60 s
                // instead of the kernel default of ~2 hours. This is the one
                // thing that cannot move into the shared session: it acts on the
                // socket, which only this door holds.
                if let Err(e) = keepalive::enable(&stream) {
                    warn!("Failed to enable TCP keepalive on {addr}: {e}");
                }

                info!("Relay client connected from {addr}");
                let registry = registry.clone();
                let pg = pg.clone();
                let ban_map = ban_map.clone();
                tokio::spawn(async move {
                    let outcome =
                        run_session(stream, culprit, Transport::Tcp7443, registry, pg, ban_map)
                            .await;
                    if let Err(e) = outcome {
                        warn!("Relay client {addr} disconnected: {e}");
                    }
                });
            }
            Err(e) => error!("Accept error: {e}"),
        }
    }
}
