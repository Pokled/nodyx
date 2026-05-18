/**
 * OctoGuard, module Welcome (Module 2, spec v2.1.1).
 *
 * À l'inscription d'un nouvel utilisateur :
 *  - Si activé (octoguard_welcome.enabled), poste un message public dans
 *    le channel configuré, attribué à l'utilisateur fantôme "OctoGuard"
 *    (users.is_system=true). Variables substituées : {user}, {userMention},
 *    {communityName}, {rulesUrl}.
 *  - Si auto_grade_id défini, attribue ce grade au nouveau membre.
 *
 * Note : le DM système n'est PAS implémenté en Session C (touche au flux
 * DM E2E v2.0.0 qui est sensible). Voir spec 019-system-messages à venir.
 *
 * Jamais throw : appelé en fire-and-forget après l'inscription, ne doit
 * jamais bloquer le flux. Toute erreur est loggée puis ignorée.
 */

import { randomUUID, randomBytes } from 'crypto'
import bcrypt from 'bcrypt'
import { db } from '../../config/database'
import { logOctoGuardAction } from './logger'
import type { WelcomeRow } from './types'

// ─── User fantôme OctoGuard ──────────────────────────────────────────────────

const BOT_USERNAME = 'OctoGuard'
const BOT_EMAIL    = 'octoguard@nodyx.local'

// Cache module-level pour éviter le lookup à chaque welcome
let _botUserId: string | null = null

/**
 * Garantit l'existence de l'utilisateur fantôme OctoGuard.
 * Crée le user à la 1ère invocation, retourne son UUID en cache après.
 * Idempotent.
 */
export async function ensureOctoGuardBotUser(): Promise<string | null> {
  if (_botUserId) return _botUserId
  try {
    // Cherche d'abord un user système marqué OctoGuard
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE is_system = true AND username = $1 LIMIT 1`,
      [BOT_USERNAME]
    )
    if (existing[0]) {
      _botUserId = existing[0].id
      return _botUserId
    }

    // Pas de bot existant : on en crée un.
    // Le password est un hash bcrypt de bytes aléatoires : impossible à
    // deviner, et de toute façon le login refuse les users is_system.
    const randomPwd = randomBytes(32).toString('hex')
    const passwordHash = await bcrypt.hash(randomPwd, 10)

    const { rows: created } = await db.query<{ id: string }>(
      `INSERT INTO users (username, email, password, email_verified, is_system, bio, avatar)
       VALUES ($1, $2, $3, true, true, $4, NULL)
       ON CONFLICT (username) DO UPDATE SET is_system = true
       RETURNING id`,
      [
        BOT_USERNAME,
        BOT_EMAIL,
        passwordHash,
        'Bot de modération automatique. Ne se connecte pas, ne lit pas vos messages.',
      ]
    )
    if (!created[0]) {
      console.warn('[octoguard:welcome] failed to create bot user (no row returned)')
      return null
    }

    _botUserId = created[0].id

    // Joindre le bot à la communauté par défaut comme membre invisible
    const community = await db.query<{ id: string }>(
      `SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`
    )
    if (community.rows[0]) {
      await db.query(
        `INSERT INTO community_members (community_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING`,
        [community.rows[0].id, _botUserId]
      )
    }

    console.log(`[octoguard:welcome] bot user OctoGuard created (id=${_botUserId})`)
    return _botUserId
  } catch (err) {
    console.warn('[octoguard:welcome] ensureOctoGuardBotUser error:', err)
    return null
  }
}

/** Pour les tests : vide le cache. */
export function _resetBotUserCache(): void {
  _botUserId = null
}

// ─── Substitution variables ──────────────────────────────────────────────────

export interface SubstitutionCtx {
  username:      string
  userId:        string
  communityName: string
  rulesUrl?:     string | null
}

/** Substitue les variables {user}, {userMention}, etc. dans un template. Exposé pour tests. */
export function substituteVariables(template: string, ctx: SubstitutionCtx): string {
  return template
    .replace(/\{user\}/g,          ctx.username)
    .replace(/\{userMention\}/g,   `@${ctx.username}`)
    .replace(/\{communityName\}/g, ctx.communityName)
    .replace(/\{rulesUrl\}/g,      ctx.rulesUrl ?? '')
}

// ─── runWelcomeFor : exécuté après chaque inscription ────────────────────────

/**
 * Lit la config welcome (singleton) et applique les actions configurées
 * pour le nouvel utilisateur. Fire-and-forget, jamais throw.
 */
export async function runWelcomeFor(newUserId: string, newUsername: string): Promise<void> {
  try {
    const { rows: cfgRows } = await db.query<WelcomeRow>(
      `SELECT id, channel_id, public_message, dm_message, dm_enabled,
              auto_grade_id, enabled,
              updated_at::text AS updated_at
         FROM octoguard_welcome WHERE id = 1`
    )
    const cfg = cfgRows[0]
    if (!cfg || !cfg.enabled) return  // welcome désactivé, rien à faire

    // Récupère le nom de la communauté pour la substitution
    const { rows: commRows } = await db.query<{ id: string; name: string; community_id: string }>(
      `SELECT cm.community_id AS id, c.name
         FROM community_members cm JOIN communities c ON c.id = cm.community_id
        WHERE cm.user_id = $1 LIMIT 1`,
      [newUserId]
    )
    const community = commRows[0]
    if (!community) return  // pas dans une communauté, skip

    const subCtx: SubstitutionCtx = {
      username:      newUsername,
      userId:        newUserId,
      communityName: community.name,
      rulesUrl:      null,  // à exposer plus tard via une URL communautaire
    }

    const eventId = randomUUID()

    // 1. Auto-grade : applique le grade configuré au nouveau membre.
    if (cfg.auto_grade_id) {
      await db.query(
        `UPDATE community_members SET grade_id = $1
          WHERE user_id = $2 AND community_id = $3`,
        [cfg.auto_grade_id, newUserId, community.id]
      ).catch(err => console.warn('[octoguard:welcome] auto-grade failed:', err))
    }

    // 2. Message public dans channel : nécessite le user fantôme.
    if (cfg.channel_id && cfg.public_message) {
      const botId = await ensureOctoGuardBotUser()
      if (botId) {
        const content = substituteVariables(cfg.public_message, subCtx)
        await db.query(
          `INSERT INTO channel_messages (channel_id, author_id, content)
           VALUES ($1, $2, $3)`,
          [cfg.channel_id, botId, content]
        ).catch(err => console.warn('[octoguard:welcome] channel_messages INSERT failed:', err))
      }
    }

    // 3. Log audit
    logOctoGuardAction({
      action:       'octoguard.welcome_sent',
      target_type:  'user',
      target_id:    newUserId,
      target_label: newUsername,
      metadata: {
        event_id:      eventId,
        actor:         'octoguard:auto',
        channel_id:    cfg.channel_id,
        auto_grade_id: cfg.auto_grade_id,
        community_id:  community.id,
      },
    })
  } catch (err) {
    console.warn('[octoguard:welcome] runWelcomeFor error (non-fatal):', err)
  }
}
