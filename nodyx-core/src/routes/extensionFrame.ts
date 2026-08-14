// Le document de frame, et les assets d'une extension.
//
// C'est la seule surface publique du bac à sable. Tout ce qui est servi ici
// est destiné à vivre dans une iframe à origine opaque, montée par l'hôte avec
// `sandbox="allow-scripts"` et rien d'autre.
// cf SPECS/NODYX_SDK_CDC.md §4 et NODYX_SDK_SECURITY.md §4.1

import type { FastifyInstance, FastifyReply } from 'fastify'
import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { rateLimit } from '../middleware/rateLimit'
import { defaultExtensionsDir } from '../extensions/installer'
import { isSafePackagePath } from '../extensions/manifest'
import { PACKAGE } from '../extensions/limits'

/** Types servis, déterminés par le serveur, jamais devinés depuis le contenu. */
const CONTENT_TYPES: Record<string, string> = {
  '.js':    'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.woff2': 'font/woff2',
  '.md':    'text/markdown; charset=utf-8',
}

const RE_ID      = /^[a-z][a-z0-9-]{2,38}$/
const RE_VERSION = /^\d+\.\d+\.\d+$/

/**
 * La politique de sécurité de la frame.
 *
 * L'origine est écrite EN CLAIR : dans une origine opaque, `'self'` ne
 * correspond à rien. `frame-src 'none'` interdit toute iframe imbriquée, donc
 * tout embarquement de tiers, qui passera par une primitive de l'hôte.
 *
 * `style-src-attr 'unsafe-inline'` est délibéré et borné aux attributs
 * `style=""`, qui sont réels dans du code d'interface. Il n'y a PAS de
 * `'unsafe-inline'` dans `style-src` ni dans `script-src` : un nonce le
 * neutraliserait de toute façon, l'écrire ne ferait que masquer l'intention.
 */
export function frameCsp(origin: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' ${origin}`,
    `style-src 'nonce-${nonce}' ${origin}`,
    `style-src-attr 'unsafe-inline'`,
    `img-src ${origin} data: blob:`,
    `media-src ${origin} blob:`,
    `connect-src ${origin}`,
    `frame-src 'none'`,
    `form-action 'none'`,
    `base-uri 'none'`,
  ].join('; ')
}

