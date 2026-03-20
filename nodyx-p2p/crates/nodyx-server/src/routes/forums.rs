/// Forums routes — port of nodyx-core/src/routes/forums.ts
///
/// GET    /api/v1/forums/:community           — categories for a community
/// POST   /api/v1/forums/categories           — create category (mod/owner)
/// GET    /api/v1/forums/threads?category_id= — list threads + tags
/// POST   /api/v1/forums/threads              — create thread + first post
/// GET    /api/v1/forums/threads/:id          — thread detail + posts (optional auth)
/// POST   /api/v1/forums/posts                — create post
/// PUT    /api/v1/forums/posts/:id            — edit post (author or mod)
/// DELETE /api/v1/forums/posts/:id            — delete post (author or mod)
/// PATCH  /api/v1/forums/threads/:id          — update thread (mod/owner)
/// POST   /api/v1/forums/posts/:id/reactions  — toggle reaction
/// POST   /api/v1/forums/posts/:id/thanks     — toggle thanks
///
/// Note: notifications are created in DB but Socket.IO badge-count push is
/// deferred until the Rust service has its own WS layer.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::QueryBuilder;
use uuid::Uuid;

use crate::error::ApiError;
use crate::extractors::{optional_auth, AuthUser};
use crate::state::AppState;

// ── HTML sanitization (mirrors sanitize-html config) ─────────────────────────

fn sanitize(html: &str) -> String {
    use ammonia::Builder;
    use std::collections::{HashMap, HashSet};

    let mut tags: HashSet<&str> = HashSet::from_iter([
        "p", "br", "strong", "em", "u", "s", "code", "pre",
        "h1", "h2", "h3", "h4",
        "ul", "ol", "li",
        "blockquote", "hr",
        "a", "img",
        "table", "thead", "tbody", "tfoot", "tr", "th", "td",
        "div", "span",
        "iframe",
    ]);

    let generic_attrs: HashSet<&str> = HashSet::from_iter(["class", "data-align", "data-type"]);

    let tag_attrs: HashMap<&str, HashSet<&str>> = HashMap::from([
        ("span",   HashSet::from_iter(["class", "style", "data-align", "data-type"])),
        ("p",      HashSet::from_iter(["class", "style", "data-align", "data-type"])),
        ("a",      HashSet::from_iter(["href", "target"])),  // "rel" géré automatiquement par ammonia (noopener noreferrer)
        ("img",    HashSet::from_iter(["src", "alt", "width", "height"])),
        ("iframe", HashSet::from_iter(["src", "width", "height", "frameborder", "allowfullscreen", "allow"])),
        ("th",     HashSet::from_iter(["rowspan", "colspan"])),
        ("td",     HashSet::from_iter(["rowspan", "colspan"])),
    ]);

    Builder::new()
        .tags(tags)
        .generic_attributes(generic_attrs)
        .tag_attributes(tag_attrs)
        .clean(html)
        .to_string()
}

// ── Slug helpers ──────────────────────────────────────────────────────────────

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().enumerate().all(|(i, c)| {
        if i == 8 || i == 13 || i == 18 || i == 23 { c == '-' }
        else { c.is_ascii_hexdigit() }
    })
}

