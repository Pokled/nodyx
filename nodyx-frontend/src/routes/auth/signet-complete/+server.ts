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
    redirect(303, `/auth/login?signet_error=${encodeURIComponent('Paramètres manquants')}`)
  }

  let pubkey: unknown
  try {
    pubkey = JSON.parse(pubkeyRaw)
  } catch {
    redirect(303, `/auth/login?signet_error=${encodeURIComponent('pubkey invalide')}`)
  }

  // Appel interne à nodyx-core — même serveur, zéro CORS
  const apiBase = (PRIVATE_API_SSR_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/api\/v1$/, '')

  let res: Response
  let json: Record<string, unknown>

  try {
    res = await fetch(`${apiBase}/api/auth/challenges/approve-cross`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ signature, challenge, pubkey, deviceId, deviceLabel })
    })
    json = await res.json().catch(() => ({})) as Record<string, unknown>
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Impossible de contacter le serveur'
    redirect(303, `/auth/login?signet_error=${encodeURIComponent(msg)}`)
  }

  if (!res.ok) {
    const msg = (json.error as string) ?? `Erreur ${res.status}`
    redirect(303, `/auth/login?signet_error=${encodeURIComponent(msg)}`)
  }

  const token = json.token as string | undefined
  if (!token) {
    redirect(303, `/auth/login?signet_error=${encodeURIComponent('Token de session manquant')}`)
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
