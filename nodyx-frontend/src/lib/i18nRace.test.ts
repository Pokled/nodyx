// Seul le DERNIER choix de langue compte, même si l'ancienne langue arrive en retard.
// L'espagnol est ralenti exprès (réseau lent) : sans ça, en test, les fichiers arrivent
// instantanément et dans l'ordre, et la course ne se produirait jamais.
import { describe, it, expect, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('./locales/es.json', async (importOriginal) => {
	await new Promise(r => setTimeout(r, 200))
	return await importOriginal()
})

describe('changer vite de langue', () => {
	it('« Español » (lent) puis « English » : la page finit en ANGLAIS', async () => {
		const m = await import('./i18n')
		const en = (await import('./locales/en.json')).default as Record<string, string>
		m.locale.setSSR('fr')
		m.locale.setLocale('es')
		m.locale.setLocale('en')
		await new Promise(r => setTimeout(r, 500))
		expect(get(m.locale)).toBe('en')
		expect(get(m.t)('nav.discover')).toBe(en['nav.discover'])
	})
})
