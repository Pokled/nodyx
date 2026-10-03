/**
 * appearanceDraft.ts — LE moteur d'apparence côté navigateur
 * (SPECS/NODYX_APPARENCE_CDC.md, partie 2, volet A).
 *
 * Brouillon (ambiance + identité), enregistrement automatique, Annuler /
 * Rétablir, publication, abandon. Un seul exemplaire par onglet, partagé par
 * l'écran Apparence ET le stylo en direct : une retouche faite d'un côté se
 * voit de l'autre par construction, pas par synchronisation.
 *
 * Le réseau, l'aperçu et le rechargement des données sont injectés
 * (createAppearanceDraft) : le cœur se teste sans navigateur.
 */
import { writable, get, type Readable } from 'svelte/store'
import { DEFAULT_SHELL_THEME, type ShellTheme } from './shellTheme'
import { historyStart, historyPush, historyUndo, historyRedo, type History } from './ambianceTools'

export type Ident = { logo_url?: string | null; banner_url?: string | null }
export type Snapshot = { ambiance: ShellTheme; identity: Ident | null }
export type DraftStatus = 'idle' | 'loading' | 'published' | 'saving' | 'draft' | 'publishing' | 'error'

export interface DraftState {
	status: DraftStatus
	error: string
	published: ShellTheme | null
	identityPublished: { logo_url: string | null; banner_url: string | null } | null
	hist: History<Snapshot>
}

export interface DraftDeps {
	/** Appel à /api/v1/admin/appearance{path}, jeton compris. */
	api: (path: string, init?: RequestInit) => Promise<Response>
	/** Montre (ou retire, null) le brouillon dans le vrai contenant. */
	preview: (ambiance: ShellTheme | null, identity: Ident | null) => void
	/** Recharge les données du site après publication. */
	reload: () => Promise<void>
	/** Délai d'enregistrement automatique (ms). */
	debounceMs?: number
	/** Messages d'erreur : texte, ou fonction pour traduire au moment de l'afficher. */
	messages: { load: Msg; save: Msg; publish: Msg }
}

type Msg = string | (() => string)
const msg = (m: Msg) => typeof m === 'function' ? m() : m
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Le réglage touché, jusqu'au champ d'une zone (« zones.rail.opacity ») :
 * glisser l'opacité puis le flou d'une même zone fait DEUX pas d'Annuler.
 */
export function changedField(a: ShellTheme, b: ShellTheme): string {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ShellTheme>
	for (const k of keys) {
		if (same(a[k], b[k])) continue
		if (k !== 'zones') return k
		const za = a.zones ?? {}, zb = b.zones ?? {}
		for (const z of new Set([...Object.keys(za), ...Object.keys(zb)]) as Set<keyof typeof za>) {
			const fa = (za[z] ?? {}) as Record<string, unknown>, fb = (zb[z] ?? {}) as Record<string, unknown>
			if (same(fa, fb)) continue
			const f = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].find(f => !same(fa[f], fb[f]))
			return `zones.${z}.${f ?? ''}`
		}
	}
	return ''
}

