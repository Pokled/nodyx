import { describe, it, expect, vi } from 'vitest'
import { surveillerServiceWorker } from './swReload'

// Les deux signaux possibles : `controllerchange` (on passe
// navigator.serviceWorker.controller) et le message `sw:updated` (on passe
// event.source), qui désignent le même service worker. L'ordre n'importe pas.
const A = { nom: 'version installée' }
const B = { nom: 'nouvelle version' }

describe('rechargement quand un service worker prend le contrôle', () => {
	it('première visite (aucun service worker avant) : pas de rechargement', () => {
		const recharger = vi.fn()
		const signal = surveillerServiceWorker<object>(null, recharger)
		signal(A)   // controllerchange
		signal(A)   // sw:updated
		expect(recharger).not.toHaveBeenCalled()
	})

	it('mise à jour (une version tournait, une autre la remplace) : rechargement', () => {
		const recharger = vi.fn()
		const signal = surveillerServiceWorker(A, recharger)
		signal(B)
		expect(recharger).toHaveBeenCalledTimes(1)
	})

	it('mise à jour après une première visite dans le même onglet : rechargement', () => {
		const recharger = vi.fn()
		const signal = surveillerServiceWorker<object>(null, recharger)
		signal(A); signal(A)   // installation à la première visite
		signal(B)              // déploiement pendant que l'onglet reste ouvert
		expect(recharger).toHaveBeenCalledTimes(1)
	})

	it('le même service worker qui se signale encore : rien', () => {
		const recharger = vi.fn()
		const signal = surveillerServiceWorker(A, recharger)
		signal(A)
		expect(recharger).not.toHaveBeenCalled()
	})

	it('signal sans service worker : rien', () => {
		const recharger = vi.fn()
		surveillerServiceWorker(A, recharger)(null)
		expect(recharger).not.toHaveBeenCalled()
	})
})
