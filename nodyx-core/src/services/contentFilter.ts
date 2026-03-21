/**
 * contentFilter.ts — Filtre de contenu haineux / symboles interdits.
 *
 * Bloque :
 *  1. Symboles Unicode nazis / haineux (swastika, runes SS, rune Odal…)
 *  2. Patterns configurés par l'admin via BLOCKED_CONTENT_PATTERNS (regex, séparés par |)
 *
 * Usage :
 *   const result = checkContent(text)
 *   if (!result.ok) return reply.code(422).send({ error: result.reason, code: 'CONTENT_BLOCKED' })
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Référence Unicode :
 *   U+5350  卐  Swastika (croix gammée droite — nazisme)
 *   U+534D  卍  Manji   (croix gammée gauche — nazisme en contexte occidental)
 *   U+16CB  ᛋ  Rune Sowilō/Sigel  → sigle SS nazi (ᛋᛋ)
 *   U+16C9  ᛉ  Rune Algiz/Elhaz  → Lebensrune SS
 *   U+16DF  ᛟ  Rune Othala/Odal  → insigne Waffen-SS, groupes néo-nazis
 *   U+16F3  ᛳ  Rune Arlaug       → utilisée dans la symbolique haine
 *   U+2625  ☥  Ankh              → parfois détourné, inclus par précaution
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ContentCheckResult {
  ok:      boolean
  reason?: string
}

// ── Code points bloqués ───────────────────────────────────────────────────────

const BLOCKED_CODEPOINTS: ReadonlySet<number> = new Set([
  0x5350,  // 卐  Swastika droit (croix gammée nazie)
  0x534D,  // 卍  Swastika gauche / manji
  0x16CB,  // ᛋ  Rune Sowilō — sigle SS nazi
  0x16C9,  // ᛉ  Rune Algiz/Elhaz — Lebensrune SS
  0x16DF,  // ᛟ  Rune Othala/Odal — insigne Waffen-SS
  0x16F3,  // ᛳ  Rune Arlaug
])

// ── Patterns admin (BLOCKED_CONTENT_PATTERNS=regex1|regex2) ───────────────────

function buildAdminPatterns(): RegExp[] {
  const raw = process.env.BLOCKED_CONTENT_PATTERNS ?? ''
  if (!raw.trim()) return []
  return raw.split('|').flatMap(p => {
    try {
      return [new RegExp(p.trim(), 'iu')]
    } catch {
      console.warn(`[contentFilter] Pattern invalide ignoré : "${p.trim()}"`)
      return []
    }
  })
}

// Compilés une seule fois au démarrage
const ADMIN_PATTERNS: readonly RegExp[] = buildAdminPatterns()

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Vérifie qu'un texte ne contient pas de contenu haineux / symbole interdit.
 *
 * @returns { ok: true } si le contenu est propre
 *          { ok: false, reason } si un symbole interdit est détecté
 */
export function checkContent(text: string): ContentCheckResult {
  // 1 — Scan code-point par code-point
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    if (BLOCKED_CODEPOINTS.has(cp)) {
      return {
        ok:     false,
        reason: 'Contenu refusé : symbole haineux ou interdit détecté',
      }
    }
  }

  // 2 — Patterns personnalisés de l'admin
  for (const pattern of ADMIN_PATTERNS) {
    if (pattern.test(text)) {
      return {
        ok:     false,
        reason: 'Contenu refusé : correspond à un filtre de l\'administrateur',
      }
    }
  }

  return { ok: true }
}

/**
 * Vérifie le contenu d'un texte HTML déjà sanitisé.
 * Convertit en texte brut avant le scan (évite les faux positifs sur les balises).
 */
export function checkHtmlContent(html: string): ContentCheckResult {
  // Extraction texte brut : on supprime les balises HTML
  const plain = html.replace(/<[^>]+>/g, ' ')
  return checkContent(plain)
}
