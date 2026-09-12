//! `Str0mEngine` — preuve « derrière le trait », a minima (Phase A du CDC).
//!
//! Objectif de CE fichier : répondre à la question posée par le CDC
//! (`SPECS/NODYX_MEDIA_ENGINE_RUST.md` §4, « À VÉRIFIER : le trait
//! `MediaEngine` couvre-t-il tout ce dont un moteur natif a besoin, ou a-t-il
//! des fuites d'abstraction ? »). Même barre que le spike mediasoup existant
//! (`nodyx-sfu-mediasoup/src/bin/spike.rs`, scénario `[W]`) : prouver que
//! `transport_params` produit un blob avec de vrais candidats ICE + une
//! empreinte DTLS, et que `connect_transport` avec un payload invalide est
//! rejeté PROPREMENT (pas de panique) — sans piloter un vrai navigateur, ce
//! qui n'est pas non plus ce que fait le spike mediasoup existant pour son
//! scénario WebRTC.
//!
//! Fuite d'abstraction trouvée en écrivant ce fichier, à consigner au CDC :
//! `transport_params`/`connect_transport` supposent que le MOTEUR génère le
//! premier message (l'« offre »), ce qui colle à mediasoup (ICE/DTLS générés
//! serveur) et donc à ce choix ici (str0m comme OFFREUR SDP). Ça fonctionne,
//! mais ce n'est pas la seule direction possible : le spike réseau
//! (`nat-probe`) fait l'inverse (str0m RÉPOND à l'offre du navigateur), pour
//! de bonnes raisons propres à ce binaire (isoler la question du perçage).
//! Le trait n'impose donc pas un rôle SDP fixe, il faut juste choisir un
//! sens et s'y tenir par adaptateur — pas une fuite rédhibitoire, mais une
//! hypothèse implicite qui mériterait une ligne au CDC (D2 : "le trait
//! suffit-il ?" — réponse partielle : oui, à condition de choisir un rôle
//! SDP par adaptateur et de le documenter, ce que ce fichier fait).

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use str0m::change::{SdpAnswer, SdpPendingOffer};
use str0m::media::{Direction, MediaKind};
use str0m::{Candidate, Rtc};

use nodyx_sfu::{
    ConsumerId, EngineStats, Layer, MediaEngine, MediaError, NodeId, ParticipantId, PipeHandle,
    ProducerId, Result, RoomId, RouterHandle, SignalingBlob, StatsScope, TrackKind, TransportHandle,
};

struct TransportState {
    rtc: Rtc,
    pending: Option<SdpPendingOffer>,
}

/// Moteur str0m derrière `MediaEngine`, scope Phase A (audio seul, D6 du
/// CDC déjà tranché). `produce`/`consume`/`pipe_to_remote`/le reste des
/// couches restent `Unsupported`, documentés : ils appartiennent aux
/// phases B (adaptateur complet) et D (vidéo/simulcast), pas à ce spike.
pub struct Str0mEngine {
    listen_ip: IpAddr,
    announced_ip: IpAddr,
    seq: AtomicU64,
    transports: Mutex<HashMap<String, TransportState>>,
}

impl Str0mEngine {
    /// `announced_ip` : l'adresse publique à annoncer comme candidat host
    /// (sur le VPS, l'IP publique EST joignable directement ; le spike réseau
    /// `nat-probe`, lui, utilise le vrai candidat srflx découvert par STUN
    /// pour une box résidentielle — ce moteur reste volontairement simple,
    /// c'est `nat-probe` qui répond à la question du perçage NAT, pas lui).
    pub fn new(listen_ip: IpAddr, announced_ip: IpAddr) -> Self {
        // Provider crypto par défaut, une seule fois par process. Idempotent
        // à l'appel mais ne DOIT être appelé qu'une fois : `new()` n'est
        // attendu qu'une fois par process pour ce spike (pas un vrai
        // multi-instance dans un même binaire).
        str0m::crypto::from_feature_flags().install_process_default();
        Self {
            listen_ip,
            announced_ip,
            seq: AtomicU64::new(0),
            transports: Mutex::new(HashMap::new()),
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.seq.fetch_add(1, Ordering::Relaxed))
    }
}

impl MediaEngine for Str0mEngine {
    async fn create_room(&self, room: RoomId) -> Result<RouterHandle> {
        // Pas de notion de Router côté str0m (pas de RTP forwarding server-side
        // multi-parties à ce stade du spike, cf. produce/consume Unsupported
        // ci-dessous) : le handle existe pour respecter le contrat du trait,
        // il ne porte aucune ressource str0m tant que produce/consume ne sont
        // pas implémentés (Phase B).
        Ok(RouterHandle(format!("str0m-router-{room}")))
    }

