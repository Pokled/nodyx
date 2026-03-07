/**
 * Scheduler — tâches périodiques de nexus-core
 * - Ping directory toutes les 5 minutes (membres + online)
 * - Push assets publics locaux → directory toutes les heures (v0.7 fédération)
 */
import { db } from './config/database'
import { Server } from 'socket.io'

const PING_INTERVAL_MS        = 5  * 60 * 1000  // 5 minutes
const ASSET_PUSH_INTERVAL_MS  = 60 * 60 * 1000  // 1 heure
const WHISPER_CLEANUP_MS      = 10 * 60 * 1000  // 10 minutes

// ── Ping directory ────────────────────────────────────────────────────────────

async function pingDirectory(io: Server) {
  const token = process.env.DIRECTORY_TOKEN
  if (!token) return

  try {
    const membersResult = await db.query('SELECT COUNT(*) AS count FROM users')
    const members = parseInt(membersResult.rows[0]?.count ?? '0', 10)
    const online  = io.sockets.sockets.size
    // SELF_URL = URL interne de CETTE instance (ex: http://127.0.0.1:3001)
    // DIRECTORY_API_URL = URL interne du directory principal (ex: http://127.0.0.1:3000)
    //   → pour l'instance principale les deux sont identiques
    //   → pour une instance secondaire sur le même VPS, DIRECTORY_API_URL pointe vers 3000
    //   → pour une instance distante, DIRECTORY_API_URL = https://nexusnode.app
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
      body: JSON.stringify({ assets }),
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

  console.log('[Scheduler] Démarré — ping directory 5min, assets push 1h, whisper cleanup 10min')
}
