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

export type Locale = 'fr' | 'en' | 'es' | 'de' | 'ru' | 'pt-PT' | 'pt-BR' | 'vi' | 'zh-Hans'

export interface LocaleMeta {
  code:  Locale
  label: string
  flag:  string   // emoji (fallback ; Chrome/Windows ne rend pas les drapeaux)
  flagIcon: string // id Twemoji SVG bundlé (rendu fiable partout via ChannelIcon)
}

export const LOCALES: LocaleMeta[] = [
  { code: 'fr',    label: 'Français',   flag: '🇫🇷', flagIcon: 'twemoji:flag-france' },
  { code: 'en',    label: 'English',    flag: '🇬🇧', flagIcon: 'twemoji:flag-united-kingdom' },
  { code: 'es',    label: 'Español',    flag: '🇪🇸', flagIcon: 'twemoji:flag-spain' },
  { code: 'de',    label: 'Deutsch',    flag: '🇩🇪', flagIcon: 'twemoji:flag-germany' },
  { code: 'ru',    label: 'Русский',    flag: '🇷🇺', flagIcon: 'twemoji:flag-russia' },
  // Deux portugais : sans le suffixe, le sélecteur afficherait deux fois la même
  // étiquette et personne ne saurait lequel il choisit.
  { code: 'pt-PT', label: 'Português (PT)', flag: '🇵🇹', flagIcon: 'twemoji:flag-portugal' },
  { code: 'pt-BR', label: 'Português (BR)', flag: '🇧🇷', flagIcon: 'twemoji:flag-brazil' },
  { code: 'vi',    label: 'Tiếng Việt', flag: '🇻🇳', flagIcon: 'twemoji:flag-vietnam' },
  // Une langue lue dans plusieurs pays (Chine, Singapour, Malaisie, diaspora) :
  // une icône de langue, pas le drapeau d'un pays.
  { code: 'zh-Hans', label: '简体中文', flag: '🌏', flagIcon: 'twemoji:globe-showing-asia-australia' },
]

// ── Messages ──────────────────────────────────────────────────────────────────

// Import statique — tree-shaken, résolu au build
import fr from './locales/fr.json'
import en from './locales/en.json'
import es from './locales/es.json'
import de from './locales/de.json'
import ru from './locales/ru.json'
import ptPT from './locales/pt-PT.json'
import ptBR from './locales/pt-BR.json'
import vi from './locales/vi.json'
import zhHans from './locales/zh-Hans.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messages: Record<Locale, Record<string, any>> = { fr, en, es, de, ru, 'pt-PT': ptPT, 'pt-BR': ptBR, vi, 'zh-Hans': zhHans }

// ── Store locale ──────────────────────────────────────────────────────────────

/**
 * Chinois simplifié : `zh`, `zh-CN`, `zh-SG`, `zh-MY`, `zh-Hans(-*)`. Les formes
 * traditionnelles (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant(-*)`) s'écrivent avec
 * d'autres caractères : elles ne reçoivent PAS le simplifié et gardent le repli.
 */
function estChinoisSimplifie(code: string): boolean {
  const c = code.toLowerCase()
  if (c === 'zh' || c.startsWith('zh-hans')) return true
  return c === 'zh-cn' || c === 'zh-sg' || c === 'zh-my'
}

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

    // Chrome à Taïwan envoie `zh-TW,zh;q=0.9` : ce `zh` générique y désigne le
    // traditionnel déjà demandé, il ne doit pas faire servir le simplifié.
    let traditionnelDemande = false
    for (const lang of parsed) {
      const code = lang.code
      if (code.startsWith('zh-') && !estChinoisSimplifie(code)) traditionnelDemande = true
      const nav = code.slice(0, 2)
      // Le brésilien d'abord : c'est la variante la plus demandée, et la ligne
      // précédente l'EXCLUAIT du repli vers pt-PT sans rien lui proposer. Un
      // navigateur n'annonçant que `pt-BR` ne recevait donc aucun portugais.
      if (code.startsWith('pt-br')) return 'pt-BR'
      if (nav === 'pt') return 'pt-PT'
      if (nav === 'fr') return 'fr'
      if (nav === 'es') return 'es'
      if (nav === 'de') return 'de'
      if (nav === 'ru') return 'ru'
      if (nav === 'vi') return 'vi'
      if (estChinoisSimplifie(code) && !(code === 'zh' && traditionnelDemande)) return 'zh-Hans'
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
  if (full.startsWith('pt-br')) return 'pt-BR'
  if (nav === 'pt') return 'pt-PT'
  if (nav === 'fr') return 'fr'
  if (nav === 'es') return 'es'
  if (nav === 'de') return 'de'
  if (nav === 'ru') return 'ru'
  if (nav === 'vi') return 'vi'
  if (estChinoisSimplifie(full)) return 'zh-Hans'
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
      messages['en']?.[key] ??   // EN est à 100% de parité : fallback universel avant le FR source
      messages['fr']?.[key] ??
      key  // fallback ultime = la clé elle-même (jamais de crash)

    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{{${k}}}`, String(v))
      }
    }

    return str
  }
})
