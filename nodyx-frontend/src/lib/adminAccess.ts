// Qui ouvre quelle page de l'administration (D3 du CDC modération) : l'équipe
// entre dans /admin, mais ne voit que les pages de ses droits. Tout ce qui
// n'est pas listé ici reste réservé aux admins et au propriétaire.
// Le serveur garde chaque route de son côté (middleware/permissions.ts) :
// cette table ne sert qu'à ne pas montrer une porte qui refuserait d'ouvrir.

import type { Permission } from './permissions'

export type AdminAccess = { role: string | null; permissions: readonly string[] }

// Du plus précis au plus général : la première règle dont le préfixe colle gagne.
const RULES: Array<{ prefix: string; exact?: boolean; any: Permission[] | 'staff' }> = [
	{ prefix: '/admin', exact: true, any: 'staff' },
	{ prefix: '/admin/members', any: ['moderate_members', 'ban_members'] },
	{ prefix: '/admin/grades', any: ['manage_grades'] },
	{ prefix: '/admin/categories', any: ['manage_categories'] },
	{ prefix: '/admin/moderation', any: ['moderate_content'] },
	{ prefix: '/admin/audit-log', any: ['view_audit_log'] },
	{ prefix: '/admin/octoguard/mutes', any: ['moderate_members', 'manage_octoguard'] },
	{ prefix: '/admin/octoguard/reports', any: ['moderate_members', 'manage_octoguard'] },
	{ prefix: '/admin/octoguard', any: ['manage_octoguard'] },
]

function isAdmin(a: AdminAccess | null | undefined): boolean {
	return a?.role === 'owner' || a?.role === 'admin'
}

export function mayOpenAdmin(path: string, access: AdminAccess | null | undefined): boolean {
	if (!access) return false
	if (isAdmin(access)) return true
	const p = path.length > 1 ? path.replace(/\/+$/, '') : path
	const rule = RULES.find((r) => (r.exact ? p === r.prefix : p === r.prefix || p.startsWith(r.prefix + '/')))
	if (!rule) return false
	if (rule.any === 'staff') return access.permissions.length > 0
	return rule.any.some((perm) => access.permissions.includes(perm))
}
