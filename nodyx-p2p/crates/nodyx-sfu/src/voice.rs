//! # VoiceService — couche métier du vocal (au-dessus de [`MediaEngine`])
//!
//! Séparation hexagonale (ports & adapters), en trois étages :
//!
//! ```text
//! VoiceService   ← règles Nodyx : salons, sièges, permissions, kick,
//!      │           bascule hybride mesh↔SFU, orchestration fédération.
//!      ▼           Ne connaît du média QUE le trait.
//! MediaEngine    ← le port : transport pur (create_room/transport/produce…).
//!      ▼
//! MediasoupEngine ← l'adaptateur : l'impl technique, isolée.
//! ```
//!
//! Le but : les règles fonctionnelles de Nodyx ne se retrouvent **jamais**
//! noyées dans du code spécifique à mediasoup. Le jour du swap vers un moteur
//! Rust natif, `VoiceService` ne bouge pas d'une ligne — on ne réécrit que
//! l'adaptateur du trait. Cf `SPECS/NODYX_SFU_CDC.md` §18.
//!
//! **Hypothèse de ce premier incrément** : les opérations sur un salon donné
//! sont sérialisées par l'appelant (la couche signaling traite les events d'un
//! salon sur une seule tâche). Un verrou async par salon pour la vraie
//! concurrence est un durcissement P1. On ne tient donc **jamais** le `Mutex`
//! std à travers un `.await` (plan sous verrou → travail moteur hors verrou →
//! commit sous verrou).

use crate::{
    MediaEngine, MediaError, ParticipantId, RoomId, RouterHandle, TransportHandle,
};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, MutexGuard};

// ── Mode & configuration ────────────────────────────────────────────────────

/// Mode de distribution d'un salon : maillage P2P direct, ou SFU centralisé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// ≤ seuil et pas de partage d'écran : chaque pair parle à chaque pair.
    Mesh,
    /// > seuil ou partage d'écran : chacun envoie UN flux au SFU qui redistribue.
    Sfu,
}

/// Règles de dimensionnement d'un salon vocal.
#[derive(Debug, Clone, Copy)]
pub struct VoiceConfig {
    /// Sièges max (miroir de `VOICE_MAX_SEATS`). Au-delà : [`VoiceError::RoomFull`].
    pub max_seats: usize,
    /// Bascule vers SFU quand `participants > mesh_threshold` (cf CDC §4, défaut 4).
    pub mesh_threshold: usize,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self { max_seats: 20, mesh_threshold: 4 }
    }
}

/// Décision pure : quel mode pour ce salon, sans effet de bord.
///
/// Isolée et testable seule — c'est LE cœur de la règle hybride, on veut la
/// prouver sans toucher au moteur.
pub fn desired_mode(participants: usize, screensharing: bool, cfg: &VoiceConfig) -> Mode {
    if screensharing || participants > cfg.mesh_threshold {
        Mode::Sfu
    } else {
        Mode::Mesh
    }
}

// ── Erreurs métier ──────────────────────────────────────────────────────────

/// Erreur de la couche métier vocal (distincte de [`MediaError`] du moteur).
#[derive(Debug, PartialEq, Eq)]
pub enum VoiceError {
    /// Salon plein (sièges épuisés).
    RoomFull,
    /// Ce participant est déjà dans le salon.
    AlreadyJoined,
    /// Salon inconnu, ou participant absent du salon.
    NotInRoom,
    /// Le moteur média a échoué (remonté tel quel pour diagnostic).
    Engine(MediaError),
}

impl fmt::Display for VoiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VoiceError::RoomFull => f.write_str("salon plein"),
            VoiceError::AlreadyJoined => f.write_str("déjà présent dans le salon"),
            VoiceError::NotInRoom => f.write_str("absent du salon"),
            VoiceError::Engine(e) => write!(f, "moteur média : {e}"),
        }
    }
}