fn generate_slug(title: &str, id: &Uuid) -> String {
    let base: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let base = if base.len() > 80 { &base[..80] } else { &base };
    let suffix = &id.to_string().replace('-', "")[..8];
    format!("{}-{}", base, suffix)
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/// Check if a user is owner/admin/moderator in the community owning a thread.
async fn is_mod(db: &sqlx::PgPool, user_id: Uuid, thread_id: Uuid) -> bool {
    let role: Option<String> = sqlx::query_scalar(
        "SELECT cm.role
         FROM community_members cm
         JOIN categories cat ON cat.community_id = cm.community_id
         JOIN threads t ON t.category_id = cat.id
         WHERE t.id = $1 AND cm.user_id = $2
         LIMIT 1"
    )
    .bind(thread_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
    .unwrap_or(None)
    .flatten();

    matches!(role.as_deref(), Some("owner") | Some("admin") | Some("moderator"))
}

/// Resolve a thread id-or-slug to a JSON row.
async fn resolve_thread(db: &sqlx::PgPool, id_or_slug: &str) -> Option<Value> {
    if is_uuid(id_or_slug) {
        let id = Uuid::parse_str(id_or_slug).ok()?;
        sqlx::query_scalar(
            "SELECT row_to_json(t) FROM (
               SELECT t.*, u.username AS author_username, u.avatar AS author_avatar,
                      c.slug AS category_slug
               FROM threads t
               LEFT JOIN users u ON u.id = t.author_id
               LEFT JOIN categories c ON c.id = t.category_id
               WHERE t.id = $1 LIMIT 1
             ) t"
        )
        .bind(id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
    } else {
        sqlx::query_scalar(
            "SELECT row_to_json(t) FROM (
               SELECT t.*, u.username AS author_username, u.avatar AS author_avatar,
                      c.slug AS category_slug
               FROM threads t
               LEFT JOIN users u ON u.id = t.author_id
               LEFT JOIN categories c ON c.id = t.category_id
               WHERE t.slug = $1 LIMIT 1
             ) t"
        )
        .bind(id_or_slug)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
    }
}

/// Fetch tags for a list of thread ids — returns JSON array per thread_id.
async fn get_tags_for_threads(
    db: &sqlx::PgPool,
    thread_ids: &[Uuid],
) -> std::collections::HashMap<Uuid, Vec<Value>> {
    if thread_ids.is_empty() {
        return std::collections::HashMap::new();
    }

    #[derive(sqlx::FromRow)]
    struct ThreadTagRow {
        thread_id: Uuid,
        id:        Uuid,
        name:      String,
        color:     Option<String>,
    }

    let rows: Vec<ThreadTagRow> = sqlx::query_as(
        "SELECT tt.thread_id, t.id, t.name, t.color
         FROM thread_tags tt
         JOIN tags t ON t.id = tt.tag_id
         WHERE tt.thread_id = ANY($1)"
    )
    .bind(thread_ids)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let mut map: std::collections::HashMap<Uuid, Vec<Value>> = std::collections::HashMap::new();
    for r in rows {
        map.entry(r.thread_id).or_default().push(serde_json::json!({
            "id": r.id, "name": r.name, "color": r.color
        }));
    }
    map
}

async fn get_tags_for_thread(db: &sqlx::PgPool, thread_id: Uuid) -> Vec<Value> {
    sqlx::query_as::<_, (Uuid, String, Option<String>)>(
        "SELECT t.id, t.name, t.color
         FROM thread_tags tt
         JOIN tags t ON t.id = tt.tag_id
         WHERE tt.thread_id = $1"
    )
    .bind(thread_id)
    .fetch_all(db)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|(id, name, color)| serde_json::json!({ "id": id, "name": name, "color": color }))
    .collect()
}

async fn set_thread_tags(db: &sqlx::PgPool, thread_id: Uuid, tag_ids: &[Uuid]) {
    let _ = sqlx::query("DELETE FROM thread_tags WHERE thread_id = $1")
        .bind(thread_id)
        .execute(db)
        .await;

    if !tag_ids.is_empty() {
        let _ = sqlx::query(
            "INSERT INTO thread_tags (thread_id, tag_id) SELECT $1, unnest($2::uuid[])"
        )
        .bind(thread_id)
        .bind(tag_ids)
        .execute(db)
        .await;
    }
}

