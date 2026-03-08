// ── nexus-turn Server (UDP + TCP) ─────────────────────────────────────────────
// Handles STUN Binding + full TURN Allocate/Relay flow.
// RFC 5389 (STUN) + RFC 5766 (TURN) + RFC 6062 (TURN-over-TCP) + RFC 5245 (ICE).
//
// TCP transport: 2-byte big-endian length prefix per message (RFC 4571 framing).
// Client-to-server transport is TCP; relay to peers remains UDP.

use dashmap::DashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::allocation::{spawn_eviction_task, Allocation, Registry};
use crate::auth::{compute_message_integrity, extract_mi_input, mi_key, validate_credentials, verify_message_integrity};
use crate::protocol::*;

// ── Security limits ───────────────────────────────────────────────────────────

/// Max UDP packets per second from a single source IP (unauthenticated flood protection).
const RATE_LIMIT_PER_SEC: u32  = 30;
/// Max concurrent TURN allocations across all clients.
const MAX_TOTAL_ALLOC:    usize = 1000;
/// Max concurrent TURN allocations from a single client IP.
const MAX_ALLOC_PER_IP:   usize = 50;
/// Max permission entries per allocation (CreatePermission spam protection).
const MAX_PERM_PER_ALLOC: usize = 50;
/// Max incoming TCP frame size (prevents memory exhaustion).
const MAX_TCP_FRAME:      usize = 65535;

// ── Response sink — abstracts UDP and TCP write paths ─────────────────────────

/// A cloneable handle for sending STUN/TURN responses back to a client,
/// regardless of whether they connected via UDP or TCP.
#[derive(Clone)]
enum ResponseSink {
    /// UDP: send a datagram to `addr` via `socket`.
    Udp { socket: Arc<UdpSocket>, addr: SocketAddr },
    /// TCP: push length-prefixed frames into the connection write channel.
    Tcp { tx: mpsc::UnboundedSender<Vec<u8>> },
}

impl ResponseSink {
    async fn send(&self, data: &[u8]) {
        match self {
            ResponseSink::Udp { socket, addr } => {
                socket.send_to(data, *addr).await.ok();
            }
            ResponseSink::Tcp { tx } => {
                if data.len() > MAX_TCP_FRAME { return; }
                // RFC 4571: 2-byte big-endian length prefix
                let mut framed = Vec::with_capacity(data.len() + 2);
                framed.extend_from_slice(&(data.len() as u16).to_be_bytes());
                framed.extend_from_slice(data);
                tx.send(framed).ok();
            }
        }
    }
}

// ── Per-IP rate limiter ───────────────────────────────────────────────────────

struct RateLimiter {
    map:         DashMap<IpAddr, (u32, u64)>,  // (count_this_sec, window_start_secs)
    max_per_sec: u32,
}

impl RateLimiter {
    fn new(max_per_sec: u32) -> Self {
        Self { map: DashMap::new(), max_per_sec }
    }

