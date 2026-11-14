/**
 * OctoGuard auto-mod matchers.
 * Conforme à SESSION-B-CDC §3.1.
 *
 * Toutes les fonctions sont **pures** : pas de DB, pas de Redis, pas d'IO.
 * Aucun matcher ne throw : try/catch interne, return null si erreur.
 *
 * Protection ReDoS via re2 (optionalDependency) avec fallback RegExp natif.
 * Cf. SESSION-B-CDC §11.
 */

import safeRegex from 'safe-regex'
import { tallyMentions } from './mentionTally'
import type {
  AutomodRuleRow,
  AutomodRuleParams,
} from './types'

// ─── compileSafeRegex (cf. CDC §11) ──────────────────────────────────────────

// Test au boot une seule fois si re2 est disponible
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _re2: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _re2 = require('re2')
} catch {
  _re2 = null
}

/** True si re2 est chargé (mode strict, ReDoS impossible). */
export function hasRE2(): boolean {
  return _re2 !== null
}

/** Compilateur de regex sécurisé. Retourne un objet avec .test(string) ou null si invalide. */
export interface SafeRegex {
  test(s: string): boolean
}

export function compileSafeRegex(pattern: string, flags: string = 'i'): SafeRegex | null {
  // Mode dégradé (re2 absent) : on bloque les patterns catastrophiques
  // détectés par safe-regex pour défense en profondeur. Mode strict
  // (re2 présent) : on saute safe-regex (re2 fait mieux, garantie
  // mathématique de matching linéaire).
  if (!_re2 && !safeRegex(pattern)) {
    return null
  }
  try {
    if (_re2) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
      return new _re2(pattern, flags)
    }
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

// ─── assessPatternSafety : feedback à l'admin (Session D) ────────────────────

export interface PatternAssessment {
  /** True si le pattern est utilisable (compile + non rejeté par safe-regex). */
  valid:    boolean
  /** True si safe-regex le considère comme non-catastrophique (heuristique). */
  safe:     boolean
  /** True si la compilation re2/native a réussi. */
  compiles: boolean
  /** Message d'erreur explicite pour l'admin, null si tout va bien. */
  reason:   string | null
}

/**
 * Évalue la sûreté d'un pattern regex pour l'admin (Session D POST/PUT).
 * Renvoie un feedback structuré :
 *   - valid=true  : utilisable, on peut INSERT
 *   - valid=false : à corriger avant INSERT
 *
 * Heuristique safe-regex peut produire des faux positifs (rejette parfois
 * des patterns légitimes type `(.{0,100})*`). À utiliser comme avertissement
 * UI, pas comme blocage absolu si re2 est dispo. Cf. spec v2.1.1 §11.
 */
export function assessPatternSafety(pattern: string, flags: string = 'i'): PatternAssessment {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { valid: false, safe: false, compiles: false, reason: 'Pattern vide ou type invalide' }
  }

  if (pattern.length > 500) {
    return { valid: false, safe: false, compiles: false, reason: 'Pattern trop long (max 500 caractères)' }
  }

  const safe = safeRegex(pattern)

  // Tentative de compilation (early-return en cas d'erreur)
  try {
    if (_re2) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      new _re2(pattern, flags)
    } else {
      new RegExp(pattern, flags)
    }
  } catch {
    return {
      valid:    false,
      safe,
      compiles: false,
      reason:   _re2
        ? 'Pattern non supporté par le moteur re2 (syntaxe incompatible).'
        : 'Pattern invalide.',
    }
  }
  // Si on arrive ici, le pattern compile (compiles = true implicite)

  // Sans re2 : safe-regex devient bloquant
  if (!_re2 && !safe) {
    return {
      valid:    false,
      safe:     false,
      compiles: true,
      reason:   'Pattern potentiellement catastrophique (ReDoS). Cette instance ne dispose pas de re2 pour protéger contre les regex risquées. Simplifie le pattern (évite les quantifiers nested type (a+)+).',
    }
  }

  // Avec re2 : on accepte tout ce que re2 compile, on prévient juste si safe-regex râle
  if (!safe) {
    return {
      valid:    true,
      safe:     false,
      compiles: true,
      reason:   'Pattern accepté grâce à re2 (matching linéaire garanti), mais safe-regex le signale comme potentiellement risqué. Sur une instance sans re2, ce pattern pourrait causer un DoS.',
    }
  }

  return { valid: true, safe: true, compiles: true, reason: null }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MatchContext {
  /** Contenu après sanitize() existant. Peut contenir du HTML (tags ok). */
  content: string
  /** Auteur (détecteurs à état : inondation). */
  userId?: string
  now?:    number
  /** Poids réel des mentions (les groupes valent les personnes prévenues),
   *  calculé par le moteur. Absent : le détecteur compte lui-même dans le texte. */
  mentionCount?: number
}

