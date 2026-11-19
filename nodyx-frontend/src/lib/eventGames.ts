// Le jeu d'un événement (SPECS/NODYX_MENTIONS_CDC.md §10, D66 ; maquette
// https://nodyx.org/inscrits-maquette.html, point 2). Catalogue propre à la communauté :
// la jaquette est une copie sur l'instance (/uploads/games/…). Ce n'est pas un jeu :
// une icône dessinée par Nodyx et une couleur, dans des listes fermées.
import { PUBLIC_API_URL } from '$app/env/public'

export const GAME_ICONS = ['pad', 'aim', 'sword', 'shield', 'dice', 'cards', 'trophy', 'crown', 'head', 'rocket', 'film', 'music', 'ball'] as const
export const GAME_COLORS = ['red', 'violet', 'blue', 'green', 'orange', 'grey'] as const
export type GameIcon = (typeof GAME_ICONS)[number]
export type GameColor = (typeof GAME_COLORS)[number]

/** Le dessin de chaque icône (viewBox 24, trait). */
export const ICON_PATHS: Record<GameIcon, string> = {
	pad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59l-.9 8.1A2.5 2.5 0 0 0 4.29 19.5c.86 0 1.63-.48 2.01-1.24L7 17h10l.7 1.26c.38.76 1.15 1.24 2.01 1.24a2.5 2.5 0 0 0 2.49-2.81l-.9-8.1A4 4 0 0 0 17.32 5z"/>',
	aim: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><line x1="22" y1="12" x2="17" y2="12"/><line x1="7" y1="12" x2="2" y2="12"/><line x1="12" y1="7" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="17"/>',
	sword: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/>',
	shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
	dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="16" cy="16" r="1.3"/>',
	cards: '<rect x="3" y="6" width="11" height="15" rx="2" transform="rotate(-10 8 13)"/><rect x="10" y="3" width="11" height="15" rx="2"/>',
	trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
	crown: '<path d="M3 8l4 5 5-7 5 7 4-5-2 11H5z"/><line x1="5" y1="22" x2="19" y2="22"/>',
	head: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
	rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
	film: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="M2 7l4-5M9 7l4-5M16 7l4-5"/><line x1="2" y1="12" x2="22" y2="12"/>',
	music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
	ball: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20M2 12h20"/>',
}
export const CALENDAR_PATH = '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'

export const COLOR_BG: Record<GameColor, string> = {
	red: 'linear-gradient(135deg,#be123c,#f43f5e)', violet: 'linear-gradient(135deg,#6d28d9,#a855f7)', blue: 'linear-gradient(135deg,#1d4ed8,#38bdf8)',
	green: 'linear-gradient(135deg,#15803d,#4ade80)', orange: 'linear-gradient(135deg,#c2410c,#fbbf24)', grey: 'linear-gradient(135deg,#334155,#64748b)',
}

export const isGameIcon = (v: unknown): v is GameIcon => typeof v === 'string' && (GAME_ICONS as readonly string[]).includes(v)
export const isGameColor = (v: unknown): v is GameColor => typeof v === 'string' && (GAME_COLORS as readonly string[]).includes(v)
/** Une jaquette servie par l'instance, et rien d'autre. */
export const isGameCover = (v: unknown): v is string => typeof v === 'string' && /^\/uploads\/games\/[0-9a-f-]{36}\.webp$/.test(v)

/** L'événement a-t-il un visuel à montrer (jaquette valide ou icône connue) ? */
export const hasLook = (l: EventLook | null | undefined): boolean => !!l && (isGameCover(l.game_cover) || isGameIcon(l.icon))

/**
 * Le même visuel qu'EventVisual, en élément DOM nu : pour les puces posées par une
 * action sur du HTML déjà rendu (mentionChips). Taille carrée en pixels.
 */
