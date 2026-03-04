use std::collections::HashMap;
use tracing::{debug, warn};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

use crate::protocol::ClientMessage;

/// Forward an HTTP request to localhost:{local_port} and return the response
/// as a ClientMessage::Response ready to send back to the relay server.
///
/// This function is designed to be spawned concurrently — it does NOT write
/// to the TCP stream directly; the caller serializes writes via an mpsc channel.
pub async fn handle_request(
    id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body_b64: String,
    local_port: u16,
) -> ClientMessage {
    let url = format!("http://127.0.0.1:{local_port}{path}");
    debug!("Forwarding {method} {url}");

    let body_bytes = B64.decode(&body_b64).unwrap_or_else(|e| {
        warn!("Failed to decode request body base64 (id={id}): {e}");
        vec![]
    });

    let client = match reqwest::Client::builder()
        // Slightly above pingInterval (8s) so long polls complete before timeout.
        // Must be less than the relay server's reply timeout (15s).
        .timeout(std::time::Duration::from_secs(12))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to build reqwest client: {e}");
            return error_response(id, 500, "Client build error");
        }
    };

    let method_parsed = match reqwest::Method::from_bytes(method.as_bytes()) {
        Ok(m)  => m,
        Err(_) => {
            warn!("Invalid HTTP method '{method}' in relay request {id}");
            return error_response(id, 400, "Invalid HTTP method");
        }
    };

    let mut req = client.request(method_parsed, &url).body(body_bytes);

    // Forward request headers, skip hop-by-hop.
    for (k, v) in &headers {
        if !is_hop_by_hop(k) && k != "host" {
            req = req.header(k, v);
        }
    }
    // Set Host to localhost so the local server responds normally.
    req = req.header("host", format!("localhost:{local_port}"));

    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            warn!("Local request failed: {e}");
            return error_response(id, 502, "Local server unreachable");
        }
    };

    let status = response.status().as_u16();

    let mut resp_headers = HashMap::new();
    for (k, v) in response.headers() {
        let key = k.as_str().to_lowercase();
        if !is_hop_by_hop(&key) {
            if let Ok(val) = v.to_str() {
                resp_headers.insert(key, val.to_owned());
            }
        }
    }

    let resp_body = response.bytes().await.unwrap_or_default();
    let body_b64 = B64.encode(&resp_body);

    ClientMessage::Response {
        id,
        status,
        headers: resp_headers,
        body_b64,
    }
}

fn error_response(id: String, status: u16, msg: &str) -> ClientMessage {
    ClientMessage::Response {
        id,
        status,
        headers: HashMap::new(),
        body_b64: B64.encode(msg.as_bytes()),
    }
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
