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
import { browser }                from '$app/env'

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
  // Comme les deux portugais : la langue, puis la variante. Le jour où le
  // traditionnel arrivera, « 中文 (繁體) » se distinguera sans ambiguïté.
  { code: 'zh-Hans', label: '中文 (简体)', flag: '🇨🇳', flagIcon: 'twemoji:flag-china' },
]

// ── Messages ──────────────────────────────────────────────────────────────────

// Chargées À LA DEMANDE. Importées en dur, les 9 langues (~1,5 Mo brut, ~437 Ko gzip)
// partaient avec CHAQUE page, alors qu'un visiteur n'en lit qu'une (mesuré le
// 13/11/2026). Chaque fichier devient un bloc séparé : la page ne télécharge que la
// langue affichée, plus l'anglais quand elle n'est pas complète (repli universel).
// Le layout (+layout.ts) attend la langue AVANT le rendu : ni clé brute affichée, ni
// décalage d'hydratation. La page /translate, qui compte les traductions, garde ses
// propres imports (translationProgress.ts) : elle a vraiment besoin des neuf.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loaders = import.meta.glob<{ default: Record<string, any> }>('./locales/*.json')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messages: Partial<Record<Locale, Record<string, any>>> = {}
// Bumpé à chaque langue chargée : `t` se recalcule même si la langue ne change pas.
const loadedVersion = writable(0)

// Un seul chargement à la fois par langue (deux appels simultanés partagent le même).
const inflight: Partial<Record<Locale, Promise<void>>> = {}
function loadOne(code: Locale): Promise<void> {
  if (messages[code]) return Promise.resolve()
  const loader = loaders[`./locales/${code}.json`]
  if (!loader) return Promise.resolve()
  return inflight[code] ??= loader().then(mod => {
    messages[code] = mod.default
    loadedVersion.update(n => n + 1)
  }).finally(() => { delete inflight[code] })
}

/**
 * Charge une langue et son repli. Le français (source) et l'anglais (parité à 100 %,
 * vérifiée en CI) se suffisent ; les autres, partiellement traduites, ont besoin de
 * l'anglais pour les clés manquantes.
 */
export async function ensureLocale(code: Locale): Promise<void> {
  await Promise.all([loadOne(code), code === 'fr' || code === 'en' ? null : loadOne('en')])
}

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
  // Seul le DERNIER choix s'applique : « English » puis vite « Español », si l'anglais
  // arrive après l'espagnol, on ne repasse pas en anglais. Vaut aussi pour init().
  let lastAsked = 0
  const switchTo = (code: Locale, onError: () => void) => {
    const ticket = ++lastAsked
    ensureLocale(code).then(() => { if (ticket === lastAsked) set(code) }).catch(() => { if (ticket === lastAsked) onError() })
  }

  return {
    subscribe,
    init() {
      // Appelé une seule fois côté client (onMount dans +layout.svelte). La langue
      // retenue peut différer de celle du serveur (choix gardé dans le navigateur) :
      // on la charge AVANT de basculer, sinon des clés brutes s'afficheraient.
      switchTo(getInitialLocale(), () => { /* reste sur la langue du serveur */ })
    },
    setLocale(locale: Locale) {
      if (browser) {
        localStorage.setItem(STORAGE_KEY, locale)
        // Sync cookie for SSR — avoids flash of default locale
        document.cookie = `${COOKIE_KEY}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
      }
      // Chargée puis appliquée. Si le fichier est introuvable (page ouverte avant une
      // mise à jour, il a changé de nom), on recharge : le cookie est déjà posé, la page
      // revient dans la bonne langue avec les bons fichiers.
      switchTo(locale, () => { if (browser) location.reload() })
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
 * Échappe une valeur avant de l'insérer dans un texte traduit rendu en {@html}.
 * OBLIGATOIRE pour toute variable venant d'un membre (pseudo, nom affiché,
 * recherche…) : `{@html tFn('cle', { name: escHtml(user.name) })}`.
 * Un test (i18nHtmlVars.test.ts) fait échouer le build sinon.
 */
export function escHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Store dérivé qui retourne une fonction de traduction.
 *
 * $t('key')           → string traduite
 * $t('key', { n: 3 }) → interpolation simple {{n}} → '3'
 */
export const t = derived([locale, loadedVersion], ([$locale]) => {
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
