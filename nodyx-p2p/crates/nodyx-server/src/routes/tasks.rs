/// Tasks routes — port of nodyx-core/src/routes/tasks.ts
/// Kanban léger : boards par communauté, colonnes configurables, cartes avec assignation.
///
/// GET    /api/v1/tasks/boards              — liste des boards
/// POST   /api/v1/tasks/boards              — créer un board (+ 3 colonnes par défaut)
/// GET    /api/v1/tasks/boards/:id          — board complet (colonnes + cartes + membres)
/// PATCH  /api/v1/tasks/boards/:id          — renommer / décrire un board
/// DELETE /api/v1/tasks/boards/:id          — supprimer un board
/// POST   /api/v1/tasks/boards/:id/columns  — ajouter une colonne
/// PATCH  /api/v1/tasks/columns/:id         — modifier une colonne (nom/couleur/position)
/// DELETE /api/v1/tasks/columns/:id         — supprimer une colonne
/// POST   /api/v1/tasks/columns/:id/cards   — créer une carte
/// PATCH  /api/v1/tasks/cards/:id           — modifier une carte (title/desc/assignee/priority/column)
/// DELETE /api/v1/tasks/cards/:id           — supprimer une carte

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::QueryBuilder;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::error::ApiError;
use crate::extractors::AuthUser;
use crate::state::AppState;

// ── Community ID cache ────────────────────────────────────────────────────────

static COMMUNITY_ID_TASKS: OnceCell<Option<Uuid>> = OnceCell::const_new();

async fn get_community_id(db: &sqlx::PgPool) -> Option<Uuid> {
    COMMUNITY_ID_TASKS
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

// ── Permission helper ─────────────────────────────────────────────────────────

async fn get_member_role(db: &sqlx::PgPool, community_id: Uuid, user_id: Uuid) -> Option<String> {
    sqlx::query_scalar(
        "SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1"
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

fn can_admin(role: Option<&str>) -> bool {
    matches!(role, Some("owner") | Some("admin") | Some("moderator"))
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateBoardBody {
    name:        String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize)]
struct UpdateBoardBody {
    name:        Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct CreateColumnBody {
    name:  String,
    #[serde(default = "default_color")]
    color: String,
}

fn default_color() -> String { "gray".into() }

#[derive(Deserialize)]
struct UpdateColumnBody {
    name:     Option<String>,
    color:    Option<String>,
    position: Option<i32>,
}

#[derive(Deserialize)]
struct CreateCardBody {
    title:       String,
    #[serde(default)]
    description: String,
    assignee_id: Option<Uuid>,
    due_date:    Option<String>,
    #[serde(default = "default_priority")]
    priority:    String,
}

fn default_priority() -> String { "normal".into() }

#[derive(Deserialize)]
struct UpdateCardBody {
    title:       Option<String>,
    description: Option<String>,
    assignee_id: Option<Value>,     // null ou uuid string
    due_date:    Option<Value>,     // null ou "YYYY-MM-DD"
    priority:    Option<String>,
    column_id:   Option<Uuid>,
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks/boards",             get(list_boards).post(create_board))
        .route("/tasks/boards/:id",         get(get_board).patch(update_board).delete(delete_board))
        .route("/tasks/boards/:id/columns", post(create_column))
        .route("/tasks/columns/:id",        patch(update_column).delete(delete_column))
        .route("/tasks/columns/:id/cards",  post(create_card))
        .route("/tasks/cards/:id",          patch(update_card).delete(delete_card))
}

// ── GET /api/v1/tasks/boards ─────────────────────────────────────────────────

async fn list_boards(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let _ = auth; // membership check implicit via community filter

    let boards: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT b.id, b.name, b.description, b.created_by, b.created_at,
                  u.username AS created_by_username,
                  (SELECT COUNT(*)::int FROM task_columns c WHERE c.board_id = b.id) AS column_count,
                  (SELECT COUNT(*)::int
                   FROM task_cards k
                   JOIN task_columns c ON c.id = k.column_id
                   WHERE c.board_id = b.id) AS card_count
           FROM task_boards b
           JOIN users u ON u.id = b.created_by
           WHERE b.community_id = $1
           ORDER BY b.created_at DESC
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    Ok(Json(serde_json::json!({ "boards": boards })))
}

// ── POST /api/v1/tasks/boards ────────────────────────────────────────────────

async fn create_board(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateBoardBody>,
) -> Result<impl IntoResponse, ApiError> {
    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(ApiError::BadRequest("Board name must be 1–100 characters".into()));
    }

    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let board_id: Uuid = sqlx::query_scalar(
        "INSERT INTO task_boards (community_id, name, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id"
    )
    .bind(community_id)
    .bind(&name)
    .bind(body.description.trim())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await?;

    // 3 colonnes par défaut
    for (i, (col_name, color)) in [("À faire", "gray"), ("En cours", "blue"), ("Terminé", "green")].iter().enumerate() {
        sqlx::query(
            "INSERT INTO task_columns (board_id, name, color, position) VALUES ($1, $2, $3, $4)"
        )
        .bind(board_id)
        .bind(col_name)
        .bind(color)
        .bind(i as i32)
        .execute(&state.db)
        .await?;
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "id": board_id })),
    ))
}

