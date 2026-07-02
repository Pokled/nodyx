//! # VoiceService — couche métier du vocal (au-dessus de [`MediaEngine`])
//!
//! Séparation hexagonale (ports & adapters), en trois étages :
//!
//! ```text
//! VoiceService   ← règles Nodyx : salons, sièges, permissions, kick,
//!      │           publish/subscribe, bascule hybride mesh↔SFU, fédération.
//!      ▼           Ne connaît du média QUE le trait.
//! MediaEngine    ← le port : transport pur (create_room/transport/produce…).
//!      ▼
//! MediasoupEngine ← l'adaptateur : l'impl technique, isolée.
//! ```
//!
//! Le but : les règles fonctionnelles de Nodyx ne se retrouvent **jamais**
//! noyées dans du code spécifique à mediasoup. Le jour du swap vers un moteur
//! Rust natif, `VoiceService` ne bouge pas d'une ligne — on ne réécrit que
//! l'adaptateur du trait. Cf `SPECS/NODYX_SFU_CDC.md` §16-18.
//!
//! **Hypothèse de cet incrément** : les opérations sur un salon donné sont
//! sérialisées par l'appelant (la couche signaling traite les events d'un salon
//! sur une seule tâche). Un verrou async par salon pour la vraie concurrence est
//! un durcissement P1. On ne tient donc **jamais** le `Mutex` std à travers un
//! `.await` (plan sous verrou → travail moteur hors verrou → commit sous verrou).

use crate::{
    ConsumerId, Layer, MediaEngine, MediaError, ParticipantId, ProducerId, RoomId,
    RouterHandle, TrackKind, TransportHandle,
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
    /// Opération SFU demandée alors que le participant n'a pas de transport
    /// (encore en mesh) : rien n'est publié côté serveur en mesh.
    NotInSfu,
    /// Souscription à une publication inexistante.
    NoSuchPublication,
    /// Réglage de couche sur une publication à laquelle on n'est pas abonné.
    NotSubscribed,
    /// Le moteur média a échoué (remonté tel quel pour diagnostic).
    Engine(MediaError),
}

impl fmt::Display for VoiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VoiceError::RoomFull => f.write_str("salon plein"),
            VoiceError::AlreadyJoined => f.write_str("déjà présent dans le salon"),
            VoiceError::NotInRoom => f.write_str("absent du salon"),
            VoiceError::NotInSfu => f.write_str("participant pas en mode SFU"),
            VoiceError::NoSuchPublication => f.write_str("publication inexistante"),
            VoiceError::NotSubscribed => f.write_str("pas abonné à cette publication"),
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

// ── Sorties (ce que la couche signaling annonce aux clients) ────────────────

/// Résultat d'un `join` : ce que le signaling doit annoncer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinOutcome {
    /// Mode effectif du salon (le client sait s'il monte une PC mesh ou SFU).
    pub mode: Mode,
    /// Transport SFU du joiner (présent seulement en mode SFU).
    pub transport: Option<TransportHandle>,
    /// AUTRES participants qui viennent d'être basculés en SFU par cette arrivée
    /// (franchissement du seuil) → à notifier `voice:mode=sfu` (§17-B).
    pub migrated: Vec<(ParticipantId, TransportHandle)>,
}

/// Résultat d'une bascule/migration vers SFU.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SfuMigration {
    /// `true` si on vient de créer le router (première bascule du salon).
    pub switched_to_sfu: bool,
    /// Transports provisionnés lors de cette migration (à annoncer aux clients).
    pub transports: Vec<(ParticipantId, TransportHandle)>,
}

/// Vue d'une publication (pour l'event `voice:publications`, §17-A).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationInfo {
    pub producer: ProducerId,
    pub kind: TrackKind,
    pub owner: ParticipantId,
}

// ── État interne ────────────────────────────────────────────────────────────

#[derive(Default)]
struct Participant {
    /// Transport SFU du participant (absent tant qu'on est en mesh).
    transport: Option<TransportHandle>,
    /// Ce que ce participant consomme : publication → consumer.
    subscriptions: HashMap<ProducerId, ConsumerId>,
}

struct Publication {
    kind: TrackKind,
    owner: ParticipantId,
}

#[derive(Default)]
struct RoomState {
    participants: HashMap<ParticipantId, Participant>,
    publications: HashMap<ProducerId, Publication>,
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

    // ── lectures (sync) ──────────────────────────────────────────────────────

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

