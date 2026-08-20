//! Identifying the real client behind a reverse proxy.
//!
//! # Why this module exists
//!
//! The relay bans an IP after repeated authentication failures. That defence
//! only works if "the IP" actually identifies the caller.
//!
//! Over the legacy raw-TCP port, the TCP peer *is* the client, so reading
//! `SocketAddr::ip()` is correct. Over the WebSocket transport the chain is:
//!
//! ```text
//! client -> Cloudflare -> Caddy (:443) -> reverse_proxy -> relay (localhost)
//! ```
//!
//! Every WebSocket client would therefore look like `127.0.0.1`. Five failed
//! authentications from *anyone* would ban that address and lock out **every**
//! WebSocket client at once, while the brute-force protection itself became
//! useless. This is the same failure the HTTP core hit in August 2026, where a
//! single rate-limit bucket was shared by the entire internet.
//!
//! # The rule
//!
//! A forwarding header is believed **only** when the TCP peer is one of our own
//! proxies. Nothing in a request can forge the peer address, so that is the one
//! fact worth trusting:
//!
//! | TCP peer | behaviour |
//! |---|---|
//! | trusted proxy | read `CF-Connecting-IP`, then `X-Forwarded-For`, then `X-Real-IP` |
//! | anything else | ignore every header and use the peer |
//!
//! Without the second row, a client reaching the relay directly could claim any
//! address it liked and slip past bans entirely.
//!
//! A header value that is not publicly routable is refused as well: it cannot
//! designate a visitor from the internet, and a Cloudflare edge address is our
//! own infrastructure rather than a caller.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// A network prefix, stored as an address and the number of significant bits.
#[derive(Clone, Copy)]
struct Cidr {
    net: IpAddr,
    bits: u8,
}

impl Cidr {
    /// Does `addr` fall inside this prefix?
    ///
    /// Families never match across each other: an IPv4 address is never inside
    /// an IPv6 prefix, even when the prefix describes a mapped range.
    fn contains(&self, addr: IpAddr) -> bool {
        match (self.net, addr) {
            (IpAddr::V4(net), IpAddr::V4(ip)) => {
                prefix_eq(&net.octets(), &ip.octets(), self.bits)
            }
            (IpAddr::V6(net), IpAddr::V6(ip)) => {
                prefix_eq(&net.octets(), &ip.octets(), self.bits)
            }
            _ => false,
        }
    }
}

/// Compare the first `bits` bits of two equal-length octet strings.
fn prefix_eq(a: &[u8], b: &[u8], bits: u8) -> bool {
    let full = (bits / 8) as usize;
    if a[..full] != b[..full] {
        return false;
    }
    let rest = bits % 8;
    if rest == 0 {
        return true;
    }
    // Compare only the leading `rest` bits of the next octet.
    let mask = 0xffu8 << (8 - rest);
    (a[full] & mask) == (b[full] & mask)
}

const fn v4(a: u8, b: u8, c: u8, d: u8, bits: u8) -> Cidr {
    Cidr { net: IpAddr::V4(Ipv4Addr::new(a, b, c, d)), bits }
}

const fn v6(segments: [u16; 8], bits: u8) -> Cidr {
    let [a, b, c, d, e, f, g, h] = segments;
    Cidr { net: IpAddr::V6(Ipv6Addr::new(a, b, c, d, e, f, g, h)), bits }
}

/// Cloudflare edge ranges.
///
/// Kept in step with `nodyx-core/src/utils/clientIp.ts` and
/// `nodyx-core/src/config/trustedProxies.ts`, which share the same source.
/// An edge address is our own infrastructure: it is trusted as a peer, and
/// refused as a claimed client.
const CLOUDFLARE: &[Cidr] = &[
    v4(173, 245, 48, 0, 20),
    v4(103, 21, 244, 0, 22),
    v4(103, 22, 200, 0, 22),
    v4(103, 31, 4, 0, 22),
    v4(141, 101, 64, 0, 18),
    v4(108, 162, 192, 0, 18),
    v4(190, 93, 240, 0, 20),
    v4(188, 114, 96, 0, 20),
    v4(197, 234, 240, 0, 22),
    v4(198, 41, 128, 0, 17),
    v4(162, 158, 0, 0, 15),
    v4(104, 16, 0, 0, 13),
    v4(104, 24, 0, 0, 14),
    v4(172, 64, 0, 0, 13),
    v4(131, 0, 72, 0, 22),
    v6([0x2400, 0xcb00, 0, 0, 0, 0, 0, 0], 32),
    v6([0x2606, 0x4700, 0, 0, 0, 0, 0, 0], 32),
    v6([0x2803, 0xf800, 0, 0, 0, 0, 0, 0], 32),
    v6([0x2405, 0xb500, 0, 0, 0, 0, 0, 0], 32),
    v6([0x2405, 0x8100, 0, 0, 0, 0, 0, 0], 32),
    v6([0x2a06, 0x98c0, 0, 0, 0, 0, 0, 0], 29),
    v6([0x2c0f, 0xf248, 0, 0, 0, 0, 0, 0], 32),
];

