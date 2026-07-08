//! # sfu-bench — canon de charge du SFU (LOCAL uniquement, jamais exposé)
//!
//! Attaque notre propre moteur mediasoup avec N participants synthétiques et
//! mesure le VRAI coût de forwarding, sans navigateur : chaque participant
//! publie de l'audio Opus (RTP injecté via DirectTransport au rythme réel,
//! 1 paquet/20 ms) et consomme les flux de TOUS les autres. Le routeur forwarde
//! donc N×(N-1) chemins. On mesure, par palier de N :
//!   - **CPU** (cœurs occupés) — le worker mediasoup tourne in-process (threads),
//!     donc le CPU du process = le coût du SFU + l'injection (dominée par le
//!     forwarding à grand N).
//!   - **RSS** (mémoire résidente).
//!   - **santé du forwarding** : paquets reçus / attendus (100 % = rien perdu ;
//!     < 100 % = le moteur décroche = on approche du point de rupture).
//!   - latence de mise en place.
//!
//! DirectTransport = in-process, aucun port UDP → aucun impact firewall, aucune
//! interférence avec le daemon de prod (worker séparé). À lancer niceé.
//!
//! Usage :
//!   sfu-bench [stages]                un salon full-mesh (pire cas). ex: 2,5,10,20,30
//!   sfu-bench rooms <P/salon> <nb,…>  K salons de P participants sur un pool de workers
//!   sfu-bench watch <diffuseurs> <N,…> 1 pièce : D qui parlent + N spectateurs (cas réel)
//!   SFU_BENCH_WINDOW_S=4              durée de mesure par palier (défaut 4 s)
//!   SFU_BENCH_WORKERS=<n>            taille du pool en mode "rooms" (défaut = cœurs)

use std::num::{NonZeroU32, NonZeroU8};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use mediasoup::prelude::*;
use mediasoup::rtp_parameters::RtpCodecCapabilityFinalized;

type R<T> = Result<T, Box<dyn std::error::Error>>;

const CLK_TCK: f64 = 100.0; // _SC_CLK_TCK standard Linux
const PACKET_MS: u64 = 20; // Opus : 1 paquet / 20 ms
const PAYLOAD: usize = 80; // ~ trame Opus (~32 kbps)

// ── Mesure ressources (in-process, /proc/self) ──────────────────────────────

fn cpu_ticks() -> u64 {
    // utime (14) + stime (15) de /proc/self/stat. Le comm (champ 2) peut
    // contenir des espaces/parenthèses → on coupe après le dernier ") ".
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let after = stat.rsplit_once(") ").map(|x| x.1).unwrap_or("");
    let f: Vec<&str> = after.split_whitespace().collect();
    // après ") ", index 0 = état (champ 3) → utime = index 11, stime = index 12.
    let utime: u64 = f.get(11).and_then(|s| s.parse().ok()).unwrap_or(0);
    let stime: u64 = f.get(12).and_then(|s| s.parse().ok()).unwrap_or(0);
    utime + stime
}

fn rss_mb() -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .unwrap_or_default()
        .lines()
        .find(|l| l.starts_with("VmRSS:"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u64>().ok())
        .map(|kb| kb / 1024)
        .unwrap_or(0)
}

// ── Codec Opus + paquet RTP ─────────────────────────────────────────────────

fn opus_capability() -> RtpCodecCapability {
    RtpCodecCapability::Audio {
        mime_type: MimeTypeAudio::Opus,
        preferred_payload_type: None,
        clock_rate: NonZeroU32::new(48000).unwrap(),
        channels: NonZeroU8::new(2).unwrap(),
        parameters: RtpCodecParametersParameters::default(),
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
            parameters: RtpCodecParametersParameters::default(),
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
            _ => None,
        })
        .collect();
    RtpCapabilities {
        codecs,
        header_extensions: finalized.header_extensions.clone(),
    }
}

fn rtp_packet(ssrc: u32, seq: u16, ts: u32) -> Vec<u8> {
    let mut p = Vec::with_capacity(12 + PAYLOAD);
    p.push(0x80); // V=2, pas de padding/ext/CSRC
    p.push(100); // PT=100 (Opus), pas de marker
    p.extend_from_slice(&seq.to_be_bytes());
    p.extend_from_slice(&ts.to_be_bytes());
    p.extend_from_slice(&ssrc.to_be_bytes());
    p.extend_from_slice(&[0u8; PAYLOAD]);
    p
}

