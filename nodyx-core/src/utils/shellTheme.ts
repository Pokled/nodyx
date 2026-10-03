/**
 * shellTheme.ts — l'« Ambiance » d'une instance (SPECS/NODYX_APPARENCE_CDC.md).
 *
 * Réglages du contenant flottant choisis par l'admin : UN accent, un décor,
 * une intensité, un mode par défaut. Valeurs typées et bornées, JAMAIS de CSS
 * libre : le frontend en dérive lui-même les variables --nx-* (clair et
 * sombre, avec plancher de contraste). Stocké en JSON dans instance_settings :
 *   - `theme_shell`        : version publiée, servie à tous par /instance/info
 *   - `theme_shell_draft`  : brouillon de l'admin, partagé par l'écran
 *                            Apparence ET l'édition en direct (un seul brouillon,
 *                            un seul « Publier », quel que soit l'endroit).
 *
 * Note : loadSettingsIntoEnv() (config/settings.ts) copie TOUTES les clés
 * d'instance_settings dans process.env, comme theme_vars/theme_css avant
 * elles. Sans risque ici : les noms sont en minuscules, aucune variable du
 * serveur ne peut être écrasée.
 */
import { z } from 'zod'

export const SHELL_KEY_PUBLISHED = 'theme_shell'
export const SHELL_KEY_DRAFT     = 'theme_shell_draft'
/** Brouillon de l'Identité (logo, bannière) : publié dans `communities`. */
export const IDENTITY_KEY_DRAFT  = 'theme_identity_draft'

// Décor personnalisé : un fichier téléversé sur l'instance (/uploads/…), un
// décor d'ambiance livré avec Nodyx (/ambiances/nom.jpg, fichiers statiques du
// frontend, donc présents sur TOUTE instance), ou une URL https. Rien d'autre :
// ni javascript:, ni data:, ni remontée de dossier.
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9_\-./]+$/
const AMBIANCE_PATH = /^\/ambiances\/[a-z0-9-]{1,40}\.(jpg|webp|png)$/

export function isSafeBackdropUrl(url: string): boolean {
  if (url.length > 500) return false
  if (url.startsWith('/ambiances/')) return AMBIANCE_PATH.test(url)
  if (url.startsWith('/')) return UPLOAD_PATH.test(url) && !url.includes('..') && !url.includes('//')
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

// ── Style propre à une zone (CDC Apparence, partie 3) ──────────────────────
// « Une zone éditable, c'est comme si on en modifiait le CSS » (Jonathan,
// 30/09) : tous les réglages visuels d'une plaque, mais TYPÉS et BORNÉS,
// jamais de CSS libre. Chaque réglage est optionnel : absent, la zone suit
// l'ambiance.
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const Int = (min: number, max: number) => z.number().int().min(min).max(max)

export const SHELL_ZONES = ['rail', 'sidebar', 'header', 'members', 'sheet'] as const

export const ZoneStyleSchema = z.object({
  accent:       Hex.optional(),
  surface:      Hex.optional(),
  opacity:      Int(0, 100).optional(),
  blur:         Int(0, 40).optional(),
  border_color: Hex.optional(),
  border_width: Int(0, 3).optional(),
  radius:       Int(0, 32).optional(),
  shadow:       Int(0, 100).optional(),
  image: z.object({
    url:  z.string().max(500).refine(isSafeBackdropUrl, 'image : fichier /uploads/, /ambiances/ ou https'),
    x:    Int(0, 100),
    y:    Int(0, 100),
    zoom: Int(100, 300),
    veil: Int(0, 100),
  }).strict().optional(),
  font:         z.enum(['system', 'rounded', 'serif', 'mono']).optional(),
}).strict()

export type ZoneStyle = z.infer<typeof ZoneStyleSchema>

const ZonesSchema = z.object(Object.fromEntries(SHELL_ZONES.map(k => [k, ZoneStyleSchema.optional()])) as Record<typeof SHELL_ZONES[number], z.ZodOptional<typeof ZoneStyleSchema>>).strict()

export const ShellThemeSchema = z.object({
  accent:       z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backdrop:     z.enum(['banner', 'custom', 'none']),
  backdrop_url: z.string().nullable().optional(),
  intensity:    z.number().int().min(0).max(100),
  default_mode: z.enum(['dark', 'light', 'system']),
  // Fonds : gris de confort indépendants de l'accent (thème Originel) ou gris
  // teintés par l'accent. Optionnel : les ambiances publiées avant ce réglage
  // restent valides et gardent leur rendu ('tinted').
  neutrals:     z.enum(['graphite', 'tinted', 'black']).optional(),
  zones:        ZonesSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.backdrop === 'custom' && !v.backdrop_url) {
    ctx.addIssue({ code: 'custom', path: ['backdrop_url'], message: 'backdrop_url requis pour un décor personnalisé' })
  }
  if (v.backdrop_url && !isSafeBackdropUrl(v.backdrop_url)) {
    ctx.addIssue({ code: 'custom', path: ['backdrop_url'], message: 'backdrop_url doit être un fichier /uploads/ ou une URL https' })
  }
})