export interface MatchResult {
  /** Extrait pertinent pour le log/UI admin (max ~120 chars). */
  excerpt: string
  /** Mots interdits : le mot du message qui a déclenché, et le motif qui l'a
   *  attrapé. Sert à « Faux positif » (D25) : on ne propose d'apprendre un mot
   *  que s'il a été attrapé par un motif partiel sans être le motif lui-même. */
  found?: { token: string; pattern: string; kind: 'word' | 'prefix' | 'contains' }
}

export type Matcher = (
  ctx:    MatchContext,
  params: AutomodRuleParams,
) => MatchResult | null

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip basique des balises HTML pour les matchers qui veulent du texte brut. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Coupe un extrait pour le log (évite de logger 10 KB). */
function shortExcerpt(s: string, max = 120): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

// ─── Matcher 1 : regex (le seul qui utilise re2) ─────────────────────────────

export const matchRegex: Matcher = (ctx, params) => {
  try {
    const pattern = params.pattern
    if (!pattern || typeof pattern !== 'string') return null
    const flags = typeof params.flags === 'string' ? params.flags : 'i'

    const re = compileSafeRegex(pattern, flags)
    if (!re) return null  // pattern invalide

    if (!re.test(ctx.content)) return null

    // Pour l'excerpt on regrette de ne pas avoir match[0] facilement avec re2,
    // on utilise donc le contexte court.
    return { excerpt: shortExcerpt(stripHtml(ctx.content)) }
  } catch {
    return null
  }
}

// ─── Matcher 2 : caps ────────────────────────────────────────────────────────

export const matchCaps: Matcher = (ctx, params) => {
  try {
    const minLength       = typeof params.min_length === 'number'        ? params.min_length        : 15
    const thresholdPct    = typeof params.threshold_percent === 'number' ? params.threshold_percent : 70

    const text = stripHtml(ctx.content)
    if (text.length < minLength) return null

    let alphas = 0
    let upper  = 0
    for (const ch of text) {
      if (/[a-zA-ZÀ-ÿ]/.test(ch)) {
        alphas++
        if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) upper++
      }
    }
    if (alphas < minLength) return null  // pas assez de lettres pour juger

    const ratio = (upper / alphas) * 100
    if (ratio < thresholdPct) return null

    return { excerpt: shortExcerpt(text, 80) }
  } catch {
    return null
  }
}

// ─── Matcher 3 : link_domain ─────────────────────────────────────────────────

