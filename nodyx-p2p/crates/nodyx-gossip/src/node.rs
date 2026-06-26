//! Noeud de decouverte par gossip. std + ed25519-dalek (signatures).
//!
//! Anti-entropie epidemique : a chaque tour, le noeud envoie "voici qui je suis
//! et tous ceux que je connais" a quelques pairs au hasard. L'info se propage
//! sans aucun serveur central. Les noeuds qui ne se rafraichissent plus
//! vieillissent et disparaissent (auto-guerison).
//!
//! Chaque record est SIGNE par la cle du noeud : on ne fusionne que ce qui est
//! authentique. node_id = cle publique Ed25519.

use crate::protocol::{decode_gossip, encode_gossip, to_hex, PeerInfo};
use ed25519_dalek::SigningKey;
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const GOSSIP_INTERVAL: Duration = Duration::from_secs(2);
const PEER_TTL_SECS: u64 = 15; // un noeud non rafraichi depuis 15s est considere mort
const FANOUT: usize = 3; // nombre de pairs contactes a chaque tour

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

/// PRNG minimal (xorshift64). Fait maison, pas de crate `rand` (non crypto :
/// sert uniquement a choisir des cibles de gossip au hasard).
fn xorshift(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

fn shuffle(v: &mut [String], rng: &mut u64) {
    for i in (1..v.len()).rev() {
        let j = (xorshift(rng) as usize) % (i + 1);
        v.swap(i, j);
    }
}

/// Fusionne des pairs entrants dans la table locale. On ignore soi-meme, on
/// REJETTE tout record dont la signature est invalide, et on ne garde que
/// l'info la plus fraiche pour chaque noeud.
fn merge(table: &mut HashMap<String, PeerInfo>, me_id: &str, incoming: impl Iterator<Item = PeerInfo>) {
    for p in incoming {
        if p.node_id == me_id {
            continue;
        }
        if !p.verify() {
            continue; // record falsifie ou non signe : on jette
        }
        match table.get(&p.node_id) {
            Some(existing) if existing.heartbeat >= p.heartbeat => {}
            _ => {
                table.insert(p.node_id.clone(), p);
            }
        }
    }
}

pub struct Node {
    me: PeerInfo,
    signing_key: SigningKey,
    peers: Arc<Mutex<HashMap<String, PeerInfo>>>,
    socket: UdpSocket,
    bootstrap: Vec<String>,
}

impl Node {
    pub fn bind(slug: String, port: u16, bootstrap: Vec<String>, signing_key: SigningKey) -> std::io::Result<Self> {
        let socket = UdpSocket::bind(("0.0.0.0", port))?;
        let slug: String = slug.chars().filter(|c| *c != '|' && *c != '\n' && *c != '\r').collect();
        let node_id = to_hex(&signing_key.verifying_key().to_bytes());
        let mut me = PeerInfo {
            node_id,
            slug,
            addr: format!("127.0.0.1:{port}"),
            heartbeat: now_secs(),
            sig: String::new(),
        };
        me.sign(&signing_key);
        Ok(Self {
            me,
            signing_key,
            peers: Arc::new(Mutex::new(HashMap::new())),
            socket,
            bootstrap,
        })
    }

    pub fn run(mut self) -> std::io::Result<()> {
        println!(
            "[{}] noeud {} demarre sur {} ({} bootstrap)",
            self.me.slug,
            &self.me.node_id[..8],
            self.me.addr,
            self.bootstrap.len()
        );

        // Fil de reception : fusionne (et verifie) tout ce qu'on recoit.
        let rx_socket = self.socket.try_clone()?;
        let rx_peers = self.peers.clone();
        let rx_me = self.me.node_id.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let Ok((n, _from)) = rx_socket.recv_from(&mut buf) else {
                    continue;
                };
                if let Some((from, incoming)) = decode_gossip(&buf[..n]) {
                    if let Ok(mut table) = rx_peers.lock() {
                        merge(&mut table, &rx_me, std::iter::once(from).chain(incoming));
                    }
                }
            }
        });

        // Fil d'emission : prune les morts, re-signe mon record frais, gossipe.
        let mut rng = now_secs().wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        loop {
            std::thread::sleep(GOSSIP_INTERVAL);

            let snapshot: Vec<PeerInfo> = {
                let mut table = self.peers.lock().unwrap();
                let cutoff = now_secs().saturating_sub(PEER_TTL_SECS);
                table.retain(|_, p| p.heartbeat >= cutoff);
                table.values().cloned().collect()
            };

            self.me.heartbeat = now_secs();
            self.me.sign(&self.signing_key);
            let bytes = encode_gossip(&self.me, &snapshot);

            // Cibles : bootstrap + pairs connus, tirage au hasard, FANOUT max.
            let mut targets: Vec<String> = self.bootstrap.clone();
            targets.extend(snapshot.iter().map(|p| p.addr.clone()));
            shuffle(&mut targets, &mut rng);
            for addr in targets.iter().take(FANOUT) {
                let _ = self.socket.send_to(&bytes, addr.as_str());
            }

            let list: Vec<String> = snapshot.iter().map(|p| format!("{}@{}", p.slug, p.addr)).collect();
            println!("[{}] connait {} pair(s): {}", self.me.slug, snapshot.len(), list.join(", "));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signed(tag: u8, slug: &str, hb: u64) -> PeerInfo {
        let key = SigningKey::from_bytes(&[tag; 32]);
        let node_id = to_hex(&key.verifying_key().to_bytes());
        let mut p = PeerInfo { node_id, slug: slug.into(), addr: "127.0.0.1:1".into(), heartbeat: hb, sig: String::new() };
        p.sign(&key);
        p
    }

    #[test]
    fn merge_ignore_self() {
        let me = signed(1, "me", 10);
        let mut t = HashMap::new();
        merge(&mut t, &me.node_id, std::iter::once(me.clone()));
        assert!(t.is_empty(), "un noeud ne doit jamais s'ajouter lui-meme");
    }

    #[test]
    fn merge_rejects_unsigned_or_forged() {
        let mut t = HashMap::new();
        // record sans signature valide
        let bad = PeerInfo { node_id: "deadbeef".into(), slug: "x".into(), addr: "1:1".into(), heartbeat: 1, sig: "00".into() };
        merge(&mut t, "me", std::iter::once(bad));
        assert!(t.is_empty(), "un record non signe doit etre rejete");
        // record signe puis falsifie
        let mut forged = signed(7, "evil", 5);
        forged.addr = "6.6.6.6:1".into();
        merge(&mut t, "me", std::iter::once(forged));
        assert!(t.is_empty(), "un record falsifie doit etre rejete");
    }

    #[test]
    fn merge_keeps_freshest() {
        let mut t = HashMap::new();
        merge(&mut t, "me", std::iter::once(signed(9, "a", 10)));
        merge(&mut t, "me", std::iter::once(signed(9, "a", 5))); // plus vieux -> ignore
        let id = signed(9, "a", 0).node_id;
        assert_eq!(t.get(&id).unwrap().heartbeat, 10);
        merge(&mut t, "me", std::iter::once(signed(9, "a", 20))); // plus frais -> remplace
        assert_eq!(t.get(&id).unwrap().heartbeat, 20);
    }

    #[test]
    fn merge_adds_distinct_peers() {
        let mut t = HashMap::new();
        merge(&mut t, "me", vec![signed(11, "a", 1), signed(12, "b", 1)].into_iter());
        assert_eq!(t.len(), 2);
    }
}
