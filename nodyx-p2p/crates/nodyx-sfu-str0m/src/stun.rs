//! Client STUN maison (RFC 5389, binding request/response minimal).
//!
//! str0m ne fait PAS la découverte STUN elle-même : Sans-IO signifie qu'on
//! possède les sockets, donc c'est à nous d'interroger un serveur STUN et de
//! donner le résultat à `Candidate::server_reflexive`. On interroge
//! `nexus-turn` (déjà en prod, port 3478 par défaut) plutôt qu'un service
//! tiers : le spike reste souverain, zéro dépendance externe.
//!
//! Pas de crate STUN tiers : le binding request/response tient dans ce
//! fichier, entièrement lisible, plutôt que d'ajouter une dépendance de plus
//! à auditer (cf. CDC §8.1, le risque dépendances doit être mesurable).

use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::time::Duration;

/// Cookie magique STUN (RFC 5389 §6), fixe.
const MAGIC_COOKIE: u32 = 0x2112_A442;
/// Type de message : Binding Request.
const BINDING_REQUEST: u16 = 0x0001;
/// Type de message : Binding Success Response.
const BINDING_SUCCESS_RESPONSE: u16 = 0x0101;
/// Attribut XOR-MAPPED-ADDRESS (RFC 5389 §15.2).
const ATTR_XOR_MAPPED_ADDRESS: u16 = 0x0020;
/// Attribut MAPPED-ADDRESS (RFC 3489, legacy — replis si le serveur ne parle
/// que l'ancien format).
const ATTR_MAPPED_ADDRESS: u16 = 0x0001;
/// Famille IPv4 dans les attributs d'adresse STUN.
const FAMILY_IPV4: u8 = 0x01;

#[derive(Debug)]
pub enum StunError {
    Io(io::Error),
    Timeout,
    BadResponse(String),
    Ipv6NotSupported,
}

impl std::fmt::Display for StunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StunError::Io(e) => write!(f, "E/S : {e}"),
            StunError::Timeout => write!(f, "le serveur STUN n'a pas répondu à temps"),
            StunError::BadResponse(s) => write!(f, "réponse STUN invalide : {s}"),
            StunError::Ipv6NotSupported => write!(f, "adresse IPv6 non gérée par ce client STUN minimal"),
        }
    }
}

impl std::error::Error for StunError {}

impl From<io::Error> for StunError {
    fn from(e: io::Error) -> Self {
        StunError::Io(e)
    }
}

/// Transaction ID STUN : 12 octets, doit être imprévisible (RFC 5389 §7.2.1
/// recommande une source aléatoire de qualité cryptographique pour éviter le
/// cache poisoning d'un attaquant qui devinerait la transaction).
fn random_transaction_id() -> [u8; 12] {
    use rand::RngCore;
    let mut id = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut id);
    id
}

