//! Mesure du protocole §9.1 du CDC (`SPECS/NODYX_MEDIA_ENGINE_RUST.md`).
//!
//! Deux sorties par essai :
//! - un fichier JSON Lines (machine-lisible, un objet par événement),
//! - un résumé une ligne en clair à la fin, pensé pour être collé directement
//!   dans le tableau du README par Jonathan, sans rouvrir le JSON.
//!
//! Le champ qui tranche le protocole : le type du candidat LOCAL gagnant.
//! `str0m` n'expose que l'ADRESSE du candidat sélectionné
//! (`CandidatePairStats.local.addr`), pas son type — c'est nous qui avons
//! construit nos candidats (host, srflx), donc c'est nous qui savons quelle
//! adresse correspond à quel type. D'où la table `known_local_candidates`.

use serde::Serialize;
use str0m::CandidateKind;
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::net::SocketAddr;
use std::time::Instant;

pub struct Measure {
    label: String,
    file: File,
    start: Instant,
    known_local_candidates: HashMap<SocketAddr, CandidateKind>,
    outcome: Outcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Pending,
    Connected { winning_kind: CandidateKind, elapsed_ms: u128 },
    Failed,
}

#[derive(Serialize)]
struct LogLine<'a> {
    ts: String,
    event: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    srflx: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stun_server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rtt_stun_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elapsed_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    local_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    local_addr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remote_addr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_rx: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    outcome: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    winning_candidate: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

fn now_rfc3339() -> String {
    // Pas de dépendance chrono pour un spike : horodatage lisible, précision
    // à la seconde suffit pour ce protocole (comparer des essais entre eux).
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("unix:{}", now.as_secs())
}

impl Measure {
    pub fn open(label: &str) -> anyhow::Result<Self> {
        let path = format!("essai-{label}.jsonl");
        let file = File::create(&path)
            .map_err(|e| anyhow::anyhow!("création de {path} impossible : {e}"))?;
        eprintln!("[mesure] journal : {path}");
        Ok(Self {
            label: label.to_string(),
            file,
            start: Instant::now(),
            known_local_candidates: HashMap::new(),
            outcome: Outcome::Pending,
        })
    }

    fn write_line(&mut self, line: LogLine) {
        if let Ok(json) = serde_json::to_string(&line) {
            let _ = writeln!(self.file, "{json}");
            let _ = self.file.flush();
        }
    }

    /// Enregistre un candidat local QU'ON A CONSTRUIT (host ou srflx), pour
    /// pouvoir plus tard traduire l'adresse sélectionnée en type de candidat.
    pub fn record_local_candidate(&mut self, addr: SocketAddr, kind: CandidateKind) {
        self.known_local_candidates.insert(addr, kind);
    }

    pub fn log_candidates_gathered(
        &mut self,
        host: SocketAddr,
        srflx: Option<SocketAddr>,
        stun_server: SocketAddr,
        rtt_stun_ms: u128,
    ) {
        self.write_line(LogLine {
            ts: now_rfc3339(),
            event: "candidates_gathered",
            host: Some(host.to_string()),
            srflx: srflx.map(|a| a.to_string()),
            stun_server: Some(stun_server.to_string()),
            rtt_stun_ms: Some(rtt_stun_ms),
            elapsed_ms: None,
            local_kind: None,
            local_addr: None,
            remote_addr: None,
            bytes_rx: None,
            outcome: None,
            winning_candidate: None,
            reason: None,
        });
    }

    pub fn log_connected(&mut self) {
        let elapsed_ms = self.start.elapsed().as_millis();
        self.write_line(LogLine {
            ts: now_rfc3339(),
            event: "connected",
            host: None,
            srflx: None,
            stun_server: None,
            rtt_stun_ms: None,
            elapsed_ms: Some(elapsed_ms),
            local_kind: None,
            local_addr: None,
            remote_addr: None,
            bytes_rx: None,
            outcome: None,
            winning_candidate: None,
            reason: None,
        });
    }

