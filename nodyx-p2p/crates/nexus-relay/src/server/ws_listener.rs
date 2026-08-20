//! The WebSocket door: HTTPS on port 443, through Cloudflare and Caddy.
//!
//! Exists because the legacy port is unreachable from a great many networks.
//! Company, university and school firewalls routinely allow 80 and 443 outbound
//! and nothing else, so an instance behind one could never bring its tunnel up.
//! An institute in Brazil hit exactly that on the day it registered.
//!
//! # Where this listener sits
//!
//! ```text
//! instance -> Cloudflare -> Caddy (:443, /tunnel) -> this listener (localhost)
//! ```
//!
//! It binds loopback only. Caddy is the front door and terminates TLS, which is
//! why no certificate is handled here: the hostname inherits a public
//! certificate from Cloudflare, so there is nothing to renew and nothing to
//! expire quietly.
//!
//! # The consequence that shapes this module
//!
//! Every caller arrives from Caddy, so the TCP peer is always loopback. Keying
//! a ban on it would ban *everyone* after five failures by *anyone*, and the
//! brute-force defence would protect nothing. The real caller is read from the
//! upgrade request instead, and only because the peer is one of our own
//! proxies: see [`crate::client_ip`].

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tracing::{error, info, warn};

use super::db::DbPool;
use super::registry::Registry;
use super::session::{self, BanMap, Transport, is_auth_banned};
use super::ws_stream::WsByteStream;
use crate::client_ip::client_ip;

/// Accept tunnels over WebSocket until the process ends.
///
/// `ban_map` is shared with the other door on purpose: a ban is about who is
/// calling, not about the road they took, so an address turned away on one side
/// must not be welcome on the other.
pub async fn run(
    bind: &str,
    registry: Registry,
    pg: Arc<DbPool>,
    ban_map: BanMap,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind).await?;
    match listener.local_addr() {
        Ok(addr) => info!("WebSocket relay listener on {addr} (requested {bind})"),
        Err(e) => info!("WebSocket relay listener on {bind} (local_addr unavailable: {e})"),
    }

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                error!("WebSocket accept error: {e}");
                continue;
            }
        };

        let registry = registry.clone();
        let pg = pg.clone();
        let ban_map = ban_map.clone();
        tokio::spawn(async move {
            if let Err(e) = serve(stream, peer, registry, pg, ban_map).await {
                warn!("WebSocket client {peer} ended: {e}");
            }
        });
    }
}

/// Shake hands, work out who is really calling, then hand over to the session.
async fn serve(
    stream: tokio::net::TcpStream,
    peer: SocketAddr,
    registry: Registry,
    pg: Arc<DbPool>,
    ban_map: BanMap,
) -> anyhow::Result<()> {
    // The upgrade carries the forwarding headers, and they are gone once the
    // handshake completes: capture the answer while the request is in hand.
    let mut culprit: IpAddr = peer.ip();
    let ws = accept_hdr_async(stream, |req: &Request, res: Response| {
        culprit = client_ip(peer.ip(), |name| {
            req.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        });
        Ok(res)
    })
    .await?;

    // Refused after the handshake rather than before it, because the address
    // this decision rests on only exists once the request has been read.
    if is_auth_banned(&ban_map, culprit) {
        warn!("Relay: auth-banned {culprit} - dropping WebSocket connection");
        return Ok(());
    }

    info!("Relay client connected over WebSocket from {culprit}");
    session::run(
        WsByteStream::new(ws),
        culprit,
        Transport::Wss,
        registry,
        pg,
        ban_map,
    )
    .await
}
