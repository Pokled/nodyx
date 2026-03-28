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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    async fn status_of(e: ApiError) -> StatusCode {
        e.into_response().status()
    }

    async fn body_of(e: ApiError) -> serde_json::Value {
        let resp = e.into_response();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn bad_request_is_400() {
        assert_eq!(status_of(ApiError::BadRequest("oops".into())).await, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn unauthorized_is_401() {
        assert_eq!(status_of(ApiError::Unauthorized).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn forbidden_is_403() {
        assert_eq!(status_of(ApiError::Forbidden).await, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn not_found_is_404() {
        assert_eq!(status_of(ApiError::NotFound("resource".into())).await, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn conflict_is_409() {
        assert_eq!(status_of(ApiError::Conflict("duplicate".into())).await, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn too_many_requests_is_429_with_retry_after_header() {
        let resp = ApiError::TooManyRequests(42).into_response();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(resp.headers().get("Retry-After").unwrap(), "42");
    }

    #[tokio::test]
    async fn internal_error_is_500() {
        let err = ApiError::Internal(anyhow::anyhow!("crash"));
        assert_eq!(status_of(err).await, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn bad_request_body_has_error_message() {
        let body = body_of(ApiError::BadRequest("invalid input".into())).await;
        assert_eq!(body["error"], "invalid input");
    }

    #[tokio::test]
    async fn unauthorized_body_has_error_field() {
        let body = body_of(ApiError::Unauthorized).await;
        assert_eq!(body["error"], "Unauthorized");
    }

    #[tokio::test]
    async fn too_many_requests_body_has_rate_limited_code() {
        let body = body_of(ApiError::TooManyRequests(30)).await;
        assert_eq!(body["code"], "RATE_LIMITED");
    }

    #[tokio::test]
    async fn internal_body_does_not_leak_error_details() {
        let body = body_of(ApiError::Internal(anyhow::anyhow!("db password: secret123"))).await;
        assert_eq!(body["error"], "Internal server error");
        let body_str = body.to_string();
        assert!(!body_str.contains("secret123"), "internal error must not leak details");
    }
}