export type ShellTheme = z.infer<typeof ShellThemeSchema>

/** Forme canonique stockée : accent en minuscules, url seulement si utile. */
export function normalizeShellTheme(v: ShellTheme): ShellTheme {
  return {
    accent:       v.accent.toLowerCase(),
    backdrop:     v.backdrop,
    backdrop_url: v.backdrop === 'custom' ? (v.backdrop_url ?? null) : null,
    intensity:    v.intensity,
    default_mode: v.default_mode,
    neutrals:     v.neutrals ?? 'tinted',
    ...(normalizeZones(v.zones) ? { zones: normalizeZones(v.zones) } : {}),
  }
}

/** Couleurs en minuscules ; une zone sans aucun réglage disparaît (elle suit l'ambiance). */
function normalizeZones(zones: ShellTheme['zones']): ShellTheme['zones'] | undefined {
  if (!zones) return undefined
  const out: Record<string, ZoneStyle> = {}
  for (const [k, z] of Object.entries(zones)) {
    if (!z || Object.keys(z).length === 0) continue
    out[k] = {
      ...z,
      ...(z.accent ? { accent: z.accent.toLowerCase() } : {}),
      ...(z.surface ? { surface: z.surface.toLowerCase() } : {}),
      ...(z.border_color ? { border_color: z.border_color.toLowerCase() } : {}),
    }
  }
  return Object.keys(out).length ? out as ShellTheme['zones'] : undefined
}

/**
 * Relecture d'une valeur stockée. Tolérante : une valeur corrompue ou d'un
 * format futur inconnu donne null (le site retombe sur son apparence par
 * défaut) au lieu de faire échouer /instance/info pour tout le monde.
 */
export function parseStoredShellTheme(raw: string | null | undefined): ShellTheme | null {
  if (!raw) return null
  try {
    const parsed = ShellThemeSchema.safeParse(JSON.parse(raw))
    return parsed.success ? normalizeShellTheme(parsed.data) : null
  } catch {
    return null
  }
}

// ── Identité en brouillon (logo, bannière) ────────────────────────────────
// Même brouillon partagé que l'Ambiance, un seul « Publier ». Chaque champ est
// optionnel : absent = inchangé, null = retiré. Mêmes règles d'URL que le
// décor : un fichier téléversé sur l'instance ou une adresse https.
const IdentityUrl = z.string().max(500).refine(isSafeBackdropUrl, 'doit être un fichier /uploads/ ou une URL https').nullable()

export const IdentityDraftSchema = z.object({
  logo_url:   IdentityUrl.optional(),
  banner_url: IdentityUrl.optional(),
}).strict().refine(v => v.logo_url !== undefined || v.banner_url !== undefined, 'au moins un champ')

export type IdentityDraft = z.infer<typeof IdentityDraftSchema>

export function parseStoredIdentityDraft(raw: string | null | undefined): IdentityDraft | null {
  if (!raw) return null
  try {
    const parsed = IdentityDraftSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
