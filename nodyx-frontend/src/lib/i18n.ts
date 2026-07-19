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

export type Locale = 'fr' | 'en' | 'es' | 'de' | 'ru' | 'pt-PT' | 'vi'

export interface LocaleMeta {
  code:  Locale
  label: string
  flag:  string
}

export const LOCALES: LocaleMeta[] = [
  { code: 'fr',    label: 'Français',   flag: '🇫🇷' },
  { code: 'en',    label: 'English',    flag: '🇬🇧' },
  { code: 'es',    label: 'Español',    flag: '🇪🇸' },
  { code: 'de',    label: 'Deutsch',    flag: '🇩🇪' },
  { code: 'ru',    label: 'Русский',    flag: '🇷🇺' },
  { code: 'pt-PT', label: 'Português',  flag: '🇵🇹' },
  { code: 'vi',    label: 'Tiếng Việt', flag: '🇻🇳' },
]

// ── Messages ──────────────────────────────────────────────────────────────────

// Import statique — tree-shaken, résolu au build
import fr from './locales/fr.json'
import en from './locales/en.json'
import es from './locales/es.json'
import de from './locales/de.json'
import ru from './locales/ru.json'
import ptPT from './locales/pt-PT.json'
import vi from './locales/vi.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messages: Record<Locale, Record<string, any>> = { fr, en, es, de, ru, 'pt-PT': ptPT, vi }

// ── Store locale ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nodyx_locale'
const COOKIE_KEY = 'nodyx_locale'

export function getLocaleFromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined
  try {
    const parsed = header
      .split(',')
      .map(lang => {
        const [name, q] = lang.split(';q=')
        return {
          code: name.trim().toLowerCase(),
          weight: q ? parseFloat(q) : 1.0
        }
      })
      .sort((a, b) => b.weight - a.weight)

    for (const lang of parsed) {
      const code = lang.code
      const nav = code.slice(0, 2)
      if (code === 'pt-pt' || (nav === 'pt' && !code.startsWith('pt-br'))) return 'pt-PT'
      if (nav === 'fr') return 'fr'
      if (nav === 'es') return 'es'
      if (nav === 'de') return 'de'
      if (nav === 'ru') return 'ru'
      if (nav === 'vi') return 'vi'
      if (nav === 'en') return 'en'
    }
  } catch {
    // ignore
  }
  return undefined
}

/**
 * True only if `code` is a locale we actually ship. Server-safe guard: the SSR
 * cookie is attacker-settable, so never trust it before it clears this check.
 */
export function isKnownLocale(code: string | null | undefined): code is Locale {
  return !!code && LOCALES.some((l) => l.code === code)
}

function getInitialLocale(): Locale {
  if (!browser) return 'fr'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && LOCALES.some((l) => l.code === stored)) return stored as Locale
  // Détection navigateur
  const full = navigator.language.toLowerCase()
  const nav = full.slice(0, 2)
  if (full === 'pt-pt' || (nav === 'pt' && !full.startsWith('pt-br'))) return 'pt-PT'
  if (nav === 'fr') return 'fr'
  if (nav === 'es') return 'es'
  if (nav === 'de') return 'de'
  if (nav === 'ru') return 'ru'
  if (nav === 'vi') return 'vi'
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
      if (browser) {
        localStorage.setItem(STORAGE_KEY, locale)
        // Sync cookie for SSR — avoids flash of default locale
        document.cookie = `${COOKIE_KEY}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
      }
      set(locale)
    },
    /** Set initial locale from SSR data (cookie) — avoids flash on hydration */
    setSSR(locale: Locale) {
      if (LOCALES.some((l) => l.code === locale)) set(locale)
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
