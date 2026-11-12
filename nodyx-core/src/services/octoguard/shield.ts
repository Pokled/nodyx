/**
 * Le bouclier anti-raid (OctoGuard 2, lot 6, CDC E4e §6, D21).
 *
 * Un raid : une vague de comptes neufs ou de messages coordonnés pour saccager
 * une communauté. Tant que le bouclier est levé :
 *   - les comptes de moins d'1 jour (D21) lisent mais n'écrivent plus : chat,
 *     forum ET messages privés (D21b). Les réactions restent permises ;
 *   - les liens du chat et du forum sont mis de côté pour relecture ;
 *   - le chat est ralenti : un message toutes les 10 s par personne ;
 *   - l'équipe est prévenue.
 * L'équipe (moderate_content ou moderate_members) n'est jamais touchée.
 *
 * Le bouton marche TOUJOURS, OctoGuard allumé ou non (D21c) : un raid n'attend
 * pas qu'on ait réglé les règles. Seules l'alerte et la levée AUTOMATIQUES
 * demandent OctoGuard allumé.
 *
 * L'état vit dans Redis avec une durée de vie : le bouclier retombe tout seul à
 * l'heure dite, même si le cœur redémarre entre-temps. Chaque instance a son
 * préfixe Redis : lever le bouclier d'une communauté ne touche pas les autres.
 *
 * Ne lève jamais : une panne de Redis ou de la base laisse écrire (le bouclier
 * est une protection de crise, pas une porte qui se ferme sur une erreur).
 */

import { db, redis } from '../../config/database'
import { getInstanceCommunityId } from '../../middleware/adminOnly'
import { getAccess } from '../permissions'
import { isOctoGuardEnabled } from './index'
import { logOctoGuardAction } from './logger'
import * as NotificationModel from '../../models/notification'
import { io } from '../../socket/io'
import { randomUUID } from 'crypto'

/** D21 : « nouveau compte » pendant le bouclier = moins d'1 jour. */
export const SHIELD_NEW_ACCOUNT_DAYS = 1
/** Le chat ralenti : un message toutes les N secondes par personne. */
export const SHIELD_SLOW_SECONDS = 10
/** Durées proposées par le bouton (minutes). 30 par défaut. */
export const SHIELD_DURATIONS = [15, 30, 60, 120] as const
export const SHIELD_DEFAULT_MINUTES = 30
/** Les seuils d'alerte par défaut (maquette : 10 comptes en 10 min, 20 retenus en 5 min). */
export const SHIELD_ALERT_DEFAULTS = { accounts: 10, held: 20 } as const
const SIGNUP_WINDOW_S = 600
const HELD_WINDOW_S = 300
/** Une alerte au plus toutes les 30 minutes : prévenir, pas harceler. */
const ALERT_COOLDOWN_S = 1800

const KEY = 'og:shield'
const SLOW_KEY = (userId: string) => `og:shield:slow:${userId}`

export type ShieldTrigger = { kind: 'accounts' | 'held'; count: number; window_minutes: number }
export type ShieldState = {
  until: string
  raised_at: string
  raised_by: string | null
  raised_by_username: string | null
  reason: 'manual' | 'auto'
  trigger: ShieldTrigger | null
}