/// Create a notification (fire-and-forget, errors ignored).
async fn create_notification(
    db: &sqlx::PgPool,
    user_id: Uuid,
    notif_type: &str,
    actor_id: Uuid,
    thread_id: Uuid,
    post_id: Uuid,
) {
    let _ = sqlx::query(
        "INSERT INTO notifications (user_id, type, actor_id, thread_id, post_id)
         VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(user_id)
    .bind(notif_type)
    .bind(actor_id)
    .bind(thread_id)
    .bind(post_id)
    .execute(db)
    .await;
}

/// Extract @username mentions from HTML and return their user UUIDs.
async fn extract_mentions(db: &sqlx::PgPool, html: &str) -> Vec<Uuid> {
    let re = regex_lite::Regex::new(r#"data-type="mention"[^>]*data-id="([^"]+)""#)
        .unwrap_or_else(|_| regex_lite::Regex::new(r"(?:)").unwrap());

    let usernames: Vec<String> = re
        .captures_iter(html)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
        .collect();

    if usernames.is_empty() {
        return vec![];
    }

    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE username = ANY($1)"
    )
    .bind(&usernames)
    .fetch_all(db)
    .await
    .unwrap_or_default()
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ThreadsQuery {
    category_id: String,
    limit:       Option<i64>,
    offset:      Option<i64>,
}

#[derive(Deserialize)]
struct CreateCategoryBody {
    community_id: Uuid,
    name:         String,
    description:  Option<String>,
    position:     Option<i32>,
}

#[derive(Deserialize)]
struct CreateThreadBody {
    category_id: String,
    title:       String,
    content:     String,
    tag_ids:     Option<Vec<Uuid>>,
}

#[derive(Deserialize)]
struct CreatePostBody {
    thread_id: String,
    content:   String,
}

#[derive(Deserialize)]
struct ReactionBody {
    emoji: String,
}

#[derive(Deserialize)]
struct PostContentBody {
    content: Option<String>,
}

#[derive(Deserialize)]
struct PatchThreadBody {
    title:       Option<String>,
    is_pinned:   Option<bool>,
    is_locked:   Option<bool>,
    is_featured: Option<bool>,
    tag_ids:     Option<Vec<Uuid>>,
    #[serde(rename = "delete")]
    delete:      Option<bool>,
}

#[derive(Deserialize)]
struct ThreadDetailQuery {
    limit:  Option<i64>,
    offset: Option<i64>,
}

// ── Route builder ─────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/forums/:community",        get(community_categories_handler))
        .route("/forums/categories",        post(create_category_handler))
        .route("/forums/threads",           get(list_threads_handler).post(create_thread_handler))
        .route("/forums/threads/:id",       get(thread_detail_handler).patch(patch_thread_handler))
        .route("/forums/posts",             post(create_post_handler))
        .route("/forums/posts/:id",         put(edit_post_handler).delete(delete_post_handler))
        .route("/forums/posts/:id/reactions", post(toggle_reaction_handler))
        .route("/forums/posts/:id/thanks",    post(toggle_thanks_handler))
}

// ── GET /api/v1/forums/:community ─────────────────────────────────────────────

async fn community_categories_handler(
    State(state): State<AppState>,
    Path(community_slug): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM communities WHERE slug = $1 LIMIT 1"
    )
    .bind(&community_slug)
    .fetch_optional(&state.db)
    .await?;

    let community_id = community_id.ok_or_else(|| ApiError::NotFound("Community not found".into()))?;

    let categories: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT c.*, parent.slug AS parent_slug,
                  (SELECT COUNT(*)::int FROM threads WHERE category_id = c.id) AS thread_count
           FROM categories c
           LEFT JOIN categories parent ON parent.id = c.parent_id
           WHERE c.community_id = $1
           ORDER BY c.position ASC, c.name ASC
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(serde_json::json!({ "categories": categories })))
}

// ── POST /api/v1/forums/categories ───────────────────────────────────────────

async fn create_category_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateCategoryBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.name.trim().is_empty() || body.name.len() > 100 {
        return Err(ApiError::BadRequest("Invalid category name".into()));
    }

    // Check community exists
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM communities WHERE id = $1)"
    )
    .bind(body.community_id)
    .fetch_one(&state.db)
    .await?;

    if !exists {
        return Err(ApiError::NotFound("Community not found".into()));
    }

    // Check user is mod/owner
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1"
    )
    .bind(body.community_id)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await?;

    match role.as_deref() {
        Some("owner") | Some("admin") | Some("moderator") => {}
        _ => return Err(ApiError::Forbidden),
    }

    let category: Value = sqlx::query_scalar(
        "INSERT INTO categories (community_id, name, description, position)
         VALUES ($1, $2, $3, COALESCE($4, 0))
         RETURNING row_to_json(categories.*)"
    )
    .bind(body.community_id)
    .bind(body.name.trim())
    .bind(body.description.as_deref())
    .bind(body.position)
    .fetch_one(&state.db)
    .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "category": category })),
    ))
}

// ── GET /api/v1/forums/threads?category_id= ───────────────────────────────────

