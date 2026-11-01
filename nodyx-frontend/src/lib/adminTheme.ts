// Pages de l'administration déjà refaites sur le kit admin (routes/admin/admin-kit.css)
// et sur le thème clair/sombre. La refonte avance par lots : tant qu'une page n'est pas
// dans cette liste, l'admin entière reste sombre comme avant (.nx-on-dark), pour ne
// jamais montrer une barre latérale claire à côté d'un contenu encore codé en sombre.
// Lu par routes/+layout.svelte (feuille thémée) et routes/admin/+layout.svelte.
export const ADMIN_THEMED_ROUTES: readonly string[] = ['/admin', '/admin/members']

export function isAdminThemed(pathname: string): boolean {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
	return ADMIN_THEMED_ROUTES.includes(path)
}
