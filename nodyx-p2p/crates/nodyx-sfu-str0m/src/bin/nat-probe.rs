//! `nat-probe` — Étape A du spike Phase A (SPECS/NODYX_MEDIA_ENGINE_RUST.md).
//!
//! Répond SEUL à « str0m perce-t-il un vrai NAT résidentiel ? », sans toucher
//! au trait `MediaEngine` : isole la question réseau de l'intégration
//! hexagonale. Zéro dépendance à `nodyx-sfu`.
//!
//! Usage (voir README.md du crate pour le protocole complet) :
//!   nat-probe --label ftth-free-1 --network "FTTH Free" --stun 1.2.3.4:3478
//!
//! Le binaire imprime l'offre attendue sur stdin, puis la réponse SDP sur
//! stdout : signaling par copier-coller manuel avec la page `probe.html`
//! (servie en `file://`, zéro infrastructure). C'est volontaire : ça teste
//! EXACTEMENT la promesse (aucun port ouvert, aucun serveur de signaling
//! joignable de l'extérieur n'est nécessaire).
//!
//! IMPORTANT pour la mesure : ce binaire ne prouve le perçage QUE lancé sur
//! une vraie box résidentielle, testé depuis un AUTRE réseau physique (ex.
//! 4G coupé du wifi de la box). En boucle locale (127.0.0.1), les deux
//! candidats sont toujours `host` : ça prouve que le code fonctionne, rien
//! sur le NAT. Voir CDC §9.1 et le plan de session.

use std::io::{self, Read};
use std::net::{SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use clap::Parser;
use str0m::{Candidate, Event, Input, Output, Rtc, net::Protocol, net::Receive};

use nodyx_sfu_str0m::measure::Measure;
use nodyx_sfu_str0m::stun;

#[derive(Parser, Debug)]
#[command(
    name = "nat-probe",
    about = "Spike Phase A — str0m perce-t-il le NAT sans port ouvert ? (CDC §9.1)"
)]
struct Args {
    /// Étiquette de l'essai, sert de nom au fichier essai-<label>.jsonl et
    /// au résumé imprimé à la fin (ex: ftth-free-1).
    #[arg(long)]
    label: String,

    /// Description humaine du réseau testé, pour le tableau du README
    /// (ex: "FTTH Free", "4G Orange partage de connexion").
    #[arg(long, default_value = "réseau non précisé")]
    network: String,

    /// Adresse du serveur STUN à interroger pour découvrir l'adresse
    /// server-reflexive. nexus-turn tourne déjà en prod sur le port 3478 de
    /// l'IP publique du VPS de l'instance — mets CETTE adresse ici, jamais
    /// un service tiers (le spike reste souverain).
    #[arg(long, env = "STUN_SERVER")]
    stun: SocketAddr,

    /// Port UDP local à lier. 0 = port éphémère choisi par l'OS (par
    /// défaut : jamais la plage 40000-40999 réservée à mediasoup, pour
    /// garantir l'isolation avec le SFU de prod, cf. plan §6).
    #[arg(long, default_value_t = 0)]
    port: u16,

