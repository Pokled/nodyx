//! Format de fil gossip + signature des records, fait maison (sauf la courbe).
//!
//! Un datagramme est du texte UTF-8 :
//! ```text
//! NDX1
//! <expediteur>
//! <pair 1>
//! ...
//! ```
//! Chaque ligne de pair : `node_id|slug|addr|heartbeat|sig`.
//! - `node_id` = cle publique Ed25519 (hex). C'est l'identite du noeud.
//! - `sig`     = signature Ed25519 (hex) de `node_id|slug|addr|heartbeat`.
//!
//! Consequence : on ne peut pas falsifier le record d'un noeud (il faudrait sa
//! cle privee), ni l'alterer en transit. Le heartbeat etant signe, on ne peut
//! pas non plus rejouer un vieux record avec un horodatage gonfle.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};

/// Ce qu'on sait d'un noeud du reseau Nodyx.
#[derive(Clone, Debug, PartialEq)]
pub struct PeerInfo {
    pub node_id: String, // hex de la cle publique Ed25519
    pub slug: String,
    pub addr: String,
    pub heartbeat: u64,
    pub sig: String, // hex de la signature Ed25519
}

impl PeerInfo {
    /// Message canonique signe : tout sauf la signature.
    fn signed_bytes(&self) -> Vec<u8> {
        format!("{}|{}|{}|{}", self.node_id, self.slug, self.addr, self.heartbeat).into_bytes()
    }

    /// Signe ce record avec la cle privee du noeud (met a jour `sig`).
    pub fn sign(&mut self, key: &SigningKey) {
        let sig = key.sign(&self.signed_bytes());
        self.sig = to_hex(&sig.to_bytes());
    }

    /// Verifie que la signature correspond bien a la cle publique (node_id) et
    /// aux champs. `verify_strict` rejette les formes non canoniques / d'ordre
    /// faible. Retourne false a la moindre anomalie (parse, cle, signature).
    pub fn verify(&self) -> bool {
        let Some(pk) = from_hex(&self.node_id).and_then(|v| <[u8; 32]>::try_from(v).ok()) else {
            return false;
        };
        let Ok(vk) = VerifyingKey::from_bytes(&pk) else {
            return false;
        };
        let Some(sigb) = from_hex(&self.sig).and_then(|v| <[u8; 64]>::try_from(v).ok()) else {
            return false;
        };
        let sig = Signature::from_bytes(&sigb);
        vk.verify_strict(&self.signed_bytes(), &sig).is_ok()
    }

    pub fn encode(&self) -> String {
        format!("{}|{}|{}|{}|{}", self.node_id, self.slug, self.addr, self.heartbeat, self.sig)
    }

    pub fn decode(line: &str) -> Option<PeerInfo> {
        // splitn(5) : seul `sig` (dernier) pourrait contenir '|', mais c'est de
        // l'hex donc non. Les autres champs ne contiennent jamais '|'.
        let mut it = line.splitn(5, '|');
        let node_id = it.next()?.to_string();
        let slug = it.next()?.to_string();
        let addr = it.next()?.to_string();
        let heartbeat = it.next()?.parse().ok()?;
        let sig = it.next()?.to_string();
        if node_id.is_empty() || slug.is_empty() || addr.is_empty() || sig.is_empty() {
            return None;
        }
        Some(PeerInfo { node_id, slug, addr, heartbeat, sig })
    }
}

// --- hex fait maison (zero dependance) ---

pub fn to_hex(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 0x0f) as usize] as char);
    }
    s
}

pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    let b = s.as_bytes();
    (0..b.len())
        .step_by(2)
        .map(|i| {
            let hi = (b[i] as char).to_digit(16)?;
            let lo = (b[i + 1] as char).to_digit(16)?;
            Some((hi * 16 + lo) as u8)
        })
        .collect()
}

const MAGIC: &str = "NDX1";

/// Serialise un message gossip : magic, expediteur, puis pairs connus.
pub fn encode_gossip(from: &PeerInfo, peers: &[PeerInfo]) -> Vec<u8> {
    let mut s = String::with_capacity(256 + peers.len() * 256);
    s.push_str(MAGIC);
    s.push('\n');
    s.push_str(&from.encode());
    for p in peers {
        s.push('\n');
        s.push_str(&p.encode());
    }
    s.into_bytes()
}

/// Parse un message gossip. Retourne (expediteur, pairs connus).
/// La VERIFICATION des signatures se fait a la fusion (cf. node::merge).
pub fn decode_gossip(bytes: &[u8]) -> Option<(PeerInfo, Vec<PeerInfo>)> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut lines = text.lines();
    if lines.next()? != MAGIC {
        return None;
    }
    let from = PeerInfo::decode(lines.next()?)?;
    let peers = lines.filter_map(PeerInfo::decode).collect();
    Some((from, peers))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_for(tag: u8) -> SigningKey {
        let mut seed = [tag; 32];
        seed[1] = 0xA5;
        SigningKey::from_bytes(&seed)
    }

    fn signed_peer(key: &SigningKey, slug: &str, hb: u64) -> PeerInfo {
        let node_id = to_hex(&key.verifying_key().to_bytes());
        let mut p = PeerInfo { node_id, slug: slug.into(), addr: "127.0.0.1:1".into(), heartbeat: hb, sig: String::new() };
        p.sign(key);
        p
    }

    #[test]
    fn hex_round_trip() {
        let b = [0u8, 1, 15, 16, 255, 128];
        assert_eq!(from_hex(&to_hex(&b)).unwrap(), b);
        assert!(from_hex("zz").is_none());
        assert!(from_hex("abc").is_none()); // longueur impaire
    }

    #[test]
    fn signature_valid() {
        let p = signed_peer(&key_for(1), "alice", 10);
        assert!(p.verify());
    }

    #[test]
    fn signature_rejects_tampering() {
        let mut p = signed_peer(&key_for(2), "bob", 10);
        p.addr = "6.6.6.6:1".into(); // alteration apres signature
        assert!(!p.verify(), "un record altere doit etre rejete");
        let mut p2 = signed_peer(&key_for(2), "bob", 10);
        p2.heartbeat = 9999; // rejeu/gonflage d'horodatage
        assert!(!p2.verify());
    }

    #[test]
    fn signature_rejects_wrong_key() {
        // node_id d'une cle, signature d'une autre → invalide
        let mut p = signed_peer(&key_for(3), "carol", 5);
        p.node_id = to_hex(&key_for(4).verifying_key().to_bytes());
        assert!(!p.verify());
    }

    #[test]
    fn gossip_round_trip() {
        let from = signed_peer(&key_for(5), "alice", 42);
        let peers = vec![signed_peer(&key_for(6), "bob", 41)];
        let (f, p) = decode_gossip(&encode_gossip(&from, &peers)).expect("doit parser");
        assert_eq!(f, from);
        assert_eq!(p, peers);
        assert!(f.verify() && p[0].verify());
    }
}
