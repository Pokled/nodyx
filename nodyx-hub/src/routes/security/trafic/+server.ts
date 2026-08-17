// ─── Le rapport GoAccess, servi derriere l'authentification du hub ───────────
//
// POURQUOI UNE ROUTE PLUTOT QU'UN FICHIER STATIQUE. Ce rapport contient les
// ADRESSES DES VISITEURS. Le publier dans `static/` le rendrait accessible a
// quiconque devine l'URL : une fuite de donnees personnelles, sur un service
// dont la promesse est justement de ne pas en faire commerce.
//
// La route herite de la verification du `+layout.server.ts` du hub par le meme
// cookie de session — on la revalide ici explicitement, parce qu'un point de
// terminaison `+server.ts` ne traverse PAS le layout.
//
// POURQUOI PAS LE MODE TEMPS REEL DE GOACCESS. Il ouvre un serveur WebSocket sur
// un port dedie, qu'il faudrait proxifier dans Caddy. Or la configuration Caddy
// vivante de cette machine vient de `autosave.json` et un rechargement fait
// tomber le HTTPS de nodyx.org. Le rapport est donc regenere chaque minute par
// `nodyx-goaccess.timer`, et cette page se rafraichit d'elle-meme.

import { readFileSync, statSync } from 'node:fs'
import { error } from '@sveltejs/kit'
import { validateSession } from '$lib/server/auth.js'
import type { RequestHandler } from './$types'

const RAPPORT = '/var/lib/nodyx-goaccess/rapport.html'

export const GET: RequestHandler = async ({ cookies }) => {
  // Un `+server.ts` ne passe pas par le layout : la verification doit etre ici,
  // sinon le rapport serait public.
  if (!validateSession(cookies.get('hub_session') ?? '')) {
    error(401, 'Authentification requise')
  }

  let html: string
  try {
    html = readFileSync(RAPPORT, 'utf-8')
  } catch {
    // Le minuteur n'a peut-etre pas encore tourne, ou aucune requete n'a encore
    // ete journalisee. On le dit, plutot que de renvoyer une page vide.
    error(503, 'Rapport pas encore genere — le minuteur tourne chaque minute')
  }

  const age = Math.round((Date.now() - statSync(RAPPORT).mtimeMs) / 1000)

  // Rafraichissement automatique : le rapport est regenere chaque minute.
  const html2 = html.replace(
    '<head>',
    `<head><meta http-equiv="refresh" content="60">` +
      `<!-- rapport genere il y a ${age}s, regeneration chaque minute -->`,
  )

  return new Response(html2, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Jamais en cache : les donnees changent chaque minute, et un cache
      // intermediaire conserverait des adresses de visiteurs.
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}
