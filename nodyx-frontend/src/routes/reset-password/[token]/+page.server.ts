import { error, fail, redirect } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, params }) => {
  const res = await apiFetch(fetch, `/auth/verify-reset/${params.token}`)

  if (!res.ok) {
    error(400, {
      message: 'Ce lien de réinitialisation est invalide ou a expiré. Fais une nouvelle demande.',
    })
  }

  const { username } = await res.json()
  return { username, token: params.token }
}

export const actions: Actions = {
  default: async ({ fetch, request, params }) => {
    const form     = await request.formData()
    const password = form.get('password')  as string | null
    const confirm  = form.get('confirm')   as string | null

    if (!password || password.length < 8) {
      return fail(400, { error: 'Le mot de passe doit contenir au moins 8 caractères.' })
    }
    if (password !== confirm) {
      return fail(400, { error: 'Les mots de passe ne correspondent pas.' })
    }

    const res = await apiFetch(fetch, `/auth/reset-password/${params.token}`, {
      method: 'POST',
      body:   JSON.stringify({ password }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      return fail(res.status, {
        error: json.error ?? 'Le lien a expiré. Fais une nouvelle demande.',
      })
    }

    redirect(303, '/auth/login?reset=1')
  },
}
