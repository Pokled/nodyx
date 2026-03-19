/// Admin routes — port of nodyx-core/src/routes/admin.ts
/// Toutes les routes nécessitent le rôle owner ou admin.
///
/// GET    /api/v1/admin/stats
/// GET    /api/v1/admin/members
/// PATCH  /api/v1/admin/members/:id
/// POST   /api/v1/admin/members/:id/reset-link
/// DELETE /api/v1/admin/members/:id                  (kick)
/// GET    /api/v1/admin/bans
/// POST   /api/v1/admin/members/:id/ban
/// DELETE /api/v1/admin/members/:id/ban
/// GET    /api/v1/admin/ip-bans
/// POST   /api/v1/admin/ip-bans
/// DELETE /api/v1/admin/ip-bans/:ip
/// GET    /api/v1/admin/email-bans
/// POST   /api/v1/admin/email-bans
/// DELETE /api/v1/admin/email-bans/:email
/// GET    /api/v1/admin/threads
/// PATCH  /api/v1/admin/threads/:id
/// DELETE /api/v1/admin/threads/:id
/// PATCH  /api/v1/admin/categories/:id
/// DELETE /api/v1/admin/categories/:id
/// GET    /api/v1/admin/channels
/// POST   /api/v1/admin/channels
/// PUT    /api/v1/admin/channels/reorder
/// DELETE /api/v1/admin/channels/:id
/// PATCH  /api/v1/admin/branding
/// GET    /api/v1/admin/update-check
/// GET    /api/v1/admin/smtp/status
/// POST   /api/v1/admin/smtp/test
/// GET    /api/v1/admin/announcements
/// POST   /api/v1/admin/announcements
/// PATCH  /api/v1/admin/announcements/:id
/// DELETE /api/v1/admin/announcements/:id
/// GET    /api/v1/admin/audit-log
///
/// Omis (reste Node): POST /branding/upload (multipart + sharp)
/// Socket.IO kick lors du ban : omis (Redis banned flag + session invalidation suffisent)

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::error::ApiError;
use crate::extractors::AuthUser;
use crate::services::email::EmailService;
use crate::state::AppState;

// ── Community ID cache ────────────────────────────────────────────────────────

static COMMUNITY_ID_ADMIN: OnceCell<Option<Uuid>> = OnceCell::const_new();

