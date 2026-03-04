// ── nexus-turn UDP Server ─────────────────────────────────────────────────────
// Handles STUN Binding + full TURN Allocate/Relay flow.
// RFC 5389 (STUN) + RFC 5766 (TURN) + RFC 5245 (ICE).

use dashmap::DashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::UdpSocket;
use tracing::{debug, info, warn};

use crate::allocation::{new_registry, spawn_eviction_task, Allocation, Registry};
use crate::auth::{extract_mi_input, mi_key, validate_credentials, verify_message_integrity};
use crate::protocol::*;

// ── Security limits ───────────────────────────────────────────────────────────

/// Max UDP packets per second from a single source IP (unauthenticated flood protection).
const RATE_LIMIT_PER_SEC: u32  = 30;
/// Max concurrent TURN allocations across all clients.
const MAX_TOTAL_ALLOC:    usize = 1000;
/// Max concurrent TURN allocations from a single client IP.
const MAX_ALLOC_PER_IP:   usize = 10;
/// Max permission entries per allocation (CreatePermission spam protection).
const MAX_PERM_PER_ALLOC: usize = 50;

// ── Per-IP rate limiter ───────────────────────────────────────────────────────

/// Token-bucket rate limiter: at most `max_per_sec` packets per second per IP.
/// Excess packets are dropped before a tokio task is spawned.
struct RateLimiter {
    map:         DashMap<IpAddr, (u32, u64)>,  // (count_this_sec, window_start_secs)
    max_per_sec: u32,
}

impl RateLimiter {
    fn new(max_per_sec: u32) -> Self {
        Self { map: DashMap::new(), max_per_sec }
    }

    /// Returns `true` if the packet is allowed; `false` if it should be dropped.
    fn allow(&self, ip: IpAddr) -> bool {
        let now = rl_now_secs();
        let mut entry = self.map.entry(ip).or_insert((0, now));
        if entry.1 < now {
            // New one-second window — reset counter.
            *entry = (1, now);
            true
        } else if entry.0 < self.max_per_sec {
            entry.0 += 1;
            true
        } else {
            false  // quota exceeded this second
        }
    }
}

fn rl_now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

// ── Server config ─────────────────────────────────────────────────────────────

pub struct TurnConfig {
    pub realm:       String,
    pub secret:      Vec<u8>,
    pub public_ip:   IpAddr,
    pub ttl:         u64,  // credential TTL in seconds
    pub nonce:       String,
}

// ── Main server ───────────────────────────────────────────────────────────────

pub async fn run(socket: Arc<UdpSocket>, cfg: Arc<TurnConfig>) -> anyhow::Result<()> {
    let registry: Registry = new_registry();
    spawn_eviction_task(Arc::clone(&registry));

    let rate_limiter = Arc::new(RateLimiter::new(RATE_LIMIT_PER_SEC));

    info!(
        addr   = %socket.local_addr()?,
        realm  = %cfg.realm,
        pub_ip = %cfg.public_ip,
        "nexus-turn listening"
    );

    let mut buf = vec![0u8; 65535];

    loop {
        let (len, src) = match socket.recv_from(&mut buf).await {
            Ok(v) => v,
            Err(e) => { warn!("recv_from error: {e}"); continue; }
        };

        // Drop without spawning a task if this source IP is flooding.
        if !rate_limiter.allow(src.ip()) {
            debug!("TURN: rate limited {} — dropping packet", src.ip());
            continue;
        }

        let raw = buf[..len].to_vec();
        let sock = Arc::clone(&socket);
        let reg  = Arc::clone(&registry);
        let cfg  = Arc::clone(&cfg);

        tokio::spawn(async move {
            handle_packet(sock, reg, cfg, raw, src).await;
        });
    }
}

// ── Packet dispatch ───────────────────────────────────────────────────────────

