import { error }               from '@sveltejs/kit'
import { renderDoc }           from '$lib/docs.server.js'
import { findPage, prevNext }  from '$lib/nav.js'

export async function load({ params }) {
  const slug = params.slug || 'readme'

  const doc = await renderDoc(slug)
  if (!doc) error(404, `Documentation page "${slug}" not found`)

  const page   = findPage(slug)
  const pn     = prevNext(slug)

  return {
    slug,
    html:     doc.html,
    headings: doc.headings,
    title:    page?.title ?? doc.title,
    docTitle: doc.title,
    prev:     pn.prev,
    next:     pn.next,
  }
}
