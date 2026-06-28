import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { sanitize } from '../utils/sanitize'
import { awardPoints, REPUTATION } from '../models/reputation'
import { fetchLinkPreview } from '../services/linkPreview'

// Premier lien http(s) dans le contenu HTML (pour l'aperçu de lien).
function firstLink(html: string): string | null {
  return html.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/i)?.[1] ?? null
}
import { db } from '../config/database'
import { io } from '../socket/io'

const UPLOADS_DIR  = path.join(process.cwd(), 'uploads')
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  // Audio mémo (DM, social posts) : on accepte les formats que MediaRecorder
  // produit par défaut + ce que les browsers savent jouer en <audio>.
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav',
]
const AUDIO_MIME_PREFIX = 'audio/'

// ── Helpers ───────────────────────────────────────────────────────────────────

function postSelect(viewerParam: string | null) {
  return `
    sp.id, sp.content, sp.media_url, sp.link_preview, sp.reply_to_id, sp.created_at,
    -- Interactions calculées sur l'ORIGINAL effectif : un repartage partage les
    -- réactions/réponses de l'original (façon retweet), pas les siennes propres.
    (SELECT likes_count   FROM status_posts WHERE id = COALESCE(sp.reshare_of, sp.id)) AS likes_count,
    (SELECT replies_count FROM status_posts WHERE id = COALESCE(sp.reshare_of, sp.id)) AS replies_count,
    u.id AS author_id, u.username, p.display_name, p.avatar_url,
    ${viewerParam
      ? `EXISTS(SELECT 1 FROM status_likes sl WHERE sl.user_id = ${viewerParam} AND sl.post_id = COALESCE(sp.reshare_of, sp.id))`
      : 'false'} AS liked_by_me,
    ${viewerParam
      ? `(SELECT emoji FROM status_likes WHERE user_id = ${viewerParam} AND post_id = COALESCE(sp.reshare_of, sp.id))`
      : 'NULL'} AS my_reaction,
    (SELECT json_object_agg(emoji, jc) FROM (
       SELECT sl2.emoji,
              json_build_object('count', COUNT(*), 'users', json_agg(u2.username ORDER BY u2.username)) AS jc
       FROM status_likes sl2 JOIN users u2 ON u2.id = sl2.user_id
       WHERE sl2.post_id = COALESCE(sp.reshare_of, sp.id) GROUP BY sl2.emoji
     ) t) AS reactions,
    sp.reshare_of,
    (SELECT COUNT(*) FROM status_posts r WHERE r.reshare_of = COALESCE(sp.reshare_of, sp.id))::int AS reshares_count,
    ${viewerParam
      ? `EXISTS(SELECT 1 FROM status_posts r WHERE r.reshare_of = COALESCE(sp.reshare_of, sp.id) AND r.author_id = ${viewerParam})`
      : 'false'} AS reshared_by_me,
    CASE WHEN sp.reshare_of IS NOT NULL THEN (
      SELECT json_build_object(
        'id', o.id, 'content', o.content, 'media_url', o.media_url,
        'link_preview', o.link_preview, 'created_at', o.created_at,
        'author_id', o.author_id, 'username', ou.username,
        'display_name', op.display_name, 'avatar_url', op.avatar_url
      )
      FROM status_posts o JOIN users ou ON ou.id = o.author_id
      LEFT JOIN user_profiles op ON op.user_id = o.author_id
      WHERE o.id = sp.reshare_of
    ) ELSE NULL END AS reshared
  `
}