export function createAppearanceDraft(deps: DraftDeps) {
	const initial = (): DraftState => ({
		status: 'idle', error: '', published: null, identityPublished: null,
		hist: historyStart({ ambiance: { ...DEFAULT_SHELL_THEME }, identity: null }),
	})
	const store = writable<DraftState>(initial())
	const patch = (p: Partial<DraftState>) => store.update(s => ({ ...s, ...p }))

	let timer: ReturnType<typeof setTimeout> | undefined
	let pending: Promise<void> | null = null
	let dirty = { ambiance: false, identity: false }
	let lastContinuous = ''
	let loading: Promise<void> | null = null

	function showPreview(s: DraftState, force = false) {
		const p = s.hist.present
		const hasDraft = s.status === 'draft' || s.status === 'saving' || force
		deps.preview(hasDraft ? p.ambiance : null, hasDraft ? p.identity : null)
	}

	/** Charge publié + brouillon. Idempotent : un second appel réutilise le premier. */
	function load(force = false): Promise<void> {
		if (loading && !force) return loading
		patch({ status: 'loading' })
		loading = (async () => {
			try {
				const res = await deps.api('/')
				if (!res.ok) throw new Error()
				const json = await res.json()
				const draftExists = !!(json.draft || json.identity?.draft)
				store.set({
					status: draftExists ? 'draft' : 'published',
					error: '',
					published: json.published ?? null,
					identityPublished: json.identity?.published ?? null,
					hist: historyStart({
						ambiance: { ...DEFAULT_SHELL_THEME, ...(json.draft ?? json.published ?? {}) },
						identity: json.identity?.draft ?? null,
					}),
				})
				if (draftExists) showPreview(get(store), true)
			} catch {
				patch({ status: 'error', error: msg(deps.messages.load) })
				loading = null
			}
		})()
		return loading
	}

	function schedule() {
		patch({ status: 'saving' })
		clearTimeout(timer)
		timer = setTimeout(() => { pending = save() }, deps.debounceMs ?? 500)
	}

	async function save(): Promise<void> {
		const parts = dirty
		dirty = { ambiance: false, identity: false }
		const p = get(store).hist.present
		try {
			if (parts.ambiance) {
				const r = await deps.api('/draft', { method: 'PUT', body: JSON.stringify(p.ambiance) })
				if (!r.ok) { const j = await r.json().catch(() => ({})); patch({ status: 'error', error: j.error ?? msg(deps.messages.save) }); return }
			}
			if (parts.identity) {
				// Identité revenue à la version publiée : on retire son seul brouillon.
				const r = p.identity
					? await deps.api('/draft/identity', { method: 'PUT', body: JSON.stringify(p.identity) })
					: await deps.api('/draft/identity', { method: 'DELETE' })
				if (!r.ok) { const j = await r.json().catch(() => ({})); patch({ status: 'error', error: j.error ?? msg(deps.messages.save) }); return }
			}
			patch({ status: 'draft' })
		} catch {
			patch({ status: 'error', error: msg(deps.messages.save) })
		}
	}

	function commit(next: History<Snapshot>) {
		const s = get(store)
		const before = s.hist.present
		if (next === s.hist) return
		if (!same(before.ambiance, next.present.ambiance)) dirty.ambiance = true
		if (!same(before.identity, next.present.identity)) dirty.identity = true
		if (!dirty.ambiance && !dirty.identity) { patch({ hist: next }); return }
		patch({ hist: next })
		deps.preview(next.present.ambiance, next.present.identity)
		schedule()
	}

	/**
	 * Nouvelle ambiance. `continuous` : geste qui glisse (curseur, sélecteur de
	 * couleur), dont les valeurs successives sur le MÊME réglage comptent pour
	 * un seul pas d'Annuler. Un clic n'est jamais fusionné.
	 */
	function setAmbiance(v: ShellTheme, opts: { continuous?: boolean } = {}) {
		const s = get(store)
		const cur = s.hist.present.ambiance
		const field = changedField(cur, v)
		const merge = !!opts.continuous && field === lastContinuous
		lastContinuous = opts.continuous ? field : ''
		commit(historyPush(s.hist, { ...s.hist.present, ambiance: v }, merge))
	}

	function setIdentity(next: Ident | null) {
		const s = get(store)
		lastContinuous = ''
		commit(historyPush(s.hist, { ...s.hist.present, identity: next }))
	}

	function undo() { lastContinuous = ''; commit(historyUndo(get(store).hist)) }
	function redo() { lastContinuous = ''; commit(historyRedo(get(store).hist)) }

	async function flush() {
		clearTimeout(timer)
		if (dirty.ambiance || dirty.identity) pending = save()
		if (pending) await pending
	}

	async function publish(): Promise<boolean> {
		await flush()
		if (get(store).status === 'error') return false
		patch({ status: 'publishing' })
		try {
			const r = await deps.api('/publish', { method: 'POST' })
			const j = await r.json().catch(() => ({}))
			if (!r.ok) { patch({ status: 'error', error: j.error ?? msg(deps.messages.publish) }); return false }
			const s = get(store)
			await deps.reload()
			deps.preview(null, null)
			store.set({
				...s,
				status: 'published', error: '',
				published: j.published ?? s.published,
				identityPublished: j.identity ? { logo_url: s.identityPublished?.logo_url ?? null, banner_url: s.identityPublished?.banner_url ?? null, ...j.identity } : s.identityPublished,
				hist: historyStart({ ambiance: s.hist.present.ambiance, identity: null }),
			})
			return true
		} catch {
			patch({ status: 'error', error: msg(deps.messages.publish) })
			return false
		}
	}

	async function revert() {
		clearTimeout(timer)
		if (pending) await pending
		dirty = { ambiance: false, identity: false }
		try { await deps.api('/draft', { method: 'DELETE' }) } catch { /* rien à perdre : on réessaiera */ }
		const s = get(store)
		deps.preview(null, null)
		store.set({ ...s, status: 'published', error: '', hist: historyStart({ ambiance: { ...DEFAULT_SHELL_THEME, ...(s.published ?? {}) }, identity: null }) })
	}

	/** Quitter l'édition : le site retrouve l'apparence publiée ; le brouillon reste côté serveur. */
	function hidePreview() { deps.preview(null, null) }
	/** Revenir à l'édition : remontre le brouillon s'il y en a un. */
	function resumePreview() { showPreview(get(store)) }

	return {
		subscribe: store.subscribe as Readable<DraftState>['subscribe'],
		load, setAmbiance, setIdentity, undo, redo, flush, publish, revert, hidePreview, resumePreview,
		/** Pour les tests. */
		_reset: () => { clearTimeout(timer); pending = null; loading = null; dirty = { ambiance: false, identity: false }; store.set(initial()) },
	}
}

export type AppearanceDraft = ReturnType<typeof createAppearanceDraft>
