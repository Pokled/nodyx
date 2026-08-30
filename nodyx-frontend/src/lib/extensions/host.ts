// Côté hôte du pont d'extension.
//
// Ce module est volontairement séparé du composant Svelte : il ne touche ni au
// DOM ni aux stores, il transforme une enveloppe en réponse. C'est ce qui le
// rend testable sans navigateur, et c'est aussi ce qui permet de le relire
// comme une frontière de sécurité plutôt que comme du code d'interface.
//
// Référence : SPECS/NODYX_SDK_CDC.md §4, SPECS/NODYX_SDK_REFERENCE.md §6

export const PROTOCOL = 1

export type SurfaceRef = string   // 'page' | 'widget:<id>'

export interface HostSurface {
	extensionId: string
	version:     string
	surface:     SurfaceRef
}

export interface BootPayload {
	p:         typeof PROTOCOL
	type:      'nodyx:boot'
	ext:       string
	version:   string
	surface:   SurfaceRef
	entryUrl:  string
	imageBase: string
	config:    Record<string, unknown>
	messages:  Record<string, string>
	locale:    string
	theme:     Record<string, string>
	instance:  Record<string, unknown>
	user:      Record<string, unknown> | null
	route:     string
}

/**
 * Acces au runtime, cote hote.
 *
 * L'hote proxie vers le coeur avec le jeton d'extension : la frame ne peut pas
 * appeler l'API elle meme, elle n'a ni session ni jeton. C'est ce passage
 * oblige qui rend les capacites verifiables.
 */
export interface HostRuntime {
	storage?: (op: 'get' | 'set' | 'delete' | 'list', payload: Record<string, unknown>) => Promise<unknown>
	fetch?:   (payload: Record<string, unknown>) => Promise<unknown>
}

export interface HostActions {
	resize?:     (height: number) => void
	toast?:      (message: string) => void
	confirm?:    (options: unknown) => Promise<boolean>
	modal?:      (options: unknown) => Promise<unknown>
	routePush?:  (path: string, replace: boolean) => void
	navigate?:   (path: string) => void
	external?:   (url: string) => void
}

export type Envelope =
	| { p: number; id: string; ok: true;  result: unknown }
	| { p: number; id: string; ok: false; error: { code: string; message: string } }

const RE_REQ_ID  = /^[A-Za-z0-9_-]{1,64}$/
const RE_SURFACE = /^(page|(widget|activity):[a-z][a-z0-9-]{0,30})$/

/**
 * Chemins internes acceptés pour le routeur d'une extension.
 *
 * Une extension navigue dans SON espace, jamais ailleurs. Sans ce contrôle,
 * `router.push('/admin/settings')` réécrirait l'URL de l'hôte et donnerait à
 * une extension l'apparence d'une page d'administration.
 */
export function isSafeInternalPath(path: unknown): path is string {
	if (typeof path !== 'string' || !path.startsWith('/')) return false
	if (path.startsWith('//') || path.includes('..') || path.includes('\\')) return false
	return path.length <= 512
}

/** Seuls http et https sortent, et jamais sans que l'hôte le sache. */
export function isSafeExternalUrl(raw: unknown): raw is string {
	if (typeof raw !== 'string' || raw.length > 2048) return false
	try {
		const u = new URL(raw)
		return u.protocol === 'https:' || u.protocol === 'http:'
	} catch {
		return false
	}
}

function ok(id: string, result: unknown): Envelope {
	return { p: PROTOCOL, id, ok: true, result }
}

function err(id: string, code: string, message: string): Envelope {
	return { p: PROTOCOL, id, ok: false, error: { code, message } }
}

/**
 * Suit les identifiants déjà répondus, pour refuser un rejeu, en restant borné
 * en mémoire : une frame bavarde ne doit pas faire grossir l'onglet.
 */
export class RequestLedger {
	private readonly seen = new Set<string>()
	constructor(private readonly max = 512) {}
	accept(id: string): boolean {
		if (this.seen.has(id)) return false
		this.seen.add(id)
		if (this.seen.size > this.max) this.seen.delete(this.seen.values().next().value as string)
		return true
	}
}

/**
 * Capacités qui appartiennent au lot suivant.
 *
 * Elles sont refusées avec un code explicite plutôt que silencieusement
 * ignorées : une extension doit pouvoir distinguer « pas encore » de « refusé »,
 * et un développeur doit le lire dans la console au lieu de le deviner.
 */
const RUNTIME_API_TYPES = new Set([
	'core.get', 'session.renew',
])

/** Erreur portant le code rendu par le coeur, pour le retransmettre tel quel. */
export class RuntimeCallError extends Error {
	constructor(public readonly code: string, message: string) {
		super(message)
		this.name = 'RuntimeCallError'
	}
}

/**
 * Appelle le stockage du coeur au nom d'une surface.
 *
 * Le jeton et la surface voyagent en en-tetes : le corps ne porte que
 * l'operation. Une frame qui mentirait sur sa surface se ferait refuser par le
 * coeur, dont le jeton est lie a une surface precise.
 */
