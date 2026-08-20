//! What `--server` means.
//!
//! The client has to speak to two kinds of relay door, and it cannot be told
//! which by a flag: instances upgrade on their own schedule, and a flag day
//! would strand every one of them that had not read the release notes.
//!
//! So the address itself says which door it is:
//!
//! | `--server` | door |
//! |---|---|
//! | `relay.nodyx.org:7443` | the legacy raw-TCP port |
//! | `wss://tunnel.nodyx.org/tunnel` | WebSocket over HTTPS |
//!
//! The legacy form stays the default. Anyone who never touches their unit file
//! keeps working exactly as before, which is the only acceptable behaviour for
//! a fleet we do not control.

use std::fmt;

/// Where the client should dial, and how.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    /// The legacy door: a raw TCP socket, `host:port`.
    Tcp(String),
    /// The WebSocket door: a `ws://` or `wss://` URL.
    WebSocket(String),
}

/// Why an address could not be understood.
#[derive(Debug, PartialEq, Eq)]
pub enum TargetError {
    /// Nothing was given.
    Empty,
    /// A WebSocket URL without a host, such as `wss:///tunnel`.
    MissingHost,
    /// A plain address with no port, such as `relay.nodyx.org`.
    ///
    /// Refused rather than guessed: defaulting to 7443 would quietly send an
    /// instance to the door it was trying to leave.
    MissingPort,
    /// A scheme the client does not speak, such as `https://`.
    UnknownScheme,
}

impl fmt::Display for TargetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            TargetError::Empty => "no relay address given",
            TargetError::MissingHost => "WebSocket URL has no host",
            TargetError::MissingPort => "address needs a port, for example relay.nodyx.org:7443",
            TargetError::UnknownScheme => {
                "unsupported scheme: use host:port, ws:// or wss://"
            }
        };
        f.write_str(msg)
    }
}

impl std::error::Error for TargetError {}

impl Target {
    /// Read a `--server` value.
    pub fn parse(raw: &str) -> Result<Self, TargetError> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(TargetError::Empty);
        }

        if let Some(rest) = raw.strip_prefix("wss://").or_else(|| raw.strip_prefix("ws://")) {
            // The host is whatever precedes the path, and an empty one would
            // otherwise reach the TLS layer as a confusing failure much later.
            let host = rest.split('/').next().unwrap_or("");
            if host.is_empty() {
                return Err(TargetError::MissingHost);
            }
            return Ok(Target::WebSocket(raw.to_owned()));
        }

        // Any other scheme is a mistake worth naming, rather than being read as
        // a hostname containing a colon.
        if let Some((scheme, _)) = raw.split_once("://") {
            let _ = scheme;
            return Err(TargetError::UnknownScheme);
        }

        // `host:port`. An IPv6 literal carries its own colons, so only the part
        // after the closing bracket is inspected.
        let after_host = match raw.rsplit_once(']') {
            Some((_, tail)) => tail,
            None => raw,
        };
        let Some((_, port)) = after_host.rsplit_once(':') else {
            return Err(TargetError::MissingPort);
        };
        if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
            return Err(TargetError::MissingPort);
        }

        Ok(Target::Tcp(raw.to_owned()))
    }

    /// A short label for logs, so an operator can see which door was used.
    pub const fn door(&self) -> &'static str {
        match self {
            Target::Tcp(_) => "raw TCP",
            Target::WebSocket(_) => "WebSocket",
        }
    }
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Target::Tcp(s) | Target::WebSocket(s) => f.write_str(s),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_legacy_form_still_reads_as_raw_tcp() {
        // What every deployed unit file contains today. Changing how this reads
        // would strand the whole fleet at once.
        assert_eq!(
            Target::parse("relay.nodyx.org:7443"),
            Ok(Target::Tcp("relay.nodyx.org:7443".into()))
        );
        assert_eq!(
            Target::parse("relay6.nodyx.org:7443"),
            Ok(Target::Tcp("relay6.nodyx.org:7443".into()))
        );
    }

    #[test]
    fn a_websocket_url_reads_as_the_new_door() {
        for raw in [
            "wss://tunnel.nodyx.org/tunnel",
            "ws://127.0.0.1:7002/tunnel",
            "wss://tunnel.nodyx.org:443/tunnel",
        ] {
            assert_eq!(Target::parse(raw), Ok(Target::WebSocket(raw.into())), "{raw}");
        }
    }

    #[test]
    fn an_ipv6_literal_keeps_its_own_colons() {
        // Only the part after the closing bracket may hold the port, otherwise
        // the address itself would be mistaken for one.
        assert_eq!(
            Target::parse("[2a01:4f8:1c19:a30c::1]:7443"),
            Ok(Target::Tcp("[2a01:4f8:1c19:a30c::1]:7443".into()))
        );
        assert_eq!(
            Target::parse("[2a01:4f8:1c19:a30c::1]"),
            Err(TargetError::MissingPort)
        );
    }

    #[test]
    fn a_missing_port_is_refused_rather_than_guessed() {
        // Defaulting to 7443 would quietly send an instance back to the very
        // door it was trying to leave, and it would look like it worked.
        assert_eq!(Target::parse("relay.nodyx.org"), Err(TargetError::MissingPort));
        assert_eq!(Target::parse("relay.nodyx.org:"), Err(TargetError::MissingPort));
        assert_eq!(Target::parse("relay.nodyx.org:https"), Err(TargetError::MissingPort));
    }

    #[test]
    fn a_websocket_url_without_a_host_is_refused_early() {
        // Left alone it would surface much later as a puzzling TLS failure.
        assert_eq!(Target::parse("wss:///tunnel"), Err(TargetError::MissingHost));
        assert_eq!(Target::parse("ws://"), Err(TargetError::MissingHost));
    }

    #[test]
    fn other_schemes_are_named_rather_than_misread() {
        // `https://relay.nodyx.org` would otherwise parse as a host called
        // "https" on a nonsense port.
        assert_eq!(
            Target::parse("https://tunnel.nodyx.org"),
            Err(TargetError::UnknownScheme)
        );
        assert_eq!(Target::parse("tcp://relay.nodyx.org:7443"), Err(TargetError::UnknownScheme));
    }

    #[test]
    fn nothing_is_not_an_address() {
        assert_eq!(Target::parse(""), Err(TargetError::Empty));
        assert_eq!(Target::parse("   "), Err(TargetError::Empty));
    }

    #[test]
    fn surrounding_whitespace_is_forgiven() {
        // Unit files are edited by hand, and a stray space should not read as a
        // configuration error.
        assert_eq!(
            Target::parse("  relay.nodyx.org:7443  "),
            Ok(Target::Tcp("relay.nodyx.org:7443".into()))
        );
    }

    #[test]
    fn the_door_is_named_for_the_logs() {
        assert_eq!(Target::parse("relay.nodyx.org:7443").unwrap().door(), "raw TCP");
        assert_eq!(
            Target::parse("wss://tunnel.nodyx.org/tunnel").unwrap().door(),
            "WebSocket"
        );
    }
}
