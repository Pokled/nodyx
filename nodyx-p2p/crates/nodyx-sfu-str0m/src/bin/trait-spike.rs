//! Spike Phase A, volet « derrière le trait » — même forme que le spike
//! mediasoup existant (`nodyx-sfu-mediasoup/src/bin/spike.rs`), même barre de
//! preuve pour son scénario WebRTC `[W]` : un `transport_params` réel
//! (candidats ICE + empreinte DTLS, pas un stub), et un `connect_transport`
//! qui rejette proprement un payload invalide.
//!
//! Ne pilote AUCUN vrai navigateur (comme le scénario `[W]` du spike
//! mediasoup ne le fait pas non plus) : ce n'est pas le rôle de ce binaire,
//! c'est celui de `nat-probe` + `probe.html`. Ici, la question posée est
//! « le trait `MediaEngine` est-il implémentable par un second moteur sans
//! fuite d'abstraction rédhibitoire ? » (CDC §4, critère d'arrêt n°2 du
//! spike, §9.1).

use nodyx_sfu::{MediaEngine, ParticipantId, RoomId, SignalingBlob, TrackKind};
use nodyx_sfu_str0m::engine::Str0mEngine;

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
    println!("── Spike Phase A : Str0mEngine derrière le trait MediaEngine ──\n");
    println!("Scope volontairement limité (CDC §9.1, D6 : audio seul, a minima) :");
    println!("create_room/create_transport/transport_params/connect_transport/close_*");
    println!("prouvés réels. produce/consume restent Unsupported, documenté : la boucle");
    println!("réseau (poll_output/handle_input) est la Phase B, pas ce spike.\n");

    let engine = Str0mEngine::new(
        "127.0.0.1".parse().unwrap(),
        "127.0.0.1".parse().unwrap(),
    );

    let room = step!(
        "create_room",
        engine.create_room(RoomId("channel-spike".into())).await
    );

    let caps = step!(
        "room_capabilities (blob opaque pour le métier)",
        engine.room_capabilities(&room).await
    );
    println!("     → {caps}");

    let transport = step!(
        "create_transport (Rtc str0m réel, en attente de négociation)",
        engine.create_transport(&room, ParticipantId("user-1".into())).await
    );

    let params = step!(
        "transport_params → offre SDP str0m réelle",
        engine.transport_params(&transport).await
    );
    let has_ice = params.0.contains("a=ice-ufrag");
    let has_dtls = params.0.contains("a=fingerprint");
    let has_candidate = params.0.contains("a=candidate");
    if !(has_ice && has_dtls && has_candidate) {
        println!("  ✘ le blob ne contient pas les marqueurs ICE/DTLS attendus");
        println!("     ice_ufrag={has_ice} fingerprint={has_dtls} candidate={has_candidate}");
        std::process::exit(1);
    }
    println!("  ✔ le blob contient un vrai ice-ufrag + une empreinte DTLS + un candidat ICE");
    println!("     → {} octets de SDP", params.0.len());

    match engine
        .connect_transport(&transport, &SignalingBlob("ceci n'est pas du SDP".into()))
        .await
    {
        Err(e) => println!("  ✔ connect_transport(payload invalide) rejeté proprement : {e}"),
        Ok(()) => {
            println!("  ✘ connect_transport aurait dû rejeter un payload sans réponse SDP valide");
            std::process::exit(1);
        }
    }

    match engine
        .produce(&transport, TrackKind::Audio, &SignalingBlob("{}".into()))
        .await
    {
        Err(e) => println!("  ✔ produce() Unsupported, documenté (Phase B) : {e}"),
        Ok(_) => {
            println!("  ✘ produce() aurait dû rester Unsupported à ce stade du spike");
            std::process::exit(1);
        }
    }

    step!("close_transport", engine.close_transport(&transport).await);
    step!(
        "close_transport (second appel, idempotent)",
        engine.close_transport(&transport).await
    );
    step!("close_room", engine.close_room(room).await);

    println!("\n══════════════════════════════════════════════════════");
    println!("PHASE A [trait] VERT : Str0mEngine implémente le trait sans fuite");
    println!("d'abstraction rédhibitoire (critère d'arrêt n°2, CDC §9.1). La question");
    println!("qui reste ouverte est le PERÇAGE NAT réel, qui se joue dans nat-probe,");
    println!("sur le terrain, pas ici.");
    println!("══════════════════════════════════════════════════════");
}
