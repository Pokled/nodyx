use std::collections::HashMap;
use tokio::net::tcp::OwnedWriteHalf;
use tracing::{debug, warn};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

use crate::protocol::{ClientMessage, write_msg};

/// Receive a forwarded HTTP request, execute it against localhost:{local_port},
/// and write the response back over the relay connection.
pub async fn handle_request(
    writer: &mut OwnedWriteHalf,
    id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body_b64: String,
    local_port: u16,
) -> anyhow::Result<()> {
    let url = format!("http://127.0.0.1:{local_port}{path}");
    debug!("Forwarding {method} {url}");

    let body_bytes = B64.decode(&body_b64).unwrap_or_default();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let method_parsed = reqwest::Method::from_bytes(method.as_bytes())
        .unwrap_or(reqwest::Method::GET);

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
            // Send a 502 back to the relay server.
            return send_error(writer, id, 502, "Local server unreachable").await;
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

    write_msg(
        writer,
        &ClientMessage::Response {
            id,
            status,
            headers: resp_headers,
            body_b64,
        },
    )
    .await?;

    Ok(())
}

async fn send_error(
    writer: &mut OwnedWriteHalf,
    id: String,
    status: u16,
    msg: &str,
) -> anyhow::Result<()> {
    let body_b64 = B64.encode(msg.as_bytes());
    write_msg(
        writer,
        &ClientMessage::Response {
            id,
            status,
            headers: HashMap::new(),
            body_b64,
        },
    )
    .await?;
    Ok(())
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
