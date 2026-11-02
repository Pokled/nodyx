// Droits de l'équipe : le point de contrôle UNIQUE (CDC SPECS/NODYX_MODERATION_CDC.md, E1).
//
// Droits effectifs = socle du rôle + droits du grade (D1 : un grade AJOUTE,
// il ne retire jamais). Propriétaire et admins ont tout (D2 : le rôle
// modérateur reste le socle de l'équipe ; D4 : bannir ne fait pas partie de
// son socle, un grade peut le lui donner).
//
// Écrire et ouvrir un fil sont acquis à tout membre non banni : ce ne sont
// pas des permissions de grade (un grade ne peut pas les retirer, les cocher
// ferait croire le contraire). Les bannissements restent vérifiés par les
// routes, comme avant.
//
// Cache Redis court (60 s) par membre, avec une version par communauté :
// changer un grade ou un rôle incrémente la version, tous les droits de la
// communauté sont recalculés au prochain appel.

import { db, redis } from '../config/database'
import { getInstanceCommunityId } from '../middleware/adminOnly'

export const GRADE_PERMISSIONS = [
  'manage_categories', // créer, modifier, réordonner, supprimer les catégories
  'moderate_content',  // modifier, supprimer, épingler, verrouiller les contenus des autres (forum + chat)
  'moderate_members',  // exclure d'un salon vocal, sourdine, liste des membres, signalements
  'ban_members',       // bannir et débannir (comptes, IP, emails)
  'manage_grades',     // créer, modifier, attribuer les grades
  'view_audit_log',    // lire le journal d'audit
  'manage_octoguard',  // régler OctoGuard
] as const

export type Permission = typeof GRADE_PERMISSIONS[number]
export type Role = 'owner' | 'admin' | 'moderator' | 'member'

export const ROLE_RANK: Record<Role, number> = { member: 0, moderator: 1, admin: 2, owner: 3 }

// Socle de chaque rôle (D2, D4)
export const ROLE_BASE: Record<Role, readonly Permission[]> = {
  owner:     GRADE_PERMISSIONS,
  admin:     GRADE_PERMISSIONS,
  moderator: ['moderate_content', 'moderate_members'],
  member:    [],
}

export function isPermission(p: unknown): p is Permission {
  return typeof p === 'string' && (GRADE_PERMISSIONS as readonly string[]).includes(p)
}

export function rankOf(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as Role] : -1
}

/** Calcul pur : socle du rôle + permissions vraies du grade. */
export function effectivePermissions(
  role: string | null | undefined,
  gradePermissions: Record<string, unknown> | null | undefined,
): Permission[] {
  const set = new Set<Permission>(role && role in ROLE_BASE ? ROLE_BASE[role as Role] : [])
  // Un non-membre n'hérite d'aucun grade (il n'en a pas de toute façon)
  if (role && gradePermissions) {
    for (const [k, v] of Object.entries(gradePermissions)) {
      if (v === true && isPermission(k)) set.add(k)
    }
  }
  return GRADE_PERMISSIONS.filter(p => set.has(p))
}

export interface MemberAccess {
  role:        Role | null
  rank:        number
  permissions: Permission[]
}

const TTL_SECONDS = 60
const verKey    = (communityId: string) => `perms:ver:${communityId}`
const accessKey = (communityId: string, ver: string, userId: string) => `perms:${communityId}:${ver}:${userId}`

async function loadAccess(communityId: string, userId: string): Promise<MemberAccess> {
  const { rows } = await db.query<{ role: string; permissions: Record<string, unknown> | null }>(
    `SELECT cm.role, cg.permissions
     FROM community_members cm
     LEFT JOIN community_grades cg ON cg.id = cm.grade_id AND cg.community_id = cm.community_id
     WHERE cm.community_id = $1 AND cm.user_id = $2`,
    [communityId, userId],
  )
  const role = (rows[0]?.role ?? null) as Role | null
  return { role, rank: rankOf(role), permissions: effectivePermissions(role, rows[0]?.permissions) }
}

/** Rôle, rang et droits effectifs d'un utilisateur dans une communauté. */
export async function getAccess(communityId: string, userId: string): Promise<MemberAccess> {
  let ver = '0'
  try {
    ver = (await redis.get(verKey(communityId))) ?? '0'
    const cached = await redis.get(accessKey(communityId, ver, userId))
    if (cached) return JSON.parse(cached) as MemberAccess
  } catch { /* Redis indisponible : on lit la base */ }

  const access = await loadAccess(communityId, userId)
  Promise.resolve()
    .then(() => redis.setex(accessKey(communityId, ver, userId), TTL_SECONDS, JSON.stringify(access)))
    .catch(() => {})
  return access
}

export async function can(communityId: string, userId: string, permission: Permission): Promise<boolean> {
  return (await getAccess(communityId, userId)).permissions.includes(permission)
}

/** Droits dans LA communauté de l'instance (admin, chat, vocal). */
export async function getInstanceAccess(userId: string): Promise<MemberAccess> {
  const communityId = await getInstanceCommunityId()
  if (!communityId) return { role: null, rank: -1, permissions: [] }
  return getAccess(communityId, userId)
}

export async function canInInstance(userId: string, permission: Permission): Promise<boolean> {
  return (await getInstanceAccess(userId)).permissions.includes(permission)
}

/**
 * À appeler après tout changement de grade (création, modification, suppression,
 * attribution) ou de rôle : les droits de la communauté sont recalculés.
 */
export async function invalidatePermissions(communityId: string | null | undefined): Promise<void> {
  if (!communityId) return
  try { await redis.incr(verKey(communityId)) } catch { /* le TTL de 60 s rattrape */ }
}

/** Communauté propriétaire d'un fil (pour les droits du forum). */
export async function communityOfThread(threadId: string): Promise<string | null> {
  const { rows } = await db.query<{ community_id: string }>(
    `SELECT c.community_id FROM threads t JOIN categories c ON c.id = t.category_id WHERE t.id = $1`,
    [threadId],
  )
  return rows[0]?.community_id ?? null
}

/**
 * Garde-fou de rang : l'acteur ne peut viser qu'un membre de rang STRICTEMENT
 * inférieur. Un non-membre (rang -1) peut toujours être visé.
 */
export function outranks(actor: MemberAccess, targetRole: string | null | undefined): boolean {
  return actor.rank > rankOf(targetRole)
}