/// Ranges that cannot designate a visitor arriving from the internet.
///
/// Documentation ranges are included on purpose: they were observed in real
/// traffic being passed off as client addresses.
const NOT_PUBLIC: &[Cidr] = &[
    // IPv4
    v4(0, 0, 0, 0, 8),          // "this network"
    v4(10, 0, 0, 0, 8),         // private
    v4(100, 64, 0, 0, 10),      // carrier-grade NAT
    v4(127, 0, 0, 0, 8),        // loopback
    v4(169, 254, 0, 0, 16),     // link-local
    v4(172, 16, 0, 0, 12),      // private
    v4(192, 0, 0, 0, 24),       // IETF protocol assignments
    v4(192, 0, 2, 0, 24),       // TEST-NET-1
    v4(192, 168, 0, 0, 16),     // private
    v4(198, 18, 0, 0, 15),      // benchmarking
    v4(198, 51, 100, 0, 24),    // TEST-NET-2
    v4(203, 0, 113, 0, 24),     // TEST-NET-3
    v4(224, 0, 0, 0, 4),        // multicast
    v4(240, 0, 0, 0, 4),        // reserved, includes broadcast
    // IPv6
    v6([0, 0, 0, 0, 0, 0, 0, 0], 128),                  // unspecified
    v6([0, 0, 0, 0, 0, 0, 0, 1], 128),                  // loopback
    v6([0x64, 0xff9b, 0, 0, 0, 0, 0, 0], 96),           // IPv4/IPv6 translation
    v6([0x100, 0, 0, 0, 0, 0, 0, 0], 64),               // discard-only
    v6([0x2001, 0, 0, 0, 0, 0, 0, 0], 32),              // Teredo
    v6([0x2001, 0x20, 0, 0, 0, 0, 0, 0], 28),           // ORCHIDv2
    v6([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0], 32),          // documentation
    v6([0x2002, 0, 0, 0, 0, 0, 0, 0], 16),              // 6to4
    v6([0xfc00, 0, 0, 0, 0, 0, 0, 0], 7),               // unique local
    v6([0xfe80, 0, 0, 0, 0, 0, 0, 0], 10),              // link-local
    v6([0xff00, 0, 0, 0, 0, 0, 0, 0], 8),               // multicast
];

/// Unwrap an IPv4-mapped IPv6 address so it is judged on its IPv4 half.
///
/// `::ffff:127.0.0.1` is loopback, and must be treated as such rather than as
/// an unremarkable IPv6 address. The relay sees these routinely: a dual-stack
/// listener reports IPv4 peers in mapped form.
fn unmap(addr: IpAddr) -> IpAddr {
    match addr {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => addr,
        },
        v4 => v4,
    }
}

/// Is this one of Cloudflare's edge addresses?
pub fn is_cloudflare(addr: IpAddr) -> bool {
    let addr = unmap(addr);
    CLOUDFLARE.iter().any(|c| c.contains(addr))
}

/// Can this address designate a visitor arriving from the internet?
///
/// Private, loopback, reserved and documentation ranges are refused, and so are
/// Cloudflare edges: those are our own infrastructure, not a caller.
pub fn is_publicly_routable(addr: IpAddr) -> bool {
    let addr = unmap(addr);
    !NOT_PUBLIC.iter().any(|c| c.contains(addr)) && !is_cloudflare(addr)
}

/// May this peer tell us who the real client is?
///
/// Only our own front doors may: a local reverse proxy, a neighbour on the
/// private network, or a Cloudflare edge. Nothing in a request can forge the
/// peer address, which is what makes this check worth anything.
pub fn is_trusted_peer(addr: IpAddr) -> bool {
    let addr = unmap(addr);
    if addr.is_loopback() {
        return true;
    }
    match addr {
        IpAddr::V4(ip) => ip.is_private() || ip.is_link_local() || is_cloudflare(addr),
        IpAddr::V6(_) => {
            // Unique-local (fc00::/7) and link-local (fe80::/10) stand in for
            // "same private network"; `Ipv6Addr` has no stable predicate yet.
            const ULA: Cidr = v6([0xfc00, 0, 0, 0, 0, 0, 0, 0], 7);
            const LINK_LOCAL: Cidr = v6([0xfe80, 0, 0, 0, 0, 0, 0, 0], 10);
            ULA.contains(addr) || LINK_LOCAL.contains(addr) || is_cloudflare(addr)
        }
    }
}

