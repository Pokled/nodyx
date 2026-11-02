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
import { resolveReportTarget, type ReportTargetType as ResolvableTarget } from '../services/reports'
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
  applyMute, removeMute, isUserMuted,
  getWebhookConfig, setWebhookConfig, invalidateWebhookConfig,
} from '../services/octoguard'

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const Duration = z.object({
  value: z.number().int().positive(),
  unit:  z.enum(['m', 'h', 'd', 'w', 'M']),
}).nullable()

const RuleParams = z.object({}).passthrough()

const RuleType   = z.enum(['regex', 'caps', 'link_domain', 'mention_spam', 'link_spam'])
const RuleAction = z.enum(['delete', 'warn', 'mute', 'ban_temp', 'notify_only', 'report_only'])

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
})

const UpdateRuleBody = CreateRuleBody.partial()

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
const MEMBER_MODERATION_ROUTES = /^\/api\/v1\/admin\/octoguard\/(mutes|mute-check|reports(?!\/settings))(\/|$)/
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
    return MEMBER_MODERATION_ROUTES.test(route)
      ? guardMemberModeration(request, reply)
      : guardOctoguard(request, reply)
  })

  // ─── Settings (état global) ───────────────────────────────────────────────

  app.get('/settings', async (_request, reply) => {
    return reply.send({
      enabled:        process.env.OCTOGUARD_ENABLED === 'true',
      re2_active:     (await import('../services/octoguard')).hasRE2(),
      hate_filter:    process.env.NODYX_HATE_FILTER_ENABLED !== 'false',
    })
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
          immunized_role_types, immunized_grade_ids, dry_run, enabled)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb,
               COALESCE($7, ARRAY['owner','admin','moderator']),
               COALESCE($8, '{}'::uuid[]),
               COALESCE($9, false), COALESCE($10, true))
       RETURNING *`,
      [
        body.name, body.type, JSON.stringify(body.params), body.action,
        JSON.stringify(body.action_duration ?? null),
        JSON.stringify(body.escalation ?? null),
        body.immunized_role_types ?? null,
        body.immunized_grade_ids ?? null,
        body.dry_run ?? null,
        body.enabled ?? null,
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

  app.delete('/commands/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminUser = request.user!
    const { rows } = await db.query(
      `DELETE FROM octoguard_commands WHERE id = $1 RETURNING command`,
      [id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Command not found' })
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
      `SELECT cm.*, u.username AS user_username
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

  app.delete('/mutes/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminUser = request.user!
    const ok = await removeMute(id, adminUser.userId)
    if (!ok) return reply.code(404).send({ error: 'Mute not found' })
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
              metadata, created_at::text AS created_at
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

  app.post('/logs/:id/undo', async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminUser = request.user!
    const { rows } = await db.query(
      `SELECT action, metadata FROM admin_audit_log WHERE id = $1`, [id]
    )
    const log = rows[0]
    if (!log) return reply.code(404).send({ error: 'Log not found' })

    const meta = (log.metadata ?? {}) as { undoable?: boolean; undo_op?: { type?: string; mute_id?: string; user_id?: string } }
    if (!meta.undoable || !meta.undo_op) {
      return reply.code(400).send({ error: 'Action not undoable', code: 'NOT_UNDOABLE' })
    }

    if (meta.undo_op.type === 'remove_mute' && meta.undo_op.mute_id) {
      const ok = await removeMute(meta.undo_op.mute_id, adminUser.userId)
      await logAdminAction(adminUser.userId, 'octoguard.action_undone', 'log', id, log.action, { undo_op: meta.undo_op, success: ok })
      return reply.send({ ok })
    }
    if (meta.undo_op.type === 'clear_last_warn' && meta.undo_op.user_id) {
      await db.query(
        `UPDATE octoguard_warns SET cleared_at = NOW()
          WHERE user_id = $1 AND cleared_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [meta.undo_op.user_id]
      ).catch(() => {})
      await logAdminAction(adminUser.userId, 'octoguard.action_undone', 'log', id, log.action, { undo_op: meta.undo_op })
      return reply.send({ ok: true })
    }
    return reply.code(400).send({ error: 'Undo type not implemented', code: 'UNSUPPORTED' })
  })

  // ─── Webhook config (Module 5) ────────────────────────────────────────────

  app.get('/webhook', async (_request, reply) => {
    const cfg = await getWebhookConfig()
    if (!cfg) return reply.send({ webhook: null })
    // Ne pas exposer le secret en GET, juste sa présence
    return reply.send({
      webhook: {
        url:        cfg.url,
        has_secret: !!cfg.secret,
        enabled:    cfg.enabled,
        updated_at: cfg.updated_at,
      },
    })
  })

  app.put('/webhook', {
    preHandler: [rateLimit, validate({ body: WebhookBody })],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof WebhookBody>
    const adminUser = request.user!
    const updated = await setWebhookConfig(body)
    if (!updated) return reply.code(500).send({ error: 'Failed to update webhook' })
    invalidateWebhookConfig()
    await logAdminAction(adminUser.userId, 'octoguard.webhook_updated', null, null, null, { enabled: updated.enabled })
    return reply.send({
      webhook: {
        url:        updated.url,
        has_secret: !!updated.secret,
        enabled:    updated.enabled,
        updated_at: updated.updated_at,
      },
    })
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

    // Le dossier se ferme pour TOUS les signalements ouverts du même contenu
    const { rows } = await db.query<{ id: string; reporter_id: string | null }>(
      `UPDATE reports
          SET status      = $1,
              resolution  = COALESCE($2, resolution),
              reviewed_by = $3,
              reviewed_at = NOW()
        WHERE target_type = $4 AND target_id = $5 AND (status = 'open' OR id = $6)
        RETURNING id, reporter_id`,
      [body.status, body.resolution ?? null, actor.userId, report.target_type, report.target_id, id]
    )
    await logAdminAction(actor.userId, `report_${body.status}`, report.target_type, report.target_id, null, {
      reports: rows.length, deleted: !!body.delete_content, resolution: body.resolution ?? null,
    })

    // D6 : chaque signaleur apprend que son signalement a été traité, sans
    // détail de la décision (ni qui, ni quelle sanction).
    const reporters = [...new Set(rows.map(r => r.reporter_id).filter((x): x is string => !!x))]
    for (const reporterId of reporters) {
      try {
        await NotificationModel.create({ user_id: reporterId, type: 'report_resolved' })
        if (io) {
          const count = await NotificationModel.getUnreadCount(reporterId)
          io.to(`user:${reporterId}`).emit('notification:new', { unreadCount: count })
        }
      } catch { /* une notification ratée ne bloque jamais la modération */ }
    }

    return reply.send({ resolved: rows.length, notified: reporters.length })
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
