/**
 * OctoGuard 2, cran « Retenir » (CDC E4h, lot 2, D17).
 *
 * Un contenu retenu n'est jamais écrit dans channel_messages / posts /
 * threads : il attend dans octoguard_held. Personne ne le voit, sauf son
 * auteur (« en attente de validation ») et l'équipe (file « À relire »).
 * À l'approbation, il est publié pour de vrai, par les mêmes modèles que la
 * publication normale. Au refus, ou après 72 h sans décision, il est jeté et
 * l'auteur est prévenu.
 *
 * Toutes les décisions passent par un UPDATE … WHERE status = 'pending'
 * RETURNING : deux membres de l'équipe qui cliquent en même temps ne publient
 * jamais deux fois le même message.
 */

import { randomUUID } from 'crypto'
import { db, redis } from '../../config/database'
import * as ChannelModel from '../../models/channel'
import * as PostModel from '../../models/post'
import * as ThreadModel from '../../models/thread'
import * as TagModel from '../../models/tag'
import * as NotificationModel from '../../models/notification'
import { awardPoints, REPUTATION } from '../../models/reputation'
import { io } from '../../socket/io'
import { logOctoGuardAction } from './logger'
import { purgeOldEdits, EDITS_RETENTION_DAYS } from './context'
import { announceThread } from '../webhooks/announce'

/** D17 : un contenu retenu sans décision est refusé au bout de 72 h. */
export const HELD_EXPIRY_HOURS = 72
/** Au-delà, un auteur ne peut plus rien mettre en attente : sa file est pleine
 *  et l'envoi est refusé. Empêche un compte de noyer l'équipe sous la relecture. */
export const HELD_MAX_PENDING_PER_AUTHOR = 5
/** Le texte d'un contenu refusé ou expiré n'est pas gardé : effacé 30 jours après la décision. */
export const HELD_RETENTION_DAYS = 30

export type HeldKind = 'chat' | 'post' | 'thread' | 'post_edit'

export interface HeldPayload {
  content:      string
  title?:       string
  reply_to_id?: string | null
  tag_ids?:     string[]
}

export interface HoldInput {
  kind:        HeldKind
  authorId:    string
  channelId?:  string | null
  threadId?:   string | null
  postId?:     string | null
  categoryId?: string | null
  payload:     HeldPayload
  /** rule_id vide : mis de côté par le bouclier anti-raid (rule_name « shield »), pas par une règle. */
  rule:        { rule_id: string | null; rule_name: string; excerpt: string }
}

export interface HeldRow {
  id:           string
  kind:         HeldKind
  author_id:    string
  channel_id:   string | null
  thread_id:    string | null
  post_id:      string | null
  category_id:  string | null
  payload:      HeldPayload
  rule_id:      string | null
  rule_name:    string
  excerpt:      string
  status:       'pending' | 'approved' | 'refused' | 'expired'
  decided_by:   string | null
  decided_at:   string | null
  published_id: string | null
  created_at:   string
}

/** Ce que l'auteur voit de son propre contenu en attente (jamais le nom de la règle, D20). */
export function forAuthor(r: HeldRow) {
  return {
    id: r.id, kind: r.kind, channel_id: r.channel_id, thread_id: r.thread_id, post_id: r.post_id,
    category_id: r.category_id, content: r.payload.content, title: r.payload.title ?? null,
    reply_to_id: r.payload.reply_to_id ?? null, status: r.status, created_at: r.created_at,
  }
}

export type HoldResult = { ok: true; row: HeldRow } | { ok: false; code: 'HELD_LIMIT' | 'HOLD_FAILED' }

/**
 * Met un contenu de côté. Ne lève jamais. L'appelant ne publie JAMAIS sur un
 * échec (ok: false) : un contenu qu'une règle voulait retenir n'est pas publié
 * parce que la base a eu un hoquet (on refuse l'envoi, l'auteur réessaiera).
 */