// ── Un salon full-mesh (réutilisé par le mode simple ET multi-salons) ─────────

/// Tout ce qu'il faut garder vivant pendant la mesure d'un salon : les transports
/// et consumers (Drop = fermeture mediasoup) + les producers (à injecter).
struct RoomLoad {
    _sends: Vec<DirectTransport>,
    _recvs: Vec<DirectTransport>,
    _consumers: Vec<Consumer>,
    producers: Vec<(Producer, u32)>,
}

/// Monte un salon : `per_room` participants, chacun publie de l'audio et consomme
/// TOUS les autres (full-mesh, per_room×(per_room-1) chemins). `ssrc_base` assure
/// des SSRC uniques entre salons.
async fn build_room(
    router: &Router,
    per_room: usize,
    received: &Arc<AtomicU64>,
    ssrc_base: u32,
) -> R<RoomLoad> {
    let caps = consumer_caps(router.rtp_capabilities());
    let mut producers = Vec::with_capacity(per_room);
    let mut sends = Vec::with_capacity(per_room);
    let mut recvs = Vec::with_capacity(per_room);
    for i in 0..per_room {
        let send_t = router.create_direct_transport(DirectTransportOptions::default()).await?;
        let ssrc = ssrc_base + i as u32;
        let prod = send_t
            .produce(ProducerOptions::new(MediaKind::Audio, opus_rtp_parameters(ssrc)))
            .await?;
        let recv_t = router.create_direct_transport(DirectTransportOptions::default()).await?;
        producers.push((prod, ssrc));
        sends.push(send_t);
        recvs.push(recv_t);
    }
    let mut consumers = Vec::with_capacity(per_room * per_room.saturating_sub(1));
    for (i, recv_t) in recvs.iter().enumerate() {
        for (j, (prod, _)) in producers.iter().enumerate() {
            if i == j {
                continue;
            }
            let c = recv_t
                .consume(ConsumerOptions::new(prod.id(), caps.clone()))
                .await?;
            let recv = Arc::clone(received);
            // .detach() : sinon le HandlerId est droppé et le callback retiré
            // AUSSITÔT (#[must_use]) → 0 paquet reçu. Le piège du bench.
            c.on_rtp(move |_pkt| {
                recv.fetch_add(1, Ordering::Relaxed);
            })
            .detach();
            consumers.push(c);
        }
    }
    Ok(RoomLoad { _sends: sends, _recvs: recvs, _consumers: consumers, producers })
}

// ── Un palier ────────────────────────────────────────────────────────────────

struct StageResult {
    n: usize,
    setup_ms: u128,
    cores_used: f64,
    rss_mb: u64,
    expected: u64,
    received: u64,
    health_pct: f64,
}

async fn run_stage(manager: &WorkerManager, n: usize, window: Duration) -> R<StageResult> {
    let worker = manager.create_worker(WorkerSettings::default()).await?;
    let router = worker.create_router(RouterOptions::new(vec![opus_capability()])).await?;
    let received = Arc::new(AtomicU64::new(0));
    let setup = Instant::now();
    let room = build_room(&router, n, &received, 2000).await?;
    let setup_ms = setup.elapsed().as_millis();

    // Chauffe (établissement des consumers) puis état stable mesuré.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let cpu0 = cpu_ticks();
    let recv0 = received.load(Ordering::Relaxed);
    let t0 = Instant::now();
    let deadline = t0 + window;
    // UNE tâche d'injection PAR participant (comme la réalité : chaque client
    // émet indépendamment). Évite qu'un injecteur mono-tâche devienne le
    // goulot et fausse la mesure du SFU.
    let mut injectors = Vec::with_capacity(n);
    for (prod, ssrc) in room.producers.iter() {
        let prod = prod.clone();
        let ssrc = *ssrc;
        injectors.push(tokio::spawn(async move {
            let mut seq = 0u16;
            let mut ts = 0u32;
            let mut ticker = tokio::time::interval(Duration::from_millis(PACKET_MS));
            while Instant::now() < deadline {
                ticker.tick().await;
                if let Producer::Direct(dp) = &prod {
                    let _ = dp.send(rtp_packet(ssrc, seq, ts));
                }
                seq = seq.wrapping_add(1);
                ts = ts.wrapping_add(960);
            }
        }));
    }
    for h in injectors {
        let _ = h.await;
    }
    let wall = t0.elapsed().as_secs_f64();
    let cpu_delta = cpu_ticks().saturating_sub(cpu0);
    let received_delta = received.load(Ordering::Relaxed).saturating_sub(recv0);

    let cores_used = (cpu_delta as f64 / CLK_TCK) / wall;
    let pkts_per_prod = (wall / (PACKET_MS as f64 / 1000.0)) as u64;
    let expected = pkts_per_prod * n as u64 * (n as u64).saturating_sub(1);
    let health_pct = if expected > 0 {
        (received_delta as f64 / expected as f64) * 100.0
    } else {
        100.0
    };

    Ok(StageResult {
        n,
        setup_ms,
        cores_used,
        rss_mb: rss_mb(),
        expected,
        received: received_delta,
        health_pct,
    })
    // Drop de worker/router/transports/producers/consumers = fermeture mediasoup.
}

