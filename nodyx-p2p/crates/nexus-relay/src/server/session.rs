//! One relay session, whatever carried it.
//!
//! A tunnel is the same conversation on every transport: register, then relay
//! requests until one side goes away. Only the door differs. Keeping that
//! conversation here, generic over the stream, means the WebSocket listener
//! inherits every fix made for the raw-TCP one, and neither can drift.
//!
//! The brute-force defence lives here too, for the same reason: a ban is about
//! *who is calling*, not about how they reached us.

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use dashmap::DashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tracing::{info, warn};

use super::db::DbPool;
use super::registry::{PendingRequest, Registry, RelayResponse, TunnelHandle};
use crate::keepalive::READ_DEADLINE;
use crate::protocol::{ClientMessage, ServerMessage, read_msg, write_msg};

// ── Auth failure rate limiter ─────────────────────────────────────────────────
// Protects against token brute-force attempts, on either door.

/// Max failed auth attempts from a single IP within `AUTH_WINDOW_SECS` before banning.
const MAX_AUTH_FAILURES: u32 = 5;
/// Time window for counting failures (seconds).
const AUTH_WINDOW_SECS: u64 = 60;
/// How long a banned IP is refused connections (seconds).
pub const BAN_DURATION_SECS: u64 = 300; // 5 minutes

/// How often the relay pings an idle client.
///
/// Must stay well under Cloudflare's ~100 s idle cut-off, which applies to the
/// WebSocket path: TCP keepalive would only hold up the local hop and would let
/// the far end die unnoticed.
const PING_INTERVAL_SECS: u64 = 30;

/// How long a fresh connection has to say who it is.
///
/// Without this bound a connection that completes the handshake and then falls
/// silent holds a task and a socket for as long as it pleases, and **no ban can
/// ever apply** because no authentication was attempted: the ban map only counts
/// failures. Opening many such connections costs the attacker almost nothing.
///
/// The client sends `Register` immediately on connect, so ten seconds is far
/// more than a real one needs, even on a slow link.
const REGISTER_DEADLINE: Duration = Duration::from_secs(10);

/// Read the very first message, or give up.
///
/// Split out from [`run`] so the deadline can be tested on its own: reaching
/// [`run`] would need a live database, and a rule this cheap to break deserves a
/// test that does not depend on one.
async fn read_registration<R>(reader: &mut R, culprit: IpAddr) -> anyhow::Result<Option<ClientMessage>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    match tokio::time::timeout(REGISTER_DEADLINE, read_msg::<_, ClientMessage>(reader)).await {
        Ok(res) => Ok(res?),
        Err(_) => Err(anyhow::anyhow!(
            "{culprit} opened a connection and never registered within {}s",
            REGISTER_DEADLINE.as_secs()
        )),
    }
}

/// Compile-time guard on the keep-alive budget.
///
/// Cloudflare closes an idle WebSocket at around 100 s, and TCP keepalive only
/// holds up the local hop, so this ping is what keeps the far end alive on that
/// path. A deadline shorter than two missed pings would reap healthy sessions.
///
/// Checked here rather than in a test: the build should fail, not the suite.
const _: () = assert!(PING_INTERVAL_SECS < 90);
const _: () = assert!(READ_DEADLINE_SECS > PING_INTERVAL_SECS * 2);

/// An unauthenticated connection must never outlive an authenticated idle one.
const _: () = assert!(REGISTER_DEADLINE.as_secs() < READ_DEADLINE_SECS);

/// [`READ_DEADLINE`] in seconds, so the guard above can be evaluated at compile time.
const READ_DEADLINE_SECS: u64 = READ_DEADLINE.as_secs();

/// Maps source IP → (failed_attempts, first_failure_unix_secs).
pub type BanMap = Arc<DashMap<IpAddr, (u32, u64)>>;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// Is this address currently serving a ban?
pub fn is_auth_banned(ban_map: &DashMap<IpAddr, (u32, u64)>, ip: IpAddr) -> bool {
    if let Some(entry) = ban_map.get(&ip) {
        let (attempts, since) = *entry;
        attempts >= MAX_AUTH_FAILURES && now_secs().saturating_sub(since) < BAN_DURATION_SECS
    } else {
        false
    }
}