export async function holdContent(input: HoldInput): Promise<HoldResult> {
  let row: HeldRow | null = null
  try {
    // Insertion conditionnelle : pas plus de N contenus en attente par auteur
    const { rows } = await db.query<HeldRow>(
      `INSERT INTO octoguard_held (kind, author_id, channel_id, thread_id, post_id, category_id, payload, rule_id, rule_name, excerpt)
       SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10
        WHERE (SELECT COUNT(*) FROM octoguard_held WHERE author_id = $2 AND status = 'pending') < $11
       RETURNING *`,
      [input.kind, input.authorId, input.channelId ?? null, input.threadId ?? null, input.postId ?? null,
       input.categoryId ?? null, JSON.stringify(input.payload), input.rule.rule_id, input.rule.rule_name, input.rule.excerpt,
       HELD_MAX_PENDING_PER_AUTHOR]
    )
    row = rows[0] ?? null
  } catch (err) {
    console.warn('[octoguard:held] hold failed, refusing the content:', err)
    return { ok: false, code: 'HOLD_FAILED' }
  }
  if (!row) return { ok: false, code: 'HELD_LIMIT' }
  // Une vague de messages retenus peut annoncer un raid (bouclier, lot 6)
  void import('./shield').then((m) => m.recordHeld()).catch(() => {})
  {
    logOctoGuardAction({
      action:       'octoguard.message_held',
      target_type:  'user',
      target_id:    input.authorId,
      target_label: input.rule.excerpt,
      metadata:     { event_id: randomUUID(), ...(input.rule.rule_id ? { rule_id: input.rule.rule_id } : {}), rule_name: input.rule.rule_name, held_id: row.id, kind: input.kind, actor: 'octoguard:auto', would_be: false },
    })
  }
  return { ok: true, row }
}

/** Corps de refus quand la mise en attente n'a pas pu se faire (jamais de publication). */
export function holdRefusal(code: 'HELD_LIMIT' | 'HOLD_FAILED') {
  return code === 'HELD_LIMIT'
    ? { error: 'Too many messages awaiting review', code: 'OCTOGUARD_HELD_LIMIT', i18n_key: 'octoguard.held_limit' }
    : { error: 'Could not hold the message for review', code: 'OCTOGUARD_BLOCKED', i18n_key: 'octoguard.blocked' }
}

export async function listPending(limit = 100): Promise<Array<HeldRow & { author_username: string; author_created_at: string; channel_name: string | null; thread_title: string | null }>> {
  const { rows } = await db.query(
    `SELECT h.*, u.username AS author_username, u.created_at AS author_created_at, ch.name AS channel_name, t.title AS thread_title
       FROM octoguard_held h
       JOIN users u ON u.id = h.author_id
       LEFT JOIN channels ch ON ch.id = h.channel_id
       LEFT JOIN threads  t  ON t.id  = h.thread_id
      WHERE h.status = 'pending'
      ORDER BY h.created_at ASC
      LIMIT $1`,
    [limit]
  )
  return rows as any
}

export async function countPending(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM octoguard_held WHERE status = 'pending'`)
  return rows[0]?.n ?? 0
}

/** Contenus en attente d'un auteur, pour un salon ou un fil donné. */
export async function listMine(authorId: string, where: { channelId?: string; threadId?: string }): Promise<HeldRow[]> {
  const { rows } = await db.query<HeldRow>(
    `SELECT * FROM octoguard_held
      WHERE author_id = $1 AND status = 'pending'
        AND ($2::uuid IS NULL OR channel_id = $2::uuid)
        AND ($3::uuid IS NULL OR thread_id  = $3::uuid)
      ORDER BY created_at ASC
      LIMIT 50`,
    [authorId, where.channelId ?? null, where.threadId ?? null]
  )
  return rows
}

/** Prend la décision de façon atomique. null = déjà décidé (ou inexistant). */
async function claim(id: string, status: 'approved' | 'refused' | 'expired', actorId: string | null): Promise<HeldRow | null> {
  const { rows } = await db.query<HeldRow>(
    `UPDATE octoguard_held SET status = $2, decided_by = $3, decided_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [id, status, actorId]
  )
  return rows[0] ?? null
}

export type PublishBlock = 'AUTHOR_BANNED' | 'THREAD_LOCKED' | 'PUBLISH_FAILED'

/**
 * Ce qui a pu changer depuis la mise en attente : l'auteur a été banni, le fil
 * a été verrouillé. Approuver ne doit pas contourner ces décisions.
 */
