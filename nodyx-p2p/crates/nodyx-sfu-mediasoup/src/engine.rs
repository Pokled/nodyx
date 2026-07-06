//! # MediasoupEngine — l'adaptateur mediasoup derrière le trait [`MediaEngine`]
//!
//! Étage 3 de la séparation hexagonale (CDC §18) : VoiceService (métier) →
//! MediaEngine (port) → **MediasoupEngine** (cet adaptateur). Aucune règle
//! Nodyx ici : uniquement la traduction du port vers l'API mediasoup
//! (Worker / Router / Transport / Producer / Consumer).
//!
//! Deux modes de transport :
//! - **Direct** (défaut) : pas de navigateur, `RtpParameters` fabriqués en
//!   interne. Sert aux scénarios automatisés (spike, futurs tests d'intégration).
//! - **WebRTC** (`new_webrtc`) : vrais `WebRtcTransport` (ICE/DTLS/SRTP), les
//!   paramètres transitent en blobs de signaling opaques (P1).
//!
//! La négociation codecs/capabilities vit ICI (sérialisation serde des types
//! mediasoup) : c'est LA fuite d'abstraction identifiée au CDC (CodecAdapter),
//! confinée dans l'adaptateur.
//!
//! Enseignements du spike (payés en heures de debug, ne pas re-perdre) :
//! - les objets mediasoup se ferment au `Drop` → registres de rétention ;
//! - le pipe relie des routers de workers DIFFÉRENTS (intra-worker : collision
//!   d'ID de handler) ;
//! - le producer pipé conserve l'UUID de l'original → clé de registre
//!   distincte obligatoire, sinon l'insert droppe l'original (cascade).

use std::collections::HashMap;
use std::net::IpAddr;
use std::num::{NonZeroU32, NonZeroU8};
use std::ops::RangeInclusive;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use mediasoup::prelude::*;
use mediasoup::rtp_parameters::RtpCodecCapabilityFinalized;