/** L'état courant, ou null si le bouclier est baissé. */
export async function getShield(): Promise<ShieldState | null> {
  try {
    const raw = await redis.get(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as ShieldState
    if (!s?.until || Date.parse(s.until) <= Date.now()) return null
    return s
  } catch {
    return null
  }
}

export async function isShieldActive(): Promise<boolean> {
  return (await getShield()) !== null
}

/** Réglages des alertes (registre des réglages : OCTOGUARD_SHIELD_*). */
export function shieldSettings(): { alert_accounts: number; alert_held: number; auto: boolean } {
  const n = (v: string | undefined, d: number) => { const x = Number(v); return Number.isInteger(x) && x >= 2 && x <= 1000 ? x : d }
  return {
    alert_accounts: n(process.env.OCTOGUARD_SHIELD_ALERT_ACCOUNTS, SHIELD_ALERT_DEFAULTS.accounts),
    alert_held:     n(process.env.OCTOGUARD_SHIELD_ALERT_HELD, SHIELD_ALERT_DEFAULTS.held),
    auto:           process.env.OCTOGUARD_SHIELD_AUTO === 'true',
  }
}

/** Les personnes qui peuvent lever ou baisser le bouclier : on les prévient. */
async function teamIds(except: string | null): Promise<string[]> {
  const communityId = await getInstanceCommunityId()
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT cm.user_id
       FROM community_members cm
       JOIN users u ON u.id = cm.user_id AND u.is_system = false
       LEFT JOIN community_grades cg ON cg.id = cm.grade_id AND cg.community_id = cm.community_id
      WHERE cm.community_id = $1
        AND (cm.role IN ('owner', 'admin', 'moderator')
             OR cg.permissions -> 'moderate_members' = 'true'::jsonb
             OR cg.permissions -> 'manage_octoguard' = 'true'::jsonb)
        AND ($2::uuid IS NULL OR cm.user_id <> $2::uuid)`,
    [communityId, except])
  return rows.map(r => r.user_id)
}

async function notifyTeam(type: 'shield_raised' | 'shield_suggested', except: string | null, meta: Record<string, unknown>): Promise<void> {
  try {
    for (const id of await teamIds(except)) {
      await NotificationModel.create({ user_id: id, type, actor_id: except, meta })
      if (io) io.to(`user:${id}`).emit('notification:new', { unreadCount: await NotificationModel.getUnreadCount(id) })
    }
  } catch { /* prévenir ne bloque jamais le bouclier */ }
}

function journal(action: string, actorId: string | null, actorName: string | null, metadata: Record<string, unknown>): void {
  logOctoGuardAction({
    action,
    target_type: null,
    target_id: null,
    target_label: null,
    actor_id: actorId,
    metadata: { event_id: randomUUID(), actor: actorId ?? 'octoguard:auto', ...metadata },
  })
}

/** Lever le bouclier pour `minutes` (bornées aux durées proposées). */
export async function raiseShield(input: { actorId: string | null; actorName?: string | null; minutes?: number; reason?: 'manual' | 'auto'; trigger?: ShieldTrigger | null }): Promise<ShieldState> {
  const minutes = (SHIELD_DURATIONS as readonly number[]).includes(input.minutes ?? -1) ? input.minutes! : SHIELD_DEFAULT_MINUTES
  const now = Date.now()
  const state: ShieldState = {
    until: new Date(now + minutes * 60_000).toISOString(),
    raised_at: new Date(now).toISOString(),
    raised_by: input.actorId,
    raised_by_username: input.actorName ?? null,
    reason: input.reason ?? 'manual',
    trigger: input.trigger ?? null,
  }
  await redis.set(KEY, JSON.stringify(state), 'PX', minutes * 60_000)
  journal('octoguard.shield_raised', input.actorId, input.actorName ?? null, { minutes, until: state.until, reason: state.reason, trigger: state.trigger })
  void notifyTeam('shield_raised', input.actorId, { until: state.until, minutes, reason: state.reason, trigger: state.trigger, by: input.actorName ?? null })
  io?.emit('octoguard:shield', { active: true, until: state.until })
  return state
}

/** Baisser le bouclier avant l'heure. Renvoie false s'il était déjà baissé. */
export async function lowerShield(input: { actorId: string; actorName?: string | null }): Promise<boolean> {
  const was = await getShield()
  await redis.del(KEY)
  if (!was) return false
  journal('octoguard.shield_lowered', input.actorId, input.actorName ?? null, { raised_at: was.raised_at, early_by_minutes: Math.max(0, Math.round((Date.parse(was.until) - Date.now()) / 60_000)) })
  io?.emit('octoguard:shield', { active: false, until: null })
  return true
}

/** Le texte contient-il un lien ? (adresse, « www. », invitation Discord) */
export function hasLink(text: string): boolean {
  return /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]|\bdiscord(?:\.gg|app\.com\/invite)\//i.test(text)
}

export type ShieldGate =
  | { allow: true; holdLinks: boolean }
  | { allow: false; code: 'SHIELD_NEW_ACCOUNT' | 'SHIELD_SLOW'; i18n_key: string; retry_after_s?: number; until: string }

const OPEN: ShieldGate = { allow: true, holdLinks: false }

/**
 * À appeler AVANT d'écrire. `surface` : chat, forum, dm, ou other (profil, sondage, wiki). `isNew` : un
 * nouveau message (le ralentissement ne vaut que pour eux, pas pour une
 * modification). Fail-open : toute panne laisse écrire.
 */
export async function shieldGate(userId: string, surface: 'chat' | 'forum' | 'dm' | 'other', opts: { isNew: boolean } = { isNew: true }): Promise<ShieldGate> {
  try {
    const s = await getShield()
    if (!s) return OPEN
    const communityId = await getInstanceCommunityId()
    if (communityId) {
      const access = await getAccess(communityId, userId)
      if (access.permissions.includes('moderate_content') || access.permissions.includes('moderate_members')) return OPEN
    }
    const { rows } = await db.query<{ age_days: number | null }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 AS age_days FROM users WHERE id = $1`, [userId])
    const age = rows[0]?.age_days
    if (age !== null && age !== undefined && Number(age) < SHIELD_NEW_ACCOUNT_DAYS) {
      return { allow: false, code: 'SHIELD_NEW_ACCOUNT', i18n_key: 'octoguard.shield.new_account', until: s.until }
    }
    if (surface === 'chat' && opts.isNew) {
      const first = await redis.set(SLOW_KEY(userId), '1', 'EX', SHIELD_SLOW_SECONDS, 'NX')
      if (first !== 'OK') {
        const ttl = await redis.ttl(SLOW_KEY(userId))
        return { allow: false, code: 'SHIELD_SLOW', i18n_key: 'octoguard.shield.slow', retry_after_s: ttl > 0 ? ttl : SHIELD_SLOW_SECONDS, until: s.until }
      }
    }
    return { allow: true, holdLinks: surface === 'chat' || surface === 'forum' }
  } catch {
    return OPEN
  }
}