// ── Un palier multi-salons (prouve le pool : les salons s'étalent sur les cœurs) ─

struct MultiResult {
    rooms: usize,
    per_room: usize,
    total: usize,
    setup_ms: u128,
    cores_used: f64,
    rss_mb: u64,
    expected: u64,
    received: u64,
    health_pct: f64,
    distribution: Vec<usize>,
}

/// `rooms` salons de `per_room` participants, répartis sur un pool de `pool`
/// workers (least-loaded, exactement la règle du moteur). Le CPU total peut alors
/// dépasser 1 cœur (jusqu'à `pool`) : c'est la preuve visuelle du pool.
async fn run_multi_stage(pool: usize, rooms: usize, per_room: usize, window: Duration) -> R<MultiResult> {
    let manager = WorkerManager::new();
    let mut workers = Vec::with_capacity(pool);
    for _ in 0..pool {
        workers.push(manager.create_worker(WorkerSettings::default()).await?);
    }
    let mut distribution = vec![0usize; pool];
    let received = Arc::new(AtomicU64::new(0));

    let setup = Instant::now();
    let mut room_loads = Vec::with_capacity(rooms);
    let mut routers = Vec::with_capacity(rooms);
    for r in 0..rooms {
        // Worker le moins chargé : même règle que le pool du moteur.
        let idx = distribution
            .iter()
            .enumerate()
            .min_by_key(|(_, n)| **n)
            .map(|(i, _)| i)
            .unwrap_or(0);
        distribution[idx] += 1;
        let router = workers[idx]
            .create_router(RouterOptions::new(vec![opus_capability()]))
            .await?;
        let rl = build_room(&router, per_room, &received, 2000 + (r as u32) * 1000).await?;
        room_loads.push(rl);
        routers.push(router);
    }
    let setup_ms = setup.elapsed().as_millis();

    tokio::time::sleep(Duration::from_millis(500)).await;
    let cpu0 = cpu_ticks();
    let recv0 = received.load(Ordering::Relaxed);
    let t0 = Instant::now();
    let deadline = t0 + window;
    let mut injectors = Vec::new();
    for rl in &room_loads {
        for (prod, ssrc) in &rl.producers {
            let prod = prod.clone();
            let ssrc = *ssrc;
            injectors.push(tokio::spawn(async move {
                let mut seq = 0u16;
                let mut ts = 0u32;
                let mut ticker = tokio::time::interval(Duration::from_millis(PACKET_MS));
                while Instant::now() < deadline {
                    ticker.tick().await;
                    if let Producer::Direct(dp) = &prod {
                        let _ = dp.send(rtp_packet(ssrc, seq, ts));
                    }
                    seq = seq.wrapping_add(1);
                    ts = ts.wrapping_add(960);
                }
            }));
        }
    }
    for h in injectors {
        let _ = h.await;
    }
    let wall = t0.elapsed().as_secs_f64();
    let cpu_delta = cpu_ticks().saturating_sub(cpu0);
    let received_delta = received.load(Ordering::Relaxed).saturating_sub(recv0);

    let cores_used = (cpu_delta as f64 / CLK_TCK) / wall;
    let pkts_per_prod = (wall / (PACKET_MS as f64 / 1000.0)) as u64;
    // full-mesh PAR salon (per_room×(per_room-1)) × nombre de salons.
    let expected =
        pkts_per_prod * per_room as u64 * (per_room as u64).saturating_sub(1) * rooms as u64;
    let health_pct = if expected > 0 {
        (received_delta as f64 / expected as f64) * 100.0
    } else {
        100.0
    };

    Ok(MultiResult {
        rooms,
        per_room,
        total: rooms * per_room,
        setup_ms,
        cores_used,
        rss_mb: rss_mb(),
        expected,
        received: received_delta,
        health_pct,
        distribution,
    })
    // Drop du pool de workers = fermeture mediasoup, salon par salon.
}