/** Exporte pour que le banc de confinement teste le DOCUMENT REEL, pas une copie. */
export function frameHtml(nonce: string, csp: string, sdkUrl: string): string {
  // La politique est posée DEUX FOIS, en en-tête et ici.
  //
  // Vérifié sur notre propre production : le proxy pose la politique du site
  // en mode `set`, donc il REMPLACE celle que l'application envoie, y compris
  // sur les réponses d'API. Un en-tête seul serait effacé et la frame
  // hériterait d'une politique permissive, ce qui rouvrirait le réseau sortant
  // direct depuis une extension. Une balise n'est pas réécrite par un proxy, et
  // deux politiques présentes valent leur intersection, donc la plus stricte
  // gagne. Règle générale : une frontière de sécurité ne dépend jamais d'un
  // en-tête qu'un intermédiaire peut réécrire.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nodyx extension surface</title>
<style nonce="${nonce}">
  html, body { margin: 0; padding: 0; background: transparent; }
  #root { min-height: 1px; }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${sdkUrl}"></script>
</body>
</html>`
}

function harden(reply: FastifyReply): FastifyReply {
  return reply
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'no-referrer')
    .header('Cross-Origin-Resource-Policy', 'same-origin')
}

/**
 * Durcissement des ressources que la FRAME doit pouvoir charger.
 *
 * Une frame en origine opaque envoie `Origin: null`, et un script de module,
 * comme tout `import()` dynamique, est recupere en mode CORS. Sans en-tete
 * d'autorisation, le navigateur refuse : le SDK ne se charge pas, et aucune
 * surface ne demarre. `Cross-Origin-Resource-Policy: same-origin` bloque la
 * meme chose une seconde fois, une origine opaque n'etant pas la notre.
 *
 * Ouvrir ces deux en-tetes n'expose rien : ce sont des fichiers statiques
 * publics, deja lisibles par quiconque connait l'URL, et servis sans aucune
 * information d'authentification. Ce qui protege l'instance, c'est le bac a
 * sable et la politique de securite de la frame, pas l'obscurite d'un asset.
 */
function hardenFrameResource(reply: FastifyReply): FastifyReply {
  return reply
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'no-referrer')
    .header('Cross-Origin-Resource-Policy', 'cross-origin')
    .header('Access-Control-Allow-Origin', '*')
}

export async function extensionFrameRoutes(app: FastifyInstance) {
  const root   = defaultExtensionsDir()
  const origin = process.env.FRONTEND_URL?.replace(/\/+$/, '') || 'http://localhost:5173'

  // ── GET /extensions/:id/:version/frame ──────────────────────────────────
  // Le document hôte de la surface. Public : une page d'accueil est vue par
  // des visiteurs, et c'est le jeton, transmis plus tard par le port privé,
  // qui porte l'identité. Rien de sensible n'est rendu ici.
  app.get('/extensions/:id/:version/frame', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string }
    const { surface }     = request.query  as { surface?: string }

    if (!RE_ID.test(id) || !RE_VERSION.test(version)) {
      return harden(reply).code(400).send({ error: 'Invalid extension reference', code: 'INVALID_EXTENSION_REF' })
    }
    if (surface && !/^(page|widget:[a-z][a-z0-9-]{0,30})$/.test(surface)) {
      return harden(reply).code(400).send({ error: 'Invalid surface', code: 'INVALID_SURFACE' })
    }

    const nonce = randomBytes(16).toString('base64')
    const csp   = frameCsp(origin, nonce)

    return harden(reply)
      .header('Content-Security-Policy', csp)
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(frameHtml(nonce, csp, `${origin}/api/v1/extensions/sdk.js`))
  })

  // ── GET /extensions/sdk.js ──────────────────────────────────────────────
  // Le SDK est servi par l'INSTANCE, jamais empaquete par l'auteur : sa version
  // suit celle de Nodyx, donc aucune derive de contrat n'est possible entre une
  // extension et son hote.
  app.get('/extensions/sdk.js', { preHandler: [rateLimit] }, async (_request, reply) => {
    try {
      const source = await fs.readFile(path.join(process.cwd(), 'sdk', 'nodyx-sdk.js'))
      return hardenFrameResource(reply)
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .send(source)
    } catch {
      return harden(reply).code(500).send({ error: 'SDK introuvable', code: 'SDK_MISSING' })
    }
  })

  // ── GET /extensions/:id/:version/assets/* ───────────────────────────────
  // La version est dans le chemin : une mise à jour invalide le cache d'elle
  // même, et une frame ouverte ne mélange jamais deux générations de code.
  app.get('/extensions/:id/:version/assets/*', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string }
    const rel = ((request.params as Record<string, string>)['*'] ?? '').replace(/\\/g, '/')

    if (!RE_ID.test(id) || !RE_VERSION.test(version) || !isSafePackagePath(rel)) {
      return harden(reply).code(400).send({ error: 'Invalid asset reference', code: 'INVALID_ASSET_REF' })
    }

    const ext = path.extname(rel).toLowerCase()
    if (!(PACKAGE.allowedExtensions as readonly string[]).includes(ext)) {
      return harden(reply).code(403).send({ error: 'Asset type not served', code: 'ASSET_TYPE_REFUSED' })
    }

    const versionDir = path.join(root, id, version)
    const target     = path.resolve(versionDir, rel)

    // Ceinture, après la bretelle : même si `isSafePackagePath` régressait, un
    // chemin qui sort du dossier de version ne serait pas servi.
    if (target !== versionDir && !target.startsWith(versionDir + path.sep)) {
      return harden(reply).code(403).send({ error: 'Forbidden', code: 'ASSET_PATH_ESCAPE' })
    }

    let content: Buffer
    try {
      content = await fs.readFile(target)
    } catch {
      return harden(reply).code(404).send({ error: 'Asset not found', code: 'ASSET_NOT_FOUND' })
    }

    const r = hardenFrameResource(reply)
      .header('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
      .header('Cache-Control', 'public, max-age=31536000, immutable')

    // Un SVG est assaini à l'installation, mais il est servi sur notre origine
    // et affiché hors du bac à sable : on le sert inerte, par principe.
    if (ext === '.svg') r.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")

    return r.send(content)
  })
}