    /// Publications en cours dans un salon (pour `voice:publications`).
    pub fn publications(&self, room: &RoomId) -> Vec<PublicationInfo> {
        let rooms = self.rooms();
        let Some(state) = rooms.get(room) else {
            return Vec::new();
        };
        state
            .publications
            .iter()
            .map(|(id, pubb)| PublicationInfo {
                producer: id.clone(),
                kind: pubb.kind,
                owner: pubb.owner.clone(),
            })
            .collect()
    }

    // ── cycle de vie participant ─────────────────────────────────────────────

    /// Un participant rejoint. Applique les règles (siège, doublon), décide
    /// mesh/SFU, et — si SFU — migre TOUT le salon (router + transports manquants,
    /// pas seulement le joiner : franchir le seuil bascule tout le monde, §17-B).
    pub async fn join(
        &self,
        room: RoomId,
        participant: ParticipantId,
    ) -> Result<JoinOutcome, VoiceError> {
        // ── plan (sous verrou) : valider, réserver le siège, décider ──
        let sfu = {
            let mut rooms = self.rooms();
            let state = rooms.entry(room.clone()).or_default();
            if state.participants.contains_key(&participant) {
                return Err(VoiceError::AlreadyJoined);
            }
            if state.participants.len() >= self.cfg.max_seats {
                return Err(VoiceError::RoomFull);
            }
            state.participants.insert(participant.clone(), Participant::default());
            let desired = desired_mode(state.participants.len(), state.screensharing, &self.cfg);
            // Une fois SFU, on y reste (CDC §4) : router présent ⇒ SFU imposé.
            desired == Mode::Sfu || state.router.is_some()
        };

        if !sfu {
            return Ok(JoinOutcome { mode: Mode::Mesh, transport: None, migrated: Vec::new() });
        }

        // ── SFU : migrer tout le salon (crée router + transports manquants) ──
        let mig = self.ensure_sfu(room.clone()).await?;

        // Séparer le transport du joiner de ceux des autres (à notifier).
        let mut my_transport = None;
        let mut migrated = Vec::new();
        for (pid, t) in mig.transports {
            if pid == participant {
                my_transport = Some(t);
            } else {
                migrated.push((pid, t));
            }
        }
        // Joiner déjà pourvu (salon déjà SFU) : relire son transport.
        if my_transport.is_none() {
            let rooms = self.rooms();
            if let Some(p) = rooms.get(&room).and_then(|s| s.participants.get(&participant)) {
                my_transport = p.transport.clone();
            }
        }

        Ok(JoinOutcome { mode: Mode::Sfu, transport: my_transport, migrated })
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
            // Ses publications disparaissent (les abonnés seront notifiés par le signaling).
            state.publications.retain(|_, pubb| pubb.owner != participant);
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

    // ── bascule SFU ──────────────────────────────────────────────────────────

    /// Garantit que le salon est en SFU : crée le router si besoin, et provisionne
    /// un transport pour CHAQUE participant qui n'en a pas encore. Idempotent.
    /// Primitive unique de migration (utilisée par `join`, `set_screenshare`,
    /// `publish` d'un écran).
    pub async fn ensure_sfu(&self, room: RoomId) -> Result<SfuMigration, VoiceError> {
        // ── plan : router manquant ? qui n'a pas de transport ? ──
        let (need_router, existing_router, missing): (bool, Option<RouterHandle>, Vec<ParticipantId>) = {
            let rooms = self.rooms();
            let Some(state) = rooms.get(&room) else {
                return Err(VoiceError::NotInRoom);
            };
            let missing = state
                .participants
                .iter()
                .filter(|(_, p)| p.transport.is_none())
                .map(|(id, _)| id.clone())
                .collect();
            (state.router.is_none(), state.router.clone(), missing)
        };

        // ── apply (hors verrou) : router puis transports ──
        let router = if need_router {
            self.engine.create_room(room.clone()).await?
        } else {
            existing_router.expect("router SFU présent quand need_router=false")
        };
        let mut provisioned = Vec::with_capacity(missing.len());
        for pid in missing {
            let t = self.engine.create_transport(&router, pid.clone()).await?;
            provisioned.push((pid, t));
        }

        // ── commit : figer router + transports ──
        {
            let mut rooms = self.rooms();
            if let Some(state) = rooms.get_mut(&room) {
                if state.router.is_none() {
                    state.router = Some(router);
                }
                for (pid, t) in &provisioned {
                    if let Some(p) = state.participants.get_mut(pid) {
                        p.transport = Some(t.clone());
                    }
                }
            }
        }

        Ok(SfuMigration { switched_to_sfu: need_router, transports: provisioned })
    }

    /// Un partage d'écran démarre/s'arrête. Le démarrage force le mode SFU (quel
    /// que soit N) et migre tout le salon. L'arrêt ne rebascule PAS vers mesh en
    /// v1 (on reste en SFU, cf §4).
    pub async fn set_screenshare(&self, room: RoomId, on: bool) -> Result<SfuMigration, VoiceError> {
        {
            let mut rooms = self.rooms();
            let Some(state) = rooms.get_mut(&room) else {
                return Err(VoiceError::NotInRoom);
            };
            state.screensharing = on;
        }
        if on {
            self.ensure_sfu(room).await
        } else {
            Ok(SfuMigration { switched_to_sfu: false, transports: Vec::new() })
        }
    }

    // ── publish / subscribe ──────────────────────────────────────────────────

    /// Le participant publie un flux. Un partage d'écran (`Screen`) force d'abord
    /// la bascule SFU de tout le salon. En mesh (pas de transport), publier renvoie
    /// [`VoiceError::NotInSfu`] (rien n'est produit côté serveur en mesh).
    pub async fn publish(
        &self,
        room: RoomId,
        participant: ParticipantId,
        kind: TrackKind,
    ) -> Result<ProducerId, VoiceError> {
        if kind == TrackKind::Screen {
            self.ensure_sfu(room.clone()).await?;
        }

        let transport = {
            let rooms = self.rooms();
            let state = rooms.get(&room).ok_or(VoiceError::NotInRoom)?;
            let p = state.participants.get(&participant).ok_or(VoiceError::NotInRoom)?;
            p.transport.clone().ok_or(VoiceError::NotInSfu)?
        };

        let producer = self.engine.produce(&transport, kind).await?;

        {
            let mut rooms = self.rooms();
            if let Some(state) = rooms.get_mut(&room) {
                state.publications.insert(
                    producer.clone(),
                    Publication { kind, owner: participant },
                );
            }
        }
        Ok(producer)
    }

    /// Le participant souscrit à une publication. Requiert le mode SFU (transport).
    pub async fn subscribe(
        &self,
        room: RoomId,
        subscriber: ParticipantId,
        producer: ProducerId,
    ) -> Result<ConsumerId, VoiceError> {
        let transport = {
            let rooms = self.rooms();
            let state = rooms.get(&room).ok_or(VoiceError::NotInRoom)?;
            if !state.publications.contains_key(&producer) {
                return Err(VoiceError::NoSuchPublication);
            }
            let p = state.participants.get(&subscriber).ok_or(VoiceError::NotInRoom)?;
            p.transport.clone().ok_or(VoiceError::NotInSfu)?
        };

        let consumer = self.engine.consume(&transport, &producer).await?;

        {
            let mut rooms = self.rooms();
            if let Some(p) = rooms
                .get_mut(&room)
                .and_then(|s| s.participants.get_mut(&subscriber))
            {
                p.subscriptions.insert(producer, consumer.clone());
            }
        }
        Ok(consumer)
    }

    /// Force la couche servie à un abonné (adaptation bande passante, §17-C).
    pub async fn set_preferred_layer(
        &self,
        room: RoomId,
        subscriber: ParticipantId,
        producer: ProducerId,
        layer: Layer,
    ) -> Result<(), VoiceError> {
        let consumer = {
            let rooms = self.rooms();
            let state = rooms.get(&room).ok_or(VoiceError::NotInRoom)?;
            let p = state.participants.get(&subscriber).ok_or(VoiceError::NotInRoom)?;
            p.subscriptions.get(&producer).cloned().ok_or(VoiceError::NotSubscribed)?
        };
        self.engine.set_preferred_layer(&consumer, layer).await?;
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

    // ── cycle de vie ──────────────────────────────────────────────────────────

    #[test]
    fn small_room_stays_mesh_without_transport() {
        let s = svc();
        let out = block_on(s.join(room(), p(1))).unwrap();
        assert_eq!(out.mode, Mode::Mesh);
        assert!(out.transport.is_none());
        assert!(out.migrated.is_empty());
        assert_eq!(s.mode(&room()), Some(Mode::Mesh));
        assert_eq!(s.participant_count(&room()), 1);
    }

    #[test]
    fn crossing_threshold_migrates_whole_room() {
        let s = svc();
        for i in 1..=4 {
            let out = block_on(s.join(room(), p(i))).unwrap();
            assert_eq!(out.mode, Mode::Mesh, "à {i} on est encore en mesh");
        }
        // le 5e franchit le seuil → bascule tout le monde
        let out = block_on(s.join(room(), p(5))).unwrap();
        assert_eq!(out.mode, Mode::Sfu);
        assert!(out.transport.is_some(), "le joiner a son transport");
        assert_eq!(out.migrated.len(), 4, "les 4 déjà présents sont migrés");
        assert_eq!(s.mode(&room()), Some(Mode::Sfu));
    }

    #[test]
    fn joining_an_sfu_room_provisions_only_the_joiner() {
        let s = svc();
        for i in 1..=5 {
            block_on(s.join(room(), p(i))).unwrap();
        }
        let out = block_on(s.join(room(), p(6))).unwrap();
        assert_eq!(out.mode, Mode::Sfu);
        assert!(out.transport.is_some());
        assert!(out.migrated.is_empty(), "les autres avaient déjà leur transport");
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

    // ── bascule écran ─────────────────────────────────────────────────────────

    #[test]
    fn screenshare_forces_sfu_and_migrates_everyone() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        assert_eq!(s.mode(&room()), Some(Mode::Mesh));

        let mig = block_on(s.set_screenshare(room(), true)).unwrap();
        assert!(mig.switched_to_sfu);
        assert_eq!(mig.transports.len(), 2, "les 2 présents obtiennent un transport");
        assert_eq!(s.mode(&room()), Some(Mode::Sfu));
    }

    #[test]
    fn stays_in_sfu_after_screenshare_stops() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.set_screenshare(room(), true)).unwrap();
        assert_eq!(s.mode(&room()), Some(Mode::Sfu));
        let mig = block_on(s.set_screenshare(room(), false)).unwrap();
        assert!(!mig.switched_to_sfu);
        assert_eq!(s.mode(&room()), Some(Mode::Sfu)); // on NE rebascule pas (v1)
    }

