import { describe, it, expect } from 'vitest'
import { htmlToText } from './text'

describe('htmlToText : relire un contenu retenu tel quel', () => {
	it('garde les liens en clair, même cachés derrière un texte', () => {
		expect(htmlToText('<p>voir <a href="https://bit.ly/x9k">le tuto</a></p>')).toBe('voir le tuto (https://bit.ly/x9k)')
		expect(htmlToText('<p><a href="https://a.example">https://a.example</a></p>')).toBe('https://a.example')
	})
	it('garde les sauts de ligne, n’interprète aucune balise', () => {
		expect(htmlToText('<p>un</p><p>deux<br>trois</p>')).toBe('un\ndeux\ntrois')
		expect(htmlToText('&lt;script&gt;x&lt;/script&gt;')).toBe('<script>x</script>')
	})
})