/// Mode multi-salons : `sfu-bench rooms <participants/salon> <nb_salons,...>`
/// Pool = SFU_BENCH_WORKERS (défaut = cœurs de la machine).
async fn run_multi(cores: usize, window: Duration, args: &[String]) -> R<()> {
    let per_room: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(50);
    let room_stages: Vec<usize> = args
        .get(3)
        .map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).filter(|&r| r >= 1).collect())
        .unwrap_or_else(|| vec![1, 2, 4, 6]);
    let pool: usize = std::env::var("SFU_BENCH_WORKERS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(cores)
        .max(1);

    eprintln!(
        "── sfu-bench MULTI-SALONS : {cores} cœurs, pool {pool} workers, {per_room} participants/salon, paliers {room_stages:?}, fenêtre {}s ──",
        window.as_secs()
    );
    eprintln!("   (le pool étale les salons sur les workers → le CPU total doit dépasser 1 cœur)\n");
    println!(
        "{:>6} | {:>7} | {:>6} | {:>7} | {:>9} | répartition/worker",
        "salons", "total", "RSS", "CPU", "santé"
    );
    println!("{:->6}-+-{:->7}-+-{:->6}-+-{:->7}-+-{:->9}-+--------------------", "", "", "", "", "");

    let mut results = Vec::new();
    for &rooms in &room_stages {
        let r = run_multi_stage(pool, rooms, per_room, window).await?;
        let verdict = if r.health_pct >= 99.0 {
            "OK"
        } else if r.health_pct >= 90.0 {
            "tendu"
        } else {
            "RUPTURE"
        };
        println!(
            "{:>6} | {:>7} | {:>4}Mo | {:>5.2}c | {:>7.1}% | {:?}  {}",
            r.rooms, r.total, r.rss_mb, r.cores_used, r.health_pct, r.distribution, verdict
        );
        results.push(r);
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    let json = serde_json::json!({
        "mode": "multi-rooms",
        "cores": cores,
        "pool_workers": pool,
        "per_room": per_room,
        "window_s": window.as_secs(),
        "stages": results.iter().map(|r| serde_json::json!({
            "rooms": r.rooms,
            "per_room": r.per_room,
            "total_participants": r.total,
            "setup_ms": r.setup_ms,
            "cpu_cores_used": (r.cores_used * 1000.0).round() / 1000.0,
            "cpu_pct_of_box": ((r.cores_used / cores as f64) * 1000.0).round() / 10.0,
            "rss_mb": r.rss_mb,
            "expected_pkts": r.expected,
            "received_pkts": r.received,
            "forward_health_pct": (r.health_pct * 10.0).round() / 10.0,
            "worker_distribution": r.distribution,
        })).collect::<Vec<_>>(),
    });
    eprintln!("\n── JSON ──");
    println!("{}", serde_json::to_string_pretty(&json)?);
    Ok(())
}

// ── Watch-party : le cas réel (peu parlent, beaucoup écoutent), en étoile ─────

struct WatchResult {
    publishers: usize,
    spectators: usize,
    setup_ms: u128,
    cores_used: f64,
    rss_mb: u64,
    expected: u64,
    received: u64,
    health_pct: f64,
    paths: usize,
}

/// Une pièce, `publishers` qui diffusent (parlent) + `spectators` qui écoutent
/// tout le monde. Coût de forwarding = publishers×spectators chemins (linéaire),
/// pas N×(N-1) : c'est pour ça que la capacité réelle explose. Tout sur UN cœur.
async fn run_watch_stage(publishers: usize, spectators: usize, window: Duration) -> R<WatchResult> {
    let manager = WorkerManager::new();
    let worker = manager.create_worker(WorkerSettings::default()).await?;
    let router = worker.create_router(RouterOptions::new(vec![opus_capability()])).await?;
    let caps = consumer_caps(router.rtp_capabilities());
    let received = Arc::new(AtomicU64::new(0));

    let setup = Instant::now();
    // Les diffuseurs (ceux qui parlent).
    let mut producers = Vec::with_capacity(publishers);
    let mut send_transports = Vec::with_capacity(publishers);
    for i in 0..publishers {
        let send_t = router.create_direct_transport(DirectTransportOptions::default()).await?;
        let ssrc = 5000 + i as u32;
        let prod = send_t
            .produce(ProducerOptions::new(MediaKind::Audio, opus_rtp_parameters(ssrc)))
            .await?;
        producers.push((prod, ssrc));
        send_transports.push(send_t);
    }
    // Les spectateurs : chacun consomme TOUS les diffuseurs.
    let mut recv_transports = Vec::with_capacity(spectators);
    let mut consumers = Vec::with_capacity(spectators * publishers.max(1));
    for _ in 0..spectators {
        let recv_t = router.create_direct_transport(DirectTransportOptions::default()).await?;
        for (prod, _) in producers.iter() {
            let c = recv_t
                .consume(ConsumerOptions::new(prod.id(), caps.clone()))
                .await?;
            let recv = Arc::clone(&received);
            c.on_rtp(move |_pkt| {
                recv.fetch_add(1, Ordering::Relaxed);
            })
            .detach();
            consumers.push(c);
        }
        recv_transports.push(recv_t);
    }
    let setup_ms = setup.elapsed().as_millis();

    tokio::time::sleep(Duration::from_millis(500)).await;
    let cpu0 = cpu_ticks();
    let recv0 = received.load(Ordering::Relaxed);
    let t0 = Instant::now();
    let deadline = t0 + window;
    let mut injectors = Vec::with_capacity(publishers);
    for (prod, ssrc) in producers.iter() {
        let prod = prod.clone();
        let ssrc = *ssrc;
        injectors.push(tokio::spawn(async move {
            let mut seq = 0u16;
            let mut ts = 0u32;
            let mut ticker = tokio::time::interval(Duration::from_millis(PACKET_MS));
            while Instant::now() < deadline {
                ticker.tick().await;
                if let Producer::Direct(dp) = &prod {
                    let _ = dp.send(rtp_packet(ssrc, seq, ts));
                }
                seq = seq.wrapping_add(1);
                ts = ts.wrapping_add(960);
            }
        }));
    }
    for h in injectors {
        let _ = h.await;
    }
    let wall = t0.elapsed().as_secs_f64();
    let cpu_delta = cpu_ticks().saturating_sub(cpu0);
    let received_delta = received.load(Ordering::Relaxed).saturating_sub(recv0);

    let cores_used = (cpu_delta as f64 / CLK_TCK) / wall;
    let pkts_per_prod = (wall / (PACKET_MS as f64 / 1000.0)) as u64;
    // chaque paquet de chaque diffuseur va à chaque spectateur.
    let expected = pkts_per_prod * publishers as u64 * spectators as u64;
    let health_pct = if expected > 0 {
        (received_delta as f64 / expected as f64) * 100.0
    } else {
        100.0
    };

    Ok(WatchResult {
        publishers,
        spectators,
        setup_ms,
        cores_used,
        rss_mb: rss_mb(),
        expected,
        received: received_delta,
        health_pct,
        paths: publishers * spectators,
    })
}

/// Mode watch-party : `sfu-bench watch <diffuseurs> <nb_spectateurs,...>`
async fn run_watch(cores: usize, window: Duration, args: &[String]) -> R<()> {
    let publishers: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1).max(1);
    let spectator_stages: Vec<usize> = args
        .get(3)
        .map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).filter(|&n| n >= 1).collect())
        .unwrap_or_else(|| vec![100, 250, 500, 1000]);

    eprintln!(
        "── sfu-bench WATCH-PARTY : {publishers} diffuseur(s) + N spectateurs, 1 pièce sur 1 cœur, fenêtre {}s ──",
        window.as_secs()
    );
    eprintln!("   (cas réel : peu parlent, beaucoup écoutent ; coût = diffuseurs×spectateurs chemins, pas N×(N-1))\n");
    println!(
        "{:>11} | {:>8} | {:>6} | {:>7} | {:>9} | verdict",
        "spectateurs", "chemins", "RSS", "CPU", "santé"
    );
    println!("{:->11}-+-{:->8}-+-{:->6}-+-{:->7}-+-{:->9}-+--------", "", "", "", "", "");

    let mut results = Vec::new();
    for &spec in &spectator_stages {
        let r = run_watch_stage(publishers, spec, window).await?;
        let verdict = if r.health_pct >= 99.0 {
            "OK"
        } else if r.health_pct >= 90.0 {
            "tendu"
        } else {
            "RUPTURE"
        };
        println!(
            "{:>11} | {:>8} | {:>4}Mo | {:>5.2}c | {:>7.1}% | {}",
            r.spectators, r.paths, r.rss_mb, r.cores_used, r.health_pct, verdict
        );
        results.push(r);
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    let json = serde_json::json!({
        "mode": "watch-party",
        "cores": cores,
        "publishers": publishers,
        "window_s": window.as_secs(),
        "stages": results.iter().map(|r| serde_json::json!({
            "publishers": r.publishers,
            "spectators": r.spectators,
            "forward_paths": r.paths,
            "setup_ms": r.setup_ms,
            "cpu_cores_used": (r.cores_used * 1000.0).round() / 1000.0,
            "rss_mb": r.rss_mb,
            "expected_pkts": r.expected,
            "received_pkts": r.received,
            "forward_health_pct": (r.health_pct * 10.0).round() / 10.0,
        })).collect::<Vec<_>>(),
    });
    eprintln!("\n── JSON ──");
    println!("{}", serde_json::to_string_pretty(&json)?);
    Ok(())
}

