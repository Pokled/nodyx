import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Le bouclier vu du navigateur : une lecture du serveur par minute au plus,
// pas une à chaque page (il est baissé presque tout le temps).
vi.mock('$lib/api', () => ({
	apiFetch: (f: typeof fetch, path: string, opts: RequestInit = {}) => f(`http://api${path}`, opts),
}))

import { shieldState, _resetShieldState, SHIELD_TTL_MS } from './shieldState'

let calls = 0
let reply: () => any = () => ({ active: false, until: null, readonly: false, slow_seconds: 10 })
let fail = false

beforeEach(() => {
	_resetShieldState(); calls = 0; fail = false
	reply = () => ({ active: false, until: null, readonly: false, slow_seconds: 10 })
	vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-12T20:00:00Z'))
	vi.stubGlobal('fetch', vi.fn(async () => {
		calls++
		if (fail) throw new Error('réseau')
		return new Response(JSON.stringify(reply()), { status: 200 })
	}))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('l’état du bouclier, partagé', () => {
	it('dix pages dans la minute : UNE seule requête', async () => {
		for (let i = 0; i < 10; i++) await shieldState('tok')
		expect(calls).toBe(1)
	})
	it('après une minute, on relit', async () => {
		await shieldState('tok'); vi.setSystemTime(Date.now() + SHIELD_TTL_MS + 1)
		await shieldState('tok')
		expect(calls).toBe(2)
	})
	it('le signal temps réel force la relecture tout de suite', async () => {
		await shieldState('tok'); await shieldState('tok', true)
		expect(calls).toBe(2)
	})
	it('levé : à l’heure de fin, on relit sans attendre la minute', async () => {
		reply = () => ({ active: true, until: new Date(Date.now() + 5000).toISOString(), readonly: true, slow_seconds: 10 })
		expect((await shieldState('tok'))?.active).toBe(true)
		vi.setSystemTime(Date.now() + 6000)
		reply = () => ({ active: false, until: null, readonly: false, slow_seconds: 10 })
		expect((await shieldState('tok'))?.active).toBe(false)
		expect(calls).toBe(2)
	})
	it('plusieurs bandeaux en même temps : une seule requête en vol', async () => {
		await Promise.all([shieldState('tok'), shieldState('tok'), shieldState('tok')])
		expect(calls).toBe(1)
	})
	it('un autre compte (autre jeton) relit pour lui', async () => {
		await shieldState('a'); await shieldState('b')
		expect(calls).toBe(2)
	})
	it('visiteur non connecté : rien n’est demandé', async () => {
		expect(await shieldState(null)).toBeNull(); expect(calls).toBe(0)
	})
	it('une panne réseau garde ce qu’on savait', async () => {
		reply = () => ({ active: true, until: new Date(Date.now() + 600_000).toISOString(), readonly: false, slow_seconds: 10 })
		await shieldState('tok'); fail = true
		expect((await shieldState('tok', true))?.active).toBe(true)
	})
})