async fn get_community_id(db: &sqlx::PgPool) -> Option<Uuid> {
    COMMUNITY_ID_ADMIN
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

// ── Admin auth check ──────────────────────────────────────────────────────────

/// Vérifie que l'utilisateur est owner ou admin dans la communauté.
/// Retourne le community_id si ok, Forbidden sinon.
async fn require_admin(db: &sqlx::PgPool, user_id: Uuid) -> Result<Uuid, ApiError> {
    let community_id = get_community_id(db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1"
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    match role.as_deref() {
        Some("owner") | Some("admin") => Ok(community_id),
        _ => Err(ApiError::Forbidden),
    }
}

// ── Audit log ─────────────────────────────────────────────────────────────────

async fn log_action(
    db: &sqlx::PgPool,
    actor_id: Uuid,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    target_label: Option<&str>,
    metadata: serde_json::Value,
) {
    let actor_username: Option<String> = sqlx::query_scalar(
        "SELECT username FROM users WHERE id = $1"
    )
    .bind(actor_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let _ = sqlx::query(
        "INSERT INTO admin_audit_log (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(actor_id)
    .bind(actor_username.as_deref().unwrap_or("unknown"))
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(target_label)
    .bind(&metadata)
    .execute(db)
    .await;
}

/// Invalide toutes les sessions Redis d'un utilisateur.
async fn invalidate_user_sessions(redis: &redis::aio::ConnectionManager, user_id: Uuid) {
    let mut r = redis.clone();
    let index_key = format!("user_sessions:{}", user_id);
    let tokens: Vec<String> = r.smembers(&index_key).await.unwrap_or_default();
    for token in &tokens {
        let _: i64 = r.del(format!("session:{}", token)).await.unwrap_or(0);
    }
    let _: i64 = r.del(&index_key).await.unwrap_or(0);
}

/// Génère un slug depuis un nom de catégorie (ASCII-safe).
fn generate_category_slug(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ThreadsQuery {
    limit:       Option<i64>,
    offset:      Option<i64>,
    category_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct AuditQuery {
    limit:  Option<i64>,
    offset: Option<i64>,
    action: Option<String>,
    actor:  Option<String>,
}

#[derive(Deserialize)]
struct PatchMemberBody { role: Option<String> }

#[derive(Deserialize)]
struct PatchThreadBody {
    is_pinned:   Option<bool>,
    is_locked:   Option<bool>,
    category_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct PatchCategoryBody {
    name:        Option<String>,
    description: Option<String>,
    position:    Option<i32>,
    parent_id:   Option<Value>,  // null ou UUID string
}

#[derive(Deserialize)]
struct CreateChannelBody {
    name:        String,
    description: Option<String>,
    #[serde(rename = "type", default = "default_text")]
    channel_type: String,
}
fn default_text() -> String { "text".into() }

#[derive(Deserialize)]
struct ReorderBody { ids: Vec<Uuid> }

#[derive(Deserialize)]
struct BrandingBody {
    logo_url:   Option<Value>,
    banner_url: Option<Value>,
}

#[derive(Deserialize)]
struct BanBody {
    reason:    Option<String>,
    #[serde(default)]
    ban_ip:    bool,
    #[serde(default)]
    ban_email: bool,
}

#[derive(Deserialize)]
struct IpBanBody { ip: String, reason: Option<String> }

#[derive(Deserialize)]
struct EmailBanBody { email: String, reason: Option<String> }

#[derive(Deserialize)]
struct AnnouncementBody {
    message:    String,
    color:      Option<String>,
    expires_at: Option<String>,
}

#[derive(Deserialize)]
struct PatchAnnouncementBody {
    is_active: Option<bool>,
    message:   Option<String>,
    color:     Option<String>,
}

#[derive(Deserialize)]
struct ResetLinkBody {}

#[derive(Deserialize)]
struct SmtpTestBody { to: String }

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/stats",                        get(stats_handler))
        .route("/admin/members",                      get(members_handler))
        .route("/admin/members/:id",                  patch(patch_member_handler).delete(kick_member_handler))
        .route("/admin/members/:id/reset-link",       post(reset_link_handler))
        .route("/admin/members/:id/ban",              post(ban_handler).delete(unban_handler))
        .route("/admin/bans",                         get(bans_handler))
        .route("/admin/ip-bans",                      get(ip_bans_handler).post(add_ip_ban_handler))
        .route("/admin/ip-bans/:ip",                  delete(remove_ip_ban_handler))
        .route("/admin/email-bans",                   get(email_bans_handler).post(add_email_ban_handler))
        .route("/admin/email-bans/:email",            delete(remove_email_ban_handler))
        .route("/admin/threads",                      get(threads_handler))
        .route("/admin/threads/:id",                  patch(patch_thread_handler).delete(delete_thread_handler))
        .route("/admin/categories/:id",               patch(patch_category_handler).delete(delete_category_handler))
        .route("/admin/channels",                     get(channels_handler).post(create_channel_handler))
        .route("/admin/channels/reorder",             put(reorder_channels_handler))
        .route("/admin/channels/:id",                 delete(delete_channel_handler))
        .route("/admin/branding",                     patch(branding_handler))
        .route("/admin/update-check",                 get(update_check_handler))
        .route("/admin/smtp/status",                  get(smtp_status_handler))
        .route("/admin/smtp/test",                    post(smtp_test_handler))
        .route("/admin/announcements",                get(announcements_handler).post(create_announcement_handler))
        .route("/admin/announcements/:id",            patch(patch_announcement_handler).delete(delete_announcement_handler))
        .route("/admin/audit-log",                    get(audit_log_handler))
}

// ── GET /admin/stats ──────────────────────────────────────────────────────────

async fn stats_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let (users, threads, posts, cats, events, polls, assets, chat, dms) = tokio::join!(
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
              FROM users) t"
        ).fetch_one(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.created_at > NOW() - INTERVAL '7 days')::int AS new_this_week,
              COUNT(*) FILTER (WHERE t.is_locked = true)::int AS locked,
              COUNT(*) FILTER (WHERE t.is_pinned = true)::int AS pinned
              FROM threads t JOIN categories c ON c.id = t.category_id WHERE c.community_id = $1) t"
        ).bind(community_id).fetch_one(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE p.created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
              FROM posts p JOIN threads t ON t.id = p.thread_id
              JOIN categories c ON c.id = t.category_id WHERE c.community_id = $1) t"
        ).bind(community_id).fetch_one(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total FROM categories WHERE community_id = $1) t"
        ).bind(community_id).fetch_one(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE starts_at >= NOW() AND is_cancelled = false)::int AS upcoming
              FROM events) t"
        ).fetch_optional(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE closed_at IS NULL)::int AS open FROM polls) t"
        ).fetch_optional(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total FROM community_assets
              WHERE is_public = true AND is_banned = false) t"
        ).fetch_optional(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE cm.created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
              FROM channel_messages cm JOIN channels ch ON ch.id = cm.channel_id WHERE ch.community_id = $1) t"
        ).bind(community_id).fetch_optional(&state.db),
        sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (SELECT COUNT(*)::int AS total FROM dm_conversations) t"
        ).fetch_optional(&state.db),
    );

    // Online count via Redis heartbeat keys
    let mut redis = state.redis.clone();
    let heartbeat_keys: Vec<String> = redis.keys("heartbeat:*").await.unwrap_or_default();
    let online_count = heartbeat_keys.len();

    // Activity last 7 days (posts + new members merged by day)
    let posts_rows: Vec<(chrono::NaiveDate, i32)> = sqlx::query_as(
        "SELECT DATE(p.created_at) AS day, COUNT(*)::int AS posts
         FROM posts p JOIN threads t ON t.id = p.thread_id
         JOIN categories c ON c.id = t.category_id
         WHERE c.community_id = $1 AND p.created_at > NOW() - INTERVAL '7 days'
         GROUP BY day ORDER BY day ASC"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let member_rows: Vec<(chrono::NaiveDate, i32)> = sqlx::query_as(
        "SELECT DATE(joined_at) AS day, COUNT(*)::int AS new_members
         FROM community_members
         WHERE community_id = $1 AND joined_at > NOW() - INTERVAL '7 days'
         GROUP BY day ORDER BY day ASC"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    use std::collections::HashMap;
    let mut members_by_day: HashMap<chrono::NaiveDate, i32> = HashMap::new();
    for (day, count) in member_rows { members_by_day.insert(day, count); }

    let activity: Vec<Value> = posts_rows.into_iter().map(|(day, posts)| {
        let new_members = members_by_day.get(&day).copied().unwrap_or(0);
        serde_json::json!({ "day": day.to_string(), "posts": posts, "new_members": new_members })
    }).collect();

    let top_contributors: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT u.username, u.avatar, COUNT(p.id)::int AS post_count
           FROM posts p JOIN users u ON u.id = p.author_id
           JOIN threads t ON t.id = p.thread_id
           JOIN categories c ON c.id = t.category_id
           WHERE c.community_id = $1 AND p.created_at > NOW() - INTERVAL '30 days'
           GROUP BY u.id, u.username, u.avatar
           ORDER BY post_count DESC LIMIT 5
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();

    let recent_members: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT u.username, u.avatar, u.email, cm.joined_at, cm.role
           FROM community_members cm JOIN users u ON u.id = cm.user_id
           WHERE cm.community_id = $1
           ORDER BY cm.joined_at DESC LIMIT 5
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();

    Ok(Json(serde_json::json!({
        "users":    users.unwrap_or(Value::Null),
        "threads":  threads.unwrap_or(Value::Null),
        "posts":    posts.unwrap_or(Value::Null),
        "categories": cats.unwrap_or(Value::Null),
        "online":   online_count,
        "events":   events.ok().flatten().unwrap_or(Value::Null),
        "polls":    polls.ok().flatten().unwrap_or(Value::Null),
        "assets":   assets.ok().flatten().unwrap_or(Value::Null),
        "chat":     chat.ok().flatten().unwrap_or(Value::Null),
        "dms":      dms.ok().flatten().unwrap_or(Value::Null),
        "activity_last_7_days": activity,
        "top_contributors":     top_contributors,
        "recent_members":       recent_members,
    })))
}