async fn list_threads_handler(
    State(state): State<AppState>,
    Query(params): Query<ThreadsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let raw = params.category_id.trim().to_string();
    let limit  = params.limit.unwrap_or(50).clamp(1, 100);
    let offset = params.offset.unwrap_or(0).max(0);

    // Resolve slug → UUID
    let category_id: Uuid = if is_uuid(&raw) {
        Uuid::parse_str(&raw).map_err(|_| ApiError::NotFound("Category not found".into()))?
    } else {
        let id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM categories WHERE slug = $1 LIMIT 1"
        )
        .bind(&raw)
        .fetch_optional(&state.db)
        .await?;
        id.ok_or_else(|| ApiError::NotFound("Category not found".into()))?
    };

    #[derive(sqlx::FromRow)]
    struct ThreadListRow {
        id:                   Uuid,
        title:                String,
        slug:                 String,
        author_id:            Option<Uuid>,
        author_username:      Option<String>,
        author_avatar:        Option<String>,
        is_pinned:            bool,
        is_locked:            bool,
        is_featured:          Option<bool>,
        views:           i32,
        post_count:           i64,
        category_name:        Option<String>,
        category_slug:        Option<String>,
        category_description: Option<String>,
        created_at:           chrono::NaiveDateTime,
    }

    let rows: Vec<ThreadListRow> = sqlx::query_as(
        "SELECT
           t.id, t.title, t.slug, t.author_id, t.is_pinned, t.is_locked, t.is_featured,
           t.views, t.created_at,
           u.username AS author_username, u.avatar AS author_avatar,
           c.name AS category_name, c.slug AS category_slug, c.description AS category_description,
           (SELECT COUNT(*)::bigint FROM posts p WHERE p.thread_id = t.id) AS post_count
         FROM threads t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN users u ON t.author_id = u.id
         WHERE t.category_id = $1
         ORDER BY
           t.is_pinned DESC,
           COALESCE(
             (SELECT MAX(p.created_at) FROM posts p WHERE p.thread_id = t.id),
             t.created_at
           ) DESC
         LIMIT $2 OFFSET $3"
    )
    .bind(category_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    // Batch-fetch tags
    let thread_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let tags_map = get_tags_for_threads(&state.db, &thread_ids).await;

    let category_info = serde_json::json!({
        "id":          category_id,
        "name":        rows.first().and_then(|r| r.category_name.as_deref()).unwrap_or("Discussions"),
        "slug":        rows.first().and_then(|r| r.category_slug.as_deref()),
        "description": rows.first().and_then(|r| r.category_description.as_deref()),
    });

    let threads: Vec<Value> = rows.into_iter().map(|r| {
        let tags = tags_map.get(&r.id).cloned().unwrap_or_default();
        serde_json::json!({
            "id": r.id, "title": r.title, "slug": r.slug,
            "author_id": r.author_id, "author_username": r.author_username, "author_avatar": r.author_avatar,
            "is_pinned": r.is_pinned, "is_locked": r.is_locked, "is_featured": r.is_featured,
            "views": r.views, "post_count": r.post_count, "created_at": r.created_at,
            "category_name": category_info["name"], "category_slug": category_info["slug"],
            "category_description": category_info["description"],
            "tags": tags,
        })
    }).collect();

    Ok(Json(serde_json::json!({ "threads": threads, "category": category_info })))
}

// ── POST /api/v1/forums/threads ───────────────────────────────────────────────

