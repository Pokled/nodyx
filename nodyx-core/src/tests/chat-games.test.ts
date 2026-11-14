// Lot C2 (D56) : les jeux du chat tirés par le serveur. Le client n'envoie que le texte
// de la commande ; le cœur lit, borne, tire et écrit un repli sûr.
import { describe, it, expect } from 'vitest'
import { parseGame, playGame, gameFallback, ROLL_MAX_DICE, ROLL_MAX_SIDES, QUESTION_MAX } from '../services/chatGames'

const seq = (...vals: number[]) => { let i = 0; return (n: number) => { const v = vals[i++ % vals.length]; return Math.min(v, n - 1) } }

describe('lire une commande', () => {
  it('reconnaît les quatre jeux, même enveloppés de HTML', () => {
    expect(parseGame('/roll 2d6')).toEqual({ kind: 'roll', input: { n: 2, sides: 6 } })
    expect(parseGame('<p>/flip</p>')).toEqual({ kind: 'flip', input: {} })
    expect(parseGame('/8ball Je gagne ?')?.kind).toBe('8ball')
    expect(parseGame('/RPS 🪨')).toEqual({ kind: 'rps', input: { move: 'rock', chosen: true } })
  })
  it('un message ordinaire ou une autre commande n’est pas un jeu', () => {
    expect(parseGame('salut')).toBeNull()
    expect(parseGame('/help')).toBeNull()
    expect(parseGame('/rollover')).toBeNull()
    expect(parseGame('je fais /roll 2d6')).toBeNull()
  })
  it('« /roll » seul ou invalide : 1d6, comme avant', () => {
    expect(parseGame('/roll')).toEqual({ kind: 'roll', input: { n: 1, sides: 6 } })
    expect(parseGame('/roll abc')).toEqual({ kind: 'roll', input: { n: 1, sides: 6 } })
  })
  it('bornes : 10 dés au plus, 2 à 10 000 faces', () => {
    expect(parseGame('/roll 99d6')?.input).toEqual({ n: ROLL_MAX_DICE, sides: 6 })
    expect(parseGame('/roll 0d6')?.input).toEqual({ n: 1, sides: 6 })
    expect(parseGame('/roll 2d99999')?.input).toEqual({ n: 2, sides: ROLL_MAX_SIDES })
    expect(parseGame('/roll 2d1')?.input).toEqual({ n: 2, sides: 2 })
    expect(parseGame('/roll 99d999999')?.input).toEqual({ n: ROLL_MAX_DICE, sides: ROLL_MAX_SIDES })
  })
  it('la question de /8ball est du texte brut, coupée à 200 caractères', () => {
    const q = parseGame('/8ball <b>gras</b> ' + 'x'.repeat(500))!.input as { question: string }
    expect(q.question.startsWith('gras ')).toBe(true)
    expect(q.question.length).toBe(QUESTION_MAX)
  })
  it('/rps comprend les mots FR et EN ; sinon le coup est tiré au hasard', () => {
    expect(parseGame('/rps ciseaux')?.input).toEqual({ move: 'scissors', chosen: true })
    expect(parseGame('/rps paper')?.input).toEqual({ move: 'paper', chosen: true })
    expect(parseGame('/rps ✂️')?.input).toEqual({ move: 'scissors', chosen: true })
    expect((parseGame('/rps')!.input as { chosen: boolean }).chosen).toBe(false)
  })
})

describe('tirer', () => {
  it('roll : chaque dé dans [1, faces], total juste', () => {
    const g = playGame({ kind: 'roll', input: { n: 3, sides: 6 } }, seq(0, 5, 2))
    expect(g).toEqual({ v: 1, kind: 'roll', input: { n: 3, sides: 6 }, result: { rolls: [1, 6, 3], total: 10 } })
  })
  it('flip, 8ball (1 à 17), rps (victoire, défaite, égalité)', () => {
    expect(playGame({ kind: 'flip', input: {} }, seq(1)).result).toEqual({ side: 'tails' })
    expect(playGame({ kind: '8ball', input: { question: '' } }, seq(16)).result).toEqual({ answer: 17 })
    expect(playGame({ kind: 'rps', input: { move: 'rock', chosen: true } }, seq(2)).result).toEqual({ bot: 'scissors', outcome: 'win' })
    expect(playGame({ kind: 'rps', input: { move: 'rock', chosen: true } }, seq(1)).result).toEqual({ bot: 'paper', outcome: 'lose' })
    expect(playGame({ kind: 'rps', input: { move: 'rock', chosen: true } }, seq(0)).result).toEqual({ bot: 'rock', outcome: 'tie' })
  })
  it('le vrai hasard (crypto) : 10 000 dés à 6 faces, chaque face entre 14 % et 19 %', () => {
    const counts = [0, 0, 0, 0, 0, 0]
    const g = playGame({ kind: 'roll', input: { n: 10, sides: 6 } })
    expect(g.kind).toBe('roll')
    for (let i = 0; i < 1000; i++) {
      const r = playGame({ kind: 'roll', input: { n: 10, sides: 6 } })
      if (r.kind === 'roll') for (const v of r.result.rolls) counts[v - 1]++
    }
    for (const c of counts) { expect(c / 10_000).toBeGreaterThan(0.14); expect(c / 10_000).toBeLessThan(0.19) }
  })
})

describe('le repli écrit dans content', () => {
  it('dans la langue de l’auteur', () => {
    const g = playGame({ kind: 'roll', input: { n: 2, sides: 6 } }, seq(3, 2))
    expect(gameFallback(g, 'Léa', 'fr')).toBe('<p>🎲 Léa lance 2d6 (4 + 3) : 7</p>')
    expect(gameFallback(g, 'Léa', 'en')).toBe('<p>🎲 Léa rolls 2d6 (4 + 3): 7</p>')
    const b = playGame({ kind: '8ball', input: { question: 'Je gagne ?' } }, seq(0))
    expect(gameFallback(b, 'max', 'fr')).toBe('<p>🎱 max « Je gagne ? » : Oui, absolument.</p>')
  })
  it('pseudo et question échappés : aucun HTML ne passe', () => {
    const b = playGame({ kind: '8ball', input: { question: '<img src=x onerror=alert(1)>' } }, seq(0))
    const out = gameFallback(b, '<script>x</script>', 'fr')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
  it('un texte hostile se lit vite (500 Ko de balises)', () => {
    const t0 = performance.now()
    parseGame('/8ball ' + '<a '.repeat(150_000))
    expect(performance.now() - t0).toBeLessThan(300)
  })
})