// ── GET /admin/members ────────────────────────────────────────────────────────

async fn members_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let members: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT cm.user_id, cm.role, cm.joined_at,
                  u.username, u.email, u.avatar, u.created_at AS registered_at,
                  cg.id AS grade_id, cg.name AS grade_name, cg.color AS grade_color,
                  (SELECT COUNT(*)::int FROM threads t
                   JOIN categories c ON c.id = t.category_id
                   WHERE t.author_id = u.id AND c.community_id = $1) AS thread_count,
                  (SELECT COUNT(*)::int FROM posts p
                   JOIN threads t ON t.id = p.thread_id
                   JOIN categories c ON c.id = t.category_id
                   WHERE p.author_id = u.id AND c.community_id = $1) AS post_count
           FROM community_members cm
           JOIN users u ON u.id = cm.user_id
           LEFT JOIN community_grades cg ON cg.id = cm.grade_id
           WHERE cm.community_id = $1
             AND NOT EXISTS (
               SELECT 1 FROM community_bans cb
               WHERE cb.community_id = $1 AND cb.user_id = cm.user_id
             )
           ORDER BY
             CASE cm.role
               WHEN 'owner'     THEN 1
               WHEN 'admin'     THEN 2
               WHEN 'moderator' THEN 3
               ELSE 4
             END,
             cm.joined_at ASC
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(serde_json::json!({ "members": members })))
}

// ── PATCH /admin/members/:id ──────────────────────────────────────────────────

async fn patch_member_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<PatchMemberBody>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let (role, username): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT cm.role, u.username FROM community_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.community_id = $1 AND cm.user_id = $2"
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or((None, None));

    if role.is_none() {
        return Err(ApiError::NotFound("Member not found".into()));
    }
    if role.as_deref() == Some("owner") {
        return Err(ApiError::Forbidden);
    }

    if let Some(ref new_role) = body.role {
        if !["admin", "moderator", "member"].contains(&new_role.as_str()) {
            return Err(ApiError::BadRequest("Invalid role".into()));
        }
        sqlx::query(
            "UPDATE community_members SET role = $1 WHERE community_id = $2 AND user_id = $3"
        )
        .bind(new_role)
        .bind(community_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

        let db = state.db.clone();
        let actor_id = auth.user_id;
        let target = username.clone().unwrap_or_default();
        let old = role.clone().unwrap_or_default();
        let new = new_role.clone();
        let uid_str = user_id.to_string();
        tokio::spawn(async move {
            log_action(&db, actor_id, "change_role", Some("user"), Some(&uid_str),
                Some(&target), serde_json::json!({ "old_role": old, "new_role": new })).await;
        });
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /admin/members/:id/reset-link ───────────────────────────────────────

async fn reset_link_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let user: Option<(String, String)> = sqlx::query_as(
        "SELECT username, email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    let (username, email) = user.ok_or_else(|| ApiError::NotFound("User not found".into()))?;

    // Invalider les tokens existants
    sqlx::query("DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL")
        .bind(user_id)
        .execute(&state.db)
        .await?;

    let raw_token = hex::encode(rand::random::<[u8; 32]>());
    let token_hash = {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(raw_token.as_bytes()))
    };
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);

    sqlx::query(
        "INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)"
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at.naive_utc())
    .execute(&state.db)
    .await?;

    let frontend_url = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".into());
    let reset_url = format!("{}/reset-password/{}", frontend_url, raw_token);

    let mut email_sent = false;
    if let Some(svc) = EmailService::from_env() {
        if svc.send_password_reset_email(&email, &username, &reset_url).await.is_ok() {
            email_sent = true;
        }
    }

    Ok(Json(serde_json::json!({
        "username":   username,
        "email":      email,
        "reset_url":  reset_url,
        "expires_at": expires_at.to_rfc3339(),
        "email_sent": email_sent,
    })))
}

