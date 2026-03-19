use async_trait::async_trait;
use axum::{
    extract::FromRequestParts,
    http::request::Parts,
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::ApiError;
use crate::state::AppState;

/// JWT claims — must match Node.js jwt.sign({ userId, username }, secret, { expiresIn: '7d' })
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub username: String,
    pub exp: usize,
    pub iat: usize,
}

/// Extracted from `Authorization: Bearer <token>` + Redis session check.
/// Use as a handler parameter to require authentication.
pub struct AuthUser {
    pub user_id:  Uuid,
    pub username: String,
    /// The raw JWT token (needed for logout)
    pub token: String,
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or(ApiError::Unauthorized)?;

        if !auth_header.starts_with("Bearer ") {
            return Err(ApiError::Unauthorized);
        }
        let token = auth_header[7..].to_string();

        // 1 — Verify JWT signature + expiry
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["exp", "userId", "username"]);

        let token_data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &validation,
        )
        .map_err(|_| ApiError::Unauthorized)?;

        // 2 — Verify Redis session is still active
        let session_key = format!("session:{}", token);
        let exists: bool = state
            .redis
            .clone()
            .exists(&session_key)
            .await
            .unwrap_or(false);

        if !exists {
            return Err(ApiError::Unauthorized);
        }

        let user_id = Uuid::parse_str(&token_data.claims.user_id)
            .map_err(|_| ApiError::Unauthorized)?;

        Ok(AuthUser {
            user_id,
            username: token_data.claims.username,
            token,
        })
    }
}
