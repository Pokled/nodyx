pub mod db;
pub mod http_proxy;
pub mod registry;
pub mod tcp_listener;

use std::sync::Arc;
use tracing::info;

use db::DbPool;
use registry::Registry;

/// Build the listen address from a host and a port.
///
/// An IPv6 literal must stay bracketed so that `[::]` + `7443` yields
/// `[::]:7443` and not `:::7443`, which no parser accepts.
pub fn listen_addr(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

pub async fn run(
    tcp_bind_host: &str,
    tcp_port: u16,
    http_port: u16,
    database_url: &str,
    main_slug: &str,
) -> anyhow::Result<()> {
    info!("Starting nodyx-relay server");
    info!("  TCP relay bind  : {tcp_bind_host}:{tcp_port}");
    info!("  HTTP proxy port : {http_port}");
    info!("  Main slug       : {main_slug}");

    // Auto-reconnecting PostgreSQL pool.
    let pg = Arc::new(DbPool::connect(database_url).await?);

    let registry = Registry::new();

    let tcp_bind  = listen_addr(tcp_bind_host, tcp_port);
    let http_bind = format!("127.0.0.1:{http_port}");
    let main_slug = main_slug.to_owned();

    tokio::try_join!(
        tcp_listener::run(&tcp_bind, registry.clone(), pg.clone()),
        http_proxy::run(&http_bind, registry.clone(), pg.clone(), main_slug),
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::listen_addr;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    #[test]
    fn ipv6_literal_stays_bracketed() {
        // `:::7443` is what a naive concatenation produces, and nothing parses it.
        assert_eq!(listen_addr("[::]", 7443), "[::]:7443");
        assert_eq!(listen_addr("0.0.0.0", 7443), "0.0.0.0:7443");
    }

    #[tokio::test]
    async fn both_addresses_parse_and_bind() {
        for host in ["[::]", "0.0.0.0"] {
            let addr = listen_addr(host, 0);
            let l = TcpListener::bind(&addr)
                .await
                .unwrap_or_else(|e| panic!("bind {addr} failed: {e}"));
            assert!(l.local_addr().is_ok(), "no local address for {addr}");
        }
    }

    /// THE point of the change: a relay bound on `[::]` must still serve the 24
    /// existing instances, which all connect over IPv4. Before it, the relay bound
    /// `0.0.0.0` and an IPv6-only network could not reach it at all.
    ///
    /// This test fails on a host where `net.ipv6.bindv6only` is 1, which is exactly
    /// the condition that would silently strand every IPv4 instance. Failing loudly
    /// here is the whole point.
    #[tokio::test]
    async fn ipv4_client_reaches_a_dual_stack_listener() {
        let listener = TcpListener::bind(listen_addr("[::]", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let accepted = tokio::spawn(async move {
            let (mut s, peer) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4];
            s.read_exact(&mut buf).await.unwrap();
            s.write_all(b"pong").await.unwrap();
            (buf, peer)
        });

        // Deliberately IPv4: this is what every deployed client speaks today.
        let mut c = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("an IPv4 client could not reach the [::] listener");
        c.write_all(b"ping").await.unwrap();
        let mut back = [0u8; 4];
        c.read_exact(&mut back).await.unwrap();

        let (got, peer) = accepted.await.unwrap();
        assert_eq!(&got, b"ping");
        assert_eq!(&back, b"pong");
        // The peer arrives as an IPv4-mapped IPv6 address, proof the socket carried it.
        assert!(peer.is_ipv6() || peer.is_ipv4(), "unexpected peer family: {peer}");
    }
}