// ── DELETE /admin/members/:id (kick) ─────────────────────────────────────────

async fn kick_member_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let (role, username): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT cm.role, u.username FROM community_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.community_id = $1 AND cm.user_id = $2"
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or((None, None));

    if role.is_none() {
        return Err(ApiError::NotFound("Member not found".into()));
    }
    if role.as_deref() == Some("owner") {
        return Err(ApiError::Forbidden);
    }

    sqlx::query(
        "DELETE FROM community_members WHERE community_id = $1 AND user_id = $2"
    )
    .bind(community_id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let target = username.unwrap_or_default();
    let uid_str = user_id.to_string();
    tokio::spawn(async move {
        log_action(&db, actor_id, "kick_member", Some("user"), Some(&uid_str),
            Some(&target), serde_json::json!({})).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /admin/bans ───────────────────────────────────────────────────────────

async fn bans_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let bans: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT cb.user_id, cb.banned_at, cb.reason,
                  u.username, u.email, u.avatar,
                  bu.username AS banned_by_username
           FROM community_bans cb
           JOIN users u ON u.id = cb.user_id
           LEFT JOIN users bu ON bu.id = cb.banned_by
           WHERE cb.community_id = $1
           ORDER BY cb.banned_at DESC
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(Value::Array(bans)))
}

// ── POST /admin/members/:id/ban ───────────────────────────────────────────────

async fn ban_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<BanBody>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    #[derive(sqlx::FromRow)]
    struct UserInfo { username: String, email: String, registration_ip: Option<String>, role: Option<String> }

    let info: Option<UserInfo> = sqlx::query_as(
        "SELECT u.username, u.email, u.registration_ip, cm.role
         FROM users u
         LEFT JOIN community_members cm ON cm.community_id = $1 AND cm.user_id = u.id
         WHERE u.id = $2"
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    let info = info.ok_or_else(|| ApiError::NotFound("User not found".into()))?;
    if info.role.as_deref() == Some("owner") {
        return Err(ApiError::Forbidden);
    }

    // Community ban (upsert)
    sqlx::query(
        "INSERT INTO community_bans (community_id, user_id, banned_by, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (community_id, user_id) DO UPDATE
           SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = NOW()"
    )
    .bind(community_id)
    .bind(user_id)
    .bind(auth.user_id)
    .bind(body.reason.as_deref())
    .execute(&state.db)
    .await?;

    // Remove from members
    sqlx::query("DELETE FROM community_members WHERE community_id = $1 AND user_id = $2")
        .bind(community_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    // IP ban
    const PROTECTED_IPS: &[&str] = &["127.0.0.1", "::1", "0.0.0.0", "localhost"];
    if body.ban_ip {
        if let Some(ref ip) = info.registration_ip {
            if !PROTECTED_IPS.contains(&ip.as_str()) {
                let _ = sqlx::query(
                    "INSERT INTO ip_bans (ip, reason, banned_by)
                     VALUES ($1::inet, $2, $3)
                     ON CONFLICT (ip) DO UPDATE
                       SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = NOW()"
                )
                .bind(ip)
                .bind(body.reason.as_deref())
                .bind(auth.user_id)
                .execute(&state.db)
                .await;
            }
        }
    }

    // Email ban
    if body.ban_email {
        let _ = sqlx::query(
            "INSERT INTO email_bans (email, reason, banned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (email) DO UPDATE
               SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = NOW()"
        )
        .bind(&info.email)
        .bind(body.reason.as_deref())
        .bind(auth.user_id)
        .execute(&state.db)
        .await;
    }

    // Redis: ban flag + invalidate sessions
    let mut redis = state.redis.clone();
    let _: () = redis.set(format!("banned:{}", user_id), "1").await.unwrap_or(());
    invalidate_user_sessions(&state.redis, user_id).await;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let uid_str = user_id.to_string();
    let username = info.username.clone();
    let reason = body.reason.clone();
    let ban_ip = body.ban_ip;
    let ban_email = body.ban_email;
    let reg_ip = info.registration_ip.clone();
    tokio::spawn(async move {
        log_action(&db, actor_id, "ban_user", Some("user"), Some(&uid_str),
            Some(&username), serde_json::json!({
                "reason": reason, "ban_ip": ban_ip, "ban_email": ban_email
            })).await;
    });

    Ok(Json(serde_json::json!({ "ok": true, "registration_ip": reg_ip })))
}

// ── DELETE /admin/members/:id/ban (unban) ────────────────────────────────────

async fn unban_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let username: Option<String> = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;

    sqlx::query("DELETE FROM community_bans WHERE community_id = $1 AND user_id = $2")
        .bind(community_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    let mut redis = state.redis.clone();
    let _: i64 = redis.del(format!("banned:{}", user_id)).await.unwrap_or(0);

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let uid_str = user_id.to_string();
    let uname = username.clone().unwrap_or_default();
    tokio::spawn(async move {
        log_action(&db, actor_id, "unban_user", Some("user"), Some(&uid_str),
            Some(&uname), serde_json::json!({})).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /admin/ip-bans ────────────────────────────────────────────────────────

async fn ip_bans_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let bans: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT ib.ip::text, ib.reason, ib.banned_at, u.username AS banned_by_username
           FROM ip_bans ib
           LEFT JOIN users u ON u.id = ib.banned_by
           ORDER BY ib.banned_at DESC
         ) t"
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(Value::Array(bans)))
}

// ── POST /admin/ip-bans ───────────────────────────────────────────────────────

async fn add_ip_ban_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<IpBanBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    const PROTECTED_IPS: &[&str] = &["127.0.0.1", "::1", "0.0.0.0", "localhost"];
    if PROTECTED_IPS.contains(&body.ip.as_str()) {
        return Err(ApiError::BadRequest("Cette IP ne peut pas être bannie.".into()));
    }

    sqlx::query(
        "INSERT INTO ip_bans (ip, reason, banned_by)
         VALUES ($1::inet, $2, $3)
         ON CONFLICT (ip) DO UPDATE
           SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = NOW()"
    )
    .bind(&body.ip)
    .bind(body.reason.as_deref())
    .bind(auth.user_id)
    .execute(&state.db)
    .await?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let ip = body.ip.clone();
    let reason = body.reason.clone();
    tokio::spawn(async move {
        log_action(&db, actor_id, "ip_ban_add", Some("ip"), Some(&ip),
            Some(&ip), serde_json::json!({ "reason": reason })).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── DELETE /admin/ip-bans/:ip ─────────────────────────────────────────────────

async fn remove_ip_ban_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(ip): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    sqlx::query("DELETE FROM ip_bans WHERE ip = $1::inet")
        .bind(&ip)
        .execute(&state.db)
        .await?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let ip2 = ip.clone();
    tokio::spawn(async move {
        log_action(&db, actor_id, "ip_ban_remove", Some("ip"), Some(&ip2),
            Some(&ip2), serde_json::json!({})).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /admin/email-bans ─────────────────────────────────────────────────────

async fn email_bans_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let bans: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT eb.email, eb.reason, eb.banned_at, u.username AS banned_by_username
           FROM email_bans eb
           LEFT JOIN users u ON u.id = eb.banned_by
           ORDER BY eb.banned_at DESC
         ) t"
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(Value::Array(bans)))
}

// ── POST /admin/email-bans ────────────────────────────────────────────────────

async fn add_email_ban_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<EmailBanBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    if body.email.is_empty() {
        return Err(ApiError::BadRequest("email required".into()));
    }

    sqlx::query(
        "INSERT INTO email_bans (email, reason, banned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = NOW()"
    )
    .bind(&body.email)
    .bind(body.reason.as_deref())
    .bind(auth.user_id)
    .execute(&state.db)
    .await?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let email = body.email.clone();
    let reason = body.reason.clone();
    tokio::spawn(async move {
        log_action(&db, actor_id, "email_ban_add", Some("email"), Some(&email),
            Some(&email), serde_json::json!({ "reason": reason })).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── DELETE /admin/email-bans/:email ──────────────────────────────────────────

async fn remove_email_ban_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(email): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let decoded = urlencoding::decode(&email).unwrap_or(std::borrow::Cow::Borrowed(&email)).into_owned();

    sqlx::query("DELETE FROM email_bans WHERE email = $1")
        .bind(&decoded)
        .execute(&state.db)
        .await?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let em = decoded.clone();
    tokio::spawn(async move {
        log_action(&db, actor_id, "email_ban_remove", Some("email"), Some(&em),
            Some(&em), serde_json::json!({})).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /admin/threads ────────────────────────────────────────────────────────

async fn threads_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<ThreadsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;
    let limit  = params.limit.unwrap_or(50).clamp(1, 100);
    let offset = params.offset.unwrap_or(0).max(0);

    let (threads, total) = if let Some(cat_id) = params.category_id {
        tokio::join!(
            sqlx::query_scalar::<_, Value>(
                "SELECT row_to_json(t) FROM (
                   SELECT t.id, t.title, t.is_pinned, t.is_locked, t.views, t.created_at,
                          t.category_id, c.name AS category_name,
                          u.username AS author_username, u.avatar AS author_avatar,
                          COUNT(p.id)::int AS post_count
                   FROM threads t
                   JOIN categories c ON c.id = t.category_id
                   JOIN users u ON u.id = t.author_id
                   LEFT JOIN posts p ON p.thread_id = t.id
                   WHERE c.community_id = $1 AND t.category_id = $2
                   GROUP BY t.id, c.name, u.username, u.avatar
                   ORDER BY t.is_pinned DESC, t.created_at DESC
                   LIMIT $3 OFFSET $4
                 ) t"
            ).bind(community_id).bind(cat_id).bind(limit).bind(offset).fetch_all(&state.db),
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)::bigint FROM threads t
                 JOIN categories c ON c.id = t.category_id
                 WHERE c.community_id = $1 AND t.category_id = $2"
            ).bind(community_id).bind(cat_id).fetch_one(&state.db),
        )
    } else {
        tokio::join!(
            sqlx::query_scalar::<_, Value>(
                "SELECT row_to_json(t) FROM (
                   SELECT t.id, t.title, t.is_pinned, t.is_locked, t.views, t.created_at,
                          t.category_id, c.name AS category_name,
                          u.username AS author_username, u.avatar AS author_avatar,
                          COUNT(p.id)::int AS post_count
                   FROM threads t
                   JOIN categories c ON c.id = t.category_id
                   JOIN users u ON u.id = t.author_id
                   LEFT JOIN posts p ON p.thread_id = t.id
                   WHERE c.community_id = $1
                   GROUP BY t.id, c.name, u.username, u.avatar
                   ORDER BY t.is_pinned DESC, t.created_at DESC
                   LIMIT $2 OFFSET $3
                 ) t"
            ).bind(community_id).bind(limit).bind(offset).fetch_all(&state.db),
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)::bigint FROM threads t
                 JOIN categories c ON c.id = t.category_id WHERE c.community_id = $1"
            ).bind(community_id).fetch_one(&state.db),
        )
    };

    let threads: Vec<Value> = threads?.into_iter().collect();
    let total = total.unwrap_or(0);

    Ok(Json(serde_json::json!({ "threads": threads, "total": total })))
}

