use std::time::Duration;

use socket2::{SockRef, TcpKeepalive};
use tokio::net::TcpStream;

/// How long an idle TCP socket may sit before the kernel sends a keepalive probe.
const KEEPALIVE_IDLE:     Duration = Duration::from_secs(30);
/// Interval between keepalive probes once the connection is considered idle.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
/// Number of failed probes before the kernel declares the connection dead.
const KEEPALIVE_RETRIES:  u32 = 3;

/// Read deadline used by both client and server: if no message arrives within
/// this window, treat the session as dead. The relay server pings every 30s,
/// so 90s = 3 missed pings = a comfortable margin without false positives.
pub const READ_DEADLINE: Duration = Duration::from_secs(90);

/// Enable aggressive TCP keepalive on the given stream. Linux defaults
/// (~2 hours idle) are far too lax for a long-lived control channel that
/// must survive NAT tables and silent peer crashes.
pub fn enable(stream: &TcpStream) -> std::io::Result<()> {
    let ka = TcpKeepalive::new()
        .with_time(KEEPALIVE_IDLE)
        .with_interval(KEEPALIVE_INTERVAL)
        .with_retries(KEEPALIVE_RETRIES);
    SockRef::from(stream).set_tcp_keepalive(&ka)
}