    /// Délai maximum d'attente d'une connexion ICE avant de déclarer l'essai
    /// en échec.
    #[arg(long, default_value_t = 60)]
    timeout_secs: u64,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("nat_probe=info,str0m=warn")),
        )
        .init();

    let args = Args::parse();

    // Provider crypto par défaut du process (aws-lc-rs, tiré par la feature
    // par défaut de str0m). Doit être appelé une seule fois, avant tout Rtc.
    str0m::crypto::from_feature_flags().install_process_default();

    let mut measure = Measure::open(&args.label)?;

    // ── 1. Un socket, une IP publique découverte ────────────────────────
    let socket = UdpSocket::bind(("0.0.0.0", args.port))?;
    let host_addr = socket.local_addr()?;
    eprintln!("[nat-probe] socket local : {host_addr}");

    let stun_start = Instant::now();
    let srflx_addr = match stun::discover_reflexive_addr(&socket, args.stun, Duration::from_secs(5)) {
        Ok(addr) => {
            eprintln!("[nat-probe] adresse server-reflexive (STUN, {}) : {addr}", args.stun);
            Some(addr)
        }
        Err(e) => {
            eprintln!(
                "[nat-probe] ⚠ STUN a échoué ({e}) — le spike continuera SANS candidat srflx, \
                 ce qui revient à tester sans perçage possible. Vérifie --stun."
            );
            None
        }
    };
    let stun_rtt_ms = stun_start.elapsed().as_millis();
    measure.log_candidates_gathered(host_addr, srflx_addr, args.stun, stun_rtt_ms);

    // ── 2. La page attend l'offre côté navigateur ; nous, on lit stdin ──
    eprintln!(
        "\n=== Ouvre src/bin/probe.html dans un navigateur, sur un AUTRE réseau physique \
         que ce serveur (ex: 4G coupé du wifi), clique « Générer l'offre », colle le \
         résultat ci-dessous, puis Ctrl+D (ou Ctrl+Z sous Windows) ===\n"
    );
    let mut offer_sdp = String::new();
    io::stdin().read_to_string(&mut offer_sdp)?;
    let offer_sdp = offer_sdp.trim();
    if offer_sdp.is_empty() {
        anyhow::bail!("aucune offre reçue sur stdin — rien à faire");
    }
    let offer = str0m::change::SdpOffer::from_sdp_string(offer_sdp)
        .map_err(|e| anyhow::anyhow!("offre SDP invalide : {e}"))?;

    // ── 3. Construire le Rtc, ajouter NOS candidats, négocier ───────────
    let mut rtc = Rtc::builder()
        .set_ice_lite(false) // ICE COMPLET : c'est toute la raison d'être de ce spike (CDC §2-3)
        .set_stats_interval(Some(Duration::from_secs(1))) // sans ça, jamais de PeerStats
        .build(Instant::now());

    let host_candidate = Candidate::host(host_addr, "udp")
        .map_err(|e| anyhow::anyhow!("candidat host invalide : {e}"))?;
    if let Some(c) = rtc.add_local_candidate(host_candidate) {
        measure.record_local_candidate(c.addr(), c.kind());
    }

    if let Some(srflx) = srflx_addr {
        let srflx_candidate = Candidate::server_reflexive(srflx, host_addr, "udp")
            .map_err(|e| anyhow::anyhow!("candidat srflx invalide : {e}"))?;
        if let Some(c) = rtc.add_local_candidate(srflx_candidate) {
            measure.record_local_candidate(c.addr(), c.kind());
        }
    }

    let answer = rtc
        .sdp_api()
        .accept_offer(offer)
        .map_err(|e| anyhow::anyhow!("l'offre a été rejetée : {e}"))?;

    println!("{}", answer.to_sdp_string());
    eprintln!("\n=== Réponse ci-dessus : colle-la dans la page, section 2, puis clique « Appliquer » ===\n");

    // ── 4. Boucle Sans-IO, bloquante avec timeout (pattern officiel str0m) ──
    let deadline = Instant::now() + Duration::from_secs(args.timeout_secs);
    let mut connected = false;
    let mut media_bytes: u64 = 0;
    let mut media_logged = false;

    let outcome_reason = loop {
        if Instant::now() >= deadline {
            break Some("délai dépassé sans connexion ICE établie");
        }
        if !rtc.is_alive() {
            break Some("la session s'est terminée (disconnect)");
        }

        let out = match rtc.poll_output() {
            Ok(o) => o,
            Err(e) => break Some(Box::leak(format!("poll_output a échoué : {e}").into_boxed_str())),
        };

        match out {
            Output::Timeout(t) => {
                let now = Instant::now();
                if t > now {
                    let wait = (t - now).min(Duration::from_millis(500));
                    socket.set_read_timeout(Some(wait.max(Duration::from_millis(1))))?;
                    let mut recv_buf = vec![0u8; 2000];
                    match socket.recv_from(&mut recv_buf) {
                        Ok((n, source)) => {
                            recv_buf.truncate(n);
                            let Ok(contents) = recv_buf.as_slice().try_into() else {
                                continue;
                            };
                            let input = Input::Receive(
                                Instant::now(),
                                Receive { proto: Protocol::Udp, source, destination: host_addr, contents },
                            );
                            if let Err(e) = rtc.handle_input(input) {
                                tracing::warn!("handle_input a échoué : {e}");
                            }
                        }
                        Err(e)
                            if e.kind() == io::ErrorKind::WouldBlock
                                || e.kind() == io::ErrorKind::TimedOut =>
                        {
                            let _ = rtc.handle_input(Input::Timeout(Instant::now()));
                        }
                        Err(e) => break Some(Box::leak(format!("lecture socket : {e}").into_boxed_str())),
                    }
                } else {
                    let _ = rtc.handle_input(Input::Timeout(now));
                }
            }
            Output::Transmit(t) => {
                if let Err(e) = socket.send_to(&t.contents, t.destination) {
                    tracing::warn!("envoi UDP échoué vers {} : {e}", t.destination);
                }
            }
            Output::Event(Event::Connected) => {
                connected = true;
                measure.log_connected();
                eprintln!("[nat-probe] ✅ ICE connecté + DTLS négocié");
            }
            Output::Event(Event::PeerStats(stats)) => {
                if let Some(pair) = &stats.selected_candidate_pair {
                    measure.log_selected_pair(pair.local.addr, pair.remote.addr);
                    eprintln!(
                        "[nat-probe] paire sélectionnée : local={} remote={}",
                        pair.local.addr, pair.remote.addr
                    );
                }
            }
            Output::Event(Event::MediaData(data)) => {
                media_bytes += data.data.len() as u64;
                if !media_logged {
                    measure.log_media_flowing(media_bytes);
                    eprintln!("[nat-probe] 🎙 premiers octets de média reçus ({} octets)", data.data.len());
                    media_logged = true;
                }
                if connected && media_logged {
                    break None; // succès : connecté + média reçu, on peut conclure
                }
            }
            Output::Event(_) => {}
        }
    };

    if let Some(reason) = outcome_reason {
        measure.log_failed(reason);
        eprintln!("[nat-probe] ❌ {reason}");
    }

    let summary = measure.finish(&args.network);
    println!("\n{summary}");
    eprintln!("[nat-probe] copie la ligne ci-dessus dans le tableau du README.md");

    Ok(())
}