// ── PATCH /admin/threads/:id ──────────────────────────────────────────────────

async fn patch_thread_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchThreadBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new("UPDATE threads SET updated_at = NOW()");
    if let Some(v) = body.is_pinned   { qb.push(", is_pinned = ").push_bind(v); }
    if let Some(v) = body.is_locked   { qb.push(", is_locked = ").push_bind(v); }
    if let Some(v) = body.category_id { qb.push(", category_id = ").push_bind(v); }
    qb.push(" WHERE id = ").push_bind(id).push(" RETURNING row_to_json(threads.*)");

    let thread: Option<Value> = qb.build_query_scalar().fetch_optional(&state.db).await?;
    let thread = thread.ok_or_else(|| ApiError::NotFound("Thread not found".into()))?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let tid = id.to_string();
    let title = thread["title"].as_str().unwrap_or("").to_string();
    let is_pinned = body.is_pinned;
    let is_locked = body.is_locked;
    tokio::spawn(async move {
        if let Some(p) = is_pinned {
            log_action(&db, actor_id, if p { "pin_thread" } else { "unpin_thread" },
                Some("thread"), Some(&tid), Some(&title), serde_json::json!({})).await;
        }
        if let Some(l) = is_locked {
            log_action(&db, actor_id, if l { "lock_thread" } else { "unlock_thread" },
                Some("thread"), Some(&tid), Some(&title), serde_json::json!({})).await;
        }
    });

    Ok(Json(serde_json::json!({ "thread": thread })))
}