    async fn room_capabilities(&self, router: &RouterHandle) -> Result<SignalingBlob> {
        Ok(SignalingBlob(format!(
            "{{\"engine\":\"str0m\",\"router\":\"{router}\"}}"
        )))
    }

    async fn create_transport(
        &self,
        _router: &RouterHandle,
        _participant: ParticipantId,
    ) -> Result<TransportHandle> {
        let id = self.next_id("transport");

        let rtc = Rtc::builder()
            .set_ice_lite(false) // ICE complet : toute la raison d'être de ce moteur (CDC §2-3)
            .build(Instant::now());

        self.transports
            .lock()
            .map_err(|_| MediaError::Engine("verrou transports empoisonné".into()))?
            .insert(id.clone(), TransportState { rtc, pending: None });

        Ok(TransportHandle(id))
    }

    async fn transport_params(&self, transport: &TransportHandle) -> Result<SignalingBlob> {
        let mut transports = self
            .transports
            .lock()
            .map_err(|_| MediaError::Engine("verrou transports empoisonné".into()))?;
        let state = transports
            .get_mut(&transport.0)
            .ok_or_else(|| MediaError::NotFound(format!("transport {transport}")))?;

        // Candidat host : port éphémère annoncé, JAMAIS lié réellement à ce
        // stade du spike (aucun trafic média n'est encore émis/reçu tant que
        // produce/consume ne sont pas implémentés, cf. Phase B). C'est
        // suffisant pour prouver que le blob contient de vrais candidats et
        // une vraie empreinte DTLS, ce que ce spike doit démontrer.
        let port = 40000 + (self.seq.load(Ordering::Relaxed) % 1000) as u16;
        let addr = SocketAddr::new(self.announced_ip, port);
        let listen_addr = SocketAddr::new(self.listen_ip, port);
        let candidate = Candidate::host(addr, "udp")
            .map_err(|e| MediaError::Engine(format!("candidat host invalide : {e}")))?;
        state
            .rtc
            .add_local_candidate(candidate)
            .ok_or_else(|| MediaError::Engine("candidat rejeté par Rtc".into()))?;

        let mut change = state.rtc.sdp_api();
        change.add_media(MediaKind::Audio, Direction::SendRecv, None, None, None);
        let Some((offer, pending)) = change.apply() else {
            return Err(MediaError::Engine(
                "aucun changement à négocier (add_media n'a rien produit)".into(),
            ));
        };
        state.pending = Some(pending);

        let _ = listen_addr; // conservé pour la Phase B (bind réel du socket média)

        Ok(SignalingBlob(offer.to_sdp_string()))
    }

    async fn connect_transport(&self, transport: &TransportHandle, client: &SignalingBlob) -> Result<()> {
        let mut transports = self
            .transports
            .lock()
            .map_err(|_| MediaError::Engine("verrou transports empoisonné".into()))?;
        let state = transports
            .get_mut(&transport.0)
            .ok_or_else(|| MediaError::NotFound(format!("transport {transport}")))?;

        let pending = state
            .pending
            .take()
            .ok_or_else(|| MediaError::Engine("aucune offre en attente (transport_params jamais appelé ?)".into()))?;

        let answer = SdpAnswer::from_sdp_string(&client.0)
            .map_err(|e| MediaError::Engine(format!("réponse SDP invalide : {e}")))?;

        state
            .rtc
            .sdp_api()
            .accept_answer(pending, answer)
            .map_err(|e| MediaError::Engine(format!("réponse SDP rejetée : {e}")))
    }

    async fn transport_stats(&self, transport: &TransportHandle) -> Result<SignalingBlob> {
        Ok(SignalingBlob(format!(
            "{{\"engine\":\"str0m\",\"transport\":\"{transport}\",\"note\":\"stats live = Phase B\"}}"
        )))
    }

    async fn produce(&self, _transport: &TransportHandle, _kind: TrackKind, _client: &SignalingBlob) -> Result<ProducerId> {
        // Publier un flux exige la boucle réseau (poll_output/handle_input)
        // tournant en tâche de fond, hors scope de ce spike (Phase B de
        // NODYX_MEDIA_ENGINE_RUST.md). Documenté plutôt que simulé : un stub
        // silencieux masquerait la vraie frontière de ce qui est prouvé.
        Err(MediaError::Unsupported("produce (str0m, Phase B : boucle réseau non câblée)"))
    }

    async fn consume(&self, _transport: &TransportHandle, _producer: &ProducerId, _client_caps: &SignalingBlob) -> Result<(ConsumerId, SignalingBlob)> {
        Err(MediaError::Unsupported("consume (str0m, Phase B : boucle réseau non câblée)"))
    }

    async fn close_producer(&self, _producer: &ProducerId) -> Result<()> {
        Ok(()) // idempotent par contrat du trait, rien à fermer tant que produce est Unsupported
    }

