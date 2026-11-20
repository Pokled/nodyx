// Les chartes (lot 7, SPECS/NODYX_OCTOGUARD_V2_CDC.md §E4f et §E4j ; maquette v3
// validée par Jonathan le 19/11/2026 : https://nodyx.org/charte-maquette.html).
//
// Deux chartes, un seul moteur : `members` (la porte d'entrée, signée pour écrire)
// et `team` (signée en recevant des droits de modération ; le propriétaire, qui
// l'écrit, n'a pas à la signer). Éteintes à l'installation (D22). On garde la PREUVE
// d'une signature, jamais le dessin (D15). Tout le monde signe une fois, puis
// seulement quand une version est publiée comme « changement important » (D16).
//
// Le serveur tient ce qu'il peut tenir : la fausse case, le chrono lu sur SON
// horloge, l'arrivée en bas, la version. Le tracé et la phrase sont vérifiés dans
// le navigateur (honnêteté écrite dans le CDC : un robot qui pilote un vrai
// navigateur peut les imiter ; la charte relève le coût, elle ne promet rien de plus).
//
// Tolérant aux pannes : une erreur de lecture n'enferme personne dehors.
import { db, redis } from '../config/database'
import { instanceCommunityId } from './mentionPeople'
import { getAccess, GRADE_PERMISSIONS } from './permissions'
import { sanitizeCharter } from '../utils/sanitize'
import { logOctoGuardAction } from './octoguard/logger'
import { randomUUID } from 'node:crypto'

export const AUDIENCES = ['members', 'team'] as const
export type Audience = typeof AUDIENCES[number]
export const isAudience = (a: unknown): a is Audience => a === 'members' || a === 'team'

export const PLEDGE_TONES = ['sober', 'fun', 'kids', 'own'] as const
export type PledgeTone = typeof PLEDGE_TONES[number]

/** Tout lire et signer plus vite que ça : personne ne fait ça (maquette, piège 4). */
export const CHARTER_MIN_SIGN_MS = 3000
/** Voie « phrase » : moins de frappes que ça = un collage instantané (E4f). */
export const CHARTER_MIN_TYPED = 5
/** Une mise à jour de lecture toutes les 2 s au plus (l'arrivée en bas passe toujours). */
export const CHARTER_PROGRESS_EVERY_S = 2
/** Plafond d'une lecture dans la « lecture moyenne » de l'admin. */
export const CHARTER_READ_CAP_MS = 30 * 60 * 1000

export class CharterError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

// ── Règles pures (testées sans base) ─────────────────────────────────────────

/**
 * La signature d'un membre suffit-elle ? Il faut avoir signé une version au moins
 * égale à la dernière version marquée « importante » (et au moins la première :
 * tout le monde signe une fois, D16). Une simple correction ne fait re-signer personne.
 */
export function signedEnough(signedVersions: number[], minImportant: number): boolean {
  const required = Math.max(1, minImportant)
  return signedVersions.some(v => v >= required)
}

export interface SignInput {
  version:  number
  way:      'hand' | 'phrase'
  pledge:   boolean
  decoy:    boolean
  typed:    number
}
export interface SignContext {
  enabled:     boolean
  current:     number | null
  drawEnabled: boolean
  openedAt:    Date | null
  bottomAt:    Date | null
  now:         Date
}
export type SignDecision =
  | { ok: true }
  | { ok: false; bot: 'decoy' | 'clock' }
  | { ok: false; code: string; status: number }

/**
 * L'ordre des refus (CDC §E4j). Les deux pièges d'abord : la fausse case, puis le
 * chrono (horloge du serveur). Côté membre, un robot reçoit la MÊME phrase neutre
 * que tout autre refus : le piège ne se devine jamais.
 */