// ── DELETE /admin/threads/:id ─────────────────────────────────────────────────

async fn delete_thread_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let title: Option<String> = sqlx::query_scalar("SELECT title FROM threads WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;

    let deleted = sqlx::query("DELETE FROM threads WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if deleted == 0 {
        return Err(ApiError::NotFound("Thread not found".into()));
    }

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let tid = id.to_string();
    let t = title.clone().unwrap_or_default();
    tokio::spawn(async move {
        log_action(&db, actor_id, "delete_thread", Some("thread"), Some(&tid),
            Some(&t), serde_json::json!({})).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── PATCH /admin/categories/:id ───────────────────────────────────────────────

async fn patch_category_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchCategoryBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new("UPDATE categories SET updated_at = NOW()");
    if let Some(ref name) = body.name {
        let n = name.trim().to_string();
        qb.push(", name = ").push_bind(n.clone());
        qb.push(", slug = ").push_bind(generate_category_slug(&n));
    }
    if let Some(ref desc) = body.description {
        qb.push(", description = ").push_bind(desc.trim().to_string());
    }
    if let Some(pos) = body.position {
        qb.push(", position = ").push_bind(pos);
    }
    if let Some(ref parent) = body.parent_id {
        if parent.is_null() {
            qb.push(", parent_id = NULL");
        } else if let Some(s) = parent.as_str() {
            if let Ok(uid) = Uuid::parse_str(s) {
                qb.push(", parent_id = ").push_bind(uid);
            }
        }
    }
    qb.push(" WHERE id = ").push_bind(id).push(" RETURNING row_to_json(categories.*)");

    let category: Option<Value> = qb.build_query_scalar().fetch_optional(&state.db).await?;

    match category {
        None => Err(ApiError::NotFound("Category not found".into())),
        Some(v) => Ok(Json(serde_json::json!({ "category": v }))),
    }
}

// ── DELETE /admin/categories/:id ──────────────────────────────────────────────

async fn delete_category_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let thread_count: i64 = sqlx::query_scalar(
        "WITH RECURSIVE sub AS (
           SELECT id FROM categories WHERE id = $1
           UNION ALL
           SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
         )
         SELECT COUNT(*)::bigint FROM threads WHERE category_id IN (SELECT id FROM sub)"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    if thread_count > 0 {
        return Err(ApiError::Conflict(format!(
            "Cette catégorie contient {} fil(s). Supprimez-les d'abord ou déplacez-les.", thread_count
        )));
    }

    let deleted = sqlx::query("DELETE FROM categories WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if deleted == 0 {
        return Err(ApiError::NotFound("Category not found".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /admin/channels ───────────────────────────────────────────────────────

async fn channels_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let channels: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT id, name, slug, description, type, position, created_at
           FROM channels WHERE community_id = $1
           ORDER BY position ASC, created_at ASC
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(serde_json::json!({ "channels": channels })))
}

// ── POST /admin/channels ──────────────────────────────────────────────────────

async fn create_channel_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateChannelBody>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(ApiError::BadRequest("Channel name must be 1–100 characters".into()));
    }

    let slug: String = name.to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM channels WHERE community_id = $1 AND slug = $2)"
    )
    .bind(community_id)
    .bind(&slug)
    .fetch_one(&state.db)
    .await?;

    if exists {
        return Err(ApiError::Conflict("Un canal avec ce nom existe déjà".into()));
    }

    let max_pos: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1)::int FROM channels WHERE community_id = $1"
    )
    .bind(community_id)
    .fetch_one(&state.db)
    .await?;

    let channel: Value = sqlx::query_scalar(
        "INSERT INTO channels (community_id, name, slug, description, type, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING row_to_json(channels.*)"
    )
    .bind(community_id)
    .bind(&name)
    .bind(&slug)
    .bind(body.description.as_deref())
    .bind(&body.channel_type)
    .bind(max_pos + 1)
    .fetch_one(&state.db)
    .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "channel": channel })),
    ))
}

