// Mentions, vague 1 (SPECS/NODYX_MENTIONS_CDC.md) : les PROPOSITIONS pendant la frappe
// (D50) et les PUCES à l'affichage (D49).
//
// Seuls des membres de la communauté sortent d'ici, jamais un compte système, et
// seulement des champs publics choisis un par un : identifiant, pseudo, nom affiché,
// avatar, grade. Jamais d'e-mail, de rôle technique ni de date de connexion.
import { db } from '../config/database'
import * as CommunityModel from '../models/community'
import { describeGroups, isTeam } from './mentionGroups'

let communityIdCache: string | null = null
export async function instanceCommunityId(): Promise<string | null> {
  if (communityIdCache) return communityIdCache
  const slug = process.env.NODYX_COMMUNITY_SLUG
  if (slug) {
    const c = await CommunityModel.findBySlug(slug)
    if (c) return (communityIdCache = c.id)
  }
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  return (communityIdCache = rows[0]?.id ?? null)
}

/** Minuscules sans accents : « Léa » et « lea » se retrouvent (JS et SQL pareils). */
export function fold(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
const ACCENTS_FROM = 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñÝýÿŒœÆæ'
const ACCENTS_TO   = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyyOoAa'
const sqlFold = (col: string) => `LOWER(TRANSLATE(COALESCE(${col}, ''), '${ACCENTS_FROM}', '${ACCENTS_TO}'))`
const escLike = (s: string) => s.replace(/[\\%_]/g, c => '\\' + c)

/** Distance d'édition ≤ 1 (une faute : lettre en trop, en moins, changée ou inversée). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true                         // changée
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2) // inversée
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

export interface Suggestion {
  id: string; username: string; display_name: string | null; avatar: string | null
  reason: 'here' | 'frequent' | 'member' | 'group'
  last_at?: string; count?: number
  /** Groupe (reason = 'group') : clé de la marque (« ici », « grade:<id> »…) */
  key?: string
  /** Couleur d'un grade */
  color?: string | null
}

// Mots qui retrouvent un groupe intégré (FR et EN), sans accents
const GROUP_WORDS: Record<string, string[]> = {
  ici: ['enligne', 'en ligne', 'ici', 'online', 'here'],
  equipe: ['equipe', 'team', 'staff'],
  moderation: ['moderation', 'moderateurs', 'mods', 'modo'],
  tous: ['tous', 'everyone', 'all', 'tout le monde'],
}

/** Les groupes qui correspondent à la recherche (D52), avec leur nombre de personnes. */
async function suggestGroups(communityId: string, me: string, q: string): Promise<Suggestion[]> {
  const keys = Object.entries(GROUP_WORDS).filter(([, w]) => !q || w.some(x => x.startsWith(q))).map(([k]) => k)
  const { rows: grades } = await db.query<{ id: string; name: string; color: string | null }>(
    `SELECT id, name, color FROM community_grades WHERE community_id = $1 ORDER BY position, name LIMIT 50`, [communityId])
  const gradeHits = grades.filter(g => q && fold(g.name).split(/\s+/).some(w => w.startsWith(q)) || q && fold(g.name).startsWith(q)).slice(0, 3)
  const team = await isTeam(communityId, me)
  const all = [...keys.filter(k => k !== 'tous' || team), ...gradeHits.map(g => 'grade:' + g.id)]
  if (!all.length) return []
  const info = await describeGroups(communityId, me, all)
  return info.filter(i => !i.forbidden).map(i => ({
    id: 'g:' + i.key, key: i.key, username: i.key, display_name: i.label ?? grades.find(g => 'grade:' + g.id === i.key)?.name ?? null,
    avatar: null, reason: 'group' as const, count: i.count,
    color: grades.find(g => 'grade:' + g.id === i.key)?.color ?? null,
  }))
}

