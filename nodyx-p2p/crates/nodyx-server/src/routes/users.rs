/// Users routes — partial port of nodyx-core/src/routes/users.ts
///
/// Ported:
///   GET  /api/v1/users/search          — username search (requires auth)
///   GET  /api/v1/users/me              — current user + role/grade
///   PATCH/api/v1/users/me/linked-instances — add/remove linked instance
///   GET  /api/v1/users/:username/profile   — public profile (big JOIN)
///   GET  /api/v1/users/:username/github    — GitHub widget proxy (Redis cache)
///   GET  /api/v1/users/:id                 — user by UUID
///
/// Kept in Node.js (Socket.IO + multipart):
///   PATCH /api/v1/users/me/profile         — presence:effects_update via Socket.IO
///   POST  /api/v1/users/me/upload          — sharp image processing + font uploads

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    routing::{get, patch},
    Json, Router,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::error::ApiError;
use crate::extractors::AuthUser;
use crate::state::AppState;

const GITHUB_CACHE_TTL: u64 = 3600; // 1 hour

/// Cached community_id for role/grade lookups
static COMMUNITY_ID_USERS: OnceCell<Option<Uuid>> = OnceCell::const_new();

async fn get_community_id(db: &sqlx::PgPool) -> Option<Uuid> {
    COMMUNITY_ID_USERS
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

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
struct LinkedInstancesBody {
    action: String,
    slug:   String,
}

// ── Typed row for search results ──────────────────────────────────────────────

#[derive(sqlx::FromRow, Serialize)]
struct UserSearchRow {
    id:         Uuid,
    username:   String,
    avatar:     Option<String>,
    name_color: Option<String>,
}

// ── Route builder ─────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/search",                 get(search_handler))
        .route("/users/me",                     get(me_handler))
        .route("/users/me/linked-instances",    patch(linked_instances_handler))
        .route("/users/:username/profile",      get(profile_handler))
        .route("/users/:username/github",       get(github_handler))
        .route("/users/:id",                    get(user_by_id_handler))
}

// ── GET /api/v1/users/search?q=... ───────────────────────────────────────────

async fn search_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let q = params.q.as_deref().unwrap_or("").trim().to_string();
    if q.len() < 2 {
        return Ok(Json(serde_json::json!({ "users": [] })));
    }

    let pattern = format!("%{}%", q);
    let users: Vec<UserSearchRow> = sqlx::query_as(
        "SELECT u.id, u.username, u.avatar, p.name_color
         FROM   users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE  u.username ILIKE $1
         AND    u.id != $2
         ORDER  BY u.username ASC
         LIMIT  10"
    )
    .bind(&pattern)
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "users": users })))
}

// ── GET /api/v1/users/me ─────────────────────────────────────────────────────

async fn me_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    // Full user + profile via row_to_json (avoids declaring a mega-struct)
    let user: Option<Value> = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (
           SELECT
             u.id, u.username, u.email, u.avatar, u.points, u.created_at,
             u.email_verified,
             p.display_name, p.avatar_url, p.banner_url, p.bio, p.status,
             p.location, p.tags, p.links, p.github_username, p.name_color,
             p.name_glow, p.name_glow_intensity, p.name_animation,
             p.name_font_family, p.name_font_url,
             p.banner_asset_id, p.frame_asset_id, p.badge_asset_id, p.metadata
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
           WHERE u.id = $1
           LIMIT 1
         ) t"
    )
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    let mut user = match user {
        Some(v) => v,
        None => return Err(ApiError::NotFound("User not found".into())),
    };

    // Fetch role + grade + ban status from community
    let mut role:      Option<String> = None;
    let mut grade:     Option<Value>  = None;
    let mut is_banned = false;

    if let Some(community_id) = get_community_id(&state.db).await {
        let (member_res, ban_res) = tokio::join!(
            sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>)>(
                "SELECT cm.role, cg.name, cg.color
                 FROM community_members cm
                 LEFT JOIN community_grades cg ON cg.id = cm.grade_id
                 WHERE cm.user_id = $1 AND cm.community_id = $2"
            )
            .bind(auth.user_id)
            .bind(community_id)
            .fetch_optional(&state.db),
            sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM community_bans WHERE user_id = $1 AND community_id = $2)"
            )
            .bind(auth.user_id)
            .bind(community_id)
            .fetch_one(&state.db)
        );

        if let Some((r, grade_name, grade_color)) = member_res? {
            role = r;
            grade = grade_name.map(|name| serde_json::json!({
                "name":  name,
                "color": grade_color,
            }));
        }
        is_banned = ban_res?;
    }

    // Merge into user object
    if let Some(obj) = user.as_object_mut() {
        obj.insert("role".into(),      serde_json::to_value(&role).unwrap_or(Value::Null));
        obj.insert("grade".into(),     grade.unwrap_or(Value::Null));
        obj.insert("is_banned".into(), Value::Bool(is_banned));
    }

    Ok(Json(serde_json::json!({ "user": user })))
}

