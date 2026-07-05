//! # MediasoupEngine — l'adaptateur mediasoup derrière le trait [`MediaEngine`]
//!
//! Étage 3 de la séparation hexagonale (CDC §18) : VoiceService (métier) →
//! MediaEngine (port) → **MediasoupEngine** (cet adaptateur). Aucune règle
//! Nodyx ici : uniquement la traduction du port vers l'API mediasoup
//! (Worker / Router / Transport / Producer / Consumer).
//!
//! Portée SPIKE (§15) : transports **Direct** (pas de navigateur), audio Opus
//! avec `RtpParameters` fabriqués en interne. La vraie négociation
//! codecs/capabilities client viendra avec le `CodecAdapter` (P1) : c'est LA
//! fuite d'abstraction identifiée au CDC, on la garde isolée ici.
//!
//! Les objets mediasoup se ferment au `Drop` : les registres ci-dessous les
//! gardent vivants tant que le port n'a pas demandé leur fermeture.

use std::collections::HashMap;
use std::num::{NonZeroU32, NonZeroU8};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use mediasoup::prelude::*;
use mediasoup::rtp_parameters::RtpCodecCapabilityFinalized;

use nodyx_sfu::{
    ConsumerId, EngineStats, Layer, MediaEngine, MediaError, NodeId, ParticipantId, PipeHandle,
    ProducerId, Result, RoomId, RouterHandle, StatsScope, TrackKind, TransportHandle,
};

// ── Codec du spike : Opus, aligné sur le vocal actuel (48 kHz, FEC) ─────────

fn opus_capability() -> RtpCodecCapability {
    RtpCodecCapability::Audio {
        mime_type: MimeTypeAudio::Opus,
        preferred_payload_type: None,
        clock_rate: NonZeroU32::new(48000).unwrap(),
        channels: NonZeroU8::new(2).unwrap(),
        parameters: RtpCodecParametersParameters::from([("useinbandfec", 1_u32.into())]),
        rtcp_feedback: vec![],
    }
}

fn opus_rtp_parameters(ssrc: u32) -> RtpParameters {
    RtpParameters {
        mid: None,
        codecs: vec![RtpCodecParameters::Audio {
            mime_type: MimeTypeAudio::Opus,
            payload_type: 100,
            clock_rate: NonZeroU32::new(48000).unwrap(),
            channels: NonZeroU8::new(2).unwrap(),
            parameters: RtpCodecParametersParameters::from([("useinbandfec", 1_u32.into())]),
            rtcp_feedback: vec![],
        }],
        header_extensions: vec![],
        encodings: vec![RtpEncodingParameters {
            ssrc: Some(ssrc),
            ..RtpEncodingParameters::default()
        }],
        rtcp: RtcpParameters::default(),
    }
}

/// Les capabilities "finalized" du router (payload types assignés) → les
/// capabilities d'un consommateur. Dans la vraie vie (P1), ces caps viennent
/// du CLIENT (navigateur) via le CodecAdapter ; pour le spike (transports
/// Direct, pas de navigateur), consommer avec les caps du router est le
/// comportement de référence des exemples mediasoup.
fn consumer_caps(finalized: &RtpCapabilitiesFinalized) -> RtpCapabilities {
    let codecs = finalized
        .codecs
        .iter()
        .filter_map(|c| match c {
            RtpCodecCapabilityFinalized::Audio {
                mime_type,
                preferred_payload_type,
                clock_rate,
                channels,
                parameters,
                rtcp_feedback,
            } => Some(RtpCodecCapability::Audio {
                mime_type: *mime_type,
                preferred_payload_type: Some(*preferred_payload_type),
                clock_rate: *clock_rate,
                channels: *channels,
                parameters: parameters.clone(),
                rtcp_feedback: rtcp_feedback.clone(),
            }),
            RtpCodecCapabilityFinalized::Video {
                mime_type,
                preferred_payload_type,
                clock_rate,
                parameters,
                rtcp_feedback,
            } => Some(RtpCodecCapability::Video {
                mime_type: *mime_type,
                preferred_payload_type: Some(*preferred_payload_type),
                clock_rate: *clock_rate,
                parameters: parameters.clone(),
                rtcp_feedback: rtcp_feedback.clone(),
            }),
            // Enum non_exhaustive : une variante future inconnue est ignorée.
            _ => None,
        })
        .collect();
    RtpCapabilities {
        codecs,
        header_extensions: finalized.header_extensions.clone(),
    }
}

// ── L'adaptateur ─────────────────────────────────────────────────────────────