// ── GET /api/v1/tasks/boards/:id ─────────────────────────────────────────────

async fn get_board(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let board: Option<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT b.id, b.name, b.description, b.created_by, b.created_at,
                  u.username AS created_by_username
           FROM task_boards b
           JOIN users u ON u.id = b.created_by
           WHERE b.id = $1 AND b.community_id = $2
         ) t"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let board = board.ok_or_else(|| ApiError::NotFound("Board not found".into()))?;

    #[derive(sqlx::FromRow)]
    struct ColRow { id: Uuid, name: String, color: String, position: i32 }
    let columns: Vec<ColRow> = sqlx::query_as(
        "SELECT id, name, color, position FROM task_columns WHERE board_id = $1 ORDER BY position ASC"
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let cards: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT k.id, k.column_id, k.title, k.description, k.due_date, k.priority,
                  k.position, k.created_by, k.created_at, k.updated_at,
                  u.username AS created_by_username,
                  a.id       AS assignee_id,
                  a.username AS assignee_username,
                  a.avatar   AS assignee_avatar
           FROM task_cards k
           JOIN task_columns c ON c.id = k.column_id
           JOIN users u ON u.id = k.created_by
           LEFT JOIN users a ON a.id = k.assignee_id
           WHERE c.board_id = $1
           ORDER BY k.column_id, k.position ASC
         ) t"
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    // Grouper les cartes par colonne
    let mut cards_by_col: std::collections::HashMap<Uuid, Vec<Value>> = std::collections::HashMap::new();
    for card in cards {
        if let Some(col_id_str) = card["column_id"].as_str() {
            if let Ok(col_id) = Uuid::parse_str(col_id_str) {
                cards_by_col.entry(col_id).or_default().push(card);
            }
        }
    }

    let columns_with_cards: Vec<Value> = columns.iter().map(|col| {
        let cards = cards_by_col.get(&col.id).cloned().unwrap_or_default();
        serde_json::json!({
            "id": col.id, "name": col.name, "color": col.color, "position": col.position,
            "cards": cards,
        })
    }).collect();

    let creator_id: Uuid = board["created_by"].as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .unwrap_or_default();
    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    let can_manage = auth.user_id == creator_id || can_admin(role.as_deref());

    let members: Vec<Value> = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT u.id, u.username, u.avatar
           FROM community_members cm
           JOIN users u ON u.id = cm.user_id
           WHERE cm.community_id = $1
           ORDER BY u.username ASC
         ) t"
    )
    .bind(community_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    let mut board_obj = board.as_object().cloned().unwrap_or_default();
    board_obj.insert("columns".into(), Value::Array(columns_with_cards));

    Ok(Json(serde_json::json!({
        "board": Value::Object(board_obj),
        "canManage": can_manage,
        "members": members,
    })))
}

