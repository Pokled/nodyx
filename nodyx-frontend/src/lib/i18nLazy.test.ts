// Langues à la demande : la traduction attend sa langue, et seul le DERNIER choix compte.
import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { locale, t, ensureLocale } from './i18n'
import fr from './locales/fr.json'
import en from './locales/en.json'
import de from './locales/de.json'

const settle = () => new Promise(r => setTimeout(r, 300))

describe('langues chargées à la demande', () => {
	// Langue INCOMPLÈTE exprès : le repli sur l'anglais n'est vérifié que s'il manque
	// une clé. Jusqu'au 19/11/2026 ce test utilisait l'espagnol ; Pedro Flores l'a
	// complété (#1028) et le test ne vérifiait plus rien. Si l'allemand est complété
	// à son tour, le garde-fou ci-dessous fait échouer le test au lieu de le vider.
	it('une langue chargée se traduit ; une clé absente de l’allemand retombe sur l’anglais', async () => {
		await ensureLocale('de')
		locale.setSSR('de')
		const tr = get(t)
		expect(tr('nav.discover')).toBe((de as Record<string, string>)['nav.discover'])
		const missing = Object.keys(en).find(k => !(de as Record<string, string>)[k])
		expect(missing, 'l’allemand est complet : choisir une autre langue incomplète pour ce test').toBeDefined()
		expect(tr(missing!)).toBe((en as Record<string, string>)[missing!])
		expect(tr(missing!)).not.toBe(missing)
	})

	it('français : texte source', async () => {
		await ensureLocale('fr')
		locale.setSSR('fr')
		expect(get(t)('nav.discover')).toBe((fr as Record<string, string>)['nav.discover'])
	})
})
