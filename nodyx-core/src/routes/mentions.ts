// Mentions, vague 1 (SPECS/NODYX_MENTIONS_CDC.md, D49-D50).
//   GET /api/v1/mentions/suggest?q=&channel_id=|thread_id=  → propositions pendant la frappe
//   GET /api/v1/mentions/people?ids=a,b,c                   → les puces d'un contenu, à jour
import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/adminOnly'
import { retentionDays, RETENTION_CHOICES } from '../services/mentionGhosts'
import { suggestPeople, peopleByIds, instanceCommunityId } from '../services/mentionPeople'
import { describeGroups, confirmThreshold, groupCards, isTeam } from '../services/mentionGroups'
import { getPrefs, setPrefs, recipientRules, accepts, isQuietNow, quietUntil, isValidTz, type Who } from '../services/mentionPrefs'
import { db } from '../config/database'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function mentionsRoutes(app: FastifyInstance) {
  app.get('/suggest', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { q, channel_id, thread_id } = request.query as { q?: string; channel_id?: string; thread_id?: string }
    if (typeof q === 'string' && q.length > 60) {
      return reply.code(400).send({ error: 'Recherche trop longue', code: 'MENTION_QUERY_TOO_LONG' })
    }
    const people = await suggestPeople(request.user!.userId, q ?? '', {
      channelId: typeof channel_id === 'string' ? channel_id : undefined,
      threadId:  typeof thread_id === 'string' ? thread_id.slice(0, 300) : undefined,
    })
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ people })
  })

  // Lecture publique : une puce s'affiche aussi pour un visiteur d'un sujet public.
  // Seuls des champs publics (pseudo, nom affiché, avatar, grade) en sortent.
  app.get('/people', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    const { ids } = request.query as { ids?: string }
    if (typeof ids !== 'string' || !ids) {
      return reply.code(400).send({ error: 'Identifiants requis', code: 'MENTION_IDS_REQUIRED' })
    }
    const list = ids.split(',')
    if (list.length > 50) return reply.code(400).send({ error: 'Trop d’identifiants', code: 'MENTION_IDS_TOO_MANY' })
    reply.header('Cache-Control', 'private, no-store')   // D49 : un nom ou une couleur changés se voient au prochain affichage
    return reply.send({ people: await peopleByIds(list) })
  })

  // D51 : ce que les mentions d'un message vont faire, AVANT l'envoi. N'empêche rien :
  // l'envoi refait ses propres contrôles. Ne dévoile jamais un réglage précis de quelqu'un.
  app.post('/preview', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const body = (request.body ?? {}) as { people?: unknown; groups?: unknown }
    const people = Array.isArray(body.people) ? body.people.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 20) : []
    const groups = Array.isArray(body.groups) ? body.groups.filter((x): x is string => typeof x === 'string').slice(0, 5) : []
    const communityId = await instanceCommunityId()
    if (!communityId) return reply.send({ people: [], groups: [], threshold: await confirmThreshold() })
    const { rows } = people.length
      ? await db.query<{ user_id: string }>(
          `SELECT cm.user_id FROM community_members cm JOIN users u ON u.id = cm.user_id
           WHERE cm.community_id = $1 AND cm.user_id = ANY($2::uuid[]) AND u.is_system = false`, [communityId, people])
      : { rows: [] as { user_id: string }[] }
    const members = new Set(rows.map(r => r.user_id))
    // D54 : « ne sera pas prévenu » quand SON réglage refuse l'auteur, sans dire lequel ;
    // une sourdine personnelle n'est JAMAIS dévoilée (renvoyée « ok »). D55 : en pause.
    const me = request.user!.userId
    const [team, rules, showUntil] = await Promise.all([
      isTeam(communityId, me).catch(() => false),
      recipientRules([...members], me).catch(() => new Map()),
      db.query<{ value: string }>(`SELECT value FROM instance_settings WHERE key = 'mentions_show_quiet_until'`).then(r => r.rows[0]?.value === 'true').catch(() => false),
    ])
    const stateOf = (id: string) => {
      if (!members.has(id)) return { id, state: 'not_member' }
      const rule = rules.get(id)
      if (rule && !accepts({ ...rule, muted: false }, team)) return { id, state: 'wont_be_notified' }
      if (rule && accepts(rule, team) && isQuietNow(rule.prefs)) {
        return showUntil ? { id, state: 'quiet', quiet_until: quietUntil(rule.prefs) } : { id, state: 'quiet' }
      }
      return { id, state: 'ok' }
    }
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({
      people: people.map(stateOf),
      groups: await describeGroups(communityId, request.user!.userId, groups),
      threshold: await confirmThreshold(),
    })
  })

  // Les puces de groupe (nom et couleur à jour, nombre, quelques noms). Lecture publique.
  app.get('/groups', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    const { keys } = request.query as { keys?: string }
    if (typeof keys !== 'string' || !keys) return reply.code(400).send({ error: 'Groupes requis', code: 'MENTION_GROUPS_REQUIRED' })
    const communityId = await instanceCommunityId()
    reply.header('Cache-Control', 'private, no-store')   // D49 : un nom ou une couleur changés se voient au prochain affichage
    return reply.send({ groups: communityId ? await groupCards(communityId, keys.split(',').slice(0, 10)) : [] })
  })

  // ── Mes réglages (D54-D55) ────────────────────────────────────────────────
  app.get('/prefs', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    // La règle de l'instance sur les fantômes (Q1) : chacun sait si un texte effacé est gardé
    return reply.send({ prefs: await getPrefs(request.user!.userId), policy: { ghost_retention_days: await retentionDays() } })
  })

  app.put('/prefs', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>
    const who = b.who
    const minute = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1439)
    if (who !== 'all' && who !== 'following' && who !== 'team') return reply.code(400).send({ error: 'Choix invalide', code: 'MENTION_PREFS_INVALID' })
    if (!minute(b.quiet_start ?? null) || !minute(b.quiet_end ?? null)) return reply.code(400).send({ error: 'Heures invalides', code: 'MENTION_PREFS_INVALID' })
    const quietOn = b.quiet_start !== null && b.quiet_start !== undefined && b.quiet_end !== null && b.quiet_end !== undefined
    if (quietOn && !isValidTz(b.quiet_tz)) return reply.code(400).send({ error: 'Fuseau invalide', code: 'MENTION_PREFS_INVALID' })
    if (b.bursts !== undefined && typeof b.bursts !== 'boolean') return reply.code(400).send({ error: 'Choix invalide', code: 'MENTION_PREFS_INVALID' })
    const prefs = {
      who: who as Who,
      quiet_start: quietOn ? b.quiet_start as number : null,
      quiet_end: quietOn ? b.quiet_end as number : null,
      quiet_tz: quietOn ? b.quiet_tz as string : null,
      bursts: b.bursts !== false,
    }
    await setPrefs(request.user!.userId, prefs)
    return reply.send({ prefs })
  })

  // ── Personnes dont je ne reçois plus les mentions (elles n'en savent rien) ──
  app.get('/mutes', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { rows } = await db.query<{ id: string; username: string; display_name: string | null; avatar: string | null }>(
      `SELECT u.id, u.username, up.display_name, COALESCE(u.avatar, up.avatar_url) AS avatar
       FROM user_mention_mutes m JOIN users u ON u.id = m.muted_user_id LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE m.user_id = $1 ORDER BY m.created_at DESC LIMIT 200`, [request.user!.userId])
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ mutes: rows })
  })

  app.put('/mutes/:userId', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const me = request.user!.userId
    if (!UUID.test(userId) || userId === me) return reply.code(400).send({ error: 'Personne invalide', code: 'MENTION_MUTE_INVALID' })
    const { rows: n } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM user_mention_mutes WHERE user_id = $1`, [me])
    if ((n[0]?.n ?? 0) >= 200) return reply.code(400).send({ error: 'Trop de personnes en sourdine', code: 'MENTION_MUTE_LIMIT' })
    const { rowCount } = await db.query(
      `INSERT INTO user_mention_mutes (user_id, muted_user_id)
       SELECT $1, u.id FROM users u WHERE u.id = $2 AND u.is_system = false
       ON CONFLICT DO NOTHING`, [me, userId])
    if (rowCount === 0) {
      const { rows } = await db.query(`SELECT 1 FROM user_mention_mutes WHERE user_id = $1 AND muted_user_id = $2`, [me, userId])
      if (!rows.length) return reply.code(404).send({ error: 'Personne introuvable', code: 'MENTION_MUTE_NOT_FOUND' })
    }
    return reply.send({ ok: true })
  })

  app.delete('/mutes/:userId', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    if (!UUID.test(userId)) return reply.code(400).send({ error: 'Personne invalide', code: 'MENTION_MUTE_INVALID' })
    await db.query(`DELETE FROM user_mention_mutes WHERE user_id = $1 AND muted_user_id = $2`, [request.user!.userId, userId])
    return reply.send({ ok: true })
  })

  // ── Réglages de l'instance (admins) : seuil des groupes (D51), texte des fantômes
  // (Q1), heure de fin d'une pause (Q2). Mêmes clés que celles lues par le cœur.
  app.get('/admin/settings', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    const { rows } = await db.query<{ value: string }>(`SELECT value FROM instance_settings WHERE key = 'mentions_show_quiet_until'`)
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ settings: {
      group_confirm: await confirmThreshold(),
      ghost_retention_days: await retentionDays(),
      show_quiet_until: rows[0]?.value === 'true',
    } })
  })

  app.put('/admin/settings', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>
    const n = b.group_confirm, d = b.ghost_retention_days, q = b.show_quiet_until
    if (!Number.isInteger(n) || (n as number) < 2 || (n as number) > 500
      || !(RETENTION_CHOICES as readonly unknown[]).includes(d) || typeof q !== 'boolean') {
      return reply.code(400).send({ error: 'Réglage invalide', code: 'MENTION_SETTINGS_INVALID' })
    }
    for (const [key, value] of [['mentions_group_confirm', String(n)], ['mentions_ghost_retention_days', String(d)], ['mentions_show_quiet_until', String(q)]]) {
      await db.query(
        `INSERT INTO instance_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value])
    }
    // Durée raccourcie ou texte plus gardé : on efface tout de suite ce qui dépasse
    const { purgeGhosts } = await import('../services/mentionGhosts')
    await purgeGhosts().catch(() => {})
    return reply.send({ settings: { group_confirm: n, ghost_retention_days: d, show_quiet_until: q } })
  })
}
