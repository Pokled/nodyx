/**
 * Le chat utilise le nettoyeur PARTAGÉ, avec une seule différence voulue : pas
 * d'id sur les titres (la page du chat retrouve sa saisie par getElementById).
 * Avant le 13/11/2026 il avait sa propre copie, restée en retard : audio, directs
 * Twitch et morceaux retirés sans prévenir.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeChat } from '../utils/chatSanitize'
import { sanitize } from '../utils/sanitize'

describe('Chat : ce que l’éditeur propose est gardé', () => {
  it.each([
    ['le lecteur audio', '<nodyx-audio-player src="/uploads/audio/a.mp3" track-title="Intro" artist="Léa"></nodyx-audio-player>'],
    ['un morceau', '<nodyx-track src="/uploads/audio/a.mp3" track-title="Intro" artist="Léa"></nodyx-track>'],
    ['un direct Twitch', '<iframe src="https://player.twitch.tv/?channel=nodyx&amp;parent=nodyx.org"></iframe>'],
    ['une vidéo YouTube', '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>'],
    ['deux colonnes', '<div class="nodyx-two-cols" data-type="two-cols"><div class="nodyx-col"><p>a</p></div><div class="nodyx-col"><p>b</p></div></div>'],
    ['un tableau', '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>'],
    ['une image de l’instance placée à droite', '<img src="/uploads/a.png" data-align="right" width="300" />'],
    ['un GIF Tenor', '<img src="https://media.tenor.com/x.gif" />'],
  ])('%s', (_, html) => {
    expect(sanitizeChat(html)).toBe(html)
  })
})

describe('Chat : ce qui est dangereux ou trompeur est retiré', () => {
  it('une image collée en data: n’est PAS gardée (déjà le cas avant : sanitize-html refuse ce schéma par défaut ; le lot 3 de l’éditeur l’enverra comme fichier)', () => {
    expect(sanitizeChat('<img src="data:image/png;base64,iVBORw0KGgo=" />')).toBe('')
  })
  it('un titre ne garde pas son id (sinon id="chat-input" détourne la zone de saisie)', () => {
    expect(sanitizeChat('<h2 id="chat-input">Salut</h2>')).toBe('<h2>Salut</h2>')
    expect(sanitizeChat('<h1 id="x" class="c">T</h1>')).toBe('<h1 class="c">T</h1>')
  })
  it('le forum, lui, garde l’ancre (sommaire)', () => {
    expect(sanitize('<h2 id="intro">Intro</h2>')).toBe('<h2 id="intro">Intro</h2>')
  })
  it.each([
    ['script', '<p>a</p><script>alert(1)</script>', 'script'],
    ['gestionnaire on*', '<img src="/uploads/a.png" onerror="alert(1)">', 'onerror'],
    ['lien javascript:', '<a href="javascript:alert(1)">x</a>', 'javascript'],
    ['image d’un autre site', '<img src="https://pisteur.example/p.png">', 'pisteur'],
    ['audio d’un autre site', '<nodyx-audio-player src="https://pisteur.example/a.mp3"></nodyx-audio-player>', 'pisteur'],
    ['pochette d’un autre site', '<nodyx-audio-player src="/uploads/audio/a.mp3" cover="https://pisteur.example/c.png"></nodyx-audio-player>', 'pisteur'],
    ['domaine bloqué', '<a href="https://pornhub.com/x">x</a>', 'pornhub'],
    ['vidéo hors lecteurs officiels', '<iframe src="https://piege.example/embed"></iframe>', 'iframe'],
    ['style libre sur un bloc', '<div style="position:fixed;inset:0">x</div>', 'position'],
  ])('%s', (_, html, mustNotContain) => {
    expect(sanitizeChat(html)).not.toContain(mustNotContain)
  })
})

describe('Parité : le chat ne peut plus diverger du nettoyeur partagé', () => {
  // Corpus varié : pour chacun, le chat donne EXACTEMENT le résultat du forum,
  // à l'id des titres près. Toute future liste à part ferait tomber ce test.
  const corpus = [
    '<p>Salut <strong>toi</strong> <em>!</em> <u>u</u> <s>s</s> <code>c</code></p>',
    '<ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><hr /><pre><code>x</code></pre>',
    '<h2 id="a">A</h2><h3 id="b">B</h3><p style="text-align:center">c</p>',
    '<span style="color:#22c55e">vert</span><a href="https://nodyx.org/forum" target="_blank" rel="noopener">lien</a>',
    '<img src="https://pisteur.example/p.png"><iframe src="https://piege.example"></iframe><script>x</script>',
    '<nodyx-audio-player src="/uploads/audio/a.mp3" cover="/uploads/c.png"></nodyx-audio-player>',
    '<iframe src="https://player.twitch.tv/?channel=x&amp;parent=nodyx.org"></iframe>',
  ]
  it.each(corpus)('%s', (html) => {
    const forumSansAncres = sanitize(html).replace(/(<h[1-4][^>]*?) id="[^"]*"/g, '$1')
    expect(sanitizeChat(html)).toBe(forumSansAncres)
  })
})
