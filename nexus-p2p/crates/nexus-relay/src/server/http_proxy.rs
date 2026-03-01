use std::sync::Arc;
use std::net::SocketAddr;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{body::Incoming, Request, Response, StatusCode};
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio_postgres::Client as PgClient;
use tracing::{error, info};
use uuid::Uuid;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

use crate::protocol::ServerMessage;
use super::registry::{PendingRequest, Registry};

// ── Entry point ───────────────────────────────────────────────────────────────

pub async fn run(
    bind: &str,
    registry: Registry,
    pg: Arc<PgClient>,
    main_slug: String,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind).await?;
    info!("HTTP proxy on {bind}");

    loop {
        let (stream, _addr) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let registry = registry.clone();
        let pg = pg.clone();
        let main_slug = main_slug.clone();

        tokio::spawn(async move {
            let svc = service_fn(move |req| {
                handle_request(req, registry.clone(), pg.clone(), main_slug.clone())
            });
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, svc)
                .await
            {
                error!("HTTP proxy connection error: {e}");
            }
        });
    }
}

// ── Request handler ───────────────────────────────────────────────────────────

async fn handle_request(
    req: Request<Incoming>,
    registry: Registry,
    pg: Arc<PgClient>,
    main_slug: String,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    // Extract slug from Host header (slug.nexusnode.app → slug).
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let slug = extract_slug(host);

    // The main community slug serves this VPS directly — forward to nexus-core.
    if slug.is_none() || slug.as_deref() == Some(&main_slug) {
        return Ok(proxy_to_nexus_core(req).await);
    }
    let slug = slug.unwrap();

    // If an active relay tunnel exists for this slug, proxy through it.
    if let Some(handle) = registry.get(&slug) {
        return Ok(proxy_through_tunnel(req, handle.tx, slug).await);
    }

    // No relay — look up URL in DB for 302 redirect.
    if let Ok(Some(row)) = pg
        .query_opt(
            "SELECT url FROM directory_instances WHERE slug = $1 AND status = 'active'",
            &[&slug],
        )
        .await
    {
        let url: String = row.get(0);
        let target = format!("{}{}", url.trim_end_matches('/'), req.uri());
        return Ok(redirect(target));
    }

    // Unknown slug.
    Ok(not_found())
}

// ── Proxy through relay tunnel ────────────────────────────────────────────────

async fn proxy_through_tunnel(
    req: Request<Incoming>,
    tx: tokio::sync::mpsc::Sender<PendingRequest>,
    slug: String,
) -> Response<Full<Bytes>> {
    let id = Uuid::new_v4().to_string();
    let method = req.method().to_string();
    let path = req.uri().to_string();

    // Collect headers (skip hop-by-hop).
    let mut headers = std::collections::HashMap::new();
    for (k, v) in req.headers() {
        let key = k.as_str().to_lowercase();
        if !is_hop_by_hop(&key) {
            if let Ok(val) = v.to_str() {
                headers.insert(key, val.to_owned());
            }
        }
    }

    // Collect body.
    let body_bytes = match req.collect().await {
        Ok(b) => b.to_bytes(),
        Err(_) => return internal_error("Failed to read request body"),
    };
    let body_b64 = B64.encode(&body_bytes);

    let msg = ServerMessage::Request { id: id.clone(), method, path, headers, body_b64 };

    // Create a one-shot channel to receive the relay client's response.
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    if tx.send(PendingRequest { msg, reply_tx }).await.is_err() {
        return service_unavailable(&slug);
    }

    // Wait for the relay client to respond (10 s timeout).
    match tokio::time::timeout(
        tokio::time::Duration::from_secs(10),
        reply_rx,
    )
    .await
    {
        Ok(Ok(relay_resp)) => {
            let mut builder = Response::builder().status(relay_resp.status);
            for (k, v) in &relay_resp.headers {
                if !is_hop_by_hop(k) {
                    builder = builder.header(k, v);
                }
            }
            builder
                .body(Full::new(Bytes::from(relay_resp.body)))
                .unwrap_or_else(|_| internal_error("Response build error"))
        }
        _ => gateway_timeout(),
    }
}

// ── Forward to local nexus-core (for main slug / fallback) ────────────────────

async fn proxy_to_nexus_core(_req: Request<Incoming>) -> Response<Full<Bytes>> {
    // For now redirect to the main domain — nexus-core handles it.
    redirect("https://nexusnode.app".to_string())
}

// ── Helper responses ──────────────────────────────────────────────────────────

fn extract_slug(host: &str) -> Option<String> {
    // Match "slug.nexusnode.app" (with optional port).
    let host = host.split(':').next().unwrap_or(host);
    let suffix = ".nexusnode.app";
    if host.ends_with(suffix) {
        let slug = &host[..host.len() - suffix.len()];
        if !slug.is_empty() && !slug.contains('.') {
            return Some(slug.to_lowercase());
        }
    }
    None
}

fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name,
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn redirect(location: String) -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::FOUND)
        .header("location", location)
        .body(Full::new(Bytes::new()))
        .unwrap()
}

fn not_found() -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Full::new(Bytes::from("Not Found")))
        .unwrap()
}

fn internal_error(msg: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .body(Full::new(Bytes::from(msg.to_owned())))
        .unwrap()
}

fn service_unavailable(slug: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::SERVICE_UNAVAILABLE)
        .body(Full::new(Bytes::from(format!("Relay for '{slug}' is unavailable"))))
        .unwrap()
}

fn gateway_timeout() -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::GATEWAY_TIMEOUT)
        .body(Full::new(Bytes::from("Relay client did not respond in time")))
        .unwrap()
}
