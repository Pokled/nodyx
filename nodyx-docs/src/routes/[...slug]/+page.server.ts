import { error, redirect }     from '@sveltejs/kit'
import { renderDoc }           from '$lib/docs.server.js'
import { findPage, prevNext }  from '$lib/nav.js'

export async function load({ params }) {
  let slug = params.slug || 'readme'

  // Redirect /FOO.md or /foo.md → /foo (people copy filenames from GitHub)
  if (slug.endsWith('.md')) {
    redirect(301, '/' + slug.slice(0, -3).toLowerCase())
  }

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
