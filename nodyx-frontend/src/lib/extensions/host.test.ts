import { describe, it, expect, vi } from 'vitest'
import {
	createHostHandler, buildBootPayload, frameUrl, createStorageCaller, createFetchCaller, RuntimeCallError,
	isSafeInternalPath, isSafeExternalUrl, RequestLedger, PROTOCOL,
	createActivityHostHandler, buildActivityBootPayload,
	type HostSurface,
} from './host'

const SURFACE: HostSurface = { extensionId: 'library', version: '1.0.0', surface: 'widget:tonight' }

function req(over: Record<string, unknown> = {}) {
	return { p: PROTOCOL, id: 'r1', ext: 'library', surface: 'widget:tonight', type: 'ui.confirm', payload: {}, ...over }
}

describe('une frame ne parle que pour elle même', () => {
	it('refuse une requête au nom d une autre extension', async () => {
		const handle = createHostHandler(SURFACE)
		const r = await handle(req({ ext: 'autre' }))
		expect(r).toMatchObject({ ok: false, error: { code: 'PROTOCOL_WRONG_EXTENSION' } })
	})

	it('refuse une requête au nom d une autre surface', async () => {
		const handle = createHostHandler(SURFACE)
		const r = await handle(req({ surface: 'page' }))
		expect(r).toMatchObject({ ok: false, error: { code: 'PROTOCOL_WRONG_SURFACE' } })
	})

	it('refuse une version de protocole différente', async () => {
		const handle = createHostHandler(SURFACE)
		expect(await handle(req({ p: 2 }))).toMatchObject({ ok: false, error: { code: 'PROTOCOL_VERSION' } })
	})

	it('refuse un rejeu du même identifiant', async () => {
		const handle = createHostHandler(SURFACE)
		await handle(req())
		expect(await handle(req())).toMatchObject({ ok: false, error: { code: 'PROTOCOL_REPLAY' } })
	})

	it('ignore ce qui n est pas une enveloppe', async () => {
		const handle = createHostHandler(SURFACE)
		for (const raw of [null, 42, 'texte', [], { p: 1 }, { p: 1, id: 'id invalide' }]) {
			expect(await handle(raw)).toBeNull()
		}
	})
})

describe('actions rendues par l hôte', () => {
	it('transmet un redimensionnement plausible et rejette le reste', async () => {
		const resize = vi.fn()
		const handle = createHostHandler(SURFACE, { resize })
		await handle(req({ id: 'a', type: 'surface.resize', payload: { height: 321.4 } }))
		expect(resize).toHaveBeenCalledWith(322)

		for (const [i, height] of [-5, NaN, 1e9, '300'].entries()) {
			await handle(req({ id: 'h' + i, type: 'surface.resize', payload: { height } }))
		}
		expect(resize).toHaveBeenCalledOnce()
	})

	it('tronque un message de notification bavard', async () => {
		const toast = vi.fn()
		const handle = createHostHandler(SURFACE, { toast })
		await handle(req({ type: 'ui.toast', payload: { message: 'x'.repeat(500) } }))
		expect((toast.mock.calls[0][0] as string).length).toBe(200)
	})

	it('rend la réponse d une confirmation, corrélée', async () => {
		const handle = createHostHandler(SURFACE, { confirm: async () => true })
		expect(await handle(req({ id: 'c1', type: 'ui.confirm' }))).toEqual({ p: 1, id: 'c1', ok: true, result: true })
	})

	it('répond faux quand l hôte ne sait pas confirmer', async () => {
		const handle = createHostHandler(SURFACE)
		expect(await handle(req({ type: 'ui.confirm' }))).toMatchObject({ ok: true, result: false })
	})
})

