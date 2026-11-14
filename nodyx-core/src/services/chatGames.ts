// Les jeux du chat, tirés par le SERVEUR (SPECS/NODYX_COMMANDES_CDC.md, lot C2, D56).
//
// Avant : /roll, /flip, /8ball et /rps étaient calculés dans le navigateur, puis
// envoyés comme un message ordinaire. N'importe qui pouvait écrire « Max lance 2d6 :
// 12 » sans rien lancer. Maintenant le cœur tire avec `crypto.randomInt`, enregistre
// le tirage dans `channel_messages.game`, et seul un message qui porte ce champ
// affiche la marque « Lancé par Nodyx ». Aucune route n'accepte `game` venant d'un
// client : il n'existe que par ce fichier.
//
// `content` reçoit un repli lisible (texte, échappé) dans la langue de l'auteur, pour
// la recherche, les réponses citées et les anciens clients. L'affichage, lui, part de
// `game` et se fait dans la langue de CHAQUE lecteur.
import { randomInt } from 'crypto'
import type { ServerLocale } from '../i18n/serverStrings'

export type GameKind = 'roll' | 'flip' | '8ball' | 'rps'
export type RpsMove = 'rock' | 'paper' | 'scissors'

export type Game =
  | { v: 1; kind: 'roll'; input: { n: number; sides: number }; result: { rolls: number[]; total: number } }
  | { v: 1; kind: 'flip'; input: Record<string, never>; result: { side: 'heads' | 'tails' } }
  | { v: 1; kind: '8ball'; input: { question: string }; result: { answer: number } }
  | { v: 1; kind: 'rps'; input: { move: RpsMove; chosen: boolean }; result: { bot: RpsMove; outcome: 'win' | 'lose' | 'tie' } }

export const ROLL_MAX_DICE = 10
export const ROLL_MAX_SIDES = 10_000
export const EIGHT_BALL_ANSWERS = 17
export const QUESTION_MAX = 200

const MOVES: RpsMove[] = ['rock', 'paper', 'scissors']
const BEATS: Record<RpsMove, RpsMove> = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
const MOVE_WORDS: Record<string, RpsMove> = {
  '🪨': 'rock', 'rock': 'rock', 'pierre': 'rock', 'caillou': 'rock',
  '📄': 'paper', 'paper': 'paper', 'feuille': 'paper',
  '✂️': 'scissors', '✂': 'scissors', 'scissors': 'scissors', 'ciseaux': 'scissors', 'ciseau': 'scissors',
}

/**
 * Le texte brut d'un message : sans balises ni entités, espaces réduits.
 * `<[^<>]*>` et non `<[^>]*>` : une balise ne déborde jamais sur un autre « < ».
 * Sinon un texte de « <a » jamais fermés fait revenir la regex en arrière à
 * chaque « < » (temps quadratique : 82 s pour 450 Ko, mesuré au test le 14/11).
 */
