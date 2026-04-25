/**
 * Nodyx i18n — store Svelte natif, SSR-safe, zéro dépendance externe.
 *
 * Usage :
 *   import { t } from '$lib/i18n'
 *   $t('settings.network.title')
 *
 * Ajouter une langue : créer src/lib/locales/<code>.json + l'entrée dans LOCALES.
 */

import { writable, derived, get } from 'svelte/store'
import { browser }                from '$app/environment'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Locale = 'fr' | 'en' | 'es'

export interface LocaleMeta {
  code:  Locale
  label: string
  flag:  string
}

export const LOCALES: LocaleMeta[] = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English',  flag: '🇬🇧' },
  { code: 'es', label: 'Español',  flag: '🇪🇸' },
]

// ── Messages ──────────────────────────────────────────────────────────────────

// Import statique — tree-shaken, résolu au build
import fr from './locales/fr.json'
import en from './locales/en.json'
import es from './locales/es.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messages: Record<Locale, Record<string, any>> = { fr, en, es }

// ── Store locale ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nodyx_locale'

function getInitialLocale(): Locale {
  if (!browser) return 'fr'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'fr' || stored === 'en' || stored === 'es') return stored
  // Détection navigateur
  const nav = navigator.language.slice(0, 2).toLowerCase()
  if (nav === 'fr') return 'fr'
  if (nav === 'es') return 'es'
  return 'en'
}
function createLocaleStore() {
  const { subscribe, set } = writable<Locale>('fr')

  return {
    subscribe,
    init() {
      // Appelé une seule fois côté client (onMount dans +layout.svelte)
      set(getInitialLocale())
    },
    setLocale(locale: Locale) {
      if (browser) localStorage.setItem(STORAGE_KEY, locale)
      set(locale)
    },
    get current(): Locale {
      return get({ subscribe })
    },
  }
}

export const locale = createLocaleStore()

// ── Fonction de traduction ────────────────────────────────────────────────────

/**
 * Store dérivé qui retourne une fonction de traduction.
 *
 * $t('key')           → string traduite
 * $t('key', { n: 3 }) → interpolation simple {{n}} → '3'
 */
export const t = derived(locale, ($locale) => {
  return (key: string, vars?: Record<string, string | number>): string => {
    let str =
      messages[$locale]?.[key] ??
      messages['fr']?.[key] ??
      key  // fallback = la clé elle-même (jamais de crash)

    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{{${k}}}`, String(v))
      }
    }

    return str
  }
})