/** La « règle » qui retient un lien pendant le bouclier (pas une règle d'OctoGuard : rule_id vide). */
export function shieldHoldRule(text: string): { rule_id: null; rule_name: string; excerpt: string } {
  return { rule_id: null, rule_name: 'shield', excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 200) }
}

// ─── L'alerte : OctoGuard repère la vague et propose ─────────────────────────

async function bump(key: string, windowS: number): Promise<number> {
  const n = await redis.incr(key)
  if (n === 1) await redis.expire(key, windowS)
  return n
}

async function maybeAlert(trigger: ShieldTrigger): Promise<'raised' | 'suggested' | null> {
  if (!isOctoGuardEnabled()) return null              // D21c : l'automatique demande OctoGuard allumé
  if (await isShieldActive()) return null
  const first = await redis.set('og:shield:alerted', '1', 'EX', ALERT_COOLDOWN_S, 'NX')
  if (first !== 'OK') return null
  if (shieldSettings().auto) {
    await raiseShield({ actorId: null, reason: 'auto', trigger, minutes: SHIELD_DEFAULT_MINUTES })
    return 'raised'
  }
  journal('octoguard.shield_suggested', null, null, { trigger })
  void notifyTeam('shield_suggested', null, { trigger })
  return 'suggested'
}

/** Un compte vient d'être créé. Ne lève jamais. */
export async function recordSignup(): Promise<'raised' | 'suggested' | null> {
  try {
    const n = await bump('og:shield:signups', SIGNUP_WINDOW_S)
    if (n < shieldSettings().alert_accounts) return null
    return await maybeAlert({ kind: 'accounts', count: n, window_minutes: SIGNUP_WINDOW_S / 60 })
  } catch { return null }
}

/** Un message vient d'être retenu pour relecture. Ne lève jamais. */
export async function recordHeld(): Promise<'raised' | 'suggested' | null> {
  try {
    const n = await bump('og:shield:held', HELD_WINDOW_S)
    if (n < shieldSettings().alert_held) return null
    return await maybeAlert({ kind: 'held', count: n, window_minutes: HELD_WINDOW_S / 60 })
  } catch { return null }
}

/** Ce que l'écran montre au calme : l'activité de la dernière heure, et l'habitude. */
export async function shieldActivity(): Promise<{ signups_hour: number; signups_usual_max: number; held_hour: number }> {
  const q = async (sql: string) => { try { const { rows } = await db.query<{ n: number }>(sql); return Number(rows[0]?.n ?? 0) } catch { return 0 } }
  return {
    signups_hour: await q(`SELECT COUNT(*)::int AS n FROM users WHERE is_system = false AND created_at > NOW() - INTERVAL '1 hour'`),
    // L'habitude : le plus grand nombre d'inscriptions en une heure sur les 7 derniers jours
    signups_usual_max: await q(`SELECT COALESCE(MAX(c), 0)::int AS n FROM (
      SELECT COUNT(*) AS c FROM users WHERE is_system = false AND created_at > NOW() - INTERVAL '7 days' AND created_at <= NOW() - INTERVAL '1 hour'
      GROUP BY date_trunc('hour', created_at)) h`),
    held_hour: await q(`SELECT COUNT(*)::int AS n FROM octoguard_held WHERE created_at > NOW() - INTERVAL '1 hour'`),
  }
}