async function blockedNow(h: HeldRow): Promise<PublishBlock | null> {
  const { rows } = await db.query<{ banned: boolean; locked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM community_bans cb WHERE cb.user_id = $1
                     AND (cb.expires_at IS NULL OR cb.expires_at > NOW())) AS banned,
            COALESCE((SELECT t.is_locked FROM threads t WHERE t.id = $2), false) AS locked`,
    [h.author_id, h.thread_id]
  )
  if (rows[0]?.banned) return 'AUTHOR_BANNED'
  if (rows[0]?.locked && (h.kind === 'post' || h.kind === 'post_edit')) return 'THREAD_LOCKED'
  return null
}

/** Effet secondaire d'une publication (points, notification, étiquettes, cache) :
 *  son échec ne doit JAMAIS faire croire que rien n'a été publié. */
async function sideEffect(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn() } catch (err) { console.warn(`[octoguard:held] ${label} failed after publishing (kept):`, err) }
}

/**
 * Publie pour de vrai ce qui était retenu. Renvoie l'identifiant publié, ou
 * null si RIEN n'a été écrit. Règle : dès que le message (ou le fil) existe, la
 * publication est acquise ; tout ce qui suit est au mieux. Avant (relu le
 * 07/11), une erreur sur les points de réputation après la création renvoyait
 * « rien publié », le contenu repassait en attente et une seconde approbation
 * le publiait DEUX fois.
 */
async function publish(h: HeldRow): Promise<string | null> {
  const p = h.payload
  if (h.kind === 'chat' && h.channel_id) {
    const message = await ChannelModel.addMessage({
      channel_id: h.channel_id, author_id: h.author_id, content: p.content, reply_to_id: p.reply_to_id ?? null,
    })
    io?.to(`channel:${h.channel_id}`).emit('chat:message', message)
    return message.id
  }
  if (h.kind === 'post' && h.thread_id) {
    const thread = await ThreadModel.findById(h.thread_id)
    if (!thread) return null
    const post = await PostModel.create({ thread_id: h.thread_id, author_id: h.author_id, content: p.content })
    await sideEffect('cache', async () => { await redis.incr('threads:cache:ver') })
    await sideEffect('reputation', () => awardPoints(h.author_id, REPUTATION.REPLY))
    if (thread.author_id !== h.author_id) {
      await sideEffect('notification', () => NotificationModel.create({ user_id: thread.author_id, type: 'thread_reply', actor_id: h.author_id, thread_id: thread.id, post_id: post.id }))
    }
    return post.id
  }
  if (h.kind === 'thread' && h.category_id && p.title) {
    const thread = await ThreadModel.create({ category_id: h.category_id, author_id: h.author_id, title: p.title })
    try {
      await PostModel.create({ thread_id: thread.id, author_id: h.author_id, content: p.content })
    } catch (err) {
      // Un fil sans son premier message ne doit pas rester : on le retire, rien n'est publié
      await ThreadModel.remove(thread.id).catch(() => {})
      throw err
    }
    if (p.tag_ids?.length) await sideEffect('tags', () => TagModel.setThreadTags(thread.id, p.tag_ids!))
    await sideEffect('cache', async () => { await redis.incr('threads:cache:ver') })
    await sideEffect('reputation', () => awardPoints(h.author_id, REPUTATION.THREAD))
    // Webhooks : le fil retenu est maintenant publié, il peut s'annoncer
    announceThread(thread.id)
    return thread.id
  }
  if (h.kind === 'post_edit' && h.post_id) {
    const post = await PostModel.updateContent(h.post_id, p.content, h.author_id)
    await sideEffect('cache', async () => { await redis.incr('threads:cache:ver') })
    return post?.id ?? null
  }
  return null
}

function tellAuthor(h: HeldRow, outcome: 'approved' | 'refused' | 'expired', publishedId: string | null) {
  io?.to(`user:${h.author_id}`).emit('octoguard:held_decided', {
    id: h.id, kind: h.kind, outcome, channel_id: h.channel_id, thread_id: h.thread_id, published_id: publishedId,
  })
  void NotificationModel.create({
    user_id:   h.author_id,
    type:      outcome === 'approved' ? 'held_approved' : 'held_refused',
    thread_id: h.kind === 'thread' && outcome === 'approved' ? publishedId : h.thread_id,
    meta:      { kind: h.kind, excerpt: h.payload.content.slice(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120), expired: outcome === 'expired' },
  }).then(async () => {
    const count = await NotificationModel.getUnreadCount(h.author_id).catch(() => 0)
    io?.to(`user:${h.author_id}`).emit('notification:new', { unreadCount: count })
  }).catch(() => {})
}

export type DecideResult =
  | { ok: true; held: HeldRow; published_id: string | null }
  | { ok: false; code: 'ALREADY_DECIDED' | PublishBlock }

export async function approveHeld(id: string, actor: { id: string; username: string }): Promise<DecideResult> {
  const h = await claim(id, 'approved', actor.id)
  if (!h) return { ok: false, code: 'ALREADY_DECIDED' }
  let publishedId: string | null = null
  let block: PublishBlock | null = null
  try {
    block = await blockedNow(h)
    if (!block) publishedId = await publish(h)
  } catch (err) {
    console.warn('[octoguard:held] publish failed:', err)
  }
  if (!publishedId) {
    // Rien n'a été publié (auteur banni, fil verrouillé, salon supprimé) : on remet en attente
    await db.query(`UPDATE octoguard_held SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = $1`, [id])
    return { ok: false, code: block ?? 'PUBLISH_FAILED' }
  }
  await db.query(`UPDATE octoguard_held SET published_id = $2 WHERE id = $1`, [id, publishedId])
  logOctoGuardAction({
    action: 'octoguard.held_approved', actor_id: actor.id,
    target_type: 'user', target_id: h.author_id, target_label: h.excerpt,
    metadata: { event_id: randomUUID(), actor: actor.username, held_id: h.id, kind: h.kind, rule_name: h.rule_name, published_id: publishedId },
  })
  tellAuthor(h, 'approved', publishedId)
  return { ok: true, held: { ...h, published_id: publishedId }, published_id: publishedId }
}

export async function refuseHeld(id: string, actor: { id: string; username: string }): Promise<DecideResult> {
  const h = await claim(id, 'refused', actor.id)
  if (!h) return { ok: false, code: 'ALREADY_DECIDED' }
  logOctoGuardAction({
    action: 'octoguard.held_refused', actor_id: actor.id,
    target_type: 'user', target_id: h.author_id, target_label: h.excerpt,
    metadata: { event_id: randomUUID(), actor: actor.username, held_id: h.id, kind: h.kind, rule_name: h.rule_name },
  })
  tellAuthor(h, 'refused', null)
  return { ok: true, held: h, published_id: null }
}

/** Efface les contenus décidés depuis plus de 30 jours (le journal garde l'extrait). */
export async function purgeDecidedHeld(): Promise<number> {
  const { rows } = await db.query(
    `DELETE FROM octoguard_held
      WHERE status <> 'pending' AND decided_at < NOW() - ($1 || ' days')::interval
      RETURNING id`,
    [String(HELD_RETENTION_DAYS)]
  )
  return rows.length
}

/** D17 : appelé par le planificateur. Refuse ce qui attend depuis plus de 72 h. */
export async function expireHeld(): Promise<number> {
  const { rows } = await db.query<HeldRow>(
    `UPDATE octoguard_held SET status = 'expired', decided_at = NOW()
      WHERE status = 'pending' AND created_at < NOW() - ($1 || ' hours')::interval
      RETURNING *`,
    [String(HELD_EXPIRY_HOURS)]
  )
  for (const h of rows) {
    logOctoGuardAction({
      action: 'octoguard.held_expired', target_type: 'user', target_id: h.author_id, target_label: h.excerpt,
      metadata: { event_id: randomUUID(), actor: 'octoguard:auto', held_id: h.id, kind: h.kind, rule_name: h.rule_name },
    })
    tellAuthor(h, 'expired', null)
  }
  return rows.length
}

let _timer: NodeJS.Timeout | null = null
/** Toutes les 10 minutes : refuse ce qui attend depuis plus de 72 h (D17). */
export function startHeldExpiryWorker(): void {
  if (_timer) return
  _timer = setInterval(() => {
    expireHeld()
      .then(n => { if (n > 0) console.log(`[octoguard:held] ${n} held item(s) expired after ${HELD_EXPIRY_HOURS}h`) })
      .catch(err => console.warn('[octoguard:held] expiry failed:', err))
    purgeOldEdits()
      .then(n => { if (n > 0) console.log(`[octoguard:held] ${n} old edit(s) erased after ${EDITS_RETENTION_DAYS} days`) })
      .catch(err => console.warn('[octoguard:held] edits purge failed:', err))
    purgeDecidedHeld()
      .then(n => { if (n > 0) console.log(`[octoguard:held] ${n} decided item(s) erased after ${HELD_RETENTION_DAYS} days`) })
      .catch(err => console.warn('[octoguard:held] purge failed:', err))
  }, 10 * 60_000)
  _timer.unref?.()
}
