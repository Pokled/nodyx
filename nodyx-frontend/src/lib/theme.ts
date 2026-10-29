/**
 * theme.ts — préférence clair/sombre/système du "contenant"
 * (SPECS/NODYX_CONTENANT_DESIGN_CDC.md, étape 3).
 *
 * Même architecture que `locale` dans `$lib/i18n.ts` : un cookie pilote le
 * rendu SSR (`%theme-attr%` dans app.html, substitué par hooks.server.ts)
 * pour éviter un flash du mauvais thème, le store JS se synchronise dessus
 * au montage via `setSSR`, et `setPreference` met à jour cookie +
 * localStorage + l'attribut DOM en une fois.
 */

import { writable, derived, get } from 'svelte/store'
import { browser } from '$app/environment'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'nodyx_theme'
const COOKIE_KEY  = 'nodyx_theme'

export function isKnownThemePreference(v: string | null | undefined): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system'
}

function applyToDocument(pref: ThemePreference) {
  if (!browser) return
  if (pref === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', pref)
  }
}

function createThemePreferenceStore() {
  const { subscribe, set } = writable<ThemePreference>('system')

  return {
    subscribe,
    /** Appelé une fois côté client (onMount dans +layout.svelte). Le HTML
     * rendu par le serveur porte déjà le bon `data-theme` (cookie lu par
     * hooks.server.ts) ; on ne fait ici que remettre le store JS en phase. */
    init() {
      const attr = document.documentElement.getAttribute('data-theme')
      if (isKnownThemePreference(attr)) { set(attr); return }
      const stored = localStorage.getItem(STORAGE_KEY)
      set(isKnownThemePreference(stored) ? stored : 'system')
    },
    setPreference(pref: ThemePreference) {
      if (browser) {
        localStorage.setItem(STORAGE_KEY, pref)
        document.cookie = `${COOKIE_KEY}=${pref}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
        applyToDocument(pref)
      }
      set(pref)
    },
    /** Préférence initiale depuis le cookie SSR — avant hydratation. */
    setSSR(pref: string | null | undefined) {
      if (isKnownThemePreference(pref)) set(pref)
    },
    get current(): ThemePreference {
      return get({ subscribe })
    },
  }
}

export const themePreference = createThemePreferenceStore()

function systemPrefersDark(): boolean {
  if (!browser) return true // défaut historique de l'appli = sombre
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Thème EFFECTIF (résout 'system' via le média OS, mis à jour en direct si
 * l'OS change de thème pendant que l'onglet est ouvert). À utiliser partout
 * où une couleur perso (canal, pseudo) doit rester lisible quel que soit le
 * thème actif — cf. contrastSafeColor() ci-dessous. */
export const isDarkTheme = derived<typeof themePreference, boolean>(themePreference, ($pref, set) => {
  if ($pref === 'dark')  { set(true);  return }
  if ($pref === 'light') { set(false); return }
  set(systemPrefersDark())
  if (!browser) return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => set(systemPrefersDark())
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}, true)

// ── Contraste des couleurs personnalisées (canaux, pseudos) ─────────────────
// Un admin/membre choisit sa couleur pour LE thème qu'il regarde au moment du
// choix. Si l'appli n'avait qu'un seul thème (sombre, historique), un blanc
// choisi restait lisible pour tout le monde. Avec un vrai bouton clair/sombre,
// ce même blanc devient invisible pour qui bascule en clair — signalé par
// Jonathan avant même que le bouton n'existe. Le filet : si la couleur perso
// n'a pas assez de contraste avec le thème COURANT, on retombe sur la couleur
// par défaut de l'appelant plutôt que de rendre du texte illisible.
const HEX_RE = /^#[0-9a-f]{6}$/i

// Vrai contraste WCAG contre un fond de référence par thème (la surface la
// plus défavorable de chaque mode, cf. app.css). L'ancienne règle comparait
// une luminance perçue à des seuils fixes : un gris #444546 (1,9:1 sur fond
// sombre) ou un vert fluo #5fff28 (1,3:1 sur blanc) passaient le filet.
const DARK_REF  = [0x17, 0x14, 0x0f] as const
const LIGHT_REF = [0xff, 0xff, 0xff] as const
// 3:1 : le seuil WCAG du texte gras, et de quoi ne toucher que les cas
// vraiment illisibles. Rouge, indigo, vert moyen passent dans les deux thèmes.
const MIN_CONTRAST = 3

type RGB = readonly [number, number, number]

function parseHex(hex: string): RGB {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')
}

function relativeLuminance([r, g, b]: RGB): number {
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: RGB, b: RGB): number {
  const x = relativeLuminance(a), y = relativeLuminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * Renvoie `color` si elle reste lisible sur le thème actif. Sinon, la même
 * teinte éclaircie (thème sombre) ou assombrie (thème clair) juste assez pour
 * l'être : un membre garde SA couleur, simplement ajustée. Un gris n'a pas de
 * teinte à préserver : il retombe sur `fallback`.
 * Ne s'applique qu'aux couleurs hex à 6 chiffres (format du color picker) —
 * toute autre valeur (rgb(), mot-clé CSS, dégradé...) passe inchangée : on
 * préfère ne rien casser sur un format qu'on n'a pas prévu plutôt que
 * deviner sa luminance.
 */
export function contrastSafeColor(color: string | null | undefined, fallback: string, isDarkBg: boolean): string {
  if (!color) return fallback
  if (!HEX_RE.test(color)) return color
  const rgb = parseHex(color)
  const bg = isDarkBg ? DARK_REF : LIGHT_REF
  if (contrast(rgb, bg) >= MIN_CONTRAST) return color
  if (Math.max(...rgb) - Math.min(...rgb) < 24) return fallback
  // Mélange progressif vers le blanc (sombre) ou le noir (clair).
  const target = isDarkBg ? 255 : 0
  for (let t = 0.05; t <= 1; t += 0.05) {
    const mixed = rgb.map(c => c + (target - c) * t) as unknown as RGB
    if (contrast(mixed, bg) >= MIN_CONTRAST) return toHex(mixed)
  }
  return fallback
}