// ── PATCH /api/v1/tasks/boards/:id ───────────────────────────────────────────

async fn update_board(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateBoardBody>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let created_by: Option<Uuid> = sqlx::query_scalar(
        "SELECT created_by FROM task_boards WHERE id = $1 AND community_id = $2"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let created_by = created_by.ok_or_else(|| ApiError::NotFound("Board not found".into()))?;

    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    if auth.user_id != created_by && !can_admin(role.as_deref()) {
        return Err(ApiError::Forbidden);
    }

    let mut qb: QueryBuilder<sqlx::Postgres> = QueryBuilder::new("UPDATE task_boards SET ");
    let mut first = true;
    if let Some(ref name) = body.name {
        let name = name.trim().to_string();
        if !name.is_empty() {
            qb.push("name = ").push_bind(name);
            first = false;
        }
    }
    if let Some(ref desc) = body.description {
        if !first { qb.push(", "); }
        qb.push("description = ").push_bind(desc.trim().to_string());
        first = false;
    }
    if first {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }
    qb.push(" WHERE id = ").push_bind(id);
    qb.build().execute(&state.db).await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── DELETE /api/v1/tasks/boards/:id ──────────────────────────────────────────

async fn delete_board(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let created_by: Option<Uuid> = sqlx::query_scalar(
        "SELECT created_by FROM task_boards WHERE id = $1 AND community_id = $2"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let created_by = created_by.ok_or_else(|| ApiError::NotFound("Board not found".into()))?;

    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    if auth.user_id != created_by && !can_admin(role.as_deref()) {
        return Err(ApiError::Forbidden);
    }

    sqlx::query("DELETE FROM task_boards WHERE id = $1").bind(id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /api/v1/tasks/boards/:id/columns ────────────────────────────────────

async fn create_column(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateColumnBody>,
) -> Result<impl IntoResponse, ApiError> {
    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(ApiError::BadRequest("Column name must be 1–100 characters".into()));
    }

    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let created_by: Option<Uuid> = sqlx::query_scalar(
        "SELECT created_by FROM task_boards WHERE id = $1 AND community_id = $2"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let created_by = created_by.ok_or_else(|| ApiError::NotFound("Board not found".into()))?;

    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    if auth.user_id != created_by && !can_admin(role.as_deref()) {
        return Err(ApiError::Forbidden);
    }

    let max_pos: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1)::int FROM task_columns WHERE board_id = $1"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    let col: Value = sqlx::query_scalar(
        "INSERT INTO task_columns (board_id, name, color, position)
         VALUES ($1, $2, $3, $4)
         RETURNING row_to_json((SELECT t FROM (SELECT id, name, color, position) t))"
    )
    .bind(id)
    .bind(&name)
    .bind(&body.color)
    .bind(max_pos + 1)
    .fetch_one(&state.db)
    .await
    .unwrap_or_else(|_| serde_json::json!(null));

    // Fallback: query separately
    let col = if col.is_null() {
        let new_id: Uuid = sqlx::query_scalar(
            "INSERT INTO task_columns (board_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING id"
        )
        .bind(id).bind(&name).bind(&body.color).bind(max_pos + 1)
        .fetch_one(&state.db).await?;
        serde_json::json!({ "id": new_id, "name": name, "color": body.color, "position": max_pos + 1 })
    } else { col };

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "column": { "id": col["id"], "name": col["name"], "color": col["color"], "position": col["position"], "cards": [] } })),
    ))
}

// ── PATCH /api/v1/tasks/columns/:id ──────────────────────────────────────────

