/// Auth routes — port of nodyx-core/src/routes/auth.ts
///
/// POST   /api/v1/auth/register
/// POST   /api/v1/auth/login
/// POST   /api/v1/auth/logout              (requires auth)
/// POST   /api/v1/auth/forgot-password
/// GET    /api/v1/auth/verify-reset/:token
/// POST   /api/v1/auth/reset-password/:token
/// GET    /api/v1/auth/verify-email/:token
/// POST   /api/v1/auth/resend-verification

use axum::{
    extract::{ConnectInfo, Path, State},
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use jsonwebtoken::{encode, EncodingKey, Header};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::error::ApiError;
use crate::extractors::{AuthUser, Claims};
use crate::services::email::EmailService;
use crate::state::AppState;

const SESSION_TTL: u64     = 7 * 24 * 60 * 60; // 7 days
const RESET_TTL_SEC: u64   = 60 * 60;           // 1 hour
const BCRYPT_ROUNDS: u32   = 12;

/// Cached community_id for auto-join on register/login
static COMMUNITY_ID: OnceCell<Option<Uuid>> = OnceCell::const_new();

async fn get_community_id(db: &sqlx::PgPool) -> Option<Uuid> {
    COMMUNITY_ID
        .get_or_init(|| async {
            let slug = std::env::var("NODYX_COMMUNITY_SLUG").ok();
            let row: Option<(Uuid,)> = if let Some(ref slug) = slug {
                sqlx::query_as("SELECT id FROM communities WHERE slug = $1 LIMIT 1")
                    .bind(slug)
                    .fetch_optional(db)
                    .await
                    .ok()
                    .flatten()
            } else {
                sqlx::query_as("SELECT id FROM communities ORDER BY created_at ASC LIMIT 1")
                    .fetch_optional(db)
                    .await
                    .ok()
                    .flatten()
            };
            row.map(|(id,)| id)
        })
        .await
        .clone()
}

// ── Rate limiting helpers ─────────────────────────────────────────────────────

/// Returns the remaining TTL for a rate-limited key, or None if not limited.
async fn check_rate_limit(
    redis: &mut impl AsyncCommands,
    key: &str,
    max: i64,
    window_secs: u64,
) -> Result<(), ApiError> {
    let count: i64 = redis.incr(key, 1i64).await?;
    if count == 1 {
        let _: bool = redis.expire(key, window_secs as i64).await?;
    }
    if count > max {
        let ttl: i64 = redis.ttl(key).await.unwrap_or(window_secs as i64);
        return Err(ApiError::TooManyRequests(ttl));
    }
    Ok(())
}

fn extract_ip(headers: &HeaderMap, connect_info: &ConnectInfo<SocketAddr>) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| connect_info.0.ip().to_string())
}

// ── JWT ───────────────────────────────────────────────────────────────────────

fn sign_token(user_id: &Uuid, username: &str, secret: &str) -> Result<String, ApiError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    let claims = Claims {
        user_id:  user_id.to_string(),
        username: username.to_string(),
        iat:      now,
        exp:      now + SESSION_TTL as usize,
    };

    encode(
        &Header::default(), // HS256
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("JWT sign: {}", e)))
}

// ── Session helpers ───────────────────────────────────────────────────────────

async fn track_session(
    redis: &mut impl AsyncCommands,
    user_id: &Uuid,
    token: &str,
) -> Result<(), ApiError> {
    let index_key = format!("user_sessions:{}", user_id);
    let _: i64  = redis.sadd(&index_key, token).await?;
    let _: bool = redis.expire(&index_key, SESSION_TTL as i64).await?;
    Ok(())
}

pub async fn invalidate_user_sessions(
    redis: &mut impl AsyncCommands,
    user_id: &Uuid,
) -> Result<(), ApiError> {
    let index_key = format!("user_sessions:{}", user_id);
    let tokens: Vec<String> = redis.smembers(&index_key).await.unwrap_or_default();

    if !tokens.is_empty() {
        let session_keys: Vec<String> = tokens
            .iter()
            .map(|t| format!("session:{}", t))
            .collect();
        // DEL all session keys + the index key in one call
        let mut all_keys = session_keys;
        all_keys.push(index_key);
        let _: i64 = redis.del(all_keys).await?;
    } else {
        let _: i64 = redis.del(&index_key).await?;
    }
    Ok(())
}