describe('navigation : une extension reste chez elle', () => {
	it('accepte un chemin interne sain', async () => {
		const routePush = vi.fn()
		const handle = createHostHandler(SURFACE, { routePush })
		await handle(req({ type: 'router.push', payload: { path: '/film/603' } }))
		expect(routePush).toHaveBeenCalledWith('/film/603', false)
	})

	it('distingue push et replace', async () => {
		const routePush = vi.fn()
		const handle = createHostHandler(SURFACE, { routePush })
		await handle(req({ type: 'router.replace', payload: { path: '/' } }))
		expect(routePush).toHaveBeenCalledWith('/', true)
	})

	it.each(['//evil.example', '/a/../../admin', 'relatif', '/a\\b', 'javascript:alert(1)', ''])(
		'refuse le chemin interne %p', async (path) => {
			const routePush = vi.fn()
			const handle = createHostHandler(SURFACE, { routePush })
			const r = await handle(req({ type: 'router.push', payload: { path } }))
			expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
			expect(routePush).not.toHaveBeenCalled()
		})

	it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'nope'])(
		'refuse l URL externe %p', async (url) => {
			const external = vi.fn()
			const handle = createHostHandler(SURFACE, { external })
			const r = await handle(req({ type: 'host.external', payload: { url } }))
			expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
			expect(external).not.toHaveBeenCalled()
		})

	it('accepte une URL externe en http ou https', async () => {
		const external = vi.fn()
		const handle = createHostHandler(SURFACE, { external })
		await handle(req({ type: 'host.external', payload: { url: 'https://example.org/a' } }))
		expect(external).toHaveBeenCalledWith('https://example.org/a')
	})
})

describe('stockage, proxy par l hote', () => {
	it('transmet l operation et la charge au runtime', async () => {
		const storage = vi.fn().mockResolvedValue([603])
		const handle = createHostHandler(SURFACE, {}, { storage })
		const r = await handle(req({ type: 'storage.get', payload: { key: 'watched', scope: 'user' } }))
		expect(storage).toHaveBeenCalledWith('get', { key: 'watched', scope: 'user' })
		expect(r).toMatchObject({ ok: true, result: [603] })
	})

	it.each(['get', 'set', 'delete', 'list'])('route l operation %s', async (op) => {
		const storage = vi.fn().mockResolvedValue(null)
		const handle = createHostHandler(SURFACE, {}, { storage })
		await handle(req({ type: `storage.${op}` }))
		expect(storage.mock.calls[0][0]).toBe(op)
	})

	it('retransmet le code du coeur tel quel', async () => {
		// Une extension doit distinguer un quota atteint d'une permission
		// refusee : le manuel promet des codes stables.
		const storage = vi.fn().mockRejectedValue(new RuntimeCallError('QUOTA_EXCEEDED', 'quota atteint'))
		const handle = createHostHandler(SURFACE, {}, { storage })
		const r = await handle(req({ type: 'storage.set', payload: { key: 'k', value: 1 } }))
		expect(r).toMatchObject({ ok: false, error: { code: 'QUOTA_EXCEEDED' } })
	})

	it('repond « pas branche » quand l hote n a pas de runtime', async () => {
		const handle = createHostHandler(SURFACE)
		expect(await handle(req({ type: 'storage.get' }))).toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } })
	})
})

describe('appel de stockage vers le coeur', () => {
	it('porte le jeton et la surface en en-tetes, pas dans le corps', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true, json: async () => ({ result: 'ok' }),
		})
		vi.stubGlobal('fetch', fetchMock)

		const call = createStorageCaller(SURFACE, () => 'JETON')
		expect(await call('get', { key: 'k' })).toBe('ok')

		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('/api/v1/extensions/library/storage')
		expect(init.headers.authorization).toBe('Bearer JETON')
		expect(init.headers['x-nodyx-surface']).toBe('widget:tonight')
		expect(JSON.parse(init.body)).toEqual({ op: 'get', key: 'k' })
		vi.unstubAllGlobals()
	})

	it('leve avec le code du coeur quand l appel est refuse', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: false, json: async () => ({ code: 'PERMISSION_DENIED', error: 'refuse' }),
		}))
		const call = createStorageCaller(SURFACE, () => 'JETON')
		await expect(call('get', { key: 'k' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
		vi.unstubAllGlobals()
	})

	it('leve sans jeton plutot que d appeler dans le vide', async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		const call = createStorageCaller(SURFACE, () => null)
		await expect(call('get', { key: 'k' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
		expect(fetchMock).not.toHaveBeenCalled()
		vi.unstubAllGlobals()
	})
})

describe('reseau, proxy par l hote', () => {
	it('transmet l appel au runtime et rend la reponse', async () => {
		const netFetch = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: '{}' })
		const handle = createHostHandler(SURFACE, {}, { fetch: netFetch })
		const r = await handle(req({ type: 'net.fetch', payload: { url: 'https://a.example/x', method: 'GET' } }))
		expect(netFetch).toHaveBeenCalledWith({ url: 'https://a.example/x', method: 'GET' })
		expect(r).toMatchObject({ ok: true })
	})

	it('retransmet le code du coeur, pour distinguer un refus d un service en panne', async () => {
		const netFetch = vi.fn().mockRejectedValue(new RuntimeCallError('HOST_NOT_ALLOWED', 'non accorde'))
		const handle = createHostHandler(SURFACE, {}, { fetch: netFetch })
		const r = await handle(req({ type: 'net.fetch', payload: { url: 'https://evil.example/' } }))
		expect(r).toMatchObject({ ok: false, error: { code: 'HOST_NOT_ALLOWED' } })
	})

	it('repond « pas branche » quand l hote n a pas de reseau', async () => {
		const handle = createHostHandler(SURFACE)
		expect(await handle(req({ type: 'net.fetch' }))).toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } })
	})

	it('poste la charge telle quelle, sans champ op', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { status: 200 } }) })
		vi.stubGlobal('fetch', fetchMock)
		const call = createFetchCaller(SURFACE, () => 'JETON')
		await call({ url: 'https://a.example/x', method: 'GET' })
		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('/api/v1/extensions/library/fetch')
		expect(JSON.parse(init.body)).toEqual({ url: 'https://a.example/x', method: 'GET' })
		vi.unstubAllGlobals()
	})
})

