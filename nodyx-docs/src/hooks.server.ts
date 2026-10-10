import type { Handle } from '@sveltejs/kit'

// <html lang> suit la langue RÉELLEMENT servie (10/10/2026). Avant, il valait
// toujours "en", y compris sur les pages françaises et espagnoles : un signal
// faux de plus pour les moteurs et les lecteurs d'écran. La page de doc pose
// `locals.lang` ; les autres pages restent en anglais.
export const handle: Handle = async ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="en"', `<html lang="${event.locals.lang ?? 'en'}"`),
  })