/// Headers, in the order they are believed.
///
/// `CF-Connecting-IP` comes first: on the Cloudflare path it is the only
/// trustworthy source, and the tunnel emits it while omitting
/// `X-Forwarded-For` entirely.
const FORWARDING_HEADERS: [&str; 3] = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"];

/// The address to hold responsible for this connection.
///
/// `lookup` receives a lowercase header name and returns its raw value. Keeping
/// it a closure avoids tying this module to any particular HTTP library, so the
/// same logic serves the WebSocket upgrade and anything added later.
///
/// Falls back to `peer` whenever nothing credible is available, so callers
/// always get an address to key a ban on.
pub fn client_ip<F>(peer: IpAddr, lookup: F) -> IpAddr
where
    F: Fn(&str) -> Option<String>,
{
    if !is_trusted_peer(peer) {
        // An unknown peer speaks only for itself. Skipping this would let any
        // direct caller claim an address and walk past every ban.
        return peer;
    }

    for name in FORWARDING_HEADERS {
        let Some(raw) = lookup(name) else { continue };
        // `X-Forwarded-For` may carry a chain: the first entry is the client,
        // the rest are the proxies it crossed.
        let first = raw.split(',').next().unwrap_or("").trim().to_owned();
        if first.is_empty() {
            continue;
        }
        if let Ok(addr) = first.parse::<IpAddr>() {
            if is_publicly_routable(addr) {
                return unmap(addr);
            }
        }
    }

    peer
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("test address should parse")
    }

    /// Build a lookup over a fixed set of headers.
    fn headers(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let owned: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |name| {
            owned
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        }
    }

    // ── The failure this module exists to prevent ────────────────────────────

    #[test]
    fn websocket_clients_are_told_apart_behind_the_proxy() {
        // Caddy reverse-proxies from localhost, so without the header every
        // WebSocket client would share one address and one ban.
        let caddy = ip("127.0.0.1");
        let a = client_ip(caddy, headers(&[("cf-connecting-ip", "203.0.114.9")]));
        let b = client_ip(caddy, headers(&[("cf-connecting-ip", "198.51.101.7")]));
        assert_eq!(a, ip("203.0.114.9"));
        assert_eq!(b, ip("198.51.101.7"));
        assert_ne!(a, b, "two callers must not collapse onto one address");
    }

    #[test]
    fn a_direct_caller_cannot_choose_its_own_address() {
        // The other half of the rule. Believing this header would let anyone
        // reaching the relay directly walk past every ban.
        let attacker = ip("203.0.114.9");
        let seen = client_ip(attacker, headers(&[("cf-connecting-ip", "8.8.8.8")]));
        assert_eq!(seen, attacker);
    }

    #[test]
    fn the_raw_tcp_listener_keeps_using_the_peer() {
        // The invariant that listener depends on. It is reached directly, so it
        // passes an empty lookup: the answer must be the peer itself, unchanged,
        // whatever an untrusted caller might otherwise have claimed.
        for s in ["203.0.114.9", "62.60.130.128", "2a01:4f8:1c19:a30c::1"] {
            assert_eq!(client_ip(ip(s), |_| None), ip(s), "{s} should be kept as-is");
        }
    }

    // ── Header precedence ────────────────────────────────────────────────────

    #[test]
    fn cloudflare_header_wins_over_the_others() {
        let seen = client_ip(
            ip("127.0.0.1"),
            headers(&[
                ("x-real-ip", "1.1.1.1"),
                ("x-forwarded-for", "9.9.9.9"),
                ("cf-connecting-ip", "203.0.114.9"),
            ]),
        );
        assert_eq!(seen, ip("203.0.114.9"));
    }

    #[test]
    fn forwarded_for_keeps_only_the_first_entry() {
        let seen = client_ip(
            ip("127.0.0.1"),
            headers(&[("x-forwarded-for", "203.0.114.9, 162.158.1.1, 10.0.0.5")]),
        );
        assert_eq!(seen, ip("203.0.114.9"));
    }

    #[test]
    fn falls_through_to_the_next_header_when_one_is_unusable() {
        let seen = client_ip(
            ip("127.0.0.1"),
            headers(&[
                ("cf-connecting-ip", "10.0.0.5"),   // private, refused
                ("x-forwarded-for", "not-an-ip"),   // unparsable, refused
                ("x-real-ip", "203.0.114.9"),
            ]),
        );
        assert_eq!(seen, ip("203.0.114.9"));
    }

    #[test]
    fn keeps_the_peer_when_no_header_is_credible() {
        let peer = ip("127.0.0.1");
        assert_eq!(client_ip(peer, headers(&[("cf-connecting-ip", "127.0.0.1")])), peer);
        assert_eq!(client_ip(peer, headers(&[])), peer);
    }

    // ── Which addresses may be claimed ───────────────────────────────────────

    #[test]
    fn refuses_addresses_that_designate_no_visitor() {
        for s in [
            "127.0.0.1", "10.0.0.5", "192.168.1.9", "172.16.4.2", "169.254.1.1",
            "100.64.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1",
            "::1", "fe80::1", "fd00::1", "2001:db8::1",
        ] {
            assert!(!is_publicly_routable(ip(s)), "{s} should not be routable");
        }
    }

    #[test]
    fn refuses_documentation_ranges_seen_in_real_traffic() {
        assert!(!is_publicly_routable(ip("192.0.2.1")));
        assert!(!is_publicly_routable(ip("198.51.100.4")));
        assert!(!is_publicly_routable(ip("203.0.113.9")));
    }

    #[test]
    fn refuses_our_own_edges_as_callers() {
        // Observed in production data being reported as a client.
        assert!(is_cloudflare(ip("2a06:98c0:3600::103")));
        assert!(is_cloudflare(ip("162.158.1.1")));
        assert!(!is_publicly_routable(ip("162.158.1.1")));
    }

    #[test]
    fn accepts_real_addresses() {
        for s in ["103.78.255.128", "62.60.130.128", "8.8.8.8", "2a01:4f8:1c19:a30c::1"] {
            assert!(is_publicly_routable(ip(s)), "{s} should be routable");
        }
    }

    // ── Peers allowed to speak for someone else ──────────────────────────────

    #[test]
    fn trusts_only_our_own_front_doors() {
        for s in ["127.0.0.1", "::1", "10.0.0.5", "192.168.1.1", "162.158.1.1", "fd00::1"] {
            assert!(is_trusted_peer(ip(s)), "{s} should be trusted");
        }
        for s in ["8.8.8.8", "203.0.114.9", "2a01:4f8:1c19:a30c::1"] {
            assert!(!is_trusted_peer(ip(s)), "{s} should not be trusted");
        }
    }

    // ── Mapped addresses ─────────────────────────────────────────────────────

    #[test]
    fn judges_mapped_addresses_on_their_ipv4_half() {
        // A dual-stack listener reports IPv4 peers in mapped form, so this is
        // the everyday case rather than an exotic one.
        assert!(is_trusted_peer(ip("::ffff:127.0.0.1")));
        assert!(!is_publicly_routable(ip("::ffff:10.0.0.5")));
        assert!(is_publicly_routable(ip("::ffff:8.8.8.8")));
        assert_eq!(
            client_ip(ip("::ffff:127.0.0.1"), headers(&[("cf-connecting-ip", "8.8.8.8")])),
            ip("8.8.8.8"),
        );
    }

    #[test]
    fn returns_a_claimed_mapped_address_in_its_ipv4_form() {
        // Two spellings of one address must not key two different bans.
        let seen = client_ip(ip("127.0.0.1"), headers(&[("cf-connecting-ip", "::ffff:8.8.8.8")]));
        assert_eq!(seen, ip("8.8.8.8"));
    }

    // ── Prefix arithmetic ────────────────────────────────────────────────────

    #[test]
    fn prefix_matching_respects_bit_boundaries() {
        // 162.158.0.0/15 covers 162.158 and 162.159, and stops there.
        assert!(is_cloudflare(ip("162.158.0.1")));
        assert!(is_cloudflare(ip("162.159.255.254")));
        assert!(!is_cloudflare(ip("162.160.0.1")));
        assert!(!is_cloudflare(ip("162.157.255.254")));
    }

    #[test]
    fn families_never_match_across_each_other() {
        // An IPv4 address must not fall inside an IPv6 prefix, or the whole
        // classification would be meaningless.
        assert!(!is_cloudflare(ip("36.6.71.0")));
        assert!(is_publicly_routable(ip("36.6.71.0")));
    }
}
