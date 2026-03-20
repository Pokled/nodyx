import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { lookup } from 'dns';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import sanitizeHtml from 'sanitize-html';
import { db, redis } from '../config/database';

// Strict rate-limit for public search endpoint (30 req/min per IP)
async function searchRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = `rate:search:${request.ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  if (count > 30) {
    const ttl = await redis.ttl(key);
    reply.header('Retry-After', String(ttl));
    return reply.code(429).send({ error: 'Too many requests', code: 'RATE_LIMITED' });
  }
}

const dnsLookup = promisify(lookup);

const CF_BASE = 'https://api.cloudflare.com/client/v4';

async function cfRequest(method: string, path: string, body?: object) {
  const token = process.env.CF_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;
  if (!token || !zoneId) throw new Error('Cloudflare credentials missing');

  const url = `${CF_BASE}/zones/${zoneId}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
  if (h.startsWith('192.168.') || h.startsWith('10.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (h.startsWith('169.254.') || h.startsWith('100.64.')) return true
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  return false
}

async function checkUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      // Bloquer les adresses privées / loopback (anti-SSRF)
      if (isPrivateHostname(parsed.hostname)) return resolve(false);
      // En production, exiger HTTPS
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return resolve(false);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        { hostname: parsed.hostname, path: '/', method: 'HEAD', timeout: 5000 },
        (res) => { resolve((res.statusCode ?? 0) < 500); }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function createCloudflareSubdomain(slug: string, ip: string): Promise<string | null> {
  try {
    const data = await cfRequest('POST', '/dns_records', {
      type: 'A',
      name: `${slug}.nodyx.org`,
      content: ip,
      ttl: 1,
      proxied: true,
    });
    if (data.success) return data.result?.id ?? null;
    console.error('[Directory] CF error:', JSON.stringify(data.errors));
    return null;
  } catch (err) {
    console.error('[Directory] CF exception:', err);
    return null;
  }
}

async function deleteCloudflareRecord(recordId: string): Promise<void> {
  try {
    await cfRequest('DELETE', `/dns_records/${recordId}`);
  } catch (err) {
    console.error('[Directory] CF delete error:', err);
  }
}

export default async function directoryRoutes(app: FastifyInstance) {

  // ── Subdomain redirect ────────────────────────────────────────────────────
  // When a browser hits {slug}.nodyx.org, Caddy proxies the request here.
  // We look up the slug in directory_instances and redirect to the real URL.
  // This makes {slug}.nodyx.org a free vanity alias for any registered node.
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? ''
    // Match any subdomain of nodyx.org that isn't the root instance
    const match = host.match(/^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.nodyx\.org(:\d+)?$/i)
    if (!match) return  // not a subdomain — let the route handle it normally

    const slug = match[1].toLowerCase()
    // Ignore the main community slug — it serves this instance normally
    const mainSlug = process.env.NODYX_COMMUNITY_SLUG ?? 'nodyxnode'
    if (slug === mainSlug) return

    try {
      const { rows } = await db.query(
        `SELECT url FROM directory_instances WHERE slug = $1 AND status = 'active' LIMIT 1`,
        [slug]
      )
      if (rows[0]?.url) {
        // Valider le schéma avant redirection (prévention open redirect)
        if (!rows[0].url.startsWith('https://')) return
        // Preserve path + query so deep links work (e.g. community.nodyx.org/forum/thread/42)
        const target = rows[0].url.replace(/\/$/, '') + (req.url === '/' ? '' : req.url)
        return reply.redirect(target, 302)
      }
    } catch {
      // DB error — fall through to normal route handling
    }
  })

  // GET /api/directory — list active instances
  app.get('/directory', async (_req, reply) => {
    const result = await db.query(`
      SELECT id, slug, name, description, url, language, country, theme,
             members, online, version, status, last_seen, registered_at,
             logo_url, banner_url
      FROM directory_instances
      WHERE status = 'active'
        AND (
          last_seen IS NULL
          OR last_seen > NOW() - INTERVAL '15 minutes'
        )
      ORDER BY members DESC, registered_at ASC
    `);
    return reply.send({ instances: result.rows });
  });

  // POST /api/directory/register
  app.post<{
    Body: {
      name: string; slug: string; url: string;
      description?: string; language?: string;
      country?: string; theme?: string; version?: string;
    }
  }>('/directory/register', async (req, reply) => {
    const { name, slug, url, description, language = 'fr', country, theme, version } = req.body;

    if (!name || !slug || !url) {
      return reply.status(400).send({ error: 'name, slug and url are required' });
    }

    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
      return reply.status(400).send({ error: 'Invalid slug format (lowercase alphanumeric and hyphens, 3-63 chars)' });
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        return reply.status(400).send({ error: 'URL must use HTTPS' });
      }
    } catch {
      return reply.status(400).send({ error: 'Invalid URL' });
    }

    const existing = await db.query(
      'SELECT id FROM directory_instances WHERE slug = $1', [slug]
    );
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Slug already taken' });
    }

    const token = randomBytes(32).toString('hex');
    const subdomain = `${slug}.nodyx.org`;

    const result = await db.query(
      `INSERT INTO directory_instances
         (slug, name, description, url, language, country, theme, version, token, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       RETURNING id, slug, name, url, status, registered_at`,
      [slug, name, description ?? '', url, language, country ?? '', theme ?? '', version ?? '', token]
    );

    const instance = result.rows[0];

    // Async: create DNS record + activate immediately
    // URL reachability is NOT checked at registration time — the instance may be
    // mid-install (cert still being issued, Caddy warming up). Activation is instant;
    // the ping heartbeat keeps the directory up to date once the node is live.
    setImmediate(async () => {
      const vpsIp = process.env.VPS_IP;
      const hasCf  = !!(process.env.CF_TOKEN && process.env.CF_ZONE_ID);

      // Activate without DNS record if CF credentials or VPS_IP are missing
      if (!vpsIp || !hasCf) {
        const reason = !vpsIp ? 'VPS_IP not set' : 'CF credentials missing';
        console.warn(`[Directory] ${slug} — skipping DNS creation (${reason}), activating directly.`);
        await db.query(
          `UPDATE directory_instances SET status='active' WHERE id=$1`,
          [instance.id]
        ).catch(() => {});
        return;
      }

      try {
        const recordId = await createCloudflareSubdomain(slug, vpsIp);

        await db.query(
          `UPDATE directory_instances
           SET status='active', ip=$1, cloudflare_record_id=$2
           WHERE id=$3`,
          [vpsIp, recordId, instance.id]
        );

        console.log(`[Directory] ${slug} activated. CF record: ${recordId}`);
      } catch (err) {
        console.error(`[Directory] Activation error for ${slug}:`, err);
      }
    });

    return reply.status(201).send({
      message: 'Instance registered. DNS subdomain will be created within 30 seconds.',
      token,
      subdomain,
      instance,
    });
  });

  // POST /api/directory/ping — heartbeat
  app.post<{ Body: { token: string; members?: number; online?: number; logo_url?: string | null; banner_url?: string | null } }>(
    '/directory/ping',
    async (req, reply) => {
      const { token, members, online, logo_url, banner_url } = req.body;
      if (!token) return reply.status(400).send({ error: 'token required' });

      // Capture real IP — req.ip est fiable car Caddy écrase X-Forwarded-For
      // (CF-Connecting-IP n'est pas utilisé : non vérifiable sans liste IP Cloudflare)
      const rawIp = req.ip;
      const isPrivate = !rawIp || rawIp === '127.0.0.1' || rawIp === '::1'
        || rawIp.startsWith('192.168.') || rawIp.startsWith('10.')
        || rawIp.startsWith('172.16.') || rawIp.startsWith('::ffff:127.');
      const pingIp = isPrivate ? null : rawIp;

      const result = await db.query(
        `UPDATE directory_instances
         SET last_seen  = NOW(),
             members    = COALESCE($2, members),
             online     = COALESCE($3, online),
             logo_url   = COALESCE($4, logo_url),
             banner_url = COALESCE($5, banner_url),
             ip         = COALESCE($6, ip)
         WHERE token = $1
         RETURNING slug, status`,
        [token, members ?? null, online ?? null, logo_url ?? null, banner_url ?? null, pingIp]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Unknown token' });
      }

      return reply.send({ ok: true, slug: result.rows[0].slug, status: result.rows[0].status });
    }
  );

  // DELETE /api/directory/:slug — unregister
  app.delete<{ Params: { slug: string }; Body: { token: string } }>(
    '/directory/:slug',
    async (req, reply) => {
      const { slug } = req.params;
      const { token } = req.body ?? {};
      if (!token) return reply.status(400).send({ error: 'token required' });

      const result = await db.query(
        'SELECT id, cloudflare_record_id FROM directory_instances WHERE slug=$1 AND token=$2',
        [slug, token]
      );

      if (result.rows.length === 0) {
        return reply.status(403).send({ error: 'Invalid slug or token' });
      }

      const { id, cloudflare_record_id } = result.rows[0];
      if (cloudflare_record_id) await deleteCloudflareRecord(cloudflare_record_id);
      await db.query('DELETE FROM directory_instances WHERE id=$1', [id]);

      return reply.send({ ok: true });
    }
  );

  // ── v0.7 Federation — Asset federation ───────────────────────────────────

  // POST /api/directory/assets
  // Called by remote instances to announce (or refresh) their public asset catalogue.
  // Auth: instance registration token in Authorization header.
  // Body: { assets: AssetAnnouncement[] }
  app.post<{
    Body: {
      assets: Array<{
        id: string          // remote UUID
        asset_type: string
        name: string
        description?: string
        tags?: string[]
        file_hash: string
        file_url: string
        thumbnail_url?: string
        file_size?: number
        mime_type?: string
        downloads?: number
      }>
    }
  }>('/directory/assets', async (req, reply) => {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) return reply.status(401).send({ error: 'Authorization token required' });

    // Validate token → fetch instance
    const { rows: instanceRows } = await db.query(
      `SELECT id, slug FROM directory_instances WHERE token = $1 AND status = 'active'`,
      [token]
    );
    if (instanceRows.length === 0) {
      return reply.status(403).send({ error: 'Invalid or inactive instance token' });
    }
    const { id: instanceId, slug: instanceSlug } = instanceRows[0];

    const assets = req.body?.assets;
    if (!Array.isArray(assets) || assets.length === 0) {
      return reply.status(400).send({ error: 'assets array required' });
    }

    let upserted = 0;
    let skipped  = 0;

    for (const a of assets.slice(0, 500)) { // cap at 500 per push
      if (!a.id || !a.asset_type || !a.name || !a.file_hash || !a.file_url) {
        skipped++;
        continue;
      }

      // Determine canonical instance (first to announce this hash globally)
      const { rows: canonRows } = await db.query(
        `SELECT canonical_instance_id FROM directory_assets WHERE file_hash = $1 LIMIT 1`,
        [a.file_hash]
      );
      const canonicalId = canonRows[0]?.canonical_instance_id ?? instanceId;

      await db.query(
        `INSERT INTO directory_assets
           (instance_id, instance_slug, remote_asset_id, asset_type, name, description,
            tags, file_hash, file_url, thumbnail_url, file_size, mime_type,
            downloads, canonical_instance_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         ON CONFLICT (instance_id, remote_asset_id) DO UPDATE SET
           name             = EXCLUDED.name,
           description      = EXCLUDED.description,
           tags             = EXCLUDED.tags,
           file_url         = EXCLUDED.file_url,
           thumbnail_url    = EXCLUDED.thumbnail_url,
           file_size        = EXCLUDED.file_size,
           mime_type        = EXCLUDED.mime_type,
           downloads        = EXCLUDED.downloads,
           updated_at       = NOW()`,
        [
          instanceId, instanceSlug, a.id, a.asset_type, a.name,
          a.description ?? null, a.tags ?? [], a.file_hash,
          a.file_url, a.thumbnail_url ?? null, a.file_size ?? null,
          a.mime_type ?? null, a.downloads ?? 0, canonicalId,
        ]
      );
      upserted++;
    }

    return reply.send({ ok: true, upserted, skipped });
  });

  // GET /api/directory/assets/search
  // Public endpoint — search federated assets across all instances.
  // Query params: q, type, instance_slug, limit (max 50), offset
  app.get<{
    Querystring: { q?: string; type?: string; instance_slug?: string; limit?: string; offset?: string }
  }>('/directory/assets/search', async (req, reply) => {
    const { q, type, instance_slug, limit: lStr, offset: oStr } = req.query;
    const limit  = Math.min(parseInt(lStr  ?? '24', 10), 50);
    const offset = Math.min(Math.max(parseInt(oStr  ?? '0',  10), 0), 10_000);

    const conditions: string[] = [];
    const params: unknown[]    = [];

    if (type) {
      params.push(type);
      conditions.push(`da.asset_type = $${params.length}`);
    }
    if (instance_slug) {
      params.push(instance_slug);
      conditions.push(`da.instance_slug = $${params.length}`);
    }
    if (q) {
      params.push(q);
      conditions.push(`da.search_vector @@ plainto_tsquery('french', $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Order: FTS rank if query, else most recent
    const orderBy = q
      ? `ts_rank(da.search_vector, plainto_tsquery('french', $${params.indexOf(q) + 1})) DESC, da.announced_at DESC`
      : `da.announced_at DESC`;

    params.push(limit, offset);
    const limitClause  = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows: assets } = await db.query(
      `SELECT da.id, da.instance_id, da.instance_slug,
              da.remote_asset_id, da.asset_type, da.name, da.description,
              da.tags, da.file_hash, da.file_url, da.thumbnail_url,
              da.file_size, da.mime_type, da.downloads,
              da.canonical_instance_id, da.announced_at,
              di.name AS instance_name, di.url AS instance_url
       FROM directory_assets da
       JOIN directory_instances di ON di.id = da.instance_id AND di.status = 'active'
       ${where}
       ORDER BY ${orderBy}
       ${limitClause}`,
      params
    );

    // Total count (without limit)
    const countParams = params.slice(0, params.length - 2);
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total
       FROM directory_assets da
       JOIN directory_instances di ON di.id = da.instance_id AND di.status = 'active'
       ${where}`,
      countParams
    );

    return reply.send({
      assets,
      total: parseInt(countRows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // ── Global Search (SPEC 010) ──────────────────────────────────────────────

  // POST /api/directory/search/announce — instances push their public threads
  app.post<{ Body: { token: string; threads: any[] } }>(
    '/directory/search/announce',
    async (req, reply) => {
      const { token, threads } = req.body;
      if (!token) return reply.status(400).send({ error: 'token required' });

      const instance = await db.query(
        `SELECT slug, url FROM directory_instances WHERE token = $1 AND status = 'active' LIMIT 1`,
        [token]
      );
      if (!instance.rows[0]) return reply.status(403).send({ error: 'invalid token' });

      const { slug: instanceSlug, url: instanceUrl } = instance.rows[0];

      if (!Array.isArray(threads) || threads.length === 0) {
        return reply.send({ ok: true, indexed: 0 });
      }

      let indexed = 0;
      for (const t of threads) {
        if (!t.thread_id || !t.title) continue;
        const excerpt  = String(t.excerpt  ?? '').slice(0, 300);
        const tags     = Array.isArray(t.tags) ? t.tags.map(String) : [];
        const replies  = parseInt(t.reply_count ?? '0', 10) || 0;

        await db.query(
          `INSERT INTO network_index
             (instance_slug, instance_url, content_type, content_id,
              thread_id, thread_slug, category_id, category_slug,
              title, excerpt, tags, reply_count, search_vector)
           VALUES ($1, $2, 'thread', $3::uuid,
                   $3::uuid, $4, $5::uuid, $6,
                   $7, $8, $9::text[], $10,
                   to_tsvector('simple', $7 || ' ' || $8 || ' ' || array_to_string($9::text[], ' ')))
           ON CONFLICT (instance_slug, content_type, content_id) DO UPDATE SET
             thread_slug   = EXCLUDED.thread_slug,
             category_id   = EXCLUDED.category_id,
             category_slug = EXCLUDED.category_slug,
             title         = EXCLUDED.title,
             excerpt       = EXCLUDED.excerpt,
             tags          = EXCLUDED.tags,
             reply_count   = EXCLUDED.reply_count,
             updated_at    = NOW(),
             search_vector = EXCLUDED.search_vector`,
          [instanceSlug, instanceUrl, t.thread_id, t.thread_slug ?? null,
           t.category_id ?? null, t.category_slug ?? null, t.title, excerpt, tags, replies]
        );
        indexed++;
      }

      return reply.send({ ok: true, indexed });
    }
  );

  // ── POST /api/directory/gossip/receive — Gossip Protocol (peer-to-peer) ──
  // Une instance reçoit des données (threads + events) d'un autre pair,
  // les stocke dans son network_index local.
  // Requiert un token d'instance valide (Authorization: Bearer <token>).
  app.post<{ Body: { instance_slug: string; instance_url: string; threads?: any[]; events?: any[] } }>(
    '/directory/gossip/receive',
    async (req, reply) => {
      // Vérification du token d'instance
      const authHeader = req.headers['authorization'] ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return reply.status(401).send({ error: 'Authorization required' });

      const { instance_slug, instance_url, threads = [], events = [] } = req.body;
      if (!instance_slug || !instance_url) {
        return reply.status(400).send({ error: 'instance_slug and instance_url required' });
      }

      // Validation du schéma HTTPS + rejet des IPs privées (anti-SSRF / directory poisoning)
      try {
        const parsed = new URL(instance_url);
        if (parsed.protocol !== 'https:') throw new Error('https required');
        if (isPrivateHostname(parsed.hostname)) throw new Error('private ip');
      } catch {
        return reply.status(400).send({ error: 'invalid instance_url' });
      }

      // Vérifier que le token correspond à l'instance enregistrée
      const { rows: [inst] } = await db.query(
        `SELECT id FROM directory_instances WHERE slug = $1 AND token = $2 AND status = 'active' LIMIT 1`,
        [instance_slug, token]
      );
      if (!inst) return reply.status(403).send({ error: 'Invalid token or unknown instance' });

      let indexed = 0;

      // ── Threads ──
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const t of threads) {
        if (!t.thread_id || !t.title) continue;
        // Validate UUID format — PostgreSQL would throw otherwise, causing unhandled errors
        if (!UUID_RE.test(String(t.thread_id))) continue;
        if (t.category_id && !UUID_RE.test(String(t.category_id))) continue;
        // Sanitize : texte brut uniquement (strip HTML)
        const title   = sanitizeHtml(String(t.title), { allowedTags: [], allowedAttributes: {} }).slice(0, 200);
        const excerpt = sanitizeHtml(String(t.excerpt ?? ''), { allowedTags: [], allowedAttributes: {} }).slice(0, 300);
        const tags    = Array.isArray(t.tags)
          ? t.tags.slice(0, 20).map((tag: unknown) => String(tag).slice(0, 50))
          : [];
        const replies = parseInt(t.reply_count ?? '0', 10) || 0;

        await db.query(
          `INSERT INTO network_index
             (instance_slug, instance_url, content_type, content_id,
              thread_id, thread_slug, category_id, category_slug,
              title, excerpt, tags, reply_count, search_vector)
           VALUES ($1, $2, 'thread', $3::uuid,
                   $3::uuid, $4, $5::uuid, $6,
                   $7, $8, $9::text[], $10,
                   to_tsvector('simple', $7 || ' ' || $8 || ' ' || array_to_string($9::text[], ' ')))
           ON CONFLICT (instance_slug, content_type, content_id) DO UPDATE SET
             thread_slug   = EXCLUDED.thread_slug,
             category_id   = EXCLUDED.category_id,
             category_slug = EXCLUDED.category_slug,
             title         = EXCLUDED.title,
             excerpt       = EXCLUDED.excerpt,
             tags          = EXCLUDED.tags,
             reply_count   = EXCLUDED.reply_count,
             updated_at    = NOW(),
             search_vector = EXCLUDED.search_vector`,
          [instance_slug, instance_url, t.thread_id, t.thread_slug ?? null,
           t.category_id ?? null, t.category_slug ?? null, title, excerpt, tags, replies]
        );
        indexed++;
      }

      // ── Events ──
      for (const e of events) {
        if (!e.event_id || !e.title || !e.starts_at) continue;
        if (!UUID_RE.test(String(e.event_id))) continue;
        const title   = sanitizeHtml(String(e.title), { allowedTags: [], allowedAttributes: {} }).slice(0, 200);
        const excerpt = sanitizeHtml(String(e.description ?? ''), { allowedTags: [], allowedAttributes: {} }).slice(0, 300);
        const tags    = Array.isArray(e.tags) ? e.tags.map((tag: unknown) => sanitizeHtml(String(tag), { allowedTags: [], allowedAttributes: {} }).slice(0, 50)) : [];

        await db.query(
          `INSERT INTO network_index
             (instance_slug, instance_url, content_type, content_id,
              title, excerpt, tags, starts_at, ends_at, location, is_cancelled, search_vector)
           VALUES ($1, $2, 'event', $3::uuid,
                   $4, $5, $6::text[], $7::timestamptz, $8::timestamptz, $9, $10,
                   to_tsvector('simple', $4 || ' ' || $5 || ' ' || array_to_string($6::text[], ' ')))
           ON CONFLICT (instance_slug, content_type, content_id) DO UPDATE SET
             title        = EXCLUDED.title,
             excerpt      = EXCLUDED.excerpt,
             tags         = EXCLUDED.tags,
             starts_at    = EXCLUDED.starts_at,
             ends_at      = EXCLUDED.ends_at,
             location     = EXCLUDED.location,
             is_cancelled = EXCLUDED.is_cancelled,
             updated_at   = NOW(),
             search_vector = EXCLUDED.search_vector`,
          [instance_slug, instance_url, e.event_id,
           title, excerpt, tags,
           e.starts_at, e.ends_at ?? null, e.location ?? null, e.is_cancelled ?? false]
        );
        indexed++;
      }

      return reply.send({ ok: true, indexed });
    }
  );

  // GET /api/directory/search?q=&type=&upcoming=&page=&limit= — cross-instance search
  // type: 'all' | 'thread' | 'event'  (défaut: 'all')
  // upcoming: 'true' — filtre événements futurs uniquement
  app.get('/directory/search', { preHandler: [searchRateLimit] }, async (req, reply) => {
    const {
      q, page = '1', limit: rawLimit = '20',
      type = 'all', upcoming,
    } = req.query as Record<string, string>;

    const VALID_TYPES = ['all', 'thread', 'event'] as const;
    if (!VALID_TYPES.includes(type as any)) {
      return reply.code(400).send({ error: 'type invalide — valeurs acceptées : all, thread, event' });
    }

    const limit    = Math.min(parseInt(rawLimit, 10) || 20, 50);
    const offset   = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;
    const onlyType = type !== 'all' ? type : null;
    const onlyUpcoming = upcoming === 'true';

    let rows: any[];

    if (q?.trim()) {
      const params: unknown[] = [q.trim()];
      let sql = `SELECT ni.instance_slug, ni.instance_url, ni.content_type, ni.content_id,
                ni.thread_id, ni.thread_slug, ni.category_id, ni.category_slug,
                ni.title, ni.excerpt, ni.tags, ni.reply_count, ni.updated_at,
                ni.starts_at, ni.ends_at, ni.location, ni.is_cancelled,
                ts_rank(ni.search_vector, websearch_to_tsquery('simple', $1)) AS rank
         FROM network_index ni
         WHERE ni.search_vector @@ websearch_to_tsquery('simple', $1)`;
      if (onlyType) {
        params.push(onlyType);
        sql += ` AND ni.content_type = $${params.length}`;
      }
      if (onlyUpcoming) {
        sql += ` AND (ni.content_type != 'event' OR ni.starts_at >= NOW())`;
      }
      params.push(limit, offset);
      sql += ` ORDER BY rank DESC, ni.reply_count DESC, ni.updated_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const { rows: r } = await db.query(sql, params);
      rows = r;
    } else {
      // Sans query : threads triés par activité, events triés par date
      // orderBy est dérivé d'un booléen — jamais de l'input utilisateur
      const orderBy = onlyType === 'event' ? 'ni.starts_at ASC' : 'ni.updated_at DESC';
      const params: unknown[] = [];
      let sql = `SELECT ni.instance_slug, ni.instance_url, ni.content_type, ni.content_id,
                ni.thread_id, ni.thread_slug, ni.category_id, ni.category_slug,
                ni.title, ni.excerpt, ni.tags, ni.reply_count, ni.updated_at,
                ni.starts_at, ni.ends_at, ni.location, ni.is_cancelled,
                1.0 AS rank
         FROM network_index ni
         WHERE 1=1`;
      if (onlyType) {
        params.push(onlyType);
        sql += ` AND ni.content_type = $${params.length}`;
      }
      if (onlyUpcoming) {
        sql += ` AND (ni.content_type != 'event' OR ni.starts_at >= NOW())`;
      }
      params.push(limit, offset);
      sql += ` ORDER BY ${orderBy}
         LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const { rows: r } = await db.query(sql, params);
      rows = r;
    }

    return reply.send({ results: rows, query: q ?? null, type: type ?? 'all' });
  });
}
