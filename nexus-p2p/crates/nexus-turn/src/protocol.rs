// ── STUN/TURN Protocol — RFC 5389 + RFC 5766 ─────────────────────────────────
// Message format, constants, parsing, encoding, attribute helpers.

use std::net::{IpAddr, SocketAddr};

// ── Magic cookie (RFC 5389 §6) ────────────────────────────────────────────────
pub const MAGIC_COOKIE: u32 = 0x2112_A442;

// ── Message types ─────────────────────────────────────────────────────────────
// STUN
pub const MSG_BINDING_REQUEST:  u16 = 0x0001;
pub const MSG_BINDING_RESPONSE: u16 = 0x0101;
// TURN
pub const MSG_ALLOCATE_REQUEST:            u16 = 0x0003;
pub const MSG_ALLOCATE_RESPONSE:           u16 = 0x0103;
pub const MSG_ALLOCATE_ERROR:              u16 = 0x0113;
pub const MSG_REFRESH_REQUEST:             u16 = 0x0004;
pub const MSG_REFRESH_RESPONSE:            u16 = 0x0104;
pub const MSG_SEND_INDICATION:             u16 = 0x0016;
pub const MSG_DATA_INDICATION:             u16 = 0x0017;
pub const MSG_CREATE_PERMISSION_REQUEST:   u16 = 0x0008;
pub const MSG_CREATE_PERMISSION_RESPONSE:  u16 = 0x0108;
pub const MSG_CHANNEL_BIND_REQUEST:        u16 = 0x0009;
pub const MSG_CHANNEL_BIND_RESPONSE:       u16 = 0x0109;

// ── Attribute types ───────────────────────────────────────────────────────────
pub const ATTR_MAPPED_ADDRESS:         u16 = 0x0001;
pub const ATTR_USERNAME:               u16 = 0x0006;
pub const ATTR_MESSAGE_INTEGRITY:      u16 = 0x0008;
pub const ATTR_ERROR_CODE:             u16 = 0x0009;
pub const ATTR_REALM:                  u16 = 0x0014;
pub const ATTR_NONCE:                  u16 = 0x0015;
pub const ATTR_XOR_MAPPED_ADDRESS:     u16 = 0x0020;
pub const ATTR_CHANNEL_NUMBER:         u16 = 0x000C;
pub const ATTR_LIFETIME:               u16 = 0x000D;
pub const ATTR_XOR_PEER_ADDRESS:       u16 = 0x0012;
pub const ATTR_DATA:                   u16 = 0x0013;
pub const ATTR_XOR_RELAYED_ADDRESS:    u16 = 0x0016;
pub const ATTR_REQUESTED_TRANSPORT:    u16 = 0x0019;
pub const ATTR_SOFTWARE:               u16 = 0x8022;

// Default TURN allocation lifetime (seconds)
pub const DEFAULT_LIFETIME: u32 = 600;
pub const MAX_LIFETIME:     u32 = 3600;

// ── STUN Message ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct StunMessage {
    pub msg_type:       u16,
    pub transaction_id: [u8; 12],
    pub attributes:     Vec<(u16, Vec<u8>)>,
}

impl StunMessage {
    pub fn new(msg_type: u16, transaction_id: [u8; 12]) -> Self {
        Self { msg_type, transaction_id, attributes: Vec::new() }
    }

    pub fn response(&self, msg_type: u16) -> Self {
        Self::new(msg_type, self.transaction_id)
    }

    pub fn add_attr(&mut self, attr_type: u16, value: Vec<u8>) {
        self.attributes.push((attr_type, value));
    }

    pub fn get_attr(&self, attr_type: u16) -> Option<&[u8]> {
        self.attributes.iter()
            .find(|(t, _)| *t == attr_type)
            .map(|(_, v)| v.as_slice())
    }

    pub fn get_attr_string(&self, attr_type: u16) -> Option<String> {
        self.get_attr(attr_type)
            .and_then(|b| String::from_utf8(b.to_vec()).ok())
    }

    /// Parse a STUN/TURN message from raw bytes.
    /// Returns None if the data is not a valid STUN message.
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() < 20 { return None; }
        // Top 2 bits must be 0 (RFC 5389 §6)
        if data[0] & 0xC0 != 0 { return None; }

