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
//! Usage : sfu-bench [stages]   ex: sfu-bench 2,5,10,20,30   (défaut idem)
//!         SFU_BENCH_WINDOW_S=4  durée de mesure par palier (défaut 4 s)

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
    let caps = consumer_caps(router.rtp_capabilities());
    let received = Arc::new(AtomicU64::new(0));

    let setup = Instant::now();
    // producers (+ leur send transport gardé vivant) et recv transports.
    let mut producers = Vec::with_capacity(n);
    let mut send_transports = Vec::with_capacity(n);
    let mut recv_transports = Vec::with_capacity(n);
    for i in 0..n {
        let send_t = router.create_direct_transport(DirectTransportOptions::default()).await?;
        let ssrc = 2000 + i as u32;
        let prod = send_t
            .produce(ProducerOptions::new(MediaKind::Audio, opus_rtp_parameters(ssrc)))
            .await?;
        let recv_t = router.create_direct_transport(DirectTransportOptions::default()).await?;
        producers.push((prod, ssrc));
        send_transports.push(send_t);
        recv_transports.push(recv_t);
    }
    // chaque participant consomme TOUS les autres (N×(N-1) chemins).
    let mut consumers = Vec::with_capacity(n * (n - 1).max(1));
    for i in 0..n {
        for (j, (prod, _)) in producers.iter().enumerate() {
            if i == j {
                continue;
            }
            let c = recv_transports[i]
                .consume(ConsumerOptions::new(prod.id(), caps.clone()))
                .await?;
            let recv = Arc::clone(&received);
            // .detach() : sinon le HandlerId est droppé et le callback retiré
            // AUSSITÔT (#[must_use]) → 0 paquet reçu. Le piège du bench.
            c.on_rtp(move |_pkt| {
                recv.fetch_add(1, Ordering::Relaxed);
            })
            .detach();
            consumers.push(c);
        }
    }
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

#[tokio::main]
async fn main() -> R<()> {
    let stages: Vec<usize> = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "2,5,10,20,30".into())
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .filter(|&n| n >= 2)
        .collect();
    let window = Duration::from_secs(
        std::env::var("SFU_BENCH_WINDOW_S").ok().and_then(|v| v.parse().ok()).unwrap_or(4),
    );
    let cores = std::thread::available_parallelism().map(|c| c.get()).unwrap_or(1);

    eprintln!("── sfu-bench : {} cœurs, paliers {stages:?}, fenêtre {}s/palier ──", cores, window.as_secs());
    eprintln!("   (DirectTransport in-process, aucun port UDP ; Opus 1 pqt/20ms ; forwarding N×(N-1))\n");
    println!("{:>4} | {:>7} | {:>6} | {:>7} | {:>9} | {}", "N", "setup", "RSS", "CPU", "santé", "verdict");
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
