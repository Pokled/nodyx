// Le menu d'OctoGuard : il REMPLACE la colonne de l'administration quand on
// entre dans OctoGuard (même largeur, un bouton « Administration » pour revenir).
export type OgNavItem = { href: string; labelKey: string; iconPath: string; exact?: boolean; reports?: boolean }
export type OgNavGroup = { sectionKey: string | null; items: OgNavItem[] }

export const OG_NAV: OgNavGroup[] = [
	{ sectionKey: null, items: [
		{ href: '/admin/octoguard', labelKey: 'og2.nav_overview', exact: true, iconPath: 'M4 18a8 8 0 1116 0 M12 18l4-6' },
	] },
	{ sectionKey: 'og2.nav_sec_rules', items: [
		{ href: '/admin/octoguard/rules', labelKey: 'og2.nav_rules', iconPath: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5a2 2 0 100 4 2 2 0 000-4z M10 15a2 2 0 100 4 2 2 0 000-4z' },
		{ href: '/admin/octoguard/templates', labelKey: 'og2.nav_templates', iconPath: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5' },
		{ href: '/admin/octoguard/sandbox', labelKey: 'og2.nav_sandbox', iconPath: 'M9 3h6 M10 3v6L4.5 19A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-2L14 9V3 M7 15h10' },
		{ href: '/admin/octoguard/automod', labelKey: 'og2.nav_advanced', iconPath: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6' },
	] },
	{ sectionKey: 'og2.nav_sec_team', items: [
		{ href: '/admin/octoguard/reports', labelKey: 'og2.nav_reports', reports: true, iconPath: 'M5 21V4h11l-1.5 4L16 12H5' },
		{ href: '/admin/octoguard/mutes', labelKey: 'og2.nav_mutes', iconPath: 'M11 5L6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6' },
		{ href: '/admin/octoguard/logs', labelKey: 'og2.nav_log', iconPath: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01' },
		{ href: '/admin/octoguard/ladder', labelKey: 'og2.nav_ladder', iconPath: 'M12 3v18 M5 21h14 M6 7h12 M6 7l-3 7a3 3 0 006 0z M18 7l-3 7a3 3 0 006 0z' },
	] },
	{ sectionKey: 'og2.nav_sec_help', items: [
		{ href: '/admin/octoguard/guide', labelKey: 'og2.nav_guide', iconPath: 'M4 5a2 2 0 012-2h13v15H6a2 2 0 00-2 2z M4 20a2 2 0 002 1h13' },
		{ href: '/admin/octoguard/member-view', labelKey: 'og2.nav_member_view', iconPath: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z' },
	] },
	{ sectionKey: 'og2.nav_sec_auto', items: [
		{ href: '/admin/octoguard/welcome', labelKey: 'og2.nav_welcome', iconPath: 'M7 11V6a2 2 0 014 0v4 M11 10V5a2 2 0 014 0v5 M15 10V7a2 2 0 014 0v6a8 8 0 01-8 8 7 7 0 01-6-3l-2.5-4a2 2 0 013.4-2L7 13' },
		{ href: '/admin/octoguard/commands', labelKey: 'og2.nav_commands', iconPath: 'M5 7l5 5-5 5 M12 17h7' },
		{ href: '/admin/octoguard/webhook', labelKey: 'og2.nav_webhook', iconPath: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1' },
	] },
]

export const OG_ICON = 'M12 3a6.5 6.5 0 00-6.5 6.5c0 2 .9 3.7 2.3 4.9L6.5 20 M12 3a6.5 6.5 0 016.5 6.5c0 2-.9 3.7-2.3 4.9l1.3 5.6 M9.5 15.5L9 21 M14.5 15.5L15 21 M12 16v5'
