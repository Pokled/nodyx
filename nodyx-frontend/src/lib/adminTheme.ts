// Pages de l'administration déjà refaites sur le kit admin (routes/admin/admin-kit.css)
// et sur le thème clair/sombre. La refonte avance par lots : tant qu'une page n'est pas
// dans cette liste, l'admin entière reste sombre comme avant (.nx-on-dark), pour ne
// jamais montrer une barre latérale claire à côté d'un contenu encore codé en sombre.
// Lu par routes/+layout.svelte (feuille thémée) et routes/admin/+layout.svelte.
export const ADMIN_THEMED_ROUTES: readonly string[] = [
	'/admin', '/admin/members',
	// Lot 1 : gestion de la communauté
	'/admin/grades', '/admin/categories', '/admin/tags', '/admin/moderation', '/admin/audit-log',
]

export function isAdminThemed(pathname: string): boolean {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
	return ADMIN_THEMED_ROUTES.includes(path)
}

// Encre lisible posée sur une couleur choisie par l'admin (grade, étiquette) :
// noir sur fond clair, blanc sur fond sombre. Une couleur invalide retombe sur
// du blanc (fond supposé sombre), jamais sur un texte invisible.
export function inkOn(hex: string | null | undefined): string {
	const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
	if (!m) return '#fff'
	const n = parseInt(m[1], 16)
	const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff'
}
