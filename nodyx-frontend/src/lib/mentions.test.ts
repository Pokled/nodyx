import { describe, it, expect, vi } from 'vitest'
vi.mock('$lib/api', () => ({ apiFetch: vi.fn() }))
import { MENTION_TRIGGER, applyPickedMentions, mentionHtml, fold } from './mentions'

const A = '11111111-1111-4111-8111-111111111111'

describe('le « @ » qui ouvre les propositions', () => {
	it.each([
		['@', ''], ['salut @', ''], ['salut @lé', 'lé'], ['(@max', 'max'], ['@Léa', 'Léa'],
	])('« %s » → « %s »', (txt, q) => expect(txt.match(MENTION_TRIGGER)?.[1]).toBe(q))
	it.each(['lea@exemple', 'mail: a@b', 'salut @lea ', '@' + 'x'.repeat(31)])('pas de proposition : « %s »', txt => {
		expect(txt.match(MENTION_TRIGGER)).toBeNull()
	})
})

describe('zone de saisie du chat : les mentions choisies deviennent liées à la personne', () => {
	it('la mention choisie devient une marque, le reste du texte ne bouge pas', () => {
		expect(applyPickedMentions('Merci @Léa pour tout', [{ ref: 'u:' + A, label: 'Léa' }]))
			.toBe(`Merci <span data-mention="u:${A}">@Léa</span> pour tout`)
	})
	it('effacée ou retapée autrement : reste du texte', () => {
		expect(applyPickedMentions('Merci à toi', [{ ref: 'u:' + A, label: 'Léa' }])).toBe('Merci à toi')
	})
	it('« @Léa » dans « @Léanne » n’est pas elle', () => {
		expect(applyPickedMentions('@Léanne', [{ ref: 'u:' + A, label: 'Léa' }])).toBe('@Léanne')
	})
	it('le nom est échappé : jamais de HTML venu d’un nom', () => {
		expect(mentionHtml(A, '<img src=x onerror=1>')).toBe(`<span data-mention="u:${A}">@&lt;img src=x onerror=1&gt;</span>`)
	})
	it('accents : même règle que le cœur', () => expect(fold('Lenaïg ÉLÉA')).toBe('lenaig elea'))
})

describe('groupes (M2)', () => {
	it('un groupe choisi devient une marque de groupe', async () => {
		const { applyPickedMentions: apply, refsIn } = await import('./mentions')
		const html = apply('Réunion @ici ce soir', [{ ref: 'g:ici', label: 'ici' }])
		expect(html).toBe('Réunion <span data-mention="g:ici">@ici</span> ce soir')
		expect(refsIn(html + `<span data-mention="u:${A}">@Léa</span>`)).toEqual(['g:ici', 'u:' + A])
	})
})