    /// LA donnée qui tranche (CDC §9.1) : le type du candidat local gagnant.
    /// `srflx` = perçage réel. `relay`/inconnu = pas un perçage.
    pub fn log_selected_pair(&mut self, local_addr: SocketAddr, remote_addr: SocketAddr) {
        let kind = self
            .known_local_candidates
            .get(&local_addr)
            .copied();
        let elapsed_ms = self.start.elapsed().as_millis();
        let kind_str = kind.map(|k| k.to_string());

        self.write_line(LogLine {
            ts: now_rfc3339(),
            event: "selected_pair",
            host: None,
            srflx: None,
            stun_server: None,
            rtt_stun_ms: None,
            elapsed_ms: Some(elapsed_ms),
            local_kind: kind_str.clone(),
            local_addr: Some(local_addr.to_string()),
            remote_addr: Some(remote_addr.to_string()),
            bytes_rx: None,
            outcome: None,
            winning_candidate: None,
            reason: None,
        });

        if let Some(kind) = kind {
            self.outcome = Outcome::Connected { winning_kind: kind, elapsed_ms };
        }
    }

    pub fn log_media_flowing(&mut self, bytes_rx: u64) {
        self.write_line(LogLine {
            ts: now_rfc3339(),
            event: "media_flowing",
            host: None,
            srflx: None,
            stun_server: None,
            rtt_stun_ms: None,
            elapsed_ms: None,
            local_kind: None,
            local_addr: None,
            remote_addr: None,
            bytes_rx: Some(bytes_rx),
            outcome: None,
            winning_candidate: None,
            reason: None,
        });
    }

    pub fn log_failed(&mut self, reason: &str) {
        self.outcome = Outcome::Failed;
        self.write_line(LogLine {
            ts: now_rfc3339(),
            event: "failed",
            host: None,
            srflx: None,
            stun_server: None,
            rtt_stun_ms: None,
            elapsed_ms: Some(self.start.elapsed().as_millis()),
            local_kind: None,
            local_addr: None,
            remote_addr: None,
            bytes_rx: None,
            outcome: None,
            winning_candidate: None,
            reason: Some(reason),
        });
    }

    /// Résumé une ligne, imprimé sur stdout ET écrit dans le JSONL comme
    /// dernier événement. C'est la ligne que Jonathan colle dans le tableau
    /// du README après chaque essai.
    pub fn finish(mut self, network_label: &str) -> String {
        let summary = match self.outcome {
            Outcome::Connected { winning_kind, elapsed_ms } => {
                let verdict = match winning_kind {
                    CandidateKind::ServerReflexive => "PERÇAGE RÉEL",
                    CandidateKind::Host => "réseau local, pas de NAT à percer",
                    CandidateKind::Relayed => "relais TURN — PAS un perçage",
                    CandidateKind::PeerReflexive => "peer-reflexive (rare, à examiner)",
                };
                format!(
                    "[{}] réseau={} · candidat gagnant={} ({}) · établi en {:.2}s · succès",
                    self.label,
                    network_label,
                    winning_kind,
                    verdict,
                    elapsed_ms as f64 / 1000.0
                )
            }
            Outcome::Failed | Outcome::Pending => {
                format!(
                    "[{}] réseau={} · ÉCHEC — aucune paire ICE établie sous {:.2}s",
                    self.label,
                    network_label,
                    self.start.elapsed().as_secs_f64()
                )
            }
        };

        let outcome_str = match self.outcome {
            Outcome::Connected { .. } => "success",
            _ => "failure",
        };
        let winning = match self.outcome {
            Outcome::Connected { winning_kind, .. } => Some(winning_kind.to_string()),
            _ => None,
        };

        self.write_line(LogLine {
            ts: now_rfc3339(),
            event: "summary",
            host: None,
            srflx: None,
            stun_server: None,
            rtt_stun_ms: None,
            elapsed_ms: None,
            local_kind: None,
            local_addr: None,
            remote_addr: None,
            bytes_rx: None,
            outcome: Some(outcome_str),
            winning_candidate: winning.as_deref(),
            reason: None,
        });

        summary
    }
}