async fn handle_packet(
    socket: Arc<UdpSocket>,
    registry: Registry,
    cfg: Arc<TurnConfig>,
    raw: Vec<u8>,
    src: SocketAddr,
) {
    // ChannelData: top 2 bits = 01  (RFC 5766 §11.4)
    if raw.len() >= 4 && (raw[0] & 0xC0) == 0x40 {
        handle_channel_data(&socket, &registry, &raw, src).await;
        return;
    }

    let msg = match StunMessage::parse(&raw) {
        Some(m) => m,
        None => {
            debug!("non-STUN packet ({} bytes) from {src}", raw.len());
            return;
        }
    };

    match msg.msg_type {
        MSG_BINDING_REQUEST           => handle_binding(&socket, msg, src).await,
        MSG_ALLOCATE_REQUEST          => handle_allocate(&socket, &registry, &cfg, msg, raw, src).await,
        MSG_REFRESH_REQUEST           => handle_refresh(&socket, &registry, &cfg, msg, raw, src).await,
        MSG_CREATE_PERMISSION_REQUEST => handle_create_permission(&socket, &registry, &cfg, msg, raw, src).await,
        MSG_CHANNEL_BIND_REQUEST      => handle_channel_bind(&socket, &registry, &cfg, msg, raw, src).await,
        MSG_SEND_INDICATION           => handle_send_indication(&socket, &registry, msg, src).await,
        t => debug!("unhandled msg type 0x{t:04X} from {src}"),
    }
}

// ── STUN Binding ──────────────────────────────────────────────────────────────

async fn handle_binding(socket: &UdpSocket, msg: StunMessage, src: SocketAddr) {
    let mut resp = msg.response(MSG_BINDING_RESPONSE);
    resp.add_attr(ATTR_XOR_MAPPED_ADDRESS, encode_xor_address(src, &msg.transaction_id));
    resp.add_attr(ATTR_SOFTWARE, b"nexus-turn/0.1".to_vec());
    let _ = socket.send_to(&resp.encode(), src).await;
    debug!("STUN Binding: {src} → {src}");
}

// ── TURN Allocate ─────────────────────────────────────────────────────────────

