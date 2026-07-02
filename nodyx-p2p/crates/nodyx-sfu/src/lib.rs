//! # nodyx-sfu — abstraction moteur média
//!
//! Brique média scalable du réseau Nodyx (vocal + partage d'écran). Ce crate
//! définit **l'abstraction** : le `trait MediaEngine` et les types du domaine.
//! Le moteur CONCRET (d'abord `mediasoup`, puis un moteur Rust natif) s'implémente
//! DERRIÈRE ce trait, dans un module dédié portant ses propres dépendances.
//!
//! Stratégie « B en anticipant A » (cf `SPECS/NODYX_SFU_CDC.md` §18) : tout le
//! contrôle (signaling, salons, hybride mesh↔SFU, fédération) parle À CE TRAIT,
//! jamais au moteur en direct. Le jour du swap vers un moteur Rust natif, on
//! réécrit l'impl du trait — pas le produit. ~90 % du code ne bouge pas.

#![forbid(unsafe_code)]

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};

mod voice;
pub use voice::{
    desired_mode, JoinOutcome, Mode, PublicationInfo, SfuMigration, VoiceConfig, VoiceError,
    VoiceService,
};

// ── Identifiants du domaine ─────────────────────────────────────────────────
// Newtypes opaques : le contrôle ne suppose RIEN de la forme des ids du moteur.

macro_rules! opaque_id {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(pub String);
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str(&self.0) }
        }
    };
}

opaque_id!(/// Salon (mappé sur un channel Nodyx).
RoomId);
opaque_id!(/// Participant (mappé sur un user Nodyx).
ParticipantId);
opaque_id!(/// Nœud SFU distant (identité Ed25519, pour la fédération).
NodeId);
opaque_id!(/// Handle de Router côté moteur (un par salon).
RouterHandle);
opaque_id!(/// Handle de Transport côté moteur (un par participant).
TransportHandle);
opaque_id!(/// Flux publié par un participant.
ProducerId);
opaque_id!(/// Flux consommé (souscription d'un participant à un Producer).
ConsumerId);
opaque_id!(/// Handle de pipe inter-nœuds (cascade fédérée).
PipeHandle);

// ── Types média ─────────────────────────────────────────────────────────────

/// Nature d'un flux publié.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackKind {
    Audio,
    Screen,
    Cam,
}

/// Couche simulcast/SVC servie à un abonné (spatial = résolution, temporal = fps).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Layer {
    pub spatial: u8,
    pub temporal: u8,
}

impl Layer {
    /// Couche la plus basse (fallback bande passante faible).
    pub const LOWEST: Layer = Layer { spatial: 0, temporal: 0 };
}

/// Portée d'une requête de stats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatsScope {
    Room(RoomId),
    Participant(ParticipantId),
    Producer(ProducerId),
    Consumer(ConsumerId),
}

/// Métriques d'un flux (alimentent l'adaptation + l'UI qualité côté client).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct EngineStats {
    pub bitrate_bps: u32,
    pub packet_loss: f32,
    pub rtt_ms: u32,
    pub jitter_ms: u32,
    pub current_layer: Option<Layer>,
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaError {
    /// Aucun moteur média branché (mode mesh-only, ou moteur non initialisé).
    NoEngine,
    /// Entité introuvable (router/transport/producer déjà fermé…).
    NotFound(String),
    /// Erreur du transport/moteur sous-jacent.
    Engine(String),
    /// Opération non supportée par ce moteur (ex : pipe distant).
    Unsupported(&'static str),
}

impl fmt::Display for MediaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MediaError::NoEngine => f.write_str("aucun moteur média branché"),
            MediaError::NotFound(w) => write!(f, "introuvable : {w}"),
            MediaError::Engine(w) => write!(f, "erreur moteur : {w}"),
            MediaError::Unsupported(w) => write!(f, "non supporté : {w}"),
        }
    }
}

impl std::error::Error for MediaError {}

pub type Result<T> = std::result::Result<T, MediaError>;

// ── Le trait : contrat unique entre le contrôle Rust et le moteur média ─────
// mediasoup l'implémentera (MediasoupEngine) ; un moteur Rust natif plus tard
// (NativeRustEngine) l'implémentera PAREIL. Swap = changer l'injection.
//
// `async fn in trait` (stable 1.75+) : dispatch statique par générique
// (`fn f<E: MediaEngine>(e: &E)`). Le `Box<dyn MediaEngine>` évoqué au CDC
// demandera soit `async-trait`, soit un dispatch par enum — décision au câblage
// du 1er moteur, PAS ici (l'abstraction reste zéro-dépendance).

