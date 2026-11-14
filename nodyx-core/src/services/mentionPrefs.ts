// Les réglages de la personne mentionnée (SPECS/NODYX_MENTIONS_CDC.md, D54-D55, lot M3a).
//   who    : 'all' (défaut) | 'following' (les membres que je suis, et l'équipe) | 'team'
//   quiet  : heures calmes [début, fin[ en minutes depuis minuit, dans SON fuseau
//   mutes  : personnes dont je ne reçois plus les mentions (elles n'en savent rien)
// L'équipe peut toujours mentionner (D54) : c'est elle qui protège.
import { db } from '../config/database'

export type Who = 'all' | 'following' | 'team'
export interface MentionPrefs { who: Who; quiet_start: number | null; quiet_end: number | null; quiet_tz: string | null }
export const DEFAULT_PREFS: MentionPrefs = { who: 'all', quiet_start: null, quiet_end: null, quiet_tz: null }

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
}

/** Minutes depuis minuit, maintenant, dans le fuseau de la personne. */
export function minutesNow(tz: string | null, now = new Date()): number {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz && isValidTz(tz) ? tz : 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const [h, m] = f.format(now).split(':').map(Number)
  return h * 60 + m
}

/** En heures calmes maintenant ? Gère la nuit (22:00 → 08:00). */
export function isQuietNow(p: MentionPrefs, now = new Date()): boolean {
  if (p.quiet_start === null || p.quiet_end === null || p.quiet_start === p.quiet_end) return false
  const m = minutesNow(p.quiet_tz, now)
  return p.quiet_start < p.quiet_end ? m >= p.quiet_start && m < p.quiet_end : m >= p.quiet_start || m < p.quiet_end
}

/** Fin des heures calmes en cours (pour « jusqu'à 08:00 », si l'instance l'autorise). */
export function quietUntil(p: MentionPrefs): string | null {
  if (p.quiet_end === null) return null
  return `${String(Math.floor(p.quiet_end / 60)).padStart(2, '0')}:${String(p.quiet_end % 60).padStart(2, '0')}`
}

export async function getPrefs(userId: string): Promise<MentionPrefs> {
  const { rows } = await db.query<MentionPrefs>(
    `SELECT who, quiet_start, quiet_end, quiet_tz FROM user_mention_prefs WHERE user_id = $1`, [userId])
  return rows[0] ?? { ...DEFAULT_PREFS }
}

export async function setPrefs(userId: string, p: MentionPrefs): Promise<void> {
  await db.query(
    `INSERT INTO user_mention_prefs (user_id, who, quiet_start, quiet_end, quiet_tz, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET who = EXCLUDED.who, quiet_start = EXCLUDED.quiet_start,
       quiet_end = EXCLUDED.quiet_end, quiet_tz = EXCLUDED.quiet_tz, updated_at = NOW()`,
    [userId, p.who, p.quiet_start, p.quiet_end, p.quiet_tz])
}

/** Ce que chaque destinataire accepte de cet auteur, en trois requêtes pour tous. */
export async function recipientRules(recipients: string[], actorId: string): Promise<Map<string, { prefs: MentionPrefs; muted: boolean; follows: boolean }>> {
  const out = new Map<string, { prefs: MentionPrefs; muted: boolean; follows: boolean }>()
  if (!recipients.length) return out
  const [prefs, mutes, follows] = await Promise.all([
    db.query<MentionPrefs & { user_id: string }>(`SELECT user_id, who, quiet_start, quiet_end, quiet_tz FROM user_mention_prefs WHERE user_id = ANY($1::uuid[])`, [recipients]),
    db.query<{ user_id: string }>(`SELECT user_id FROM user_mention_mutes WHERE user_id = ANY($1::uuid[]) AND muted_user_id = $2`, [recipients, actorId]),
    db.query<{ follower_id: string }>(`SELECT follower_id FROM follows WHERE follower_id = ANY($1::uuid[]) AND following_id = $2`, [recipients, actorId]),
  ])
  const p = new Map(prefs.rows.map(r => [r.user_id, { who: r.who, quiet_start: r.quiet_start, quiet_end: r.quiet_end, quiet_tz: r.quiet_tz }]))
  const m = new Set(mutes.rows.map(r => r.user_id))
  const f = new Set(follows.rows.map(r => r.follower_id))
  for (const id of recipients) out.set(id, { prefs: p.get(id) ?? { ...DEFAULT_PREFS }, muted: m.has(id), follows: f.has(id) })
  return out
}

/** D54 : ce destinataire accepte-t-il les mentions de cet auteur ? */
export function accepts(rule: { prefs: MentionPrefs; muted: boolean; follows: boolean }, actorIsTeam: boolean): boolean {
  if (rule.muted && !actorIsTeam) return false
  if (actorIsTeam) return true
  if (rule.prefs.who === 'team') return false
  if (rule.prefs.who === 'following') return rule.follows
  return true
}
