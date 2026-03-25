/**
 * Scheduler — tâches périodiques de nexus-core
 * - Ping directory toutes les 5 minutes (membres + online)
 * - Push assets publics locaux → directory toutes les heures (v0.7 fédération)
 * - Announce threads au Global Search toutes les 10 min (SPEC 010, opt-in)
 */
import { db, redis } from './config/database'
import { Server } from 'socket.io'

const PING_INTERVAL_MS         = 5  * 60 * 1000        // 5 minutes
const ASSET_PUSH_INTERVAL_MS   = 60 * 60 * 1000        // 1 heure
const WHISPER_CLEANUP_MS       = 10 * 60 * 1000        // 10 minutes
const GLOBAL_INDEX_INTERVAL_MS = 10 * 60 * 1000        // 10 minutes
const NOTIF_PURGE_INTERVAL_MS  = 24 * 60 * 60 * 1000  // 24 heures
const BLOCKLIST_INTERVAL_MS    = 30 * 60 * 1000        // 30 minutes

// ── Ping directory ────────────────────────────────────────────────────────────

async function pingDirectory(io: Server) {
  const token = process.env.DIRECTORY_TOKEN
  if (!token) return

  try {
    const membersResult = await db.query('SELECT COUNT(*) AS count FROM users WHERE id NOT IN (SELECT user_id FROM community_bans)')
    const members = parseInt(membersResult.rows[0]?.count ?? '0', 10)
    // Deduplicate by userId — same approach as instance.ts online_count
    const presenceSockets = await io.in('presence').fetchSockets()
    const seen = new Set<string>()
    for (const s of presenceSockets) { if (s.data.userId) seen.add(s.data.userId) }
    const online = seen.size
    // SELF_URL = URL interne de CETTE instance (ex: http://127.0.0.1:3001)
    // DIRECTORY_API_URL = URL interne du directory principal (ex: http://127.0.0.1:3000)
    //   → pour l'instance principale les deux sont identiques
    //   → pour une instance secondaire sur le même VPS, DIRECTORY_API_URL pointe vers 3000
    //   → pour une instance distante, DIRECTORY_API_URL = https://nodyx.org
    const selfUrl      = (process.env.FRONTEND_URL ?? process.env.SELF_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const directoryUrl = (process.env.DIRECTORY_API_URL ?? process.env.SELF_URL ?? 'http://localhost:3000').replace(/\/$/, '')

    // Récupère le branding depuis la communauté locale
    const brandingResult = await db.query(
      `SELECT logo_url, banner_url FROM communities ORDER BY created_at ASC LIMIT 1`
    )
    const brandRow   = brandingResult.rows[0]
    const logo_url   = brandRow?.logo_url   ? `${selfUrl}${brandRow.logo_url}`   : null
    const banner_url = brandRow?.banner_url ? `${selfUrl}${brandRow.banner_url}` : null

    const res = await fetch(`${directoryUrl}/api/directory/ping`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, members, online, logo_url, banner_url }),
      signal:  AbortSignal.timeout(8_000),
    })

    if (res.ok) {
      console.log(`[Scheduler] Directory ping OK — ${members} membres, ${online} en ligne`)
    } else {
      console.warn(`[Scheduler] Directory ping failed: HTTP ${res.status}`)
    }
  } catch (err) {
    console.error('[Scheduler] Directory ping error:', err)
  }
}

// ── Push assets (v0.7 fédération) ────────────────────────────────────────────

async function pushAssetsToDirectory() {
  const token   = process.env.DIRECTORY_TOKEN
  const selfUrl = (process.env.FRONTEND_URL ?? process.env.SELF_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const apiBase = (process.env.SELF_URL ?? 'http://localhost:3000').replace(/\/$/, '')

  if (!token) return  // pas inscrit au directory, on skip

  try {
    const { rows } = await db.query<{
      id: string; asset_type: string; name: string; description: string | null;
      tags: string[]; file_hash: string; file_path: string;
      thumbnail_path: string | null; file_size: number; mime_type: string; downloads: number;
    }>(
      `SELECT id, asset_type, name, description, tags, file_hash,
              file_path, thumbnail_path, file_size, mime_type, downloads
       FROM community_assets
       WHERE is_public = true AND is_banned = false
       ORDER BY created_at DESC
       LIMIT 500`
    )

    if (rows.length === 0) return

    const base = selfUrl.replace(/\/$/, '')
    const assets = rows.map(a => ({
      id:            a.id,
      asset_type:    a.asset_type,
      name:          a.name,
      description:   a.description ?? undefined,
      tags:          a.tags,
      file_hash:     a.file_hash,
      file_url:      `${base}/uploads/${a.file_path}`,
      thumbnail_url: a.thumbnail_path ? `${base}/uploads/${a.thumbnail_path}` : undefined,
      file_size:     a.file_size,
      mime_type:     a.mime_type,
      downloads:     a.downloads,
    }))

    const res = await fetch(`${apiBase}/api/directory/assets`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body:   JSON.stringify({ assets }),
      signal: AbortSignal.timeout(15_000),
    })

    if (res.ok) {
      const json = await res.json() as { upserted: number; skipped: number }
      console.log(`[Scheduler] Assets push OK — ${json.upserted} upserted, ${json.skipped} skipped`)
    } else {
      console.warn(`[Scheduler] Assets push failed: HTTP ${res.status}`)
    }
  } catch (err) {
    console.error('[Scheduler] Assets push error:', err)
  }
}