async fn handle_allocate(
    socket: &Arc<UdpSocket>,
    registry: &Registry,
    cfg: &TurnConfig,
    msg: StunMessage,
    raw: Vec<u8>,
    src: SocketAddr,
) {
    // If client already has an allocation, reply with its details
    if let Some(alloc) = registry.get(&src) {
        if !alloc.is_expired() {
            send_allocate_success(socket, &msg, &alloc, alloc.remaining_lifetime()).await;
            return;
        }
    }

    // No MESSAGE-INTEGRITY → 401 with realm+nonce (RFC 5766 §6.2)
    if msg.get_attr(ATTR_MESSAGE_INTEGRITY).is_none() {
        send_error(socket, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    // Validate credentials
    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl) {
        send_error(socket, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    // Verify MESSAGE-INTEGRITY
    if !verify_mi_for_request(&raw, &username, &cfg.realm, &password) {
        send_error(socket, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    // Allocation quota checks (port exhaustion + memory protection)
    if registry.len() >= MAX_TOTAL_ALLOC {
        warn!("TURN: max total allocations ({MAX_TOTAL_ALLOC}) reached — rejecting {src}");
        send_error(socket, &msg, src, 486, "Allocation Quota Reached", None).await;
        return;
    }
    let alloc_per_ip = registry.iter()
        .filter(|e| e.value().client_addr.ip() == src.ip())
        .count();
    if alloc_per_ip >= MAX_ALLOC_PER_IP {
        warn!("TURN: per-IP allocation quota ({MAX_ALLOC_PER_IP}) reached for {}", src.ip());
        send_error(socket, &msg, src, 486, "Allocation Quota Reached", None).await;
        return;
    }

    // Check REQUESTED-TRANSPORT = UDP (17)  (RFC 5766 §6.2 step 5)
    let transport_ok = msg.get_attr(ATTR_REQUESTED_TRANSPORT)
        .map(|d| d.first() == Some(&17))
        .unwrap_or(false);
    if !transport_ok {
        send_error(socket, &msg, src, 442, "Unsupported Transport Protocol", None).await;
        return;
    }

    // Compute requested lifetime
    let lifetime = msg.get_attr(ATTR_LIFETIME)
        .and_then(|d| d.get(0..4).map(|b| u32::from_be_bytes(b.try_into().unwrap())))
        .unwrap_or(DEFAULT_LIFETIME)
        .min(MAX_LIFETIME);

    // Bind a relay UDP socket (OS assigns port)
    let relay_socket = match UdpSocket::bind((cfg.public_ip, 0)).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            warn!("TURN: failed to bind relay socket: {e}");
            send_error(socket, &msg, src, 500, "Server Error", None).await;
            return;
        }
    };

    let relay_addr = match relay_socket.local_addr() {
        Ok(a) => a,
        Err(e) => {
            warn!("TURN: relay_socket.local_addr(): {e}");
            send_error(socket, &msg, src, 500, "Server Error", None).await;
            return;
        }
    };

    let alloc = Allocation::new(
        Arc::clone(&relay_socket),
        relay_addr,
        src,
        username,
        lifetime,
    );

    // Spawn relay task: peer data → DataIndication to client
    spawn_relay_task(
        Arc::clone(&relay_socket),
        Arc::clone(socket),
        Arc::clone(&alloc),
        src,
    );

    registry.insert(src, Arc::clone(&alloc));
    info!("TURN Allocate: {src} → relay {relay_addr} (lifetime={lifetime}s)");

    send_allocate_success(socket, &msg, &alloc, lifetime).await;
}

async fn send_allocate_success(
    socket: &UdpSocket,
    msg: &StunMessage,
    alloc: &Allocation,
    lifetime: u32,
) {
    let mut resp = msg.response(MSG_ALLOCATE_RESPONSE);
    resp.add_attr(ATTR_XOR_RELAYED_ADDRESS,
                  encode_xor_address(alloc.relay_addr, &msg.transaction_id));
    resp.add_attr(ATTR_XOR_MAPPED_ADDRESS,
                  encode_xor_address(alloc.client_addr, &msg.transaction_id));
    resp.add_attr(ATTR_LIFETIME, encode_u32(lifetime));
    resp.add_attr(ATTR_SOFTWARE, b"nexus-turn/0.1".to_vec());
    let _ = socket.send_to(&resp.encode(), alloc.client_addr).await;
}

// ── TURN Refresh ──────────────────────────────────────────────────────────────

async fn handle_refresh(
    socket: &UdpSocket,
    registry: &Registry,
    cfg: &TurnConfig,
    msg: StunMessage,
    raw: Vec<u8>,
    src: SocketAddr,
) {
    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl)
        || !verify_mi_for_request(&raw, &username, &cfg.realm, &password)
    {
        send_error(socket, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    let lifetime = msg.get_attr(ATTR_LIFETIME)
        .and_then(|d| d.get(0..4).map(|b| u32::from_be_bytes(b.try_into().unwrap())))
        .unwrap_or(DEFAULT_LIFETIME)
        .min(MAX_LIFETIME);

    if let Some(alloc) = registry.get(&src) {
        if lifetime == 0 {
            // Delete allocation
            drop(alloc);
            registry.remove(&src);
            let mut resp = msg.response(MSG_REFRESH_RESPONSE);
            resp.add_attr(ATTR_LIFETIME, encode_u32(0));
            let _ = socket.send_to(&resp.encode(), src).await;
            debug!("TURN Refresh: {src} deleted allocation");
        } else {
            alloc.refresh(lifetime);
            let remaining = alloc.remaining_lifetime();
            drop(alloc);
            let mut resp = msg.response(MSG_REFRESH_RESPONSE);
            resp.add_attr(ATTR_LIFETIME, encode_u32(remaining));
            let _ = socket.send_to(&resp.encode(), src).await;
            debug!("TURN Refresh: {src} lifetime={lifetime}s");
        }
    } else {
        send_error(socket, &msg, src, 437, "Allocation Mismatch", None).await;
    }
}

// ── TURN CreatePermission ─────────────────────────────────────────────────────

async fn handle_create_permission(
    socket: &UdpSocket,
    registry: &Registry,
    cfg: &TurnConfig,
    msg: StunMessage,
    raw: Vec<u8>,
    src: SocketAddr,
) {
    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl)
        || !verify_mi_for_request(&raw, &username, &cfg.realm, &password)
    {
        send_error(socket, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    let alloc = match registry.get(&src) {
        Some(a) if !a.is_expired() => a,
        _ => {
            send_error(socket, &msg, src, 437, "Allocation Mismatch", None).await;
            return;
        }
    };

    // Limit total permission entries per allocation (CreatePermission spam protection)
    if alloc.permissions.len() >= MAX_PERM_PER_ALLOC {
        warn!("TURN: permission quota ({MAX_PERM_PER_ALLOC}) reached for {src}");
        send_error(socket, &msg, src, 486, "Allocation Quota Reached", None).await;
        return;
    }

    // Add all XOR-PEER-ADDRESS attrs as permissions
    for (attr_type, value) in &msg.attributes {
        if *attr_type == ATTR_XOR_PEER_ADDRESS {
            if let Some(peer) = decode_xor_address(value, &msg.transaction_id) {
                alloc.add_permission(peer.ip());
                debug!("TURN CreatePermission: {src} → {}", peer.ip());
            }
        }
    }

    let resp = msg.response(MSG_CREATE_PERMISSION_RESPONSE);
    let _ = socket.send_to(&resp.encode(), src).await;
}

// ── TURN ChannelBind ──────────────────────────────────────────────────────────

async fn handle_channel_bind(
    socket: &UdpSocket,
    registry: &Registry,
    cfg: &TurnConfig,
    msg: StunMessage,
    raw: Vec<u8>,
    src: SocketAddr,
) {
    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl)
        || !verify_mi_for_request(&raw, &username, &cfg.realm, &password)
    {
        send_error(socket, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    let alloc = match registry.get(&src) {
        Some(a) if !a.is_expired() => a,
        _ => {
            send_error(socket, &msg, src, 437, "Allocation Mismatch", None).await;
            return;
        }
    };

    let channel = msg.get_attr(ATTR_CHANNEL_NUMBER)
        .and_then(decode_channel_number);
    let peer = msg.get_attr(ATTR_XOR_PEER_ADDRESS)
        .and_then(|d| decode_xor_address(d, &msg.transaction_id));

    match (channel, peer) {
        (Some(ch), Some(peer_addr)) if ch >= 0x4000 && ch <= 0x7FFF => {
            alloc.add_permission(peer_addr.ip());
            alloc.bind_channel(ch, peer_addr);
            let resp = msg.response(MSG_CHANNEL_BIND_RESPONSE);
            let _ = socket.send_to(&resp.encode(), src).await;
            debug!("TURN ChannelBind: {src} ch=0x{ch:04X} → {peer_addr}");
        }
        _ => {
            send_error(socket, &msg, src, 400, "Bad Request", None).await;
        }
    }
}

// ── TURN SendIndication ───────────────────────────────────────────────────────

async fn handle_send_indication(
    _socket: &UdpSocket,
    registry: &Registry,
    msg: StunMessage,
    src: SocketAddr,
) {
    let alloc = match registry.get(&src) {
        Some(a) if !a.is_expired() => a,
        _ => { debug!("TURN Send: no allocation for {src}"); return; }
    };

    let peer_addr = match msg.get_attr(ATTR_XOR_PEER_ADDRESS)
        .and_then(|d| decode_xor_address(d, &msg.transaction_id))
    {
        Some(a) => a,
        None => { debug!("TURN Send: missing XOR-PEER-ADDRESS"); return; }
    };

    if !alloc.has_permission(&peer_addr.ip()) {
        debug!("TURN Send: no permission for {}", peer_addr.ip());
        return;
    }

    let data = match msg.get_attr(ATTR_DATA) {
        Some(d) => d,
        None => { debug!("TURN Send: missing DATA"); return; }
    };

    let _ = alloc.relay_socket.send_to(data, peer_addr).await;
    debug!("TURN Send: {src} → {peer_addr} ({} bytes)", data.len());
}

// ── ChannelData ───────────────────────────────────────────────────────────────

async fn handle_channel_data(
    _socket: &UdpSocket,
    registry: &Registry,
    raw: &[u8],
    src: SocketAddr,
) {
    if raw.len() < 4 { return; }
    let channel = u16::from_be_bytes([raw[0], raw[1]]) & 0x7FFF;
    let data_len = u16::from_be_bytes([raw[2], raw[3]]) as usize;
    if raw.len() < 4 + data_len { return; }

    let alloc = match registry.get(&src) {
        Some(a) if !a.is_expired() => a,
        _ => return,
    };

    let peer = match alloc.channel_peer(channel) {
        Some(p) => p,
        None => { debug!("TURN ChannelData: no channel 0x{channel:04X} for {src}"); return; }
    };

    let _ = alloc.relay_socket.send_to(&raw[4..4 + data_len], peer).await;
    debug!("TURN ChannelData: {src} ch=0x{channel:04X} → {peer} ({data_len} bytes)");
}

// ── Relay task: peer → client ─────────────────────────────────────────────────

fn spawn_relay_task(
    relay_socket: Arc<UdpSocket>,
    server_socket: Arc<UdpSocket>,
    alloc: Arc<Allocation>,
    client_addr: SocketAddr,
) {
    tokio::spawn(async move {
        let mut buf = vec![0u8; 65535];
        loop {
            if alloc.is_expired() { break; }

            let (len, peer_addr) = match relay_socket.recv_from(&mut buf).await {
                Ok(v) => v,
                Err(e) => { warn!("relay recv: {e}"); break; }
            };

            if !alloc.has_permission(&peer_addr.ip()) {
                debug!("relay: no permission for {}", peer_addr.ip());
                continue;
            }

            let data = buf[..len].to_vec();

            // Check if a channel is bound for this peer → send ChannelData
            if let Some(ch) = alloc.peer_channel(&peer_addr) {
                let mut packet = Vec::with_capacity(4 + data.len());
                packet.extend_from_slice(&(ch | 0x4000).to_be_bytes());
                packet.extend_from_slice(&(data.len() as u16).to_be_bytes());
                packet.extend_from_slice(&data);
                let _ = server_socket.send_to(&packet, client_addr).await;
            } else {
                // Send DataIndication
                let txid = random_txid();
                let mut ind = StunMessage::new(MSG_DATA_INDICATION, txid);
                ind.add_attr(ATTR_XOR_PEER_ADDRESS, encode_xor_address(peer_addr, &txid));
                ind.add_attr(ATTR_DATA, data);
                let _ = server_socket.send_to(&ind.encode(), client_addr).await;
            }

            debug!("relay: {peer_addr} → {client_addr} ({len} bytes)");
        }
        debug!("relay task ended for {client_addr}");
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn send_error(
    socket: &UdpSocket,
    msg: &StunMessage,
    src: SocketAddr,
    code: u16,
    reason: &str,
    auth: Option<(&str, &str)>,  // (realm, nonce)
) {
    let mut resp = msg.response(msg.msg_type | 0x0110);
    resp.add_attr(ATTR_ERROR_CODE, encode_error(code, reason));
    if let Some((realm, nonce)) = auth {
        resp.add_attr(ATTR_REALM, realm.as_bytes().to_vec());
        resp.add_attr(ATTR_NONCE, nonce.as_bytes().to_vec());
    }
    let _ = socket.send_to(&resp.encode(), src).await;
    debug!("TURN error {code} {reason} → {src}");
}

/// Derive the TURN password from the username using the shared secret.
fn derive_password(username: &str, secret: &[u8]) -> String {
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    type HmacSha1 = Hmac<Sha1>;
    let mut mac = HmacSha1::new_from_slice(secret).expect("HMAC accepts any key");
    mac.update(username.as_bytes());
    B64.encode(mac.finalize().into_bytes())
}

/// Verify MESSAGE-INTEGRITY on an incoming request.
fn verify_mi_for_request(raw: &[u8], username: &str, realm: &str, password: &str) -> bool {
    match extract_mi_input(raw) {
        Some((input, mi_val)) => {
            let key = mi_key(username, realm, password);
            verify_message_integrity(&key, &input, &mi_val)
        }
        None => false,
    }
}

fn random_txid() -> [u8; 12] {
    use rand::RngCore;
    let mut txid = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut txid);
    txid
}
