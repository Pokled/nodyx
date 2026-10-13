import type { Handle } from '@sveltejs/kit'

// <html lang> suit la langue de l'adresse : /fr sert le français, le reste l'anglais.
export const handle: Handle = async ({ event, resolve }) => {
  const lang = event.url.pathname === '/fr' || event.url.pathname.startsWith('/fr/') ? 'fr' : 'en'
  return resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', lang) })
}
