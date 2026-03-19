use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Forbidden")]
    Forbidden,
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Too many requests")]
    TooManyRequests(i64),
    #[error("Internal error")]
    Internal(#[from] anyhow::Error),
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(anyhow::anyhow!(e))
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        ApiError::Internal(anyhow::anyhow!(e))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::TooManyRequests(ttl) => {
                let mut resp = (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(json!({"error": "Too many requests", "code": "RATE_LIMITED"})),
                )
                    .into_response();
                resp.headers_mut().insert(
                    "Retry-After",
                    ttl.to_string().parse().unwrap_or_else(|_| "60".parse().unwrap()),
                );
                resp
            }
            ApiError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": msg})),
            ).into_response(),
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Unauthorized"})),
            ).into_response(),
            ApiError::Forbidden => (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Forbidden"})),
            ).into_response(),
            ApiError::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                Json(json!({"error": msg})),
            ).into_response(),
            ApiError::Conflict(msg) => (
                StatusCode::CONFLICT,
                Json(json!({"error": msg})),
            ).into_response(),
            ApiError::Internal(e) => {
                tracing::error!("Internal error: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Internal server error"})),
                ).into_response()
            }
        }
    }
}