async fn create_thread_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateThreadBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.title.trim().len() < 3 || body.title.len() > 300 {
        return Err(ApiError::BadRequest("Title must be 3–300 characters".into()));
    }
    if body.content.trim().is_empty() {
        return Err(ApiError::BadRequest("Content required".into()));
    }

    // Resolve category
    let category_id: Uuid = if is_uuid(&body.category_id) {
        Uuid::parse_str(&body.category_id).map_err(|_| ApiError::NotFound("Category not found".into()))?
    } else {
        let id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM categories WHERE slug = $1 LIMIT 1"
        )
        .bind(&body.category_id)
        .fetch_optional(&state.db)
        .await?;
        id.ok_or_else(|| ApiError::NotFound("Category not found".into()))?
    };

    // Ban check
    let is_banned: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM community_bans cb
           JOIN categories c ON c.community_id = cb.community_id
           WHERE c.id = $1 AND cb.user_id = $2
         )"
    )
    .bind(category_id)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await?;

    if is_banned {
        return Err(ApiError::Forbidden);
    }

    let thread_id = Uuid::new_v4();
    let slug = generate_slug(body.title.trim(), &thread_id);

    let thread: Value = sqlx::query_scalar(
        "INSERT INTO threads (id, category_id, author_id, title, slug)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING row_to_json(threads.*)"
    )
    .bind(thread_id)
    .bind(category_id)
    .bind(auth.user_id)
    .bind(body.title.trim())
    .bind(&slug)
    .fetch_one(&state.db)
    .await?;

    let sanitized = sanitize(&body.content);
    let post: Value = sqlx::query_scalar(
        "INSERT INTO posts (thread_id, author_id, content)
         VALUES ($1, $2, $3)
         RETURNING row_to_json(posts.*)"
    )
    .bind(thread_id)
    .bind(auth.user_id)
    .bind(&sanitized)
    .fetch_one(&state.db)
    .await?;

    // Attach tags
    if let Some(ref tag_ids) = body.tag_ids {
        if !tag_ids.is_empty() {
            set_thread_tags(&state.db, thread_id, tag_ids).await;
        }
    }

    let tags = get_tags_for_thread(&state.db, thread_id).await;

    let mut thread_with_tags = thread.clone();
    if let Some(obj) = thread_with_tags.as_object_mut() {
        obj.insert("tags".into(), Value::Array(tags));
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "thread": thread_with_tags, "post": post })),
    ))
}

// ── GET /api/v1/forums/threads/:id ───────────────────────────────────────────