async fn update_column(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateColumnBody>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let created_by: Option<Uuid> = sqlx::query_scalar(
        "SELECT b.created_by FROM task_columns c
         JOIN task_boards b ON b.id = c.board_id
         WHERE c.id = $1 AND b.community_id = $2"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let created_by = created_by.ok_or_else(|| ApiError::NotFound("Column not found".into()))?;

    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    if auth.user_id != created_by && !can_admin(role.as_deref()) {
        return Err(ApiError::Forbidden);
    }

    let mut qb: QueryBuilder<sqlx::Postgres> = QueryBuilder::new("UPDATE task_columns SET ");
    let mut sep = "";
    if let Some(ref name) = body.name {
        let name = name.trim().to_string();
        if !name.is_empty() {
            qb.push(sep).push("name = ").push_bind(name);
            sep = ", ";
        }
    }
    if let Some(ref color) = body.color {
        qb.push(sep).push("color = ").push_bind(color.clone());
        sep = ", ";
    }
    if let Some(pos) = body.position {
        qb.push(sep).push("position = ").push_bind(pos);
        sep = ", ";
    }
    if sep.is_empty() {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }
    qb.push(" WHERE id = ").push_bind(id);
    qb.build().execute(&state.db).await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── DELETE /api/v1/tasks/columns/:id ─────────────────────────────────────────

async fn delete_column(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let created_by: Option<Uuid> = sqlx::query_scalar(
        "SELECT b.created_by FROM task_columns c
         JOIN task_boards b ON b.id = c.board_id
         WHERE c.id = $1 AND b.community_id = $2"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let created_by = created_by.ok_or_else(|| ApiError::NotFound("Column not found".into()))?;

    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    if auth.user_id != created_by && !can_admin(role.as_deref()) {
        return Err(ApiError::Forbidden);
    }

    sqlx::query("DELETE FROM task_columns WHERE id = $1").bind(id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /api/v1/tasks/columns/:id/cards ─────────────────────────────────────

async fn create_card(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateCardBody>,
) -> Result<impl IntoResponse, ApiError> {
    let title = body.title.trim().to_string();
    if title.is_empty() || title.len() > 200 {
        return Err(ApiError::BadRequest("Card title must be 1–200 characters".into()));
    }

    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    let col_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM task_columns c
           JOIN task_boards b ON b.id = c.board_id
           WHERE c.id = $1 AND b.community_id = $2
         )"
    )
    .bind(id)
    .bind(community_id)
    .fetch_one(&state.db)
    .await?;

    if !col_exists {
        return Err(ApiError::NotFound("Column not found".into()));
    }

    let max_pos: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1)::int FROM task_cards WHERE column_id = $1"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    let card_id: Uuid = sqlx::query_scalar(
        "INSERT INTO task_cards (column_id, title, description, assignee_id, due_date, priority, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"
    )
    .bind(id)
    .bind(&title)
    .bind(body.description.trim())
    .bind(body.assignee_id)
    .bind(body.due_date.as_deref())
    .bind(&body.priority)
    .bind(max_pos + 1)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await?;

    let card: Value = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT k.*, u.username AS created_by_username,
                  a.id AS assignee_id, a.username AS assignee_username, a.avatar AS assignee_avatar
           FROM task_cards k
           JOIN users u ON u.id = k.created_by
           LEFT JOIN users a ON a.id = k.assignee_id
           WHERE k.id = $1
         ) t"
    )
    .bind(card_id)
    .fetch_one(&state.db)
    .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "card": card })),
    ))
}

// ── PATCH /api/v1/tasks/cards/:id ────────────────────────────────────────────

