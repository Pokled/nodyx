// ─── pushAssetsToDirectory doit viser l'annuaire, pas l'instance elle-même ──
//
// Trouvé pendant la vérification de la sortie 2.13.0 (29/10/2026) : sur
// sleemstudio et vieuxlooters, « Assets push failed: HTTP 403 » toutes les
// heures, depuis au moins mars. Le ping vers l'annuaire visait
// DIRECTORY_API_URL (https://nodyx.org), l'envoi des ressources visait
// SELF_URL : chaque instance secondaire s'envoyait ses ressources à
// elle-même, et son propre coeur refusait le jeton. Sur nodyx.org, qui EST
// l'annuaire, ça marchait par coïncidence.
//
// Ce test tombe sur l'ancien code (fetch appelé sur http://127.0.0.1:3003).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {},
}))

import { db } from '../config/database'
import { pushAssetsToDirectory } from '../scheduler'

const ASSET = {
  id: 'a1', asset_type: 'banner', name: 'Bannière', description: null, tags: [],
  file_hash: 'h', file_path: '/uploads/a.png', thumbnail_path: null, file_size: 10,
  mime_type: 'image/png', downloads: 0,
}

describe('pushAssetsToDirectory : vise l’annuaire', () => {
  const originalEnv = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [ASSET], rowCount: 1 } as any)
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ upserted: 1, skipped: 0 }), { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => { process.env = { ...originalEnv } })

  it('instance secondaire (configuration réelle de vieuxlooters) : envoie à DIRECTORY_API_URL', async () => {
    process.env.DIRECTORY_TOKEN = 'jeton'
    process.env.DIRECTORY_API_URL = 'https://nodyx.org'
    process.env.SELF_URL = 'http://127.0.0.1:3003'
    await pushAssetsToDirectory()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://nodyx.org/api/directory/assets')
  })

  it('l’annuaire lui-même (nodyx.org, sans DIRECTORY_API_URL) : envoie à SELF_URL, comme le ping', async () => {
    process.env.DIRECTORY_TOKEN = 'jeton'
    delete process.env.DIRECTORY_API_URL
    process.env.SELF_URL = 'http://127.0.0.1:3000'
    await pushAssetsToDirectory()
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/directory/assets')
  })

  it('instance non fédérée (sans jeton) : aucun appel réseau', async () => {
    delete process.env.DIRECTORY_TOKEN
    process.env.DIRECTORY_API_URL = 'https://nodyx.org'
    await pushAssetsToDirectory()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