// ── Global Search announce (SPEC 010) ─────────────────────────────────────────

export async function announceThreadsToDirectory() {
  if (!process.env.NODYX_GLOBAL_INDEXING || process.env.NODYX_GLOBAL_INDEXING !== 'true') return

  const token        = process.env.DIRECTORY_TOKEN
  const directoryUrl = (process.env.DIRECTORY_API_URL ?? 'https://nodyx.org').replace(/\/$/, '')
  if (!token) return

  try {
    const { rows } = await db.query<{
      id: string; slug: string | null; title: string; category_id: string; category_slug: string | null;
      excerpt: string | null; reply_count: number; tags: string[]
    }>(
      `SELECT t.id, t.slug, t.title, t.category_id, c.slug AS category_slug,
              LEFT(REGEXP_REPLACE(
                (SELECT p.content FROM posts p WHERE p.thread_id = t.id ORDER BY p.created_at ASC LIMIT 1),
                '<[^>]*>', '', 'g'
              ), 250) AS excerpt,
              (SELECT COUNT(*)::int FROM posts p WHERE p.thread_id = t.id) AS reply_count,
              ARRAY(
                SELECT tg.name FROM tags tg
                JOIN thread_tags tt ON tt.tag_id = tg.id
                WHERE tt.thread_id = t.id
              ) AS tags
       FROM threads t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.is_indexed = true
         AND (t.last_indexed_at IS NULL OR t.updated_at > t.last_indexed_at)
       LIMIT 100`
    )

    if (rows.length === 0) return

    const selfUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const slug    = process.env.NODYX_COMMUNITY_SLUG ?? 'unknown'

    const threads = rows.map(t => ({
      thread_id:     t.id,
      thread_slug:   t.slug,
      category_id:   t.category_id,
      category_slug: t.category_slug,
      title:         t.title,
      excerpt:       t.excerpt ?? '',
      tags:          t.tags,
      reply_count:   t.reply_count,
      instance_url:  selfUrl,
      instance_slug: slug,
    }))

    const res = await fetch(`${directoryUrl}/api/directory/search/announce`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, threads }),
      signal:  AbortSignal.timeout(10_000),
    })

    if (res.ok) {
      const ids = rows.map(r => r.id)
      await db.query(`UPDATE threads SET last_indexed_at = NOW() WHERE id = ANY($1)`, [ids])
      console.log(`[Scheduler] Global Search — ${ids.length} thread(s) annoncés`)

      // Gossip — propager aussi aux pairs directs
      await gossipToPeers({ instance_slug: slug, instance_url: selfUrl, threads })
    } else {
      console.warn(`[Scheduler] Global Search announce failed: HTTP ${res.status}`)
    }
  } catch (err) {
    console.error('[Scheduler] Global Search announce error:', err)
  }
}

// ── Announce events (Gossip Protocol) ────────────────────────────────────────