async fn thread_detail_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(params): Query<ThreadDetailQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let viewer_id = optional_auth(&headers, &state).await;
    let limit  = params.limit.unwrap_or(50).clamp(1, 200);
    let offset = params.offset.unwrap_or(0).max(0);

    let thread = resolve_thread(&state.db, &id).await
        .ok_or_else(|| ApiError::NotFound("Thread not found".into()))?;

    let thread_id: Uuid = thread["id"].as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("thread id parse")))?;

    // Increment views (fire-and-forget)
    let db = state.db.clone();
    let tid = thread_id;
    tokio::spawn(async move {
        let _ = sqlx::query("UPDATE threads SET views = views + 1 WHERE id = $1")
            .bind(tid)
            .execute(&db)
            .await;
    });

    // Fetch posts + author info
    #[derive(sqlx::FromRow)]
    struct PostRow {
        id:              Uuid,
        thread_id:       Uuid,
        author_id:       Option<Uuid>,
        content:         String,
        created_at:      chrono::NaiveDateTime,
        updated_at:      Option<chrono::NaiveDateTime>,
        author_username: Option<String>,
        author_avatar:   Option<String>,
        name_color:      Option<String>,
    }

    let posts: Vec<PostRow> = sqlx::query_as(
        "SELECT p.id, p.thread_id, p.author_id, p.content, p.created_at, p.updated_at,
                u.username AS author_username, u.avatar AS author_avatar,
                up.name_color
         FROM posts p
         LEFT JOIN users u ON u.id = p.author_id
         LEFT JOIN user_profiles up ON up.user_id = p.author_id
         WHERE p.thread_id = $1
         ORDER BY p.created_at ASC
         LIMIT $2 OFFSET $3"
    )
    .bind(thread_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let post_ids: Vec<Uuid> = posts.iter().map(|p| p.id).collect();

    // Fetch reactions (grouped per post)
    #[derive(sqlx::FromRow)]
    struct ReactionRow {
        post_id:  Uuid,
        emoji:    String,
        count:    i64,
        user_ids: Vec<Uuid>,
    }

    let reactions: Vec<ReactionRow> = sqlx::query_as(
        "SELECT post_id, emoji, COUNT(*)::bigint AS count, ARRAY_AGG(user_id) AS user_ids
         FROM post_reactions
         WHERE post_id = ANY($1)
         GROUP BY post_id, emoji"
    )
    .bind(&post_ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Fetch thanks counts
    #[derive(sqlx::FromRow)]
    struct ThanksRow {
        post_id:  Uuid,
        count:    i64,
        user_ids: Vec<Uuid>,
    }

    let thanks: Vec<ThanksRow> = sqlx::query_as(
        "SELECT post_id, COUNT(*)::bigint AS count, ARRAY_AGG(user_id) AS user_ids
         FROM post_thanks
         WHERE post_id = ANY($1)
         GROUP BY post_id"
    )
    .bind(&post_ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Build maps for O(1) lookups
    let mut reaction_map: std::collections::HashMap<Uuid, Vec<Value>> = std::collections::HashMap::new();
    for r in reactions {
        let reacted = viewer_id.map(|vid| r.user_ids.contains(&vid)).unwrap_or(false);
        reaction_map.entry(r.post_id).or_default().push(serde_json::json!({
            "emoji": r.emoji, "count": r.count, "reacted": reacted
        }));
    }

    let mut thanks_map: std::collections::HashMap<Uuid, Value> = std::collections::HashMap::new();
    for t in thanks {
        let thanked = viewer_id.map(|vid| t.user_ids.contains(&vid)).unwrap_or(false);
        thanks_map.insert(t.post_id, serde_json::json!({ "count": t.count, "thanked": thanked }));
    }

    let posts_json: Vec<Value> = posts.into_iter().map(|p| {
        let reactions = reaction_map.get(&p.id).cloned().unwrap_or_default();
        let thanks = thanks_map.get(&p.id).cloned()
            .unwrap_or_else(|| serde_json::json!({ "count": 0, "thanked": false }));
        serde_json::json!({
            "id": p.id, "thread_id": p.thread_id, "author_id": p.author_id,
            "content": p.content, "created_at": p.created_at, "updated_at": p.updated_at,
            "author_username": p.author_username, "author_avatar": p.author_avatar,
            "name_color": p.name_color,
            "reactions": reactions, "thanks": thanks,
        })
    }).collect();

    let tags = get_tags_for_thread(&state.db, thread_id).await;
    let mut thread_with_tags = thread;
    if let Some(obj) = thread_with_tags.as_object_mut() {
        obj.insert("tags".into(), Value::Array(tags));
    }

    Ok(Json(serde_json::json!({ "thread": thread_with_tags, "posts": posts_json })))
}

// ── POST /api/v1/forums/posts ─────────────────────────────────────────────────

async fn create_post_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreatePostBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.content.trim().is_empty() {
        return Err(ApiError::BadRequest("Content required".into()));
    }

    let thread = resolve_thread(&state.db, &body.thread_id).await
        .ok_or_else(|| ApiError::NotFound("Thread not found".into()))?;

    let thread_id: Uuid = thread["id"].as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("thread id")))?;

    if thread["is_locked"].as_bool().unwrap_or(false) {
        return Err(ApiError::Forbidden);
    }

    // Ban check
    let is_banned: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM community_bans cb
           JOIN categories cat ON cat.community_id = cb.community_id
           JOIN threads t ON t.category_id = cat.id
           WHERE cb.user_id = $1 AND t.id = $2
         )"
    )
    .bind(auth.user_id)
    .bind(thread_id)
    .fetch_one(&state.db)
    .await?;

    if is_banned {
        return Err(ApiError::Forbidden);
    }

    let sanitized = sanitize(&body.content);
    let post: Value = sqlx::query_scalar(
        "INSERT INTO posts (thread_id, author_id, content)
         VALUES ($1, $2, $3)
         RETURNING row_to_json(posts.*)"
    )
    .bind(thread_id)
    .bind(auth.user_id)
    .bind(&sanitized)
    .fetch_one(&state.db)
    .await?;

    let post_id: Uuid = post["id"].as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .unwrap_or_else(Uuid::new_v4);

    let thread_author_id: Option<Uuid> = thread["author_id"].as_str()
        .and_then(|s| Uuid::parse_str(s).ok());

    // Notifications — fire-and-forget (no Socket.IO badge push yet)
    let db = state.db.clone();
    let user_id = auth.user_id;
    let html = sanitized.clone();
    tokio::spawn(async move {
        // Notify thread author of reply
        if let Some(taid) = thread_author_id {
            if taid != user_id {
                create_notification(&db, taid, "thread_reply", user_id, thread_id, post_id).await;
            }
        }
        // Notify mentioned users
        let mentioned = extract_mentions(&db, &html).await;
        for mid in mentioned {
            if mid != user_id {
                create_notification(&db, mid, "mention", user_id, thread_id, post_id).await;
            }
        }
    });

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "post": post })),
    ))
}

