mod error;
mod extractors;
mod routes;
mod services;
mod state;

use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
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

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("nodyx-server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