/// Count one failure, starting a fresh window if the previous one has elapsed.
pub fn record_auth_failure(ban_map: &DashMap<IpAddr, (u32, u64)>, ip: IpAddr) {
    let now = now_secs();
    ban_map
        .entry(ip)
        .and_modify(|(count, since)| {
            if now.saturating_sub(*since) > AUTH_WINDOW_SECS {
                // First failure of a new window.
                *count = 1;
                *since = now;
            } else {
                *count += 1;
            }
        })
        .or_insert((1, now));
}

/// Drop ban entries whose window has fully elapsed.
pub fn prune_bans(ban_map: &DashMap<IpAddr, (u32, u64)>) {
    let now = now_secs();
    ban_map.retain(|_, (_, since)| now.saturating_sub(*since) < BAN_DURATION_SECS);
}

// ── Transport ─────────────────────────────────────────────────────────────────

/// Which door a session came through.
///
/// An enum rather than a string: the value reaches a column constrained to
/// exactly these two, and a typo there would quietly suggest nobody is left on
/// the legacy port. That conclusion would close it on someone still using it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    /// The legacy raw-TCP port, reached directly.
    Tcp7443,
    /// WebSocket over HTTPS, reached through Cloudflare and Caddy.
    Wss,
}

impl Transport {
    /// The value stored in `directory_instances.relay_transport`.
    pub const fn as_db_value(self) -> &'static str {
        match self {
            Transport::Tcp7443 => "tcp7443",
            Transport::Wss => "wss",
        }
    }
}

// ── The session ───────────────────────────────────────────────────────────────

