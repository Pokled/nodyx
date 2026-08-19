// ─── Les langues de la documentation ─────────────────────────────────────────
//
// Ce module est volontairement SANS dépendance serveur : la barre latérale et le
// sélecteur en ont besoin dans le navigateur, et `docs.server.ts` ne peut pas y
// être importé.
//
// `docs/` contient aussi `articles`, `audits`, `ideas`, `img`, `seo`, `specs`,
// qui ne sont pas des langues. On liste donc explicitement plutôt que de deviner
// à partir des dossiers présents.
//
// Mesure du 2026-08-19 : `docs/fr` comptait 14 pages traduites et `docs/es` 9,
// et AUCUNE n'était servie. Le site lisait `docs/en` en dur. Des contributeurs
// avaient traduit dans le vide, ce que ce module existe pour empêcher.

export const DOC_LANGS = [
  { code: 'en', label: 'English'  },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español'  },
  { code: 'de', label: 'Deutsch'  },
  { code: 'it', label: 'Italiano' },
] as const

export type DocLang = (typeof DOC_LANGS)[number]['code']

export function isDocLang(v: string | undefined): v is DocLang {
  return !!v && DOC_LANGS.some((l) => l.code === v)
}

/** L'anglais vit à la racine, les autres langues sous leur code. */
export function langPrefix(lang: string): string {
  return lang === 'en' ? '' : `/${lang}`
}

/**
 * Sépare la langue du chemin. `/fr/relay` donne `fr` et `relay`, `/relay` donne
 * `en` et `relay`. Utilisé par le layout, qui n'a que l'URL sous la main.
 */
export function splitLangPath(pathname: string): { lang: DocLang; slug: string } {
  const parts = pathname.replace(/^\/+/, '').split('/').filter(Boolean)
  if (parts.length && isDocLang(parts[0])) {
    return { lang: parts[0], slug: parts.slice(1).join('/') || 'readme' }
  }
  return { lang: 'en', slug: parts.join('/') || 'readme' }
}