describe('ce qui appartient au lot suivant', () => {
	it.each(['core.get', 'session.renew'])(
		'%s repond « pas encore », pas un refus muet', async (type) => {
			// Une extension doit pouvoir distinguer « pas encore » de « refuse ».
			const handle = createHostHandler(SURFACE)
			const r = await handle(req({ type }))
			expect(r).toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } })
		})

	it('refuse un type inconnu', async () => {
		const handle = createHostHandler(SURFACE)
		expect(await handle(req({ type: 'fs.readFile' }))).toMatchObject({ ok: false, error: { code: 'PROTOCOL_UNKNOWN_TYPE' } })
	})
})

describe('amorçage', () => {
	it('construit une charge complète et des URL versionnées', () => {
		const boot = buildBootPayload(SURFACE, 'https://instance.example', 'ui/tonight.js', {
			config: { mood: 'learn' }, messages: { label: 'Ce soir' }, locale: 'fr',
			theme: { accent: '#a78bfa' }, instance: { name: 'Nodyx' }, user: null, route: '/',
		})
		expect(boot.type).toBe('nodyx:boot')
		expect(boot.entryUrl).toBe('https://instance.example/api/v1/extensions/library/1.0.0/assets/ui/tonight.js')
		expect(boot.imageBase).toBe('https://instance.example/api/v1/extensions/library/1.0.0/img?u=')
		expect(boot.user).toBeNull()
	})

	it('l URL de frame porte la surface, encodée', () => {
		expect(frameUrl(SURFACE)).toBe('/api/v1/extensions/library/1.0.0/frame?surface=widget%3Atonight')
	})
})

describe('outils', () => {
	it('le registre reste borné sans perdre les récents', () => {
		const l = new RequestLedger(4)
		for (let i = 0; i < 100; i++) expect(l.accept('i' + i)).toBe(true)
		expect(l.accept('i99')).toBe(false)
	})

	it('isSafeInternalPath et isSafeExternalUrl sont stricts', () => {
		expect(isSafeInternalPath('/ok')).toBe(true)
		expect(isSafeInternalPath('/'.repeat(600))).toBe(false)
		expect(isSafeExternalUrl('http://a.example')).toBe(true)
		expect(isSafeExternalUrl('ftp://a.example')).toBe(false)
	})
})

