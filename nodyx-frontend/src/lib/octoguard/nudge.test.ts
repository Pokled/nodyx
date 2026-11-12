import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fr from '../locales/fr.json'
import en from '../locales/en.json'

// « Tu es sûr ? » côté navigateur : au moindre doute, le message part.
vi.mock('$lib/api', () => ({
	apiFetch: (f: typeof fetch, path: string, opts: RequestInit = {}) => f(`http://api${path}`, opts),
}))

import { precheckMessage, parseNudge, nudgeEnabled, _resetNudgeCache, PRECHECK_TIMEOUT_MS } from './nudge'

type Call = { url: string; method: string; body: any }
let calls: Call[] = []
let enabled = true
let answer: (body: any) => any = () => ({ enabled: true, nudge: null })
let delayMs = 0

beforeEach(() => {
	_resetNudgeCache(); calls = []; enabled = true; delayMs = 0
	answer = () => ({ enabled: true, nudge: null })
	vi.stubGlobal('fetch', vi.fn(async (url: string, opts: RequestInit = {}) => {
		const method = opts.method ?? 'GET'
		const body = opts.body ? JSON.parse(String(opts.body)) : null
		calls.push({ url, method, body })
		if (delayMs) await new Promise((r, j) => {
			const t = setTimeout(r, delayMs)
			opts.signal?.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('aborted', 'AbortError')) })
		})
		const json = method === 'GET' ? { enabled } : answer(body)
		return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
	}))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('parseNudge', () => {
	it('garde une réponse connue', () => {
		expect(parseNudge({ outcome: 'hold', kind: 'words' })).toEqual({ outcome: 'hold', kind: 'words' })
	})
	it('une sorte inconnue devient « other », un cran inconnu ne s’affiche pas', () => {
		expect(parseNudge({ outcome: 'warn', kind: 'nouveau' })).toEqual({ outcome: 'warn', kind: 'other' })
		expect(parseNudge({ outcome: 'explode', kind: 'words' })).toBeNull()
		expect(parseNudge(null)).toBeNull()
		expect(parseNudge('hold')).toBeNull()
	})
	it('chaque cran et chaque sorte a sa phrase, en français et en anglais', () => {
		for (const dict of [fr, en] as Array<Record<string, string>>) {
			for (const o of ['hold', 'refuse', 'warn', 'sanction']) expect(dict[`ognudge.title_${o}`]).toBeTruthy()
			for (const k of ['words', 'links', 'caps', 'mentions', 'other']) expect(dict[`ognudge.why_${k}`]).toBeTruthy()
		}
	})
	it('le français tutoie', () => {
		const mine = Object.entries(fr as Record<string, string>).filter(([k]) => k.startsWith('ognudge.') || k.startsWith('og2.mv_nudge') || k.startsWith('og2.tpl_nudge'))
		for (const [k, v] of mine) expect(`${k}: ${v}`).not.toMatch(/\b(vous|votre|vos)\b/i)
	})
})

describe('precheckMessage', () => {
	it('éteint sur l’instance : AUCUN texte n’est envoyé au serveur', async () => {
		enabled = false
		expect(await precheckMessage('tok', 'chat', 't’es nul')).toBeNull()
		expect(calls.filter((c) => c.method === 'POST')).toEqual([])
	})
	it('l’état « allumé » est demandé une fois, pas à chaque message', async () => {
		await precheckMessage('tok', 'chat', 'a')
		await precheckMessage('tok', 'chat', 'b')
		await precheckMessage('tok', 'chat', 'c')
		expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(3)
	})
	it('rend l’annonce du serveur', async () => {
		answer = () => ({ enabled: true, nudge: { outcome: 'hold', kind: 'words' } })
		expect(await precheckMessage('tok', 'forum', '<p>x</p>', 'Titre')).toEqual({ outcome: 'hold', kind: 'words' })
		expect(calls.at(-1)!.body).toEqual({ surface: 'forum', content: '<p>x</p>', title: 'Titre' })
	})
	it('serveur trop lent : on n’attend pas, le message part', async () => {
		await nudgeEnabled('tok')
		delayMs = PRECHECK_TIMEOUT_MS * 3
		answer = () => ({ enabled: true, nudge: { outcome: 'refuse', kind: 'words' } })
		const t0 = Date.now()
		expect(await precheckMessage('tok', 'chat', 'x')).toBeNull()
		expect(Date.now() - t0).toBeLessThan(PRECHECK_TIMEOUT_MS + 500)
		expect(Date.now() - t0).toBeGreaterThanOrEqual(PRECHECK_TIMEOUT_MS - 50)
	})
	it('erreur réseau : le message part', async () => {
		await nudgeEnabled('tok')
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
		expect(await precheckMessage('tok', 'chat', 'x')).toBeNull()
	})
	it('éteint entre-temps par l’admin : on arrête de demander', async () => {
		await precheckMessage('tok', 'chat', 'a')
		answer = () => ({ enabled: false, nudge: null })
		await precheckMessage('tok', 'chat', 'b')
		const before = calls.length
		await precheckMessage('tok', 'chat', 'c')
		expect(calls.length).toBe(before)
	})
	it('sans jeton : rien', async () => {
		expect(await precheckMessage(null, 'chat', 'x')).toBeNull()
		expect(calls).toEqual([])
	})
})
