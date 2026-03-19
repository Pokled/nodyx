use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get, post},
    Json, Router,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use std::{collections::HashSet, net::SocketAddr};
use uuid::Uuid;

use crate::{error::ApiError, state::AppState};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn strip_html(s: &str, max_chars: usize) -> String {
    ammonia::Builder::new()
        .tags(HashSet::new())
        .clean(s)
        .to_string()
        .chars()
        .take(max_chars)
        .collect()
}

fn is_private_ip(ip: &str) -> bool {
    match ip.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(v4)) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        Ok(std::net::IpAddr::V6(v6)) => v6.is_loopback(),
        Err(_) => true,
    }
}

fn extract_subdomain(host: &str) -> Option<String> {
    let host = host.split(':').next().unwrap_or("").to_lowercase();
    let slug = host.strip_suffix(".nodyx.org")?;
    if slug.contains('.')
        || slug.len() < 3
        || slug.len() > 63
        || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    Some(slug.to_string())
}

fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| peer.ip().to_string())
}

async fn rate_limit_search(
    ip: &str,
    redis: &mut redis::aio::ConnectionManager,
) -> Result<(), ApiError> {
    let key = format!("rate:search:{ip}");
    let count: i64 = redis.incr(&key, 1i64).await?;
    if count == 1 {
        let _: () = redis.expire(&key, 60).await?;
    }
    if count > 30 {
        let ttl: i64 = redis.ttl(&key).await?;
        return Err(ApiError::TooManyRequests(ttl));
    }
    Ok(())
}

// ── Cloudflare helpers ────────────────────────────────────────────────────────

const CF_BASE: &str = "https://api.cloudflare.com/client/v4";