export function decideSign(i: SignInput, c: SignContext): SignDecision {
  if (!c.enabled || c.current === null) return { ok: false, code: 'CHARTER_OFF', status: 409 }
  if (i.decoy) return { ok: false, bot: 'decoy' }
  if (!c.openedAt) return { ok: false, code: 'CHARTER_NOT_OPENED', status: 409 }
  if (c.now.getTime() - c.openedAt.getTime() < CHARTER_MIN_SIGN_MS) return { ok: false, bot: 'clock' }
  if (i.version !== c.current) return { ok: false, code: 'CHARTER_VERSION_CHANGED', status: 409 }
  if (!c.bottomAt) return { ok: false, code: 'CHARTER_NOT_READ', status: 409 }
  if (i.way === 'hand' && !c.drawEnabled) return { ok: false, code: 'CHARTER_WAY_INVALID', status: 400 }
  if (!i.pledge) return { ok: false, code: 'CHARTER_PLEDGE_REQUIRED', status: 400 }
  if (i.way === 'phrase' && i.typed < CHARTER_MIN_TYPED) return { ok: false, code: 'CHARTER_TYPE_IT', status: 400 }
  return { ok: true }
}

const stripTags = (h: string) => h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()

/** Les titres de section (les « règles ») d'une charte, dans l'ordre. HTML déjà nettoyé. */
export function sectionTitles(html: string): string[] {
  const out: string[] = []
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) { const t = stripTags(m[1]); if (t) out.push(t) }
  return out
}

/**
 * « Prête à allumer ? » (indicatif, validé le 19/11 : on peut allumer quand même).
 * Un titre (la légende d'une bannière ou un premier titre), au moins trois règles,
 * une bannière, le texte de la case.
 */
export function readiness(html: string, tone: PledgeTone, own: string) {
  const banner = /<figure\b[^>]*class="[^"]*\bnx-banner\b/i.test(html) && /<img\b/i.test(html)
  const caption = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(html)
  const titles = sectionTitles(html)
  const title = !!(caption && stripTags(caption[1])) || titles.length > 0
  const rules = titles.length >= 3
  const pledge = tone !== 'own' || own.trim().length > 0
  return { title, rules, banner, pledge, ready: title && rules && banner && pledge }
}

/** Une charte qui ne dit rien (blocs vides) ne se publie pas. */
export function hasContent(html: string): boolean {
  return stripTags(html).length > 0 || /<img\b/i.test(html)
}

// ── État d'une charte (mis en mémoire, le chat le lit à chaque message) ─────

interface CharterState {
  enabled: boolean
  current: number | null       // version publiée la plus récente
  minImportant: number         // dernière version « importante » (0 si aucune)
  drawEnabled: boolean
  tone: PledgeTone
  own: string
}
const STATE_TTL_MS = 30_000
const stateCache = new Map<Audience, { at: number; s: CharterState }>()

export function forgetCharterState(aud?: Audience) {
  if (aud) stateCache.delete(aud); else stateCache.clear()
}

export async function charterState(aud: Audience): Promise<CharterState> {
  const hit = stateCache.get(aud)
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.s
  const { rows } = await db.query<{ enabled: boolean; draw_enabled: boolean; pledge_tone: PledgeTone; pledge_own: string; current: number | null; min_important: number | null }>(
    `SELECT s.enabled, s.draw_enabled, s.pledge_tone, s.pledge_own,
            (SELECT MAX(version) FROM charter_versions WHERE audience = s.audience) AS current,
            (SELECT MAX(version) FROM charter_versions WHERE audience = s.audience AND important) AS min_important
       FROM charter_settings s WHERE s.audience = $1`, [aud])
  const r = rows[0]
  const s: CharterState = {
    enabled: !!r?.enabled, current: r?.current ?? null, minImportant: r?.min_important ?? 0,
    drawEnabled: r?.draw_enabled ?? true, tone: r?.pledge_tone ?? 'sober', own: r?.pledge_own ?? '',
  }
  stateCache.set(aud, { at: Date.now(), s })
  return s
}

const needKey = (aud: Audience, s: CharterState, userId: string) =>
  `charter:need:${aud}:${s.enabled ? 1 : 0}.${s.current ?? 0}.${s.minImportant}:${userId}`

/** Cette personne fait-elle partie de l'équipe (au moins un droit), hors propriétaire ? */
async function teamButNotOwner(userId: string): Promise<boolean> {
  const communityId = await instanceCommunityId()
  if (!communityId) return false
  const a = await getAccess(communityId, userId)
  return a.role !== 'owner' && a.permissions.length > 0
}