export function lookNode(l: EventLook, px: number): HTMLElement {
	const el = document.createElement('span')
	el.className = 'nx-evlook'
	el.setAttribute('aria-hidden', 'true')
	el.style.width = el.style.height = `${px}px`
	if (isGameCover(l.game_cover)) {
		el.style.backgroundImage = `url(${l.game_cover})`
		return el
	}
	el.style.background = COLOR_BG[isGameColor(l.icon_color) ? l.icon_color : 'grey']
	const ns = 'http://www.w3.org/2000/svg'
	const svg = document.createElementNS(ns, 'svg')
	svg.setAttribute('viewBox', '0 0 24 24')
	svg.innerHTML = isGameIcon(l.icon) ? ICON_PATHS[l.icon] : CALENDAR_PATH   // dessins constants, jamais une donnée
	el.appendChild(svg)
	return el
}

export interface Game { id: string; name: string; cover_path: string; source: 'upload' | 'steam' }
/** Ce qu'un événement porte pour s'afficher. */
export interface EventLook { game_name?: string | null; game_cover?: string | null; icon?: string | null; icon_color?: string | null }

/** Les champs du formulaire, prêts pour le cœur (vide = rien). */
export function gameFieldsFromForm(form: FormData): { game_id: string | null; icon: GameIcon | null; icon_color: GameColor | null } {
	const g = String(form.get('game_id') ?? '').trim()
	const i = form.get('icon'), c = form.get('icon_color')
	const game_id = /^[0-9a-f-]{36}$/i.test(g) ? g : null
	return { game_id, icon: !game_id && isGameIcon(i) ? i : null, icon_color: !game_id && isGameIcon(i) && isGameColor(c) ? c : null }
}

// ── Appels au cœur ───────────────────────────────────────────────────────────────
const api = (p: string) => `${PUBLIC_API_URL}/api/v1/games${p}`
const auth = (t: string | null): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {})
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string }

async function call<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
	try {
		const r = await fetch(url, init)
		const j = await r.json().catch(() => ({}))
		return r.ok ? { ok: true, data: j as T } : { ok: false, code: j?.code ?? `HTTP_${r.status}` }
	} catch { return { ok: false, code: 'NETWORK' } }
}

export const listGames = (token: string | null, q = '') => call<{ games: Game[] }>(api(q ? `?q=${encodeURIComponent(q)}` : ''), { headers: auth(token) })
export const gamesStatus = (token: string | null) => call<{ steam: boolean; can_manage: boolean }>(api('/status'), { headers: auth(token) })
export function uploadGame(token: string | null, name: string, file: File) {
	const fd = new FormData(); fd.append('name', name); fd.append('file', file)
	return call<{ game: Game }>(api(''), { method: 'POST', headers: auth(token), body: fd })
}
export const steamSearch = (token: string | null, q: string) => call<{ results: { appid: number; name: string }[] }>(api(`/steam?q=${encodeURIComponent(q)}`), { headers: auth(token) })
export const steamImport = (token: string | null, appid: number, name: string) =>
	call<{ game: Game }>(api('/steam'), { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ appid, name }) })
export const deleteGame = (token: string | null, id: string) => call<{ ok: true }>(api(`/${id}`), { method: 'DELETE', headers: auth(token) })

/** Le message d'erreur à montrer pour un code du cœur. */
export const GAME_ERROR_KEYS: Record<string, string> = {
	GAME_EXISTS: 'eventgame.err_exists', GAME_COVER_FORMAT: 'eventgame.err_format', GAME_COVER_SIZE: 'eventgame.err_size',
	GAME_COVER_UNREADABLE: 'eventgame.err_unreadable', GAME_COVER_REJECTED: 'eventgame.err_unreadable', GAME_NAME_REQUIRED: 'eventgame.err_name',
	GAME_COVER_REQUIRED: 'eventgame.err_cover', STEAM_UNREACHABLE: 'eventgame.err_steam_down', STEAM_NO_COVER: 'eventgame.err_steam_cover',
	STEAM_DISABLED: 'eventgame.steam_off', GAME_TEAM_ONLY: 'eventgame.err_team',
}
