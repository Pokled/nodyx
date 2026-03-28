use async_trait::async_trait;
use axum::{
    extract::FromRequestParts,
    http::{request::Parts, HeaderMap},
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
        let session_key = format!("nodyx:session:{}", token);
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

/// Try to extract a user_id from `Authorization: Bearer <token>` without failing.
/// Used for routes that support optional authentication (viewerId).
pub async fn optional_auth(headers: &HeaderMap, state: &AppState) -> Option<Uuid> {
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())?;

    if !auth_header.starts_with("Bearer ") {
        return None;
    }
    let token = &auth_header[7..];

    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp", "userId", "username"]);

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &validation,
    )
    .ok()?;

    let exists: bool = state
        .redis
        .clone()
        .exists(format!("nodyx:session:{}", token))
        .await
        .unwrap_or(false);

    if !exists {
        return None;
    }

    Uuid::parse_str(&token_data.claims.user_id).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_secs() -> usize {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as usize
    }

    fn make_token(user_id: &str, username: &str, secret: &str) -> String {
        let payload = serde_json::json!({
            "userId":   user_id,
            "username": username,
            "exp": now_secs() + 3600,
            "iat": now_secs(),
        });
        encode(
            &Header::default(),
            &payload,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    // ── Claims serde ──────────────────────────────────────────────────────────

    #[test]
    fn claims_deserializes_user_id_renamed_field() {
        // userId (camelCase) → user_id (snake_case) via #[serde(rename = "userId")]
        let json = r#"{"userId":"abc-123","username":"testuser","exp":9999999999,"iat":0}"#;
        let claims: Claims = serde_json::from_str(json).unwrap();
        assert_eq!(claims.user_id, "abc-123");
        assert_eq!(claims.username, "testuser");
    }

    #[test]
    fn claims_rejects_missing_user_id() {
        let json = r#"{"username":"testuser","exp":9999999999,"iat":0}"#;
        let result: Result<Claims, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Claims without userId must fail deserialization");
    }

    #[test]
    fn claims_rejects_missing_username() {
        let json = r#"{"userId":"abc","exp":9999999999,"iat":0}"#;
        let result: Result<Claims, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Claims without username must fail deserialization");
    }

    // ── JWT decode ────────────────────────────────────────────────────────────

    #[test]
    fn jwt_decodes_valid_token_with_correct_secret() {
        let secret = "test-jwt-secret";
        let token = make_token("user-uuid-1", "pokled", secret);

        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["exp", "userId", "username"]);

        let data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        );
        assert!(data.is_ok());
        let claims = data.unwrap().claims;
        assert_eq!(claims.user_id, "user-uuid-1");
        assert_eq!(claims.username, "pokled");
    }

    #[test]
    fn jwt_rejects_token_signed_with_wrong_secret() {
        let token = make_token("user-uuid-1", "pokled", "correct-secret");

        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["exp", "userId", "username"]);

        let result = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(b"wrong-secret"),
            &validation,
        );
        assert!(result.is_err(), "JWT signed with wrong secret must be rejected");
    }

    #[test]
    fn jwt_rejects_expired_token() {
        let secret = "test-jwt-secret";
        let expired_payload = serde_json::json!({
            "userId":   "user-uuid-1",
            "username": "pokled",
            "exp": 1000u64,   // epoch 1000 — expired since 1970-01-01T00:16:40Z
            "iat": 0u64,
        });
        let token = encode(
            &Header::default(),
            &expired_payload,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap();

        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["exp", "userId", "username"]);

        let result = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        );
        assert!(result.is_err(), "Expired JWT must be rejected");
    }

    #[test]
    fn jwt_rejects_malformed_token() {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["exp", "userId", "username"]);

        let result = decode::<Claims>(
            "not.a.valid.jwt",
            &DecodingKey::from_secret(b"secret"),
            &validation,
        );
        assert!(result.is_err(), "Malformed JWT must be rejected");
    }
}
