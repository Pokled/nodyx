import { fail } from '@sveltejs/kit'
import type { Actions } from './$types'
import { apiFetch } from '$lib/api'

export const actions: Actions = {
  default: async ({ fetch, request }) => {
    const form  = await request.formData()
    const email = (form.get('email') as string | null)?.trim()

    if (!email) return fail(400, { error: 'Email requis' })

    const res = await apiFetch(fetch, '/auth/forgot-password', {
      method: 'POST',
      body:   JSON.stringify({ email }),
    })

    if (!res.ok && res.status === 429) {
      return fail(429, { error: 'Trop de tentatives. Réessaie dans 15 minutes.' })
    }

    // Toujours afficher le message de succès (anti-énumération)
    return { sent: true }
  },
}
