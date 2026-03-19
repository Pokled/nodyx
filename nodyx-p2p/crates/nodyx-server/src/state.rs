use redis::aio::ConnectionManager;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db:                PgPool,
    pub redis:             ConnectionManager,
    pub http:              reqwest::Client,
    /// JWT secret read from JWT_SECRET env var at startup
    pub jwt_secret:        String,
    /// Pre-computed bcrypt hash used for constant-time login checks when user not found
    pub dummy_bcrypt_hash: String,
}
