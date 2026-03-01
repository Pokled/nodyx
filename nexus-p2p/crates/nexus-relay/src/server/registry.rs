use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::{mpsc, oneshot};
use crate::protocol::ServerMessage;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A pending HTTP request waiting for the relay client to respond.
pub struct PendingRequest {
    pub msg: ServerMessage,
    /// Channel to send the relay client's response back to the HTTP proxy.
    pub reply_tx: oneshot::Sender<RelayResponse>,
}

/// The relay client's HTTP response, as received over the TCP tunnel.
pub struct RelayResponse {
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    pub body: Vec<u8>,
}

/// A handle to a connected relay client — send requests, receive responses.
#[derive(Clone)]
pub struct TunnelHandle {
    pub tx: mpsc::Sender<PendingRequest>,
}

// ── Registry ──────────────────────────────────────────────────────────────────

/// Thread-safe map of slug → active tunnel handle.
#[derive(Clone, Default)]
pub struct Registry(Arc<DashMap<String, TunnelHandle>>);

impl Registry {
    pub fn new() -> Self {
        Self(Arc::new(DashMap::new()))
    }

    pub fn insert(&self, slug: String, handle: TunnelHandle) {
        self.0.insert(slug, handle);
    }

    pub fn remove(&self, slug: &str) {
        self.0.remove(slug);
    }

    pub fn get(&self, slug: &str) -> Option<TunnelHandle> {
        self.0.get(slug).map(|h| h.clone())
    }

    pub fn contains(&self, slug: &str) -> bool {
        self.0.contains_key(slug)
    }
}