// ── PUT /api/v1/forums/posts/:id ─────────────────────────────────────────────

async fn edit_post_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PostContentBody>,
) -> Result<impl IntoResponse, ApiError> {
    let content = body.content.as_deref().unwrap_or("").trim().to_string();
    if content.is_empty() {
        return Err(ApiError::BadRequest("Content required".into()));
    }

    #[derive(sqlx::FromRow)]
    struct PostMeta { author_id: Uuid, thread_id: Uuid }
    let meta: Option<PostMeta> = sqlx::query_as(
        "SELECT author_id, thread_id FROM posts WHERE id = $1 LIMIT 1"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    let meta = meta.ok_or_else(|| ApiError::NotFound("Post not found".into()))?;

    let is_author = meta.author_id == auth.user_id;
    let mod_access = !is_author && is_mod(&state.db, auth.user_id, meta.thread_id).await;

    if !is_author && !mod_access {
        return Err(ApiError::Forbidden);
    }

    let post: Value = sqlx::query_scalar(
        "UPDATE posts SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING row_to_json(posts.*)"
    )
    .bind(sanitize(&content))
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "post": post })))
}

// ── DELETE /api/v1/forums/posts/:id ──────────────────────────────────────────

async fn delete_post_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    #[derive(sqlx::FromRow)]
    struct PostMeta { author_id: Uuid, thread_id: Uuid }
    let meta: Option<PostMeta> = sqlx::query_as(
        "SELECT author_id, thread_id FROM posts WHERE id = $1 LIMIT 1"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    let meta = meta.ok_or_else(|| ApiError::NotFound("Post not found".into()))?;

    let is_author = meta.author_id == auth.user_id;
    let mod_access = !is_author && is_mod(&state.db, auth.user_id, meta.thread_id).await;

    if !is_author && !mod_access {
        return Err(ApiError::Forbidden);
    }

    sqlx::query("DELETE FROM posts WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── PATCH /api/v1/forums/threads/:id ─────────────────────────────────────────

async fn patch_thread_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PatchThreadBody>,
) -> Result<impl IntoResponse, ApiError> {
    let thread = resolve_thread(&state.db, &id).await
        .ok_or_else(|| ApiError::NotFound("Thread not found".into()))?;

    let thread_id: Uuid = thread["id"].as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("thread id")))?;

    let thread_author_id: Option<Uuid> = thread["author_id"].as_str()
        .and_then(|s| Uuid::parse_str(s).ok());

    let is_author  = thread_author_id == Some(auth.user_id);
    let mod_access = is_mod(&state.db, auth.user_id, thread_id).await;

    if !is_author && !mod_access {
        return Err(ApiError::Forbidden);
    }

    // Author-only: can only edit title
    if is_author && !mod_access {
        let title = body.title.as_deref().unwrap_or("").trim().to_string();
        if title.is_empty() {
            return Err(ApiError::Forbidden);
        }
        let updated: Value = sqlx::query_scalar(
            "UPDATE threads SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING row_to_json(threads.*)"
        )
        .bind(&title)
        .bind(thread_id)
        .fetch_one(&state.db)
        .await?;
        return Ok(Json(serde_json::json!({ "thread": updated })));
    }

    // Mod: delete
    if body.delete.unwrap_or(false) {
        sqlx::query("DELETE FROM threads WHERE id = $1")
            .bind(thread_id)
            .execute(&state.db)
            .await?;
        return Ok(Json(serde_json::json!({ "deleted": true })));
    }

    // Mod: update tags
    if let Some(ref tag_ids) = body.tag_ids {
        set_thread_tags(&state.db, thread_id, tag_ids).await;
    }

    // Mod: dynamic field update
    let mut qb: QueryBuilder<sqlx::Postgres> = QueryBuilder::new("UPDATE threads SET updated_at = NOW()");
    if let Some(ref t) = body.title {
        let t = t.trim().to_string();
        if !t.is_empty() { qb.push(", title = ").push_bind(t); }
    }
    if let Some(v) = body.is_pinned   { qb.push(", is_pinned = ").push_bind(v); }
    if let Some(v) = body.is_locked   { qb.push(", is_locked = ").push_bind(v); }
    if let Some(v) = body.is_featured { qb.push(", is_featured = ").push_bind(v); }
    qb.push(" WHERE id = ").push_bind(thread_id).push(" RETURNING row_to_json(threads.*)");

    let updated: Value = qb
        .build_query_scalar()
        .fetch_one(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "thread": updated })))
}