/** Doit-elle signer cette charte maintenant ? Faux en cas de panne (personne n'est enfermé dehors). */
export async function mustSign(aud: Audience, userId: string): Promise<boolean> {
  try {
    const s = await charterState(aud)
    if (!s.enabled || s.current === null) return false
    const key = needKey(aud, s, userId)
    try { const c = await redis.get(key); if (c === '1' || c === '0') return c === '1' } catch { /* on lit la base */ }
    let need: boolean
    if (aud === 'team' && !(await teamButNotOwner(userId))) need = false
    else {
      const { rows } = await db.query<{ version: number }>(
        `SELECT version FROM charter_signatures WHERE audience = $1 AND user_id = $2`, [aud, userId])
      need = !signedEnough(rows.map(r => r.version), s.minImportant)
    }
    redis.set(key, need ? '1' : '0', 'EX', 60).catch(() => {})
    return need
  } catch (err) {
    console.warn('[charter] mustSign failed, letting through:', err)
    return false
  }
}

export type CharterGate = { allow: true } | { allow: false; code: 'CHARTER_UNSIGNED'; i18n_key: 'charter.unsigned' }

/**
 * La porte côté serveur (couche en plus de l'écran) : chat, messages privés,
 * sujets et réponses du forum (validé le 19/11). Appelée AVANT OctoGuard.
 */
export async function charterGate(userId: string): Promise<CharterGate> {
  return (await mustSign('members', userId))
    ? { allow: false, code: 'CHARTER_UNSIGNED', i18n_key: 'charter.unsigned' }
    : { allow: true }
}

/** Corps de refus HTTP pour une écriture bloquée par la charte. */
export const charterRefusal = { error: 'Sign the community charter first', code: 'CHARTER_UNSIGNED', i18n_key: 'charter.unsigned' }

// ── Côté membre ──────────────────────────────────────────────────────────────

async function communityName(): Promise<string> {
  const id = await instanceCommunityId()
  if (!id) return ''
  const { rows } = await db.query<{ name: string }>(`SELECT name FROM communities WHERE id = $1`, [id])
  return rows[0]?.name ?? ''
}

/**
 * Où dire bonjour après avoir signé (bouton de l'écran Bienvenue) : le salon choisi
 * dans OctoGuard > Messages de bienvenue, sinon le premier salon texte.
 */
async function helloChannel(): Promise<{ id: string; name: string } | null> {
  try {
    const communityId = await instanceCommunityId()
    if (!communityId) return null
    const { rows } = await db.query<{ id: string; name: string }>(
      `SELECT c.id, c.name FROM channels c
        WHERE c.community_id = $1 AND c.type = 'text'
        ORDER BY (c.id = (SELECT channel_id FROM octoguard_welcome WHERE id = 1)) IS TRUE DESC, c.position ASC, c.created_at ASC
        LIMIT 1`, [communityId])
    return rows[0] ?? null
  } catch { return null }
}

/**
 * Un message de bienvenue attend-il VRAIMENT cette personne à sa signature ? (OctoGuard
 * allumé, accueil activé avec un salon, et un accueil en attente pour elle : un membre
 * déjà là qui signe n'est pas accueilli, lot 7d-2.) Sinon l'écran Bienvenue n'emmène
 * personne nulle part.
 */