fn sha256_hex(input: &str) -> String {
    hex::encode(Sha256::digest(input.as_bytes()))
}

// ── Request/response types ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterBody {
    username: String,
    email:    String,
    password: String,
}

#[derive(Deserialize)]
struct LoginBody {
    email:    String,
    password: String,
}

#[derive(Deserialize)]
struct EmailBody {
    email: String,
}

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

#[derive(Serialize)]
struct UserPublic {
    id:       Uuid,
    username: String,
    email:    String,
}

#[derive(Serialize)]
struct TokenResponse {
    token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    user:  Option<UserPublic>,
}

// ── DB row types ──────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct UserRow {
    id:             Uuid,
    username:       String,
    email:          String,
    password:       String,
    email_verified: Option<bool>,
}

// ── Route builder ─────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register",             post(register_handler))
        .route("/auth/login",                post(login_handler))
        .route("/auth/logout",               post(logout_handler))
        .route("/auth/forgot-password",      post(forgot_password_handler))
        .route("/auth/verify-reset/:token",  get(verify_reset_handler))
        .route("/auth/reset-password/:token",post(reset_password_handler))
        .route("/auth/verify-email/:token",  get(verify_email_handler))
        .route("/auth/resend-verification",  post(resend_verification_handler))
}

// ── POST /api/v1/auth/register ────────────────────────────────────────────────

async fn register_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RegisterBody>,
) -> Result<impl IntoResponse, ApiError> {
    // Basic validation
    let username = body.username.trim().to_string();
    let email    = body.email.trim().to_lowercase();
    let password = body.password.clone();

    if username.len() < 3 || username.len() > 50 {
        return Err(ApiError::BadRequest("Username must be 3–50 characters".into()));
    }
    if password.len() < 8 || password.len() > 100 {
        return Err(ApiError::BadRequest("Password must be 8–100 characters".into()));
    }
    if !email.contains('@') {
        return Err(ApiError::BadRequest("Invalid email".into()));
    }

    let client_ip = extract_ip(&headers, &ConnectInfo(addr));
    let mut redis = state.redis.clone();

    // Rate limit: 5 accounts / hour / IP
    check_rate_limit(&mut redis, &format!("register_rate:{}", client_ip), 5, 3600).await?;

    let max_members: Option<i64> = std::env::var("NODYX_MAX_MEMBERS")
        .ok()
        .and_then(|v| v.parse().ok());

    // Parallel checks
    let (existing_email, existing_username, ip_ban, email_ban, member_count) = tokio::join!(
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)"
        ).bind(&email).fetch_one(&state.db),
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE lower(username) = lower($1))"
        ).bind(&username).fetch_one(&state.db),
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM ip_bans WHERE ip = $1::inet)"
        ).bind(&client_ip).fetch_one(&state.db),
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM email_bans WHERE $1 = email OR split_part($1, '@', 2) = email)"
        ).bind(&email).fetch_one(&state.db),
        async {
            if max_members.is_some() {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*)::bigint FROM users u \
                     WHERE NOT EXISTS (SELECT 1 FROM community_bans cb \
                       JOIN communities c ON c.id = cb.community_id \
                       WHERE cb.user_id = u.id LIMIT 1)"
                ).fetch_one(&state.db).await
            } else {
                Ok(0i64)
            }
        }
    );

    if existing_email? { return Err(ApiError::Conflict("EMAIL_TAKEN".into())); }
    if existing_username? { return Err(ApiError::Conflict("USERNAME_TAKEN".into())); }
    if ip_ban? { return Err(ApiError::Forbidden); }
    if email_ban? { return Err(ApiError::Forbidden); }
    if let Some(max) = max_members {
        if member_count? >= max {
            return Err(ApiError::Forbidden);
        }
    }

    // Hash password (blocking — bcrypt is CPU-intensive)
    let hashed = tokio::task::spawn_blocking({
        let pw = password.clone();
        move || bcrypt::hash(pw, BCRYPT_ROUNDS)
    })
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    // Create user
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id"
    )
    .bind(&username)
    .bind(&email)
    .bind(&hashed)
    .fetch_one(&state.db)
    .await?;

    // Store registration IP
    let _ = sqlx::query("UPDATE users SET registration_ip = $1::inet WHERE id = $2")
        .bind(&client_ip)
        .bind(user_id)
        .execute(&state.db)
        .await;

    // Auto-join community
    if let Some(community_id) = get_community_id(&state.db).await {
        let _ = sqlx::query(
            "INSERT INTO community_members (community_id, user_id, role) \
             VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING"
        )
        .bind(community_id)
        .bind(user_id)
        .execute(&state.db)
        .await;
    }

    // Email verification (only when SMTP configured)
    let email_svc = EmailService::from_env();
    if let Some(svc) = email_svc {
        let verification_token = hex::encode(rand::random::<[u8; 32]>());
        sqlx::query(
            "UPDATE users SET email_verified = false, email_verification_token = $1 WHERE id = $2"
        )
        .bind(&verification_token)
        .bind(user_id)
        .execute(&state.db)
        .await?;

        let frontend_url = std::env::var("FRONTEND_URL")
            .unwrap_or_else(|_| "http://localhost:5173".into());
        let verify_url = format!("{}/auth/verify-email/{}", frontend_url, verification_token);

        let username_c = username.clone();
        let email_c    = email.clone();
        tokio::spawn(async move {
            if let Err(e) = svc.send_verification_email(&email_c, &username_c, &verify_url).await {
                tracing::warn!("Failed to send verification email: {}", e);
            }
        });

        return Ok((
            axum::http::StatusCode::CREATED,
            Json(serde_json::json!({ "pending_verification": true })),
        ));
    }

    // No SMTP — issue token directly
    let token = sign_token(&user_id, &username, &state.jwt_secret)?;
    let _: () = redis.set_ex(format!("session:{}", token), user_id.to_string(), SESSION_TTL).await?;
    track_session(&mut redis, &user_id, &token).await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({
            "token": token,
            "user": { "id": user_id, "username": username, "email": email }
        })),
    ))
}