struct Inner {
    manager: WorkerManager,
    worker: Worker,
    /// Workers supplémentaires (spike : le "nœud distant" a SON worker, car le
    /// pipe mediasoup relie des routers de workers DIFFÉRENTS ; en prod P1 :
    /// un worker par cœur CPU, même mécanique).
    extra_workers: Mutex<Vec<Worker>>,
    /// RouterHandle.0 → Router (un par salon).
    routers: Mutex<HashMap<String, Router>>,
    /// TransportHandle.0 → (transport, clé du router parent).
    transports: Mutex<HashMap<String, (DirectTransport, String)>>,
    /// ProducerId.0 → (Producer, clé du router qui l'héberge). Inclut les
    /// producers "pipés" (consommables côté nœud distant).
    producers: Mutex<HashMap<String, (Producer, String)>>,
    /// ConsumerId.0 → Consumer.
    consumers: Mutex<HashMap<String, Consumer>>,
    /// Nœuds SFU "distants" enregistrés (spike : autre Router local qui simule
    /// l'SFU d'une autre instance ; P4 : PipeTransport vers un vrai host).
    remote_nodes: Mutex<HashMap<String, Router>>,
    /// Garde en vie les consumers de pipe (côté source).
    pipes: Mutex<Vec<Consumer>>,
    seq: AtomicU64,
}

#[derive(Clone)]
pub struct MediasoupEngine {
    inner: Arc<Inner>,
}

impl MediasoupEngine {
    pub async fn new() -> Result<Self> {
        let manager = WorkerManager::new();
        let worker = manager
            .create_worker(WorkerSettings::default())
            .await
            .map_err(|e| MediaError::Engine(format!("create_worker: {e}")))?;
        Ok(Self {
            inner: Arc::new(Inner {
                manager,
                worker,
                extra_workers: Mutex::new(Vec::new()),
                routers: Mutex::new(HashMap::new()),
                transports: Mutex::new(HashMap::new()),
                producers: Mutex::new(HashMap::new()),
                consumers: Mutex::new(HashMap::new()),
                remote_nodes: Mutex::new(HashMap::new()),
                pipes: Mutex::new(Vec::new()),
                seq: AtomicU64::new(1),
            }),
        })
    }

    fn next(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.inner.seq.fetch_add(1, Ordering::Relaxed))
    }

    fn router_of(&self, key: &str) -> Result<Router> {
        self.inner
            .routers
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .ok_or_else(|| MediaError::NotFound(format!("router {key}")))
    }

    /// Enregistre un nœud SFU "distant" (spike : un Router d'un autre salon /
    /// worker local qui joue le rôle de l'SFU d'une autre instance).
    pub fn register_remote_node(&self, node: &NodeId, router: Router) {
        self.inner
            .remote_nodes
            .lock()
            .unwrap()
            .insert(node.0.clone(), router);
    }

    /// Accès au Router d'un salon (pour le scénario de pipe du spike).
    pub fn router_for_room(&self, room_router: &RouterHandle) -> Result<Router> {
        self.router_of(&room_router.0)
    }

    /// Crée un salon sur un worker DÉDIÉ (spike : simule l'SFU d'une autre
    /// instance ; le pipe mediasoup relie des routers de workers différents).
    pub async fn create_room_on_new_worker(&self, room: RoomId) -> Result<RouterHandle> {
        let worker = self
            .inner
            .manager
            .create_worker(WorkerSettings::default())
            .await
            .map_err(|e| MediaError::Engine(format!("create_worker(remote): {e}")))?;
        let router = worker
            .create_router(RouterOptions::new(vec![opus_capability()]))
            .await
            .map_err(|e| MediaError::Engine(format!("create_router({room}): {e}")))?;
        self.inner.extra_workers.lock().unwrap().push(worker);
        let key = self.next("router");
        self.inner.routers.lock().unwrap().insert(key.clone(), router);
        Ok(RouterHandle(key))
    }
}

impl MediaEngine for MediasoupEngine {
    async fn create_room(&self, room: RoomId) -> Result<RouterHandle> {
        let router = self
            .inner
            .worker
            .create_router(RouterOptions::new(vec![opus_capability()]))
            .await
            .map_err(|e| MediaError::Engine(format!("create_router({room}): {e}")))?;
        let key = self.next("router");
        self.inner.routers.lock().unwrap().insert(key.clone(), router);
        Ok(RouterHandle(key))
    }

    async fn create_transport(
        &self,
        router: &RouterHandle,
        _participant: ParticipantId,
    ) -> Result<TransportHandle> {
        let r = self.router_of(&router.0)?;
        let transport = r
            .create_direct_transport(DirectTransportOptions::default())
            .await
            .map_err(|e| MediaError::Engine(format!("create_transport: {e}")))?;
        let key = self.next("transport");
        self.inner
            .transports
            .lock()
            .unwrap()
            .insert(key.clone(), (transport, router.0.clone()));
        Ok(TransportHandle(key))
    }