async fn cf_request(
    http: &reqwest::Client,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> anyhow::Result<Value> {
    let token = std::env::var("CF_TOKEN")?;
    let zone  = std::env::var("CF_ZONE_ID")?;
    let url   = format!("{CF_BASE}/zones/{zone}{path}");
    let mut req = http.request(method, &url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json");
    if let Some(b) = body { req = req.json(&b); }
    Ok(req.send().await?.json().await?)
}

async fn create_cf_subdomain(http: &reqwest::Client, slug: &str, ip: &str) -> Option<String> {
    let body = json!({
        "type": "A", "name": format!("{slug}.nodyx.org"),
        "content": ip, "ttl": 1, "proxied": true,
    });
    match cf_request(http, reqwest::Method::POST, "/dns_records", Some(body)).await {
        Ok(r) if r["success"].as_bool() == Some(true) => {
            r["result"]["id"].as_str().map(String::from)
        }
        Ok(r) => { tracing::error!("[CF] error for {slug}: {:?}", r["errors"]); None }
        Err(e) => { tracing::error!("[CF] exception for {slug}: {e:?}"); None }
    }
}

async fn delete_cf_record(http: &reqwest::Client, record_id: &str) {
    let path = format!("/dns_records/{record_id}");
    if let Err(e) = cf_request(http, reqwest::Method::DELETE, &path, None).await {
        tracing::error!("[CF] delete error for {record_id}: {e:?}");
    }
}

// ── Subdomain redirect middleware ─────────────────────────────────────────────

pub async fn subdomain_redirect(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let host = headers.get("host").and_then(|h| h.to_str().ok()).unwrap_or("");
    if let Some(slug) = extract_subdomain(host) {
        let main_slug = std::env::var("NODYX_COMMUNITY_SLUG")
            .unwrap_or_else(|_| "nodyxnode".into());
        if slug != main_slug {
            if let Ok(Some(row)) = sqlx::query(
                "SELECT url FROM directory_instances WHERE slug = $1 AND status = 'active' LIMIT 1",
            )
            .bind(&slug)
            .fetch_optional(&state.db)
            .await
            {
                let url: String = row.get("url");
                if url.starts_with("https://") {
                    let path = request.uri().path_and_query()
                        .map(|pq| pq.as_str()).unwrap_or("/");
                    let target = format!(
                        "{}{}",
                        url.trim_end_matches('/'),
                        if path == "/" { "" } else { path }
                    );
                    return Redirect::temporary(&target).into_response();
                }
            }
        }
    }
    next.run(request).await
}

// ── GET /api/directory ────────────────────────────────────────────────────────

async fn list_instances(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, slug, name, description, url, language, country, theme,
                members, online, version, status, last_seen, registered_at,
                logo_url, banner_url
         FROM directory_instances
         WHERE status = 'active'
           AND (last_seen IS NULL OR last_seen > NOW() - INTERVAL '15 minutes')
         ORDER BY members DESC, registered_at ASC",
    )
    .fetch_all(&state.db)
    .await?;

    let instances: Vec<Value> = rows.iter().map(|r| json!({
        "id":            r.get::<i32, _>("id"),
        "slug":          r.get::<String, _>("slug"),
        "name":          r.get::<String, _>("name"),
        "description":   r.get::<Option<String>, _>("description"),
        "url":           r.get::<String, _>("url"),
        "language":      r.get::<Option<String>, _>("language"),
        "country":       r.get::<Option<String>, _>("country"),
        "theme":         r.get::<Option<String>, _>("theme"),
        "members":       r.get::<i32, _>("members"),
        "online":        r.get::<i32, _>("online"),
        "version":       r.get::<Option<String>, _>("version"),
        "status":        r.get::<String, _>("status"),
        "last_seen":     r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_seen"),
        "registered_at": r.get::<chrono::DateTime<chrono::Utc>, _>("registered_at"),
        "logo_url":      r.get::<Option<String>, _>("logo_url"),
        "banner_url":    r.get::<Option<String>, _>("banner_url"),
    })).collect();

    Ok(Json(json!({ "instances": instances })))
}

// ── POST /api/directory/register ─────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterBody {
    name: String, slug: String, url: String,
    description: Option<String>, language: Option<String>,
    country: Option<String>, theme: Option<String>, version: Option<String>,
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.name.is_empty() || body.slug.is_empty() || body.url.is_empty() {
        return Err(ApiError::BadRequest("name, slug and url are required".into()));
    }
    let slug_re = regex_lite::Regex::new(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$").unwrap();
    if !slug_re.is_match(&body.slug) {
        return Err(ApiError::BadRequest(
            "Invalid slug format (lowercase alphanumeric and hyphens, 3-63 chars)".into(),
        ));
    }
    match body.url.parse::<url::Url>() {
        Ok(u) if u.scheme() == "https" => {}
        _ => return Err(ApiError::BadRequest("URL must use HTTPS".into())),
    }
    if sqlx::query("SELECT id FROM directory_instances WHERE slug = $1")
        .bind(&body.slug)
        .fetch_optional(&state.db)
        .await?
        .is_some()
    {
        return Err(ApiError::Conflict("Slug already taken".into()));
    }

    let token = {
        use rand::Rng;
        let bytes: [u8; 32] = rand::thread_rng().gen();
        hex::encode(bytes)
    };

    let row = sqlx::query(
        "INSERT INTO directory_instances
           (slug, name, description, url, language, country, theme, version, token, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
         RETURNING id, slug, name, url, status, registered_at",
    )
    .bind(&body.slug).bind(&body.name)
    .bind(body.description.as_deref().unwrap_or(""))
    .bind(&body.url)
    .bind(body.language.as_deref().unwrap_or("fr"))
    .bind(body.country.as_deref().unwrap_or(""))
    .bind(body.theme.as_deref().unwrap_or(""))
    .bind(body.version.as_deref().unwrap_or(""))
    .bind(&token)
    .fetch_one(&state.db)
    .await?;

    let instance_id:   i32    = row.get("id");
    let instance_slug: String = row.get("slug");
    let instance_name: String = row.get("name");
    let instance_url:  String = row.get("url");
    let instance_stat: String = row.get("status");
    let instance_reg:  chrono::DateTime<chrono::Utc> = row.get("registered_at");
    let subdomain = format!("{}.nodyx.org", body.slug);

    {
        let db = state.db.clone(); let http = state.http.clone();
        let slug = body.slug.clone();
        tokio::spawn(async move {
            let vps_ip = std::env::var("VPS_IP").ok();
            let has_cf = std::env::var("CF_TOKEN").is_ok() && std::env::var("CF_ZONE_ID").is_ok();
            if vps_ip.is_none() || !has_cf {
                let reason = if vps_ip.is_none() { "VPS_IP not set" } else { "CF credentials missing" };
                tracing::warn!("[Directory] {slug} — skipping DNS ({reason}), activating directly");
                let _ = sqlx::query("UPDATE directory_instances SET status='active' WHERE id=$1")
                    .bind(instance_id).execute(&db).await;
                return;
            }
            let ip = vps_ip.unwrap();
            if let Some(record_id) = create_cf_subdomain(&http, &slug, &ip).await {
                let _ = sqlx::query(
                    "UPDATE directory_instances SET status='active', ip=$1, cloudflare_record_id=$2 WHERE id=$3",
                )
                .bind(&ip).bind(&record_id).bind(instance_id).execute(&db).await;
                tracing::info!("[Directory] {slug} activated. CF record: {record_id}");
            }
        });
    }

    Ok((StatusCode::CREATED, Json(json!({
        "message": "Instance registered. DNS subdomain will be created within 30 seconds.",
        "token": token, "subdomain": subdomain,
        "instance": {
            "id": instance_id, "slug": instance_slug,
            "name": instance_name, "url": instance_url,
            "status": instance_stat, "registered_at": instance_reg,
        }
    }))))
}

// ── POST /api/directory/ping ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct PingBody {
    token: String,
    members:    Option<i32>,
    online:     Option<i32>,
    logo_url:   Option<Value>,   // null | string — serde doesn't distinguish missing vs null for Option<Option>
    banner_url: Option<Value>,
}

async fn ping(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<PingBody>,
) -> Result<Json<Value>, ApiError> {
    if body.token.is_empty() {
        return Err(ApiError::BadRequest("token required".into()));
    }
    let raw_ip  = client_ip(&headers, peer);
    let ping_ip: Option<String> = if is_private_ip(&raw_ip) { None } else { Some(raw_ip) };

    let logo_url   = body.logo_url.as_ref().and_then(|v| v.as_str()).map(String::from);
    let banner_url = body.banner_url.as_ref().and_then(|v| v.as_str()).map(String::from);

    let row = sqlx::query(
        "UPDATE directory_instances
         SET last_seen  = NOW(),
             members    = COALESCE($2, members),
             online     = COALESCE($3, online),
             logo_url   = COALESCE($4, logo_url),
             banner_url = COALESCE($5, banner_url),
             ip         = COALESCE($6::inet, ip)
         WHERE token = $1
         RETURNING slug, status",
    )
    .bind(&body.token)
    .bind(body.members).bind(body.online)
    .bind(logo_url).bind(banner_url).bind(ping_ip)
    .fetch_optional(&state.db)
    .await?;

    match row {
        None    => Err(ApiError::NotFound("Unknown token".into())),
        Some(r) => Ok(Json(json!({
            "ok": true,
            "slug":   r.get::<String, _>("slug"),
            "status": r.get::<String, _>("status"),
        }))),
    }
}

// ── DELETE /api/directory/:slug ───────────────────────────────────────────────

#[derive(Deserialize)]
struct UnregisterBody { token: String }

async fn unregister(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(body): Json<UnregisterBody>,
) -> Result<Json<Value>, ApiError> {
    if body.token.is_empty() {
        return Err(ApiError::BadRequest("token required".into()));
    }
    let row = sqlx::query(
        "SELECT id, cloudflare_record_id FROM directory_instances WHERE slug=$1 AND token=$2",
    )
    .bind(&slug).bind(&body.token)
    .fetch_optional(&state.db).await?
    .ok_or(ApiError::Forbidden)?;

    let id:        i32           = row.get("id");
    let record_id: Option<String> = row.get("cloudflare_record_id");

    if let Some(rid) = record_id { delete_cf_record(&state.http, &rid).await; }
    sqlx::query("DELETE FROM directory_instances WHERE id=$1").bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

// ── POST /api/directory/assets ────────────────────────────────────────────────

#[derive(Deserialize)]
struct AssetAnnouncement {
    id: String, asset_type: String, name: String,
    description: Option<String>, tags: Option<Vec<String>>,
    file_hash: String, file_url: String,
    thumbnail_url: Option<String>,
    file_size: Option<i32>, mime_type: Option<String>, downloads: Option<i32>,
}

#[derive(Deserialize)]
struct PushAssetsBody { assets: Vec<AssetAnnouncement> }

async fn push_assets(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PushAssetsBody>,
) -> Result<Json<Value>, ApiError> {
    let auth  = headers.get("authorization").and_then(|h| h.to_str().ok()).unwrap_or("");
    let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
    if token.is_empty() { return Err(ApiError::Unauthorized); }

    let inst = sqlx::query(
        "SELECT id, slug FROM directory_instances WHERE token = $1 AND status = 'active'",
    )
    .bind(token).fetch_optional(&state.db).await?.ok_or(ApiError::Forbidden)?;

    let instance_id:   i32    = inst.get("id");
    let instance_slug: String = inst.get("slug");

    let mut upserted = 0u32;
    let mut skipped  = 0u32;

    for a in body.assets.iter().take(500) {
        if a.id.is_empty() || a.asset_type.is_empty() || a.name.is_empty()
            || a.file_hash.is_empty() || a.file_url.is_empty()
        {
            skipped += 1; continue;
        }
        let canon: i32 = sqlx::query(
            "SELECT canonical_instance_id FROM directory_assets WHERE file_hash = $1 LIMIT 1",
        )
        .bind(&a.file_hash)
        .fetch_optional(&state.db).await?
        .and_then(|r| r.try_get::<i32, _>("canonical_instance_id").ok())
        .unwrap_or(instance_id);

        sqlx::query(
            "INSERT INTO directory_assets
               (instance_id, instance_slug, remote_asset_id, asset_type, name, description,
                tags, file_hash, file_url, thumbnail_url, file_size, mime_type,
                downloads, canonical_instance_id, updated_at)
             VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
             ON CONFLICT (instance_id, remote_asset_id) DO UPDATE SET
               name=EXCLUDED.name, description=EXCLUDED.description, tags=EXCLUDED.tags,
               file_url=EXCLUDED.file_url, thumbnail_url=EXCLUDED.thumbnail_url,
               file_size=EXCLUDED.file_size, mime_type=EXCLUDED.mime_type,
               downloads=EXCLUDED.downloads, updated_at=NOW()",
        )
        .bind(instance_id).bind(&instance_slug).bind(&a.id).bind(&a.asset_type).bind(&a.name)
        .bind(&a.description).bind(a.tags.as_deref().unwrap_or(&[]))
        .bind(&a.file_hash).bind(&a.file_url).bind(&a.thumbnail_url)
        .bind(a.file_size).bind(&a.mime_type).bind(a.downloads.unwrap_or(0)).bind(canon)
        .execute(&state.db).await?;

        upserted += 1;
    }
    Ok(Json(json!({ "ok": true, "upserted": upserted, "skipped": skipped })))
}

// ── GET /api/directory/assets/search ─────────────────────────────────────────

#[derive(Deserialize)]
struct AssetSearchQuery {
    q: Option<String>,
    #[serde(rename = "type")] asset_type: Option<String>,
    instance_slug: Option<String>,
    limit: Option<String>, offset: Option<String>,
}

async fn search_assets(
    State(state): State<AppState>,
    Query(q): Query<AssetSearchQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit: i64 = q.limit.as_deref().and_then(|s| s.parse().ok())
        .map(|n: i64| n.min(50)).unwrap_or(24);
    let offset: i64 = q.offset.as_deref().and_then(|s| s.parse().ok())
        .map(|n: i64| n.max(0).min(10_000)).unwrap_or(0);

    let mut conditions: Vec<String> = Vec::new();
    let mut p = 0usize;

    if q.asset_type.is_some()    { p += 1; conditions.push(format!("da.asset_type = ${p}")); }
    if q.instance_slug.is_some() { p += 1; conditions.push(format!("da.instance_slug = ${p}")); }
    let fts_idx = if q.q.is_some() {
        p += 1;
        let i = p;
        conditions.push(format!("da.search_vector @@ plainto_tsquery('french', ${i})"));
        Some(i)
    } else { None };

    let where_c = if conditions.is_empty() { String::new() }
        else { format!("WHERE {}", conditions.join(" AND ")) };
    let order_by = fts_idx.map_or("da.announced_at DESC".into(), |i| {
        format!("ts_rank(da.search_vector, plainto_tsquery('french', ${i})) DESC, da.announced_at DESC")
    });

    let lp = p + 1; let op = p + 2;
    let sql = format!(
        "SELECT da.id, da.instance_id, da.instance_slug, da.remote_asset_id, da.asset_type,
                da.name, da.description, da.tags, da.file_hash, da.file_url, da.thumbnail_url,
                da.file_size, da.mime_type, da.downloads, da.canonical_instance_id,
                da.announced_at, di.name AS instance_name, di.url AS instance_url
         FROM directory_assets da
         JOIN directory_instances di ON di.id = da.instance_id AND di.status = 'active'
         {where_c} ORDER BY {order_by} LIMIT ${lp} OFFSET ${op}"
    );
    let count_sql = format!(
        "SELECT COUNT(*) AS total FROM directory_assets da
         JOIN directory_instances di ON di.id = da.instance_id AND di.status = 'active'
         {where_c}"
    );

    let mut qry = sqlx::query(&sql);
    let mut cqry = sqlx::query(&count_sql);
    if let Some(t) = &q.asset_type    { qry = qry.bind(t); cqry = cqry.bind(t); }
    if let Some(s) = &q.instance_slug { qry = qry.bind(s); cqry = cqry.bind(s); }
    if let Some(s) = &q.q             { qry = qry.bind(s); cqry = cqry.bind(s); }
    qry = qry.bind(limit).bind(offset);

    let rows  = qry.fetch_all(&state.db).await?;
    let crows = cqry.fetch_all(&state.db).await?;
    let total: i64 = crows.first().and_then(|r| r.try_get("total").ok()).unwrap_or(0);

    let assets: Vec<Value> = rows.iter().map(|r| json!({
        "id":                    r.get::<Uuid, _>("id"),
        "instance_id":           r.get::<i32, _>("instance_id"),
        "instance_slug":         r.get::<String, _>("instance_slug"),
        "remote_asset_id":       r.get::<Uuid, _>("remote_asset_id"),
        "asset_type":            r.get::<String, _>("asset_type"),
        "name":                  r.get::<String, _>("name"),
        "description":           r.get::<Option<String>, _>("description"),
        "tags":                  r.get::<Vec<String>, _>("tags"),
        "file_hash":             r.get::<String, _>("file_hash"),
        "file_url":              r.get::<String, _>("file_url"),
        "thumbnail_url":         r.get::<Option<String>, _>("thumbnail_url"),
        "file_size":             r.get::<Option<i32>, _>("file_size"),
        "mime_type":             r.get::<Option<String>, _>("mime_type"),
        "downloads":             r.get::<i32, _>("downloads"),
        "canonical_instance_id": r.get::<Option<i32>, _>("canonical_instance_id"),
        "announced_at":          r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("announced_at"),
        "instance_name":         r.get::<String, _>("instance_name"),
        "instance_url":          r.get::<String, _>("instance_url"),
    })).collect();

    Ok(Json(json!({ "assets": assets, "total": total, "limit": limit, "offset": offset })))
}

// ── POST /api/directory/search/announce ──────────────────────────────────────

#[derive(Deserialize)]
struct AnnounceThread {
    thread_id: Option<String>, thread_slug: Option<String>,
    category_id: Option<String>, category_slug: Option<String>,
    title: Option<String>, excerpt: Option<String>,
    #[serde(default)] tags: Vec<String>,
    reply_count: Option<Value>,
}

#[derive(Deserialize)]
struct AnnounceBody { token: String, threads: Vec<AnnounceThread> }

async fn announce(
    State(state): State<AppState>,
    Json(body): Json<AnnounceBody>,
) -> Result<Json<Value>, ApiError> {
    if body.token.is_empty() { return Err(ApiError::BadRequest("token required".into())); }
    let inst = sqlx::query(
        "SELECT slug, url FROM directory_instances WHERE token = $1 AND status = 'active' LIMIT 1",
    )
    .bind(&body.token).fetch_optional(&state.db).await?.ok_or(ApiError::Forbidden)?;

    let instance_slug: String = inst.get("slug");
    let instance_url:  String = inst.get("url");
    if body.threads.is_empty() { return Ok(Json(json!({ "ok": true, "indexed": 0 }))); }

    let mut indexed = 0u32;
    for t in &body.threads {
        let (Some(thread_id_str), Some(title)) = (&t.thread_id, &t.title) else { continue };
        let tid: Uuid = match thread_id_str.parse() { Ok(u) => u, Err(_) => continue };
        let cid: Option<Uuid> = t.category_id.as_deref().and_then(|s| s.parse().ok());
        let title_s   = title.chars().take(200).collect::<String>();
        let excerpt_s = t.excerpt.as_deref().unwrap_or("").chars().take(300).collect::<String>();
        let replies: i32 = match &t.reply_count {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0) as i32,
            Some(Value::String(s)) => s.parse().unwrap_or(0),
            _ => 0,
        };
        sqlx::query(
            "INSERT INTO network_index
               (instance_slug, instance_url, content_type, content_id,
                thread_id, thread_slug, category_id, category_slug,
                title, excerpt, tags, reply_count, search_vector)
             VALUES ($1,$2,'thread',$3,$3,$4,$5,$6,$7,$8,$9::text[],$10,
                     to_tsvector('simple',$7||' '||$8||' '||array_to_string($9::text[],' ')))
             ON CONFLICT (instance_slug, content_type, content_id) DO UPDATE SET
               thread_slug=EXCLUDED.thread_slug, category_id=EXCLUDED.category_id,
               category_slug=EXCLUDED.category_slug, title=EXCLUDED.title,
               excerpt=EXCLUDED.excerpt, tags=EXCLUDED.tags, reply_count=EXCLUDED.reply_count,
               updated_at=NOW(), search_vector=EXCLUDED.search_vector",
        )
        .bind(&instance_slug).bind(&instance_url).bind(tid)
        .bind(&t.thread_slug).bind(cid).bind(&t.category_slug)
        .bind(&title_s).bind(&excerpt_s).bind(&t.tags).bind(replies)
        .execute(&state.db).await?;
        indexed += 1;
    }
    Ok(Json(json!({ "ok": true, "indexed": indexed })))
}

// ── POST /api/directory/gossip/receive ───────────────────────────────────────

#[derive(Deserialize)]
struct GossipThread {
    thread_id: Option<String>, thread_slug: Option<String>,
    category_id: Option<String>, category_slug: Option<String>,
    title: Option<String>, excerpt: Option<String>,
    #[serde(default)] tags: Vec<String>,
    reply_count: Option<Value>,
}

#[derive(Deserialize)]
struct GossipEvent {
    event_id: Option<String>, title: Option<String>, description: Option<String>,
    #[serde(default)] tags: Vec<String>,
    starts_at: Option<String>, ends_at: Option<String>,
    location: Option<String>, is_cancelled: Option<bool>,
}

#[derive(Deserialize)]
struct GossipBody {
    instance_slug: String, instance_url: String,
    #[serde(default)] threads: Vec<GossipThread>,
    #[serde(default)] events:  Vec<GossipEvent>,
}

async fn gossip_receive(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GossipBody>,
) -> Result<Json<Value>, ApiError> {
    let auth  = headers.get("authorization").and_then(|h| h.to_str().ok()).unwrap_or("");
    let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
    if token.is_empty() { return Err(ApiError::Unauthorized); }
    if body.instance_slug.is_empty() || body.instance_url.is_empty() {
        return Err(ApiError::BadRequest("instance_slug and instance_url required".into()));
    }
    match body.instance_url.parse::<url::Url>() {
        Ok(u) if u.scheme() == "https" => {}
        _ => return Err(ApiError::BadRequest("invalid instance_url".into())),
    }
    sqlx::query(
        "SELECT id FROM directory_instances WHERE slug=$1 AND token=$2 AND status='active' LIMIT 1",
    )
    .bind(&body.instance_slug).bind(token)
    .fetch_optional(&state.db).await?.ok_or(ApiError::Forbidden)?;

    let mut indexed = 0u32;

    for t in &body.threads {
        let (Some(tid_str), Some(raw_title)) = (&t.thread_id, &t.title) else { continue };
        let tid: Uuid = match tid_str.parse() { Ok(u) => u, Err(_) => continue };
        let cid: Option<Uuid> = t.category_id.as_deref().and_then(|s| s.parse().ok());
        let title   = strip_html(raw_title, 200);
        let excerpt = strip_html(t.excerpt.as_deref().unwrap_or(""), 300);
        let tags: Vec<String> = t.tags.iter().map(|s| strip_html(s, 50)).collect();
        let replies: i32 = match &t.reply_count {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0) as i32,
            Some(Value::String(s)) => s.parse().unwrap_or(0),
            _ => 0,
        };
        sqlx::query(
            "INSERT INTO network_index
               (instance_slug, instance_url, content_type, content_id,
                thread_id, thread_slug, category_id, category_slug,
                title, excerpt, tags, reply_count, search_vector)
             VALUES ($1,$2,'thread',$3,$3,$4,$5,$6,$7,$8,$9::text[],$10,
                     to_tsvector('simple',$7||' '||$8||' '||array_to_string($9::text[],' ')))
             ON CONFLICT (instance_slug, content_type, content_id) DO UPDATE SET
               thread_slug=EXCLUDED.thread_slug, category_id=EXCLUDED.category_id,
               category_slug=EXCLUDED.category_slug, title=EXCLUDED.title,
               excerpt=EXCLUDED.excerpt, tags=EXCLUDED.tags, reply_count=EXCLUDED.reply_count,
               updated_at=NOW(), search_vector=EXCLUDED.search_vector",
        )
        .bind(&body.instance_slug).bind(&body.instance_url).bind(tid)
        .bind(&t.thread_slug).bind(cid).bind(&t.category_slug)
        .bind(&title).bind(&excerpt).bind(&tags).bind(replies)
        .execute(&state.db).await?;
        indexed += 1;
    }

    for e in &body.events {
        let (Some(eid_str), Some(raw_title), Some(starts_str)) =
            (&e.event_id, &e.title, &e.starts_at) else { continue };
        let eid: Uuid = match eid_str.parse() { Ok(u) => u, Err(_) => continue };
        let starts_at = match starts_str.parse::<chrono::DateTime<chrono::Utc>>() {
            Ok(t) => t, Err(_) => continue,
        };
        let ends_at = e.ends_at.as_deref().and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok());
        let title   = strip_html(raw_title, 200);
        let excerpt = strip_html(e.description.as_deref().unwrap_or(""), 300);
        let tags: Vec<String> = e.tags.iter().map(|s| strip_html(s, 50)).collect();
        sqlx::query(
            "INSERT INTO network_index
               (instance_slug, instance_url, content_type, content_id,
                title, excerpt, tags, starts_at, ends_at, location, is_cancelled, search_vector)
             VALUES ($1,$2,'event',$3,$4,$5,$6::text[],$7,$8,$9,$10,
                     to_tsvector('simple',$4||' '||$5||' '||array_to_string($6::text[],' ')))
             ON CONFLICT (instance_slug, content_type, content_id) DO UPDATE SET
               title=EXCLUDED.title, excerpt=EXCLUDED.excerpt, tags=EXCLUDED.tags,
               starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at,
               location=EXCLUDED.location, is_cancelled=EXCLUDED.is_cancelled,
               updated_at=NOW(), search_vector=EXCLUDED.search_vector",
        )
        .bind(&body.instance_slug).bind(&body.instance_url).bind(eid)
        .bind(&title).bind(&excerpt).bind(&tags)
        .bind(starts_at).bind(ends_at).bind(&e.location).bind(e.is_cancelled.unwrap_or(false))
        .execute(&state.db).await?;
        indexed += 1;
    }

    Ok(Json(json!({ "ok": true, "indexed": indexed })))
}

