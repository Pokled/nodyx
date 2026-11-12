/**
 * OctoGuard routes API.
 * Spec : docs/specs/016-Octoguard/016-OctoGuard.md v2.1.1
 *
 * Deux plugins exportés :
 *  - octoguardAdminPlugin : préfixe /api/v1/admin/octoguard (manage_octoguard ;
 *    sourdines et signalements : moderate_members, cf services/permissions.ts).
 *    CRUD règles, welcome, commandes, mutes, reports, webhook + logs.
 *  - reportsPublicPlugin : préfixe /api/v1/reports (requireAuth).
 *    POST pour signaler du contenu, avec anti-abuse rate-limit + cooldown.
 *
 * Conventions :
 *  - Validation Zod sur tous les body.
 *  - Patterns regex validés via assessPatternSafety() amont.
 *  - Toute mutation invalide les caches RAM correspondants.
 *  - Les logs des actions admin manuelles vont dans admin_audit_log via
 *    le helper logAction() existant (actor_id = admin user). Distinct
 *    des logs OctoGuard auto (actor_username = 'octoguard:auto').
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, redis } from '../config/database'
import { requirePermission, requireAnyPermission } from '../middleware/permissions'
import { getInstanceAccess, outranks, rankOf } from '../services/permissions'
import { getInstanceCommunityId } from '../middleware/adminOnly'
import { runSandbox, ruleStats, ruleHits } from '../services/octoguard/sandbox'
import { replayRule } from '../services/octoguard/replay'
import { BASE_PRESETS, BASE_PROFILE_VERSION, startingLevel, exportProfile, previewImport, applyImport, ProfileZ, type Profile } from '../services/octoguard/profile'
import { checkRuleParams } from '../services/octoguard/params'
import { planLearning, ACTED_BY_ENGINE, type LogMeta } from '../services/octoguard/falsePositive'
import { reportContext, heldContext } from '../services/octoguard/context'
import { listPending, countPending, approveHeld, refuseHeld, listMine, forAuthor, HELD_EXPIRY_HOURS } from '../services/octoguard/held'
import { resolveReportTarget, type ReportTargetType as ResolvableTarget } from '../services/reports'
import { closeReports } from '../services/octoguard/reportClose'
import { SANCTIONS, FORGET_CHOICES, countBanCapable, getLadderSettings, saveLadderSettings, memberLadder, applyLadder, approveLadder, refuseLadder, undoLadder } from '../services/octoguard/ladder'
import { listMine as listMyDecisions, fileAppeal, listAppeals, decideAppeal, APPEAL_DAYS, APPEAL_MIN, APPEAL_MAX, REPLY_MAX } from '../services/octoguard/appeals'
import * as NotificationModel from '../models/notification'
import * as PostModel from '../models/post'
import * as ThreadModel from '../models/thread'
import { awardPoints, REPUTATION } from '../models/reputation'
import { io } from '../socket/io'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import {
  reloadRules, assessPatternSafety,
  applyMute, removeMute, isUserMuted, hasRE2,
  getWebhookConfig, setWebhookConfig, invalidateWebhookConfig,
} from '../services/octoguard'
import { checkOutboundUrl, OutboundBlocked, webhookAllowsPrivate } from '../utils/ssrfGuard'

/** Un identifiant de la base (UUID), vérifié AVANT toute requête. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const Duration = z.object({
  value: z.number().int().positive(),
  unit:  z.enum(['m', 'h', 'd', 'w', 'M']),
}).nullable()

const RuleParams = z.object({}).passthrough()

const RuleType   = z.enum(['regex', 'caps', 'link_domain', 'mention_spam', 'link_spam', 'keywords', 'flood', 'zalgo'])
const RuleAction = z.enum(['delete', 'warn', 'mute', 'ban_temp', 'notify_only', 'report_only', 'hold'])

const Escalation = z.object({
  warns_threshold: z.number().int().positive(),
  window_days:     z.number().int().positive(),
  action:          RuleAction,
  duration:        Duration.optional(),
}).nullable()

const CreateRuleBody = z.object({
  name:                  z.string().min(1).max(100),
  type:                  RuleType,
  params:                RuleParams,
  action:                RuleAction,
  action_duration:       Duration.optional(),
  escalation:            Escalation.optional(),
  immunized_role_types:  z.array(z.string()).optional(),
  immunized_grade_ids:   z.array(z.string().uuid()).optional(),
  dry_run:               z.boolean().optional(),
  enabled:               z.boolean().optional(),
  // Où la règle s'applique (OctoGuard 2) : au moins un endroit
  scopes:                z.array(z.enum(['chat', 'forum', 'profile', 'poll', 'wiki'])).min(1).max(5).optional(),
  // Restrictions : ne viser que les comptes récents (OctoGuard 2)
  conditions:            z.object({ account_max_age_days: z.number().int().min(1).max(365).optional() }).optional(),
  // Au cran Avertir : suivre le barème des sanctions au lieu de l'escalade propre (D28)
  follow_ladder:         z.boolean().optional(),
})

const UpdateRuleBody = CreateRuleBody.partial()

// Une règle à expression régulière ne s'active jamais sans re2 : sans lui, une
// expression piégée peut geler le serveur (CDC OctoGuard 2, E4a).
function re2Missing(type: string | undefined, enabled: boolean | undefined): boolean {
  return type === 'regex' && enabled !== false && !hasRE2()
}
const RE2_REQUIRED = { error: 'Regex rules need the re2 engine, which is not installed on this server', code: 'RE2_REQUIRED' }

const WelcomeBody = z.object({
  channel_id:      z.string().uuid().nullable().optional(),
  public_message:  z.string().max(2000).nullable().optional(),
  dm_message:      z.string().max(2000).nullable().optional(),
  dm_enabled:      z.boolean().optional(),
  auto_grade_id:   z.string().uuid().nullable().optional(),
  enabled:         z.boolean().optional(),
})

const CommandBody = z.object({
  command:          z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i),
  response:         z.string().min(1).max(4000),
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  allowed_channels: z.array(z.string().uuid()).nullable().optional(),
  allowed_roles:    z.array(z.string()).nullable().optional(),
  enabled:          z.boolean().optional(),
})

const UpdateCommandBody = CommandBody.partial()

const MuteBody = z.object({
  user_id:    z.string().uuid(),
  channel_id: z.string().uuid().nullable().optional(),
  duration:   Duration.optional(),
  reason:     z.string().max(500).optional(),
})

const WebhookBody = z.object({
  url:     z.string().url().nullable().optional(),
  secret:  z.string().min(8).max(256).nullable().optional(),
  enabled: z.boolean().optional(),
})

const ReportTargetType = z.enum(['message', 'user', 'thread', 'post', 'dm_message'])
const ReportCategory   = z.enum(['spam', 'harassment', 'hate', 'illegal', 'other'])

// Le motif (category) est obligatoire, la précision (reason) facultative.
// Format UUID tel que PostgreSQL l'accepte : z.string().uuid() (Zod 4) exige
// les bits de version RFC et refusait les contenus créés par les données de
// démonstration (identifiants « b1000004-0003-0000-... »), pourtant bien réels.
const AnyUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID')

const CreateReportBody = z.object({
  target_type: ReportTargetType,
  target_id:   AnyUuid,
  reason:      z.string().max(1000).optional(),
  category:    ReportCategory,
})

// Traiter un dossier : le prendre en charge (claim), ou le clore (status),
// éventuellement en supprimant le contenu signalé (delete_content).
const PatchReportBody = z.object({
  claim:          z.boolean().optional(),
  status:         z.enum(['reviewed', 'dismissed', 'actioned']).optional(),
  resolution:     z.string().max(1000).optional(),
  delete_content: z.boolean().optional(),
}).refine(b => b.claim === true || b.status !== undefined, { message: 'claim or status required' })

// ─── Helper : audit log pour actions admin manuelles ─────────────────────────

async function logAdminAction(
  actorId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  targetLabel: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { rows } = await db.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1`, [actorId]
    )
    const actorUsername = rows[0]?.username ?? 'unknown'
    await db.query(
      `INSERT INTO admin_audit_log (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actorId, actorUsername, action, targetType, targetId, targetLabel, JSON.stringify(metadata)]
    )
  } catch { /* never fail */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN PLUGIN — préfixe /api/v1/admin/octoguard
