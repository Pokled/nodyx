//! nodyx-gossip : decouverte de pairs Nodyx par gossip.
//! std + ed25519-dalek (signatures uniquement). Tout le reste est fait maison.
//!
//! Usage :
//!   nodyx-gossip --slug <slug> --port <port> [--bootstrap a,b] [--key-file path]
//!
//! Sans --key-file, une identite ephemere est generee a chaque lancement.
//! Avec, la cle est persistee (creee au premier lancement) : identite stable.

mod node;
mod protocol;

use ed25519_dalek::SigningKey;
use node::Node;

fn gen_seed() -> [u8; 32] {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).expect("CSPRNG indisponible");
    seed
}

/// Charge la cle depuis `path` (32 octets) ou la genere et la persiste.
fn load_or_gen_key(path: Option<&str>) -> SigningKey {
    match path {
        Some(p) => {
            if let Ok(bytes) = std::fs::read(p) {
                if let Ok(seed) = <[u8; 32]>::try_from(bytes.as_slice()) {
                    return SigningKey::from_bytes(&seed);
                }
                eprintln!("avertissement: {p} invalide (taille != 32), regeneration");
            }
            let seed = gen_seed();
            if let Err(e) = std::fs::write(p, seed) {
                eprintln!("avertissement: impossible d'ecrire {p}: {e}");
            }
            SigningKey::from_bytes(&seed)
        }
        None => SigningKey::from_bytes(&gen_seed()),
    }
}

fn main() -> std::io::Result<()> {
    let mut slug: Option<String> = None;
    let mut port: Option<u16> = None;
    let mut bootstrap: Vec<String> = Vec::new();
    let mut key_file: Option<String> = None;

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--slug" => slug = args.next(),
            "--port" => port = args.next().and_then(|p| p.parse().ok()),
            "--key-file" => key_file = args.next(),
            "--bootstrap" => {
                if let Some(v) = args.next() {
                    bootstrap = v.split(',').filter(|s| !s.is_empty()).map(String::from).collect();
                }
            }
            "-h" | "--help" => {
                println!("nodyx-gossip --slug <slug> --port <port> [--bootstrap a,b] [--key-file path]");
                return Ok(());
            }
            other => eprintln!("argument ignore: {other}"),
        }
    }

    let slug = slug.unwrap_or_else(|| {
        eprintln!("erreur: --slug est requis");
        std::process::exit(2);
    });
    let port = port.unwrap_or_else(|| {
        eprintln!("erreur: --port est requis");
        std::process::exit(2);
    });

    let key = load_or_gen_key(key_file.as_deref());
    Node::bind(slug, port, bootstrap, key)?.run()
}
