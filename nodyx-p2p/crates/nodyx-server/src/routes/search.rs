use axum::{
    extract::{ConnectInfo, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::net::SocketAddr;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::{error::ApiError, routes::directory::client_ip, state::AppState};

// ── Community ID cache (resolved once from DB) ────────────────────────────────

static COMMUNITY_ID: OnceCell<Option<Uuid>> = OnceCell::const_new();

async fn get_community_id(db: &sqlx::PgPool) -> Option<Uuid> {
    *COMMUNITY_ID
        .get_or_init(|| async {
            if let Ok(slug) = std::env::var("NODYX_COMMUNITY_SLUG") {
                if let Ok(Some(row)) = sqlx::query(
                    "SELECT id FROM communities WHERE slug = $1 LIMIT 1",
                )
                .bind(&slug)
                .fetch_optional(db)
                .await
                {
                    return Some(row.get::<Uuid, _>("id"));
                }
            }
            sqlx::query("SELECT id FROM communities ORDER BY created_at ASC LIMIT 1")
                .fetch_optional(db)
                .await
                .ok()
                .flatten()
                .map(|r| r.get::<Uuid, _>("id"))
        })
        .await
}

// ── Rate limit (60 req/min per IP) ───────────────────────────────────────────

async fn rate_limit(
    ip: &str,
    redis: &mut redis::aio::ConnectionManager,
) -> Result<(), ApiError> {
    let key   = format!("rate:search:instance:{ip}");
    let count: i64 = redis.incr(&key, 1i64).await?;
    if count == 1 { let _: () = redis.expire(&key, 60).await?; }
    if count > 60 {
        let ttl: i64 = redis.ttl(&key).await?;
        return Err(ApiError::TooManyRequests(ttl));
    }
    Ok(())
}

// ── Query params ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SearchQuery {
    q:      String,
    #[serde(rename = "type")]
    typ:    Option<String>,
    limit:  Option<String>,
    offset: Option<String>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

async fn search(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    // Validate
    let query = q.q.trim().to_string();
    if query.is_empty() || query.len() > 200 {
        return Err(ApiError::BadRequest("q must be 1-200 chars".into()));
    }
    let typ = q.typ.as_deref().unwrap_or("all");
    if !["threads", "posts", "all"].contains(&typ) {
        return Err(ApiError::BadRequest("type must be threads|posts|all".into()));
    }
    let limit: i64 = q.limit.as_deref().and_then(|s| s.parse().ok())
        .map(|n: i64| n.min(50).max(1)).unwrap_or(20);
    let offset: i64 = q.offset.as_deref().and_then(|s| s.parse().ok())
        .map(|n: i64| n.max(0)).unwrap_or(0);

    // Rate limit
    let ip = client_ip(&headers, peer);
    let mut redis = state.redis.clone();
    rate_limit(&ip, &mut redis).await?;

    let community_id = get_community_id(&state.db).await;
    let do_threads = typ == "threads" || typ == "all";
    let do_posts   = typ == "posts"   || typ == "all";

    // Run both queries in parallel
    let (threads_rows, posts_rows) = tokio::join!(
        async {
            if !do_threads || community_id.is_none() {
                return Ok::<Vec<_>, sqlx::Error>(vec![]);
            }
            sqlx::query(
                "SELECT t.id, t.title, t.created_at,
                        u.username        AS author_username,
                        cat.id            AS category_id,
                        cat.name          AS category_name,
                        ts_headline('french', t.title, plainto_tsquery('french', $1),
                          'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=10'
                        ) AS headline
                 FROM threads t
                 JOIN users u       ON u.id = t.author_id
                 JOIN categories cat ON cat.id = t.category_id
                 WHERE cat.community_id = $2
                   AND t.search_vector @@ plainto_tsquery('french', $1)
                 ORDER BY ts_rank(t.search_vector, plainto_tsquery('french', $1)) DESC
                 LIMIT $3 OFFSET $4",
            )
            .bind(&query)
            .bind(community_id.unwrap())
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await
        },
        async {
            if !do_posts || community_id.is_none() {
                return Ok::<Vec<_>, sqlx::Error>(vec![]);
            }
            sqlx::query(
                "SELECT p.id, p.thread_id, p.created_at,
                        t.title           AS thread_title,
                        cat.id            AS category_id,
                        u.username        AS author_username,
                        ts_headline('french',
                          regexp_replace(p.content, '<[^>]+>', ' ', 'g'),
                          plainto_tsquery('french', $1),
                          'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15'
                        ) AS headline
                 FROM posts p
                 JOIN users u        ON u.id = p.author_id
                 JOIN threads t      ON t.id = p.thread_id
                 JOIN categories cat ON cat.id = t.category_id
                 WHERE cat.community_id = $2
                   AND p.search_vector @@ plainto_tsquery('french', $1)
                 ORDER BY ts_rank(p.search_vector, plainto_tsquery('french', $1)) DESC
                 LIMIT $3 OFFSET $4",
            )
            .bind(&query)
            .bind(community_id.unwrap())
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await
        },
    );

    let threads: Vec<Value> = threads_rows?.iter().map(|r| json!({
        "id":              r.get::<Uuid, _>("id"),
        "title":           r.get::<String, _>("title"),
        "created_at":      r.get::<chrono::NaiveDateTime, _>("created_at"),
        "author_username": r.get::<String, _>("author_username"),
        "category_id":     r.get::<Uuid, _>("category_id"),
        "category_name":   r.get::<String, _>("category_name"),
        "headline":        r.get::<String, _>("headline"),
    })).collect();

    let posts: Vec<Value> = posts_rows?.iter().map(|r| json!({
        "id":              r.get::<Uuid, _>("id"),
        "thread_id":       r.get::<Uuid, _>("thread_id"),
        "created_at":      r.get::<chrono::NaiveDateTime, _>("created_at"),
        "thread_title":    r.get::<String, _>("thread_title"),
        "category_id":     r.get::<Uuid, _>("category_id"),
        "author_username": r.get::<String, _>("author_username"),
        "headline":        r.get::<String, _>("headline"),
    })).collect();

    Ok(Json(json!({ "query": query, "threads": threads, "posts": posts })))
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new().route("/search", get(search))
}