// ── PATCH /api/v1/users/me/linked-instances ───────────────────────────────────

async fn linked_instances_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<LinkedInstancesBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.action != "add" && body.action != "remove" {
        return Err(ApiError::BadRequest("action doit être \"add\" ou \"remove\"".into()));
    }
    // slug: letters, digits, dashes, 1-50 chars
    if body.slug.is_empty()
        || body.slug.len() > 50
        || !body.slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(ApiError::BadRequest("slug invalide".into()));
    }

    let op = if body.action == "add" {
        "array_append(COALESCE(linked_instances, '{}'), $1::text)"
    } else {
        "array_remove(COALESCE(linked_instances, '{}'), $1::text)"
    };

    let sql = format!(
        "UPDATE users
         SET linked_instances = COALESCE((
           SELECT array_agg(DISTINCT x) FROM unnest({op}) x
         ), '{{}}')
         WHERE id = $2
         RETURNING linked_instances",
        op = op
    );

    let instances: Option<Vec<String>> = sqlx::query_scalar(&sql)
        .bind(&body.slug)
        .bind(auth.user_id)
        .fetch_optional(&state.db)
        .await?
        .flatten();

    Ok(Json(serde_json::json!({
        "linked_instances": instances.unwrap_or_default()
    })))
}

// ── GET /api/v1/users/:username/profile ──────────────────────────────────────

async fn profile_handler(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let profile: Option<Value> = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (
           SELECT
             u.id, u.username, u.points, u.created_at,
             p.display_name, p.avatar_url, p.banner_url,
             p.bio, p.status, p.location, p.tags, p.links,
             p.github_username, p.youtube_channel, p.twitter_username,
             p.instagram_username, p.website_url, p.name_color,
             p.name_glow, p.name_glow_intensity, p.name_animation,
             p.name_font_family, p.name_font_url,
             p.banner_asset_id, p.frame_asset_id, p.badge_asset_id, p.metadata,
             ab.file_path  AS banner_asset_path,
             af.file_path  AS frame_asset_path,
             af.thumbnail_path AS frame_asset_thumb,
             ad.file_path  AS badge_asset_path,
             ad.name       AS badge_asset_name,
             (SELECT COUNT(*) FROM threads t WHERE t.author_id = u.id) AS thread_count,
             (SELECT COUNT(*) FROM posts po WHERE po.author_id = u.id) AS post_count,
             g.name AS grade_name, g.color AS grade_color
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
           LEFT JOIN community_assets ab  ON ab.id  = p.banner_asset_id
           LEFT JOIN community_assets af  ON af.id  = p.frame_asset_id
           LEFT JOIN community_assets ad  ON ad.id  = p.badge_asset_id
           LEFT JOIN community_members cm ON cm.user_id = u.id
           LEFT JOIN community_grades g ON g.id = cm.grade_id
           WHERE u.username = $1
           LIMIT 1
         ) t"
    )
    .bind(&username)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    match profile {
        None => Err(ApiError::NotFound("User not found".into())),
        Some(v) => Ok(Json(v)),
    }
}

