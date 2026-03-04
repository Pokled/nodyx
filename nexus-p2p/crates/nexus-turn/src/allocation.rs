// ── TURN Allocation Registry ──────────────────────────────────────────────────
// Each client gets one allocation: a relay UDP socket + permissions + channels.
// RFC 5766 §5

use dashmap::DashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::UdpSocket;

// ── Allocation ────────────────────────────────────────────────────────────────

pub struct Allocation {
    /// The relay UDP socket bound for this allocation (its addr = relayed address).
    pub relay_socket: Arc<UdpSocket>,
    /// The public address of the relay socket.
    pub relay_addr: SocketAddr,
    /// The client's address (where DataIndications are sent).
    pub client_addr: SocketAddr,
    /// The authenticated username.
    pub username: String,
    /// Unix timestamp (seconds) when this allocation expires.
    expires_unix: AtomicU64,
    /// Permitted peer IPs → expiry unix seconds (CreatePermission, 5-min TTL).
    pub permissions: DashMap<IpAddr, u64>,
    /// Channel bindings: channel_number → peer SocketAddr (ChannelBind).
    pub channels: DashMap<u16, SocketAddr>,
    /// Reverse map: peer SocketAddr → channel_number (for relay→client fast path).
    pub channels_rev: DashMap<SocketAddr, u16>,
}

impl Allocation {
    pub fn new(
        relay_socket: Arc<UdpSocket>,
        relay_addr: SocketAddr,
        client_addr: SocketAddr,
        username: String,
        lifetime: u32,
    ) -> Arc<Self> {
        Arc::new(Self {
            relay_socket,
            relay_addr,
            client_addr,
            username,
            expires_unix: AtomicU64::new(now_secs() + lifetime as u64),
            permissions: DashMap::new(),
            channels: DashMap::new(),
            channels_rev: DashMap::new(),
        })
    }

    pub fn is_expired(&self) -> bool {
        now_secs() >= self.expires_unix.load(Ordering::Relaxed)
    }

    /// Refresh the allocation lifetime (interior mutability via AtomicU64).
    pub fn refresh(&self, lifetime: u32) {
        self.expires_unix.store(now_secs() + lifetime as u64, Ordering::Relaxed);
    }

    pub fn remaining_lifetime(&self) -> u32 {
        let now = now_secs();
        let exp = self.expires_unix.load(Ordering::Relaxed);
        if now >= exp { 0 } else { (exp - now) as u32 }
    }

    /// Returns true if the peer IP has an active permission.
    pub fn has_permission(&self, peer_ip: &IpAddr) -> bool {
        self.permissions.get(peer_ip)
            .map(|exp| now_secs() < *exp)
            .unwrap_or(false)
    }

    /// Add or refresh a permission for a peer IP (RFC 5766: 5-minute TTL).
    pub fn add_permission(&self, peer_ip: IpAddr) {
        self.permissions.insert(peer_ip, now_secs() + 300);
    }

    /// Bind a channel number to a peer address.
    pub fn bind_channel(&self, channel: u16, peer: SocketAddr) {
        self.channels.insert(channel, peer);
        self.channels_rev.insert(peer, channel);
    }

    pub fn channel_peer(&self, channel: u16) -> Option<SocketAddr> {
        self.channels.get(&channel).map(|v| *v)
    }

    pub fn peer_channel(&self, peer: &SocketAddr) -> Option<u16> {
        self.channels_rev.get(peer).map(|v| *v)
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

/// Maps client SocketAddr → their Allocation.
pub type Registry = Arc<DashMap<SocketAddr, Arc<Allocation>>>;

pub fn new_registry() -> Registry {
    Arc::new(DashMap::new())
}

/// Spawn a background task that evicts expired allocations every 30 seconds.
pub fn spawn_eviction_task(registry: Registry) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let before = registry.len();
            registry.retain(|_, alloc| !alloc.is_expired());
            let after = registry.len();
            if before != after {
                tracing::debug!("TURN: evicted {} expired allocations", before - after);
            }
        }
    });
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}
