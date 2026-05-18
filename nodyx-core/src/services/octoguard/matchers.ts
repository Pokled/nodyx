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
}

export interface MatchResult {
  /** Extrait pertinent pour le log/UI admin (max ~120 chars). */
  excerpt: string
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

const URL_RE = /https?:\/\/([^\s/<>"'`]+)/gi

function extractDomain(host: string): string {
  // 'sub.example.com:8080/path' → 'sub.example.com'
  return host.split('/')[0].split(':')[0].toLowerCase()
}

function domainMatches(host: string, listed: string): boolean {
  // Wildcard simple : '*.example.com' matche n'importe quel sous-domaine
  const l = listed.toLowerCase().trim()
  if (!l) return false
  if (l.startsWith('*.')) {
    const root = l.slice(2)
    return host === root || host.endsWith('.' + root)
  }
  return host === l || host.endsWith('.' + l)
}

export const matchLinkDomain: Matcher = (ctx, params) => {
  try {
    const mode    = params.mode === 'whitelist' ? 'whitelist' : 'blacklist'
    const domains = Array.isArray(params.domains) ? params.domains : []
    if (domains.length === 0) return null

    const found: string[] = []
    let m: RegExpExecArray | null
    URL_RE.lastIndex = 0
    while ((m = URL_RE.exec(ctx.content))) {
      found.push(extractDomain(m[1]))
      if (found.length > 50) break  // garde-fou anti-DoS sur message géant
    }
    if (found.length === 0) return null

    if (mode === 'blacklist') {
      for (const host of found) {
        for (const banned of domains) {
          if (domainMatches(host, banned)) {
            return { excerpt: `domain blacklist match: ${host}` }
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
        return { excerpt: `domain not in whitelist: ${host}` }
      }
    }
    return null
  } catch {
    return null
  }
}

// ─── Matcher 4 : mention_spam ────────────────────────────────────────────────

// {1,32} : tolérant pour détecter le spam, même les "@a" en série
const MENTION_RE = /@[a-zA-Z0-9_-]{1,32}/g

export const matchMentionSpam: Matcher = (ctx, params) => {
  try {
    const max = typeof params.max_mentions === 'number' ? params.max_mentions : 5
    const mentions = ctx.content.match(MENTION_RE) ?? []
    if (mentions.length <= max) return null
    const sample = mentions.slice(0, 3).join(' ')
    return { excerpt: `mentions=${mentions.length} ${sample}` }
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

// ─── Dispatcher ──────────────────────────────────────────────────────────────

const MATCHERS: Record<string, Matcher> = {
  regex:         matchRegex,
  caps:          matchCaps,
  link_domain:   matchLinkDomain,
  mention_spam:  matchMentionSpam,
  link_spam:     matchLinkSpam,
}

/** Évalue une règle contre un message. Retourne le match ou null. */
export function matchRule(content: string, rule: AutomodRuleRow): MatchResult | null {
  const fn = MATCHERS[rule.type]
  if (!fn) return null
  return fn({ content }, rule.params ?? {})
}
