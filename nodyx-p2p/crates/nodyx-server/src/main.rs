mod error;
mod extractors;
mod routes;
mod services;
mod state;

use sqlx::postgres::PgPoolOptions;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use state::AppState;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nodyx_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // ── PostgreSQL ────────────────────────────────────────────────────────────
    let db_url = format!(
        "postgres://{}:{}@{}:{}/{}",
        std::env::var("DB_USER").unwrap_or_else(|_| "nexus".into()),
        std::env::var("DB_PASSWORD").unwrap_or_else(|_| "nexus".into()),
        std::env::var("DB_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
        std::env::var("DB_PORT").unwrap_or_else(|_| "5432".into()),
        std::env::var("DB_NAME").unwrap_or_else(|_| "nexus".into()),
    );

    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&db_url)
        .await?;

    tracing::info!("PostgreSQL connected");

    // ── Redis ─────────────────────────────────────────────────────────────────
    let redis_url = format!(
        "redis://{}:{}/",
        std::env::var("REDIS_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
        std::env::var("REDIS_PORT").unwrap_or_else(|_| "6379".into()),
    );
    let redis_client = redis::Client::open(redis_url)?;
    let redis = redis::aio::ConnectionManager::new(redis_client).await?;

    tracing::info!("Redis connected");

    // ── HTTP client ───────────────────────────────────────────────────────────
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("Nodyx-Server/0.1")
        .build()?;

    // ── Auth secrets ──────────────────────────────────────────────────────────
    let jwt_secret = std::env::var("JWT_SECRET")
        .expect("JWT_SECRET env var is required");

    // Pre-compute a bcrypt hash used for constant-time login checks when user not found.
    // This prevents timing-based user enumeration: we always run bcrypt regardless of
    // whether the user exists.
    let dummy_bcrypt_hash = tokio::task::spawn_blocking(|| {
        bcrypt::hash("nodyx-dummy-timing-protection-8x9z", 12)
            .expect("Failed to compute dummy bcrypt hash on startup")
    })
    .await?;

    tracing::info!("Auth secrets ready");

    let state = AppState { db, redis, http, jwt_secret, dummy_bcrypt_hash };

    // ── Router ────────────────────────────────────────────────────────────────
    let app = routes::build(state);

    let port: u16 = std::env::var("DIRECTORY_PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse()
        .unwrap_or(3001);

    let raw_host = std::env::var("DIRECTORY_HOST").ok();
    // A typo must not pass unnoticed: it would silently keep the safe default
    // while the operator believes they published the service.
    if let Some(h) = raw_host.as_deref() {
        let h = h.trim();
        if !h.is_empty() && h.parse::<IpAddr>().is_err() {
            tracing::warn!("DIRECTORY_HOST={h:?} is not an IP address, falling back to loopback");
        }
    }

    let addr = listen_addr(raw_host.as_deref(), port);
    tracing::info!("nodyx-server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

/// Where the API listens.
///
/// Loopback by default, and deliberately so. This process sits behind a reverse
/// proxy running on the same host, so binding every interface would publish it
/// straight to the internet and leave a firewall rule as the only thing in the
/// way. One line of defence is not two.
///
/// `DIRECTORY_HOST` overrides it, matching the `DIRECTORY_PORT` convention, for
/// a deployment whose proxy really does live on another machine.
///
/// Anything unparseable falls back to loopback rather than to every interface:
/// a mistake should close a door, never open one.
fn listen_addr(host: Option<&str>, port: u16) -> SocketAddr {
    let ip = host
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .and_then(|h| h.parse::<IpAddr>().ok())
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    SocketAddr::new(ip, port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_loopback_not_every_interface() {
        // The whole point. Before this existed the address was hardcoded to
        // 0.0.0.0, and only a firewall rule kept the API off the internet.
        assert_eq!(
            listen_addr(None, 3100),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 3100)
        );
    }

    #[test]
    fn an_explicit_address_is_honoured() {
        // A deployment whose proxy sits on another machine must still be able to
        // say so, out loud, rather than by editing the source.
        assert_eq!(
            listen_addr(Some("0.0.0.0"), 3100),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 3100)
        );
        assert_eq!(
            listen_addr(Some("::1"), 3100),
            SocketAddr::new("::1".parse::<IpAddr>().unwrap(), 3100)
        );
    }

    #[test]
    fn surrounding_whitespace_is_forgiven() {
        // Environment files are edited by hand, and a stray space should not
        // silently downgrade the operator's intent.
        assert_eq!(
            listen_addr(Some("  0.0.0.0  "), 3100),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 3100)
        );
    }

    #[test]
    fn a_mistake_closes_the_door_rather_than_opening_it() {
        // A typo, an empty value, a hostname where an address was expected: all
        // fall back to loopback. Falling back to 0.0.0.0 would mean a slip of
        // the finger publishes the API.
        for bogus in ["", "   ", "0.0.0.o", "localhost", "not an address"] {
            assert_eq!(
                listen_addr(Some(bogus), 3100),
                SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 3100),
                "{bogus:?} must fall back to loopback"
            );
        }
    }
}