// ── GET /api/directory/search ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct DirectorySearchQuery {
    q: Option<String>, page: Option<String>, limit: Option<String>,
    #[serde(rename = "type")] typ: Option<String>,
    upcoming: Option<String>,
}

async fn search(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<DirectorySearchQuery>,
) -> Result<Json<Value>, ApiError> {
    let ip = client_ip(&headers, peer);
    let mut redis = state.redis.clone();
    rate_limit_search(&ip, &mut redis).await?;

    let typ = q.typ.as_deref().unwrap_or("all");
    if !["all", "thread", "event"].contains(&typ) {
        return Err(ApiError::BadRequest(
            "type invalide — valeurs acceptées : all, thread, event".into(),
        ));
    }
    let limit: i64 = q.limit.as_deref().and_then(|s| s.parse().ok())
        .map(|n: i64| n.min(50).max(1)).unwrap_or(20);
    let page: i64  = q.page.as_deref().and_then(|s| s.parse().ok())
        .map(|n: i64| n.max(1)).unwrap_or(1);
    let offset = (page - 1) * limit;
    let only_type     = if typ != "all" { Some(typ) } else { None };
    let only_upcoming = q.upcoming.as_deref() == Some("true");

    let rows: Vec<Value>;

    if let Some(qstr) = q.q.as_deref().filter(|s| !s.trim().is_empty()) {
        let mut sql = String::from(
            "SELECT ni.instance_slug, ni.instance_url, ni.content_type, ni.content_id,
                    ni.thread_id, ni.thread_slug, ni.category_id, ni.category_slug,
                    ni.title, ni.excerpt, ni.tags, ni.reply_count, ni.updated_at,
                    ni.starts_at, ni.ends_at, ni.location, ni.is_cancelled,
                    ts_rank(ni.search_vector, websearch_to_tsquery('simple', $1)) AS rank
             FROM network_index ni
             WHERE ni.search_vector @@ websearch_to_tsquery('simple', $1)",
        );
        let mut p = 1usize;
        if only_upcoming { sql.push_str(" AND (ni.content_type != 'event' OR ni.starts_at >= NOW())"); }
        if let Some(ot) = only_type {
            p += 1; sql.push_str(&format!(" AND ni.content_type = ${p}"));
            sql.push_str(&format!(" ORDER BY rank DESC, ni.reply_count DESC, ni.updated_at DESC LIMIT ${} OFFSET ${}", p+1, p+2));
            rows = sqlx::query(&sql).bind(qstr).bind(ot).bind(limit).bind(offset)
                .fetch_all(&state.db).await?.iter().map(row_to_result).collect();
        } else {
            sql.push_str(&format!(" ORDER BY rank DESC, ni.reply_count DESC, ni.updated_at DESC LIMIT ${} OFFSET ${}", p+1, p+2));
            rows = sqlx::query(&sql).bind(qstr).bind(limit).bind(offset)
                .fetch_all(&state.db).await?.iter().map(row_to_result).collect();
        }
    } else {
        let order_by = if only_type == Some("event") { "ni.starts_at ASC" } else { "ni.updated_at DESC" };
        let mut sql = format!(
            "SELECT ni.instance_slug, ni.instance_url, ni.content_type, ni.content_id,
                    ni.thread_id, ni.thread_slug, ni.category_id, ni.category_slug,
                    ni.title, ni.excerpt, ni.tags, ni.reply_count, ni.updated_at,
                    ni.starts_at, ni.ends_at, ni.location, ni.is_cancelled, 1.0::float8 AS rank
             FROM network_index ni WHERE 1=1"
        );
        let mut p = 0usize;
        if only_upcoming { sql.push_str(" AND (ni.content_type != 'event' OR ni.starts_at >= NOW())"); }
        if let Some(ot) = only_type {
            p += 1; sql.push_str(&format!(" AND ni.content_type = ${p}"));
            sql.push_str(&format!(" ORDER BY {order_by} LIMIT ${} OFFSET ${}", p+1, p+2));
            rows = sqlx::query(&sql).bind(ot).bind(limit).bind(offset)
                .fetch_all(&state.db).await?.iter().map(row_to_result).collect();
        } else {
            sql.push_str(&format!(" ORDER BY {order_by} LIMIT ${} OFFSET ${}", p+1, p+2));
            rows = sqlx::query(&sql).bind(limit).bind(offset)
                .fetch_all(&state.db).await?.iter().map(row_to_result).collect();
        }
    }

    Ok(Json(json!({ "results": rows, "query": q.q.as_deref().unwrap_or(""), "type": typ })))
}

