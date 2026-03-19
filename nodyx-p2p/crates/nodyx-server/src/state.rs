use redis::aio::ConnectionManager;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db:    PgPool,
    pub redis: ConnectionManager,
    pub http:  reqwest::Client,
}
