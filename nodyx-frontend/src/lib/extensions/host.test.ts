import { describe, it, expect, vi } from 'vitest'
import {
	createHostHandler, buildBootPayload, frameUrl,
	isSafeInternalPath, isSafeExternalUrl, RequestLedger, PROTOCOL,
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

describe('ce qui appartient au lot suivant', () => {
	it.each(['storage.get', 'storage.set', 'net.fetch', 'core.get', 'session.renew'])(
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