impl std::error::Error for VoiceError {}

impl From<MediaError> for VoiceError {
    fn from(e: MediaError) -> Self {
        VoiceError::Engine(e)
    }
}

// ── Ce que la couche signaling reçoit après un join ─────────────────────────

/// Résultat d'un `join` : ce que le signaling doit annoncer au client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinOutcome {
    /// Mode effectif du salon (le client sait s'il monte une PC mesh ou SFU).
    pub mode: Mode,
    /// Transport SFU à utiliser (présent seulement en mode SFU).
    pub transport: Option<TransportHandle>,
}

// ── État interne ────────────────────────────────────────────────────────────

#[derive(Default)]
struct Participant {
    /// Transport SFU du participant (absent tant qu'on est en mesh).
    transport: Option<TransportHandle>,
}

#[derive(Default)]
struct RoomState {
    participants: HashMap<ParticipantId, Participant>,
    screensharing: bool,
    /// Router du moteur : présent ⇔ le salon est passé en SFU (et y reste, cf §4).
    router: Option<RouterHandle>,
}

// ── Le service ──────────────────────────────────────────────────────────────

/// Orchestrateur métier du vocal. Générique sur le moteur : `VoiceService<NullEngine>`
/// pour tester l'orchestration sans média, `VoiceService<MediasoupEngine>` en prod.
pub struct VoiceService<E: MediaEngine> {
    engine: E,
    cfg: VoiceConfig,
    rooms: Mutex<HashMap<RoomId, RoomState>>,
}

impl<E: MediaEngine> VoiceService<E> {
    pub fn new(engine: E, cfg: VoiceConfig) -> Self {
        Self { engine, cfg, rooms: Mutex::new(HashMap::new()) }
    }

    /// Avec la configuration par défaut.
    pub fn with_defaults(engine: E) -> Self {
        Self::new(engine, VoiceConfig::default())
    }

