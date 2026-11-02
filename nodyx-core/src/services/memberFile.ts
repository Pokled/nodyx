// La fiche d'un membre (CDC SPECS/NODYX_MODERATION_CDC.md, E3) : qui il est,
// où il en est (banni ? en sourdine ?), et tout son historique de modération
// dans UNE frise : avertissements, sourdines, exclusions, bannissements,
// changements de rôle, signalements qui le visent, actions d'OctoGuard, notes
// de l'équipe. Lecture seule ; les actions passent par leurs routes.

import { db } from '../config/database'

export type TimelineKind =
  | 'audit'     // une action du journal visant ce membre (ban, exclusion, rôle, OctoGuard…)
  | 'warn'      // un avertissement (équipe ou OctoGuard)
  | 'report'    // un signalement de son contenu ou de son profil
  | 'note'      // une note de l'équipe (D5 : jamais visible du membre)

export interface TimelineItem {
  kind:       TimelineKind
  id:         string
  at:         string
  action?:    string          // audit : le nom de l'action
  actor?:     string | null   // qui l'a faite (pseudo), null = OctoGuard / compte supprimé
  text?:      string | null   // motif, note, extrait
  meta?:      Record<string, unknown> | null
}

export interface MemberFile {
  member: {
    id: string; username: string; avatar: string | null; created_at: string
    role: string | null; joined_at: string | null
    grade: { name: string; color: string } | null
    threads: number; posts: number; messages: number
  }
  status: {
    banned: { reason: string | null; at: string; by: string | null; expires_at: string | null } | null
    mutes: Array<{ id: string; channel_id: string | null; channel_name: string | null; reason: string | null; expires_at: string | null; by: string | null }>
    warns_active: number
    reports_open: number
  }
  timeline: TimelineItem[]
}

const TIMELINE_LIMIT = 200

export async function buildMemberFile(communityId: string, userId: string): Promise<MemberFile | null> {
  const { rows: who } = await db.query(
    `SELECT u.id, u.username, u.avatar, u.created_at::text AS created_at,
            cm.role, cm.joined_at::text AS joined_at, g.name AS grade_name, g.color AS grade_color,
            (SELECT COUNT(*)::int FROM threads t JOIN categories c ON c.id = t.category_id
              WHERE t.author_id = u.id AND c.community_id = $1) AS threads,
            (SELECT COUNT(*)::int FROM posts p JOIN threads t ON t.id = p.thread_id JOIN categories c ON c.id = t.category_id
              WHERE p.author_id = u.id AND c.community_id = $1) AS posts,
            (SELECT COUNT(*)::int FROM channel_messages m JOIN channels ch ON ch.id = m.channel_id
              WHERE m.author_id = u.id AND ch.community_id = $1 AND m.is_deleted = false) AS messages
     FROM users u
     LEFT JOIN community_members cm ON cm.user_id = u.id AND cm.community_id = $1
     LEFT JOIN community_grades g ON g.id = cm.grade_id
     WHERE u.id = $2 AND u.is_system = false`,
    [communityId, userId],
  )
  const m = who[0]
  if (!m) return null

  const [ban, mutes, warns, audit, reports, notes] = await Promise.all([
    db.query(
      `SELECT b.reason, b.banned_at::text AS at, b.expires_at::text AS expires_at, u.username AS by
       FROM community_bans b LEFT JOIN users u ON u.id = b.banned_by
       WHERE b.community_id = $1 AND b.user_id = $2`, [communityId, userId]),
    db.query(
      `SELECT cm.id, cm.channel_id, ch.name AS channel_name, cm.reason, cm.expires_at::text AS expires_at, u.username AS by
       FROM chat_mutes cm LEFT JOIN channels ch ON ch.id = cm.channel_id LEFT JOIN users u ON u.id = cm.applied_by
       WHERE cm.user_id = $1 AND (cm.expires_at IS NULL OR cm.expires_at > NOW())
       ORDER BY cm.applied_at DESC`, [userId]),
    db.query(
      `SELECT w.id, w.reason, w.cleared_at, w.created_at::text AS at, u.username AS by, r.name AS rule_name
       FROM octoguard_warns w
       LEFT JOIN users u ON u.id = w.issued_by
       LEFT JOIN octoguard_automod_rules r ON r.id = w.rule_id
       WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT $2`, [userId, TIMELINE_LIMIT]),
    // Les avertissements ont leur propre table : on ne les compte pas deux fois
    db.query(
      `SELECT id, action, actor_username, metadata, created_at::text AS at
       FROM admin_audit_log
       WHERE target_type = 'user' AND target_id = $1
         AND action NOT IN ('warn_user', 'octoguard.warn_user')
       ORDER BY created_at DESC LIMIT $2`, [userId, TIMELINE_LIMIT]),
    db.query(
      `SELECT r.id, r.target_type, r.category, r.reason, r.status, r.snapshot, r.target_link,
              r.created_at::text AS at
       FROM reports r WHERE r.target_author_id = $1
       ORDER BY r.created_at DESC LIMIT $2`, [userId, TIMELINE_LIMIT]),
    db.query(
      `SELECT n.id, n.body, n.created_at::text AS at, u.username AS by, n.author_id
       FROM member_notes n LEFT JOIN users u ON u.id = n.author_id
       WHERE n.community_id = $1 AND n.user_id = $2
       ORDER BY n.created_at DESC`, [communityId, userId]),
  ])

  const timeline: TimelineItem[] = [
    ...warns.rows.map((w: any) => ({
      kind: 'warn' as const, id: w.id, at: w.at, actor: w.by ?? null,
      text: w.reason, meta: { rule: w.rule_name ?? null, cleared: !!w.cleared_at },
    })),
    ...audit.rows.map((a: any) => ({
      kind: 'audit' as const, id: String(a.id), at: a.at, action: a.action,
      actor: a.actor_username === 'octoguard:auto' ? null : a.actor_username, meta: a.metadata ?? null,
    })),
    ...reports.rows.map((r: any) => ({
      kind: 'report' as const, id: r.id, at: r.at, text: r.snapshot,
      meta: { target_type: r.target_type, category: r.category, status: r.status, link: r.target_link, reason: r.reason || null },
    })),
    ...notes.rows.map((n: any) => ({
      kind: 'note' as const, id: n.id, at: n.at, actor: n.by ?? null, text: n.body, meta: { author_id: n.author_id },
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, TIMELINE_LIMIT)

  const b = ban.rows[0] as any
  return {
    member: {
      id: m.id, username: m.username, avatar: m.avatar, created_at: m.created_at,
      role: m.role, joined_at: m.joined_at,
      grade: m.grade_name ? { name: m.grade_name, color: m.grade_color } : null,
      threads: m.threads, posts: m.posts, messages: m.messages,
    },
    status: {
      banned: b ? { reason: b.reason, at: b.at, by: b.by ?? null, expires_at: b.expires_at } : null,
      mutes: mutes.rows as MemberFile['status']['mutes'],
      warns_active: warns.rows.filter((w: any) => !w.cleared_at).length,
      reports_open: reports.rows.filter((r: any) => r.status === 'open').length,
    },
    timeline,
  }
}
