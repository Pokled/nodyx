import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sharedJson, _resetSharedJson } from './sharedJson'

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
beforeEach(() => _resetSharedJson())

describe('les widgets de l’accueil partagent leurs appels', () => {
	it('deux widgets, la même adresse : un seul appel', async () => {
		const f = vi.fn(() => ok({ threads: [1, 2] }))
		const [a, b] = await Promise.all([sharedJson('/api/v1/instance/threads/recent', f as never), sharedJson('/api/v1/instance/threads/recent', f as never)])
		expect(f).toHaveBeenCalledTimes(1)
		expect(a).toEqual({ threads: [1, 2] }); expect(b).toEqual({ threads: [1, 2] })
	})
	it('des adresses différentes : un appel chacune', async () => {
		const f = vi.fn(() => ok({}))
		await sharedJson('/a?limit=6', f as never); await sharedJson('/a?limit=20', f as never)
		expect(f).toHaveBeenCalledTimes(2)
	})
	it('chaque widget a sa propre copie : l’un ne modifie pas les données de l’autre', async () => {
		const f = vi.fn(() => ok({ threads: [{ t: 'x' }] }))
		const a = await sharedJson<{ threads: { t: string }[] }>('/r', f as never)
		a!.threads[0].t = 'modifié'; a!.threads.push({ t: 'y' })
		expect(await sharedJson('/r', f as never)).toEqual({ threads: [{ t: 'x' }] })
	})
	it('un échec n’est pas gardé : le widget suivant réessaie', async () => {
		const f = vi.fn().mockReturnValueOnce(Promise.resolve(new Response('', { status: 500 }))).mockReturnValue(ok({ fine: true }))
		expect(await sharedJson('/r', f as never)).toBeNull()
		await new Promise(r => setTimeout(r, 0))
		expect(await sharedJson('/r', f as never)).toEqual({ fine: true })
		expect(f).toHaveBeenCalledTimes(2)
	})
	it('le partage ne couvre qu’un affichage : passé 10 s, on recharge (un membre qui revient voit les nouveaux sujets)', async () => {
		let t = 1_000_000
		const f = vi.fn().mockReturnValueOnce(ok({ n: 1 })).mockReturnValue(ok({ n: 2 }))
		expect(await sharedJson('/r', f as never, () => t)).toEqual({ n: 1 })
		t += 9_000
		expect(await sharedJson('/r', f as never, () => t)).toEqual({ n: 1 })
		t += 2_000
		expect(await sharedJson('/r', f as never, () => t)).toEqual({ n: 2 })
		expect(f).toHaveBeenCalledTimes(2)
	})
	it('un réseau en panne : null, jamais d’exception', async () => {
		const f = vi.fn(() => Promise.reject(new Error('hors ligne')))
		expect(await sharedJson('/r', f as never)).toBeNull()
	})
})