use nodyx_sfu::{
    ConsumerId, EngineStats, Layer, MediaEngine, MediaError, NodeId, ParticipantId, PipeHandle,
    ProducerId, Result, RoomId, RouterHandle, SignalingBlob, StatsScope, TrackKind,
    TransportHandle,
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
/// capabilities d'un consommateur. Utilisé quand le client n'a pas fourni les
/// siennes (mode Direct) ; en WebRTC le client envoie les siennes via le blob.
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

// ── Transports : Direct (scénarios auto) ou WebRTC (vrais clients) ──────────

enum AnyTransport {
    Direct(DirectTransport),
    WebRtc(WebRtcTransport),
}

// ── L'adaptateur ─────────────────────────────────────────────────────────────

struct Inner {
    manager: WorkerManager,
    worker: Worker,
    /// Plage de ports UDP RTC des workers. Le défaut mediasoup (10000..=59999)
    /// est un piège firewall (leçon nexus-turn) : on borne TOUJOURS, et la
    /// même plage vaut pour tous les workers (mediasoup saute les ports pris).
    rtc_ports: RangeInclusive<u16>,
    /// Mode WebRTC : IP d'écoute (+ adresse annoncée aux clients, ex: IP
    /// publique du VPS). `None` = transports Direct.
    webrtc_listen: Option<(IpAddr, Option<String>)>,
    /// Workers supplémentaires (spike : le "nœud distant" a SON worker, car le
    /// pipe mediasoup relie des routers de workers DIFFÉRENTS ; en prod P1 :
    /// un worker par cœur CPU, même mécanique).
    extra_workers: Mutex<Vec<Worker>>,
    /// RouterHandle.0 → Router (un par salon).
    routers: Mutex<HashMap<String, Router>>,
    /// TransportHandle.0 → (transport, clé du router parent).
    transports: Mutex<HashMap<String, (Arc<AnyTransport>, String)>>,
    /// ProducerId.0 → (Producer, clé du router qui l'héberge). Inclut les
    /// producers "pipés" (consommables côté nœud distant, clé `piped-<uuid>`).
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

/// Plage RTC par défaut : 1000 ports = ~500 participants (paire send+recv),
/// large pour une instance, étroite pour un firewall.
pub const DEFAULT_RTC_PORTS: RangeInclusive<u16> = 40000..=40999;

fn worker_settings(rtc_ports: &RangeInclusive<u16>) -> WorkerSettings {
    let mut s = WorkerSettings::default();
    s.rtc_port_range = rtc_ports.clone();
    s
}

impl MediasoupEngine {
    /// Mode Direct (scénarios automatisés, pas de navigateur).
    pub async fn new() -> Result<Self> {
        Self::build(None, DEFAULT_RTC_PORTS).await
    }

    /// Mode WebRTC : vrais transports ICE/DTLS. `listen_ip` = IP d'écoute
    /// locale, `announced` = adresse annoncée aux clients (IP publique),
    /// `rtc_ports` = plage UDP à ouvrir au firewall (et RIEN d'autre).
    pub async fn new_webrtc(
        listen_ip: IpAddr,
        announced: Option<String>,
        rtc_ports: RangeInclusive<u16>,
    ) -> Result<Self> {
        Self::build(Some((listen_ip, announced)), rtc_ports).await
    }

    async fn build(
        webrtc_listen: Option<(IpAddr, Option<String>)>,
        rtc_ports: RangeInclusive<u16>,
    ) -> Result<Self> {
        if rtc_ports.is_empty() {
            return Err(MediaError::Engine("plage RTC vide (min > max)".into()));
        }
        let manager = WorkerManager::new();
        let worker = manager
            .create_worker(worker_settings(&rtc_ports))
            .await
            .map_err(|e| MediaError::Engine(format!("create_worker: {e}")))?;
        Ok(Self {
            inner: Arc::new(Inner {
                manager,
                worker,
                rtc_ports,
                webrtc_listen,
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

    fn transport_of(&self, key: &str) -> Result<(Arc<AnyTransport>, String)> {
        self.inner
            .transports
            .lock()
            .unwrap()
            .get(key)
            .map(|(t, rk)| (Arc::clone(t), rk.clone()))
            .ok_or_else(|| MediaError::NotFound(format!("transport {key}")))
    }

    /// Enregistre un nœud SFU "distant" (spike : un Router d'un autre worker
    /// local qui joue le rôle de l'SFU d'une autre instance).
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
            .create_worker(worker_settings(&self.inner.rtc_ports))
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

    async fn room_capabilities(&self, router: &RouterHandle) -> Result<SignalingBlob> {
        let r = self.router_of(&router.0)?;
        let json = serde_json::to_string(r.rtp_capabilities())
            .map_err(|e| MediaError::Engine(format!("caps serde: {e}")))?;
        Ok(SignalingBlob(json))
    }

    async fn create_transport(
        &self,
        router: &RouterHandle,
        _participant: ParticipantId,
    ) -> Result<TransportHandle> {
        let r = self.router_of(&router.0)?;
        let transport = match &self.inner.webrtc_listen {
            None => AnyTransport::Direct(
                r.create_direct_transport(DirectTransportOptions::default())
                    .await
                    .map_err(|e| MediaError::Engine(format!("create_transport(direct): {e}")))?,
            ),
            Some((ip, announced)) => {
                let listen = ListenInfo {
                    protocol: Protocol::Udp,
                    ip: *ip,
                    announced_address: announced.clone(),
                    port: None,
                    port_range: None,
                    flags: None,
                    send_buffer_size: None,
                    recv_buffer_size: None,
                };
                AnyTransport::WebRtc(
                    r.create_webrtc_transport(WebRtcTransportOptions::new(
                        WebRtcTransportListenInfos::new(listen),
                    ))
                    .await
                    .map_err(|e| MediaError::Engine(format!("create_transport(webrtc): {e}")))?,
                )
            }
        };
        let key = self.next("transport");
        self.inner
            .transports
            .lock()
            .unwrap()
            .insert(key.clone(), (Arc::new(transport), router.0.clone()));
        Ok(TransportHandle(key))
    }

    async fn transport_params(&self, transport: &TransportHandle) -> Result<SignalingBlob> {
        let (t, _) = self.transport_of(&transport.0)?;
        match t.as_ref() {
            AnyTransport::Direct(_) => Ok(SignalingBlob("{\"kind\":\"direct\"}".into())),
            AnyTransport::WebRtc(w) => {
                let json = serde_json::json!({
                    "id": transport.0,
                    "iceParameters": w.ice_parameters(),
                    "iceCandidates": w.ice_candidates(),
                    "dtlsParameters": w.dtls_parameters(),
                });
                Ok(SignalingBlob(json.to_string()))
            }
        }
    }

    async fn connect_transport(
        &self,
        transport: &TransportHandle,
        client: &SignalingBlob,
    ) -> Result<()> {
        let (t, _) = self.transport_of(&transport.0)?;
        match t.as_ref() {
            AnyTransport::Direct(_) => Ok(()), // rien à connecter en Direct
            AnyTransport::WebRtc(w) => {
                #[derive(serde::Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct ConnectPayload {
                    dtls_parameters: DtlsParameters,
                }
                let payload: ConnectPayload = serde_json::from_str(&client.0)
                    .map_err(|e| MediaError::Engine(format!("connect payload: {e}")))?;
                w.connect(WebRtcTransportRemoteParameters {
                    dtls_parameters: payload.dtls_parameters,
                })
                .await
                .map_err(|e| MediaError::Engine(format!("connect: {e}")))
            }
        }
    }

    async fn produce(
        &self,
        transport: &TransportHandle,
        kind: TrackKind,
        client: &SignalingBlob,
    ) -> Result<ProducerId> {
        if kind != TrackKind::Audio {
            // P1 = audio. La vidéo/simulcast arrive en P2/P3.
            return Err(MediaError::Unsupported("produce non-audio (P1 audio)"));
        }
        let (t, router_key) = self.transport_of(&transport.0)?;
        // Paramètres RTP du client si fournis (WebRTC), sinon fabriqués (Direct).
        let rtp: RtpParameters = match serde_json::from_str(&client.0) {
            Ok(p) => p,
            Err(_) => {
                let ssrc = 1000 + self.inner.seq.fetch_add(1, Ordering::Relaxed) as u32;
                opus_rtp_parameters(ssrc)
            }
        };
        let options = ProducerOptions::new(MediaKind::Audio, rtp);
        let producer = match t.as_ref() {
            AnyTransport::Direct(d) => d.produce(options).await,
            AnyTransport::WebRtc(w) => w.produce(options).await,
        }
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
        client_caps: &SignalingBlob,
    ) -> Result<(ConsumerId, SignalingBlob)> {
        let (t, router_key) = self.transport_of(&transport.0)?;
        let ms_producer_id = {
            let map = self.inner.producers.lock().unwrap();
            map.get(&producer.0)
                .map(|(p, _)| p.id())
                .ok_or_else(|| MediaError::NotFound(format!("producer {}", producer.0)))?
        };
        // Capabilities du client si fournies (WebRTC), sinon celles du router
        // (Direct). C'est le cœur du futur CodecAdapter.
        let caps: RtpCapabilities = match serde_json::from_str(&client_caps.0) {
            Ok(c) => c,
            Err(_) => consumer_caps(self.router_of(&router_key)?.rtp_capabilities()),
        };
        let options = ConsumerOptions::new(ms_producer_id, caps);
        let consumer = match t.as_ref() {
            AnyTransport::Direct(d) => d.consume(options).await,
            AnyTransport::WebRtc(w) => w.consume(options).await,
        }
        .map_err(|e| MediaError::Engine(format!("consume: {e}")))?;
        // Ce que le client doit appliquer pour recevoir le flux.
        let params = serde_json::json!({
            "id": consumer.id(),
            "producerId": ms_producer_id,
            "kind": consumer.kind(),
            "rtpParameters": consumer.rtp_parameters(),
        });
        let key = consumer.id().to_string();
        self.inner.consumers.lock().unwrap().insert(key.clone(), consumer);
        Ok((ConsumerId(key), SignalingBlob(params.to_string())))
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
        // que consume() le trouve côté nœud distant. Sémantique mediasoup : il
        // garde le MÊME uuid que l'original → clé distincte obligatoire, sinon
        // insert() écrase (et droppe = ferme) l'original, cascade fatale.
        let piped = pair.pipe_producer.into_inner();
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