async function welcomeAwaits(userId: string): Promise<boolean> {
  if (process.env.OCTOGUARD_ENABLED !== 'true') return false
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT (w.enabled AND w.channel_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM charter_welcome_pending p WHERE p.user_id = $1)) AS ok
         FROM octoguard_welcome w WHERE w.id = 1`, [userId])
    return rows[0]?.ok === true
  } catch { return false }
}

/** La charte à lire. Ouvre (ou reprend) la lecture : le chrono part de la première ouverture. */
export async function openCharter(aud: Audience, userId: string) {
  const s = await charterState(aud)
  if (s.current === null) return { version: null, enabled: s.enabled, must_sign: false }
  const { rows } = await db.query<{ body_html: string }>(
    `SELECT body_html FROM charter_versions WHERE audience = $1 AND version = $2`, [aud, s.current])
  const must = await mustSign(aud, userId)
  if (s.enabled) {
    await db.query(
      `INSERT INTO charter_views (audience, user_id, version) VALUES ($1, $2, $3)
       ON CONFLICT (audience, user_id, version) DO UPDATE SET last_at = NOW()`, [aud, userId, s.current])
  }
  return {
    version: s.current, enabled: s.enabled, must_sign: must,
    body_html: rows[0]?.body_html ?? '',
    pledge: { tone: s.tone, own: s.tone === 'own' ? s.own : '' },
    draw_enabled: s.drawEnabled,
    community: await communityName(),
    hello_channel: aud === 'members' ? await helloChannel() : null,
    crowd: aud === 'members' ? await crowdFor(userId) : null,
    welcome: aud === 'members' ? await welcomeAwaits(userId) : false,
  }
}

/**
 * Relire la charte (page « La charte », lot 7d-3). Rien n'est compté : aucune lecture
 * n'est ouverte, le parcours de l'admin ne bouge pas. Dit aussi ce que la personne a signé.
 */
export async function readCharter(aud: Audience, userId: string) {
  const s = await charterState(aud)
  const community = await communityName()
  if (s.current === null) return { version: null, community }
  const { rows } = await db.query<{ body_html: string; published_at: Date }>(
    `SELECT body_html, published_at FROM charter_versions WHERE audience = $1 AND version = $2`, [aud, s.current])
  const { rows: sig } = await db.query<{ version: number; way: 'hand' | 'phrase'; signed_at: Date }>(
    `SELECT version, way, signed_at FROM charter_signatures WHERE audience = $1 AND user_id = $2
      ORDER BY version DESC LIMIT 1`, [aud, userId])
  return {
    version: s.current, enabled: s.enabled, community,
    published_at: rows[0]?.published_at ?? null,
    body_html: rows[0]?.body_html ?? '',
    signed: sig[0] ?? null,
  }
}

/** Une charte est-elle publiée ? (l'entrée « La charte » du menu n'apparaît que si oui) */
export async function charterPublished(aud: Audience): Promise<boolean> {
  try { return (await charterState(aud)).current !== null } catch { return false }
}

/**
 * Pour l'écran Bienvenue : combien de membres on rejoint, et quatre visages récents
 * (ceux qui ont un avatar d'abord). Jamais bloquant : en panne, l'écran s'en passe.
 */
async function crowdFor(userId: string): Promise<{ count: number; faces: Array<{ username: string; avatar: string | null }> } | null> {
  try {
    const communityId = await instanceCommunityId()
    if (!communityId) return null
    const { rows: c } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM community_members WHERE community_id = $1 AND user_id <> $2`, [communityId, userId])
    const { rows: faces } = await db.query<{ username: string; avatar: string | null }>(
      `SELECT u.username, NULLIF(u.avatar, '') AS avatar
         FROM community_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.community_id = $1 AND cm.user_id <> $2
        ORDER BY (NULLIF(u.avatar, '') IS NOT NULL) DESC, cm.joined_at DESC
        LIMIT 4`, [communityId, userId])
    return { count: c[0]?.n ?? 0, faces }
  } catch { return null }
}

/** Jusqu'où on a lu. Ne fait que monter ; l'arrivée en bas passe toujours. */
export async function recordProgress(aud: Audience, userId: string, p: { version: number; pct: number; section: number; bottom: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(p.pct)))
  const section = Math.max(0, Math.min(500, Math.round(p.section)))
  if (!p.bottom) {
    try {
      const first = await redis.set(`charter:prog:${aud}:${userId}`, '1', 'EX', CHARTER_PROGRESS_EVERY_S, 'NX')
      if (first !== 'OK') return { ok: true, throttled: true }
    } catch { /* sans Redis : on écrit */ }
  }
  await db.query(
    `UPDATE charter_views
        SET max_pct = GREATEST(max_pct, $4::smallint), max_section = GREATEST(max_section, $5::smallint),
            bottom_at = COALESCE(bottom_at, CASE WHEN $6 THEN NOW() END), last_at = NOW()
      WHERE audience = $1 AND user_id = $2 AND version = $3`,
    [aud, userId, p.version, p.bottom ? 100 : pct, section, p.bottom])
  return { ok: true, throttled: false }
}

/** Le pseudo, pour que le journal se lise sans jointure (« Léa a signé… »). */
async function usernameOf(userId: string): Promise<string | null> {
  try {
    const { rows } = await db.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [userId])
    return rows[0]?.username ?? null
  } catch { return null }
}