fn build_binding_request(txid: &[u8; 12]) -> [u8; 20] {
    let mut msg = [0u8; 20];
    msg[0..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    msg[2..4].copy_from_slice(&0u16.to_be_bytes()); // longueur du corps : aucun attribut
    msg[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
    msg[8..20].copy_from_slice(txid);
    msg
}

/// Décode l'adresse XOR-MAPPED-ADDRESS (ou MAPPED-ADDRESS en repli) d'une
/// réponse STUN. Ne gère que IPv4 : suffisant pour ce spike (le CDC teste des
/// box résidentielles FTTH/4G, toutes IPv4 en pratique côté grand public).
fn parse_binding_response(buf: &[u8], expected_txid: &[u8; 12]) -> Result<SocketAddr, StunError> {
    if buf.len() < 20 {
        return Err(StunError::BadResponse("trop court pour un en-tête STUN".into()));
    }

    let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
    if msg_type != BINDING_SUCCESS_RESPONSE {
        return Err(StunError::BadResponse(format!(
            "type de message inattendu : 0x{msg_type:04x}"
        )));
    }

    let body_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
    let magic = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);
    if magic != MAGIC_COOKIE {
        return Err(StunError::BadResponse("cookie magique incorrect".into()));
    }
    if &buf[8..20] != expected_txid {
        return Err(StunError::BadResponse(
            "transaction ID ne correspond pas (réponse tardive ou usurpée)".into(),
        ));
    }
    if buf.len() < 20 + body_len {
        return Err(StunError::BadResponse("corps tronqué".into()));
    }

    // Parcours des attributs TLV (RFC 5389 §15), chacun aligné sur 4 octets.
    let mut i = 20;
    let end = 20 + body_len;
    let mut xor_mapped: Option<SocketAddr> = None;
    let mut mapped_legacy: Option<SocketAddr> = None;

    while i + 4 <= end {
        let attr_type = u16::from_be_bytes([buf[i], buf[i + 1]]);
        let attr_len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        let val_start = i + 4;
        let val_end = val_start + attr_len;
        if val_end > buf.len() {
            break;
        }
        let val = &buf[val_start..val_end];

        if attr_type == ATTR_XOR_MAPPED_ADDRESS && val.len() >= 8 {
            let family = val[1];
            if family == FAMILY_IPV4 {
                let xport = u16::from_be_bytes([val[2], val[3]]) ^ ((MAGIC_COOKIE >> 16) as u16);
                let xaddr = u32::from_be_bytes([val[4], val[5], val[6], val[7]]) ^ MAGIC_COOKIE;
                let ip = Ipv4Addr::from(xaddr);
                xor_mapped = Some(SocketAddr::V4(SocketAddrV4::new(ip, xport)));
            }
        } else if attr_type == ATTR_MAPPED_ADDRESS && val.len() >= 8 {
            let family = val[1];
            if family == FAMILY_IPV4 {
                let port = u16::from_be_bytes([val[2], val[3]]);
                let ip = Ipv4Addr::new(val[4], val[5], val[6], val[7]);
                mapped_legacy = Some(SocketAddr::V4(SocketAddrV4::new(ip, port)));
            }
        }

        // Chaque attribut est aligné sur 4 octets (padding).
        let padded_len = (attr_len + 3) & !3;
        i = val_start + padded_len;
    }

    xor_mapped
        .or(mapped_legacy)
        .ok_or_else(|| StunError::BadResponse("aucune adresse mappée dans la réponse".into()))
}

/// Interroge un serveur STUN sur le socket UDP déjà lié, renvoie l'adresse
/// server-reflexive vue de l'extérieur. Le socket garde son port local après
/// l'appel : c'est EXACTEMENT ce port qu'on annoncera comme candidat host, et
/// c'est via ce même mapping NAT que le srflx doit rester joignable ensuite.
pub fn discover_reflexive_addr(
    socket: &UdpSocket,
    stun_server: SocketAddr,
    timeout: Duration,
) -> Result<SocketAddr, StunError> {
    if !stun_server.is_ipv4() {
        return Err(StunError::Ipv6NotSupported);
    }

    let txid = random_transaction_id();
    let request = build_binding_request(&txid);

    socket.set_read_timeout(Some(timeout))?;
    socket.send_to(&request, stun_server)?;

    let mut buf = [0u8; 512];
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let (n, from) = match socket.recv_from(&mut buf) {
            Ok(v) => v,
            Err(e) if e.kind() == io::ErrorKind::WouldBlock || e.kind() == io::ErrorKind::TimedOut => {
                return Err(StunError::Timeout)
            }
            Err(e) => return Err(StunError::Io(e)),
        };
        if from != stun_server {
            // Paquet parasite d'une autre source (peu probable sur un socket
            // dédié) : on l'ignore et on réattend, sans dépasser le délai total.
            if std::time::Instant::now() >= deadline {
                return Err(StunError::Timeout);
            }
            continue;
        }
        return parse_binding_response(&buf[..n], &txid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_request_has_correct_header() {
        let txid = [7u8; 12];
        let req = build_binding_request(&txid);
        assert_eq!(u16::from_be_bytes([req[0], req[1]]), BINDING_REQUEST);
        assert_eq!(u16::from_be_bytes([req[2], req[3]]), 0);
        assert_eq!(u32::from_be_bytes([req[4], req[5], req[6], req[7]]), MAGIC_COOKIE);
        assert_eq!(&req[8..20], &txid);
    }

    /// Construit une réponse XOR-MAPPED-ADDRESS synthétique et vérifie
    /// qu'on la décode vers la bonne adresse. Le vrai perçage NAT ne se
    /// prouve QUE sur le terrain (cf. plan), mais le décodage du protocole,
    /// lui, doit être prouvé ici, sans dépendre d'un serveur réel.
    #[test]
    fn parses_xor_mapped_address_roundtrip() {
        let txid = random_transaction_id();
        let ip = Ipv4Addr::new(82, 65, 12, 34);
        let port: u16 = 51000;

        let xport = port ^ ((MAGIC_COOKIE >> 16) as u16);
        let xaddr = u32::from_be_bytes(ip.octets()) ^ MAGIC_COOKIE;

        let mut attr_val = vec![0u8, FAMILY_IPV4];
        attr_val.extend_from_slice(&xport.to_be_bytes());
        attr_val.extend_from_slice(&xaddr.to_be_bytes());

        let mut msg = Vec::new();
        msg.extend_from_slice(&BINDING_SUCCESS_RESPONSE.to_be_bytes());
        msg.extend_from_slice(&(attr_val.len() as u16 + 4).to_be_bytes());
        msg.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        msg.extend_from_slice(&txid);
        msg.extend_from_slice(&ATTR_XOR_MAPPED_ADDRESS.to_be_bytes());
        msg.extend_from_slice(&(attr_val.len() as u16).to_be_bytes());
        msg.extend_from_slice(&attr_val);

        let addr = parse_binding_response(&msg, &txid).expect("decode ok");
        assert_eq!(addr, SocketAddr::V4(SocketAddrV4::new(ip, port)));
    }

    #[test]
    fn rejects_mismatched_transaction_id() {
        let txid = [1u8; 12];
        let other_txid = [2u8; 12];
        let mut msg = Vec::new();
        msg.extend_from_slice(&BINDING_SUCCESS_RESPONSE.to_be_bytes());
        msg.extend_from_slice(&0u16.to_be_bytes());
        msg.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        msg.extend_from_slice(&other_txid);

        let err = parse_binding_response(&msg, &txid).unwrap_err();
        assert!(matches!(err, StunError::BadResponse(_)));
    }

    #[test]
    fn rejects_bad_magic_cookie() {
        let txid = [3u8; 12];
        let mut msg = Vec::new();
        msg.extend_from_slice(&BINDING_SUCCESS_RESPONSE.to_be_bytes());
        msg.extend_from_slice(&0u16.to_be_bytes());
        msg.extend_from_slice(&0xDEADBEEFu32.to_be_bytes());
        msg.extend_from_slice(&txid);

        let err = parse_binding_response(&msg, &txid).unwrap_err();
        assert!(matches!(err, StunError::BadResponse(_)));
    }
}