fn row_to_result(r: &sqlx::postgres::PgRow) -> Value {
    json!({
        "instance_slug":  r.get::<String, _>("instance_slug"),
        "instance_url":   r.get::<String, _>("instance_url"),
        "content_type":   r.get::<String, _>("content_type"),
        "content_id":     r.get::<Option<Uuid>, _>("content_id"),
        "thread_id":      r.get::<Uuid, _>("thread_id"),
        "thread_slug":    r.get::<Option<String>, _>("thread_slug"),
        "category_id":    r.get::<Option<Uuid>, _>("category_id"),
        "category_slug":  r.get::<Option<String>, _>("category_slug"),
        "title":          r.get::<String, _>("title"),
        "excerpt":        r.get::<String, _>("excerpt"),
        "tags":           r.get::<Vec<String>, _>("tags"),
        "reply_count":    r.get::<i32, _>("reply_count"),
        "updated_at":     r.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
        "starts_at":      r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("starts_at"),
        "ends_at":        r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("ends_at"),
        "location":       r.get::<Option<String>, _>("location"),
        "is_cancelled":   r.get::<bool, _>("is_cancelled"),
        "rank":           r.get::<f64, _>("rank"),
    })
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/directory",                 get(list_instances))
        .route("/directory/register",        post(register))
        .route("/directory/ping",            post(ping))
        .route("/directory/:slug",           delete(unregister))
        .route("/directory/assets",          post(push_assets))
        .route("/directory/assets/search",   get(search_assets))
        .route("/directory/search/announce", post(announce))
        .route("/directory/gossip/receive",  post(gossip_receive))
        .route("/directory/search",          get(search))
}
