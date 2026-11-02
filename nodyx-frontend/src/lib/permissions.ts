// Droits de l'équipe côté interface (miroir de nodyx-core/src/services/permissions.ts).
// Le serveur revérifie TOUJOURS : ceci ne sert qu'à n'afficher que les actions
// permises. Droits effectifs = socle du rôle + grade (un grade ajoute, ne
// retire jamais), calculés par le cœur et livrés dans user.permissions.

export const GRADE_PERMISSIONS = [
	'manage_categories',
	'moderate_content',
	'moderate_members',
	'ban_members',
	'manage_grades',
	'view_audit_log',
	'manage_octoguard',
] as const

export type Permission = (typeof GRADE_PERMISSIONS)[number]
export type Role = 'owner' | 'admin' | 'moderator' | 'member'

// Socle de chaque rôle (D2, D4 du CDC modération)
export const ROLE_BASE: Record<Role, readonly Permission[]> = {
	owner: GRADE_PERMISSIONS,
	admin: GRADE_PERMISSIONS,
	moderator: ['moderate_content', 'moderate_members'],
	member: [],
}

type WithPermissions = { role?: string | null; permissions?: readonly string[] | null } | null | undefined

/** L'utilisateur a-t-il ce droit ? (repli sur le socle du rôle si le cœur est plus ancien) */
export function can(user: WithPermissions, permission: Permission): boolean {
	if (!user) return false
	if (Array.isArray(user.permissions)) return user.permissions.includes(permission)
	const base = user.role && user.role in ROLE_BASE ? ROLE_BASE[user.role as Role] : []
	return base.includes(permission)
}

/** Fait-il partie de l'équipe (au moins un droit) ? */
export function isStaff(user: WithPermissions): boolean {
	return GRADE_PERMISSIONS.some((p) => can(user, p))
}

export function isAdminRole(user: WithPermissions): boolean {
	return user?.role === 'owner' || user?.role === 'admin'
}