// ── PUT /admin/channels/reorder ───────────────────────────────────────────────

async fn reorder_channels_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ReorderBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    for (i, id) in body.ids.iter().enumerate() {
        sqlx::query("UPDATE channels SET position = $1 WHERE id = $2")
            .bind(i as i32)
            .bind(id)
            .execute(&state.db)
            .await?;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── DELETE /admin/channels/:id ────────────────────────────────────────────────

async fn delete_channel_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let deleted = sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if deleted == 0 {
        return Err(ApiError::NotFound("Channel not found".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── PATCH /admin/branding ─────────────────────────────────────────────────────

async fn branding_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<BrandingBody>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = require_admin(&state.db, auth.user_id).await?;

    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new("UPDATE communities SET ");
    let mut sep = "";

    if let Some(ref logo) = body.logo_url {
        if logo.is_null() {
            qb.push(sep).push("logo_url = NULL");
        } else if let Some(s) = logo.as_str() {
            qb.push(sep).push("logo_url = ").push_bind(s.to_string());
        }
        sep = ", ";
    }
    if let Some(ref banner) = body.banner_url {
        if banner.is_null() {
            qb.push(sep).push("banner_url = NULL");
        } else if let Some(s) = banner.as_str() {
            qb.push(sep).push("banner_url = ").push_bind(s.to_string());
        }
        sep = ", ";
    }

    if sep.is_empty() {
        return Err(ApiError::BadRequest("Nothing to update".into()));
    }

    qb.push(" WHERE id = ").push_bind(community_id)
      .push(" RETURNING logo_url, banner_url");

    let branding: Value = qb.build_query_scalar().fetch_one(&state.db).await?;
    Ok(Json(serde_json::json!({ "branding": branding })))
}

// ── GET /admin/update-check ───────────────────────────────────────────────────

async fn update_check_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let current = std::env::var("NODYX_VERSION").unwrap_or_else(|_| "1.8.0".into());
    let cache_key = "nodyx:update_check";
    let mut redis = state.redis.clone();

    let cached: Option<String> = redis.get(cache_key).await.unwrap_or(None);
    if let Some(json) = cached {
        if let Ok(v) = serde_json::from_str::<Value>(&json) {
            return Ok(Json(v));
        }
    }

    let result = state.http
        .get("https://api.github.com/repos/Pokled/Nodyx/releases/latest")
        .header("User-Agent", "Nodyx-Instance/1.0")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;

    let payload = match result {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(gh) = resp.json::<Value>().await {
                let latest = gh["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
                let parse_ver = |v: &str| -> (u64, u64, u64) {
                    let parts: Vec<u64> = v.split('.').filter_map(|x| x.parse().ok()).collect();
                    (parts.get(0).copied().unwrap_or(0),
                     parts.get(1).copied().unwrap_or(0),
                     parts.get(2).copied().unwrap_or(0))
                };
                let (cmaj, cmin, cpat) = parse_ver(&current);
                let (lmaj, lmin, lpat) = parse_ver(&latest);
                let has_update = lmaj > cmaj || (lmaj == cmaj && lmin > cmin) ||
                    (lmaj == cmaj && lmin == cmin && lpat > cpat);
                serde_json::json!({
                    "current_version": current,
                    "latest_version":  latest,
                    "has_update":      has_update,
                    "release_url":     gh["html_url"],
                })
            } else {
                serde_json::json!({ "current_version": current, "latest_version": null, "has_update": false, "release_url": null })
            }
        }
        _ => serde_json::json!({ "current_version": current, "latest_version": null, "has_update": false, "release_url": null }),
    };

    let _: () = redis.set_ex(cache_key, payload.to_string(), 6 * 3600).await.unwrap_or(());
    Ok(Json(payload))
}

// ── GET /admin/smtp/status ────────────────────────────────────────────────────

async fn smtp_status_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let configured = EmailService::from_env().is_some();
    Ok(Json(serde_json::json!({
        "configured": configured,
        "host": std::env::var("SMTP_HOST").ok(),
        "port": std::env::var("SMTP_PORT").unwrap_or_else(|_| "587".into()).parse::<u16>().unwrap_or(587),
        "from": std::env::var("SMTP_FROM").or_else(|_| std::env::var("SMTP_USER")).ok(),
    })))
}

// ── POST /admin/smtp/test ─────────────────────────────────────────────────────

async fn smtp_test_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SmtpTestBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let svc = EmailService::from_env()
        .ok_or_else(|| ApiError::BadRequest("SMTP non configuré".into()))?;

    let frontend_url = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".into());
    let reset_url = format!("{}/reset-password/test-smtp", frontend_url);

    svc.send_password_reset_email(&body.to, "Admin", &reset_url)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("SMTP send failed: {}", e)))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Email de test envoyé à {}", body.to),
    })))
}

// ── GET /admin/announcements ──────────────────────────────────────────────────