// ── POST /api/v1/auth/login ───────────────────────────────────────────────────

async fn login_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Result<axum::response::Response, ApiError> {
    let email    = body.email.trim().to_lowercase();
    let password = body.password.clone();
    let client_ip = extract_ip(&headers, &ConnectInfo(addr));
    let mut redis = state.redis.clone();

    // Rate limit: 10 attempts / 15 min / IP
    check_rate_limit(&mut redis, &format!("login_rate:{}", client_ip), 10, 15 * 60).await?;

    // Parallel: fetch user + check IP ban
    let (user_res, ip_ban_res) = tokio::join!(
        sqlx::query_as::<_, UserRow>(
            "SELECT id, username, email, password, email_verified FROM users WHERE email = $1 LIMIT 1"
        ).bind(&email).fetch_optional(&state.db),
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM ip_bans WHERE ip = $1::inet)"
        ).bind(&client_ip).fetch_one(&state.db)
    );

    if ip_ban_res? { return Err(ApiError::Forbidden); }

    let user = user_res?;

    // Always run bcrypt — prevent timing-based email enumeration
    let hash_to_check = user
        .as_ref()
        .map(|u| u.password.clone())
        .unwrap_or_else(|| state.dummy_bcrypt_hash.clone());

    let pw = password.clone();
    let valid = tokio::task::spawn_blocking(move || {
        bcrypt::verify(&pw, &hash_to_check).unwrap_or(false)
    })
    .await
    .unwrap_or(false);

    let user = match (user, valid) {
        (Some(u), true) => u,
        _ => {
            return Err(ApiError::Unauthorized);
        }
    };

    // Block if email not verified — specific code for frontend
    if user.email_verified == Some(false) {
        return Ok((
            axum::http::StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Veuillez confirmer votre adresse email avant de vous connecter.",
                "code":  "EMAIL_NOT_VERIFIED"
            })),
        ).into_response());
    }

    // Ban check — Redis first, then DB fallback
    let redis_banned: bool = redis
        .exists(format!("banned:{}", user.id))
        .await
        .unwrap_or(false);
    if redis_banned { return Err(ApiError::Forbidden); }

    if let Some(community_id) = get_community_id(&state.db).await {
        let db_banned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2)"
        )
        .bind(community_id)
        .bind(user.id)
        .fetch_one(&state.db)
        .await?;

        if db_banned {
            // Cache in Redis
            let _: () = redis.set(format!("banned:{}", user.id), "1").await?;
            return Err(ApiError::Forbidden);
        }

        // Ensure user is in community_members (re-join after unban)
        let _ = sqlx::query(
            "INSERT INTO community_members (community_id, user_id, role) \
             VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING"
        )
        .bind(community_id)
        .bind(user.id)
        .execute(&state.db)
        .await;
    }

    let token = sign_token(&user.id, &user.username, &state.jwt_secret)?;
    let _: () = redis.set_ex(format!("session:{}", token), user.id.to_string(), SESSION_TTL).await?;
    track_session(&mut redis, &user.id, &token).await?;

    Ok(Json(serde_json::json!({
        "token": token,
        "user": { "id": user.id, "username": user.username, "email": user.email }
    })).into_response())
}

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────

