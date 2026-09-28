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

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * Renvoie `color` si elle reste lisible sur le thème actif, sinon `fallback`.
 * Ne s'applique qu'aux couleurs hex à 6 chiffres (format du color picker) —
 * toute autre valeur (rgb(), mot-clé CSS, dégradé...) passe inchangée : on
 * préfère ne rien casser sur un format qu'on n'a pas prévu plutôt que
 * deviner sa luminance.
 */
export function contrastSafeColor(color: string | null | undefined, fallback: string, isDarkBg: boolean): string {
  if (!color) return fallback
  if (!HEX_RE.test(color)) return color
  const lum = relativeLuminance(color)
  // Seuils volontairement larges (pas un simple milieu à .5) : on ne corrige
  // que les cas francs (blanc sur clair, noir sur sombre), pas les couleurs
  // moyennement saturées qui restent globalement lisibles dans les deux sens.
  if (isDarkBg  && lum < 0.22) return fallback
  if (!isDarkBg && lum > 0.82) return fallback
  return color
}