async fn update_card(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateCardBody>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    #[derive(sqlx::FromRow)]
    struct CardMeta { created_by: Uuid, board_creator: Uuid }
    let meta: Option<CardMeta> = sqlx::query_as(
        "SELECT k.created_by, b.created_by AS board_creator
         FROM task_cards k
         JOIN task_columns c ON c.id = k.column_id
         JOIN task_boards b ON b.id = c.board_id
         WHERE k.id = $1 AND b.community_id = $2"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let meta = meta.ok_or_else(|| ApiError::NotFound("Card not found".into()))?;

    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    if auth.user_id != meta.created_by && auth.user_id != meta.board_creator && !can_admin(role.as_deref()) {
        return Err(ApiError::Forbidden);
    }

    // Vérifier colonne cible si déplacement
    if let Some(col_id) = body.column_id {
        let valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(
               SELECT 1 FROM task_columns c
               JOIN task_boards b ON b.id = c.board_id
               WHERE c.id = $1 AND b.community_id = $2
             )"
        )
        .bind(col_id)
        .bind(community_id)
        .fetch_one(&state.db)
        .await?;
        if !valid {
            return Err(ApiError::BadRequest("Invalid column".into()));
        }
    }

    let mut qb: QueryBuilder<sqlx::Postgres> = QueryBuilder::new("UPDATE task_cards SET updated_at = NOW()");

    if let Some(ref title) = body.title {
        let t = title.trim().to_string();
        if !t.is_empty() { qb.push(", title = ").push_bind(t); }
    }
    if let Some(ref desc) = body.description {
        qb.push(", description = ").push_bind(desc.trim().to_string());
    }
    if let Some(ref assignee) = body.assignee_id {
        if assignee.is_null() {
            qb.push(", assignee_id = NULL");
        } else if let Some(s) = assignee.as_str() {
            if let Ok(uid) = Uuid::parse_str(s) {
                qb.push(", assignee_id = ").push_bind(uid);
            }
        }
    }
    if let Some(ref due) = body.due_date {
        if due.is_null() {
            qb.push(", due_date = NULL");
        } else if let Some(s) = due.as_str() {
            qb.push(", due_date = ").push_bind(s.to_string());
        }
    }
    if let Some(ref priority) = body.priority {
        qb.push(", priority = ").push_bind(priority.clone());
    }
    if let Some(col_id) = body.column_id {
        let max_pos: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(position), -1)::int FROM task_cards WHERE column_id = $1 AND id != $2"
        )
        .bind(col_id)
        .bind(id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(-1);

        qb.push(", column_id = ").push_bind(col_id);
        qb.push(", position = ").push_bind(max_pos + 1);
    }

    qb.push(" WHERE id = ").push_bind(id);
    qb.build().execute(&state.db).await?;

    let card: Value = sqlx::query_scalar::<_, Value>(
        "SELECT row_to_json(t) FROM (
           SELECT k.*, u.username AS created_by_username,
                  a.id AS assignee_id, a.username AS assignee_username, a.avatar AS assignee_avatar
           FROM task_cards k
           JOIN users u ON u.id = k.created_by
           LEFT JOIN users a ON a.id = k.assignee_id
           WHERE k.id = $1
         ) t"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "card": card })))
}

// ── DELETE /api/v1/tasks/cards/:id ───────────────────────────────────────────

async fn delete_card(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let community_id = get_community_id(&state.db).await
        .ok_or_else(|| ApiError::BadRequest("Community not configured".into()))?;

    #[derive(sqlx::FromRow)]
    struct CardMeta { created_by: Uuid, board_creator: Uuid }
    let meta: Option<CardMeta> = sqlx::query_as(
        "SELECT k.created_by, b.created_by AS board_creator
         FROM task_cards k
         JOIN task_columns c ON c.id = k.column_id
         JOIN task_boards b ON b.id = c.board_id
         WHERE k.id = $1 AND b.community_id = $2"
    )
    .bind(id)
    .bind(community_id)
    .fetch_optional(&state.db)
    .await?;

    let meta = meta.ok_or_else(|| ApiError::NotFound("Card not found".into()))?;

    let role = get_member_role(&state.db, community_id, auth.user_id).await;
    if auth.user_id != meta.created_by && auth.user_id != meta.board_creator && !can_admin(role.as_deref()) {
        return Err(ApiError::Forbidden);
    }

    sqlx::query("DELETE FROM task_cards WHERE id = $1").bind(id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
