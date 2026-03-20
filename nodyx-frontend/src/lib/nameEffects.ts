/**
 * nameEffects.ts — Username visual effects utility
 *
 * The DB username string is NEVER touched — effects are purely CSS.
 * Fonts are injected as @font-face rules client-side, SSR-safe.
 */

import { browser } from '$app/environment'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NameEffectFields {
  name_color?:          string | null
  name_glow?:           string | null
  name_glow_intensity?: number | null
  name_animation?:      string | null
  name_font_family?:    string | null
  name_font_url?:       string | null
}

// Subset used in presence data (camelCase from socket)
export interface PresenceEffects {
  nameColor?:          string | null
  nameGlow?:           string | null
  nameGlowIntensity?:  number | null
  nameAnimation?:      string | null
  nameFontFamily?:     string | null
  nameFontUrl?:        string | null
}

// ── Font presets ──────────────────────────────────────────────────────────────

export interface FontPreset {
  family:  string   // CSS font-family name
  label:   string   // display label
  google:  boolean  // true = loaded via Google Fonts link
  preview: string   // short sample text
}

export const FONT_PRESETS: FontPreset[] = [
  { family: '',              label: 'Défaut',           google: false, preview: 'Abc' },
  { family: 'Orbitron',      label: 'Orbitron',         google: true,  preview: 'Orb' },
  { family: 'Rajdhani',      label: 'Rajdhani',         google: true,  preview: 'Raj' },
  { family: 'Audiowide',     label: 'Audiowide',        google: true,  preview: 'Aud' },
  { family: 'Exo 2',         label: 'Exo 2',            google: true,  preview: 'Exo' },
  { family: 'Cinzel',        label: 'Cinzel',           google: true,  preview: 'Cin' },
  { family: 'Pacifico',      label: 'Pacifico',         google: true,  preview: 'Pac' },
  { family: 'Press Start 2P',label: 'Press Start 2P',   google: true,  preview: 'PS2' },
  { family: 'Bebas Neue',    label: 'Bebas Neue',       google: true,  preview: 'Beb' },
  { family: 'Dancing Script',label: 'Dancing Script',   google: true,  preview: 'Dan' },
  { family: 'VT323',         label: 'VT323',            google: true,  preview: 'VT3' },
  { family: 'Share Tech Mono',label: 'Share Tech Mono', google: true,  preview: 'Mno' },
]

// Build the Google Fonts <link> href for all preset fonts
export const GOOGLE_FONTS_URL = (() => {
  const families = FONT_PRESETS
    .filter(f => f.google && f.family)
    .map(f => `family=${encodeURIComponent(f.family)}:wght@400;700`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${families}&display=swap`
})()

// ── Animation presets ─────────────────────────────────────────────────────────

export interface AnimPreset {
  key:    string
  label:  string
  always: boolean  // true = permanent animation, false = hover-only
}

export const ANIM_PRESETS: AnimPreset[] = [
  { key: '',          label: 'Aucune',      always: false },
  { key: 'pulse',     label: 'Pulse',       always: false },
  { key: 'shake',     label: 'Tremblement', always: false },
  { key: 'float',     label: 'Flottement',  always: true  },
  { key: 'glitch',    label: 'Glitch',      always: false },
  { key: 'rainbow',   label: 'Arc-en-ciel', always: false },
  { key: 'glow-pulse',label: 'Lueur puls.', always: true  },
]

// ── Injected font tracking (browser-only, prevent duplicate <style> tags) ─────

const _injectedFonts = new Set<string>()

/**
 * Dynamically inject a @font-face rule for a custom uploaded font.
 * Safe to call multiple times — deduplicates by URL.
 */
export function ensureFontLoaded(fontFamily: string | null | undefined, fontUrl: string | null | undefined): void {
  if (!browser || !fontUrl || !fontFamily || _injectedFonts.has(fontUrl)) return
  const style = document.createElement('style')
  style.setAttribute('data-nodyx-font', fontFamily)
  // Escape single quotes and backslashes in fontUrl before injecting into CSS string
  const safeFontUrl = fontUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  style.textContent = `@font-face { font-family: '${CSS.escape(fontFamily)}'; src: url('${safeFontUrl}'); font-display: swap; }`
  document.head.appendChild(style)
  _injectedFonts.add(fontUrl)
}

// ── Style builder ─────────────────────────────────────────────────────────────

/**
 * Build the inline CSS style string for a username element.
 * Works with both DB field names (snake_case) and presence data (camelCase).
 */
export function buildNameStyle(
  fields: NameEffectFields | PresenceEffects,
  fallbackColor = '#ffffff'
): string {
  // Normalise to snake_case
  const color     = (fields as any).name_color     ?? (fields as any).nameColor     ?? fallbackColor
  const glow      = (fields as any).name_glow      ?? (fields as any).nameGlow      ?? null
  const intensity = (fields as any).name_glow_intensity ?? (fields as any).nameGlowIntensity ?? 10
  const fontFamily = (fields as any).name_font_family ?? (fields as any).nameFontFamily ?? null

  const parts: string[] = [`color: ${color}`]

  if (glow) {
    const px  = Math.min(40, Math.max(5, Number(intensity) || 10))
    const px2 = px * 2
    parts.push(`text-shadow: 0 0 ${px}px ${glow}, 0 0 ${px2}px ${glow}80, 0 0 ${px2 * 2}px ${glow}40`)
  }

  if (fontFamily) {
    // Escape quotes/backslashes to prevent CSS injection in font-family string
    const safeFontFamily = fontFamily.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    parts.push(`font-family: '${safeFontFamily}', sans-serif`)
  }

  return parts.join('; ')
}

/**
 * Return the CSS animation class for a username, if any.
 */
export function buildAnimClass(fields: NameEffectFields | PresenceEffects): string {
  const anim = (fields as any).name_animation ?? (fields as any).nameAnimation ?? null
  if (!anim) return ''
  return `name-anim-${anim}`
}
