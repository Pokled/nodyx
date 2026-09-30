import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'
import { createAppearanceDraft, changedField } from './appearanceDraft'
import { DEFAULT_SHELL_THEME, type ShellTheme } from './shellTheme'

const PUBLISHED: ShellTheme = { ...DEFAULT_SHELL_THEME, accent: '#3fae6a' }
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response

function setup(initial: Record<string, unknown> = { published: PUBLISHED, draft: null, identity: { published: { logo_url: '/uploads/logos/a.png', banner_url: null }, draft: null } }) {
	const calls: { path: string; method: string; body?: unknown }[] = []
	let failNext: string | null = null
	const api = vi.fn(async (path: string, init: RequestInit = {}) => {
		const method = init.method ?? 'GET'
		calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
		if (failNext === `${method} ${path}`) { failNext = null; return json({ error: 'boom' }, false) }
		if (method === 'GET') return json(initial)
		if (path === '/publish') return json({ published: { ...PUBLISHED, accent: '#ff7a3d' }, identity: null })
		return json({ ok: true })
	})
	const preview = vi.fn()
	const reload = vi.fn(async () => {})
	const draft = createAppearanceDraft({ api, preview, reload, debounceMs: 500, messages: { load: 'L', save: 'S', publish: 'P' } })
	return { draft, api, calls, preview, reload, fail: (k: string) => { failNext = k } }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('appearanceDraft : chargement', () => {
	it('sans brouillon : état publié, aucun aperçu imposé', async () => {
		const { draft, preview } = setup()
		await draft.load()
		expect(get(draft).status).toBe('published')
		expect(get(draft).hist.present.ambiance.accent).toBe('#3fae6a')
		expect(preview).not.toHaveBeenCalled()
	})

	it('avec brouillon : le brouillon est repris ET montré dans le contenant', async () => {
		const { draft, preview } = setup({ published: PUBLISHED, draft: { ...PUBLISHED, accent: '#ff3fa4' }, identity: { published: null, draft: null } })
		await draft.load()
		expect(get(draft).status).toBe('draft')
		expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ accent: '#ff3fa4' }), null)
	})

	it('deux écrans qui chargent (Apparence + stylo) : une seule requête', async () => {
		const { draft, api } = setup()
		await Promise.all([draft.load(), draft.load()])
		expect(api).toHaveBeenCalledTimes(1)
	})
})