export function createStorageCaller(surface: HostSurface, getToken: () => string | null) {
	return createRuntimeCaller(surface, getToken, 'storage')
}

/** Appelle le proxy reseau du coeur au nom d'une surface. */
export function createFetchCaller(surface: HostSurface, getToken: () => string | null) {
	const call = createRuntimeCaller(surface, getToken, 'fetch')
	return (payload: Record<string, unknown>) => call('', payload)
}

function createRuntimeCaller(surface: HostSurface, getToken: () => string | null, route: 'storage' | 'fetch') {
	return async function callRuntime(op: string, payload: Record<string, unknown>): Promise<unknown> {
		const token = getToken()
		if (!token) throw new RuntimeCallError('SESSION_EXPIRED', 'aucun jeton d\'extension')

		const res = await fetch(`/api/v1/extensions/${surface.extensionId}/${route}`, {
			method:  'POST',
			headers: {
				'content-type':    'application/json',
				'authorization':   `Bearer ${token}`,
				'x-nodyx-surface': surface.surface,
			},
			body: JSON.stringify(op ? { op, ...payload } : payload),
		})

		const body = await res.json().catch(() => ({}))
		if (!res.ok) throw new RuntimeCallError(body?.code ?? 'UNKNOWN', body?.error ?? 'appel refusé')
		return body?.result
	}
}

export function createHostHandler(surface: HostSurface, actions: HostActions = {}, runtime: HostRuntime = {}) {
	const ledger = new RequestLedger()

	return async function handle(raw: unknown): Promise<Envelope | null> {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
		const m = raw as Record<string, unknown>

		// Un événement remonté par la frame n'attend pas de réponse.
		if (typeof m.event === 'string') return null

		const id = typeof m.id === 'string' && RE_REQ_ID.test(m.id) ? m.id : null
		if (!id) return null                            // sans identifiant, rien à corréler

		if (m.p !== PROTOCOL)      return err(id, 'PROTOCOL_VERSION', `protocole non supporté`)
		if (!ledger.accept(id))    return err(id, 'PROTOCOL_REPLAY', 'identifiant de requête déjà utilisé')

		// Une frame ne parle que pour elle même.
		if (m.ext !== surface.extensionId)                                     return err(id, 'PROTOCOL_WRONG_EXTENSION', 'cette frame ne parle pas pour cette extension')
		if (typeof m.surface !== 'string' || !RE_SURFACE.test(m.surface) ||
		    m.surface !== surface.surface)                                     return err(id, 'PROTOCOL_WRONG_SURFACE', 'cette frame ne parle pas pour cette surface')

		const type    = typeof m.type === 'string' ? m.type : ''
		const payload = (m.payload ?? {}) as Record<string, unknown>

		switch (type) {
			case 'surface.resize': {
				const h = payload.height
				if (typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 20000) actions.resize?.(Math.ceil(h))
				return null                              // notification, pas de réponse
			}

			case 'ui.toast': {
				const msg = payload.message
				if (typeof msg === 'string') actions.toast?.(msg.slice(0, 200))
				return null
			}

			case 'ui.confirm':
				return ok(id, actions.confirm ? await actions.confirm(payload) : false)

			case 'ui.modal':
				return ok(id, actions.modal ? await actions.modal(payload) : null)

			case 'router.push':
			case 'router.replace': {
				if (!isSafeInternalPath(payload.path)) return err(id, 'INVALID_ARGUMENT', 'chemin interne invalide')
				actions.routePush?.(payload.path, type === 'router.replace')
				return null
			}

			case 'host.navigate': {
				if (!isSafeInternalPath(payload.path)) return err(id, 'INVALID_ARGUMENT', 'chemin invalide')
				actions.navigate?.(payload.path)
				return null
			}

			case 'host.external': {
				if (!isSafeExternalUrl(payload.url)) return err(id, 'INVALID_ARGUMENT', 'URL externe invalide')
				actions.external?.(payload.url)
				return null
			}

			case 'net.fetch': {
				if (!runtime.fetch) return err(id, 'NOT_IMPLEMENTED', 'le réseau n\'est pas branché sur cet hôte')
				try {
					return ok(id, await runtime.fetch(payload))
				} catch (e) {
					const code = (e as { code?: string })?.code ?? 'UNKNOWN'
					return err(id, code, (e as Error)?.message ?? 'appel réseau en échec')
				}
			}

			case 'storage.get':
			case 'storage.set':
			case 'storage.delete':
			case 'storage.list': {
				if (!runtime.storage) return err(id, 'NOT_IMPLEMENTED', 'le stockage n\'est pas branché sur cet hôte')
				const op = type.slice('storage.'.length) as 'get' | 'set' | 'delete' | 'list'
				try {
					return ok(id, await runtime.storage(op, payload))
				} catch (e) {
					// Le code du coeur traverse tel quel : une extension doit pouvoir
					// distinguer un quota atteint d'une permission refusée, et le
					// manuel promet des codes stables.
					const code = (e as { code?: string })?.code ?? 'UNKNOWN'
					return err(id, code, (e as Error)?.message ?? 'appel de stockage en échec')
				}
			}

			default:
				if (RUNTIME_API_TYPES.has(type)) {
					return err(id, 'NOT_IMPLEMENTED', `${type} arrive avec l'API de runtime (P0-B)`)
				}
				return err(id, 'PROTOCOL_UNKNOWN_TYPE', `type de requête inconnu : ${type}`)
		}
	}
}

