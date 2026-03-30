import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  let instanceCount: number | null = null
  try {
    const r = await fetch('https://nodyx.org/api/directory')
    if (r.ok) {
      const d = await r.json()
      instanceCount = d.total ?? (Array.isArray(d.instances) ? d.instances.length : null)
    }
  } catch { /* ignore — static fallback */ }
  return { instanceCount }
}
