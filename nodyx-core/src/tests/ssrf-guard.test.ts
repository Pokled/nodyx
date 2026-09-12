// ─── Garde anti-SSRF partagée ────────────────────────────────────────────────
//
// Consolidation de 3 implémentations divergentes (F-055, audit du 11/09/2026).
// Ces tests couvrent les cas qui distinguaient les trois versions avant
// fusion : notation IPv4-mappée-IPv6 hexadécimale (seul chat.ts l'avait),
// multicast/réservé (seul linkPreview.ts l'avait), et le rebinding DNS que
// SEUL directory.ts ne détectait pas (cf tests de directory.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('dns/promises', () => ({
  default: { lookup: vi.fn() },
}))

import dns from 'dns/promises'
import { isPrivateIp, resolveSsrfSafe } from '../utils/ssrfGuard'

describe('isPrivateIp', () => {
  it.each([
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false], // hors plage 172.16-31
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['0.0.0.0', true],
    ['169.254.1.1', true],   // link-local / metadata cloud
    ['100.64.0.1', true],    // CGNAT
    ['8.8.8.8', false],
    ['1.1.1.1', false],
  ])('%s → %s (IPv4)', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected)
  })

  it('détecte le multicast/réservé (>= 224), absent de la version chat.ts avant fusion', () => {
    expect(isPrivateIp('224.0.0.1')).toBe(true)
    expect(isPrivateIp('240.0.0.1')).toBe(true)
  })

  it('détecte une IPv4 encodée en IPv6-mappé, notation décimale', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false)
  })

  it('détecte une IPv4 encodée en IPv6-mappé, notation hexadécimale (::ffff:7f00:1 = 127.0.0.1)', () => {
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true)
  })

  it.each([
    ['::1', true],
    ['fc00::1', true],
    ['fd12::1', true],
    ['fe80::1', true],
    ['2001:db8::1', true], // plage documentation
    ['2001:4860:4860::8888', false], // Google DNS IPv6, publique
  ])('%s → %s (IPv6)', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected)
  })
})

describe('resolveSsrfSafe — anti rebinding DNS', () => {
  beforeEach(() => vi.resetAllMocks())

  it('accepte une IP littérale publique sans DNS', async () => {
    const result = await resolveSsrfSafe('8.8.8.8')
    expect(result).toBe('8.8.8.8')
    expect(dns.lookup).not.toHaveBeenCalled()
  })

  it('rejette une IP littérale privée sans DNS', async () => {
    const result = await resolveSsrfSafe('127.0.0.1')
    expect(result).toBeNull()
    expect(dns.lookup).not.toHaveBeenCalled()
  })

  it("résout un hostname et rejette si l'adresse résolue est privée, même si le nom semble innocent", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: '169.254.169.254', family: 4 } as never)
    const result = await resolveSsrfSafe('metadonnees-cloud-legitimes.example.com')
    expect(result).toBeNull()
  })

  it('résout un hostname public et renvoie son IP RÉSOLUE (pas le hostname), pour usage anti-rebinding', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: '203.0.113.42', family: 4 } as never)
    const result = await resolveSsrfSafe('exemple-instance-federee.org')
    expect(result).toBe('203.0.113.42')
  })

  it('renvoie null proprement si la résolution DNS échoue', async () => {
    vi.mocked(dns.lookup).mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await resolveSsrfSafe('domaine-inexistant.invalid')
    expect(result).toBeNull()
  })
})