// Regression vue en production, dans le builder d'accueil.
//
// `postMessage` clone la charge, et le clonage structure NE SAIT PAS cloner un
// proxy `$state` de Svelte 5 : il leve un DataCloneError et la frame ne
// demarre jamais. Sur la page d'accueil la configuration vient du serveur,
// donc c'est un objet ordinaire et rien ne se voyait.
describe('la charge d amorcage doit etre clonable', () => {
	it('une charge normale passe le clonage structure', () => {
		const boot = buildBootPayload(SURFACE, 'https://instance.example', 'ui/w.js', {
			config: { titre: 'x', n: 1 }, messages: { a: 'b' }, locale: 'fr',
			theme: { accent: '#000' }, instance: { name: 'N' }, user: null, route: '/',
		})
		expect(() => structuredClone(boot)).not.toThrow()
	})

	it('une charge portant une valeur non clonable EST rejetee, ce qui prouve le test', () => {
		// Sans cette moitie, le test precedent ne demontrerait rien : il faut
		// que le clonage sache echouer.
		const boot = buildBootPayload(SURFACE, 'https://instance.example', 'ui/w.js', {
			config: { rappel: () => 'non clonable' } as unknown as Record<string, unknown>,
			messages: {}, locale: 'fr', theme: {}, instance: {}, user: null, route: '/',
		})
		expect(() => structuredClone(boot)).toThrow()
	})
})

// ── Activités ────────────────────────────────────────────────────────────────

describe('createActivityHostHandler', () => {
	function mk() {
		const calls: { fn: string; args: unknown[] }[] = []
		const handle = createActivityHostHandler({
			room: {
				send:        (payload, opts) => calls.push({ fn: 'send', args: [payload, opts] }),
				snapshot:    (blob) => calls.push({ fn: 'snapshot', args: [blob] }),
				requestSync: () => calls.push({ fn: 'sync', args: [] }),
			},
			toast: (m) => calls.push({ fn: 'toast', args: [m] }),
		})
		return { handle, calls }
	}

	it('room.send transmet payload + to + reliable', () => {
		const { handle, calls } = mk()
		handle({ p: PROTOCOL, type: 'room.send', payload: { t: 'king' }, to: 'u-1', reliable: false })
		expect(calls).toEqual([{ fn: 'send', args: [{ t: 'king' }, { to: 'u-1', reliable: false }] }])
	})

	it('room.send sans to/reliable : broadcast fiable par defaut', () => {
		const { handle, calls } = mk()
		handle({ p: PROTOCOL, type: 'room.send', payload: { x: 1 } })
		expect(calls[0].args[1]).toEqual({ to: '', reliable: true })
	})

	it('room.send : payload > 8 Ko ignore', () => {
		const { handle, calls } = mk()
		handle({ p: PROTOCOL, type: 'room.send', payload: { big: 'x'.repeat(9000) } })
		expect(calls).toHaveLength(0)
	})

	it('room.send : payload cyclique ignore, pas de crash', () => {
		const { handle, calls } = mk()
		const c: Record<string, unknown> = {}; c.self = c
		handle({ p: PROTOCOL, type: 'room.send', payload: c })
		expect(calls).toHaveLength(0)
	})

	it('room.snapshot : blob string borne', () => {
		const { handle, calls } = mk()
		handle({ p: PROTOCOL, type: 'room.snapshot', blob: 'AAAA' })
		handle({ p: PROTOCOL, type: 'room.snapshot', blob: 'A'.repeat(20000) })
		handle({ p: PROTOCOL, type: 'room.snapshot', blob: 42 })
		expect(calls).toEqual([{ fn: 'snapshot', args: ['AAAA'] }])
	})

	it('room.sync et ui.toast', () => {
		const { handle, calls } = mk()
		handle({ p: PROTOCOL, type: 'room.sync' })
		handle({ p: PROTOCOL, type: 'ui.toast', message: 'coucou' })
		expect(calls.map(c => c.fn)).toEqual(['sync', 'toast'])
	})

	it('mauvais protocole ou type inconnu : ignore', () => {
		const { handle, calls } = mk()
		handle({ p: 2, type: 'room.send', payload: {} })
		handle({ p: PROTOCOL, type: 'core.get' })
		handle(null)
		handle('x')
		expect(calls).toHaveLength(0)
	})
})

describe('buildActivityBootPayload', () => {
	it('forme et clonabilite', () => {
		const boot = buildActivityBootPayload('kings-race', '0.3.0', {
			user: { id: 'u1', name: 'Alice', avatar: '' },
			members: [{ id: 'u1', name: 'Alice', avatar_url: '', seatIndex: 0, speaking: false }],
			locale: 'fr', theme: {},
		})
		expect(boot).toMatchObject({ p: PROTOCOL, type: 'nodyx:activity-boot', activity: 'kings-race', version: '0.3.0' })
		expect(() => structuredClone(boot)).not.toThrow()
	})
})