async fn announcements_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let announcements: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT id, message, color, is_active, created_at, expires_at
           FROM system_announcements
           ORDER BY created_at DESC
         ) t"
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(serde_json::json!({ "announcements": announcements })))
}

// ── POST /admin/announcements ─────────────────────────────────────────────────

async fn create_announcement_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<AnnouncementBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let message = body.message.trim().to_string();
    if message.is_empty() {
        return Err(ApiError::BadRequest("message requis".into()));
    }

    const VALID_COLORS: &[&str] = &["indigo", "amber", "green", "red", "sky", "rose"];
    let color = body.color.as_deref()
        .filter(|c| VALID_COLORS.contains(c))
        .unwrap_or("indigo");

    let expires_at: Option<chrono::NaiveDateTime> = body.expires_at.as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.naive_utc());

    let ann: Value = sqlx::query_scalar(
        "INSERT INTO system_announcements (message, color, expires_at)
         VALUES ($1, $2, $3)
         RETURNING row_to_json(system_announcements.*)"
    )
    .bind(&message)
    .bind(color)
    .bind(expires_at)
    .fetch_one(&state.db)
    .await?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let ann_id = ann["id"].as_str().unwrap_or("").to_string();
    let label = message.chars().take(60).collect::<String>();
    let col = color.to_string();
    tokio::spawn(async move {
        log_action(&db, actor_id, "create_announcement", Some("announcement"),
            Some(&ann_id), Some(&label), serde_json::json!({ "color": col })).await;
    });

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "announcement": ann })),
    ))
}

// ── PATCH /admin/announcements/:id ───────────────────────────────────────────

async fn patch_announcement_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchAnnouncementBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new("UPDATE system_announcements SET ");
    let mut sep = "";
    if let Some(v) = body.is_active {
        qb.push(sep).push("is_active = ").push_bind(v);
        sep = ", ";
    }
    if let Some(ref msg) = body.message {
        qb.push(sep).push("message = ").push_bind(msg.trim().to_string());
        sep = ", ";
    }
    if let Some(ref color) = body.color {
        qb.push(sep).push("color = ").push_bind(color.clone());
        sep = ", ";
    }
    if sep.is_empty() {
        return Err(ApiError::BadRequest("rien à mettre à jour".into()));
    }
    qb.push(" WHERE id = ").push_bind(id)
      .push(" RETURNING row_to_json(system_announcements.*)");

    let ann: Option<Value> = qb.build_query_scalar().fetch_optional(&state.db).await?;
    let ann = ann.ok_or_else(|| ApiError::NotFound("Announcement not found".into()))?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let id_str = id.to_string();
    let label = ann["message"].as_str().map(|s| s.chars().take(60).collect::<String>()).unwrap_or_default();
    let is_active = body.is_active;
    let color = body.color.clone();
    tokio::spawn(async move {
        log_action(&db, actor_id, "update_announcement", Some("announcement"),
            Some(&id_str), Some(&label),
            serde_json::json!({ "is_active": is_active, "color": color })).await;
    });

    Ok(Json(serde_json::json!({ "announcement": ann })))
}

// ── DELETE /admin/announcements/:id ──────────────────────────────────────────

async fn delete_announcement_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let message: Option<String> = sqlx::query_scalar(
        "SELECT message FROM system_announcements WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    sqlx::query("DELETE FROM system_announcements WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    let db = state.db.clone();
    let actor_id = auth.user_id;
    let id_str = id.to_string();
    let label = message.as_deref().map(|s| s.chars().take(60).collect::<String>()).unwrap_or_default();
    tokio::spawn(async move {
        log_action(&db, actor_id, "delete_announcement", Some("announcement"),
            Some(&id_str), Some(&label), serde_json::json!({})).await;
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /admin/audit-log ──────────────────────────────────────────────────────

async fn audit_log_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<AuditQuery>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state.db, auth.user_id).await?;

    let limit  = params.limit.unwrap_or(50).clamp(1, 200);
    let offset = params.offset.unwrap_or(0).max(0);

    let (entries, total) = if params.action.is_some() || params.actor.is_some() {
        let action = params.action.as_deref().unwrap_or("");
        let actor  = params.actor.as_deref().map(|a| format!("%{}%", a));

        let entries: Vec<Value> = sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (
               SELECT id, actor_id, actor_username, action, target_type, target_id, target_label, metadata, created_at
               FROM admin_audit_log
               WHERE ($1 = '' OR action = $1) AND ($2::text IS NULL OR actor_username ILIKE $2)
               ORDER BY created_at DESC
               LIMIT $3 OFFSET $4
             ) t"
        )
        .bind(action)
        .bind(actor.as_deref())
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .collect();

        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM admin_audit_log
             WHERE ($1 = '' OR action = $1) AND ($2::text IS NULL OR actor_username ILIKE $2)"
        )
        .bind(action)
        .bind(actor.as_deref())
        .fetch_one(&state.db)
        .await?;

        (entries, total)
    } else {
        let entries: Vec<Value> = sqlx::query_scalar::<_, Value>(
            "SELECT row_to_json(t) FROM (
               SELECT id, actor_id, actor_username, action, target_type, target_id, target_label, metadata, created_at
               FROM admin_audit_log
               ORDER BY created_at DESC
               LIMIT $1 OFFSET $2
             ) t"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .collect();

        let total: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM admin_audit_log")
            .fetch_one(&state.db)
            .await?;

        (entries, total)
    };

    Ok(Json(serde_json::json!({ "entries": entries, "total": total, "limit": limit, "offset": offset })))
}