describe('appearanceDraft : édition', () => {
	it('aperçu immédiat, puis UN enregistrement groupé après le délai', async () => {
		const { draft, calls, preview } = setup()
		await draft.load()
		draft.setAmbiance({ ...PUBLISHED, accent: '#111111' })
		draft.setAmbiance({ ...PUBLISHED, accent: '#222222' })
		expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ accent: '#222222' }), null)
		expect(get(draft).status).toBe('saving')
		await vi.advanceTimersByTimeAsync(600)
		const puts = calls.filter(c => c.method === 'PUT')
		expect(puts).toHaveLength(1)
		expect(puts[0]).toMatchObject({ path: '/draft', body: expect.objectContaining({ accent: '#222222' }) })
		expect(get(draft).status).toBe('draft')
	})

	it('un geste glissé = un seul pas d’Annuler ; deux clics = deux pas', async () => {
		const { draft } = setup()
		await draft.load()
		for (const i of [10, 20, 30]) draft.setAmbiance({ ...PUBLISHED, intensity: i }, { continuous: true })
		draft.undo()
		expect(get(draft).hist.present.ambiance.intensity).toBe(PUBLISHED.intensity)
		draft.redo()
		draft.setAmbiance({ ...get(draft).hist.present.ambiance, accent: '#aaaaaa' })
		draft.setAmbiance({ ...get(draft).hist.present.ambiance, accent: '#bbbbbb' })
		draft.undo()
		expect(get(draft).hist.present.ambiance.accent).toBe('#aaaaaa')
	})

	it('zones : glisser l’opacité puis le flou d’une zone = deux pas, pas un', async () => {
		const { draft } = setup()
		await draft.load()
		const withZone = (z: object) => ({ ...get(draft).hist.present.ambiance, zones: { rail: { ...get(draft).hist.present.ambiance.zones?.rail, ...z } } })
		for (const o of [40, 50, 60]) draft.setAmbiance(withZone({ opacity: o }), { continuous: true })
		for (const b of [4, 8]) draft.setAmbiance(withZone({ blur: b }), { continuous: true })
		draft.undo()
		expect(get(draft).hist.present.ambiance.zones?.rail).toEqual({ opacity: 60 })
		draft.undo()
		expect(get(draft).hist.present.ambiance.zones).toBeUndefined()
	})

	it('changedField descend jusqu’au champ de la zone', () => {
		expect(changedField(PUBLISHED, { ...PUBLISHED, accent: '#000000' })).toBe('accent')
		expect(changedField(PUBLISHED, { ...PUBLISHED, zones: { sheet: { radius: 4 } } })).toBe('zones.sheet.radius')
		expect(changedField({ ...PUBLISHED, zones: { sheet: { radius: 4 } } }, { ...PUBLISHED, zones: { sheet: { radius: 4, blur: 2 } } })).toBe('zones.sheet.blur')
	})

	it('identité revenue à la version publiée : on retire son seul brouillon', async () => {
		const { draft, calls } = setup()
		await draft.load()
		draft.setIdentity({ logo_url: '/uploads/logos/n.png' })
		await vi.advanceTimersByTimeAsync(600)
		draft.setIdentity(null)
		await vi.advanceTimersByTimeAsync(600)
		expect(calls.filter(c => c.path === '/draft/identity').map(c => c.method)).toEqual(['PUT', 'DELETE'])
	})

	it('un enregistrement refusé passe en erreur avec le message du serveur', async () => {
		const { draft, fail } = setup()
		await draft.load()
		fail('PUT /draft')
		draft.setAmbiance({ ...PUBLISHED, accent: '#123456' })
		await vi.advanceTimersByTimeAsync(600)
		expect(get(draft)).toMatchObject({ status: 'error', error: 'boom' })
	})
})

describe('appearanceDraft : publication et abandon', () => {
	it('publier ATTEND l’enregistrement en cours, puis recharge le site et retire l’aperçu', async () => {
		const { draft, calls, reload, preview } = setup()
		await draft.load()
		draft.setAmbiance({ ...PUBLISHED, accent: '#ff7a3d' })
		const ok = await draft.publish()
		expect(ok).toBe(true)
		const order = calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`)
		expect(order).toEqual(['PUT /draft', 'POST /publish'])
		expect(reload).toHaveBeenCalled()
		expect(preview).toHaveBeenLastCalledWith(null, null)
		expect(get(draft).status).toBe('published')
		expect(get(draft).hist.past).toEqual([])
	})

	it('publication refusée : erreur, pas de rechargement', async () => {
		const { draft, reload, fail } = setup()
		await draft.load()
		draft.setAmbiance({ ...PUBLISHED, accent: '#ff7a3d' })
		fail('POST /publish')
		expect(await draft.publish()).toBe(false)
		expect(get(draft).status).toBe('error')
		expect(reload).not.toHaveBeenCalled()
	})

	it('revenir à la version publiée : brouillons supprimés, aperçu retiré, valeurs publiées', async () => {
		const { draft, calls, preview } = setup()
		await draft.load()
		draft.setAmbiance({ ...PUBLISHED, accent: '#000000' })
		await draft.revert()
		expect(calls.some(c => c.method === 'DELETE' && c.path === '/draft')).toBe(true)
		expect(preview).toHaveBeenLastCalledWith(null, null)
		expect(get(draft).hist.present.ambiance.accent).toBe('#3fae6a')
		await vi.advanceTimersByTimeAsync(1000)
		expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0)   // le brouillon annulé ne repart pas
	})

	it('après un retour en arrière, aucun brouillon fantôme ne se recrée au prochain enregistrement', async () => {
		const { draft, calls } = setup()
		await draft.load()
		draft.setAmbiance({ ...PUBLISHED, accent: '#000000' })
		await draft.revert()
		await draft.flush()
		expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0)
		expect(get(draft).status).toBe('published')
	})
})
