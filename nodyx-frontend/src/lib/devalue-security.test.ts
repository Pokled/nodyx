/**
 * Régression : devalue, la bibliothèque par laquelle SvelteKit sérialise les
 * données de chaque page (load) dans le HTML envoyé au navigateur.
 *
 * GHSA-j22f-vq7h-c4qm (devalue <= 5.9.2) : un `Buffer` Node était sérialisé
 * avec TOUT son ArrayBuffer d'appui, c'est-à-dire le pool mémoire partagé du
 * processus. Une page qui renvoyait 2 octets envoyait jusqu'à 64 Ko de
 * mémoire du serveur, y compris des morceaux d'AUTRES requêtes en cours
 * (en-têtes Authorization, corps de requête). Aucune page ne le fait
 * aujourd'hui (vérifié le 03/10) : ce test garde la porte fermée.
 *
 * Vérifié rouge sur devalue 5.8.1, vert sur 5.9.4.
 */
import { describe, it, expect } from 'vitest'
import { stringify, uneval, parse } from 'devalue'

/** Un petit Buffer pris dans le pool partagé, voisin d'un « secret » d'une autre requête. */
function pooledBuffer() {
	const secret = Buffer.from('Authorization: Bearer SECRET-DUNE-AUTRE-REQUETE')
	const mine = Buffer.from('ab')
	return { secret, mine }
}

describe('devalue : un Buffer ne fait pas fuir la mémoire du processus', () => {
	it('stringify (données des pages) ne sérialise que les octets du Buffer', () => {
		const { mine } = pooledBuffer()
		const out = stringify({ mine })
		// Ce que reçoit le navigateur : la vue ET toute la mémoire d'appui.
		const back = parse(out) as { mine: Uint8Array }
		expect(Array.from(back.mine)).toEqual([0x61, 0x62])
		const received = Buffer.from(back.mine.buffer)
		expect(received.includes('SECRET-DUNE-AUTRE-REQUETE'), 'mémoire d’une autre requête envoyée au navigateur').toBe(false)
		expect(received.length).toBe(2)
		expect(out.length).toBeLessThan(200)
	})

	it('uneval (rendu côté serveur) ne sérialise que les octets du Buffer', () => {
		const { mine } = pooledBuffer()
		const out = uneval({ mine })
		expect(out.length).toBeLessThan(200)
	})
})