/// Run one session to completion.
///
/// `culprit` is the address a ban is keyed on. Callers resolve it themselves,
/// because only they know whether a forwarding header may be believed: see
/// [`crate::client_ip`].
///
/// Returns once the client goes away, the session falls silent past
/// [`READ_DEADLINE`], or authentication fails.
pub async fn run<S>(
    stream: S,
    culprit: IpAddr,
    transport: Transport,
    registry: Registry,
    pg: Arc<DbPool>,
    ban_map: BanMap,
) -> anyhow::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut reader, mut writer) = tokio::io::split(stream);

    // 1. Expect Register as the very first message, and do not wait forever for
    //    it: an unauthenticated caller must not be able to hold a task open.
    let Some(ClientMessage::Register { slug, token }) =
        read_registration(&mut reader, culprit).await?
    else {
        write_msg(
            &mut writer,
            &ServerMessage::Registered {
                ok: false,
                error: Some("Expected register message".into()),
            },
        )
        .await?;
        return Ok(());
    };

    // 2. Validate token against directory_instances.
    let row = pg
        .query_opt(
            "SELECT id FROM directory_instances WHERE slug = $1 AND token = $2 AND status = 'active'",
            &[&slug, &token],
        )
        .await?;

    if row.is_none() {
        record_auth_failure(&ban_map, culprit);
        warn!(
            "Relay: auth failure from {} (slug='{}') - {} attempt(s)",
            culprit,
            slug,
            ban_map.get(&culprit).map(|e| e.0).unwrap_or(1)
        );
        write_msg(
            &mut writer,
            &ServerMessage::Registered {
                ok: false,
                error: Some("Invalid slug or token".into()),
            },
        )
        .await?;
        return Ok(());
    }

    // 3. Register in the in-memory registry.
    let (tx, mut rx) = mpsc::channel::<PendingRequest>(64);
    registry.insert(slug.clone(), TunnelHandle { tx });
    info!("Slug '{slug}' registered in relay over {transport:?}");

    // Deprecation telemetry. Port 7443 can only be retired once nobody attaches
    // to it any more, and nothing recorded that: a raw-TCP instance was
    // indistinguishable from a WebSocket one. Closing the port would have been a
    // gamble, with the risk of cutting somebody off and never finding out.
    //
    // We record the transport and the date, NOTHING else: no address, no usage
    // counter. The only question these columns answer is "is anyone still on
    // 7443?".
    //
    // A failed write must NEVER stop a tunnel from coming up. Telemetry is an
    // operational convenience; the tunnel is the service.
    if let Err(e) = pg
        .execute(
            "UPDATE directory_instances \
             SET relay_transport = $2, relay_transport_at = NOW() \
             WHERE slug = $1",
            &[&slug, &transport.as_db_value()],
        )
        .await
    {
        warn!("Relay: transport not recorded for '{slug}' ({e}) - tunnel kept up");
    }

    write_msg(&mut writer, &ServerMessage::Registered { ok: true, error: None }).await?;

    // Pending requests awaiting a client Response.
    let pending: Arc<DashMap<String, tokio::sync::oneshot::Sender<RelayResponse>>> =
        Arc::new(DashMap::new());

    // Task A — receive outgoing requests from the HTTP proxy, forward to client.
    let pending_a = pending.clone();
    let slug_a = slug.clone();
    let write_task = tokio::spawn(async move {
        while let Some(PendingRequest { msg, reply_tx }) = rx.recv().await {
            let id = match &msg {
                ServerMessage::Request { id, .. } => id.clone(),
                ServerMessage::Ping => {
                    // Just forward the ping, no pending entry needed.
                    if write_msg(&mut writer, &msg).await.is_err() {
                        break;
                    }
                    continue;
                }
                _ => continue,
            };
            pending_a.insert(id, reply_tx);
            if write_msg(&mut writer, &msg).await.is_err() {
                break;
            }
        }
        info!("Write task for '{slug_a}' ended");
    });

    // Task B — receive responses from the client, route to pending requests.
    // Wrapped in a deadline: clients reply Heartbeat to our ping, so a silence
    // longer than READ_DEADLINE means the connection is dead and should be reaped.
    let pending_b = pending.clone();
    let slug_b = slug.clone();
    let registry_b = registry.clone();
    let read_task = tokio::spawn(async move {
        loop {
            let next =
                tokio::time::timeout(READ_DEADLINE, read_msg::<_, ClientMessage>(&mut reader)).await;

            match next {
                Err(_elapsed) => {
                    warn!(
                        "No traffic from '{slug_b}' in {}s - closing dead session",
                        READ_DEADLINE.as_secs()
                    );
                    break;
                }
                Ok(Ok(Some(ClientMessage::Response { id, status, headers, body_b64 }))) => {
                    let body = B64.decode(&body_b64).unwrap_or_else(|e| {
                        warn!("Relay: base64 decode error on response id={id}: {e}");
                        vec![]
                    });
                    if let Some((_, tx)) = pending_b.remove(&id) {
                        let _ = tx.send(RelayResponse { status, headers, body });
                    }
                }
                Ok(Ok(Some(ClientMessage::Heartbeat))) => {
                    // No-op, keep-alive acknowledged.
                }
                Ok(Ok(Some(ClientMessage::Register { .. }))) => {
                    warn!("Unexpected Register from '{slug_b}' - ignoring");
                }
                Ok(Ok(None)) | Ok(Err(_)) => break,
            }
        }
        registry_b.remove(&slug_b);
        info!("Slug '{slug_b}' unregistered from relay");
    });

    // Task C — keep the tunnel warm, and the intermediaries convinced it is live.
    let slug_c = slug.clone();
    let registry_c = registry.clone();
    let ping_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(PING_INTERVAL_SECS)).await;
            let Some(handle) = registry_c.get(&slug_c) else { break };
            let (dummy_tx, _) = tokio::sync::oneshot::channel();
            let sent = handle
                .tx
                .send(PendingRequest { msg: ServerMessage::Ping, reply_tx: dummy_tx })
                .await;
            if sent.is_err() {
                break;
            }
        }
    });

    // Whichever ends first, the session is over.
    tokio::select! {
        _ = write_task => {}
        _ = read_task  => {}
        _ = ping_task  => {}
    }

    registry.remove(&slug);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("test address should parse")
    }

    /// The defect this guards against, reproduced.
    ///
    /// A caller completes the handshake and then says nothing at all. No
    /// authentication is attempted, so the ban map never sees it and no ban can
    /// ever apply. Before the deadline existed this waited forever, and opening
    /// such connections by the thousand cost the caller almost nothing.
    ///
    /// Time is paused, so this test spends no real seconds waiting.
    #[tokio::test(start_paused = true)]
    async fn a_caller_that_never_registers_is_dropped() {
        // The far end is held open on purpose: dropping it would signal EOF,
        // which is a different case entirely and would not exercise the deadline.
        let (_far_end, mut near_end) = tokio::io::duplex(64);

        let err = read_registration(&mut near_end, ip("203.0.113.9"))
            .await
            .expect_err("a silent caller must not be waited on forever");

        assert!(
            format!("{err}").contains("never registered"),
            "the failure must name what went wrong, got: {err}"
        );
    }

    /// The deadline must not be so long that it fails to bound anything.
    ///
    /// The client sends `Register` on connect, so anything past a few seconds is
    /// only patience for an attacker.
    #[test]
    fn the_registration_deadline_actually_bounds_something() {
        assert!(
            REGISTER_DEADLINE.as_secs() >= 3 && REGISTER_DEADLINE.as_secs() <= 30,
            "unreasonable registration deadline: {REGISTER_DEADLINE:?}"
        );
        // An unauthenticated connection must never outlive an authenticated idle
        // one. Also asserted at compile time; kept here so the intent is visible
        // to anyone reading the suite.
        assert!(REGISTER_DEADLINE.as_secs() < READ_DEADLINE.as_secs());
    }

    #[test]
    fn transport_values_match_the_database_constraint() {
        // The column accepts exactly these two. A drift here would be recorded
        // as a failed write rather than a wrong value, but the enum makes the
        // mistake unreachable in the first place.
        assert_eq!(Transport::Tcp7443.as_db_value(), "tcp7443");
        assert_eq!(Transport::Wss.as_db_value(), "wss");
    }

    #[test]
    fn a_ban_takes_the_configured_number_of_failures() {
        let map: DashMap<IpAddr, (u32, u64)> = DashMap::new();
        let who = ip("203.0.114.9");

        for _ in 0..MAX_AUTH_FAILURES - 1 {
            record_auth_failure(&map, who);
            assert!(!is_auth_banned(&map, who), "banned too early");
        }
        record_auth_failure(&map, who);
        assert!(is_auth_banned(&map, who), "should be banned on the last attempt");
    }

    #[test]
    fn a_ban_never_reaches_a_different_caller() {
        // The whole point of resolving the real address: one culprit must not
        // take everyone else down with them.
        let map: DashMap<IpAddr, (u32, u64)> = DashMap::new();
        let guilty = ip("203.0.114.9");
        let innocent = ip("198.51.101.7");

        for _ in 0..MAX_AUTH_FAILURES {
            record_auth_failure(&map, guilty);
        }
        assert!(is_auth_banned(&map, guilty));
        assert!(!is_auth_banned(&map, innocent));
    }

    #[test]
    fn failures_spread_thin_never_ban() {
        // An old window is reset rather than accumulated, so a slow trickle of
        // typos from a legitimate instance does not eventually lock it out.
        let map: DashMap<IpAddr, (u32, u64)> = DashMap::new();
        let who = ip("203.0.114.9");

        record_auth_failure(&map, who);
        // Age the recorded window past AUTH_WINDOW_SECS.
        map.insert(who, (MAX_AUTH_FAILURES - 1, now_secs() - AUTH_WINDOW_SECS - 1));
        record_auth_failure(&map, who);

        assert_eq!(map.get(&who).map(|e| e.0), Some(1), "window should have reset");
        assert!(!is_auth_banned(&map, who));
    }

    #[test]
    fn pruning_keeps_live_bans_and_drops_stale_ones() {
        let map: DashMap<IpAddr, (u32, u64)> = DashMap::new();
        let fresh = ip("203.0.114.9");
        let stale = ip("198.51.101.7");

        map.insert(fresh, (MAX_AUTH_FAILURES, now_secs()));
        map.insert(stale, (MAX_AUTH_FAILURES, now_secs() - BAN_DURATION_SECS - 1));
        prune_bans(&map);

        assert!(map.contains_key(&fresh), "a live ban must survive pruning");
        assert!(!map.contains_key(&stale), "an elapsed ban must be dropped");
    }
}