#[allow(async_fn_in_trait)]
pub trait MediaEngine: Send + Sync {
    /// Crée le Router d'un salon (idempotent côté appelant recommandé).
    async fn create_room(&self, room: RoomId) -> Result<RouterHandle>;
    /// Crée le Transport WebRTC d'un participant dans un salon.
    async fn create_transport(&self, router: &RouterHandle, participant: ParticipantId) -> Result<TransportHandle>;
    /// Le participant publie un flux (audio / écran / cam).
    async fn produce(&self, transport: &TransportHandle, kind: TrackKind) -> Result<ProducerId>;
    /// Le participant souscrit à un flux publié.
    async fn consume(&self, transport: &TransportHandle, producer: &ProducerId) -> Result<ConsumerId>;
    /// Force la couche servie à un abonné (adaptation bande passante).
    async fn set_preferred_layer(&self, consumer: &ConsumerId, layer: Layer) -> Result<()>;
    /// Relaie un flux vers un nœud SFU distant (cascade fédérée, PipeTransport).
    async fn pipe_to_remote(&self, producer: &ProducerId, node: &NodeId) -> Result<PipeHandle>;
    /// Métriques.
    async fn stats(&self, scope: StatsScope) -> Result<EngineStats>;
    /// Ferme le Router d'un salon et libère ses ressources.
    async fn close_room(&self, router: RouterHandle) -> Result<()>;
}

// ── NullEngine : moteur factice ─────────────────────────────────────────────
// Ne fait AUCUN média, mais implémente le trait avec des handles déterministes.
// Sert : (1) à prouver que le trait est implémentable, (2) à tester
// l'orchestration/le signaling SANS mediasoup, (3) de repli "mesh-only".

#[derive(Debug, Default)]
pub struct NullEngine {
    seq: AtomicU64,
}

impl NullEngine {
    pub fn new() -> Self {
        Self { seq: AtomicU64::new(0) }
    }
    fn next(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.seq.fetch_add(1, Ordering::Relaxed))
    }
}

impl MediaEngine for NullEngine {
    async fn create_room(&self, _room: RoomId) -> Result<RouterHandle> {
        Ok(RouterHandle(self.next("router")))
    }
    async fn create_transport(&self, _router: &RouterHandle, _participant: ParticipantId) -> Result<TransportHandle> {
        Ok(TransportHandle(self.next("transport")))
    }
    async fn produce(&self, _transport: &TransportHandle, _kind: TrackKind) -> Result<ProducerId> {
        Ok(ProducerId(self.next("producer")))
    }
    async fn consume(&self, _transport: &TransportHandle, _producer: &ProducerId) -> Result<ConsumerId> {
        Ok(ConsumerId(self.next("consumer")))
    }
    async fn set_preferred_layer(&self, _consumer: &ConsumerId, _layer: Layer) -> Result<()> {
        Ok(())
    }
    async fn pipe_to_remote(&self, _producer: &ProducerId, _node: &NodeId) -> Result<PipeHandle> {
        // Un NullEngine ne fédère pas : on documente la limite plutôt que de mentir.
        Err(MediaError::Unsupported("pipe_to_remote (NullEngine)"))
    }
    async fn stats(&self, _scope: StatsScope) -> Result<EngineStats> {
        Ok(EngineStats::default())
    }
    async fn close_room(&self, _router: RouterHandle) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_opaque_and_displayable() {
        let r = RoomId("channel-42".into());
        assert_eq!(r.to_string(), "channel-42");
        assert_eq!(r, RoomId("channel-42".into()));
        assert_ne!(r, RoomId("channel-99".into()));
    }

    #[test]
    fn layer_lowest_is_zero_zero() {
        assert_eq!(Layer::LOWEST, Layer { spatial: 0, temporal: 0 });
    }

    #[test]
    fn track_kinds_distinct() {
        assert_ne!(TrackKind::Audio, TrackKind::Screen);
        assert_eq!(TrackKind::Cam, TrackKind::Cam);
    }

    #[test]
    fn engine_stats_default_is_empty() {
        let s = EngineStats::default();
        assert_eq!(s.bitrate_bps, 0);
        assert!(s.current_layer.is_none());
    }

    #[test]
    fn media_error_displays() {
        assert_eq!(MediaError::NoEngine.to_string(), "aucun moteur média branché");
        assert_eq!(
            MediaError::NotFound("router".into()).to_string(),
            "introuvable : router"
        );
    }

    #[test]
    fn null_engine_implements_trait() {
        // Compile-check : NullEngine EST un MediaEngine (dispatch statique).
        fn assert_engine<E: MediaEngine>(_e: &E) {}
        let e = NullEngine::new();
        assert_engine(&e);
    }
}