export default async function socialRoutes(app: FastifyInstance) {

  // ── Follow ────────────────────────────────────────────────────────────────

  app.post('/:username/follow', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { username } = request.params as { username: string }

    const target = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username])
    if (!target.rows[0]) return reply.code(404).send({ error: 'Utilisateur introuvable' })

    const targetId = target.rows[0].id
    if (targetId === userId) return reply.code(400).send({ error: 'Impossible de se suivre soi-même' })

    await db.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, targetId]
    )

    return reply.send({ ok: true })
  })

  app.delete('/:username/follow', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { username } = request.params as { username: string }

    const target = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username])
    if (!target.rows[0]) return reply.code(404).send({ error: 'Utilisateur introuvable' })

    await db.query(
      'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
      [userId, target.rows[0].id]
    )

    return reply.send({ ok: true })
  })

  // ── Followers / Following lists ───────────────────────────────────────────

  // GET /:username/is-following — check if authenticated user follows :username
  app.get('/:username/is-following', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { username } = request.params as { username: string }

    const result = await db.query(`
      SELECT EXISTS(
        SELECT 1 FROM follows f
        JOIN users u ON u.id = f.following_id
        WHERE f.follower_id = $1 AND LOWER(u.username) = LOWER($2)
      ) AS following
    `, [userId, username])

    return reply.send({ following: result.rows[0]?.following ?? false })
  })

  app.get('/:username/followers', { preHandler: [rateLimit] }, async (request, reply) => {
    const { username } = request.params as { username: string }
    const { offset = '0', limit = '20' } = request.query as { offset?: string; limit?: string }

    const result = await db.query(`
      SELECT u.id, u.username, p.display_name, p.avatar_url, f.created_at AS followed_at
      FROM follows f
      JOIN users u ON u.id = f.follower_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE f.following_id = (SELECT id FROM users WHERE LOWER(username) = LOWER($1))
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3
    `, [username, Math.min(50, parseInt(limit)), parseInt(offset)])

    return reply.send({ users: result.rows })
  })

  app.get('/:username/following', { preHandler: [rateLimit] }, async (request, reply) => {
    const { username } = request.params as { username: string }
    const { offset = '0', limit = '20' } = request.query as { offset?: string; limit?: string }

    const result = await db.query(`
      SELECT u.id, u.username, p.display_name, p.avatar_url, f.created_at AS followed_at
      FROM follows f
      JOIN users u ON u.id = f.following_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE f.follower_id = (SELECT id FROM users WHERE LOWER(username) = LOWER($1))
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3
    `, [username, Math.min(50, parseInt(limit)), parseInt(offset)])

    return reply.send({ users: result.rows })
  })

  // ── Status posts ──────────────────────────────────────────────────────────

  const statusSchema = z.object({
    content:     z.string().min(1).trim(),
    reply_to_id: z.string().uuid().optional(),
    media_url:   z.string().max(500).optional(),
  })

  app.post('/status', { preHandler: [rateLimit, requireAuth, validate({ body: statusSchema })] }, async (request, reply) => {
    const { userId } = request.user!
    const { content, reply_to_id, media_url } = request.body as z.infer<typeof statusSchema>

    // SÉCURITÉ : le contenu est rendu en {@html} (feed + profil). On le passe par
    // le sanitizer partagé (même allowlist que le forum) pour bloquer tout XSS
    // stocké (script, on*, src externes…).
    const safeContent = sanitize(content)
    if (!safeContent.trim()) {
      return reply.code(400).send({ error: 'Contenu vide après nettoyage.' })
    }

    // Verify parent exists if replying
    if (reply_to_id) {
      const parent = await db.query('SELECT id FROM status_posts WHERE id = $1', [reply_to_id])
      if (!parent.rows[0]) return reply.code(404).send({ error: 'Post parent introuvable' })
    }

    // Aperçu de lien : si le statut contient un lien et pas d'image attachée,
    // on récupère ses métadonnées Open Graph (fetch SSRF-safe, borné).
    let linkPreview = null
    if (!media_url) {
      const link = firstLink(safeContent)
      if (link) linkPreview = await fetchLinkPreview(link).catch(() => null)
    }

    const ins = await db.query(`
      INSERT INTO status_posts (author_id, content, reply_to_id, media_url, link_preview)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [userId, safeContent, reply_to_id ?? null, media_url ?? null, linkPreview ? JSON.stringify(linkPreview) : null])

    if (reply_to_id) {
      await db.query(
        'UPDATE status_posts SET replies_count = replies_count + 1 WHERE id = $1',
        [reply_to_id]
      )
    }

    // Réputation : poster un statut = +2 (participation au fil d'actu)
    await awardPoints(userId, REPUTATION.SOCIAL_POST)

    const post = await db.query(`
      SELECT ${postSelect('$2')}
      FROM status_posts sp
      JOIN users u ON u.id = sp.author_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE sp.id = $1
    `, [ins.rows[0].id, userId])

    // Temps réel : diffusion à TOUS les membres en ligne (room 'presence'),
    // pas seulement à l'auteur. Un post racine apparaît dans le fil ; une
    // réponse met à jour le compteur de réponses du parent.
    if (reply_to_id) {
      const rc = await db.query('SELECT replies_count FROM status_posts WHERE id = $1', [reply_to_id])
      io?.to('presence').emit('feed:count', { id: reply_to_id, replies_count: rc.rows[0]?.replies_count })
    } else {
      io?.to('presence').emit('feed:new', post.rows[0])
    }

    return reply.code(201).send(post.rows[0])
  })

  app.delete('/status/:id', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { id } = request.params as { id: string }

    const del = await db.query(`
      DELETE FROM status_posts WHERE id = $1 AND author_id = $2
      RETURNING id, reply_to_id
    `, [id, userId])

    if (!del.rows[0]) return reply.code(404).send({ error: 'Post introuvable ou non autorisé' })

    if (del.rows[0].reply_to_id) {
      await db.query(
        'UPDATE status_posts SET replies_count = GREATEST(0, replies_count - 1) WHERE id = $1',
        [del.rows[0].reply_to_id]
      )
    }

    // Réputation : suppression d'un statut = -2 (anti-farming)
    await awardPoints(userId, -REPUTATION.SOCIAL_POST)

    // Temps réel : retrait du post chez tous + MAJ compteur de réponses du parent
    io?.to('presence').emit('feed:delete', { id: del.rows[0].id })
    if (del.rows[0].reply_to_id) {
      const rc = await db.query('SELECT replies_count FROM status_posts WHERE id = $1', [del.rows[0].reply_to_id])
      io?.to('presence').emit('feed:count', { id: del.rows[0].reply_to_id, replies_count: rc.rows[0]?.replies_count })
    }

    return reply.send({ ok: true })
  })

  // ── Likes ─────────────────────────────────────────────────────────────────

  app.post('/status/:id/like', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { id } = request.params as { id: string }

    const ins = await db.query(`
      INSERT INTO status_likes (user_id, post_id) VALUES ($1, $2)
      ON CONFLICT DO NOTHING RETURNING post_id
    `, [userId, id])

    if (!ins.rows[0]) return reply.send({ ok: true }) // already liked

    const result = await db.query(
      'UPDATE status_posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count',
      [id]
    )

    io?.to('presence').emit('feed:count', { id, likes_count: result.rows[0]?.likes_count })
    return reply.send({ ok: true, likes_count: result.rows[0]?.likes_count })
  })

  app.delete('/status/:id/like', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { id } = request.params as { id: string }

    const del = await db.query(
      'DELETE FROM status_likes WHERE user_id = $1 AND post_id = $2 RETURNING post_id',
      [userId, id]
    )

    if (del.rows[0]) {
      const r = await db.query<{ likes_count: number }>(
        'UPDATE status_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = $1 RETURNING likes_count',
        [id]
      )
      io?.to('presence').emit('feed:count', { id, likes_count: r.rows[0]?.likes_count })
    }

    return reply.send({ ok: true })
  })

  // ── Réactions emoji ─────────────────────────────────────────────────────────
  // Une réaction par membre/post (modifiable). Set restreint (pas de contenu
  // arbitraire). likes_count = total toutes emojis.
  const ALLOWED_REACTIONS = new Set(['❤️', '👍', '😂', '🔥', '😮', '🎉'])

  app.post('/status/:id/react', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { id } = request.params as { id: string }
    const { emoji } = (request.body ?? {}) as { emoji?: string }
    if (!emoji || !ALLOWED_REACTIONS.has(emoji)) {
      return reply.code(400).send({ error: 'Réaction non autorisée' })
    }
    // xmax = 0 dans le RETURNING => ligne fraîchement INSÉRÉE (sinon UPDATE de l'emoji).
    const up = await db.query<{ inserted: boolean }>(`
      INSERT INTO status_likes (user_id, post_id, emoji) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, post_id) DO UPDATE SET emoji = EXCLUDED.emoji
      RETURNING (xmax = 0) AS inserted
    `, [userId, id, emoji])

    let likes_count: number | undefined
    if (up.rows[0]?.inserted) {
      const r = await db.query<{ likes_count: number }>(
        'UPDATE status_posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count',
        [id]
      )
      likes_count = r.rows[0]?.likes_count
      io?.to('presence').emit('feed:count', { id, likes_count })
    }
    return reply.send({ ok: true, likes_count })
  })

  // ── Repartage ───────────────────────────────────────────────────────────────
  app.post('/status/:id/reshare', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { id } = request.params as { id: string }

    const orig = await db.query<{ id: string; reshare_of: string | null }>(
      'SELECT id, reshare_of FROM status_posts WHERE id = $1', [id]
    )
    if (!orig.rows[0]) return reply.code(404).send({ error: 'Post introuvable' })
    // Repartager un repartage cible l'original.
    const targetId = orig.rows[0].reshare_of ?? id

    // Toggle : si je l'ai déjà repartagé, on retire.
    const existing = await db.query(
      'SELECT id FROM status_posts WHERE author_id = $1 AND reshare_of = $2',
      [userId, targetId]
    )
    const emitReshareCount = async () => {
      const c = await db.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM status_posts WHERE reshare_of = $1', [targetId]
      )
      io?.to('presence').emit('feed:count', { id: targetId, reshares_count: c.rows[0]?.n })
    }

    if (existing.rows[0]) {
      await db.query('DELETE FROM status_posts WHERE id = $1', [existing.rows[0].id])
      await emitReshareCount()
      return reply.send({ ok: true, reshared: false })
    }
    await db.query(
      "INSERT INTO status_posts (author_id, content, reshare_of) VALUES ($1, '', $2)",
      [userId, targetId]
    )
    await emitReshareCount()
    return reply.send({ ok: true, reshared: true })
  })

  // ── Feed & user posts ─────────────────────────────────────────────────────

  // GET /feed — personalized timeline (posts from followed users + self)
  app.get('/feed', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.user!
    const { before, limit = '20', scope = 'discover' } = request.query as { before?: string; limit?: string; scope?: string }

    const lim    = Math.min(50, parseInt(limit))
    const params: unknown[] = [userId, lim]
    let   cursor = ''

    if (before) {
      params.push(before)
      cursor = `AND sp.created_at < $${params.length}`
    }

    // scope=following : moi + mes abonnements. scope=discover (défaut) : tous les
    // posts récents de la communauté (les status sont publics). $1 reste le viewer
    // (utilisé par postSelect pour le statut "j'aime").
    const authorFilter = scope === 'following'
      ? `AND (sp.author_id = $1 OR sp.author_id IN (SELECT following_id FROM follows WHERE follower_id = $1))`
      : ''

    const result = await db.query(`
      SELECT ${postSelect('$1')}
      FROM status_posts sp
      JOIN users u ON u.id = sp.author_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE sp.reply_to_id IS NULL
        ${authorFilter}
        ${cursor}
      ORDER BY sp.created_at DESC
      LIMIT $2
    `, params)

    return reply.send({ posts: result.rows })
  })

  // GET /:username/posts — public posts of a given user
  app.get('/:username/posts', { preHandler: [rateLimit] }, async (request, reply) => {
    const { username } = request.params as { username: string }
    const { before, limit = '20' } = request.query as { before?: string; limit?: string }
    // Best-effort viewer ID (no auth required)
    const viewerId = (request as any).user?.userId ?? null

    const lim    = Math.min(50, parseInt(limit))
    const params: unknown[] = [username, lim]
    let   cursor = ''

    if (before) {
      params.push(before)
      cursor = `AND sp.created_at < $${params.length}`
    }

    // Re-build postSelect with concrete param index
    const likedExpr = viewerId
      ? `EXISTS(SELECT 1 FROM status_likes sl WHERE sl.user_id = '${viewerId}' AND sl.post_id = sp.id)`
      : 'false'

    const result = await db.query(`
      SELECT
        sp.id, sp.content, sp.media_url, sp.reply_to_id,
        sp.likes_count, sp.replies_count, sp.created_at,
        u.id AS author_id, u.username, p.display_name, p.avatar_url,
        ${likedExpr} AS liked_by_me
      FROM status_posts sp
      JOIN users u ON u.id = sp.author_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE LOWER(u.username) = LOWER($1) AND sp.reply_to_id IS NULL
      ${cursor}
      ORDER BY sp.created_at DESC
      LIMIT $2
    `, params)

    return reply.send({ posts: result.rows })
  })

  // GET /status/:id — single post with replies
  app.get('/status/:id', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const viewerId = request.user?.userId ?? null

    const postParams: unknown[] = [id]
    let viewerRef = 'NULL'
    if (viewerId) { postParams.push(viewerId); viewerRef = `$${postParams.length}` }

    const postRes = await db.query(`
      SELECT ${postSelect(viewerRef)}
      FROM status_posts sp
      JOIN users u ON u.id = sp.author_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE sp.id = $1
    `, postParams)

    if (!postRes.rows[0]) return reply.code(404).send({ error: 'Post introuvable' })

    const replyParams: unknown[] = [id]
    let viewerRef2 = 'NULL'
    if (viewerId) { replyParams.push(viewerId); viewerRef2 = `$${replyParams.length}` }

    const repliesRes = await db.query(`
      SELECT ${postSelect(viewerRef2)}
      FROM status_posts sp
      JOIN users u ON u.id = sp.author_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE sp.reply_to_id = $1
      ORDER BY sp.created_at ASC
      LIMIT 50
    `, replyParams)

    return reply.send({ post: postRes.rows[0], replies: repliesRes.rows })
  })

  // ── Media upload for posts ────────────────────────────────────────────────

  app.post('/upload', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'Aucun fichier reçu' })
    if (!ALLOWED_MIME.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Format non supporté (jpeg, png, webp, gif)' })
    }

    const buf = await data.toBuffer()
    if (buf.length > 8 * 1024 * 1024) return reply.code(400).send({ error: 'Fichier trop lourd (max 8 Mo)' })

    const isAudio = data.mimetype.startsWith(AUDIO_MIME_PREFIX)
    const isGif   = data.mimetype === 'image/gif'

    let ext: string
    if (isAudio) {
      ext = data.mimetype === 'audio/mpeg' ? 'mp3'
          : data.mimetype === 'audio/mp4'  ? 'm4a'
          : data.mimetype === 'audio/wav'  ? 'wav'
          : data.mimetype === 'audio/ogg'  ? 'ogg'
          : 'webm'  // audio/webm par défaut (MediaRecorder)
    } else {
      ext = isGif ? 'gif' : 'webp'
    }

    const fname = `${randomUUID()}.${ext}`
    const dir   = path.join(UPLOADS_DIR, 'posts')
    mkdirSync(dir, { recursive: true })

    const final = isAudio
      ? buf  // pas de transcodage audio (pas de ffmpeg en deps), on stocke tel quel
      : isGif
        ? buf
        : await sharp(buf).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()

    await writeFile(path.join(dir, fname), final)
    return reply.send({ url: `/uploads/posts/${fname}`, kind: isAudio ? 'audio' : 'image' })
  })
}
