//! Spike Phase A (`SPECS/NODYX_MEDIA_ENGINE_RUST.md`) : str0m derrière
//! `nodyx_sfu::MediaEngine`. Hors workspace (cf. `Cargo.toml` racine
//! `nodyx-p2p`) : dépendance crypto (aws-lc-rs) qui tire cmake/clang,
//! aucune raison d'imposer ça à chaque build de `nodyx-server`/`nodyx-gossip`.
//!
//! Deux binaires, volontairement séparés (cf. plan de session) :
//! - `nat-probe` : répond SEUL à « str0m perce-t-il le NAT ? », zéro
//!   dépendance à `nodyx-sfu`, pour isoler la question réseau de
//!   l'intégration hexagonale.
//! - `trait-spike` : preuve « derrière le trait », a minima (audio seul).

pub mod engine;
pub mod measure;
pub mod stun;