// ── POST /api/v1/forums/posts/:id/reactions ──────────────────────────────────

async fn toggle_reaction_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<ReactionBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.emoji.is_empty() || body.emoji.len() > 10 {
        return Err(ApiError::BadRequest("Invalid emoji".into()));
    }

    // Verify post exists
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    if !exists {
        return Err(ApiError::NotFound("Post not found".into()));
    }

    // Toggle: delete if exists, insert if not
    let deleted: u64 = sqlx::query(
        "DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3"
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(&body.emoji)
    .execute(&state.db)
    .await?
    .rows_affected();

    if deleted == 0 {
        let _ = sqlx::query(
            "INSERT INTO post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
        )
        .bind(id)
        .bind(auth.user_id)
        .bind(&body.emoji)
        .execute(&state.db)
        .await;
    }

    // Return updated reactions for this post
    #[derive(sqlx::FromRow, Serialize)]
    struct ReactionCount {
        emoji:    String,
        count:    i64,
        user_ids: Vec<Uuid>,
    }

    let reaction_rows: Vec<ReactionCount> = sqlx::query_as(
        "SELECT emoji, COUNT(*)::bigint AS count, ARRAY_AGG(user_id) AS user_ids
         FROM post_reactions WHERE post_id = $1
         GROUP BY emoji"
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let reactions: Vec<Value> = reaction_rows.into_iter().map(|r| {
        let reacted = r.user_ids.contains(&auth.user_id);
        serde_json::json!({ "emoji": r.emoji, "count": r.count, "reacted": reacted })
    }).collect();

    Ok(Json(serde_json::json!({ "reactions": reactions })))
}

// ── POST /api/v1/forums/posts/:id/thanks ─────────────────────────────────────

async fn toggle_thanks_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    #[derive(sqlx::FromRow)]
    struct PostMeta { author_id: Uuid, thread_id: Uuid }
    let meta: Option<PostMeta> = sqlx::query_as(
        "SELECT author_id, thread_id FROM posts WHERE id = $1 LIMIT 1"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    let meta = meta.ok_or_else(|| ApiError::NotFound("Post not found".into()))?;

    if meta.author_id == auth.user_id {
        return Err(ApiError::BadRequest("Cannot thank your own post".into()));
    }

    // Toggle thanks
    let deleted: u64 = sqlx::query(
        "DELETE FROM post_thanks WHERE post_id = $1 AND user_id = $2"
    )
    .bind(id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await?
    .rows_affected();

    let added = deleted == 0;

    if added {
        // Insert thanks + give point to author
        let _ = sqlx::query(
            "INSERT INTO post_thanks (post_id, user_id, author_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
        )
        .bind(id)
        .bind(auth.user_id)
        .bind(meta.author_id)
        .execute(&state.db)
        .await;

        let _ = sqlx::query("UPDATE users SET points = points + 1 WHERE id = $1")
            .bind(meta.author_id)
            .execute(&state.db)
            .await;

        // Notification (fire-and-forget, no Socket.IO yet)
        let db = state.db.clone();
        let user_id = auth.user_id;
        let author_id = meta.author_id;
        let thread_id = meta.thread_id;
        let post_id = id;
        tokio::spawn(async move {
            create_notification(&db, author_id, "post_thanks", user_id, thread_id, post_id).await;
        });
    } else {
        // Remove point on un-thanks
        let _ = sqlx::query("UPDATE users SET points = GREATEST(0, points - 1) WHERE id = $1")
            .bind(meta.author_id)
            .execute(&state.db)
            .await;
    }

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM post_thanks WHERE post_id = $1"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(serde_json::json!({ "added": added, "count": count })))
}