/** Signer. Renvoie le refus à montrer ; un robot reçoit le même que tout le monde. */
export async function signCharter(aud: Audience, userId: string, input: SignInput) {
  const s = await charterState(aud)
  const { rows } = s.current === null ? { rows: [] as Array<{ opened_at: Date; bottom_at: Date | null }> } : await db.query<{ opened_at: Date; bottom_at: Date | null }>(
    `SELECT opened_at, bottom_at FROM charter_views WHERE audience = $1 AND user_id = $2 AND version = $3`, [aud, userId, s.current])
  const view = rows[0]
  const now = new Date()
  const d = decideSign(input, { enabled: s.enabled, current: s.current, drawEnabled: s.drawEnabled, openedAt: view?.opened_at ?? null, bottomAt: view?.bottom_at ?? null, now })

  if (!d.ok && 'bot' in d) {
    await db.query(`INSERT INTO charter_bot_stops (audience, user_id, trap) VALUES ($1, $2, $3)`, [aud, userId, d.bot])
    logOctoGuardAction({
      action: 'octoguard.charter_bot_stopped', target_type: 'user', target_id: userId, target_label: await usernameOf(userId),
      metadata: { event_id: randomUUID(), actor: 'octoguard:auto', audience: aud, trap: d.bot },
    })
    throw new CharterError(400, 'CHARTER_REFUSED', 'Signature refused')
  }
  if (!d.ok) throw new CharterError(d.status, d.code, 'Signature refused')

  const readMs = view ? Math.max(0, now.getTime() - new Date(view.opened_at).getTime()) : 0
  const ins = await db.query(
    `INSERT INTO charter_signatures (audience, user_id, version, way, read_ms) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (audience, user_id, version) DO NOTHING RETURNING id`,
    [aud, userId, s.current, input.way, Math.min(readMs, 2_147_483_647)])
  try { await redis.del(needKey(aud, s, userId)) } catch { /* le TTL de 60 s rattrape */ }
  // La charte des membres signée : l'accueil d'un nouvel inscrit part maintenant
  if (aud === 'members') void releasePendingWelcome(userId)
  if (ins.rows.length) {
    logOctoGuardAction({
      action: 'octoguard.charter_signed', target_type: 'user', target_id: userId, target_label: await usernameOf(userId), actor_id: userId,
      metadata: { event_id: randomUUID(), actor: userId, audience: aud, version: s.current, way: input.way, read_ms: readMs },
    })
  }
  return { ok: true, version: s.current }
}

// ── Administration ───────────────────────────────────────────────────────────

export async function charterAdmin(aud: Audience) {
  const { rows } = await db.query<{ enabled: boolean; pledge_tone: PledgeTone; pledge_own: string; draw_enabled: boolean; draft_html: string; updated_at: Date }>(
    `SELECT enabled, pledge_tone, pledge_own, draw_enabled, draft_html, updated_at FROM charter_settings WHERE audience = $1`, [aud])
  const st = rows[0]
  const { rows: versions } = await db.query<{ version: number; important: boolean; published_at: Date; published_by_name: string | null; signatures: number }>(
    `SELECT v.version, v.important, v.published_at, u.username AS published_by_name,
            (SELECT COUNT(*)::int FROM charter_signatures g WHERE g.audience = v.audience AND g.version = v.version) AS signatures
       FROM charter_versions v LEFT JOIN users u ON u.id = v.published_by
      WHERE v.audience = $1 ORDER BY v.version DESC LIMIT 50`, [aud])
  const { rows: cur } = versions.length
    ? await db.query<{ body_html: string }>(`SELECT body_html FROM charter_versions WHERE audience = $1 AND version = $2`, [aud, versions[0].version])
    : { rows: [] as Array<{ body_html: string }> }
  const draft = st?.draft_html || cur[0]?.body_html || ''
  return {
    enabled: !!st?.enabled, pledge_tone: st?.pledge_tone ?? 'sober', pledge_own: st?.pledge_own ?? '',
    draw_enabled: st?.draw_enabled ?? true,
    draft_html: draft,
    current_version: versions[0]?.version ?? null,
    versions,
    readiness: readiness(draft, st?.pledge_tone ?? 'sober', st?.pledge_own ?? ''),
  }
}