export async function announceEventsToDirectory() {
  if (!process.env.NODYX_GLOBAL_INDEXING || process.env.NODYX_GLOBAL_INDEXING !== 'true') return

  const token        = process.env.DIRECTORY_TOKEN
  const directoryUrl = (process.env.DIRECTORY_API_URL ?? 'https://nodyx.org').replace(/\/$/, '')
  if (!token) return

  try {
    const { rows } = await db.query<{
      id: string; title: string; description: string | null; location: string | null;
      starts_at: string; ends_at: string | null; tags: string[]; is_cancelled: boolean;
    }>(
      `SELECT id, title,
              LEFT(REGEXP_REPLACE(description, '<[^>]*>', '', 'g'), 250) AS description,
              location, starts_at, ends_at, tags, is_cancelled
       FROM events
       WHERE is_public = true
         AND is_cancelled = false
         AND (last_indexed_at IS NULL OR updated_at > last_indexed_at)
       LIMIT 50`
    )

    if (rows.length === 0) return

    const selfUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const slug    = process.env.NODYX_COMMUNITY_SLUG ?? 'unknown'

    const events = rows.map(e => ({
      event_id:      e.id,
      title:         e.title,
      description:   e.description ?? '',
      location:      e.location,
      starts_at:     e.starts_at,
      ends_at:       e.ends_at,
      tags:          e.tags,
      is_cancelled:  e.is_cancelled,
      instance_url:  selfUrl,
      instance_slug: slug,
    }))

    // ── Push au directory ──
    const res = await fetch(`${directoryUrl}/api/directory/gossip/receive`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ instance_slug: slug, instance_url: selfUrl, events }),
      signal:  AbortSignal.timeout(10_000),
    })

    if (res.ok) {
      const ids = rows.map(r => r.id)
      await db.query(`UPDATE events SET last_indexed_at = NOW() WHERE id = ANY($1)`, [ids])
      console.log(`[Scheduler] Events gossip → directory — ${ids.length} event(s)`)
    } else {
      console.warn(`[Scheduler] Events gossip failed: HTTP ${res.status}`)
    }

    // ── Propagation aux pairs gossip (GOSSIP_PEERS=url1,url2) ──
    await gossipToPeers({ instance_slug: slug, instance_url: selfUrl, events })

  } catch (err) {
    console.error('[Scheduler] Events gossip error:', err)
  }
}

// ── Gossip — propagation aux pairs directs ────────────────────────────────────

function isPrivatePeerUrl(rawUrl: string): boolean {
  try {
    const { hostname, protocol } = new URL(rawUrl)
    const h = hostname.toLowerCase()
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
    if (h.startsWith('192.168.') || h.startsWith('10.')) return true
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
    if (h.startsWith('169.254.') || h.startsWith('100.64.')) return true
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
    if (process.env.NODE_ENV === 'production' && protocol !== 'https:') return true
    return false
  } catch {
    return true // URL invalide → rejeter
  }
}

async function gossipToPeers(payload: {
  instance_slug: string; instance_url: string;
  threads?: any[]; events?: any[];
}) {
  const peersEnv = process.env.GOSSIP_PEERS ?? ''
  const peers    = peersEnv
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .filter(p => !isPrivatePeerUrl(p)) // Anti-SSRF : rejeter IPs privées
  if (peers.length === 0) return

  const selfToken = process.env.DIRECTORY_TOKEN ?? ''

  await Promise.allSettled(peers.map(async (peerUrl) => {
    try {
      const url = `${peerUrl.replace(/\/$/, '')}/api/directory/gossip/receive`
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${selfToken}` },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const json = await res.json() as { indexed: number }
        console.log(`[Gossip] → ${peerUrl} — ${json.indexed} item(s) propagé(s)`)
      } else {
        console.warn(`[Gossip] → ${peerUrl} — HTTP ${res.status}`)
      }
    } catch (err: any) {
      console.warn(`[Gossip] → ${peerUrl} — erreur: ${err.message}`)
    }
  }))
}

// ── Pull blocklist distribuée ─────────────────────────────────────────────────

async function pullBlocklist() {
  const directoryUrl = (process.env.DIRECTORY_API_URL ?? 'https://nodyx.org').replace(/\/$/, '')
  try {
    const res = await fetch(`${directoryUrl}/api/directory/blocklist`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[Scheduler] Blocklist pull failed: HTTP ${res.status}`)
      return
    }
    const json = await res.json() as { ips: string[]; count: number }
    if (!Array.isArray(json.ips)) return

    if (json.ips.length === 0) {
      await redis.del('blocklist')
      return
    }

    // Rebuild atomically: write to temp key then rename
    const tmpKey = `blocklist:tmp`
    await redis.del(tmpKey)
    const CHUNK = 500
    for (let i = 0; i < json.ips.length; i += CHUNK) {
      await redis.sadd(tmpKey, ...json.ips.slice(i, i + CHUNK))
    }
    await redis.rename(tmpKey, 'blocklist')
    await redis.expire('blocklist', 35 * 60)  // 35 min TTL (buffer over 30 min pull)

    if (json.count > 0) {
      console.log(`[Scheduler] Blocklist sync — ${json.count} IP(s) bloquée(s)`)
    }
  } catch (err: any) {
    console.warn('[Scheduler] Blocklist pull error:', err.message)
  }
}

// ── Purge tokens de vérification email expirés ───────────────────────────────

async function purgeExpiredEmailTokens() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM email_verification_tokens WHERE expires_at < NOW()`
    )
    if (rowCount && rowCount > 0) {
      console.log(`[Scheduler] Email tokens — ${rowCount} token(s) expiré(s) supprimé(s)`)
    }
  } catch {
    // Table may not exist on older instances — silently ignore
  }
}

// ── Purge abonnements push inactifs (> 30 jours) ─────────────────────────────

async function purgeInactivePushSubscriptions() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM push_subscriptions WHERE last_used_at < NOW() - INTERVAL '30 days'`
    )
    if (rowCount && rowCount > 0) {
      console.log(`[Scheduler] Push subs — ${rowCount} abonnement(s) inactif(s) supprimé(s)`)
    }
  } catch {
    // Table may not exist on older instances — silently ignore
  }
}