/** Construit la charge d'amorçage transférée avec le port privé. */
export function buildBootPayload(
	surface: HostSurface,
	origin: string,
	entryPath: string,
	ctx: Omit<BootPayload, 'p' | 'type' | 'ext' | 'version' | 'surface' | 'entryUrl' | 'imageBase'>,
): BootPayload {
	const base = `${origin}/api/v1/extensions/${surface.extensionId}/${surface.version}`
	return {
		p:         PROTOCOL,
		type:      'nodyx:boot',
		ext:       surface.extensionId,
		version:   surface.version,
		surface:   surface.surface,
		entryUrl:  `${base}/assets/${entryPath}`,
		imageBase: `${base}/img?u=`,
		...ctx,
	}
}

/** URL du document de frame, pour l'attribut src de l'iframe. */
export function frameUrl(surface: HostSurface, origin = ''): string {
	const q = encodeURIComponent(surface.surface)
	return `${origin}/api/v1/extensions/${surface.extensionId}/${surface.version}/frame?surface=${q}`
}

// ── Activités ────────────────────────────────────────────────────────────────
//
// Une surface `activity` est une iframe cross-origin montée dans un canal
// vocal. Elle n'a ni jeton ni session : l'hôte relaie pour elle, via le socket
// authentifié de la page, uniquement dans la room `voice:<channelId>` que
// l'utilisateur a rejointe (cf SPECS/NODYX_ACTIVITIES_CDC.md §3).
//
// Le pont est plus petit que celui des widgets : tous les messages de l'activité
// sont des notifications (aucune réponse), et il n'y a que quatre types.

/** Plafonds de garde côté hôte, avant l'émission socket. Le serveur re-plafonne. */
const ACTIVITY_MSG_MAX  = 8 * 1024
const ACTIVITY_SNAP_MAX = 16 * 1024

export interface ActivityMember {
	id:          string
	name:        string
	avatar_url:  string
	/** Avatar réduit en PNG 64x64, base64 sans préfixe. Résolu par l'hôte pour
	 *  que l'activité (CSP verrouillée) n'ait pas à faire un fetch cross-origin. */
	avatar_png?: string | null
	seatIndex:   number
	speaking:    boolean
}

export interface ActivityBootPayload {
	p:        typeof PROTOCOL
	type:     'nodyx:activity-boot'
	activity: string
	version:  string
	user:     { id: string; name: string; avatar: string }
	members:  ActivityMember[]
	locale:   string
	theme:    Record<string, string>
	/** Persistance : la frame est same-origin, elle appelle `url` directement
	 *  (jamais par le port). `token` court, ré-émis via l'event `session`. */
	storage?: { url: string; surface: string; token: string | null }
}

export interface ActivityActions {
	room: {
		send:        (payload: unknown, opts: { to: string; reliable: boolean }) => void
		snapshot:    (blob: string) => void
		requestSync: () => void
	}
	toast?: (message: string) => void
}

export function buildActivityBootPayload(
	activityId: string,
	version: string,
	ctx: Omit<ActivityBootPayload, 'p' | 'type' | 'activity' | 'version'>,
): ActivityBootPayload {
	return { p: PROTOCOL, type: 'nodyx:activity-boot', activity: activityId, version, ...ctx }
}

/**
 * Pont hôte d'une activité. Toutes les entrées sont des notifications : la
 * fonction ne renvoie rien. Gardes ceinture (payload sérialisable + borné) en
 * plus du re-plafonnement serveur.
 */
export function createActivityHostHandler(actions: ActivityActions) {
	return function handle(raw: unknown): void {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return
		const m = raw as Record<string, unknown>
		if (m.p !== PROTOCOL || typeof m.type !== 'string') return

		switch (m.type) {
			case 'room.send': {
				let serialized: string
				try { serialized = JSON.stringify(m.payload ?? null) } catch { return }
				if (serialized.length > ACTIVITY_MSG_MAX) return
				actions.room.send(m.payload, {
					to:       typeof m.to === 'string' ? m.to : '',
					reliable: m.reliable !== false,
				})
				return
			}
			case 'room.snapshot': {
				if (typeof m.blob !== 'string' || m.blob.length > ACTIVITY_SNAP_MAX) return
				actions.room.snapshot(m.blob)
				return
			}
			case 'room.sync':
				actions.room.requestSync()
				return
			case 'ui.toast':
				if (typeof m.message === 'string') actions.toast?.(m.message.slice(0, 200))
				return
		}
	}
}