    fn allow(&self, ip: IpAddr) -> bool {
        let now = rl_now_secs();
        let mut entry = self.map.entry(ip).or_insert((0, now));
        if entry.1 < now {
            *entry = (1, now);
            true
        } else if entry.0 < self.max_per_sec {
            entry.0 += 1;
            true
        } else {
            false
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
    pub ttl:         u64,
    pub nonce:       String,
}

// ── UDP server ────────────────────────────────────────────────────────────────

pub async fn run(socket: Arc<UdpSocket>, cfg: Arc<TurnConfig>, registry: Registry) -> anyhow::Result<()> {
    spawn_eviction_task(Arc::clone(&registry));

    let rate_limiter = Arc::new(RateLimiter::new(RATE_LIMIT_PER_SEC));

    info!(
        addr   = %socket.local_addr()?,
        realm  = %cfg.realm,
        pub_ip = %cfg.public_ip,
        "nexus-turn UDP listening"
    );

    let mut buf = vec![0u8; 65535];
    loop {
        let (len, src) = match socket.recv_from(&mut buf).await {
            Ok(v) => v,
            Err(e) => { warn!("recv_from error: {e}"); continue; }
        };

        if !rate_limiter.allow(src.ip()) {
            debug!("TURN: rate limited {} — dropping packet", src.ip());
            continue;
        }

        let raw  = buf[..len].to_vec();
        let sink = ResponseSink::Udp { socket: Arc::clone(&socket), addr: src };
        let reg  = Arc::clone(&registry);
        let cfg  = Arc::clone(&cfg);

        tokio::spawn(async move {
            handle_packet(sink, reg, cfg, raw, src).await;
        });
    }
}

// ── TCP server (RFC 6062) ─────────────────────────────────────────────────────

pub async fn run_tcp(port: u16, cfg: Arc<TurnConfig>, registry: Registry) -> anyhow::Result<()> {
    let bind_addr: SocketAddr = (std::net::Ipv4Addr::UNSPECIFIED, port).into();
    let listener = TcpListener::bind(bind_addr).await
        .map_err(|e| anyhow::anyhow!("Failed to bind TCP {bind_addr}: {e}"))?;

    info!(addr = %bind_addr, "nexus-turn TCP listening");

    loop {
        let (stream, peer_addr) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => { warn!("TCP accept error: {e}"); continue; }
        };

        let cfg = Arc::clone(&cfg);
        let reg = Arc::clone(&registry);

        tokio::spawn(async move {
            handle_tcp_connection(stream, peer_addr, cfg, reg).await;
        });
    }
}

/// Handle one TCP connection for the lifetime of the client.
/// Framing: RFC 4571 — each message is prefixed by a 2-byte big-endian length.
async fn handle_tcp_connection(
    stream:    TcpStream,
    peer_addr: SocketAddr,
    cfg:       Arc<TurnConfig>,
    registry:  Registry,
) {
    let (mut reader, writer) = stream.into_split();
    let writer = Arc::new(tokio::sync::Mutex::new(writer));

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // Writer task: drains the channel and writes length-prefixed frames to TCP.
    let writer_clone = Arc::clone(&writer);
    tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            let mut w = writer_clone.lock().await;
            if w.write_all(&frame).await.is_err() { break; }
        }
    });

    let sink = ResponseSink::Tcp { tx };
    let mut len_buf = [0u8; 2];

    loop {
        // Read 2-byte length prefix
        if reader.read_exact(&mut len_buf).await.is_err() { break; }
        let msg_len = u16::from_be_bytes(len_buf) as usize;

        if msg_len == 0 || msg_len > MAX_TCP_FRAME {
            warn!("TURN TCP: bad frame length {msg_len} from {peer_addr}");
            break;
        }

        let mut raw = vec![0u8; msg_len];
        if reader.read_exact(&mut raw).await.is_err() { break; }

        let sink  = sink.clone();
        let reg   = Arc::clone(&registry);
        let cfg   = Arc::clone(&cfg);

        tokio::spawn(async move {
            handle_packet(sink, reg, cfg, raw, peer_addr).await;
        });
    }

    debug!("TURN TCP: connection closed for {peer_addr}");
    // Clean up allocation if client disconnects cleanly
    registry.remove(&peer_addr);
}

// ── Packet dispatch ───────────────────────────────────────────────────────────

async fn handle_packet(
    sink:     ResponseSink,
    registry: Registry,
    cfg:      Arc<TurnConfig>,
    raw:      Vec<u8>,
    src:      SocketAddr,
) {
    // ChannelData: top 2 bits = 01  (RFC 5766 §11.4)
    if raw.len() >= 4 && (raw[0] & 0xC0) == 0x40 {
        handle_channel_data(&registry, &raw, src).await;
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
        MSG_BINDING_REQUEST           => handle_binding(&sink, msg, src).await,
        MSG_ALLOCATE_REQUEST          => handle_allocate(&sink, &registry, &cfg, msg, raw, src).await,
        MSG_REFRESH_REQUEST           => handle_refresh(&sink, &registry, &cfg, msg, raw, src).await,
        MSG_CREATE_PERMISSION_REQUEST => handle_create_permission(&sink, &registry, &cfg, msg, raw, src).await,
        MSG_CHANNEL_BIND_REQUEST      => handle_channel_bind(&sink, &registry, &cfg, msg, raw, src).await,
        MSG_SEND_INDICATION           => handle_send_indication(&registry, msg, src).await,
        t => debug!("unhandled msg type 0x{t:04X} from {src}"),
    }
}

// ── STUN Binding ──────────────────────────────────────────────────────────────

