import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCors, { type FastifyCorsOptions } from '@fastify/cors'

// La politique CORS decide PAR REQUETE, et cette distinction est une frontiere
// de securite, pas un reglage de confort.
//
// Une surface d'extension vit dans une iframe a origine opaque : son en-tete
// `Origin` vaut litteralement "null". La politique historique refusait cette
// valeur avec une erreur, donc 500, donc aucune surface ne chargeait son SDK.
// Constate en production le 2026-08-14.
//
// Ce banc reproduit la politique de `src/index.ts` et verifie les deux moities
// de la nuance : ouverte et SANS identifiants sur les routes d'extension,
// inchangee et AVEC identifiants ailleurs.

const APP_ORIGIN = 'https://instance.example'
const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

function checkAppOrigin(origin: string | undefined, cb: (err: Error | null, ok: boolean) => void) {
  if (!origin) return cb(null, true)
  if (origin === APP_ORIGIN) return cb(null, true)
  cb(new Error('CORS: origin non autorisée'), false)
}

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(fastifyCors, () => (req: { url?: string }, cb: (e: Error | null, o: FastifyCorsOptions) => void) => {
    if (req.url?.startsWith('/api/v1/extensions/')) {
      return cb(null, { origin: true, credentials: false, methods: CORS_METHODS })
    }
    cb(null, { origin: checkAppOrigin, credentials: true, methods: CORS_METHODS })
  })
  app.get('/api/v1/extensions/sdk.js', async () => 'sdk')
  app.get('/api/v1/users/me', async () => ({ email: 'prive@example.org' }))
  await app.ready()
  return app
}

describe('routes d extension : une origine opaque doit passer', () => {
  it('repond 200 avec Origin: null, la valeur qu envoie une frame opaque', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/extensions/sdk.js', headers: { origin: 'null' } })
    expect(r.statusCode).toBe(200)
    expect(r.headers['access-control-allow-origin']).toBeTruthy()
    await app.close()
  })

  it('N ENVOIE PAS d identifiants, donc aucun cookie ne circule', async () => {
    // C'est la moitie de la nuance qui rend l'ouverture sure : sans
    // identifiants, une frame hostile n'obtient rien d'authentifie.
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/extensions/sdk.js', headers: { origin: 'null' } })
    expect(r.headers['access-control-allow-credentials']).toBeUndefined()
    await app.close()
  })

  it('repond aussi sans en-tete Origin, pour le rendu serveur et les outils', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/extensions/sdk.js' })
    expect(r.statusCode).toBe(200)
    await app.close()
  })
})

describe('le reste de l API n a pas bouge', () => {
  it('refuse une origine inconnue', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: { origin: 'https://evil.example' } })
    expect(r.statusCode).toBe(500)
    await app.close()
  })

  it('REFUSE Origin: null hors des routes d extension', async () => {
    // Le point qui empeche l'ouverture de devenir une faille : un site hostile
    // qui ouvre une frame en bac a sable ne doit pas atteindre l'API generale.
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: { origin: 'null' } })
    expect(r.statusCode).toBe(500)
    await app.close()
  })

  it('accepte le frontend de l instance, AVEC identifiants', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: { origin: APP_ORIGIN } })
    expect(r.statusCode).toBe(200)
    expect(r.headers['access-control-allow-credentials']).toBe('true')
    await app.close()
  })
})