export async function updateCharterSettings(aud: Audience, actorId: string, patch: { enabled?: unknown; pledge_tone?: unknown; pledge_own?: unknown; draw_enabled?: unknown }) {
  const sets: string[] = [], vals: unknown[] = [aud, actorId]
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new CharterError(400, 'CHARTER_SETTINGS_INVALID', 'enabled must be a boolean')
    vals.push(patch.enabled); sets.push(`enabled = $${vals.length}`)
  }
  if (patch.pledge_tone !== undefined) {
    if (!(PLEDGE_TONES as readonly unknown[]).includes(patch.pledge_tone)) throw new CharterError(400, 'CHARTER_SETTINGS_INVALID', 'Unknown pledge tone')
    vals.push(patch.pledge_tone); sets.push(`pledge_tone = $${vals.length}`)
  }
  if (patch.pledge_own !== undefined) {
    if (typeof patch.pledge_own !== 'string' || patch.pledge_own.length > 200) throw new CharterError(400, 'CHARTER_SETTINGS_INVALID', 'pledge_own: 200 characters at most')
    vals.push(patch.pledge_own.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()); sets.push(`pledge_own = $${vals.length}`)
  }
  if (patch.draw_enabled !== undefined) {
    if (typeof patch.draw_enabled !== 'boolean') throw new CharterError(400, 'CHARTER_SETTINGS_INVALID', 'draw_enabled must be a boolean')
    vals.push(patch.draw_enabled); sets.push(`draw_enabled = $${vals.length}`)
  }
  if (!sets.length) throw new CharterError(400, 'CHARTER_SETTINGS_INVALID', 'Nothing to change')
  const { rows: before } = await db.query<{ enabled: boolean }>(`SELECT enabled FROM charter_settings WHERE audience = $1`, [aud])
  await db.query(`UPDATE charter_settings SET ${sets.join(', ')}, updated_by = $2, updated_at = NOW() WHERE audience = $1`, vals)
  forgetCharterState(aud)
  if (typeof patch.enabled === 'boolean' && before[0] && before[0].enabled !== patch.enabled) {
    logOctoGuardAction({
      action: patch.enabled ? 'octoguard.charter_enabled' : 'octoguard.charter_disabled',
      target_type: null, target_id: null, target_label: null, actor_id: actorId,
      metadata: { event_id: randomUUID(), actor: actorId, audience: aud },
    })
  }
  return charterAdmin(aud)
}

/** Enregistre le brouillon, nettoyé : ce qui n'est pas un bloc de l'aide-mémoire est retiré. */
export async function saveCharterDraft(aud: Audience, actorId: string, html: unknown) {
  if (typeof html !== 'string') throw new CharterError(400, 'CHARTER_DRAFT_INVALID', 'html must be a string')
  if (html.length > 200_000) throw new CharterError(413, 'CHARTER_TOO_LONG', 'The charter is too long')
  const clean = sanitizeCharter(html)
  await db.query(`UPDATE charter_settings SET draft_html = $2, updated_by = $3, updated_at = NOW() WHERE audience = $1`, [aud, clean, actorId])
  return { draft_html: clean }
}

/** Publie le brouillon comme nouvelle version. Importante : tout le monde re-signe. */
export async function publishCharter(aud: Audience, actorId: string, important: unknown) {
  if (typeof important !== 'boolean') throw new CharterError(400, 'CHARTER_PUBLISH_INVALID', 'important must be a boolean')
  const { rows } = await db.query<{ draft_html: string }>(`SELECT draft_html FROM charter_settings WHERE audience = $1`, [aud])
  const html = sanitizeCharter(rows[0]?.draft_html ?? '')
  if (!hasContent(html)) throw new CharterError(400, 'CHARTER_EMPTY', 'The charter is empty')
  let version: number
  try {
    const ins = await db.query<{ version: number }>(
      `INSERT INTO charter_versions (audience, version, body_html, important, published_by)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4 FROM charter_versions WHERE audience = $1
       RETURNING version`, [aud, html, important, actorId])
    version = ins.rows[0].version
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new CharterError(409, 'CHARTER_PUBLISH_CONFLICT', 'Another version was just published')
    throw err
  }
  forgetCharterState(aud)
  logOctoGuardAction({
    action: 'octoguard.charter_published', target_type: null, target_id: null, target_label: null, actor_id: actorId,
    metadata: { event_id: randomUUID(), actor: actorId, audience: aud, version, important },
  })
  return { version, important }
}

