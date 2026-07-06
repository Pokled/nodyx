//! # nodyx-sfud — le daemon SFU de l'instance
//!
//! Expose `VoiceService<MediasoupEngine>` sur une API HTTP interne, consommée
//! exclusivement par nodyx-core (CDC §3 : "le SFU expose une API interne ;
//! nodyx-core relaie"). Même modèle d'exploitation que nexus-turn/nodyx-relay :
//! un binaire Rust, un service systemd, une instance = son SFU.
//!
//! Sécurité (paranoïa assumée, ce daemon donne accès au média) :
//! - bind 127.0.0.1 UNIQUEMENT (refus de démarrer sur autre chose sans
//!   SFU_ALLOW_NONLOCAL=1, pensé pour des tests futurs, jamais la prod) ;
//! - jeton partagé OBLIGATOIRE (SFU_TOKEN, comparé en temps constant), même en
//!   localhost : un process local compromis ne pilote pas le SFU gratuitement ;
//! - corps limité (256 Ko), timeout par requête (10 s), Connection: close ;
//! - HTTP/1.1 minimal écrit à la main : surface auditables en ~150 lignes,
//!   zéro dépendance serveur (ADN maison, comme nexus-turn).
//!
//! Env :
//!   SFU_TOKEN          jeton partagé (OBLIGATOIRE)
//!   SFU_HTTP_ADDR      défaut 127.0.0.1:3901
//!   SFU_LISTEN_IP      IP d'écoute média WebRTC   (défaut 127.0.0.1)
//!   SFU_ANNOUNCED_IP   adresse annoncée aux clients (IP publique du VPS)
//!   SFU_MESH_THRESHOLD seuil mesh→SFU (défaut 4) · SFU_MAX_SEATS (défaut 25)

use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use nodyx_sfu::{
    Direction, Mode, ParticipantId, ProducerId, RoomId, SignalingBlob, TrackKind, VoiceConfig,
    VoiceService,
};
use nodyx_sfu_mediasoup::engine::MediasoupEngine;

const MAX_BODY: usize = 256 * 1024;
const REQ_TIMEOUT: Duration = Duration::from_secs(10);

struct App {
    svc: VoiceService<MediasoupEngine>,
    token: Vec<u8>,
}

/// Comparaison en temps constant (pas de fuite de longueur de préfixe).
fn token_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn mode_str(m: Mode) -> &'static str {
    match m {
        Mode::Mesh => "mesh",
        Mode::Sfu => "sfu",
    }
}

fn direction_of(s: Option<&str>) -> Option<Direction> {
    match s {
        Some("send") => Some(Direction::Send),
        Some("recv") => Some(Direction::Recv),
        _ => None,
    }
}

fn kind_of(s: &str) -> Option<TrackKind> {
    match s {
        "audio" => Some(TrackKind::Audio),
        "screen" => Some(TrackKind::Screen),
        "cam" => Some(TrackKind::Cam),
        _ => None,
    }
}

/// Extrait un champ string d'un JSON (via serde_json::Value).
fn field<'a>(v: &'a serde_json::Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str())
}

fn ok_json(body: serde_json::Value) -> (u16, serde_json::Value) {
    let mut b = body;
    b["ok"] = serde_json::Value::Bool(true);
    (200, b)
}

fn err_json(status: u16, msg: impl Into<String>) -> (u16, serde_json::Value) {
    (status, serde_json::json!({ "ok": false, "error": msg.into() }))
}