        let msg_type = u16::from_be_bytes([data[0], data[1]]);
        let msg_len  = u16::from_be_bytes([data[2], data[3]]) as usize;
        let magic    = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);

        if magic != MAGIC_COOKIE { return None; }
        if data.len() < 20 + msg_len { return None; }

        let mut txid = [0u8; 12];
        txid.copy_from_slice(&data[8..20]);

        let mut msg = Self::new(msg_type, txid);
        let mut pos = 20;
        let end = 20 + msg_len;

        while pos + 4 <= end {
            let attr_type = u16::from_be_bytes([data[pos], data[pos + 1]]);
            let attr_len  = u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize;
            pos += 4;
            if pos + attr_len > data.len() { break; }
            msg.attributes.push((attr_type, data[pos..pos + attr_len].to_vec()));
            // Pad to 4-byte boundary
            pos += (attr_len + 3) & !3;
        }

        Some(msg)
    }

    /// Encode the message WITHOUT MESSAGE-INTEGRITY (used for computing MI input).
    /// The length field is adjusted to include the pending MI attribute (24 bytes).
    pub fn encode_for_integrity(&self) -> Vec<u8> {
        let attrs = self.encode_attrs();
        let total_len = attrs.len() + 24; // attrs + MI attr (4 header + 20 HMAC)
        let mut buf = Vec::with_capacity(20 + attrs.len());
        buf.extend_from_slice(&self.msg_type.to_be_bytes());
        buf.extend_from_slice(&(total_len as u16).to_be_bytes());
        buf.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        buf.extend_from_slice(&self.transaction_id);
        buf.extend_from_slice(&attrs);
        buf
    }

    /// Encode the full message (including all attributes already added).
    pub fn encode(&self) -> Vec<u8> {
        let attrs = self.encode_attrs();
        let mut buf = Vec::with_capacity(20 + attrs.len());
        buf.extend_from_slice(&self.msg_type.to_be_bytes());
        buf.extend_from_slice(&(attrs.len() as u16).to_be_bytes());
        buf.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        buf.extend_from_slice(&self.transaction_id);
        buf.extend_from_slice(&attrs);
        buf
    }

    fn encode_attrs(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        for (attr_type, value) in &self.attributes {
            buf.extend_from_slice(&attr_type.to_be_bytes());
            buf.extend_from_slice(&(value.len() as u16).to_be_bytes());
            buf.extend_from_slice(value);
            // Pad to 4-byte boundary
            let pad = (4 - (value.len() % 4)) % 4;
            buf.extend_from_slice(&vec![0u8; pad]);
        }
        buf
    }
}

// ── Address encoding ──────────────────────────────────────────────────────────

/// Encode a SocketAddr as XOR-MAPPED-ADDRESS / XOR-RELAYED-ADDRESS / XOR-PEER-ADDRESS.
pub fn encode_xor_address(addr: SocketAddr, txid: &[u8; 12]) -> Vec<u8> {
    match addr {
        SocketAddr::V4(v4) => {
            let port = v4.port() ^ ((MAGIC_COOKIE >> 16) as u16);
            let ip   = u32::from(*v4.ip());
            let xip  = ip ^ MAGIC_COOKIE;
            let mut buf = vec![0u8, 0x01]; // family = IPv4
            buf.extend_from_slice(&port.to_be_bytes());
            buf.extend_from_slice(&xip.to_be_bytes());
            buf
        }
        SocketAddr::V6(v6) => {
            let port = v6.port() ^ ((MAGIC_COOKIE >> 16) as u16);
            let ip   = v6.ip().octets();
            let mut xor_key = [0u8; 16];
            xor_key[..4].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
            xor_key[4..].copy_from_slice(txid);
            let xip: Vec<u8> = ip.iter().zip(xor_key.iter()).map(|(a, b)| a ^ b).collect();
            let mut buf = vec![0u8, 0x02]; // family = IPv6
            buf.extend_from_slice(&port.to_be_bytes());
            buf.extend_from_slice(&xip);
            buf
        }
    }
}

/// Decode a XOR-*-ADDRESS attribute into a SocketAddr.
pub fn decode_xor_address(data: &[u8], txid: &[u8; 12]) -> Option<SocketAddr> {
    if data.len() < 4 { return None; }
    let family = data[1];
    let port   = u16::from_be_bytes([data[2], data[3]]) ^ ((MAGIC_COOKIE >> 16) as u16);
    match family {
        0x01 => {
            if data.len() < 8 { return None; }
            let xip = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
            let ip  = xip ^ MAGIC_COOKIE;
            Some(SocketAddr::new(IpAddr::V4(ip.into()), port))
        }
        0x02 => {
            if data.len() < 20 { return None; }
            let mut xor_key = [0u8; 16];
            xor_key[..4].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
            xor_key[4..].copy_from_slice(txid);
            let xip: Vec<u8> = data[4..20].iter().zip(xor_key.iter()).map(|(a, b)| a ^ b).collect();
            let mut ip6 = [0u8; 16];
            ip6.copy_from_slice(&xip);
            Some(SocketAddr::new(IpAddr::V6(ip6.into()), port))
        }
        _ => None,
    }
}

/// Encode an error code attribute.
pub fn encode_error(code: u16, reason: &str) -> Vec<u8> {
    let class  = (code / 100) as u8;
    let number = (code % 100) as u8;
    let mut buf = vec![0u8, 0u8, class, number];
    buf.extend_from_slice(reason.as_bytes());
    buf
}

/// Encode a u32 as big-endian bytes (LIFETIME, CHANNEL-NUMBER padded, etc.)
pub fn encode_u32(v: u32) -> Vec<u8> {
    v.to_be_bytes().to_vec()
}

/// Encode CHANNEL-NUMBER attribute (channel + 2 reserved bytes)
pub fn encode_channel_number(ch: u16) -> Vec<u8> {
    let mut buf = vec![0u8; 4];
    buf[0..2].copy_from_slice(&ch.to_be_bytes());
    buf
}

/// Decode CHANNEL-NUMBER attribute
pub fn decode_channel_number(data: &[u8]) -> Option<u16> {
    if data.len() < 2 { return None; }
    Some(u16::from_be_bytes([data[0], data[1]]))
}

/// Encode REQUESTED-TRANSPORT attribute (UDP = 17)
pub fn encode_requested_transport(proto: u8) -> Vec<u8> {
    vec![proto, 0, 0, 0]
}