    // ── publish / subscribe ────────────────────────────────────────────────────

    #[test]
    fn publishing_a_screen_migrates_and_produces() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        // p1 partage son écran depuis un salon mesh → bascule + producer
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen)).unwrap();
        assert_eq!(s.mode(&room()), Some(Mode::Sfu));
        let pubs = s.publications(&room());
        assert_eq!(pubs.len(), 1);
        assert_eq!(pubs[0].producer, prod);
        assert_eq!(pubs[0].kind, TrackKind::Screen);
        assert_eq!(pubs[0].owner, p(1));
    }

    #[test]
    fn publishing_audio_in_mesh_is_rejected() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        // audio ne bascule pas en SFU ; en mesh il n'y a pas de producer serveur
        assert_eq!(
            block_on(s.publish(room(), p(1), TrackKind::Audio)),
            Err(VoiceError::NotInSfu)
        );
    }

    #[test]
    fn subscribe_after_publish_returns_a_consumer() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen)).unwrap();
        // p2 (migré par la bascule) s'abonne au flux de p1
        let consumer = block_on(s.subscribe(room(), p(2), prod.clone())).unwrap();
        // régler la couche servie à p2 → OK
        block_on(s.set_preferred_layer(room(), p(2), prod, Layer::LOWEST)).unwrap();
        assert_eq!(consumer, consumer.clone());
    }

    #[test]
    fn subscribe_to_unknown_publication_errors() {
        let s = svc();
        for i in 1..=5 {
            block_on(s.join(room(), p(i))).unwrap();
        }
        let ghost = ProducerId("does-not-exist".into());
        assert_eq!(
            block_on(s.subscribe(room(), p(2), ghost)),
            Err(VoiceError::NoSuchPublication)
        );
    }

    #[test]
    fn set_layer_without_subscription_errors() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen)).unwrap();
        // p2 n'a pas souscrit → NotSubscribed
        assert_eq!(
            block_on(s.set_preferred_layer(room(), p(2), prod, Layer::LOWEST)),
            Err(VoiceError::NotSubscribed)
        );
    }

    #[test]
    fn leaving_owner_drops_its_publications() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        block_on(s.publish(room(), p(1), TrackKind::Screen)).unwrap();
        assert_eq!(s.publications(&room()).len(), 1);
        block_on(s.leave(room(), p(1))).unwrap();
        assert!(s.publications(&room()).is_empty(), "publications du partant retirées");
        assert_eq!(s.participant_count(&room()), 1); // salon pas fermé (p2 reste)
    }
}
