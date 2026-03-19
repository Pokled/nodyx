/// Notifications routes — port of nodyx-core/src/routes/notifications.ts
///
/// GET    /api/v1/notifications              — list (50 max) with actor + thread info
/// GET    /api/v1/notifications/unread-count — count of unread
/// PATCH  /api/v1/notifications/:id/read    — mark one as read
/// PATCH  /api/v1/notifications/read-all    — mark all as read
/// DELETE /api/v1/notifications/read        — delete all read notifications

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{delete, get, patch},
    Json, Router,
};
use serde_json::Value;
use uuid::Uuid;

use crate::error::ApiError;
use crate::extractors::AuthUser;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/notifications",              get(list_handler))
        .route("/notifications/unread-count", get(unread_count_handler))
        .route("/notifications/read-all",     patch(read_all_handler))
        .route("/notifications/read",         delete(delete_read_handler))
        .route("/notifications/:id/read",     patch(mark_read_handler))
}

// ── GET /api/v1/notifications ─────────────────────────────────────────────────

async fn list_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let notifications: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT n.*,
                  u.username AS actor_username,
                  u.avatar   AS actor_avatar,
                  th.title   AS thread_title,
                  th.category_id
           FROM notifications n
           LEFT JOIN users   u  ON u.id  = n.actor_id
           LEFT JOIN threads th ON th.id = n.thread_id
           WHERE n.user_id = $1
           ORDER BY n.created_at DESC
           LIMIT 50
         ) t"
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(serde_json::json!({ "notifications": notifications })))
}

// ── GET /api/v1/notifications/unread-count ────────────────────────────────────

async fn unread_count_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM notifications WHERE user_id = $1 AND is_read = false"
    )
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "count": count })))
}

// ── PATCH /api/v1/notifications/read-all ─────────────────────────────────────

async fn read_all_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    sqlx::query(
        "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false"
    )
    .bind(auth.user_id)
    .execute(&state.db)
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── DELETE /api/v1/notifications/read ────────────────────────────────────────

async fn delete_read_handler(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let deleted: u64 = sqlx::query(
        "DELETE FROM notifications WHERE user_id = $1 AND is_read = true"
    )
    .bind(auth.user_id)
    .execute(&state.db)
    .await?
    .rows_affected();

    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

// ── PATCH /api/v1/notifications/:id/read ─────────────────────────────────────

async fn mark_read_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let updated = sqlx::query(
        "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2"
    )
    .bind(id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await?
    .rows_affected();

    if updated == 0 {
        return Err(ApiError::NotFound("Notification not found".into()));
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}
