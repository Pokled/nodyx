import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'

// Faille du 11/11/2026 : le webhook d'OctoGuard POSTait vers n'importe quelle
// adresse (127.0.0.1:2019 = l'API d'administration de Caddy, partagée par toutes
// les instances du serveur : POST /stop éteint tout), et la recopie des images
// collées dans le forum allait chercher n'importe quelle adresse donnée par un
// membre. Ici un VRAI serveur écoute sur 127.0.0.1 : il ne doit rien recevoir,
// quelle que soit la façon d'écrire l'adresse.

import { classifyIp, checkOutboundUrl, safeRequest, OutboundBlocked } from '../utils/ssrfGuard'
import { rehostExternalImages } from '../services/inlineImageRehost'

let server: http.Server
let port = 0
let hits = 0
beforeAll(async () => {
  server = http.createServer((_req, res) => { hits++; res.writeHead(200, { 'content-type': 'image/png' }); res.end('x') })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

describe('classer une adresse', () => {
  it.each([
    ['127.0.0.1', 'forbidden'], ['127.8.9.10', 'forbidden'], ['0.0.0.0', 'forbidden'], ['::1', 'forbidden'], ['::', 'forbidden'],
    ['169.254.169.254', 'forbidden'],            // métadonnées des hébergeurs
    ['::ffff:127.0.0.1', 'forbidden'], ['::ffff:7f00:1', 'forbidden'],   // IPv4 emballée
    ['64:ff9b::7f00:1', 'forbidden'], ['64:ff9b::127.0.0.1', 'forbidden'], ['2002:7f00:1::', 'forbidden'],   // NAT64, 6to4
    ['fe80::1', 'forbidden'], ['224.0.0.1', 'forbidden'], ['255.255.255.255', 'forbidden'],
    ['10.0.0.1', 'private'], ['172.16.5.4', 'private'], ['192.168.1.10', 'private'], ['100.64.0.1', 'private'], ['fd00::1', 'private'],
    ['8.8.8.8', 'public'], ['1.1.1.1', 'public'], ['172.32.0.1', 'public'], ['2606:4700:4700::1111', 'public'],
    ['pas-une-ip', 'forbidden'],
  ])('%s → %s', (ip, expected) => {
    expect(classifyIp(ip)).toBe(expected)
  })
})

describe('vérifier une adresse à l’enregistrement', () => {
  const code = async (url: string, allowPrivate = false) => {
    try { await checkOutboundUrl(url, { allowPrivate }); return 'OK' } catch (e) { return e instanceof OutboundBlocked ? e.code : String(e) }
  }
  it('l’API d’administration de Caddy, sous toutes ses formes : refusée', async () => {
    for (const u of ['http://127.0.0.1:2019/stop', 'http://localhost:2019/stop', 'http://LOCALHOST:2019/', 'http://foo.localhost/',
      'http://2130706433:2019/stop', 'http://0x7f.1:2019/', 'http://127.1:2019/', 'http://[::1]:2019/', 'http://[::ffff:127.0.0.1]:2019/', 'http://0.0.0.0:2019/']) {
      expect([u, await code(u)]).toEqual([u, 'URL_FORBIDDEN'])
    }
  })
  it('les métadonnées d’un hébergeur : refusées, même réseau local permis', async () => {
    expect(await code('http://169.254.169.254/latest/meta-data/', true)).toBe('URL_FORBIDDEN')
    expect(await code('http://127.0.0.1/', true)).toBe('URL_FORBIDDEN')
  })
  it('le réseau local : refusé par défaut, permis seulement si l’admin du serveur l’a choisi (D36)', async () => {
    expect(await code('http://192.168.1.10:8080/ntfy')).toBe('URL_FORBIDDEN')
    expect(await code('http://192.168.1.10:8080/ntfy', true)).toBe('OK')
  })
  it('autre chose que http(s), ou un mot de passe dans l’adresse : refusé', async () => {
    expect(await code('ftp://example.com/')).toBe('URL_INVALID')
    expect(await code('file:///etc/passwd')).toBe('URL_INVALID')
    expect(await code('http://user:pass@example.com/')).toBe('URL_INVALID')
    expect(await code('pas une adresse')).toBe('URL_INVALID')
  })
  it('une adresse publique écrite en chiffres : acceptée', async () => {
    expect(await code('https://1.1.1.1/')).toBe('OK')
  })
})

describe('la requête elle-même : le serveur local ne reçoit RIEN', () => {
  it('ni par l’IP, ni par « localhost », ni en POST (webhook), ni en GET (image)', async () => {
    hits = 0
    for (const u of [`http://127.0.0.1:${port}/stop`, `http://localhost:${port}/stop`, `http://[::ffff:127.0.0.1]:${port}/`]) {
      await expect(safeRequest(u, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(OutboundBlocked)
      await expect(safeRequest(u, { allowPrivate: true })).rejects.toBeInstanceOf(OutboundBlocked)
    }
    expect(hits).toBe(0)
  })
  it('une image collée dans le forum qui pointe vers le serveur : pas recopiée, et rien n’est parti', async () => {
    hits = 0
    const r = await rehostExternalImages(`<p>regarde</p><img src="http://127.0.0.1:${port}/a.png"><img src="http://localhost:${port}/b.png">`)
    expect(hits).toBe(0)
    expect(r.rehosted).toBe(0)
    expect(r.failed.map(f => f.reason)).toEqual(['forbidden_address', 'forbidden_address'])
  })
})