// Qui est concerné : les membres de la communauté, ou l'équipe (au moins un droit, hors propriétaire)
const TEAM_SQL = `(cm.role IN ('admin', 'moderator') OR EXISTS (
    SELECT 1 FROM jsonb_each(COALESCE(cg.permissions, '{}'::jsonb)) e
     WHERE e.value = 'true'::jsonb AND e.key = ANY($3::text[])))
  AND cm.role <> 'owner'`
const PEOPLE_FROM = (aud: Audience) => `
  FROM community_members cm
  JOIN users u ON u.id = cm.user_id
  LEFT JOIN community_grades cg ON cg.id = cm.grade_id AND cg.community_id = cm.community_id
  WHERE cm.community_id = $1 ${aud === 'team' ? 'AND ' + TEAM_SQL : 'AND $3::text[] IS NOT NULL'}`

/** Les chiffres, le parcours des 30 derniers jours, la règle où l'on abandonne. */
export async function charterOverview(aud: Audience) {
  const communityId = await instanceCommunityId()
  const s = await charterState(aud)
  const required = Math.max(1, s.minImportant)
  const perms = [...GRADE_PERMISSIONS]
  const counts = communityId ? (await db.query<{ total: number; signed: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM charter_signatures g WHERE g.audience = $2 AND g.user_id = cm.user_id AND g.version >= $4))::int AS signed
     ${PEOPLE_FROM(aud)}`, [communityId, aud, perms, required])).rows[0] : { total: 0, signed: 0 }
  const { rows: f } = await db.query<{ opened: number; bottom: number; signed: number; bots: number; bots_week: number; avg_read_ms: number | null }>(
    `SELECT (SELECT COUNT(DISTINCT user_id)::int FROM charter_views WHERE audience = $1 AND opened_at > NOW() - INTERVAL '30 days') AS opened,
            (SELECT COUNT(DISTINCT user_id)::int FROM charter_views WHERE audience = $1 AND bottom_at > NOW() - INTERVAL '30 days') AS bottom,
            (SELECT COUNT(DISTINCT user_id)::int FROM charter_signatures WHERE audience = $1 AND signed_at > NOW() - INTERVAL '30 days') AS signed,
            (SELECT COUNT(*)::int FROM charter_bot_stops WHERE audience = $1 AND created_at > NOW() - INTERVAL '30 days') AS bots,
            (SELECT COUNT(*)::int FROM charter_bot_stops WHERE audience = $1 AND created_at > NOW() - INTERVAL '7 days') AS bots_week,
            (SELECT AVG(LEAST(read_ms, $2))::float FROM charter_signatures WHERE audience = $1 AND signed_at > NOW() - INTERVAL '30 days') AS avg_read_ms`,
    // Une lecture se compte depuis la PREMIÈRE ouverture : qui ouvre lundi et signe jeudi
    // fausserait la moyenne de trois jours. Plafond à 30 min pour la moyenne (la valeur brute reste)
    [aud, CHARTER_READ_CAP_MS])
  // La règle où l'on s'arrête le plus : chez ceux qui ont ouvert la version courante sans la signer
  let dropoff: { title: string; count: number } | null = null
  if (s.current !== null) {
    const { rows: drop } = await db.query<{ max_section: number; n: number }>(
      `SELECT v.max_section, COUNT(*)::int AS n FROM charter_views v
        WHERE v.audience = $1 AND v.version = $2 AND v.bottom_at IS NULL AND v.opened_at > NOW() - INTERVAL '30 days'
          AND NOT EXISTS (SELECT 1 FROM charter_signatures g WHERE g.audience = v.audience AND g.user_id = v.user_id AND g.version = v.version)
        GROUP BY v.max_section ORDER BY n DESC, v.max_section ASC LIMIT 1`, [aud, s.current])
    if (drop[0]) {
      const { rows: body } = await db.query<{ body_html: string }>(`SELECT body_html FROM charter_versions WHERE audience = $1 AND version = $2`, [aud, s.current])
      const titles = sectionTitles(body[0]?.body_html ?? '')
      const t = titles[Math.max(0, drop[0].max_section - 1)] ?? titles[0]
      if (t) dropoff = { title: t, count: drop[0].n }
    }
  }
  const r = f[0]
  return {
    enabled: s.enabled, current_version: s.current, required_version: required,
    signed: counts.signed, pending: Math.max(0, counts.total - counts.signed), bots_week: r.bots_week,
    funnel: { opened: r.opened, bottom: r.bottom, signed: r.signed, bots: r.bots },
    avg_read_ms: r.avg_read_ms === null ? null : Math.round(r.avg_read_ms),
    dropoff,
  }
}

/** Les listes : signatures récentes, pas encore, robots arrêtés. */
export async function charterPeople(aud: Audience, tab: 'recent' | 'pending' | 'bots', q: string) {
  const like = q ? `%${q.replace(/[\\%_]/g, m => '\\' + m)}%` : null
  if (tab === 'recent') {
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.username, g.version, g.way, g.read_ms, g.signed_at
         FROM charter_signatures g JOIN users u ON u.id = g.user_id
        WHERE g.audience = $1 AND ($2::text IS NULL OR u.username ILIKE $2)
        ORDER BY g.signed_at DESC LIMIT 50`, [aud, like])
    return rows
  }
  if (tab === 'bots') {
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.username, b.trap, b.created_at
         FROM charter_bot_stops b JOIN users u ON u.id = b.user_id
        WHERE b.audience = $1 AND ($2::text IS NULL OR u.username ILIKE $2)
        ORDER BY b.created_at DESC LIMIT 50`, [aud, like])
    return rows
  }
  const communityId = await instanceCommunityId()
  const s = await charterState(aud)
  if (!communityId) return []
  const required = Math.max(1, s.minImportant)
  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.username, cm.joined_at, cm.role,
            (SELECT MAX(version) FROM charter_signatures g WHERE g.audience = $2 AND g.user_id = cm.user_id) AS signed_version,
            (SELECT max_pct FROM charter_views v WHERE v.audience = $2 AND v.user_id = cm.user_id AND v.version = $5) AS read_pct
     ${PEOPLE_FROM(aud)}
       AND NOT EXISTS (SELECT 1 FROM charter_signatures g WHERE g.audience = $2 AND g.user_id = cm.user_id AND g.version >= $4)
       AND ($6::text IS NULL OR u.username ILIKE $6)
     ORDER BY cm.joined_at DESC LIMIT 50`,
    [communityId, aud, [...GRADE_PERMISSIONS], required, s.current ?? 0, like])
  return rows
}