    async fn close_consumer(&self, _consumer: &ConsumerId) -> Result<()> {
        Ok(())
    }

    async fn close_transport(&self, transport: &TransportHandle) -> Result<()> {
        self.transports
            .lock()
            .map_err(|_| MediaError::Engine("verrou transports empoisonné".into()))?
            .remove(&transport.0);
        Ok(()) // idempotent : un transport déjà absent n'est pas une erreur
    }

    async fn resume_consumer(&self, _consumer: &ConsumerId) -> Result<()> {
        Ok(())
    }

    async fn consumer_state(&self, consumer: &ConsumerId) -> Result<SignalingBlob> {
        Ok(SignalingBlob(format!(
            "{{\"engine\":\"str0m\",\"consumer\":\"{consumer}\"}}"
        )))
    }

    async fn set_preferred_layer(&self, _consumer: &ConsumerId, _layer: Layer) -> Result<()> {
        Ok(()) // no-op audio, même contrat que NullEngine/MediasoupEngine
    }

    async fn pipe_to_remote(&self, _producer: &ProducerId, _node: &NodeId) -> Result<PipeHandle> {
        Err(MediaError::Unsupported("pipe_to_remote (str0m, fédération = Phase E)"))
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

    fn engine() -> Str0mEngine {
        Str0mEngine::new(
            "127.0.0.1".parse().unwrap(),
            "127.0.0.1".parse().unwrap(),
        )
    }

    #[tokio::test]
    async fn transport_params_contains_real_ice_and_dtls() {
        let engine = engine();
        let room = step_create_room(&engine).await;
        let transport = engine
            .create_transport(&room, ParticipantId("user-1".into()))
            .await
            .expect("create_transport");

        let params = engine.transport_params(&transport).await.expect("transport_params");

        // Un vrai SDP str0m contient ces marqueurs ICE/DTLS ; un blob vide ou
        // un stub mediasoup-like ("iceParameters") ne les aurait pas sous
        // cette forme textuelle. C'est la preuve que ce n'est pas simulé.
        assert!(params.0.contains("a=ice-ufrag"), "pas d'ice-ufrag dans l'offre : {}", params.0);
        assert!(params.0.contains("a=fingerprint"), "pas d'empreinte DTLS dans l'offre : {}", params.0);
        assert!(params.0.contains("a=candidate"), "pas de candidat ICE dans l'offre : {}", params.0);
    }

    #[tokio::test]
    async fn connect_transport_rejects_garbage_cleanly() {
        let engine = engine();
        let room = step_create_room(&engine).await;
        let transport = engine
            .create_transport(&room, ParticipantId("user-1".into()))
            .await
            .expect("create_transport");
        engine.transport_params(&transport).await.expect("transport_params");

        // Payload invalide : ni panique, ni succès silencieux. Même contrat
        // que le test `[W]` du spike mediasoup existant.
        let result = engine
            .connect_transport(&transport, &SignalingBlob("ceci n'est pas du SDP".into()))
            .await;
        assert!(result.is_err(), "un payload invalide doit être rejeté, pas accepté");
    }

    #[tokio::test]
    async fn connect_transport_without_params_is_a_clean_error() {
        let engine = engine();
        let room = step_create_room(&engine).await;
        let transport = engine
            .create_transport(&room, ParticipantId("user-1".into()))
            .await
            .expect("create_transport");

        // transport_params() jamais appelé : aucune offre en attente.
        let result = engine
            .connect_transport(&transport, &SignalingBlob("peu importe".into()))
            .await;
        assert!(matches!(result, Err(MediaError::Engine(_))));
    }

    #[tokio::test]
    async fn close_transport_is_idempotent() {
        let engine = engine();
        let room = step_create_room(&engine).await;
        let transport = engine
            .create_transport(&room, ParticipantId("user-1".into()))
            .await
            .expect("create_transport");

        engine.close_transport(&transport).await.expect("premier close");
        engine.close_transport(&transport).await.expect("second close : idempotent, pas une erreur");
    }

    #[tokio::test]
    async fn unsupported_operations_are_documented_not_silent() {
        let engine = engine();
        let room = step_create_room(&engine).await;
        let transport = engine
            .create_transport(&room, ParticipantId("user-1".into()))
            .await
            .expect("create_transport");

        let err = engine
            .produce(&transport, TrackKind::Audio, &SignalingBlob("{}".into()))
            .await
            .unwrap_err();
        assert!(matches!(err, MediaError::Unsupported(_)));
    }

    async fn step_create_room(engine: &Str0mEngine) -> RouterHandle {
        engine
            .create_room(RoomId("channel-spike".into()))
            .await
            .expect("create_room")
    }
}