function plain(html: string): string {
  return html
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Lit une commande de jeu (« /roll 2d6 », « <p>/flip</p> »). null : ce n'est pas un jeu
 * (le message part alors comme un message ordinaire, comme avant).
 * Une valeur invalide retombe sur le défaut, comme avant (« /roll abc » = 1d6).
 */
export function parseGame(raw: string): { kind: GameKind; input: Game['input'] } | null {
  // Coupé AVANT la lecture : le socket refuse déjà plus de 2000 caractères
  const text = plain(String(raw ?? '').slice(0, 4000)).slice(0, 2000)
  const m = /^\/(roll|flip|8ball|rps)(?:\s+(.*))?$/i.exec(text)
  if (!m) return null
  const kind = m[1].toLowerCase() as GameKind
  const args = (m[2] ?? '').trim()
  if (kind === 'roll') {
    // Lu large puis PLAFONNÉ : « 99d999999 » donne 10d10000, pas un 1d6 qui ignore la demande
    const d = /^(\d{1,6})d(\d{1,9})$/i.exec(args.split(/\s+/)[0] ?? '')
    let n = d ? parseInt(d[1], 10) : 1
    let sides = d ? parseInt(d[2], 10) : 6
    if (!(n >= 1 && n <= ROLL_MAX_DICE)) n = Math.min(Math.max(n || 1, 1), ROLL_MAX_DICE)
    if (!(sides >= 2 && sides <= ROLL_MAX_SIDES)) sides = Math.min(Math.max(sides || 6, 2), ROLL_MAX_SIDES)
    return { kind, input: { n, sides } }
  }
  if (kind === 'flip') return { kind, input: {} }
  if (kind === '8ball') return { kind, input: { question: args.slice(0, QUESTION_MAX) } }
  const first = (args.split(/\s+/)[0] ?? '').toLowerCase()
  const move = MOVE_WORDS[first] ?? MOVE_WORDS[first.replace(/️/g, '')]
  return { kind, input: { move: move ?? 'rock', chosen: !!move } }
}

/** Le tirage. `rnd(n)` rend un entier dans [0, n) : `crypto.randomInt` en vrai, réglable en test. */
export function playGame(parsed: { kind: GameKind; input: Game['input'] }, rnd: (n: number) => number = (n) => randomInt(n)): Game {
  switch (parsed.kind) {
    case 'roll': {
      const { n, sides } = parsed.input as { n: number; sides: number }
      const rolls = Array.from({ length: n }, () => rnd(sides) + 1)
      return { v: 1, kind: 'roll', input: { n, sides }, result: { rolls, total: rolls.reduce((a, b) => a + b, 0) } }
    }
    case 'flip':
      return { v: 1, kind: 'flip', input: {}, result: { side: rnd(2) === 0 ? 'heads' : 'tails' } }
    case '8ball':
      return { v: 1, kind: '8ball', input: { question: (parsed.input as { question: string }).question }, result: { answer: rnd(EIGHT_BALL_ANSWERS) + 1 } }
    case 'rps': {
      const inp = parsed.input as { move: RpsMove; chosen: boolean }
      const move = inp.chosen ? inp.move : MOVES[rnd(3)]
      const bot = MOVES[rnd(3)]
      const outcome = move === bot ? 'tie' : BEATS[move] === bot ? 'win' : 'lose'
      return { v: 1, kind: 'rps', input: { move, chosen: inp.chosen }, result: { bot, outcome } }
    }
  }
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const EMOJI: Record<RpsMove, string> = { rock: '🪨', paper: '📄', scissors: '✂️' }

// Les réponses de la boule magique, pour le repli (les mêmes que l'affichage,
// clés chat.cmd.8ball_1 à _17 du frontend).
const BALL_ANSWERS: Record<ServerLocale, string[]> = {
  fr: [
    "Oui, absolument.",
    "C'est certain.",
    "Sans aucun doute.",
    "Oui.",
    "Tu peux compter dessus.",
    "Très probablement.",
    "Les perspectives sont bonnes.",
    "Les signes pointent vers oui.",
    "Réponse floue, réessaie.",
    "Demande plus tard.",
    "Difficile à dire maintenant.",
    "Impossible de prédire pour l'instant.",
    "Ne compte pas dessus.",
    "Ma réponse est non.",
    "Mes sources disent non.",
    "Les perspectives ne sont pas bonnes.",
    "Très douteux.",
  ],
  en: [
    "Yes, absolutely.",
    "It is certain.",
    "Without a doubt.",
    "Yes.",
    "You can count on it.",
    "Very likely.",
    "Outlook good.",
    "Signs point to yes.",
    "Reply hazy, try again.",
    "Ask again later.",
    "Hard to say right now.",
    "Cannot predict now.",
    "Don't count on it.",
    "My reply is no.",
    "My sources say no.",
    "Outlook not so good.",
    "Very doubtful.",
  ],
}

const FALLBACK: Record<ServerLocale, {
  roll: (u: string, dice: string, detail: string, total: number) => string
  flip: (u: string, side: 'heads' | 'tails') => string
  ball: (u: string, q: string, answer: number) => string
  rps: (u: string, me: string, bot: string, outcome: 'win' | 'lose' | 'tie') => string
}> = {
  fr: {
    roll: (u, dice, detail, total) => `🎲 ${u} lance ${dice}${detail} : ${total}`,
    flip: (u, side) => `🪙 ${u} lance une pièce : ${side === 'heads' ? 'pile' : 'face'}`,
    ball: (u, q, a) => `🎱 ${u}${q ? ` « ${q} »` : ''} : ${BALL_ANSWERS.fr[a - 1] ?? ''}`,
    rps: (u, me, bot, o) => `✊ ${u} joue ${me} contre Nodyx ${bot} : ${o === 'tie' ? 'égalité' : o === 'win' ? 'gagné' : 'perdu'}`,
  },
  en: {
    roll: (u, dice, detail, total) => `🎲 ${u} rolls ${dice}${detail}: ${total}`,
    flip: (u, side) => `🪙 ${u} flips a coin: ${side}`,
    ball: (u, q, a) => `🎱 ${u}${q ? ` “${q}”` : ''}: ${BALL_ANSWERS.en[a - 1] ?? ''}`,
    rps: (u, me, bot, o) => `✊ ${u} plays ${me} against Nodyx ${bot}: ${o === 'tie' ? 'tie' : o === 'win' ? 'won' : 'lost'}`,
  },
}

/** Le repli lisible enregistré dans `content` (texte échappé, dans un paragraphe). */
export function gameFallback(game: Game, username: string, locale: ServerLocale): string {
  const f = FALLBACK[locale] ?? FALLBACK.en
  const u = esc(username)
  let text: string
  switch (game.kind) {
    case 'roll': {
      const detail = game.result.rolls.length > 1 ? ` (${game.result.rolls.join(' + ')})` : ''
      text = f.roll(u, `${game.input.n}d${game.input.sides}`, detail, game.result.total); break
    }
    case 'flip': text = f.flip(u, game.result.side); break
    case '8ball': text = f.ball(u, esc(game.input.question), game.result.answer); break
    case 'rps': text = f.rps(u, EMOJI[game.input.move], EMOJI[game.result.bot], game.result.outcome); break
  }
  return `<p>${text}</p>`
}
