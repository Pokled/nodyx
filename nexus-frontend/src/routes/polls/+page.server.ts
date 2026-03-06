import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, url, cookies }) => {
  const token  = cookies.get('token') ?? ''
  const status = url.searchParams.get('status') ?? 'active'
  const offset = Number(url.searchParams.get('offset') ?? '0')

  const params  = new URLSearchParams({ limit: '20', offset: String(offset), status })
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res     = await apiFetch(fetch, `/polls?${params}`, { headers: headers as any })
  const { polls } = res.ok ? await res.json() : { polls: [] }

  return { polls, status, offset, token: token || null }
}
