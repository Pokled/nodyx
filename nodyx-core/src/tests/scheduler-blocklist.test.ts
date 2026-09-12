// ─── pullBlocklist doit respecter le choix de non-fédération ────────────────
//
// Trouvé en audit de stabilité (F-039, 2026-09-11) : contrairement à
// pingDirectory/pushAssetsToDirectory/announceThreadsToDirectory, pullBlocklist
// n'avait AUCUN garde sur DIRECTORY_TOKEN. Une instance installée sans
// fédération (le cas courant : install.sh ne pose DIRECTORY_TOKEN que si
// l'admin choisit explicitement d'enregistrer son instance) appelait quand
// même nodyx.org toutes les 30 minutes, à vie, via le repli par défaut de
// DIRECTORY_API_URL. Exactement la dépendance cachée que la promesse
// « nodyx.org meurt, pas grave » est censée exclure.
//
// Ces tests tombent sur l'ancien code : sans le garde, fetch est appelé même
// sans token. cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    del:    vi.fn().mockResolvedValue(1),
    sadd:   vi.fn().mockResolvedValue(1),
    rename: vi.fn().mockResolvedValue('OK'),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

import { pullBlocklist } from '../scheduler'

describe('pullBlocklist — respecte le choix de non-fédération', () => {
  const originalEnv = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("n'appelle jamais le réseau quand DIRECTORY_TOKEN est absent (instance non fédérée)", async () => {
    delete process.env.DIRECTORY_TOKEN
    process.env.DIRECTORY_API_URL = 'https://nodyx.org'

    await pullBlocklist()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('appelle bien le réseau quand DIRECTORY_TOKEN est configuré (instance fédérée)', async () => {
    process.env.DIRECTORY_TOKEN = 'tok_test_instance'
    process.env.DIRECTORY_API_URL = 'https://nodyx.org'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ips: [], count: 0 }),
    })

    await pullBlocklist()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/directory/blocklist')
  })
})