type Ctx = { channelId?: string; threadId?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX = 8

export async function suggestPeople(me: string, rawQ: string, ctx: Ctx): Promise<Suggestion[]> {
  const communityId = await instanceCommunityId()
  if (!communityId) return []
  const q = fold(rawQ.trim()).slice(0, 30)

  // 1. Ceux qui parlent ICI (50 derniers messages du salon ou du sujet), du plus récent
  const here = new Map<string, string>()
  if (ctx.channelId && UUID.test(ctx.channelId)) {
    const { rows } = await db.query<{ author_id: string; last_at: string }>(
      `SELECT author_id, MAX(created_at) AS last_at FROM (
         SELECT author_id, created_at FROM channel_messages
         WHERE channel_id = $1 AND is_deleted = false ORDER BY created_at DESC LIMIT 50) x
       GROUP BY author_id ORDER BY MAX(created_at) DESC`, [ctx.channelId])
    rows.forEach(r => here.set(r.author_id, new Date(r.last_at).toISOString()))
  } else if (ctx.threadId) {
    const { rows } = await db.query<{ author_id: string; last_at: string }>(
      `SELECT author_id, MAX(created_at) AS last_at FROM (
         SELECT p.author_id, p.created_at FROM posts p JOIN threads t ON t.id = p.thread_id
         WHERE ${UUID.test(ctx.threadId) ? 't.id = $1' : 't.slug = $1'} ORDER BY p.created_at DESC LIMIT 50) x
       GROUP BY author_id ORDER BY MAX(created_at) DESC`, [ctx.threadId])
    rows.forEach(r => here.set(r.author_id, new Date(r.last_at).toISOString()))
  }

  // 2. Ceux que je mentionne souvent (30 derniers jours)
  const frequent = new Map<string, number>()
  {
    const { rows } = await db.query<{ user_id: string; n: number }>(
      `SELECT user_id, COUNT(*)::int AS n FROM notifications
       WHERE actor_id = $1 AND type = 'mention' AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY user_id ORDER BY n DESC LIMIT 20`, [me])
    rows.forEach(r => frequent.set(r.user_id, r.n))
  }

  // 3. Les membres qui correspondent (préfixe du pseudo ou d'un mot du nom affiché)
  const people = new Map<string, Omit<Suggestion, 'reason'>>()
  const addRows = (rows: any[]) => rows.forEach(r => people.set(r.id, { id: r.id, username: r.username, display_name: r.display_name, avatar: r.avatar }))
  const base = `SELECT u.id, u.username, up.display_name, COALESCE(u.avatar, up.avatar_url) AS avatar
                FROM users u JOIN community_members cm ON cm.user_id = u.id
                LEFT JOIN user_profiles up ON up.user_id = u.id
                WHERE cm.community_id = $1 AND u.is_system = false AND u.id <> $2`
  const known = [...here.keys(), ...frequent.keys()].filter(id => id !== me)
  if (known.length) {
    const { rows } = await db.query(`${base} AND u.id = ANY($3::uuid[])`, [communityId, me, known])
    addRows(rows)
  }
  if (q) {
    const like = escLike(q) + '%'
    const { rows } = await db.query(
      `${base} AND (${sqlFold('u.username')} LIKE $3 OR ${sqlFold('up.display_name')} LIKE $3 OR ${sqlFold('up.display_name')} LIKE $4)
       ORDER BY u.username LIMIT 50`, [communityId, me, like, '% ' + like])
    addRows(rows)
    // Une faute pardonnée (au-delà de 3 lettres) : candidats qui commencent pareil
    if (q.length > 3) {
      const { rows: near } = await db.query(
        `${base} AND (${sqlFold('u.username')} LIKE $3 OR ${sqlFold('up.display_name')} LIKE $3) ORDER BY u.username LIMIT 300`,
        [communityId, me, escLike(q.slice(0, 1)) + '%'])
      addRows(near.filter((r: any) => [r.username, r.display_name ?? ''].some(n => withinOneEdit(fold(n).slice(0, q.length), q))))
    }
  }

  const matches = (p: Omit<Suggestion, 'reason'>) => {
    if (!q) return true
    const names = [p.username, p.display_name ?? ''].map(fold)
    return names.some(n => n.startsWith(q) || n.split(/\s+/).some(w => w.startsWith(q)) || (q.length > 3 && withinOneEdit(n.slice(0, q.length), q)))
  }

  const out: Suggestion[] = []
  const seen = new Set<string>()
  const push = (id: string, extra: Partial<Suggestion> & { reason: Suggestion['reason'] }) => {
    const p = people.get(id)
    if (!p || seen.has(id) || out.length >= MAX || !matches(p)) return
    seen.add(id); out.push({ ...p, ...extra })
  }
  for (const [id, last_at] of here) push(id, { reason: 'here', last_at })
  for (const [id, count] of frequent) push(id, { reason: 'frequent', count })
  // D50 : les groupes après les personnes d'ici et les habituelles, avant les autres membres
  for (const g of await suggestGroups(communityId, me, q).catch(() => [])) {
    if (out.length >= MAX) break
    out.push(g)
  }
  if (q) [...people.values()].sort((a, b) => a.username.localeCompare(b.username)).forEach(p => push(p.id, { reason: 'member' }))
  return out
}

export interface MentionPerson {
  id: string; username?: string; display_name?: string | null; avatar?: string | null
  grade?: { name: string; color: string | null } | null; gone?: true
}

/** Les puces d'un contenu : nom et avatar À JOUR (D49). Personne partie : gone. */
export async function peopleByIds(ids: string[]): Promise<MentionPerson[]> {
  const clean = [...new Set(ids.filter(id => UUID.test(id)).map(id => id.toLowerCase()))].slice(0, 50)
  if (!clean.length) return []
  const communityId = await instanceCommunityId()
  const { rows } = await db.query<{ id: string; username: string; display_name: string | null; avatar: string | null; grade_name: string | null; grade_color: string | null }>(
    `SELECT u.id, u.username, up.display_name, COALESCE(u.avatar, up.avatar_url) AS avatar,
            g.name AS grade_name, g.color AS grade_color
     FROM users u JOIN community_members cm ON cm.user_id = u.id AND cm.community_id = $2
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN community_grades g ON g.id = cm.grade_id
     WHERE u.id = ANY($1::uuid[]) AND u.is_system = false`, [clean, communityId])
  const found = new Map(rows.map(r => [r.id, r]))
  return clean.map(id => {
    const r = found.get(id)
    if (!r) return { id, gone: true as const }
    return { id, username: r.username, display_name: r.display_name, avatar: r.avatar,
             grade: r.grade_name ? { name: r.grade_name, color: r.grade_color } : null }
  })
}