/** Les dernières entrées du journal pour une charte (carte « Dans le journal »). */
export async function charterJournal(aud: Audience) {
  const { rows } = await db.query(
    `SELECT id, action, actor_username, target_label, metadata, created_at
       FROM admin_audit_log
      WHERE action LIKE 'octoguard.charter\\_%' AND metadata->>'audience' = $1
      ORDER BY created_at DESC LIMIT 8`, [aud])
  return rows
}

// ── L'accueil (message de bienvenue + grade) attend la signature ─────────────

/**
 * À l'inscription : si la charte des membres est active pour ce nouvel inscrit, son
 * accueil attend sa signature. Renvoie vrai si l'accueil a été mis en attente.
 * Tolérant aux pannes : en cas d'erreur, l'accueil part tout de suite (comme avant).
 */
export async function deferWelcomeIfCharter(userId: string): Promise<boolean> {
  try {
    if (!(await mustSign('members', userId))) return false
    await db.query(`INSERT INTO charter_welcome_pending (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId])
    return true
  } catch (err) {
    console.warn('[charter] deferWelcome failed, welcoming now:', err)
    return false
  }
}

/**
 * L'accueil en attente part : à la signature, ou à la visite suivante si la charte a été
 * éteinte entre-temps (personne ne reste sans accueil). Une seule fois : la ligne est
 * retirée avant d'accueillir. Jamais bloquant.
 */
export async function releasePendingWelcome(userId: string): Promise<void> {
  try {
    const { rows } = await db.query<{ username: string }>(
      `WITH gone AS (DELETE FROM charter_welcome_pending WHERE user_id = $1 RETURNING user_id)
       SELECT u.username FROM gone JOIN users u ON u.id = gone.user_id`, [userId])
    if (!rows[0] || process.env.OCTOGUARD_ENABLED !== 'true') return
    const { runWelcomeFor } = await import('./octoguard')
    await runWelcomeFor(userId, rows[0].username)
  } catch (err) {
    console.warn('[charter] releasePendingWelcome failed:', err)
  }
}
