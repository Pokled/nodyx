//! # Spike mediasoup (CDC SFU §15) — le cerveau pilote le vrai moteur
//!
//! Preuve en deux scénarios, AUCUN code métier modifié :
//!
//! **A. VoiceService<MediasoupEngine>** : le MÊME `VoiceService` que celui
//! testé contre `NullEngine` (23 tests) pilote ici le vrai worker mediasoup à
//! travers le trait. Join ×5 (bascule mesh→SFU au seuil), publish audio,
//! subscribe, set_preferred_layer, leave. Si ça passe, l'architecture
//! hexagonale est prouvée de bout en bout.
//!
//! **B. Fédération (primitive)** : `pipe_to_remote` relaie un producer vers un
//! Router "nœud distant" (simulé localement), puis un participant du nœud
//! distant le consomme. C'est la brique de la cascade inter-SFU (P4). La
//! validation vers un VRAI host distant reste à faire au gate P4 (noté au CDC).

mod engine;

use engine::MediasoupEngine;
use nodyx_sfu::{
    MediaEngine, Mode, NodeId, ParticipantId, RoomId, TrackKind, VoiceService,
};

fn p(n: u32) -> ParticipantId {
    ParticipantId(format!("user-{n}"))
}

macro_rules! step {
    ($label:expr, $res:expr) => {{
        match $res {
            Ok(v) => {
                println!("  ✔ {}", $label);
                v
            }
            Err(e) => {
                println!("  ✘ {} : {e}", $label);
                std::process::exit(1);
            }
        }
    }};
}

#[tokio::main]
async fn main() {
    println!("── Spike mediasoup : VoiceService (cerveau) × MediasoupEngine (moteur réel) ──");

    let engine = step!(
        "boot du worker mediasoup (C++ sous-processus, piloté en Rust)",
        MediasoupEngine::new().await
    );

    // ── Scénario A : le cerveau inchangé pilote le vrai moteur ──────────────
    println!("\n[A] VoiceService → trait → mediasoup");
    let svc = VoiceService::with_defaults(engine.clone());
    let room = RoomId("channel-watchparty".into());

    for i in 1..=4 {
        let out = step!(format!("join user-{i} (mesh attendu)"), svc.join(room.clone(), p(i)).await);
        assert_eq!(out.mode, Mode::Mesh, "≤4 : on doit être en mesh");
    }
    let out = step!(
        "join user-5 → FRANCHIT LE SEUIL (bascule SFU, routers/transports mediasoup réels)",
        svc.join(room.clone(), p(5)).await
    );
    assert_eq!(out.mode, Mode::Sfu);
    assert!(out.transport.is_some(), "le joiner a un transport mediasoup");
    assert_eq!(out.migrated.len(), 4, "les 4 présents ont été migrés");
    println!("     → mode={:?}, transports provisionnés: 5", svc.mode(&room).unwrap());

    let producer = step!(
        "publish audio Opus de user-1 (Producer mediasoup réel)",
        svc.publish(room.clone(), p(1), TrackKind::Audio).await
    );
    let consumer = step!(
        "subscribe de user-2 au flux de user-1 (Consumer mediasoup réel)",
        svc.subscribe(room.clone(), p(2), producer.clone()).await
    );
    println!("     → producer={producer} consumer={consumer}");
    step!(
        "set_preferred_layer (no-op audio, contrat du port respecté)",
        svc.set_preferred_layer(room.clone(), p(2), producer.clone(), nodyx_sfu::Layer::LOWEST)
            .await
    );

    // ── Scénario B : primitive de fédération (pipe vers nœud "distant") ─────
    println!("\n[B] pipe_to_remote → cascade inter-SFU (simulée localement)");
    let remote_room = step!(
        "création du nœud distant : worker DÉDIÉ + router (SFU d'une autre instance, simulé)",
        engine
            .create_room_on_new_worker(RoomId("remote-instance".into()))
            .await
    );
    let node = NodeId("sfu-sleemstudio".into());
    engine.register_remote_node(&node, step!(
        "enregistrement du nœud distant",
        engine.router_for_room(&remote_room)
    ));

    let pipe = step!(
        "pipe du producer de user-1 vers le nœud distant (PipeTransport mediasoup)",
        engine.pipe_to_remote(&producer, &node).await
    );
    println!("     → {pipe}");

    // Un participant du nœud distant consomme le flux pipé.
    let remote_transport = step!(
        "transport d'un participant distant",
        engine
            .create_transport(&remote_room, ParticipantId("remote-user".into()))
            .await
    );
    let piped_producer = nodyx_sfu::ProducerId(
        pipe.0.strip_prefix("pipe-").unwrap_or(&pipe.0).to_string(),
    );
    let remote_consumer = step!(
        "consume du flux pipé côté nœud distant (LA brique de la cascade P4)",
        engine.consume(&remote_transport, &piped_producer).await
    );
    println!("     → remote_consumer={remote_consumer}");

    // ── Fin propre ───────────────────────────────────────────────────────────
    println!("\n[C] fermeture propre");
    for i in 1..=5 {
        step!(format!("leave user-{i}"), svc.leave(room.clone(), p(i)).await);
    }
    step!("close du salon distant", engine.close_room(remote_room).await);

    println!("\n══════════════════════════════════════════════════════");
    println!("SPIKE VERT : le cerveau (VoiceService, inchangé) a piloté");
    println!("le vrai moteur mediasoup derrière le trait, ET la primitive");
    println!("de cascade fédérée (pipe) fonctionne. Gate P1 : OUVERT.");
    println!("Reste au gate P4 : pipe vers un HOST distant réel.");
    println!("══════════════════════════════════════════════════════");
}