#[tokio::main]
async fn main() -> R<()> {
    let args: Vec<String> = std::env::args().collect();
    let window = Duration::from_secs(
        std::env::var("SFU_BENCH_WINDOW_S").ok().and_then(|v| v.parse().ok()).unwrap_or(4),
    );
    let cores = std::thread::available_parallelism().map(|c| c.get()).unwrap_or(1);

    // Mode multi-salons : sfu-bench rooms <participants/salon> <nb_salons,...>
    if args.get(1).map(String::as_str) == Some("rooms") {
        return run_multi(cores, window, &args).await;
    }
    if args.get(1).map(String::as_str) == Some("watch") {
        return run_watch(cores, window, &args).await;
    }

    let stages: Vec<usize> = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "2,5,10,20,30".into())
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .filter(|&n| n >= 2)
        .collect();

    eprintln!("── sfu-bench : {} cœurs, paliers {stages:?}, fenêtre {}s/palier ──", cores, window.as_secs());
    eprintln!("   (DirectTransport in-process, aucun port UDP ; Opus 1 pqt/20ms ; forwarding N×(N-1))\n");
    println!("{:>4} | {:>7} | {:>6} | {:>7} | {:>9} | verdict", "N", "setup", "RSS", "CPU", "santé");
    println!("{:->4}-+-{:->7}-+-{:->6}-+-{:->7}-+-{:->9}-+--------", "", "", "", "", "");

    let manager = WorkerManager::new();
    let mut results = Vec::new();
    for &n in &stages {
        let r = run_stage(&manager, n, window).await?;
        let verdict = if r.health_pct >= 99.0 {
            "OK"
        } else if r.health_pct >= 90.0 {
            "tendu"
        } else {
            "RUPTURE"
        };
        println!(
            "{:>4} | {:>6}ms | {:>4}Mo | {:>5.2}c | {:>7.1}% | {}",
            r.n, r.setup_ms, r.rss_mb, r.cores_used, r.health_pct, verdict
        );
        results.push(r);
        tokio::time::sleep(Duration::from_millis(400)).await; // laisser retomber
    }

    // JSON pour archivage / rapport.
    let json = serde_json::json!({
        "cores": cores,
        "window_s": window.as_secs(),
        "packet_ms": PACKET_MS,
        "payload_bytes": PAYLOAD,
        "stages": results.iter().map(|r| serde_json::json!({
            "participants": r.n,
            "setup_ms": r.setup_ms,
            "cpu_cores_used": (r.cores_used * 1000.0).round() / 1000.0,
            "cpu_pct_of_box": ((r.cores_used / cores as f64) * 1000.0).round() / 10.0,
            "rss_mb": r.rss_mb,
            "forward_paths": r.n * (r.n - 1),
            "expected_pkts": r.expected,
            "received_pkts": r.received,
            "forward_health_pct": (r.health_pct * 10.0).round() / 10.0,
        })).collect::<Vec<_>>(),
    });
    eprintln!("\n── JSON ──");
    println!("{}", serde_json::to_string_pretty(&json)?);
    Ok(())
}