    async fn produce(&self, transport: &TransportHandle, kind: TrackKind) -> Result<ProducerId> {
        if kind != TrackKind::Audio {
            // Spike audio-only (P1) : la vidéo/simulcast arrive en P2/P3.
            return Err(MediaError::Unsupported("produce non-audio (spike P1)"));
        }
        let (t, router_key) = {
            let map = self.inner.transports.lock().unwrap();
            map.get(&transport.0)
                .map(|(t, rk)| (t.clone(), rk.clone()))
                .ok_or_else(|| MediaError::NotFound(format!("transport {}", transport.0)))?
        };
        let ssrc = 1000 + self.inner.seq.fetch_add(1, Ordering::Relaxed) as u32;
        let producer = t
            .produce(ProducerOptions::new(
                MediaKind::Audio,
                opus_rtp_parameters(ssrc),
            ))
            .await
            .map_err(|e| MediaError::Engine(format!("produce: {e}")))?;
        let key = producer.id().to_string();
        self.inner
            .producers
            .lock()
            .unwrap()
            .insert(key.clone(), (producer, router_key));
        Ok(ProducerId(key))
    }

    async fn consume(
        &self,
        transport: &TransportHandle,
        producer: &ProducerId,
    ) -> Result<ConsumerId> {
        let (t, router_key) = {
            let map = self.inner.transports.lock().unwrap();
            map.get(&transport.0)
                .map(|(t, rk)| (t.clone(), rk.clone()))
                .ok_or_else(|| MediaError::NotFound(format!("transport {}", transport.0)))?
        };
        let ms_producer_id = {
            let map = self.inner.producers.lock().unwrap();
            map.get(&producer.0)
                .map(|(p, _)| p.id())
                .ok_or_else(|| MediaError::NotFound(format!("producer {}", producer.0)))?
        };
        // Spike : on consomme avec les capabilities du router (transports Direct).
        // La vraie négociation avec les capabilities du CLIENT = CodecAdapter (P1).
        let caps = consumer_caps(self.router_of(&router_key)?.rtp_capabilities());
        let consumer = t
            .consume(ConsumerOptions::new(ms_producer_id, caps))
            .await
            .map_err(|e| MediaError::Engine(format!("consume: {e}")))?;
        let key = consumer.id().to_string();
        self.inner.consumers.lock().unwrap().insert(key.clone(), consumer);
        Ok(ConsumerId(key))
    }

    async fn set_preferred_layer(&self, _consumer: &ConsumerId, _layer: Layer) -> Result<()> {
        // Audio : pas de couches. Deviendra réel avec le simulcast vidéo (P3).
        Ok(())
    }

    async fn pipe_to_remote(&self, producer: &ProducerId, node: &NodeId) -> Result<PipeHandle> {
        let remote_router = {
            let map = self.inner.remote_nodes.lock().unwrap();
            map.get(&node.0)
                .cloned()
                .ok_or_else(|| MediaError::NotFound(format!("nœud distant {}", node.0)))?
        };
        // Router source = celui qui héberge le producer (tracé au produce()).
        let (ms_producer_id, source_router) = {
            let producers = self.inner.producers.lock().unwrap();
            let (p, rk) = producers
                .get(&producer.0)
                .ok_or_else(|| MediaError::NotFound(format!("producer {}", producer.0)))?;
            (p.id(), self.router_of(rk)?)
        };
        let pair = source_router
            .pipe_producer_to_router(ms_producer_id, PipeToRouterOptions::new(remote_router))
            .await
            .map_err(|e| MediaError::Engine(format!("pipe_to_remote: {e}")))?;

        // Le producer "pipé" vit sur le router DISTANT : on l'enregistre pour
        // que consume() le trouve côté nœud distant. Le consumer de pipe (côté
        // source) est gardé en vie, sinon Drop = pipe fermé.
        let piped = pair.pipe_producer.into_inner();
        // Sémantique mediasoup : le producer pipé garde le MÊME uuid que
        // l'original. Clé distincte obligatoire, sinon insert() écrase (et
        // droppe = ferme) l'original, et tout le pipe s'effondre en cascade.
        let piped_key = format!("piped-{}", piped.id());
        self.inner
            .producers
            .lock()
            .unwrap()
            .insert(piped_key.clone(), (piped, String::new()));
        self.inner.pipes.lock().unwrap().push(pair.pipe_consumer);
        Ok(PipeHandle(format!("pipe-{piped_key}")))
    }

    async fn stats(&self, _scope: StatsScope) -> Result<EngineStats> {
        // Spike : stats réelles branchées en P1 (get_stats() par entité).
        Ok(EngineStats::default())
    }

    async fn close_room(&self, router: RouterHandle) -> Result<()> {
        // Drop du Router = fermeture mediasoup (RAII). On retire aussi les
        // entités enfants pour ne pas retenir de handles morts.
        let removed = self.inner.routers.lock().unwrap().remove(&router.0);
        if removed.is_none() {
            return Err(MediaError::NotFound(format!("router {}", router.0)));
        }
        self.inner
            .transports
            .lock()
            .unwrap()
            .retain(|_, (_, rk)| rk != &router.0);
        Ok(())
    }
}
