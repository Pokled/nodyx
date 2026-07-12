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
    RouterHandle, SignalingBlob, TrackKind, TransportHandle,
};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, MutexGuard};

// ── Mode & configuration ────────────────────────────────────────────────────

/// Direction d'un transport WebRTC côté client. mediasoup-client fixe la
/// direction à la création (send XOR recv) et un transport client = un
/// transport serveur : chaque participant SFU a donc DEUX transports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Le participant émet (publish) sur ce transport.
    Send,
    /// Le participant reçoit (subscribe) sur ce transport.
    Recv,
}

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
    /// Tentative de fermer une publication qu'on ne possède pas (arrêt d'un flux
    /// appartenant à autrui : refusé).
    NotOwner,
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
            VoiceError::NotOwner => f.write_str("publication appartenant à un autre participant"),
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
    /// AUTRES participants qui viennent d'être basculés en SFU par cette
    /// arrivée (franchissement du seuil) → à notifier `voice:mode=sfu`
    /// (§17-B). Chacun récupère ensuite SES params par direction.
    pub migrated: Vec<ParticipantId>,
}

/// Résultat d'une bascule/migration vers SFU.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SfuMigration {
    /// `true` si on vient de créer le router (première bascule du salon).
    pub switched_to_sfu: bool,
    /// Participants provisionnés (send+recv) lors de cette migration.
    pub migrated: Vec<ParticipantId>,
}

/// Ligne d'audit réseau d'un transport (diagnostic dev : IP/ICE/perte).
/// `stats` est un blob opaque du moteur (le métier ne le lit pas).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportAudit {
    pub participant: ParticipantId,
    pub direction: Direction,
    pub stats: SignalingBlob,
}

/// Vue d'une publication (pour l'event `voice:publications`, §17-A).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationInfo {
    pub producer: ProducerId,
    pub kind: TrackKind,
    pub owner: ParticipantId,
}

/// Vue d'un ABONNEMENT (diagnostic) : qui consomme quoi, et dans quel état.
/// Un consumer en pause n'envoie rien : côté débit, c'est indiscernable d'un
/// consumer qui n'existe pas. Sans cette vue, ces deux pannes se confondent.
#[derive(Debug, Clone)]
pub struct SubscriptionInfo {
    pub subscriber: ParticipantId,
    pub producer: ProducerId,
    pub consumer: ConsumerId,
    /// Blob opaque du moteur : kind, paused, producerPaused…
    pub state: SignalingBlob,
}

// ── État interne ────────────────────────────────────────────────────────────

struct Participant {
    /// Transport d'ÉMISSION (publish) — absent tant qu'on est en mesh.
    send_transport: Option<TransportHandle>,
    /// Transport de RÉCEPTION (subscribe) — absent tant qu'on est en mesh.
    recv_transport: Option<TransportHandle>,
    /// Ce que ce participant consomme : publication → consumer.
    subscriptions: HashMap<ProducerId, ConsumerId>,
    /// Dernier heartbeat (secs). u64::MAX = frais (jamais vu) → jamais évincé
    /// tant que l'appelant n'a pas `touch()`é au moins une fois.
    last_seen: u64,
}

impl Default for Participant {
    fn default() -> Self {
        Self {
            send_transport: None,
            recv_transport: None,
            subscriptions: HashMap::new(),
            last_seen: u64::MAX,
        }
    }
}

impl Participant {
    fn transport(&self, d: Direction) -> Option<&TransportHandle> {
        match d {
            Direction::Send => self.send_transport.as_ref(),
            Direction::Recv => self.recv_transport.as_ref(),
        }
    }
    fn in_sfu(&self) -> bool {
        self.send_transport.is_some() && self.recv_transport.is_some()
    }
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

    /// Rafraîchit le heartbeat d'un participant (secs). Retourne false s'il est
    /// absent. Le clock est INJECTÉ (le métier reste sans horloge) : c'est le
    /// daemon qui fournit `now`, appelé au join et à chaque heartbeat client.
    pub fn touch(&self, room: &RoomId, participant: &ParticipantId, now_secs: u64) -> bool {
        let mut rooms = self.rooms();
        match rooms.get_mut(room).and_then(|s| s.participants.get_mut(participant)) {
            Some(p) => { p.last_seen = now_secs; true }
            None => false,
        }
    }