    fn rooms(&self) -> MutexGuard<'_, HashMap<RoomId, RoomState>> {
        self.rooms.lock().expect("verrou état vocal empoisonné")
    }

    /// Mode effectif d'un salon (`None` si le salon n'existe pas / est vide).
    pub fn mode(&self, room: &RoomId) -> Option<Mode> {
        self.rooms().get(room).map(|s| {
            if s.router.is_some() { Mode::Sfu } else { Mode::Mesh }
        })
    }

    /// Nombre de participants d'un salon.
    pub fn participant_count(&self, room: &RoomId) -> usize {
        self.rooms().get(room).map_or(0, |s| s.participants.len())
    }

    /// Un participant rejoint un salon. Applique les règles (siège, doublon),
    /// décide mesh/SFU, et — si SFU — provisionne routeur + transport via le moteur.
    pub async fn join(
        &self,
        room: RoomId,
        participant: ParticipantId,
    ) -> Result<JoinOutcome, VoiceError> {
        // ── plan (sous verrou) : valider, réserver le siège, décider le mode ──
        let (sfu, need_router, existing_router) = {
            let mut rooms = self.rooms();
            let state = rooms.entry(room.clone()).or_default();
            if state.participants.contains_key(&participant) {
                return Err(VoiceError::AlreadyJoined);
            }
            if state.participants.len() >= self.cfg.max_seats {
                return Err(VoiceError::RoomFull);
            }
            state.participants.insert(participant.clone(), Participant::default());
            // Une fois SFU, on y reste (CDC §4) : router présent ⇒ SFU imposé.
            let desired = desired_mode(state.participants.len(), state.screensharing, &self.cfg);
            let sfu = desired == Mode::Sfu || state.router.is_some();
            let need_router = sfu && state.router.is_none();
            (sfu, need_router, state.router.clone())
        };

        // ── apply (hors verrou) : travail moteur (async) ──
        let mut transport = None;
        let mut created_router = None;
        if sfu {
            let router = if need_router {
                let r = self.engine.create_room(room.clone()).await?;
                created_router = Some(r.clone());
                r
            } else {
                existing_router.expect("router SFU présent quand need_router=false")
            };
            transport = Some(self.engine.create_transport(&router, participant.clone()).await?);
        }

        // ── commit (sous verrou) : figer routeur + transport ──
        {
            let mut rooms = self.rooms();
            let state = rooms.entry(room).or_default();
            if let Some(r) = created_router {
                if state.router.is_none() {
                    state.router = Some(r);
                }
            }
            if let Some(p) = state.participants.get_mut(&participant) {
                p.transport = transport.clone();
            }
        }

        Ok(JoinOutcome {
            mode: if sfu { Mode::Sfu } else { Mode::Mesh },
            transport,
        })
    }

    /// Un partage d'écran démarre/s'arrête. Le démarrage force le mode SFU
    /// (quel que soit N) et provisionne le routeur si besoin. L'arrêt ne
    /// rebascule PAS vers mesh en v1 (on reste en SFU, cf §4).
    pub async fn set_screenshare(&self, room: RoomId, on: bool) -> Result<Mode, VoiceError> {
        let need_router = {
            let mut rooms = self.rooms();
            let Some(state) = rooms.get_mut(&room) else {
                return Err(VoiceError::NotInRoom);
            };
            state.screensharing = on;
            let desired = desired_mode(state.participants.len(), state.screensharing, &self.cfg);
            (desired == Mode::Sfu) && state.router.is_none()
        };

        if need_router {
            let r = self.engine.create_room(room.clone()).await?;
            let mut rooms = self.rooms();
            if let Some(state) = rooms.get_mut(&room) {
                if state.router.is_none() {
                    state.router = Some(r);
                }
            }
        }

        Ok(self.mode(&room).unwrap_or(Mode::Mesh))
    }

    /// Le participant quitte de lui-même.
    pub async fn leave(&self, room: RoomId, participant: ParticipantId) -> Result<(), VoiceError> {
        self.remove(room, participant).await
    }

    /// Un modérateur éjecte un participant. Même mécanique que `leave` (l'intention
    /// et l'audit diffèrent, pas l'effet média). Séparé pour que les permissions
    /// et le logging s'y greffent sans toucher au moteur.
    pub async fn kick(&self, room: RoomId, target: ParticipantId) -> Result<(), VoiceError> {
        self.remove(room, target).await
    }

    async fn remove(&self, room: RoomId, participant: ParticipantId) -> Result<(), VoiceError> {
        let router_to_close = {
            let mut rooms = self.rooms();
            let Some(state) = rooms.get_mut(&room) else {
                return Err(VoiceError::NotInRoom);
            };
            if state.participants.remove(&participant).is_none() {
                return Err(VoiceError::NotInRoom);
            }
            // Dernier parti : on ferme le salon et on libère le routeur moteur.
            if state.participants.is_empty() {
                let router = state.router.take();
                rooms.remove(&room);
                router
            } else {
                None
            }
        };

        if let Some(router) = router_to_close {
            self.engine.close_room(router).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NullEngine;

    /// Exécuteur minimal zéro-dep : les futures de `NullEngine` sont immédiatement
    /// prêtes (elles n'attendent rien), un seul `poll` suffit. Aucun `unsafe`
    /// (`Waker::noop`, stable). Réservé aux tests.
    fn block_on<F: std::future::Future>(fut: F) -> F::Output {
        use std::task::{Context, Poll};
        let waker = std::task::Waker::noop();
        let mut cx = Context::from_waker(waker);
        let mut fut = std::pin::pin!(fut);
        loop {
            if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
                return v;
            }
            std::thread::yield_now();
        }
    }

    fn svc() -> VoiceService<NullEngine> {
        VoiceService::with_defaults(NullEngine::new())
    }

    fn room() -> RoomId {
        RoomId("channel-1".into())
    }

    fn p(n: u32) -> ParticipantId {
        ParticipantId(format!("user-{n}"))
    }

    // ── règle pure ──────────────────────────────────────────────────────────

    #[test]
    fn desired_mode_follows_threshold_and_screenshare() {
        let cfg = VoiceConfig::default(); // seuil 4
        assert_eq!(desired_mode(1, false, &cfg), Mode::Mesh);
        assert_eq!(desired_mode(4, false, &cfg), Mode::Mesh); // à 4 encore mesh
        assert_eq!(desired_mode(5, false, &cfg), Mode::Sfu); // >4 → SFU
        assert_eq!(desired_mode(2, true, &cfg), Mode::Sfu); // screenshare force SFU
    }

    // ── orchestration (contre NullEngine) ─────────────────────────────────────

    #[test]
    fn small_room_stays_mesh_without_transport() {
        let s = svc();
        let out = block_on(s.join(room(), p(1))).unwrap();
        assert_eq!(out.mode, Mode::Mesh);
        assert!(out.transport.is_none());
        assert_eq!(s.mode(&room()), Some(Mode::Mesh));
        assert_eq!(s.participant_count(&room()), 1);
    }

    #[test]
    fn crossing_threshold_switches_to_sfu_with_transport() {
        let s = svc();
        for i in 1..=4 {
            let out = block_on(s.join(room(), p(i))).unwrap();
            assert_eq!(out.mode, Mode::Mesh, "à {i} on est encore en mesh");
        }
        // le 5e franchit le seuil
        let out = block_on(s.join(room(), p(5))).unwrap();
        assert_eq!(out.mode, Mode::Sfu);
        assert!(out.transport.is_some());
        assert_eq!(s.mode(&room()), Some(Mode::Sfu));
    }

    #[test]
    fn screenshare_forces_sfu_even_with_few_people() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        assert_eq!(s.mode(&room()), Some(Mode::Mesh));
        let mode = block_on(s.set_screenshare(room(), true)).unwrap();
        assert_eq!(mode, Mode::Sfu);
        // un nouvel arrivant dans un salon déjà SFU obtient un transport
        let out = block_on(s.join(room(), p(3))).unwrap();
        assert_eq!(out.mode, Mode::Sfu);
        assert!(out.transport.is_some());
    }

    #[test]
    fn stays_in_sfu_after_screenshare_stops() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.set_screenshare(room(), true)).unwrap();
        assert_eq!(s.mode(&room()), Some(Mode::Sfu));
        // arrêt du partage : on NE rebascule PAS (v1)
        let mode = block_on(s.set_screenshare(room(), false)).unwrap();
        assert_eq!(mode, Mode::Sfu);
    }

    #[test]
    fn room_full_is_rejected() {
        let s = VoiceService::new(NullEngine::new(), VoiceConfig { max_seats: 2, mesh_threshold: 4 });
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        assert_eq!(block_on(s.join(room(), p(3))), Err(VoiceError::RoomFull));
    }

    #[test]
    fn double_join_is_rejected() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        assert_eq!(block_on(s.join(room(), p(1))), Err(VoiceError::AlreadyJoined));
    }

    #[test]
    fn leave_frees_seat_and_closes_empty_room() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.leave(room(), p(1))).unwrap();
        assert_eq!(s.participant_count(&room()), 0);
        assert_eq!(s.mode(&room()), None); // salon fermé
    }

    #[test]
    fn leave_absent_participant_errors() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        assert_eq!(block_on(s.leave(room(), p(9))), Err(VoiceError::NotInRoom));
        assert_eq!(block_on(s.leave(RoomId("nope".into()), p(1))), Err(VoiceError::NotInRoom));
    }

    #[test]
    fn kick_removes_target() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        block_on(s.kick(room(), p(2))).unwrap();
        assert_eq!(s.participant_count(&room()), 1);
    }
}
