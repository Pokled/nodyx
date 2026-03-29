/**
 * GET /auth/signet-complete
 *
 * Point d'atterrissage après le flow cross-instance Nodyx Signet.
 * La PWA Signet redirige ici avec la signature + pubkey dans les paramètres.
 * Validation côté serveur (pas de CORS), pose le cookie, redirige vers /.
 *
 * Params: challenge, signature, pubkey (JSON encodé), deviceId, deviceLabel
 */

import { redirect, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { PRIVATE_API_SSR_URL } from '$env/static/private'

export const GET: RequestHandler = async ({ url, cookies }) => {
  const challenge   = url.searchParams.get('challenge')
  const signature   = url.searchParams.get('signature')
  const pubkeyRaw   = url.searchParams.get('pubkey')
  const deviceId    = url.searchParams.get('deviceId')
  const deviceLabel = url.searchParams.get('deviceLabel') ?? 'Mon appareil'

  if (!challenge || !signature || !pubkeyRaw || !deviceId) {
    throw error(400, 'Paramètres manquants')
  }

  let pubkey: unknown
  try {
    pubkey = JSON.parse(pubkeyRaw)
  } catch {
    throw error(400, 'pubkey invalide')
  }

  // Appel interne à nodyx-core — même serveur, zéro CORS
  const apiBase = (PRIVATE_API_SSR_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/api\/v1$/, '')

  const res = await fetch(`${apiBase}/api/auth/challenges/approve-cross`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ signature, challenge, pubkey, deviceId, deviceLabel })
  })

  const json = await res.json().catch(() => ({})) as Record<string, unknown>

  if (!res.ok) {
    throw error(res.status as 400 | 401 | 404 | 429 | 500, (json.error as string) ?? `Erreur ${res.status}`)
  }

  const token = json.token as string | undefined
  if (!token) {
    throw error(500, 'Token de session manquant')
  }

  // Poser le cookie httpOnly exactement comme le login classique
  cookies.set('token', token, {
    path:     '/',
    httpOnly: true,
    sameSite: 'lax',
    secure:   true,
    maxAge:   60 * 60 * 24 * 7
  })

  redirect(303, '/')
}
