// Le fantôme démasqué (SPECS/NODYX_MENTIONS_CDC.md, D53, lot M3b).
//
// Te mentionner puis effacer aussitôt son message pour te faire chercher : un harcèlement
// classique. Si l'AUTEUR lui-même efface, dans les 10 minutes, un message qui mentionnait
// quelqu'un : les notifications restent (« … puis a supprimé son message »), le fait est
// noté, et le texte n'est gardé que si l'admin l'a choisi (réglage d'instance, effacé au
// bout de la durée). Une suppression par l'équipe n'est pas un fantôme.
import { db } from '../config/database'
import { io } from '../socket/io'
import * as NotificationModel from '../models/notification'
import { resolveMentions } from '../utils/mentions'
import { plainText } from './mentionNotify'

export const GHOST_WINDOW_S = 10 * 60
export const RETENTION_CHOICES = [0, 7, 30, 90] as const
const ROW_MAX_DAYS = 180   // le fait lui-même ne reste pas plus de six mois

export async function instanceSetting(key: string): Promise<string | null> {
  const { rows } = await db.query<{ value: string | null }>(`SELECT value FROM instance_settings WHERE key = $1`, [key]).catch(() => ({ rows: [] as { value: string | null }[] }))
  return rows[0]?.value ?? null
}

export async function retentionDays(): Promise<number> {
  const n = Number(await instanceSetting('mentions_ghost_retention_days'))
  return (RETENTION_CHOICES as readonly number[]).includes(n) ? n : 0
}

/**
 * À appeler AVANT d'effacer un message (chat) ou une réponse (forum), seulement quand
 * c'est son auteur qui efface. Rien si le message a plus de 10 minutes ou ne
 * mentionnait personne.
 */
export async function recordGhost(opts: {
  source: 'chat' | 'forum'; messageId: string; authorId: string; communityId: string
  html: string; createdAt: Date | string; channelId?: string | null; threadId?: string | null
}): Promise<boolean> {
  const age = (Date.now() - new Date(opts.createdAt).getTime()) / 1000
  if (!(age >= 0 && age <= GHOST_WINDOW_S)) return false
  const mentioned = (await resolveMentions(opts.html, opts.communityId).catch(() => [] as string[])).filter(id => id !== opts.authorId)
  if (!mentioned.length) return false
  const keep = (await retentionDays()) > 0
  await db.query(
    `INSERT INTO mention_ghosts (message_id, source, author_id, channel_id, thread_id, content, mentioned, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8)
     ON CONFLICT (message_id) DO NOTHING`,
    [opts.messageId, opts.source, opts.authorId, opts.channelId ?? null, opts.threadId ?? null,
     keep ? plainText(opts.html, 4000) : null, mentioned, new Date(opts.createdAt).toISOString()])
  const ghost = JSON.stringify({ ghost: true, deleted_after_s: Math.round(age) })
  const { rows } = opts.source === 'chat'
    // Une mention ISOLÉE est marquée sur place ; une rafale (count > 1) n'est pas touchée
    ? await db.query<{ user_id: string }>(
        `UPDATE notifications SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
         WHERE type = 'mention' AND meta->>'message_id' = $1 AND COALESCE((meta->>'count')::int, 1) = 1
         RETURNING user_id`, [opts.messageId, ghost])
    // Forum : la réponse va être EFFACÉE (ses notifications partiraient avec elle) ; on la
    // détache d'abord, en gardant son identifiant pour le signalement.
    : await db.query<{ user_id: string }>(
        `UPDATE notifications SET post_id = NULL,
           meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb || jsonb_build_object('post_id', $1::text)
         WHERE type = 'mention' AND post_id = $1 RETURNING user_id`, [opts.messageId, ghost])
  // Chat : une mention comptée dans une RAFALE n'a pas de notification à elle. Si la
  // personne a bien été prévenue (la rafale existe), le fantôme a sa propre notification.
  // Personne d'autre : une sourdine ou un réglage qui avait bloqué la mention restent respectés.
  if (opts.source === 'chat' && opts.channelId) {
    const done = new Set(rows.map(r => r.user_id))
    const rest = mentioned.filter(id => !done.has(id))
    if (rest.length) {
      const { rows: inBurst } = await db.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM notifications
         WHERE type = 'mention' AND actor_id = $1 AND user_id = ANY($2::uuid[]) AND meta->>'channel_id' = $3
           AND COALESCE((meta->>'count')::int, 1) > 1 AND created_at > NOW() - INTERVAL '30 minutes'`,
        [opts.authorId, rest, opts.channelId])
      for (const r of inBurst) {
        await NotificationModel.create({
          user_id: r.user_id, type: 'mention', actor_id: opts.authorId,
          meta: { channel_id: opts.channelId, message_id: opts.messageId, ghost: true, deleted_after_s: Math.round(age) },
        }).catch(() => {})
        rows.push(r)
      }
    }
  }
  if (io) {
    for (const r of rows) {
      const count = await NotificationModel.getUnreadCount(r.user_id).catch(() => 0)
      io.to(`user:${r.user_id}`).emit('notification:new', { unreadCount: count })
    }
  }
  return true
}

/** Efface les textes gardés au-delà de la durée choisie, et les faits de plus de six mois. */
export async function purgeGhosts(): Promise<void> {
  const days = await retentionDays()
  await db.query(`UPDATE mention_ghosts SET content = NULL WHERE content IS NOT NULL AND deleted_at < NOW() - make_interval(days => $1::int)`, [days])
  await db.query(`DELETE FROM mention_ghosts WHERE deleted_at < NOW() - make_interval(days => $1::int)`, [ROW_MAX_DAYS])
}

/** Pour un signalement : le fantôme d'un message, seulement pour une personne qu'il mentionnait. */
export async function ghostFor(messageId: string, reporterId: string): Promise<{ author_id: string | null; content: string | null; channel_id: string | null; thread_id: string | null; source: string } | null> {
  const { rows } = await db.query<{ author_id: string | null; content: string | null; channel_id: string | null; thread_id: string | null; source: string }>(
    `SELECT author_id, content, channel_id, thread_id, source FROM mention_ghosts WHERE message_id = $1 AND $2 = ANY(mentioned)`, [messageId, reporterId])
  return rows[0] ?? null
}
