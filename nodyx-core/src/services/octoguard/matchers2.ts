/**
 * OctoGuard 2 : les détecteurs ajoutés au profil de base (CDC OctoGuard 2, E4b).
 *
 * - keywords : liste de mots interdits, SANS expression régulière, qui déjoue
 *   les contournements courants (casse, accents, chiffres à la place des
 *   lettres, lettres séparées par des points ou des espaces).
 * - flood    : même message répété, ou rafale de messages (état en mémoire).
 * - zalgo    : texte corrompu par des caractères combinés empilés.
 *
 * Tous purs et bornés (taille, mémoire) : un message géant ne coûte pas plus
 * qu'un parcours linéaire.
 */

import type { MatchContext, MatchResult } from './matchers'
import type { AutomodRuleParams } from './types'

const MAX_SCAN = 10_000  // au-delà, on n'examine que le début (garde-fou)

function plain(s: string): string {
  return s.slice(0, MAX_SCAN * 2).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').slice(0, MAX_SCAN)
}

// ─── keywords ────────────────────────────────────────────────────────────────

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '€': 'e' }

/** Forme comparable : minuscules, sans accents, chiffres « leet » remplacés. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/[013457@$!€]/g, c => LEET[c] ?? c)
}

/** Mots du message, plus les mots « épelés » (c.o.n ou c o n) recollés. */
export function tokensOf(text: string): string[] {
  const n = normalize(text)
  const tokens = n.split(/[^\p{L}]+/u).filter(Boolean)
  // Lettres isolées séparées par des espaces, points, tirets… : « c.o.n.n.a.r.d »
  const spelled = n.match(/(?:^|[^\p{L}])((?:\p{L}[\s.\-_*·]+){2,}\p{L})(?=$|[^\p{L}])/gu) ?? []
  for (const run of spelled) tokens.push(run.replace(/[^\p{L}]/gu, ''))
  return tokens
}

type Pattern = { kind: 'word' | 'prefix' | 'contains'; value: string; raw: string }

function compile(word: string): Pattern | null {
  const raw = word.trim()
  if (!raw) return null
  const starts = raw.startsWith('*'), ends = raw.endsWith('*')
  const value = normalize(raw.replace(/^\*|\*$/g, '')).replace(/[^\p{L}]/gu, '')
  if (value.length < 2) return null
  return { kind: starts && ends ? 'contains' : ends ? 'prefix' : 'word', value, raw }
}

export function matchKeywords(ctx: MatchContext, params: AutomodRuleParams): MatchResult | null {
  const patterns = (params.words ?? []).slice(0, 500).map(compile).filter((p): p is Pattern => !!p)
  if (patterns.length === 0) return null
  const exceptions = new Set((params.exceptions ?? []).map(e => normalize(e).replace(/[^\p{L}]/gu, '')))
  const text = plain(ctx.content)
  const tokens = tokensOf(text).filter(t => !exceptions.has(t))
  // Jamais de recollage entre deux vrais mots (« bacon nard » ne doit pas
  // donner « connard ») : seuls les mots épelés lettre à lettre sont recollés.
  for (const p of patterns) {
    const token =
      p.kind === 'word'     ? tokens.find(t => t === p.value) :
      p.kind === 'prefix'   ? tokens.find(t => t.startsWith(p.value)) :
      /* contains */          tokens.find(t => t.includes(p.value))
    if (token !== undefined) return { excerpt: `mot interdit : ${p.raw}`, found: { token: token.slice(0, 64), pattern: p.raw, kind: p.kind } }
  }
  return null
}

// ─── flood ───────────────────────────────────────────────────────────────────

const RECENT_MS = 120_000
const MAX_TRACKED_USERS = 10_000
const MAX_PER_USER = 30
const _recent = new Map<string, Array<{ t: number; h: string }>>()

function fingerprint(content: string): string {
  return normalize(plain(content)).replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** Note un message (une seule fois par message, AVANT les règles). */
export function recordActivity(userId: string, content: string, now = Date.now()): void {
  const list = (_recent.get(userId) ?? []).filter(e => now - e.t < RECENT_MS)
  list.push({ t: now, h: fingerprint(content) })
  if (list.length > MAX_PER_USER) list.splice(0, list.length - MAX_PER_USER)
  _recent.delete(userId)
  _recent.set(userId, list)          // réinsertion : la Map garde l'ordre d'usage
  if (_recent.size > MAX_TRACKED_USERS) {
    const oldest = _recent.keys().next().value
    if (oldest) _recent.delete(oldest)
  }
}

export function _resetActivity(): void { _recent.clear() }

export function matchFlood(ctx: MatchContext & { userId?: string; now?: number }, params: AutomodRuleParams): MatchResult | null {
  if (!ctx.userId) return null
  const now = ctx.now ?? Date.now()
  const list = _recent.get(ctx.userId) ?? []
  const maxRepeats = params.max_repeats ?? 4
  const repeatWin = (params.repeat_window_s ?? 60) * 1000
  const maxMsgs = params.max_messages ?? 8
  const burstWin = (params.burst_window_s ?? 10) * 1000
  const h = fingerprint(ctx.content)
  const same = list.filter(e => now - e.t <= repeatWin && e.h === h && h.length > 0).length
  if (same >= maxRepeats) return { excerpt: `même message ${same} fois en ${repeatWin / 1000} s` }
  const burst = list.filter(e => now - e.t <= burstWin).length
  if (burst > maxMsgs) return { excerpt: `${burst} messages en ${burstWin / 1000} s` }
  return null
}

// ─── zalgo ───────────────────────────────────────────────────────────────────

export function matchZalgo(ctx: MatchContext, params: AutomodRuleParams): MatchResult | null {
  const max = params.max_combining ?? 3
  const text = plain(ctx.content)
  let run = 0, total = 0
  for (const ch of text) {
    if (/\p{M}/u.test(ch)) {
      run++; total++
      if (run > max) return { excerpt: 'texte corrompu (caractères empilés)' }
    } else run = 0
  }
  return total > 30 ? { excerpt: 'texte corrompu (caractères empilés)' } : null
}
