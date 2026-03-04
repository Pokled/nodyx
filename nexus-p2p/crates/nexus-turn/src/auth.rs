// ── TURN Authentication ───────────────────────────────────────────────────────
// Time-based shared secret credentials (coturn use-auth-secret compatible).
//
// username = "{expires_unix_timestamp}:{user_id}"
// password = BASE64(HMAC-SHA1(shared_secret, username))
//
// MESSAGE-INTEGRITY key = MD5("{username}:{realm}:{password}")
//
// RFC 5389 §15.4 / RFC 5766 §10.2

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use hmac::{Hmac, Mac};
use md5::Md5;
use md5::Digest as Md5Digest;
use sha1::Sha1;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::debug;

type HmacSha1 = Hmac<Sha1>;

// ── Credential generation ─────────────────────────────────────────────────────

/// Generate time-limited TURN credentials for a user.
///
/// Returns (username, password) compatible with coturn use-auth-secret.
/// The frontend passes these as RTCIceServer { username, credential }.
pub fn generate_credentials(user_id: &str, secret: &[u8], ttl_seconds: u64) -> (String, String) {
    let expires = now_secs() + ttl_seconds;
    let username = format!("{expires}:{user_id}");
    let password = hmac_sha1_b64(secret, username.as_bytes());
    (username, password)
}

// ── Credential validation ─────────────────────────────────────────────────────

/// Validate time-based credentials.
///
/// Returns true if:
/// 1. The timestamp has not expired (+ 60s grace)
/// 2. The password matches HMAC-SHA1(secret, username)
pub fn validate_credentials(username: &str, password: &str, secret: &[u8], ttl_seconds: u64) -> bool {
    let ts: u64 = username.split(':').next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let now = now_secs();
    if now > ts + ttl_seconds + 60 {
        debug!("TURN: credentials expired (ts={ts}, now={now})");
        return false;
    }
    if ts > now + 60 {
        debug!("TURN: credentials from the future (ts={ts}, now={now})");
        return false;
    }

    let expected = hmac_sha1_b64(secret, username.as_bytes());
    let ok = expected == password;
    if !ok { debug!("TURN: credential HMAC mismatch"); }
    ok
}

// ── MESSAGE-INTEGRITY ─────────────────────────────────────────────────────────

/// Derive the MESSAGE-INTEGRITY HMAC key from long-term credentials.
///
/// key = MD5("{username}:{realm}:{password}")   (RFC 5389 §15.4)
pub fn mi_key(username: &str, realm: &str, password: &str) -> [u8; 16] {
    let input = format!("{username}:{realm}:{password}");
    let mut h = Md5::new();
    h.update(input.as_bytes());
    h.finalize().into()
}

/// Compute HMAC-SHA1 MESSAGE-INTEGRITY over `data` with `key`.
/// Returns 20 bytes.
pub fn compute_message_integrity(key: &[u8; 16], data: &[u8]) -> [u8; 20] {
    let mut mac = HmacSha1::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// Verify MESSAGE-INTEGRITY attribute value against the message bytes.
///
/// `msg_bytes_before_mi` must be the raw message bytes up to (not including)
/// the MESSAGE-INTEGRITY attribute, with the length field already adjusted
/// to include the MI attribute (24 bytes: 4 attr header + 20 HMAC value).
pub fn verify_message_integrity(key: &[u8; 16], msg_bytes: &[u8], provided_mi: &[u8]) -> bool {
    if provided_mi.len() != 20 { return false; }
    let expected = compute_message_integrity(key, msg_bytes);
    // Constant-time comparison
    expected.iter().zip(provided_mi.iter()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

/// Extract MESSAGE-INTEGRITY input bytes from a raw STUN packet.
///
/// Finds the MESSAGE-INTEGRITY attribute, returns:
/// - bytes_for_mi: raw bytes from start up to (not incl.) MI attr, with length patched
/// - mi_value: the 20-byte HMAC value from the MI attribute
pub fn extract_mi_input(raw: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    if raw.len() < 20 { return None; }

    let mut pos = 20usize;
    let msg_len = u16::from_be_bytes([raw[2], raw[3]]) as usize;
    let end = 20 + msg_len;

    while pos + 4 <= end && pos + 4 <= raw.len() {
        let attr_type = u16::from_be_bytes([raw[pos], raw[pos + 1]]);
        let attr_len  = u16::from_be_bytes([raw[pos + 2], raw[pos + 3]]) as usize;

        if attr_type == 0x0008 {
            // MESSAGE-INTEGRITY found at `pos`
            if raw.len() < pos + 4 + attr_len { return None; }
            let mi_value = raw[pos + 4..pos + 4 + attr_len].to_vec();

            // Build input: everything before MI attr, with length patched
            let mut input = raw[..pos].to_vec();
            // Adjusted length = (attrs up to MI) + 24 (MI attr itself)
            let adjusted_len = (pos - 20) + 24;
            input[2] = (adjusted_len >> 8) as u8;
            input[3] = (adjusted_len & 0xFF) as u8;

            return Some((input, mi_value));
        }

        pos += 4 + ((attr_len + 3) & !3);
    }

    None // No MESSAGE-INTEGRITY found
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn hmac_sha1_b64(key: &[u8], data: &[u8]) -> String {
    let mut mac = HmacSha1::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(data);
    B64.encode(mac.finalize().into_bytes())
}
