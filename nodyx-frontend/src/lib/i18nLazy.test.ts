// Langues à la demande : la traduction attend sa langue, et seul le DERNIER choix compte.
import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { locale, t, ensureLocale } from './i18n'
import fr from './locales/fr.json'
import en from './locales/en.json'
import es from './locales/es.json'

const settle = () => new Promise(r => setTimeout(r, 300))

describe('langues chargées à la demande', () => {
	it('une langue chargée se traduit ; une clé absente de l’espagnol retombe sur l’anglais', async () => {
		await ensureLocale('es')
		locale.setSSR('es')
		const tr = get(t)
		expect(tr('nav.discover')).toBe((es as Record<string, string>)['nav.discover'])
		const missing = Object.keys(en).find(k => !(es as Record<string, string>)[k])!
		expect(tr(missing)).toBe((en as Record<string, string>)[missing])
	})

	it('français : texte source', async () => {
		await ensureLocale('fr')
		locale.setSSR('fr')
		expect(get(t)('nav.discover')).toBe((fr as Record<string, string>)['nav.discover'])
	})
})
