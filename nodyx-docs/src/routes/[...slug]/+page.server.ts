import { error, redirect }     from '@sveltejs/kit'
import { renderDoc, isDocLang, availableDocLangs } from '$lib/docs.server.js'
import type { DocLang }        from '$lib/docs.server.js'
import { findPage, prevNext }  from '$lib/nav.js'

export async function load({ params }) {
  let slug = params.slug || 'readme'

  // Une langue en tête d'URL : /fr/relay, /es/install. La route est déjà un
  // attrape-tout, aucun fichier de route supplémentaire n'est nécessaire.
  // Les URL existantes (/relay) restent inchangées et valent l'anglais.
  let lang: DocLang = 'en'
  const [premier, ...reste] = slug.split('/')
  if (isDocLang(premier) && reste.length > 0) {
    lang = premier
    slug = reste.join('/')
  } else if (isDocLang(premier) && reste.length === 0) {
    // /fr tout seul : la page d'accueil de la documentation, dans cette langue.
    lang = premier
    slug = 'readme'
  }

  // Redirect /FOO.md or /foo.md → /foo (people copy filenames from GitHub)
  if (slug.endsWith('.md')) {
    const base = lang === 'en' ? '' : `/${lang}`
    redirect(301, `${base}/` + slug.slice(0, -3).toLowerCase())
  }

  const doc = await renderDoc(slug, lang)
  if (!doc) error(404, `Documentation page "${slug}" not found`)

  const page   = findPage(slug)
  const pn     = prevNext(slug)

  return {
    slug,
    lang:        doc.lang,
    requested:   doc.requested,
    /** Vrai quand la page n'existe pas encore dans la langue demandée. */
    fallback:    doc.lang !== doc.requested,
    langs:       await availableDocLangs(),
    html:        doc.html,
    headings:    doc.headings,
    title:       page?.title ?? doc.title,
    docTitle:    doc.title,
    description: doc.description,
    readingTime: doc.readingTime,
    prev:        pn.prev,
    next:        pn.next,
  }
}
