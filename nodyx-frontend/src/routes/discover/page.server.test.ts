// ─── /discover ne doit jamais bloquer le rendu SSR indéfiniment ─────────────
//
// Trouvé en audit de stabilité (F-040, 2026-09-11) : ce fetch vers l'annuaire
// fédéré n'avait aucun timeout, contrairement à +layout.server.ts (déjà
// corrigé après un incident réel : page d'accueil bloquée 27s par un directory
// muet, pas en erreur, juste silencieux). Ces tests tombent sur l'ancien code :
// sans AbortSignal, un fetch qui ne répond jamais ne renverrait jamais l'erreur
// de repli, il resterait en attente. cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from './+page.server';

function fakeEvent(searchParams: Record<string, string> = {}) {
	const url = new URL('http://localhost/discover');
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
	return { fetch: vi.fn(), url } as any;
}

describe('/discover — load', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('passe un AbortSignal borné au fetch du répertoire', async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });

		await load(fakeEvent({ q: 'test' }));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0];
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	it("renvoie un message d'erreur propre quand le répertoire ne répond jamais (timeout), au lieu de rester bloqué", async () => {
		const abortError = new DOMException('The operation was aborted.', 'AbortError');
		fetchMock.mockRejectedValueOnce(abortError);

		const result = (await load(fakeEvent({ q: 'test' }))) as { error: string | null; results: unknown[] };

		expect(result.error).toBe('Impossible de contacter le répertoire Nodyx.');
		expect(result.results).toEqual([]);
	});

	it('renvoie les résultats normalement quand le répertoire répond', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ results: [{ id: '1', title: 'Un fil' }] })
		});

		const result = (await load(fakeEvent({ q: 'test' }))) as { error: string | null; results: unknown[] };

		expect(result.error).toBeNull();
		expect(result.results).toHaveLength(1);
	});
});