// ── Purge notifications lues (> 30 jours) ────────────────────────────────────

async function purgeOldNotifications() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - INTERVAL '30 days'`
    )
    if (rowCount && rowCount > 0) {
      console.log(`[Scheduler] Notifications — ${rowCount} notification(s) lue(s) de plus de 30j supprimée(s)`)
    }
  } catch (err) {
    console.error('[Scheduler] Notifications purge error:', err)
  }
}

// ── Whisper cleanup ───────────────────────────────────────────────────────────

async function cleanupWhisperRooms() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM whisper_rooms WHERE expires_at < NOW()`
    )
    if (rowCount && rowCount > 0) {
      console.log(`[Scheduler] Whisper cleanup — ${rowCount} room(s) expirée(s) supprimée(s)`)
    }
  } catch (err) {
    console.error('[Scheduler] Whisper cleanup error:', err)
  }
}

// ── Démarrage ─────────────────────────────────────────────────────────────────

export function startScheduler(io: Server) {
  // Ping directory
  setTimeout(() => pingDirectory(io), 10_000)
  setInterval(() => pingDirectory(io), PING_INTERVAL_MS)

  // Push assets → directory (30s au démarrage, puis toutes les heures)
  setTimeout(() => pushAssetsToDirectory(), 30_000)
  setInterval(() => pushAssetsToDirectory(), ASSET_PUSH_INTERVAL_MS)

  // Nettoyage des whisper rooms expirées (toutes les 10 min)
  setInterval(() => cleanupWhisperRooms(), WHISPER_CLEANUP_MS)

  // Purge des notifications lues de plus de 30 jours (toutes les 24h, 2min au démarrage)
  setTimeout(() => purgeOldNotifications(), 2 * 60 * 1000)
  setInterval(() => purgeOldNotifications(), NOTIF_PURGE_INTERVAL_MS)

  // Purge tokens email expirés + abonnements push inactifs (toutes les 24h)
  setTimeout(() => purgeExpiredEmailTokens(), 3 * 60 * 1000)
  setInterval(() => purgeExpiredEmailTokens(), NOTIF_PURGE_INTERVAL_MS)
  setTimeout(() => purgeInactivePushSubscriptions(), 4 * 60 * 1000)
  setInterval(() => purgeInactivePushSubscriptions(), NOTIF_PURGE_INTERVAL_MS)

  // Global Search + Gossip — announce threads + events (60s démarrage, toutes les 10 min)
  if (process.env.NODYX_GLOBAL_INDEXING === 'true') {
    setTimeout(() => announceThreadsToDirectory(), 60_000)
    setInterval(() => announceThreadsToDirectory(), GLOBAL_INDEX_INTERVAL_MS)

    setTimeout(() => announceEventsToDirectory(), 90_000)
    setInterval(() => announceEventsToDirectory(), GLOBAL_INDEX_INTERVAL_MS)
  }

  // Blocklist distribuée — pull toutes les 30min (45s au démarrage)
  setTimeout(() => pullBlocklist(), 45_000)
  setInterval(() => pullBlocklist(), BLOCKLIST_INTERVAL_MS)

  const hasPeers = (process.env.GOSSIP_PEERS ?? '').trim().length > 0
  console.log(
    '[Scheduler] Démarré — ping 5min, assets 1h, whisper 10min, global search 10min, notif purge 24h, blocklist 30min' +
    (hasPeers ? `, gossip peers: ${process.env.GOSSIP_PEERS}` : '')
  )
}