// ═══════════════════════════════════════════════════════════════════════════

// Qui peut quoi dans OctoGuard (CDC modération, E1) : régler OctoGuard =
// manage_octoguard ; les sourdines et les signalements sont du travail de
// modération des membres (moderate_members), ouvert aussi à manage_octoguard.
const MEMBER_MODERATION_ROUTES = /^\/api\/v1\/admin\/octoguard\/(mutes|mute-check|held|reports(?!\/settings)|ladder(?!\/settings)|appeals)(\/|$)/
// Le barème : toute l'équipe le LIT (la jauge), seul manage_octoguard le RÈGLE
const LADDER_SETTINGS_ROUTE = /^\/api\/v1\/admin\/octoguard\/ladder\/settings$/
const guardMemberModeration = requireAnyPermission('moderate_members', 'manage_octoguard')
const guardOctoguard = requirePermission('manage_octoguard')

// Supprime le contenu d'un signalement, comme le ferait le bouton du forum
// ou du chat (mêmes effets : réputation, diffusion temps réel).
async function deleteReportedContent(type: string, id: string): Promise<boolean> {
  if (type === 'post') {
    const post = await PostModel.getAuthorAndThread(id)
    if (!post) return true // déjà supprimé : rien à faire
    await PostModel.removeById(id)
    await awardPoints(post.author_id, -REPUTATION.REPLY)
    return true
  }
  if (type === 'thread') {
    const thread = await ThreadModel.findById(id)
    if (!thread) return true
    await ThreadModel.remove(id)
    await awardPoints(thread.author_id, -REPUTATION.THREAD)
    return true
  }
  if (type === 'message') {
    const { rows } = await db.query<{ channel_id: string }>(
      `UPDATE channel_messages SET is_deleted = true, content = ''
        WHERE id = $1 AND is_deleted = false RETURNING channel_id`, [id])
    if (rows[0] && io) io.to(`channel:${rows[0].channel_id}`).emit('chat:message_deleted', { messageId: id })
    return true
  }
  return false // un profil ne se « supprime » pas d'ici
}