// Hôte ET chemin : une entrée « discord.com/invite » ne vaut que pour les
// invitations. Avant, seul l'hôte était lu : une entrée avec chemin ne
// correspondait à RIEN (les invitations discord.com/invite passaient).
const URL_RE = /https?:\/\/([^\s<>"'`]+)/gi

type LinkTarget = { host: string; path: string }

function splitUrl(rest: string): LinkTarget {
  // 'Sub.Example.com:8080/Path?x' → { host: 'sub.example.com', path: '/path?x' }
  const cut = rest.search(/[/?#]/)
  const hostPort = cut < 0 ? rest : rest.slice(0, cut)
  const path = cut < 0 ? '/' : rest.slice(cut)
  return { host: hostPort.split(':')[0].toLowerCase(), path: (path.startsWith('/') ? path : '/' + path).toLowerCase() }
}

function domainMatches(link: LinkTarget, listed: string): boolean {
  // Wildcard simple : '*.example.com' matche n'importe quel sous-domaine
  const l = listed.toLowerCase().trim()
  if (!l) return false
  const slash = l.indexOf('/')
  const lHost = slash < 0 ? l : l.slice(0, slash)
  const lPath = slash < 0 ? '' : l.slice(slash).replace(/\/+$/, '')
  const root = lHost.startsWith('*.') ? lHost.slice(2) : lHost
  const hostOk = link.host === root || link.host.endsWith('.' + root)
  if (!hostOk) return false
  if (!lPath) return true
  // « /invite » prend /invite, /invite/abc, /invite?x, pas /invitement
  const p = link.path
  return p === lPath || /^[/?#]/.test(p.slice(lPath.length)) && p.startsWith(lPath)
}

export const matchLinkDomain: Matcher = (ctx, params) => {
  try {
    const mode    = params.mode === 'whitelist' ? 'whitelist' : 'blacklist'
    const domains = Array.isArray(params.domains) ? params.domains : []
    if (domains.length === 0) return null

    const found: LinkTarget[] = []
    let m: RegExpExecArray | null
    URL_RE.lastIndex = 0
    while ((m = URL_RE.exec(ctx.content))) {
      found.push(splitUrl(m[1]))
      if (found.length > 50) break  // garde-fou anti-DoS sur message géant
    }
    if (found.length === 0) return null

    if (mode === 'blacklist') {
      for (const host of found) {
        for (const banned of domains) {
          if (domainMatches(host, banned)) {
            return { excerpt: `domain blacklist match: ${host.host}` }
          }
        }
      }
      return null
    }

    // whitelist : on flag si au moins une URL n'est PAS dans la liste
    for (const host of found) {
      let allowed = false
      for (const ok of domains) {
        if (domainMatches(host, ok)) { allowed = true; break }
      }
      if (!allowed) {
        return { excerpt: `domain not in whitelist: ${host.host}` }
      }
    }
    return null
  } catch {
    return null
  }
}

// ─── Matcher 4 : mention_spam ────────────────────────────────────────────────

// Le comptage vit dans mentionTally.ts : marques de mention (personnes et groupes)
// et « @mot » écrits, lettres accentuées comprises (@équipe, @Zoé). Le poids réel
// d'un groupe (les personnes qu'il prévient) est calculé par le moteur
// (mentionWeight.ts) et arrive ici dans ctx.mentionCount.
export const matchMentionSpam: Matcher = (ctx, params) => {
  try {
    const max = typeof params.max_mentions === 'number' ? params.max_mentions : 5
    const tally = tallyMentions(ctx.content)
    const count = typeof ctx.mentionCount === 'number' ? ctx.mentionCount : tally.people + tally.words + tally.groups.length  // repli : chaque marque pèse 1
    if (count <= max) return null
    return { excerpt: `mentions=${count} ${tally.sample.join(' ')}`.trim() }
  } catch {
    return null
  }
}

// ─── Matcher 5 : link_spam ───────────────────────────────────────────────────

export const matchLinkSpam: Matcher = (ctx, params) => {
  try {
    const max = typeof params.max_links === 'number' ? params.max_links : 2
    const urls = ctx.content.match(/https?:\/\//gi) ?? []
    if (urls.length <= max) return null
    return { excerpt: `links=${urls.length}` }
  } catch {
    return null
  }
}

import { matchKeywords, matchFlood, matchZalgo } from './matchers2'

// ─── Dispatcher ──────────────────────────────────────────────────────────────

const MATCHERS: Record<string, Matcher> = {
  regex:         matchRegex,
  caps:          matchCaps,
  link_domain:   matchLinkDomain,
  mention_spam:  matchMentionSpam,
  link_spam:     matchLinkSpam,
  keywords:      matchKeywords,
  flood:         matchFlood,
  zalgo:         matchZalgo,
}

/** Évalue une règle contre un message. Retourne le match ou null. */
export function matchRule(content: string, rule: AutomodRuleRow, extra: { userId?: string; now?: number; mentionCount?: number } = {}): MatchResult | null {
  const fn = MATCHERS[rule.type]
  if (!fn) return null
  return fn({ content, ...extra }, rule.params ?? {})
}