async fn route(app: &App, path: &str, body: &serde_json::Value) -> (u16, serde_json::Value) {
    // Helpers de lecture des champs communs.
    let room = || field(body, "room").map(|s| RoomId(s.to_string()));
    let participant = || field(body, "participant").map(|s| ParticipantId(s.to_string()));

    match path {
        "/v1/health" => ok_json(serde_json::json!({ "service": "nodyx-sfud" })),

        "/v1/join" => {
            let (Some(r), Some(p)) = (room(), participant()) else {
                return err_json(400, "room et participant requis");
            };
            match app.svc.join(r, p).await {
                Ok(out) => ok_json(serde_json::json!({
                    "mode": mode_str(out.mode),
                    "migrated": out.migrated.iter().map(|p| p.0.clone()).collect::<Vec<_>>(),
                })),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        "/v1/leave" => {
            let (Some(r), Some(p)) = (room(), participant()) else {
                return err_json(400, "room et participant requis");
            };
            match app.svc.leave(r, p).await {
                Ok(()) => ok_json(serde_json::json!({})),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        "/v1/caps" => {
            let Some(r) = room() else { return err_json(400, "room requis") };
            match app.svc.room_capabilities(&r).await {
                Ok(caps) => ok_json(serde_json::json!({ "caps": caps.0 })),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        "/v1/transport_params" => {
            let (Some(r), Some(p)) = (room(), participant()) else {
                return err_json(400, "room et participant requis");
            };
            let Some(d) = direction_of(field(body, "direction")) else {
                return err_json(400, "direction requise (send|recv)");
            };
            match app.svc.transport_params(&r, &p, d).await {
                Ok(params) => ok_json(serde_json::json!({ "params": params.0 })),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        "/v1/connect" => {
            let (Some(r), Some(p), Some(c)) = (room(), participant(), field(body, "client")) else {
                return err_json(400, "room, participant et client requis");
            };
            let Some(d) = direction_of(field(body, "direction")) else {
                return err_json(400, "direction requise (send|recv)");
            };
            match app.svc.connect_transport(&r, &p, d, &SignalingBlob(c.to_string())).await {
                Ok(()) => ok_json(serde_json::json!({})),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        "/v1/produce" => {
            let (Some(r), Some(p), Some(k)) = (room(), participant(), field(body, "kind")) else {
                return err_json(400, "room, participant et kind requis");
            };
            let Some(kind) = kind_of(k) else {
                return err_json(400, "kind invalide (audio|screen|cam)");
            };
            let client = SignalingBlob(field(body, "client").unwrap_or("{}").to_string());
            match app.svc.publish(r, p, kind, &client).await {
                Ok(prod) => ok_json(serde_json::json!({ "producer": prod.0 })),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        "/v1/consume" => {
            let (Some(r), Some(p), Some(prod)) = (room(), participant(), field(body, "producer"))
            else {
                return err_json(400, "room, participant et producer requis");
            };
            let caps = SignalingBlob(field(body, "clientCaps").unwrap_or("{}").to_string());
            match app
                .svc
                .subscribe(r, p, ProducerId(prod.to_string()), &caps)
                .await
            {
                Ok((cons, params)) => ok_json(serde_json::json!({
                    "consumer": cons.0,
                    "params": params.0,
                })),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        "/v1/publications" => {
            let Some(r) = room() else { return err_json(400, "room requis") };
            let pubs = app
                .svc
                .publications(&r)
                .iter()
                .map(|p| {
                    serde_json::json!({
                        "producer": p.producer.0,
                        "kind": match p.kind {
                            TrackKind::Audio => "audio",
                            TrackKind::Screen => "screen",
                            TrackKind::Cam => "cam",
                        },
                        "owner": p.owner.0,
                    })
                })
                .collect::<Vec<_>>();
            ok_json(serde_json::json!({ "publications": pubs }))
        }

        "/v1/screenshare" => {
            let Some(r) = room() else { return err_json(400, "room requis") };
            let on = body.get("on").and_then(|v| v.as_bool()).unwrap_or(false);
            match app.svc.set_screenshare(r, on).await {
                Ok(mig) => ok_json(serde_json::json!({
                    "switched": mig.switched_to_sfu,
                    "migrated": mig.migrated.iter().map(|p| p.0.clone()).collect::<Vec<_>>(),
                })),
                Err(e) => err_json(409, e.to_string()),
            }
        }

        _ => err_json(404, "route inconnue"),
    }
}

/// Lit une requête HTTP/1.1 minimale : ligne de requête + headers + corps
/// (Content-Length borné). Retourne (méthode, chemin, autorisation, corps).
async fn read_request(
    stream: &mut TcpStream,
) -> std::io::Result<Option<(String, String, Option<String>, Vec<u8>)>> {
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut tmp = [0u8; 2048];
    // Lire jusqu'à la fin des headers.
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > 16 * 1024 {
            return Ok(None); // headers déraisonnables
        }
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&tmp[..n]);
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut content_length = 0usize;
    let mut authorization = None;
    for line in lines {
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
        if lower.starts_with("authorization:") {
            authorization = Some(line[14..].trim().to_string());
        }
    }
    if content_length > MAX_BODY {
        return Ok(None);
    }

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    body.truncate(content_length);
    Ok(Some((method, path, authorization, body)))
}

async fn respond(stream: &mut TcpStream, status: u16, body: &serde_json::Value) {
    let payload = body.to_string();
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Conflict",
    };
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn handle(app: Arc<App>, mut stream: TcpStream) {
    let req = tokio::time::timeout(REQ_TIMEOUT, read_request(&mut stream)).await;
    let Ok(Ok(Some((method, path, auth, body)))) = req else {
        let _ = stream.shutdown().await;
        return;
    };

    // Jeton obligatoire, en temps constant, avant TOUT routage.
    let presented = auth
        .as_deref()
        .and_then(|a| a.strip_prefix("Bearer "))
        .unwrap_or("");
    if !token_eq(presented.as_bytes(), &app.token) {
        respond(&mut stream, 401, &serde_json::json!({ "ok": false, "error": "unauthorized" })).await;
        return;
    }

    if method != "POST" && !(method == "GET" && path == "/v1/health") {
        respond(&mut stream, 405, &serde_json::json!({ "ok": false, "error": "POST only" })).await;
        return;
    }

    let json: serde_json::Value = if body.is_empty() {
        serde_json::json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => {
                respond(&mut stream, 400, &serde_json::json!({ "ok": false, "error": format!("JSON: {e}") })).await;
                return;
            }
        }
    };

    let (status, resp) =
        tokio::time::timeout(REQ_TIMEOUT, route(&app, &path, &json))
            .await
            .unwrap_or_else(|_| err_json(504, "timeout moteur"));
    respond(&mut stream, status, &resp).await;
}

#[tokio::main]
async fn main() {
    let token = match std::env::var("SFU_TOKEN") {
        Ok(t) if t.len() >= 16 => t.into_bytes(),
        _ => {
            eprintln!("SFU_TOKEN manquant ou trop court (>=16 caractères requis). Refus de démarrer.");
            std::process::exit(1);
        }
    };
    let http_addr = std::env::var("SFU_HTTP_ADDR").unwrap_or_else(|_| "127.0.0.1:3901".into());
    if !http_addr.starts_with("127.") && std::env::var("SFU_ALLOW_NONLOCAL").as_deref() != Ok("1") {
        eprintln!("SFU_HTTP_ADDR non-localhost ({http_addr}) refusé sans SFU_ALLOW_NONLOCAL=1.");
        std::process::exit(1);
    }
    let listen_ip: IpAddr = std::env::var("SFU_LISTEN_IP")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()
        .expect("SFU_LISTEN_IP invalide");
    let announced = std::env::var("SFU_ANNOUNCED_IP").ok();
    let threshold: usize = std::env::var("SFU_MESH_THRESHOLD").ok().and_then(|v| v.parse().ok()).unwrap_or(4);
    let seats: usize = std::env::var("SFU_MAX_SEATS").ok().and_then(|v| v.parse().ok()).unwrap_or(25);

    let engine = MediasoupEngine::new_webrtc(listen_ip, announced.clone())
        .await
        .expect("boot moteur mediasoup");
    let svc = VoiceService::new(engine, VoiceConfig { max_seats: seats, mesh_threshold: threshold });
    let app = Arc::new(App { svc, token });

    let listener = TcpListener::bind(&http_addr).await.expect("bind API interne");
    println!(
        "nodyx-sfud — API interne http://{http_addr} | média listen={listen_ip} announced={} | seuil mesh→SFU={threshold} sièges={seats}",
        announced.as_deref().unwrap_or("(aucune)")
    );

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let app = Arc::clone(&app);
                tokio::spawn(handle(app, stream));
            }
            Err(e) => eprintln!("accept: {e}"),
        }
    }
}