export async function octoguardAdminPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url
    if (LADDER_SETTINGS_ROUTE.test(route) && request.method === 'GET') return guardMemberModeration(request, reply)
    return MEMBER_MODERATION_ROUTES.test(route)
      ? guardMemberModeration(request, reply)
      : guardOctoguard(request, reply)
  })

  // ─── Settings (état global) ───────────────────────────────────────────────

  app.get('/settings', async (_request, reply) => {
    const og = await import('../services/octoguard')
    return reply.send({
      enabled:        og.isOctoGuardEnabled(),
      locked_off:     og.isOctoGuardLockedOff(),
      latency:        (await import('../services/octoguard/pipeline')).pipelineLatency(),
      re2_active:     (await import('../services/octoguard')).hasRE2(),
      hate_filter:    process.env.NODYX_HATE_FILTER_ENABLED !== 'false',
    })
  })

  // L'interrupteur général (lot 9, D24) : effet immédiat, journalisé.
  // Refusé si le serveur a verrouillé OctoGuard (OCTOGUARD_FORCE_OFF).
  app.put('/settings', {
    preHandler: [rateLimit, validate({ body: z.object({ enabled: z.boolean() }) })],
  }, async (request, reply) => {
    const { enabled } = request.body as { enabled: boolean }
    const og = await import('../services/octoguard')
    if (enabled && og.isOctoGuardLockedOff()) {
      return reply.code(409).send({ error: 'OctoGuard is locked off by the server (OCTOGUARD_FORCE_OFF)', code: 'OCTOGUARD_LOCKED_OFF' })
    }
    const { setSettings } = await import('../config/settings')
    const res = await setSettings({ OCTOGUARD_ENABLED: enabled ? 'true' : 'false' }, request.user!.userId)
    if (Object.keys(res.errors ?? {}).length) {
      return reply.code(400).send({ error: 'Could not save the setting', code: 'SETTING_INVALID' })
    }
    if (enabled) await og.reloadRules()
    await logAdminAction(request.user!.userId, enabled ? 'octoguard.enabled' : 'octoguard.disabled', null, null, null, {})
    return reply.send({ enabled: og.isOctoGuardEnabled() })
  })

  // ─── OctoGuard 2 : bac à sable, chiffres, profils (E4b) ───────────────────

  // Tester un message contre toutes les règles, sans aucun effet de bord
  app.post('/sandbox', {
    preHandler: [rateLimit, validate({ body: z.object({
      content:          z.string().min(1).max(5000),
      surface:          z.enum(['chat', 'forum', 'profile', 'poll', 'wiki']).default('chat'),
      account_age_days: z.number().min(0).max(36_500).optional(),
      role:             z.enum(['member', 'moderator', 'admin', 'owner']).optional(),
    }) })],
  }, async (request, reply) => {
    const b = request.body as { content: string; surface: 'chat'; account_age_days?: number; role?: string }
    return reply.send(await runSandbox({ content: b.content, surface: b.surface, accountAgeDays: b.account_age_days, role: b.role }))
  })

  // Ce que chaque règle a fait, et aurait fait, sur N jours
  app.get('/stats', async (request, reply) => {
    const q = request.query as { days?: string }
    return reply.send(await ruleStats(Number(q.days ?? 7)))
  })

  // Les derniers déclenchements d'une règle (« voir lesquels »)
  // Lot 11 (D26) : rejouer une règle sur 30 jours, sans rien toucher.
  // Un seul rejeu à la fois sur l'instance, et un délai par admin : c'est un
  // calcul lourd lancé à la main.
  let replayRunning = false
  app.post('/rules/:id/replay', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    }
    const actor = request.user!.userId
    const cool = await redis.set(`octoguard:replay:${actor}`, '1', 'EX', 10, 'NX').catch(() => 'OK')
    if (cool === null) return reply.code(429).send({ error: 'Wait a few seconds before replaying again', code: 'REPLAY_COOLDOWN' })
    if (replayRunning) return reply.code(429).send({ error: 'A replay is already running', code: 'REPLAY_BUSY' })
    const { rows } = await db.query(
      `SELECT id, name, type, params, action, action_duration, escalation, immunized_role_types, immunized_grade_ids,
              dry_run, enabled, scopes, preset_key, customized, conditions, created_at::text, updated_at::text
         FROM octoguard_automod_rules WHERE id = $1`, [id])
    const r = rows[0]
    if (!r) return reply.code(404).send({ error: 'Rule not found', code: 'NOT_FOUND' })
    const rule = {
      ...r, params: r.params ?? {}, immunized_role_types: r.immunized_role_types ?? [], immunized_grade_ids: r.immunized_grade_ids ?? [],
      scopes: r.scopes?.length ? r.scopes : ['chat'], conditions: r.conditions ?? {},
    }
    replayRunning = true
    try {
      return reply.send({ rule: { id: r.id, name: r.name, action: r.action, dry_run: r.dry_run }, ...(await replayRule(rule)) })
    } finally {
      replayRunning = false
    }
  })

  app.get('/rules/:id/hits', async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = request.query as { limit?: string }
    return reply.send({ hits: await ruleHits(id, Number(q.limit ?? 20)) })
  })

  // Le catalogue du profil de base, avec ce qui est installé
  app.get('/profile/base', async (_request, reply) => {
    const { rows } = await db.query<{ preset_key: string; customized: boolean }>(
      `SELECT preset_key, customized FROM octoguard_automod_rules WHERE preset_key IS NOT NULL`)
    const installed = new Map(rows.map(r => [r.preset_key, r.customized]))
    return reply.send({
      version: BASE_PROFILE_VERSION,
      presets: BASE_PRESETS.map(p => ({ ...p, installed: installed.has(p.key), customized: installed.get(p.key) ?? false })),
    })
  })

  // Réinstaller un modèle supprimé (au cran de départ d'une instance existante, D12)
  app.post('/profile/base/:key', { preHandler: [rateLimit] }, async (request, reply) => {
    const { key } = request.params as { key: string }
    const preset = BASE_PRESETS.find(p => p.key === key)
    if (!preset) return reply.code(404).send({ error: 'Unknown preset', code: 'NOT_FOUND' })
    const lvl = startingLevel(preset, true)
    const { rows } = await db.query(
      `INSERT INTO octoguard_automod_rules
         (name, type, params, action, action_duration, escalation, immunized_role_types,
          dry_run, enabled, scopes, conditions, preset_key, customized)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, ARRAY['owner','admin','moderator'],
               $7, $8, $9::text[], $10::jsonb, $11, false)
       ON CONFLICT (preset_key) WHERE preset_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [preset.name[(process.env.NODYX_COMMUNITY_LANGUAGE ?? 'fr').startsWith('fr') ? 'fr' : 'en'], preset.type,
       JSON.stringify(preset.params), lvl.action, JSON.stringify(preset.action_duration ?? null),
       JSON.stringify(preset.escalation ?? null), lvl.dry_run, preset.enabled ?? true, preset.scopes,
       JSON.stringify(preset.conditions ?? {}), preset.key])
    if (!rows[0]) return reply.code(409).send({ error: 'Already installed', code: 'ALREADY_INSTALLED' })
    await reloadRules()
    await logAdminAction(request.user!.userId, 'octoguard.rule_created', 'rule', rows[0].id, rows[0].name, { preset: key })
    return reply.code(201).send({ rule: rows[0] })
  })

  // Exporter les règles en profil partageable
  app.get('/profile/export', async (request, reply) => {
    const q = request.query as { name?: string }
    const profile = await exportProfile((q.name ?? process.env.NODYX_COMMUNITY_NAME ?? 'Nodyx').slice(0, 100))
    return reply
      .header('Content-Disposition', 'attachment; filename="octoguard-profile.json"')
      .send(profile)
  })

  // Ce qu'un import changerait (aucun effet de bord)
  app.post('/profile/preview', {
    preHandler: [rateLimit, validate({ body: z.object({ profile: ProfileZ }) })],
  }, async (request, reply) => {
    const { profile } = request.body as { profile: Profile }
    return reply.send({ preview: await previewImport(profile) })
  })

  // Importer un profil : ajoute et met à jour, ne supprime jamais rien
  app.post('/profile/import', {
    preHandler: [rateLimit, validate({ body: z.object({ profile: ProfileZ }) })],
  }, async (request, reply) => {
    const { profile } = request.body as { profile: Profile }
    const result = await applyImport(profile)
    await reloadRules()
    await logAdminAction(request.user!.userId, 'octoguard.profile_imported', null, null, profile.name, {
      added: result.add.length, updated: result.update.length, refused: result.problems.length,
    })
    return reply.send({ result })
  })

  // ─── Rules CRUD (Module 1 Auto-mod) ───────────────────────────────────────

  app.get('/rules', async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT * FROM octoguard_automod_rules ORDER BY created_at ASC`
    )
    return reply.send({ rules: rows })
  })

  app.post('/rules', {
    preHandler: [rateLimit, validate({ body: CreateRuleBody })],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof CreateRuleBody>
    const adminUser = request.user!

    if (re2Missing(body.type, body.enabled)) return reply.code(409).send(RE2_REQUIRED)

    // Réglages vérifiés par type : une valeur absurde ferait prendre tous les messages.
    const badParams = checkRuleParams(body.type, body.params)
    if (badParams) return reply.code(400).send({ error: `Invalid rule settings: ${badParams.field} (${badParams.message})`, code: 'INVALID_PARAMS', field: badParams.field })

    // Validation amont des patterns regex via safe-regex + re2
    if (body.type === 'regex') {
      const pattern = (body.params as { pattern?: string }).pattern
      if (typeof pattern !== 'string') {
        return reply.code(400).send({ error: 'regex rule requires params.pattern', code: 'INVALID' })
      }
      const flags = (body.params as { flags?: string }).flags ?? 'i'
      const assess = assessPatternSafety(pattern, flags)
      if (!assess.valid) {
        return reply.code(400).send({
          error: assess.reason ?? 'pattern invalide',
          code:  'PATTERN_REJECTED',
          assessment: assess,
        })
      }
    }

    const { rows } = await db.query(
      `INSERT INTO octoguard_automod_rules
         (name, type, params, action, action_duration, escalation,
          immunized_role_types, immunized_grade_ids, dry_run, enabled, scopes, conditions, follow_ladder)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb,
               COALESCE($7, ARRAY['owner','admin','moderator']),
               COALESCE($8, '{}'::uuid[]),
               COALESCE($9, false), COALESCE($10, true),
               COALESCE($11::text[], '{chat}'), COALESCE($12::jsonb, '{}'::jsonb), COALESCE($13, false))
       RETURNING *`,
      [
        body.name, body.type, JSON.stringify(body.params), body.action,
        JSON.stringify(body.action_duration ?? null),
        JSON.stringify(body.escalation ?? null),
        body.immunized_role_types ?? null,
        body.immunized_grade_ids ?? null,
        body.dry_run ?? null,
        body.enabled ?? null,
        body.scopes ?? null,
        body.conditions ? JSON.stringify(body.conditions) : null,
        body.follow_ladder ?? null,
      ]
    )

    await reloadRules()
    await logAdminAction(adminUser.userId, 'octoguard.rule_created', 'rule', rows[0].id, body.name, { type: body.type, action: body.action })
    return reply.code(201).send({ rule: rows[0] })
  })

  app.put('/rules/:id', {
    preHandler: [rateLimit, validate({ body: UpdateRuleBody })],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as z.infer<typeof UpdateRuleBody>
    const adminUser = request.user!

    if (!hasRE2()) {
      const { rows: cur } = await db.query<{ type: string; enabled: boolean }>(
        `SELECT type, enabled FROM octoguard_automod_rules WHERE id = $1`, [id])
      if (cur[0] && re2Missing(body.type ?? cur[0].type, body.enabled ?? cur[0].enabled)) {
        return reply.code(409).send(RE2_REQUIRED)
      }
    }

    // Réglages vérifiés par type, contre le type final de la règle.
    if (body.params !== undefined || body.type !== undefined) {
      const { rows: cur } = await db.query<{ type: string; params: unknown }>(
        `SELECT type, params FROM octoguard_automod_rules WHERE id = $1`, [id])
      if (!cur[0]) return reply.code(404).send({ error: 'Rule not found', code: 'NOT_FOUND' })
      const badParams = checkRuleParams(body.type ?? cur[0].type, body.params ?? cur[0].params)
      if (badParams) return reply.code(400).send({ error: `Invalid rule settings: ${badParams.field} (${badParams.message})`, code: 'INVALID_PARAMS', field: badParams.field })
    }

    // Re-validation regex si pattern modifié
    if (body.type === 'regex' || body.params) {
      const pattern = (body.params as { pattern?: string } | undefined)?.pattern
      if (typeof pattern === 'string') {
        const flags = (body.params as { flags?: string }).flags ?? 'i'
        const assess = assessPatternSafety(pattern, flags)
        if (!assess.valid) {
          return reply.code(400).send({
            error: assess.reason ?? 'pattern invalide',
            code:  'PATTERN_REJECTED',
            assessment: assess,
          })
        }
      }
    }

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1
    const set = (col: string, val: unknown, json = false) => {
      fields.push(`${col} = $${i}::${json ? 'jsonb' : 'text'}` + (col.endsWith('_at') ? '::timestamptz' : ''))
      values.push(json ? JSON.stringify(val) : val)
      i++
    }

    if (body.name !== undefined)            { fields.push(`name = $${i++}`);                       values.push(body.name) }
    if (body.type !== undefined)            { fields.push(`type = $${i++}`);                       values.push(body.type) }
    if (body.params !== undefined)          { fields.push(`params = $${i++}::jsonb`);              values.push(JSON.stringify(body.params)) }
    if (body.action !== undefined)          { fields.push(`action = $${i++}`);                     values.push(body.action) }
    if (body.action_duration !== undefined) { fields.push(`action_duration = $${i++}::jsonb`);    values.push(JSON.stringify(body.action_duration)) }
    if (body.escalation !== undefined)      { fields.push(`escalation = $${i++}::jsonb`);         values.push(JSON.stringify(body.escalation)) }
    if (body.immunized_role_types !== undefined) { fields.push(`immunized_role_types = $${i++}`); values.push(body.immunized_role_types) }
    if (body.immunized_grade_ids !== undefined)  { fields.push(`immunized_grade_ids = $${i++}`);  values.push(body.immunized_grade_ids) }
    if (body.dry_run !== undefined)         { fields.push(`dry_run = $${i++}`);                    values.push(body.dry_run) }
    if (body.enabled !== undefined)         { fields.push(`enabled = $${i++}`);                    values.push(body.enabled) }
    if (body.scopes !== undefined)          { fields.push(`scopes = $${i++}::text[]`);            values.push(body.scopes) }
    if (body.conditions !== undefined)      { fields.push(`conditions = $${i++}::jsonb`);         values.push(JSON.stringify(body.conditions)) }
    if (body.follow_ladder !== undefined)   { fields.push(`follow_ladder = $${i++}`);              values.push(body.follow_ladder) }
    // Une règle issue d'un modèle du profil de base, modifiée sur le fond par
    // l'admin, devient « personnalisée » : les mises à jour du profil n'y
    // touchent plus. L'interrupteur seul ne compte pas comme une modification.
    const substantive = ['type', 'params', 'action', 'action_duration', 'escalation', 'immunized_role_types', 'immunized_grade_ids', 'dry_run', 'scopes', 'conditions', 'follow_ladder']
      .some(k => (body as Record<string, unknown>)[k] !== undefined)
    if (substantive) fields.push(`customized = (preset_key IS NOT NULL)`)
    fields.push(`updated_at = NOW()`)
    void set  // suppress unused

    if (fields.length === 1) return reply.code(400).send({ error: 'Nothing to update' })

    values.push(id)
    const { rows } = await db.query(
      `UPDATE octoguard_automod_rules SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Rule not found' })

    await reloadRules()
    await logAdminAction(adminUser.userId, 'octoguard.rule_updated', 'rule', id, rows[0].name)
    return reply.send({ rule: rows[0] })
  })

  app.delete('/rules/:id', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminUser = request.user!
    const { rows } = await db.query(
      `DELETE FROM octoguard_automod_rules WHERE id = $1 RETURNING name`,
      [id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Rule not found' })

    await reloadRules()
    await logAdminAction(adminUser.userId, 'octoguard.rule_deleted', 'rule', id, rows[0].name)
    return reply.send({ ok: true })
  })

  // ─── Welcome config (Module 2) ────────────────────────────────────────────

  app.get('/welcome', async (_request, reply) => {
    const { rows } = await db.query(`SELECT * FROM octoguard_welcome WHERE id = 1`)
    return reply.send({ welcome: rows[0] ?? null })
  })

  app.put('/welcome', {
    preHandler: [rateLimit, validate({ body: WelcomeBody })],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof WelcomeBody>
    const adminUser = request.user!
    const { rows } = await db.query(
      `UPDATE octoguard_welcome
          SET channel_id     = COALESCE($1, channel_id),
              public_message = COALESCE($2, public_message),
              dm_message     = COALESCE($3, dm_message),
              dm_enabled     = COALESCE($4, dm_enabled),
              auto_grade_id  = COALESCE($5, auto_grade_id),
              enabled        = COALESCE($6, enabled),
              updated_at     = NOW()
        WHERE id = 1
        RETURNING *`,
      [
        body.channel_id ?? null,
        body.public_message ?? null,
        body.dm_message ?? null,
        body.dm_enabled ?? null,
        body.auto_grade_id ?? null,
        body.enabled ?? null,
      ]
    )
    await logAdminAction(adminUser.userId, 'octoguard.welcome_updated', 'welcome', null, null, { enabled: rows[0]?.enabled })
    return reply.send({ welcome: rows[0] })
  })

  // ─── Commands CRUD (Module 3) ─────────────────────────────────────────────

  app.get('/commands', async (_request, reply) => {
    const { rows } = await db.query(`SELECT * FROM octoguard_commands ORDER BY command ASC`)
    return reply.send({ commands: rows })
  })

  app.post('/commands', {
    preHandler: [rateLimit, validate({ body: CommandBody })],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof CommandBody>
    const adminUser = request.user!
    try {
      const { rows } = await db.query(
        `INSERT INTO octoguard_commands
           (command, response, cooldown_seconds, allowed_channels, allowed_roles, enabled)
         VALUES (LOWER($1), $2, COALESCE($3, 5), $4, $5, COALESCE($6, true))
         RETURNING *`,
        [
          body.command, body.response,
          body.cooldown_seconds ?? null,
          body.allowed_channels ?? null,
          body.allowed_roles ?? null,
          body.enabled ?? null,
        ]
      )
      await logAdminAction(adminUser.userId, 'octoguard.command_created', 'command', rows[0].id, rows[0].command)
      return reply.code(201).send({ command: rows[0] })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'Une commande avec ce nom existe déjà', code: 'CONFLICT' })
      }
      throw err
    }
  })

  app.put('/commands/:id', {
    preHandler: [rateLimit, validate({ body: UpdateCommandBody })],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as z.infer<typeof UpdateCommandBody>
    const adminUser = request.user!
    const { rows } = await db.query(
      `UPDATE octoguard_commands
          SET command          = COALESCE(LOWER($1), command),
              response         = COALESCE($2, response),
              cooldown_seconds = COALESCE($3, cooldown_seconds),
              allowed_channels = COALESCE($4, allowed_channels),
              allowed_roles    = COALESCE($5, allowed_roles),
              enabled          = COALESCE($6, enabled),
              updated_at       = NOW()
        WHERE id = $7
        RETURNING *`,
      [
        body.command ?? null, body.response ?? null,
        body.cooldown_seconds ?? null,
        body.allowed_channels ?? null,
        body.allowed_roles ?? null,
        body.enabled ?? null,
        id,
      ]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Command not found' })
    await logAdminAction(adminUser.userId, 'octoguard.command_updated', 'command', id, rows[0].command)
    return reply.send({ command: rows[0] })
  })

  app.delete('/commands/:id', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const adminUser = request.user!
    const { rows } = await db.query(
      `DELETE FROM octoguard_commands WHERE id = $1 RETURNING command`,
      [id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Command not found', code: 'NOT_FOUND' })
    await logAdminAction(adminUser.userId, 'octoguard.command_deleted', 'command', id, rows[0].command)
    return reply.send({ ok: true })
  })

  // ─── Mutes (Module 6) ─────────────────────────────────────────────────────

  app.get('/mutes', async (request, reply) => {
    const q = request.query as { active?: string; user_id?: string }
    const conditions: string[] = []
    const params: unknown[] = []
    let i = 1
    if (q.active === 'true') {
      conditions.push(`(expires_at IS NULL OR expires_at > NOW())`)
    }
    if (q.user_id) {
      conditions.push(`user_id = $${i++}`)
      params.push(q.user_id)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const { rows } = await db.query(
      `SELECT cm.*, u.username AS user_username,
              -- La sourdine posée par le barème : son étape (l'écran affiche « Barème, étape 2 »)
              (SELECT l.step FROM octoguard_ladder l WHERE l.mute_id = cm.id AND l.status = 'applied' LIMIT 1) AS ladder_step
         FROM chat_mutes cm
         JOIN users u ON u.id = cm.user_id
         ${where}
        ORDER BY cm.applied_at DESC
        LIMIT 200`,
      params
    )
    return reply.send({ mutes: rows })
  })

  app.post('/mutes', {
    preHandler: [rateLimit, validate({ body: MuteBody })],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof MuteBody>
    const adminUser = request.user!
    // Garde-fou de rang : sous le rang d'admin, on ne met en sourdine qu'un rang inférieur
    const actor = request.access
    if (!actor) return reply.code(403).send({ error: 'Missing permission', code: 'FORBIDDEN' })
    if (actor.rank < rankOf('admin')) {
      const target = await getInstanceAccess(body.user_id)
      if (target.role === 'owner' || !outranks(actor, target.role)) {
        return reply.code(403).send({ error: 'Cannot act on a member of equal or higher rank', code: 'RANK_TOO_LOW' })
      }
    }
    const row = await applyMute({
      userId:    body.user_id,
      channelId: body.channel_id ?? null,
      duration:  body.duration ?? null,
      reason:    body.reason ?? null,
      appliedBy: adminUser.userId,
    })
    if (!row) return reply.code(500).send({ error: 'Failed to apply mute' })
    return reply.code(201).send({ mute: row })
  })

  app.delete('/mutes/:id', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const adminUser = request.user!
    // Même garde-fou de rang que pour POSER une sourdine : sous le rang d'admin,
    // on ne lève que celle d'un membre de rang inférieur. Avant (relu le 08/11),
    // lever ne vérifiait rien : un modérateur pouvait lever la sourdine qu'un
    // admin avait posée sur un autre modérateur.
    const { rows } = await db.query<{ user_id: string }>(`SELECT user_id FROM chat_mutes WHERE id = $1`, [id])
    if (!rows[0]) return reply.code(404).send({ error: 'Mute not found', code: 'NOT_FOUND' })
    const actor = request.access
    if (!actor) return reply.code(403).send({ error: 'Missing permission', code: 'FORBIDDEN' })
    if (actor.rank < rankOf('admin')) {
      const target = await getInstanceAccess(rows[0].user_id)
      if (target.role === 'owner' || !outranks(actor, target.role)) {
        return reply.code(403).send({ error: 'Cannot act on a member of equal or higher rank', code: 'RANK_TOO_LOW' })
      }
    }
    const ok = await removeMute(id, adminUser.userId)
    if (!ok) return reply.code(404).send({ error: 'Mute not found', code: 'NOT_FOUND' })
    return reply.send({ ok: true })
  })

  // ─── Logs (lecture admin_audit_log filtré octoguard.*) ────────────────────

  app.get('/logs', async (request, reply) => {
    const q = request.query as {
      action?: string; user_id?: string;
      from?: string; to?: string; page?: string; limit?: string;
    }
    const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10), 1), 200)
    const page  = Math.max(parseInt(q.page ?? '1', 10), 1)
    const offset = (page - 1) * limit

    const conditions: string[] = [`action LIKE 'octoguard.%'`]
    const params: unknown[] = []
    let i = 1
    if (q.action)  { conditions.push(`action = $${i++}`);           params.push(q.action) }
    if (q.user_id) { conditions.push(`target_id = $${i++}`);        params.push(q.user_id) }
    if (q.from)    { conditions.push(`created_at >= $${i++}`);      params.push(q.from) }
    if (q.to)      { conditions.push(`created_at <  $${i++}`);      params.push(q.to) }

    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const { rows } = await db.query(
      `SELECT id, actor_id, actor_username, action, target_type, target_id, target_label,
              metadata, created_at::text AS created_at,
              EXISTS (SELECT 1 FROM admin_audit_log u
                       WHERE u.action = 'octoguard.action_undone' AND u.target_id::text = admin_audit_log.id::text) AS undone,
              EXISTS (SELECT 1 FROM admin_audit_log u
                       WHERE u.action = 'octoguard.false_positive' AND u.target_id::text = admin_audit_log.id::text) AS false_positive,
              EXISTS (SELECT 1 FROM admin_audit_log u
                       WHERE u.action = 'octoguard.observed_normal' AND u.target_id::text = admin_audit_log.id::text) AS normal
         FROM admin_audit_log
         ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    )
    const { rows: countRows } = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM admin_audit_log ${whereClause}`,
      params
    )
    return reply.send({
      logs:  rows,
      total: parseInt(countRows[0]?.cnt ?? '0', 10),
      page,
      limit,
    })
  })


  type UndoResult = { ok: true } | { ok: false; status: number; code: string; error: string }
  /**
   * Annule une action d'OctoGuard (avertissement, sourdine). Partagé par
   * « Annuler » et « Faux positif » : une seule logique, testée une fois.
   */
  async function undoLogEntry(id: string, actorId: string): Promise<UndoResult> {
    const { rows } = await db.query(
      `SELECT action, metadata, created_at FROM admin_audit_log WHERE id = $1`, [id]
    )
    const log = rows[0]
    if (!log) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Log not found' }

    const meta = (log.metadata ?? {}) as { undoable?: boolean; rule_id?: string; undo_op?: { type?: string; mute_id?: string; user_id?: string } }
    if (!meta.undoable || !meta.undo_op) {
      return { ok: false, status: 400, code: 'NOT_UNDOABLE', error: 'Action not undoable' }
    }

    // Une action ne s'annule qu'une fois : sinon, un double clic effaçait un
    // SECOND avertissement, qui n'avait rien à voir.
    const { rows: done } = await db.query(
      `SELECT 1 FROM admin_audit_log WHERE action = 'octoguard.action_undone' AND target_id::text = $1 LIMIT 1`, [id])
    if (done.length) return { ok: false, status: 409, code: 'ALREADY_UNDONE', error: 'Already undone' }

    if (meta.undo_op.type === 'remove_mute' && meta.undo_op.mute_id) {
      const ok = await removeMute(meta.undo_op.mute_id, actorId)
      if (!ok) return { ok: false, status: 409, code: 'NOTHING_TO_UNDO', error: 'Nothing left to undo (mute already lifted)' }
      await logAdminAction(actorId, 'octoguard.action_undone', 'log', id, log.action, { undo_op: meta.undo_op, success: true })
      return { ok: true }
    }
    if (meta.undo_op.type === 'clear_last_warn' && meta.undo_op.user_id) {
      // PostgreSQL n'accepte ni ORDER BY ni LIMIT dans un UPDATE : l'ancienne
      // requête échouait TOUJOURS, l'erreur était avalée et la route répondait
      // « ok ». On efface l'avertissement actif de ce membre, pour cette règle,
      // le plus proche dans le temps de l'action annulée.
      const { rows: cleared } = await db.query(
        `UPDATE octoguard_warns SET cleared_at = NOW()
          WHERE id = (SELECT id FROM octoguard_warns
                       WHERE user_id = $1 AND cleared_at IS NULL AND ($2::uuid IS NULL OR rule_id = $2::uuid)
                       ORDER BY abs(extract(epoch FROM created_at - $3::timestamptz)) LIMIT 1)
          RETURNING id`,
        [meta.undo_op.user_id, meta.rule_id ?? null, log.created_at]
      )
      if (cleared.length === 0) return { ok: false, status: 409, code: 'NOTHING_TO_UNDO', error: 'Nothing left to undo (warning already cleared or expired)' }
      await logAdminAction(actorId, 'octoguard.action_undone', 'log', id, log.action, { undo_op: meta.undo_op, warn_id: cleared[0].id })
      return { ok: true }
    }
    if (meta.undo_op.type === 'ladder_undo' && (meta.undo_op as { ladder_id?: string }).ladder_id) {
      const ladderId = (meta.undo_op as { ladder_id: string }).ladder_id
      const r = await undoLadder({ userId: actorId, access: await getInstanceAccess(actorId) }, ladderId)
      if (!r.ok) return { ok: false, status: r.status, code: r.code === 'ALREADY_UNDONE' ? 'ALREADY_UNDONE' : r.code, error: r.error }
      await logAdminAction(actorId, 'octoguard.action_undone', 'log', id, log.action, { undo_op: meta.undo_op })
      return { ok: true }
    }
    return { ok: false, status: 400, code: 'UNSUPPORTED', error: 'Undo type not implemented' }
  }

  app.post('/logs/:id/undo', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    // Avant : un identifiant mal formé partait tel quel dans la requête (erreur 500)
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const r = await undoLogEntry(id, request.user!.userId)
    return r.ok ? reply.send({ ok: true }) : reply.code(r.status).send({ error: r.error, code: r.code })
  })

  // ─── Lot 10 (D25) : « Faux positif » et « C'était normal » ───────────────

  /**
   * Pose la marque (« faux positif » ou « c'était normal ») AVANT toute autre
   * écriture : c'est elle qui décide. L'index unique de la migration 133 garantit
   * qu'un second clic, même simultané, ne passe pas. null = déjà marqué.
   */
  async function claimMark(action: 'octoguard.false_positive' | 'octoguard.observed_normal', logId: string, actorId: string, label: string, meta: Record<string, unknown>): Promise<string | null> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO admin_audit_log (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
       SELECT $1, COALESCE((SELECT username FROM users WHERE id = $1), 'unknown'), $2, 'log', $3, $4, $5::jsonb
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [actorId, action, logId, label, JSON.stringify(meta)]
    )
    return rows[0]?.id ?? null
  }

  /** Lit une entrée du journal d'OctoGuard et ce qu'on sait déjà d'elle. */
  async function readEntry(id: string) {
    const { rows } = await db.query(
      `SELECT l.id, l.action, l.metadata, l.target_label,
              EXISTS (SELECT 1 FROM admin_audit_log u WHERE u.action = 'octoguard.action_undone'   AND u.target_id::text = l.id::text) AS undone,
              EXISTS (SELECT 1 FROM admin_audit_log u WHERE u.action = 'octoguard.false_positive'  AND u.target_id::text = l.id::text) AS false_positive,
              EXISTS (SELECT 1 FROM admin_audit_log u WHERE u.action = 'octoguard.observed_normal' AND u.target_id::text = l.id::text) AS normal
         FROM admin_audit_log l WHERE l.id = $1`, [id])
    return rows[0] as { id: string; action: string; metadata: LogMeta | null; target_label: string | null; undone: boolean; false_positive: boolean; normal: boolean } | undefined
  }
  async function ruleOf(meta: LogMeta | null) {
    if (!meta?.rule_id || !UUID_RE.test(meta.rule_id)) return null
    const { rows } = await db.query(`SELECT id, name, type, params FROM octoguard_automod_rules WHERE id = $1`, [meta.rule_id])
    return (rows[0] ?? null) as { id: string; name: string; type: string; params: { words?: string[]; exceptions?: string[] } } | null
  }

  // Ce que « Faux positif » va faire, AVANT que l'admin valide (rien n'est écrit)
  app.get('/logs/:id/false-positive', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const e = await readEntry(id)
    if (!e) return reply.code(404).send({ error: 'Log not found', code: 'NOT_FOUND' })
    if (!ACTED_BY_ENGINE.has(e.action) || e.metadata?.actor !== 'octoguard:auto') {
      return reply.code(400).send({ error: 'Only an action taken by OctoGuard can be a false positive', code: 'NOT_ENGINE_ACTION' })
    }
    const rule = await ruleOf(e.metadata)
    return reply.send({
      already: e.false_positive,
      will_undo: !!e.metadata?.undoable && !e.undone,
      rule: rule ? { id: rule.id, name: rule.name } : null,
      plan: planLearning(e.metadata ?? {}, rule),
    })
  })

  app.post('/logs/:id/false-positive', {
    preHandler: [rateLimit, validate({ body: z.object({ learn: z.boolean().default(false) }) })],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const { learn } = request.body as { learn: boolean }
    const actorId = request.user!.userId
    const e = await readEntry(id)
    if (!e) return reply.code(404).send({ error: 'Log not found', code: 'NOT_FOUND' })
    if (!ACTED_BY_ENGINE.has(e.action) || e.metadata?.actor !== 'octoguard:auto') {
      return reply.code(400).send({ error: 'Only an action taken by OctoGuard can be a false positive', code: 'NOT_ENGINE_ACTION' })
    }
    if (e.false_positive) return reply.code(409).send({ error: 'Already marked', code: 'ALREADY_MARKED' })
    const markId = await claimMark('octoguard.false_positive', id, actorId, e.action, { rule_id: e.metadata?.rule_id ?? null })
    if (!markId) return reply.code(409).send({ error: 'Already marked', code: 'ALREADY_MARKED' })

    // 1. Annuler ce qui peut l'être (avertissement, sourdine). Un refus de
    //    l'annulation (déjà levée) n'empêche pas de compter le faux positif.
    let undone = false
    if (e.metadata?.undoable && !e.undone) {
      const u = await undoLogEntry(id, actorId)
      undone = u.ok
    }

    // 2. Apprendre, seulement si l'admin l'a demandé ET que le cas est sûr
    //    (plan recalculé ici : jamais sur la foi du navigateur).
    const rule = await ruleOf(e.metadata)
    const plan = planLearning(e.metadata ?? {}, rule)
    let learned: string | null = null
    if (learn && plan.learn && rule) {
      // Ajout atomique, sans doublon, plafonné comme l'éditeur (500 exceptions)
      const { rows } = await db.query(
        `UPDATE octoguard_automod_rules
            SET params = jsonb_set(params, '{exceptions}',
                  COALESCE(params->'exceptions', '[]'::jsonb) || to_jsonb($2::text)),
                customized = true, updated_at = NOW()
          WHERE id = $1 AND type = 'keywords'
            AND NOT (COALESCE(params->'exceptions', '[]'::jsonb) ? $2::text)
            AND jsonb_array_length(COALESCE(params->'exceptions', '[]'::jsonb)) < 500
          RETURNING id`,
        [rule.id, plan.token]
      )
      if (rows.length) { learned = plan.token; await reloadRules() }
    }

    // 3. Compléter la marque (compte pour « Justesse ») avec ce qui a été fait
    await db.query(
      `UPDATE admin_audit_log SET metadata = metadata || $2::jsonb WHERE id = $1`,
      [markId, JSON.stringify({ undone, learned })]
    )
    return reply.send({ ok: true, undone, learned })
  })

  // « C'était normal » : une entrée d'observation était une fausse alerte
  app.post('/logs/:id/normal', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const e = await readEntry(id)
    if (!e) return reply.code(404).send({ error: 'Log not found', code: 'NOT_FOUND' })
    if (!e.action.startsWith('octoguard.would_')) {
      return reply.code(400).send({ error: 'Only an observation can be marked normal', code: 'NOT_OBSERVATION' })
    }
    if (e.normal) return reply.code(409).send({ error: 'Already marked', code: 'ALREADY_MARKED' })
    const markId = await claimMark('octoguard.observed_normal', id, request.user!.userId, e.action, { rule_id: e.metadata?.rule_id ?? null })
    if (!markId) return reply.code(409).send({ error: 'Already marked', code: 'ALREADY_MARKED' })
    return reply.send({ ok: true })
  })

  // ─── Webhook config (Module 5) ────────────────────────────────────────────

  // Le webhook d'OctoGuard est devenu « Webhooks » dans Intégrations (migration 139) :
  // ici, le résumé des destinations d'ÉQUIPE (celles qui reçoivent la modération).
  app.get('/webhook', async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT id, name, format, enabled, paused_at::text AS paused_at, events
         FROM webhook_destinations WHERE kind = 'team' ORDER BY created_at`)
    return reply.send({ destinations: rows, moved_to: '/admin/webhooks' })
  })

  app.put('/webhook', async (_request, reply) => {
    return reply.code(410).send({ error: 'The OctoGuard webhook moved to Administration > Integrations > Webhooks', code: 'WEBHOOK_MOVED' })
  })

  // ─── Contenus retenus (cran « Retenir », CDC E4h lot 2) ────────────────────

  app.get('/held', async (_request, reply) => {
    const items = await listPending(200)
    return reply.send({ held: items, count: await countPending(), expiry_hours: HELD_EXPIRY_HOURS })
  })

  // Le contexte d'un contenu retenu (lot 3) : la conversation au moment où il a été écrit
  app.get('/held/:id/context', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const ctx = await heldContext(id)
    if (!ctx) return reply.code(404).send({ error: 'Not found', code: 'NOT_FOUND' })
    return reply.send({ context: ctx })
  })

  app.post('/held/:id/:decision', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { id, decision } = request.params as { id: string; decision: string }
    if (!/^[0-9a-f-]{36}$/i.test(id) || (decision !== 'approve' && decision !== 'refuse')) {
      return reply.code(400).send({ error: 'Invalid request', code: 'INVALID_REQUEST' })
    }
    const actor = request.user!
    const { rows } = await db.query<{ author_id: string; status: string }>(
      `SELECT author_id, status FROM octoguard_held WHERE id = $1`, [id]
    )
    const h = rows[0]
    if (!h) return reply.code(404).send({ error: 'Not found', code: 'NOT_FOUND' })
    if (h.status !== 'pending') return reply.code(409).send({ error: 'Already decided', code: 'ALREADY_DECIDED' })
    // On ne relit pas son propre contenu
    if (h.author_id === actor.userId) {
      return reply.code(403).send({ error: 'You cannot review your own content', code: 'CANNOT_REVIEW_SELF' })
    }
    // Même garde-fou de rang que les signalements : pas de jugement d'un pair
    const access = await getInstanceAccess(actor.userId)
    if (access.rank < rankOf('admin')) {
      const author = await getInstanceAccess(h.author_id)
      if (!outranks(access, author.role)) {
        return reply.code(403).send({ error: 'Cannot act on a member of equal or higher rank', code: 'RANK_TOO_LOW' })
      }
    }
    const who = { id: actor.userId, username: actor.username }
    const res = decision === 'approve' ? await approveHeld(id, who) : await refuseHeld(id, who)
    if (!res.ok) {
      const why: Record<string, string> = {
        ALREADY_DECIDED: 'Already decided',
        AUTHOR_BANNED: 'The author has been banned since: refuse this content',
        THREAD_LOCKED: 'The thread has been locked since: refuse this content',
        PUBLISH_FAILED: 'The channel or thread no longer exists',
      }
      return reply.code(409).send({ error: why[res.code], code: res.code })
    }
    return reply.send({ ok: true, published_id: res.published_id })
  })

  // ─── Reports admin (Module 7) ─────────────────────────────────────────────

  app.get('/reports', async (request, reply) => {
    const q = request.query as { status?: string; limit?: string; page?: string }
    const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10), 1), 200)
    const page  = Math.max(parseInt(q.page ?? '1', 10), 1)
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: unknown[] = []
    let i = 1
    if (q.status) { conditions.push(`r.status = $${i++}`); params.push(q.status) }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    // Rôle de l'auteur dans LA communauté de l'instance (rang, garde-fou)
    const communityParam = i++
    params.push(await getInstanceCommunityId())

    const { rows } = await db.query(
      `SELECT r.*, u.username AS reporter_username,
              a.username AS target_author_username,
              cm.role    AS target_author_role,
              c.username AS claimed_by_username,
              v.username AS reviewed_by_username
         FROM reports r
         LEFT JOIN users u ON u.id = r.reporter_id
         LEFT JOIN users a ON a.id = r.target_author_id
         LEFT JOIN community_members cm ON cm.user_id = r.target_author_id
              AND cm.community_id = $${communityParam}
         LEFT JOIN users c ON c.id = r.claimed_by
         LEFT JOIN users v ON v.id = r.reviewed_by
         ${whereClause}
        ORDER BY r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    )
    // Compteurs par état pour les onglets de la file
    const { rows: counts } = await db.query<{ status: string; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM reports GROUP BY status`
    )
    return reply.send({ reports: rows, page, limit, counts: Object.fromEntries(counts.map(c => [c.status, c.n])) })
  })

  // Le contexte d'un signalement (lot 3) : conversation autour, modifications, fiche courte
  app.get('/reports/:id/context', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const { rows } = await db.query<{ target_type: string; target_id: string }>(`SELECT target_type, target_id FROM reports WHERE id = $1`, [id])
    if (!rows[0]) return reply.code(404).send({ error: 'Not found', code: 'NOT_FOUND' })
    const ctx = await reportContext(rows[0].target_type, rows[0].target_id)
    if (!ctx) return reply.code(404).send({ error: 'The content no longer exists', code: 'CONTENT_GONE' })
    return reply.send({ context: ctx })
  })

  app.patch('/reports/:id', {
    preHandler: [rateLimit, validate({ body: PatchReportBody })],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as z.infer<typeof PatchReportBody>
    const actor = request.user!
    const access = request.access!

    const { rows: found } = await db.query<{
      id: string; target_type: string; target_id: string; target_author_id: string | null; status: string
    }>(`SELECT id, target_type, target_id, target_author_id, status FROM reports WHERE id = $1`, [id])
    const report = found[0]
    if (!report) return reply.code(404).send({ error: 'Report not found', code: 'NOT_FOUND' })

    // Prendre en charge : « je regarde », visible de toute l'équipe
    if (body.claim && !body.status) {
      const { rows } = await db.query(
        `UPDATE reports SET claimed_by = $1, claimed_at = NOW()
          WHERE target_type = $2 AND target_id = $3 AND status = 'open'
          RETURNING id`,
        [actor.userId, report.target_type, report.target_id]
      )
      return reply.send({ claimed: rows.length })
    }

    // Garde-fou de rang : sous le rang d'admin, on ne traite pas le dossier
    // d'un auteur de rang égal ou supérieur (ce serait juger un pair).
    if (report.target_author_id && access.rank < rankOf('admin')) {
      const author = await getInstanceAccess(report.target_author_id)
      if (!outranks(access, author.role)) {
        return reply.code(403).send({ error: 'Cannot act on a member of equal or higher rank', code: 'RANK_TOO_LOW' })
      }
    }

    // Supprimer le contenu signalé : moderate_content en plus
    if (body.delete_content) {
      if (!access.permissions.includes('moderate_content')) {
        return reply.code(403).send({ error: 'Missing permission: moderate_content', code: 'FORBIDDEN' })
      }
      const deleted = await deleteReportedContent(report.target_type, report.target_id)
      if (!deleted) {
        return reply.code(400).send({ error: 'This content cannot be deleted from here', code: 'NOT_DELETABLE' })
      }
    }

    // Le dossier se ferme pour TOUS les signalements ouverts du même contenu, et
    // chaque personne qui a signalé est prévenue (services/octoguard/reportClose.ts)
    const closed = await closeReports(report, body.status!, actor.userId, body.resolution ?? null)
    await logAdminAction(actor.userId, `report_${body.status}`, report.target_type, report.target_id, null, {
      reports: closed.resolved, deleted: !!body.delete_content, resolution: body.resolution ?? null,
    })
    return reply.send({ resolved: closed.resolved, notified: closed.notified })
  })

  // ─── Le barème des sanctions (lot 4b, CDC §E4i) ───────────────────────────

  app.get('/ladder/settings', async (_request, reply) => {
    return reply.send({
      settings:            await getLadderSettings(),
      sanctions:           SANCTIONS,
      forget_choices:      FORGET_CHOICES,
      can_double_validate: await countBanCapable(null) >= 2,
    })
  })

  app.put('/ladder/settings', {
    preHandler: [rateLimit, validate({ body: z.object({ steps: z.array(z.string()), forget_days: z.number().int(), double_validation: z.boolean() }) })],
  }, async (request, reply) => {
    const r = await saveLadderSettings(request.body as { steps: unknown; forget_days: unknown; double_validation: unknown }, request.user!.userId)
    return r.ok ? reply.send({ settings: r.settings }) : reply.code(r.status).send({ error: r.error, code: r.code })
  })

  app.get('/ladder/member/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string }
    if (!UUID_RE.test(userId)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    return reply.send(await memberLadder(userId))
  })

  app.post('/ladder/apply', {
    preHandler: [rateLimit, validate({ body: z.object({
      user_id:       z.string().regex(UUID_RE),
      expected_step: z.number().int().min(1).max(4),
      report_id:     z.string().regex(UUID_RE).nullable().optional(),
      reason:        z.string().max(500).nullable().optional(),
    }) })],
  }, async (request, reply) => {
    const r = await applyLadder({ userId: request.user!.userId, access: request.access! }, request.body as { user_id: string; expected_step: number; report_id?: string | null; reason?: string | null })
    return r.ok ? reply.code(201).send(r) : reply.code(r.status).send({ error: r.error, code: r.code })
  })

  for (const [path, fn] of [['approve', approveLadder], ['refuse', refuseLadder], ['undo', undoLadder]] as const) {
    app.post(`/ladder/:id/${path}`, { preHandler: [rateLimit] }, async (request, reply) => {
      const { id } = request.params as { id: string }
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
      const r = await fn({ userId: request.user!.userId, access: request.access! }, id)
      return r.ok ? reply.send(r) : reply.code(r.status).send({ error: r.error, code: r.code })
    })
  }

  // ─── Contestations (lot 8) ────────────────────────────────────────────────

  app.get('/appeals', async (request, reply) => {
    const which = (request.query as { status?: string }).status === 'done' ? 'done' : 'open'
    return reply.send(await listAppeals(request.user!.userId, which))
  })

  app.post('/appeals/:id/decide', {
    preHandler: [rateLimit, validate({ body: z.object({
      outcome: z.enum(['upheld', 'overturned']),
      reply:   z.string().max(REPLY_MAX).nullable().optional(),
    }) })],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const r = await decideAppeal({ userId: request.user!.userId, access: request.access! }, id, request.body as { outcome: 'upheld' | 'overturned'; reply?: string | null })
    return r.ok ? reply.send(r) : reply.code(r.status).send({ error: r.error, code: r.code })
  })

  // ─── Reports settings (anti-abuse) ────────────────────────────────────────

  app.get('/reports/settings', async (_request, reply) => {
    const { rows } = await db.query(`SELECT * FROM reports_settings WHERE id = 1`)
    return reply.send({ settings: rows[0] ?? null })
  })

  app.put('/reports/settings', {
    preHandler: [rateLimit, validate({ body: z.object({
      rate_limit_per_hour:       z.number().int().min(0).max(1000).optional(),
      cooldown_per_target_hours: z.number().int().min(0).max(168).optional(),
      enabled:                   z.boolean().optional(),
    }) })],
  }, async (request, reply) => {
    const body = request.body as { rate_limit_per_hour?: number; cooldown_per_target_hours?: number; enabled?: boolean }
    const adminUser = request.user!
    const { rows } = await db.query(
      `UPDATE reports_settings
          SET rate_limit_per_hour       = COALESCE($1, rate_limit_per_hour),
              cooldown_per_target_hours = COALESCE($2, cooldown_per_target_hours),
              enabled                   = COALESCE($3, enabled),
              updated_at                = NOW()
        WHERE id = 1
        RETURNING *`,
      [body.rate_limit_per_hour ?? null, body.cooldown_per_target_hours ?? null, body.enabled ?? null]
    )
    await logAdminAction(adminUser.userId, 'octoguard.reports_settings_updated', null, null, null, body)
    return reply.send({ settings: rows[0] })
  })

  // ─── Manual isUserMuted check (utile pour debug) ──────────────────────────

  app.get('/mute-check/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const r = await isUserMuted(userId)
    return reply.send(r)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC PLUGIN — préfixe /api/v1/reports (requireAuth)
// ═══════════════════════════════════════════════════════════════════════════

export async function reportsPublicPlugin(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // Mes contenus retenus, pour les afficher « en attente de validation » là
  // où je les ai écrits. Jamais le nom de la règle (D20).
  app.get('/held/mine', { preHandler: [rateLimit] }, async (request, reply) => {
    const q = request.query as { channel_id?: string; thread_id?: string }
    const uuid = /^[0-9a-f-]{36}$/i
    if ((q.channel_id && !uuid.test(q.channel_id)) || (q.thread_id && !uuid.test(q.thread_id))) {
      return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    }
    const rows = await listMine(request.user!.userId, { channelId: q.channel_id, threadId: q.thread_id })
    return reply.send({ held: rows.map(forAuthor), expiry_hours: HELD_EXPIRY_HOURS })
  })

  // Lot 8 : mes avertissements et sourdines des 30 derniers jours, et les contester.
  // Jamais le nom de la règle (D20) ni celui de la personne qui a décidé.
  app.get('/decisions/mine', { preHandler: [rateLimit] }, async (request, reply) => {
    return reply.send({ decisions: await listMyDecisions(request.user!.userId), appeal_days: APPEAL_DAYS })
  })

  app.post('/appeals', {
    preHandler: [rateLimit, validate({ body: z.object({
      decision_type: z.enum(['warn', 'mute']),
      decision_id:   z.string().regex(UUID_RE),
      message:       z.string().trim().min(APPEAL_MIN).max(APPEAL_MAX),
    }) })],
  }, async (request, reply) => {
    const r = await fileAppeal(request.user!.userId, request.body as { decision_type: 'warn' | 'mute'; decision_id: string; message: string })
    return r.ok ? reply.code(201).send(r) : reply.code(r.status).send({ error: r.error, code: r.code })
  })

  app.post('/', {
    preHandler: [rateLimit, validate({ body: CreateReportBody })],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof CreateReportBody>
    const reporterId = request.user!.userId

    // Les messages privés sont chiffrés de bout en bout : rien à montrer à
    // l'équipe, et ce n'est pas à elle de les lire. Pas de signalement ici.
    if (body.target_type === 'dm_message') {
      return reply.code(400).send({ error: 'Private messages cannot be reported here', code: 'UNSUPPORTED_TARGET' })
    }
    // La cible doit exister, et on ne se signale pas soi-même
    const target = await resolveReportTarget(body.target_type as ResolvableTarget, body.target_id)
    if (!target) {
      return reply.code(404).send({ error: 'Content not found', code: 'NOT_FOUND' })
    }
    if (target.authorId === reporterId) {
      return reply.code(400).send({ error: 'You cannot report your own content', code: 'CANNOT_REPORT_SELF' })
    }

    // Charger les anti-abuse settings
    const { rows: cfgRows } = await db.query<{
      rate_limit_per_hour: number; cooldown_per_target_hours: number; enabled: boolean
    }>(`SELECT rate_limit_per_hour, cooldown_per_target_hours, enabled FROM reports_settings WHERE id = 1`)
    const cfg = cfgRows[0]
    if (!cfg || !cfg.enabled) {
      return reply.code(503).send({ error: 'Reports désactivés sur cette instance', code: 'DISABLED' })
    }

    // Rate limit Redis : N reports/heure
    const rateLimitKey = `octoguard:reports:rl:${reporterId}`
    const cnt = await redis.incr(rateLimitKey).catch(() => 0)
    if (cnt === 1) await redis.expire(rateLimitKey, 3600).catch(() => {})
    if (cnt > cfg.rate_limit_per_hour) {
      return reply.code(429).send({
        error: `Limite de signalements atteinte (${cfg.rate_limit_per_hour}/h). Réessaie plus tard.`,
        code: 'RATE_LIMITED',
      })
    }

    // Cooldown même target : N heures
    const cooldownKey = `octoguard:reports:cd:${reporterId}:${body.target_type}:${body.target_id}`
    const cooldownActive = await redis.exists(cooldownKey).catch(() => 0)
    if (cooldownActive) {
      return reply.code(429).send({
        error: `Tu as déjà signalé ce contenu récemment.`,
        code: 'COOLDOWN',
      })
    }
    await redis.set(cooldownKey, '1', 'EX', cfg.cooldown_per_target_hours * 3600).catch(() => {})

    // INSERT
    const { rows } = await db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, category,
                            target_author_id, snapshot, target_label, target_link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status, created_at::text AS created_at`,
      [reporterId, body.target_type, body.target_id, (body.reason ?? '').trim(), body.category,
       target.authorId, target.snapshot, target.label, target.link]
    )

    // Log dans admin_audit_log via le logger OctoGuard (fire-and-forget)
    const { logOctoGuardAction } = await import('../services/octoguard')
    logOctoGuardAction({
      action:       'octoguard.report_filed',
      target_type:  body.target_type,
      target_id:    body.target_id,
      target_label: target.label.slice(0, 120),
      metadata: {
        event_id:    rows[0].id,
        actor:       'octoguard:auto',
        reporter_id: reporterId,
        category:    body.category,
      },
    })

    return reply.code(201).send({ report: rows[0] })
  })
}