    /// Participants dont le dernier heartbeat est antérieur à `cutoff_secs`
    /// (= à évincer). Les frais (jamais `touch`és, last_seen = MAX) ne sont
    /// jamais renvoyés. Pur/sync : le daemon appelle ensuite `leave` sur chacun.
    pub fn stale(&self, cutoff_secs: u64) -> Vec<(RoomId, ParticipantId)> {
        let rooms = self.rooms();
        let mut out = Vec::new();
        for (room, state) in rooms.iter() {
            for (pid, p) in &state.participants {
                if p.last_seen < cutoff_secs {
                    out.push((room.clone(), pid.clone()));
                }
            }
        }
        out
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

    /// Audit réseau du salon : pour chaque transport de chaque participant,
    /// le blob de stats du moteur (mediasoup : IP:port réelles, état ICE,
    /// bitrate, perte). Outil de diagnostic dev. Salon absent → vecteur vide.
    pub async fn audit(&self, room: &RoomId) -> Vec<TransportAudit> {
        // Snapshot des handles sous verrou (pas d'await pendant qu'on tient le lock).
        let handles: Vec<(ParticipantId, Direction, TransportHandle)> = {
            let rooms = self.rooms();
            let Some(state) = rooms.get(room) else { return Vec::new() };
            let mut v = Vec::new();
            for (pid, p) in &state.participants {
                if let Some(t) = p.send_transport.clone() {
                    v.push((pid.clone(), Direction::Send, t));
                }
                if let Some(t) = p.recv_transport.clone() {
                    v.push((pid.clone(), Direction::Recv, t));
                }
            }
            v
        };
        // Appels moteur hors verrou.
        let mut out = Vec::with_capacity(handles.len());
        for (participant, direction, handle) in handles {
            let stats = match self.engine.transport_stats(&handle).await {
                Ok(b) => b,
                Err(e) => SignalingBlob(format!("{{\"error\":\"{e}\"}}")),
            };
            out.push(TransportAudit { participant, direction, stats });
        }
        out
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
        // Replace-on-rejoin : un rejoin (refresh, reconnexion réseau) ne doit
        // JAMAIS être rejeté. Si le participant est déjà là, on évince l'ancienne
        // présence (ferme ses transports/producers) avant de recréer. Sémantique
        // mesh : un user = une session, la plus récente gagne. (Le pair verra
        // l'ancien flux se fermer via la réconciliation.)
        let already = self
            .rooms()
            .get(&room)
            .is_some_and(|s| s.participants.contains_key(&participant));
        if already {
            self.remove(room.clone(), participant.clone()).await?;
        }

        // ── plan (sous verrou) : valider, réserver le siège, décider ──
        let sfu = {
            let mut rooms = self.rooms();
            let state = rooms.entry(room.clone()).or_default();
            if state.participants.len() >= self.cfg.max_seats {
                return Err(VoiceError::RoomFull);
            }
            state.participants.insert(participant.clone(), Participant::default());
            let desired = desired_mode(state.participants.len(), state.screensharing, &self.cfg);
            // Une fois SFU, on y reste (CDC §4) : router présent ⇒ SFU imposé.
            desired == Mode::Sfu || state.router.is_some()
        };

        if !sfu {
            return Ok(JoinOutcome { mode: Mode::Mesh, migrated: Vec::new() });
        }

        // ── SFU : migrer tout le salon (router + paires de transports manquantes) ──
        let mig = self.ensure_sfu(room.clone()).await?;
        let migrated = mig
            .migrated
            .into_iter()
            .filter(|pid| pid != &participant)
            .collect();

        Ok(JoinOutcome { mode: Mode::Sfu, migrated })
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
    /// la PAIRE de transports (send + recv, contrainte mediasoup-client) pour
    /// CHAQUE participant incomplet. Idempotent. Primitive unique de migration
    /// (utilisée par `join`, `set_screenshare`, `publish` d'un écran).
    pub async fn ensure_sfu(&self, room: RoomId) -> Result<SfuMigration, VoiceError> {
        // Boucle de convergence (relecture 2026-07-06) : deux ensure_sfu
        // concurrents sur un salon vierge créaient DEUX routers ; le perdant
        // n'était jamais fermé et ses transports pouvaient être commités →
        // participants à cheval sur deux routers, consume inter-routers en
        // échec. Ici : si on perd la course au commit, on FERME notre router
        // (l'adaptateur libère ses transports avec lui) et on recommence sur
        // celui du gagnant. Converge en ≤2 tours réels ; borne dure à 4 par
        // paranoïa. NB : sur un router PARTAGÉ, une double-provision du même
        // participant laisse des transports orphelins côté moteur (inutilisés,
        // libérés au close_room) : bénin, la vraie sérialisation par salon
        // arrive avec le durcissement P1.
        let mut switched = false;
        let mut migrated_all: Vec<ParticipantId> = Vec::new();
        for _tour in 0..4 {
            // ── plan : router manquant ? qui n'a pas sa paire complète ? ──
            let (need_router, existing_router, missing): (bool, Option<RouterHandle>, Vec<ParticipantId>) = {
                let rooms = self.rooms();
                let Some(state) = rooms.get(&room) else {
                    return Err(VoiceError::NotInRoom);
                };
                let missing = state
                    .participants
                    .iter()
                    .filter(|(_, p)| !p.in_sfu())
                    .map(|(id, _)| id.clone())
                    .collect();
                (state.router.is_none(), state.router.clone(), missing)
            };
            if !need_router && missing.is_empty() {
                break; // rien à faire : idempotence
            }

            // ── apply (hors verrou) : router puis paires de transports ──
            let router = if need_router {
                self.engine.create_room(room.clone()).await?
            } else {
                existing_router.expect("router SFU présent quand need_router=false")
            };
            let mut provisioned: Vec<(ParticipantId, TransportHandle, TransportHandle)> =
                Vec::with_capacity(missing.len());
            for pid in missing {
                let send = self.engine.create_transport(&router, pid.clone()).await?;
                let recv = self.engine.create_transport(&router, pid.clone()).await?;
                provisioned.push((pid, send, recv));
            }

            // ── commit : figer router + paires, OU détecter la course perdue ──
            enum Outcome { Won(Vec<ParticipantId>), LostRace, RoomGone }
            let outcome = {
                let mut rooms = self.rooms();
                match rooms.get_mut(&room) {
                    None => Outcome::RoomGone,
                    Some(state) => {
                        let lost = need_router
                            && state.router.as_ref().is_some_and(|r| r != &router);
                        if lost {
                            Outcome::LostRace
                        } else {
                            if state.router.is_none() {
                                state.router = Some(router.clone());
                            }
                            let mut committed = Vec::new();
                            for (pid, send, recv) in &provisioned {
                                if let Some(p) = state.participants.get_mut(pid) {
                                    let mut used = false;
                                    if p.send_transport.is_none() {
                                        p.send_transport = Some(send.clone());
                                        used = true;
                                    }
                                    if p.recv_transport.is_none() {
                                        p.recv_transport = Some(recv.clone());
                                        used = true;
                                    }
                                    if used {
                                        committed.push(pid.clone());
                                    }
                                }
                            }
                            Outcome::Won(committed)
                        }
                    }
                }
            };

            match outcome {
                Outcome::Won(committed) => {
                    switched |= need_router;
                    migrated_all.extend(committed);
                    break;
                }
                Outcome::LostRace => {
                    // Nos transports vivent sur NOTRE router : sa fermeture les
                    // libère côté adaptateur. Puis on retente sur le gagnant.
                    let _ = self.engine.close_room(router).await;
                }
                Outcome::RoomGone => {
                    // Salon fermé pendant le travail moteur (dernier leave) :
                    // on libère ce qu'on venait de créer et on le signale.
                    if need_router {
                        let _ = self.engine.close_room(router).await;
                    }
                    return Err(VoiceError::NotInRoom);
                }
            }
        }

        Ok(SfuMigration { switched_to_sfu: switched, migrated: migrated_all })
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
            Ok(SfuMigration { switched_to_sfu: false, migrated: Vec::new() })
        }
    }

    // ── publish / subscribe ──────────────────────────────────────────────────

    /// Le participant publie un flux. Un partage d'écran (`Screen`) force d'abord
    /// la bascule SFU de tout le salon. En mesh (pas de transport), publier renvoie
    /// [`VoiceError::NotInSfu`] (rien n'est produit côté serveur en mesh).
    /// `client` = paramètres RTP du client (blob opaque, transmis au moteur).
    pub async fn publish(
        &self,
        room: RoomId,
        participant: ParticipantId,
        kind: TrackKind,
        client: &SignalingBlob,
    ) -> Result<ProducerId, VoiceError> {
        if kind == TrackKind::Screen {
            self.ensure_sfu(room.clone()).await?;
        }

        let transport = {
            let rooms = self.rooms();
            let state = rooms.get(&room).ok_or(VoiceError::NotInRoom)?;
            let p = state.participants.get(&participant).ok_or(VoiceError::NotInRoom)?;
            p.transport(Direction::Send).cloned().ok_or(VoiceError::NotInSfu)?
        };

        let producer = self.engine.produce(&transport, kind, client).await?;

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

    /// Le participant arrête un flux qu'il a publié (ex. stop partage d'écran).
    /// Retire la publication ET ferme le producer côté serveur → les abonnés le
    /// voient disparaître (réconciliation). Borné au propriétaire : fermer le flux
    /// d'autrui est refusé ([`VoiceError::NotOwner`]). Le verrou d'état n'est
    /// jamais tenu à travers l'`await` moteur (comme publish/subscribe).
    pub async fn unpublish(
        &self,
        room: RoomId,
        participant: ParticipantId,
        producer: ProducerId,
    ) -> Result<(), VoiceError> {
        {
            let mut rooms = self.rooms();
            let state = rooms.get_mut(&room).ok_or(VoiceError::NotInRoom)?;
            match state.publications.get(&producer) {
                Some(pubb) if pubb.owner == participant => {
                    state.publications.remove(&producer);
                }
                Some(_) => return Err(VoiceError::NotOwner),
                None => return Err(VoiceError::NoSuchPublication),
            }
        }
        // Hors verrou : fermeture réelle du flux moteur (idempotente).
        self.engine.close_producer(&producer).await?;
        Ok(())
    }

    /// Tous les abonnements du salon, avec l'ÉTAT RÉEL de chaque consumer (moteur).
    /// Outil de DIAGNOSTIC : répond à « le spectateur a-t-il seulement souscrit au
    /// flux vidéo, et si oui son consumer est-il resté en pause ? ». Deux pannes qui
    /// donnent le même symptôme (aucune vidéo servie) et deux correctifs opposés.
    pub async fn subscriptions(&self, room: &RoomId) -> Vec<SubscriptionInfo> {
        // On relève d'abord la liste (verrou court), puis on interroge le moteur
        // hors verrou, comme partout ailleurs.
        let flat: Vec<(ParticipantId, ProducerId, ConsumerId)> = {
            let rooms = self.rooms();
            let Some(state) = rooms.get(room) else {
                return Vec::new();
            };
            state
                .participants
                .iter()
                .flat_map(|(pid, p)| {
                    p.subscriptions
                        .iter()
                        .map(|(prod, cons)| (pid.clone(), prod.clone(), cons.clone()))
                })
                .collect()
        };

        let mut out = Vec::with_capacity(flat.len());
        for (subscriber, producer, consumer) in flat {
            let state = self
                .engine
                .consumer_state(&consumer)
                .await
                .unwrap_or_else(|e| SignalingBlob(format!("{{\"error\":\"{e}\"}}")));
            out.push(SubscriptionInfo { subscriber, producer, consumer, state });
        }
        out
    }

    /// L'abonné a créé son consumer côté client : on reprend le flux serveur.
    /// La VIDÉO est servie en pause (sinon la keyframe part avant que le décodeur
    /// du client n'existe → écran noir clignotant) ; c'est ici qu'elle repart, et
    /// mediasoup redemande une keyframe à un décodeur cette fois prêt.
    /// Borné à SES propres abonnements : on ne reprend pas le flux d'autrui.
    pub async fn resume_consumer(
        &self,
        room: RoomId,
        subscriber: ParticipantId,
        consumer: ConsumerId,
    ) -> Result<(), VoiceError> {
        {
            let rooms = self.rooms();
            let state = rooms.get(&room).ok_or(VoiceError::NotInRoom)?;
            let p = state.participants.get(&subscriber).ok_or(VoiceError::NotInRoom)?;
            if !p.subscriptions.values().any(|c| c == &consumer) {
                return Err(VoiceError::NotSubscribed);
            }
        }
        self.engine.resume_consumer(&consumer).await?;
        Ok(())
    }

    /// Le participant souscrit à une publication. Requiert le mode SFU (transport).
    /// `client_caps` = capabilities du client (blob opaque) ; retourne aussi les
    /// paramètres que le client doit appliquer (blob du moteur).
    pub async fn subscribe(
        &self,
        room: RoomId,
        subscriber: ParticipantId,
        producer: ProducerId,
        client_caps: &SignalingBlob,
    ) -> Result<(ConsumerId, SignalingBlob), VoiceError> {
        let transport = {
            let rooms = self.rooms();
            let state = rooms.get(&room).ok_or(VoiceError::NotInRoom)?;
            if !state.publications.contains_key(&producer) {
                return Err(VoiceError::NoSuchPublication);
            }
            let p = state.participants.get(&subscriber).ok_or(VoiceError::NotInRoom)?;
            p.transport(Direction::Recv).cloned().ok_or(VoiceError::NotInSfu)?
        };

        let (consumer, params) = self.engine.consume(&transport, &producer, client_caps).await?;

        {
            let mut rooms = self.rooms();
            if let Some(p) = rooms
                .get_mut(&room)
                .and_then(|s| s.participants.get_mut(&subscriber))
            {
                p.subscriptions.insert(producer, consumer.clone());
            }
        }
        Ok((consumer, params))
    }

    // ── Signaling pass-through (blobs opaques, jamais lus par le métier) ─────

    /// Capabilities du salon, à remettre au client au join SFU (§17-A).
    pub async fn room_capabilities(&self, room: &RoomId) -> Result<SignalingBlob, VoiceError> {
        let router = {
            let rooms = self.rooms();
            let state = rooms.get(room).ok_or(VoiceError::NotInRoom)?;
            state.router.clone().ok_or(VoiceError::NotInSfu)?
        };
        Ok(self.engine.room_capabilities(&router).await?)
    }

    /// Paramètres de connexion d'un transport du participant (ICE/DTLS…), par
    /// direction (mediasoup-client : un transport client = une direction).
    pub async fn transport_params(
        &self,
        room: &RoomId,
        participant: &ParticipantId,
        direction: Direction,
    ) -> Result<SignalingBlob, VoiceError> {
        let transport = self.transport_of(room, participant, direction)?;
        Ok(self.engine.transport_params(&transport).await?)
    }

    /// Finalise la connexion d'un transport avec la réponse du client (§17-A).
    pub async fn connect_transport(
        &self,
        room: &RoomId,
        participant: &ParticipantId,
        direction: Direction,
        client: &SignalingBlob,
    ) -> Result<(), VoiceError> {
        let transport = self.transport_of(room, participant, direction)?;
        Ok(self.engine.connect_transport(&transport, client).await?)
    }

    fn transport_of(
        &self,
        room: &RoomId,
        participant: &ParticipantId,
        direction: Direction,
    ) -> Result<TransportHandle, VoiceError> {
        let rooms = self.rooms();
        let state = rooms.get(room).ok_or(VoiceError::NotInRoom)?;
        let p = state.participants.get(participant).ok_or(VoiceError::NotInRoom)?;
        p.transport(direction).cloned().ok_or(VoiceError::NotInSfu)
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

    fn blob() -> SignalingBlob {
        SignalingBlob("{}".into())
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
        assert_eq!(out.migrated.len(), 4, "les 4 déjà présents sont migrés");
        // le joiner a sa PAIRE de transports (send + recv, contrainte mediasoup-client)
        assert!(block_on(s.transport_params(&room(), &p(5), Direction::Send)).is_ok());
        assert!(block_on(s.transport_params(&room(), &p(5), Direction::Recv)).is_ok());
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
        assert!(out.migrated.is_empty(), "les autres avaient déjà leur paire");
        assert!(block_on(s.transport_params(&room(), &p(6), Direction::Send)).is_ok());
    }

    #[test]
    fn room_full_is_rejected() {
        let s = VoiceService::new(NullEngine::new(), VoiceConfig { max_seats: 2, mesh_threshold: 4 });
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        assert_eq!(block_on(s.join(room(), p(3))), Err(VoiceError::RoomFull));
    }

    #[test]
    fn rejoin_replaces_instead_of_rejecting() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        // rejoin du MÊME participant : ACCEPTÉ (remplace), jamais AlreadyJoined.
        let out = block_on(s.join(room(), p(1))).unwrap();
        assert_eq!(out.mode, Mode::Mesh);
        assert_eq!(s.participant_count(&room()), 1, "pas de doublon");
        // rejoin en mode SFU : remplace aussi, la paire de transports est refaite
        for i in 2..=5 { block_on(s.join(room(), p(i))).unwrap(); } // → SFU
        assert_eq!(s.mode(&room()), Some(Mode::Sfu));
        let before = s.participant_count(&room());
        let out2 = block_on(s.join(room(), p(1))).unwrap();
        assert_eq!(out2.mode, Mode::Sfu);
        assert_eq!(s.participant_count(&room()), before, "rejoin SFU ne dédouble pas");
        assert!(block_on(s.transport_params(&room(), &p(1), Direction::Send)).is_ok());
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
        assert_eq!(mig.migrated.len(), 2, "les 2 présents obtiennent leur paire");
        // et chacun a bien send ET recv distincts
        let send = block_on(s.transport_params(&room(), &p(1), Direction::Send)).unwrap();
        let recv = block_on(s.transport_params(&room(), &p(1), Direction::Recv)).unwrap();
        assert_ne!(send, recv, "send et recv sont deux transports distincts");
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
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen, &blob())).unwrap();
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
            block_on(s.publish(room(), p(1), TrackKind::Audio, &blob())),
            Err(VoiceError::NotInSfu)
        );
    }

    #[test]
    fn unpublish_removes_own_screen_and_rejects_others() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen, &blob())).unwrap();
        assert_eq!(s.publications(&room()).len(), 1);

        // Un AUTRE participant ne peut pas fermer le flux de p1.
        assert_eq!(
            block_on(s.unpublish(room(), p(2), prod.clone())),
            Err(VoiceError::NotOwner)
        );
        assert_eq!(s.publications(&room()).len(), 1, "refus = publication intacte");

        // Le PROPRIÉTAIRE arrête son partage → la publication disparaît.
        block_on(s.unpublish(room(), p(1), prod.clone())).unwrap();
        assert!(s.publications(&room()).is_empty());

        // Re-fermer un flux déjà disparu → NoSuchPublication (rien à fermer).
        assert_eq!(
            block_on(s.unpublish(room(), p(1), prod)),
            Err(VoiceError::NoSuchPublication)
        );
    }

    #[test]
    fn subscribe_after_publish_returns_a_consumer() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen, &blob())).unwrap();
        // p2 (migré par la bascule) s'abonne au flux de p1
        let caps = SignalingBlob("{\"caps\":\"p2\"}".into());
        let (consumer, params) = block_on(s.subscribe(room(), p(2), prod.clone(), &caps)).unwrap();
        // NullEngine échoie les caps : le blob transite intact par le métier
        assert_eq!(params, caps);
        // régler la couche servie à p2 → OK
        block_on(s.set_preferred_layer(room(), p(2), prod, Layer::LOWEST)).unwrap();
        assert_eq!(consumer, consumer.clone());
    }

    #[test]
    fn resume_consumer_only_for_own_subscription() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        block_on(s.join(room(), p(3))).unwrap();
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen, &blob())).unwrap();
        let (consumer, _) = block_on(s.subscribe(room(), p(2), prod, &blob())).unwrap();

        // L'abonné reprend SON flux (la vidéo est servie en pause : c'est ici
        // qu'elle repart, avec une keyframe pour un décodeur enfin prêt).
        block_on(s.resume_consumer(room(), p(2), consumer.clone())).unwrap();

        // Un TIERS ne peut pas reprendre le consumer de p2.
        assert_eq!(
            block_on(s.resume_consumer(room(), p(3), consumer)),
            Err(VoiceError::NotSubscribed)
        );

        // Un consumer inconnu non plus.
        assert_eq!(
            block_on(s.resume_consumer(room(), p(2), ConsumerId("nope".into()))),
            Err(VoiceError::NotSubscribed)
        );
    }

    #[test]
    fn subscribe_to_unknown_publication_errors() {
        let s = svc();
        for i in 1..=5 {
            block_on(s.join(room(), p(i))).unwrap();
        }
        let ghost = ProducerId("does-not-exist".into());
        assert_eq!(
            block_on(s.subscribe(room(), p(2), ghost, &blob())),
            Err(VoiceError::NoSuchPublication)
        );
    }

    #[test]
    fn set_layer_without_subscription_errors() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        let prod = block_on(s.publish(room(), p(1), TrackKind::Screen, &blob())).unwrap();
        // p2 n'a pas souscrit → NotSubscribed
        assert_eq!(
            block_on(s.set_preferred_layer(room(), p(2), prod, Layer::LOWEST)),
            Err(VoiceError::NotSubscribed)
        );
    }

    #[test]
    fn signaling_passthrough_in_sfu_mode() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        block_on(s.set_screenshare(room(), true)).unwrap(); // force SFU
        // capabilities du salon dispo
        let caps = block_on(s.room_capabilities(&room())).unwrap();
        assert!(caps.0.contains("router"), "blob moteur transmis tel quel");
        // paramètres de transport du participant + connect
        let params = block_on(s.transport_params(&room(), &p(1), Direction::Send)).unwrap();
        assert!(params.0.contains("transport"));
        block_on(s.connect_transport(&room(), &p(1), Direction::Send, &blob())).unwrap();
    }

    #[test]
    fn signaling_in_mesh_is_rejected() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        // en mesh : pas de router, pas de transport
        assert_eq!(
            block_on(s.room_capabilities(&room())),
            Err(VoiceError::NotInSfu)
        );
        assert_eq!(
            block_on(s.transport_params(&room(), &p(1), Direction::Send)),
            Err(VoiceError::NotInSfu)
        );
        assert_eq!(
            block_on(s.room_capabilities(&RoomId("nope".into()))),
            Err(VoiceError::NotInRoom)
        );
    }

    #[test]
    fn audit_lists_both_transports_per_participant() {
        let s = svc();
        for i in 1..=5 { block_on(s.join(room(), p(i))).unwrap(); } // franchit le seuil → SFU
        let audit = block_on(s.audit(&room()));
        // 5 participants × 2 transports (send + recv) = 10 lignes
        assert_eq!(audit.len(), 10);
        let sends = audit.iter().filter(|a| a.direction == Direction::Send).count();
        let recvs = audit.iter().filter(|a| a.direction == Direction::Recv).count();
        assert_eq!(sends, 5);
        assert_eq!(recvs, 5);
        // le blob du moteur transite tel quel (NullEngine renvoie un stub identifiable)
        assert!(audit[0].stats.0.contains("transport"));
    }

    #[test]
    fn heartbeat_and_stale_eviction() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        // frais (jamais touché) → jamais stale, même avec un grand cutoff
        assert!(s.stale(1_000_000).is_empty());
        // touch : p1 à t=100, p2 à t=500
        assert!(s.touch(&room(), &p(1), 100));
        assert!(s.touch(&room(), &p(2), 500));
        // cutoff 300 : p1 (100<300) évincible, p2 (500) non
        let stale = s.stale(300);
        assert_eq!(stale.len(), 1);
        assert_eq!(stale[0].0, room());
        assert_eq!(stale[0].1, p(1));
        // touch d'un inconnu → false
        assert!(!s.touch(&room(), &p(9), 100));
        // évincer p1 via leave : il disparaît du stale
        block_on(s.leave(room(), p(1))).unwrap();
        assert!(s.stale(300).is_empty());
    }

    #[test]
    fn audit_empty_room_is_empty() {
        let s = svc();
        assert!(block_on(s.audit(&RoomId("nope".into()))).is_empty());
        block_on(s.join(room(), p(1))).unwrap(); // mesh : pas de transport
        assert!(block_on(s.audit(&room())).is_empty());
    }

    #[test]
    fn leaving_owner_drops_its_publications() {
        let s = svc();
        block_on(s.join(room(), p(1))).unwrap();
        block_on(s.join(room(), p(2))).unwrap();
        block_on(s.publish(room(), p(1), TrackKind::Screen, &blob())).unwrap();
        assert_eq!(s.publications(&room()).len(), 1);
        block_on(s.leave(room(), p(1))).unwrap();
        assert!(s.publications(&room()).is_empty(), "publications du partant retirées");
        assert_eq!(s.participant_count(&room()), 1); // salon pas fermé (p2 reste)
    }
}