async fn logout_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let mut redis = state.redis.clone();
    let _: i64 = redis.del(format!("session:{}", auth.token)).await?;
    Ok(Json(serde_json::json!({ "message": "Logged out" })))
}

// ── POST /api/v1/auth/forgot-password ────────────────────────────────────────

async fn forgot_password_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<EmailBody>,
) -> Result<impl IntoResponse, ApiError> {
    let email = body.email.trim().to_lowercase();
    let client_ip = extract_ip(&headers, &ConnectInfo(addr));
    let mut redis = state.redis.clone();

    // Rate limit: 3 req / 15 min / IP
    check_rate_limit(&mut redis, &format!("reset_rate:{}", client_ip), 3, 15 * 60).await?;

    let user: Option<UserRow> = sqlx::query_as(
        "SELECT id, username, email, password, email_verified FROM users WHERE email = $1 LIMIT 1"
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?;

    if let Some(ref user) = user {
        // Invalidate any pending unused resets
        sqlx::query("DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL")
            .bind(user.id)
            .execute(&state.db)
            .await?;

        let raw_token  = hex::encode(rand::random::<[u8; 32]>());
        let token_hash = sha256_hex(&raw_token);
        let expires_at = chrono::Utc::now() + chrono::Duration::seconds(RESET_TTL_SEC as i64);
        let user_agent = headers
            .get("user-agent")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        sqlx::query(
            "INSERT INTO password_resets (user_id, token_hash, expires_at, ip_address, user_agent) \
             VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(user.id)
        .bind(&token_hash)
        .bind(expires_at)
        .bind(&client_ip)
        .bind(&user_agent)
        .execute(&state.db)
        .await?;

        let frontend_url = std::env::var("FRONTEND_URL")
            .unwrap_or_else(|_| "http://localhost:5173".into());
        let reset_url = format!("{}/reset-password/{}", frontend_url, raw_token);

        if let Some(svc) = EmailService::from_env() {
            let username_c = user.username.clone();
            let email_c    = user.email.clone();
            let svc_c      = svc.clone();
            tokio::spawn(async move {
                if let Err(e) = svc_c.send_password_reset_email(&email_c, &username_c, &reset_url).await {
                    tracing::warn!("Failed to send password reset email: {}", e);
                }
            });
        }
    }

    // Anti-enumeration: always same response
    Ok(Json(serde_json::json!({
        "message": "Si cet email est enregistré, vous recevrez un lien de réinitialisation."
    })))
}

// ── GET /api/v1/auth/verify-reset/:token ─────────────────────────────────────

async fn verify_reset_handler(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let token_hash = sha256_hex(&token);

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT u.username \
         FROM password_resets pr \
         JOIN users u ON u.id = pr.user_id \
         WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > NOW()"
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await?;

    match row {
        None => Err(ApiError::NotFound("Lien invalide ou expiré.".into())),
        Some((username,)) => Ok(Json(serde_json::json!({ "username": username }))),
    }
}

// ── POST /api/v1/auth/reset-password/:token ───────────────────────────────────

async fn reset_password_handler(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(body): Json<PasswordBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.password.len() < 8 || body.password.len() > 100 {
        return Err(ApiError::BadRequest("Password must be 8–100 characters".into()));
    }

    let token_hash = sha256_hex(&token);

    // Atomic: mark token used + get user_id
    let row: Option<(Uuid,)> = sqlx::query_as(
        "UPDATE password_resets \
         SET used_at = NOW() \
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() \
         RETURNING user_id"
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await?;

    let (user_id,) = row.ok_or_else(|| ApiError::BadRequest("Lien invalide ou expiré.".into()))?;

    let pw = body.password.clone();
    let hashed = tokio::task::spawn_blocking(move || bcrypt::hash(pw, BCRYPT_ROUNDS))
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    sqlx::query("UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2")
        .bind(&hashed)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    // Invalidate all active sessions
    let mut redis = state.redis.clone();
    invalidate_user_sessions(&mut redis, &user_id).await?;

    Ok(Json(serde_json::json!({
        "message": "Mot de passe réinitialisé. Vous pouvez vous connecter."
    })))
}

// ── GET /api/v1/auth/verify-email/:token ─────────────────────────────────────

async fn verify_email_handler(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    // Atomic update
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE users \
         SET email_verified = true, email_verification_token = NULL \
         WHERE email_verification_token = $1 AND email_verified = false \
         RETURNING id, username"
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?;

    let (user_id, username) = row.ok_or_else(|| {
        ApiError::BadRequest("Lien invalide ou déjà utilisé.".into())
    })?;

    let jwt_token = sign_token(&user_id, &username, &state.jwt_secret)?;
    let mut redis = state.redis.clone();
    let _: () = redis.set_ex(format!("session:{}", jwt_token), user_id.to_string(), SESSION_TTL).await?;
    track_session(&mut redis, &user_id, &jwt_token).await?;

    Ok(Json(serde_json::json!({ "token": jwt_token })))
}

// ── POST /api/v1/auth/resend-verification ────────────────────────────────────

async fn resend_verification_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<EmailBody>,
) -> Result<impl IntoResponse, ApiError> {
    let email = body.email.trim().to_lowercase();
    let client_ip = extract_ip(&headers, &ConnectInfo(addr));
    let mut redis = state.redis.clone();

    // Rate limit: 1 / 5 min / email AND 3 / 5 min / IP
    let rate_key_email = format!("resend_verify:{}", email);
    let rate_key_ip    = format!("resend_verify_ip:{}", client_ip);

    let count_email_res: Result<i64, _> = redis.incr(&rate_key_email, 1i64).await;
    let count_ip_res:    Result<i64, _> = redis.incr(&rate_key_ip,    1i64).await;
    let (count_email_res, count_ip_res) = (count_email_res, count_ip_res);
    let count_email: i64 = count_email_res?;
    let count_ip:    i64 = count_ip_res?;

    if count_email == 1 { let _: bool = redis.expire(&rate_key_email, 5 * 60i64).await?; }
    if count_ip    == 1 { let _: bool = redis.expire(&rate_key_ip,    5 * 60i64).await?; }

    if count_email > 1 || count_ip > 3 {
        return Err(ApiError::TooManyRequests(5 * 60));
    }

    let user: Option<UserRow> = sqlx::query_as(
        "SELECT id, username, email, password, email_verified FROM users WHERE email = $1 LIMIT 1"
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?;

    // Anti-enumeration: same response whether user exists or not
    let should_send = user
        .as_ref()
        .map(|u| u.email_verified != Some(true))
        .unwrap_or(false);

    if should_send {
        let user = user.unwrap();
        let verification_token = hex::encode(rand::random::<[u8; 32]>());
        sqlx::query("UPDATE users SET email_verification_token = $1 WHERE id = $2")
            .bind(&verification_token)
            .bind(user.id)
            .execute(&state.db)
            .await?;

        if let Some(svc) = EmailService::from_env() {
            let frontend_url = std::env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into());
            let verify_url = format!("{}/auth/verify-email/{}", frontend_url, verification_token);
            let email_c    = user.email.clone();
            let username_c = user.username.clone();
            tokio::spawn(async move {
                if let Err(e) = svc.send_verification_email(&email_c, &username_c, &verify_url).await {
                    tracing::warn!("Failed to send verification email: {}", e);
                }
            });
        }
    }

    Ok(Json(serde_json::json!({
        "message": "Si ce compte existe et n'est pas vérifié, un email a été envoyé."
    })))
}