// ── GET /api/v1/users/:username/github ───────────────────────────────────────

#[derive(Deserialize)]
struct GhUser {
    login:        String,
    name:         Option<String>,
    avatar_url:   String,
    bio:          Option<String>,
    public_repos: u64,
    followers:    u64,
}

#[derive(Deserialize, Serialize)]
struct GhRepo {
    name:             String,
    description:      Option<String>,
    language:         Option<String>,
    stargazers_count: u64,
    html_url:         String,
}

async fn github_handler(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    // Look up github_username for this Nodyx user
    let gh_username: Option<String> = sqlx::query_scalar(
        "SELECT p.github_username
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.username = $1
         LIMIT 1"
    )
    .bind(&username)
    .fetch_optional(&state.db)
    .await?
    .flatten()
    .flatten();

    let gh_username = gh_username.ok_or_else(|| ApiError::NotFound("No GitHub account linked".into()))?;

    let cache_key = format!("github:{}", gh_username);
    let mut redis = state.redis.clone();

    // Check Redis cache first
    let cached: Option<String> = redis.get(&cache_key).await.unwrap_or(None);
    if let Some(cached_json) = cached {
        if let Ok(v) = serde_json::from_str::<Value>(&cached_json) {
            return Ok(Json(v));
        }
    }

    // Fetch from GitHub API in parallel
    let gh_api_url  = format!("https://api.github.com/users/{}", gh_username);
    let gh_repo_url = format!("https://api.github.com/users/{}/repos?sort=updated&per_page=6", gh_username);

    let (user_res, repos_res) = tokio::join!(
        state.http.get(&gh_api_url)
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "Nodyx/1.0")
            .send(),
        state.http.get(&gh_repo_url)
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "Nodyx/1.0")
            .send()
    );

    let user_resp = match user_res {
        Err(_) => return Err(ApiError::BadRequest("GitHub API unavailable".into())),
        Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => {
            return Err(ApiError::NotFound("GitHub user not found".into()));
        }
        Ok(r) if !r.status().is_success() => {
            return Err(ApiError::BadRequest("GitHub API unavailable".into()));
        }
        Ok(r) => r,
    };

    let gh_user: GhUser = user_resp.json().await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    let mut repos: Vec<GhRepo> = repos_res
        .ok()
        .and_then(|r| if r.status().is_success() { Some(r) } else { None })
        .and_then(|r| tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(r.json::<Vec<GhRepo>>()).ok()
        }))
        .unwrap_or_default();

    repos.sort_by(|a, b| b.stargazers_count.cmp(&a.stargazers_count));
    let pinned_repos: Vec<_> = repos.into_iter().take(3).map(|r| serde_json::json!({
        "name":        r.name,
        "description": r.description,
        "language":    r.language,
        "stars":       r.stargazers_count,
        "url":         r.html_url,
    })).collect();

    let data = serde_json::json!({
        "login":        gh_user.login,
        "name":         gh_user.name,
        "avatar_url":   gh_user.avatar_url,
        "bio":          gh_user.bio,
        "public_repos": gh_user.public_repos,
        "followers":    gh_user.followers,
        "pinned_repos": pinned_repos,
    });

    // Cache 1 hour
    let cached_str = data.to_string();
    let _: () = redis.set_ex(&cache_key, cached_str, GITHUB_CACHE_TTL).await?;

    Ok(Json(data))
}

// ── GET /api/v1/users/:id ────────────────────────────────────────────────────

async fn user_by_id_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = Uuid::parse_str(&id)
        .map_err(|_| ApiError::NotFound("User not found".into()))?;

    let user: Option<Value> = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (
           SELECT u.id, u.username, u.avatar, u.points, u.created_at,
                  p.display_name, p.avatar_url, p.name_color
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
           WHERE u.id = $1
           LIMIT 1
         ) t"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    match user {
        None => Err(ApiError::NotFound("User not found".into())),
        Some(v) => Ok(Json(serde_json::json!({ "user": v }))),
    }
}