async fn handle_binding(sink: &ResponseSink, msg: StunMessage, src: SocketAddr) {
    let mut resp = msg.response(MSG_BINDING_RESPONSE);
    resp.add_attr(ATTR_XOR_MAPPED_ADDRESS, encode_xor_address(src, &msg.transaction_id));
    resp.add_attr(ATTR_SOFTWARE, b"nexus-turn/0.1".to_vec());
    sink.send(&resp.encode()).await;
    debug!("STUN Binding: {src} → {src}");
}

// ── TURN Allocate ─────────────────────────────────────────────────────────────

async fn handle_allocate(
    sink:     &ResponseSink,
    registry: &Registry,
    cfg:      &TurnConfig,
    msg:      StunMessage,
    raw:      Vec<u8>,
    src:      SocketAddr,
) {
    // If client already has an allocation, reply with its details
    if let Some(alloc) = registry.get(&src) {
        if !alloc.is_expired() {
            let existing_user = alloc.username.clone();
            let existing_pass = derive_password(&existing_user, &cfg.secret);
            send_allocate_success(sink, &msg, &alloc, alloc.remaining_lifetime(),
                                  &existing_user, &cfg.realm, &existing_pass).await;
            return;
        }
    }

    // No MESSAGE-INTEGRITY → 401 with realm+nonce (RFC 5766 §6.2)
    if msg.get_attr(ATTR_MESSAGE_INTEGRITY).is_none() {
        send_error(sink, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl) {
        send_error(sink, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    if !verify_mi_for_request(&raw, &username, &cfg.realm, &password) {
        send_error(sink, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    // Quota checks
    if registry.len() >= MAX_TOTAL_ALLOC {
        warn!("TURN: max total allocations ({MAX_TOTAL_ALLOC}) reached — rejecting {src}");
        send_error(sink, &msg, src, 486, "Allocation Quota Reached", None).await;
        return;
    }
    let alloc_per_ip = registry.iter()
        .filter(|e| e.value().client_addr.ip() == src.ip())
        .count();
    if alloc_per_ip >= MAX_ALLOC_PER_IP {
        warn!("TURN: per-IP allocation quota ({MAX_ALLOC_PER_IP}) reached for {}", src.ip());
        send_error(sink, &msg, src, 486, "Allocation Quota Reached", None).await;
        return;
    }

    // REQUESTED-TRANSPORT = UDP (17)  (RFC 5766 §6.2 step 5)
    let transport_ok = msg.get_attr(ATTR_REQUESTED_TRANSPORT)
        .map(|d| d.first() == Some(&17))
        .unwrap_or(false);
    if !transport_ok {
        send_error(sink, &msg, src, 442, "Unsupported Transport Protocol", None).await;
        return;
    }

    let lifetime = msg.get_attr(ATTR_LIFETIME)
        .and_then(|d| d.get(0..4).map(|b| u32::from_be_bytes(b.try_into().unwrap())))
        .unwrap_or(DEFAULT_LIFETIME)
        .min(MAX_LIFETIME);

    // Bind a relay UDP socket (OS assigns port from system ephemeral range)
    let relay_socket = match UdpSocket::bind((cfg.public_ip, 0u16)).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            warn!("TURN: failed to bind relay socket: {e}");
            send_error(sink, &msg, src, 500, "Server Error", None).await;
            return;
        }
    };

    let relay_addr = match relay_socket.local_addr() {
        Ok(a) => a,
        Err(e) => {
            warn!("TURN: relay_socket.local_addr(): {e}");
            send_error(sink, &msg, src, 500, "Server Error", None).await;
            return;
        }
    };

    let alloc = Allocation::new(
        Arc::clone(&relay_socket),
        relay_addr,
        src,
        username.clone(),
        lifetime,
    );

    // Relay task: peer → DataIndication/ChannelData back to client via ResponseSink
    spawn_relay_task(
        Arc::clone(&relay_socket),
        sink.clone(),
        Arc::clone(&alloc),
    );

    registry.insert(src, Arc::clone(&alloc));
    info!("TURN Allocate: {src} → relay {relay_addr} (lifetime={lifetime}s)");

    send_allocate_success(sink, &msg, &alloc, lifetime, &username, &cfg.realm, &password).await;
}

async fn send_allocate_success(
    sink:     &ResponseSink,
    msg:      &StunMessage,
    alloc:    &Allocation,
    lifetime: u32,
    username: &str,
    realm:    &str,
    password: &str,
) {
    let mut resp = msg.response(MSG_ALLOCATE_RESPONSE);
    resp.add_attr(ATTR_XOR_RELAYED_ADDRESS,
                  encode_xor_address(alloc.relay_addr, &msg.transaction_id));
    resp.add_attr(ATTR_XOR_MAPPED_ADDRESS,
                  encode_xor_address(alloc.client_addr, &msg.transaction_id));
    resp.add_attr(ATTR_LIFETIME, encode_u32(lifetime));
    resp.add_attr(ATTR_SOFTWARE, b"nexus-turn/0.1".to_vec());
    // RFC 5389 §10.3: MUST include MI in response to authenticated request
    sink.send(&sign_response(&mut resp, username, realm, password)).await;
}

// ── TURN Refresh ──────────────────────────────────────────────────────────────

async fn handle_refresh(
    sink:     &ResponseSink,
    registry: &Registry,
    cfg:      &TurnConfig,
    msg:      StunMessage,
    raw:      Vec<u8>,
    src:      SocketAddr,
) {
    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl)
        || !verify_mi_for_request(&raw, &username, &cfg.realm, &password)
    {
        send_error(sink, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    let lifetime = msg.get_attr(ATTR_LIFETIME)
        .and_then(|d| d.get(0..4).map(|b| u32::from_be_bytes(b.try_into().unwrap())))
        .unwrap_or(DEFAULT_LIFETIME)
        .min(MAX_LIFETIME);

    if let Some(alloc) = registry.get(&src) {
        if lifetime == 0 {
            drop(alloc);
            registry.remove(&src);
            let mut resp = msg.response(MSG_REFRESH_RESPONSE);
            resp.add_attr(ATTR_LIFETIME, encode_u32(0));
            sink.send(&sign_response(&mut resp, &username, &cfg.realm, &password)).await;
            debug!("TURN Refresh: {src} deleted allocation");
        } else {
            alloc.refresh(lifetime);
            let remaining = alloc.remaining_lifetime();
            drop(alloc);
            let mut resp = msg.response(MSG_REFRESH_RESPONSE);
            resp.add_attr(ATTR_LIFETIME, encode_u32(remaining));
            sink.send(&sign_response(&mut resp, &username, &cfg.realm, &password)).await;
            debug!("TURN Refresh: {src} lifetime={lifetime}s");
        }
    } else {
        send_error(sink, &msg, src, 437, "Allocation Mismatch", None).await;
    }
}

// ── TURN CreatePermission ─────────────────────────────────────────────────────

async fn handle_create_permission(
    sink:     &ResponseSink,
    registry: &Registry,
    cfg:      &TurnConfig,
    msg:      StunMessage,
    raw:      Vec<u8>,
    src:      SocketAddr,
) {
    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl)
        || !verify_mi_for_request(&raw, &username, &cfg.realm, &password)
    {
        send_error(sink, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    let alloc = match registry.get(&src) {
        Some(a) if !a.is_expired() => a,
        _ => {
            send_error(sink, &msg, src, 437, "Allocation Mismatch", None).await;
            return;
        }
    };

    if alloc.permissions.len() >= MAX_PERM_PER_ALLOC {
        warn!("TURN: permission quota ({MAX_PERM_PER_ALLOC}) reached for {src}");
        send_error(sink, &msg, src, 486, "Allocation Quota Reached", None).await;
        return;
    }

    for (attr_type, value) in &msg.attributes {
        if *attr_type == ATTR_XOR_PEER_ADDRESS {
            if let Some(peer) = decode_xor_address(value, &msg.transaction_id) {
                alloc.add_permission(peer.ip());
                debug!("TURN CreatePermission: {src} → {}", peer.ip());
            }
        }
    }

    let mut resp = msg.response(MSG_CREATE_PERMISSION_RESPONSE);
    sink.send(&sign_response(&mut resp, &username, &cfg.realm, &password)).await;
}

// ── TURN ChannelBind ──────────────────────────────────────────────────────────

async fn handle_channel_bind(
    sink:     &ResponseSink,
    registry: &Registry,
    cfg:      &TurnConfig,
    msg:      StunMessage,
    raw:      Vec<u8>,
    src:      SocketAddr,
) {
    let username = msg.get_attr_string(ATTR_USERNAME).unwrap_or_default();
    let password = derive_password(&username, &cfg.secret);

    if !validate_credentials(&username, &password, &cfg.secret, cfg.ttl)
        || !verify_mi_for_request(&raw, &username, &cfg.realm, &password)
    {
        send_error(sink, &msg, src, 401, "Unauthorized",
                   Some((&cfg.realm, &cfg.nonce))).await;
        return;
    }

    let alloc = match registry.get(&src) {
        Some(a) if !a.is_expired() => a,
        _ => {
            send_error(sink, &msg, src, 437, "Allocation Mismatch", None).await;
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
            let mut resp = msg.response(MSG_CHANNEL_BIND_RESPONSE);
            sink.send(&sign_response(&mut resp, &username, &cfg.realm, &password)).await;
            debug!("TURN ChannelBind: {src} ch=0x{ch:04X} → {peer_addr}");
        }
        _ => {
            send_error(sink, &msg, src, 400, "Bad Request", None).await;
        }
    }
}

// ── TURN SendIndication ───────────────────────────────────────────────────────

async fn handle_send_indication(
    registry: &Registry,
    msg:      StunMessage,
    src:      SocketAddr,
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

async fn handle_channel_data(registry: &Registry, raw: &[u8], src: SocketAddr) {
    if raw.len() < 4 { return; }
    let channel  = u16::from_be_bytes([raw[0], raw[1]]) & 0x7FFF;
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
//
// Receives data from remote peers on the relay UDP socket and forwards it to
// the client via their ResponseSink (UDP datagram or TCP framed message).

fn spawn_relay_task(
    relay_socket: Arc<UdpSocket>,
    sink:         ResponseSink,
    alloc:        Arc<Allocation>,
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

            // Channel bound for this peer → ChannelData
            if let Some(ch) = alloc.peer_channel(&peer_addr) {
                let mut packet = Vec::with_capacity(4 + data.len());
                packet.extend_from_slice(&(ch | 0x4000).to_be_bytes());
                packet.extend_from_slice(&(data.len() as u16).to_be_bytes());
                packet.extend_from_slice(&data);
                sink.send(&packet).await;
            } else {
                // DataIndication
                let txid = random_txid();
                let mut ind = StunMessage::new(MSG_DATA_INDICATION, txid);
                ind.add_attr(ATTR_XOR_PEER_ADDRESS, encode_xor_address(peer_addr, &txid));
                ind.add_attr(ATTR_DATA, data);
                sink.send(&ind.encode()).await;
            }

            debug!("relay: {peer_addr} → client ({len} bytes)");
        }
        debug!("relay task ended for {}", alloc.client_addr);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// RFC 5389 §10.3: responses to authenticated requests MUST include MESSAGE-INTEGRITY.
/// Call after all other attributes are added — MI covers everything before it.
fn sign_response(resp: &mut StunMessage, username: &str, realm: &str, password: &str) -> Vec<u8> {
    let key   = mi_key(username, realm, password);
    let input = resp.encode_for_integrity(); // length field pre-adjusted for MI
    let mi    = compute_message_integrity(&key, &input);
    resp.add_attr(ATTR_MESSAGE_INTEGRITY, mi.to_vec());
    resp.encode()
}

async fn send_error(
    sink:  &ResponseSink,
    msg:   &StunMessage,
    src:   SocketAddr,
    code:  u16,
    reason: &str,
    auth:  Option<(&str, &str)>,  // (realm, nonce)
) {
    let mut resp = msg.response(msg.msg_type | 0x0110);
    resp.add_attr(ATTR_ERROR_CODE, encode_error(code, reason));
    if let Some((realm, nonce)) = auth {
        resp.add_attr(ATTR_REALM, realm.as_bytes().to_vec());
        resp.add_attr(ATTR_NONCE, nonce.as_bytes().to_vec());
    }
    sink.send(&resp.encode()).await;
    debug!("TURN error {code} {reason} → {src}");
}

fn derive_password(username: &str, secret: &[u8]) -> String {
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    type HmacSha1 = Hmac<Sha1>;
    let mut mac = HmacSha1::new_from_slice(secret).expect("HMAC accepts any key");
    mac.update(username.as_bytes());
    B64.encode(mac.finalize().into_bytes())
}

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
