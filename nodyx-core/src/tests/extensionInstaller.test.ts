import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import AdmZip from 'adm-zip'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { installExtension, uninstallExtension, type QueryFn } from '../extensions/installer'
import { requestedCapabilities, sensitiveCapabilities, applyGrant } from '../extensions/capabilities'
import { validateManifest, type ExtensionManifest } from '../extensions/manifest'

const MANIFEST = {
  api: 1,
  id: 'demo-ext',
  version: '1.0.0',
  license: 'MIT',
  default_locale: 'en',
  label: '@label',
  description: '@description',
  surfaces: [{ type: 'widget', id: 'main', entry: 'ui/widget.js', label: '@label' }],
}

function zipOf(manifest: unknown = MANIFEST, extra: Record<string, string> = {}): Buffer {
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
  zip.addFile('i18n/en.json',  Buffer.from(JSON.stringify({ label: 'Demo', description: 'Une demo.' })))
  zip.addFile('ui/widget.js',  Buffer.from('export function mount() {}'))
  for (const [p, c] of Object.entries(extra)) zip.addFile(p, Buffer.from(c))
  return zip.toBuffer()
}

function parse(m: unknown): ExtensionManifest {
  const r = validateManifest(m)
  if (!r.ok) throw new Error('manifeste de test invalide : ' + JSON.stringify(r.issues))
  return r.manifest
}

let dir: string
let query: QueryFn & ReturnType<typeof vi.fn>

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodyx-ext-'))
  query = vi.fn().mockResolvedValue({ rows: [] }) as never
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('installation', () => {
  it('pose les fichiers dans un dossier par version et enregistre', async () => {
    const r = await installExtension({ archive: zipOf(), origin: 'file', installedBy: 'user-1' }, { query, dir })
    if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues))

    expect(r.result.dir).toBe(path.join(dir, 'demo-ext', '1.0.0'))
    expect(await fs.readFile(path.join(r.result.dir, 'ui/widget.js'), 'utf8')).toContain('mount')
    expect(await fs.readFile(path.join(r.result.dir, 'manifest.json'), 'utf8')).toContain('demo-ext')

    expect(query).toHaveBeenCalledOnce()
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('INSERT INTO installed_extensions')
    expect(params[0]).toBe('demo-ext')
    expect(params[3]).toBe('1.0.0')
    expect(params[4]).toBe('file')
    expect(params[5]).toHaveLength(64)              // sha256 de l'archive
  })

  it('ne laisse aucun dossier temporaire derrière elle', async () => {
    await installExtension({ archive: zipOf(), origin: 'file' }, { query, dir })
    const entries = await fs.readdir(path.join(dir, 'demo-ext'))
    expect(entries).toEqual(['1.0.0'])
  })

  it('installe deux versions côte à côte, sans qu elles se marchent dessus', async () => {
    await installExtension({ archive: zipOf(), origin: 'file' }, { query, dir })
    await installExtension({ archive: zipOf({ ...MANIFEST, version: '1.1.0' }), origin: 'file' }, { query, dir })
    const entries = (await fs.readdir(path.join(dir, 'demo-ext'))).sort()
    expect(entries).toEqual(['1.0.0', '1.1.0'])
  })

  it('remplace proprement une réinstallation de la même version', async () => {
    await installExtension({ archive: zipOf(MANIFEST, { 'data/a.json': '{"v":1}' }) }, { query, dir } as never)
    await installExtension({ archive: zipOf(MANIFEST, { 'data/b.json': '{"v":2}' }), origin: 'file' }, { query, dir })
    const files = await fs.readdir(path.join(dir, 'demo-ext', '1.0.0', 'data'))
    expect(files).toEqual(['b.json'])                // l'ancien contenu ne survit pas
  })

  it('n écrit rien en base quand le paquet est refusé', async () => {
    const r = await installExtension({ archive: Buffer.from('pas un zip'), origin: 'file' }, { query, dir })
    expect(r.ok).toBe(false)
    expect(query).not.toHaveBeenCalled()
    await expect(fs.readdir(dir)).resolves.toEqual([])
  })

  it('remonte ce qui a été retiré d un SVG', async () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0h1v1H0z"/></svg>'
    const r = await installExtension({ archive: zipOf({ ...MANIFEST, icon: 'icon.svg' }, { 'icon.svg': evil }), origin: 'file' }, { query, dir })
    if (!r.ok) throw new Error('refusé à tort')
    expect(r.result.sanitized['icon.svg']).toContain('<script>')
    expect(await fs.readFile(path.join(r.result.dir, 'icon.svg'), 'utf8')).not.toContain('script')
  })
})

describe('désinstallation', () => {
  it('efface la base d abord, puis le disque', async () => {
    await installExtension({ archive: zipOf(), origin: 'file' }, { query, dir })
    query.mockClear()

    await uninstallExtension('demo-ext', { query, dir })

    expect(query.mock.calls[0][0]).toContain('DELETE FROM installed_extensions')
    await expect(fs.readdir(path.join(dir, 'demo-ext'))).rejects.toThrow()
  })
})

describe('capacités : le manifeste demande, l admin accorde', () => {
  const full = parse({
    ...MANIFEST,
    permissions: {
      identity: ['id', 'username'],
      storage: { user: '1mb', instance: '2mb', instance_write: true },
      core: ['members:read'],
      network: {
        'api.themoviedb.org': { methods: ['GET'], paths: ['/3/'] },
        '10.0.0.5':           { methods: ['GET'], paths: ['/api'] },
      },
    },
  })

  it('traduit les permissions en capacités plates', () => {
    expect(requestedCapabilities(full)).toEqual([
      'core:members:read',
      'identity', 'identity:id', 'identity:username',
      'net:10.0.0.5', 'net:api.themoviedb.org',
      'storage.instance.read', 'storage.instance.write', 'storage.user',
    ])
  })

  it('isole ce qui exige un consentement distinct', () => {
    expect(sensitiveCapabilities(full)).toEqual(['net:10.0.0.5', 'storage.instance.write'])
  })

  it('un manifeste sans permission ne demande rien', () => {
    expect(requestedCapabilities(parse(MANIFEST))).toEqual([])
    expect(sensitiveCapabilities(parse(MANIFEST))).toEqual([])
  })

  it('realtime est une capacité demandée ET sensible', () => {
    const act = parse({
      ...MANIFEST,
      surfaces: [{ type: 'activity', id: 'battle', entry: 'index.html', label: '@label' }],
      app: { url: 'https://cdn.example/app.zip', sha256: 'c'.repeat(64), bytes: 999 },
      permissions: { identity: ['username'], realtime: true },
    })
    expect(requestedCapabilities(act)).toContain('realtime')
    expect(sensitiveCapabilities(act)).toContain('realtime')
  })

  it('sans décision, tout ce qui est demandé est accordé', () => {
    const { granted, denied } = applyGrant(full)
    expect(granted).toEqual(requestedCapabilities(full))
    expect(denied).toEqual([])
  })

  it('un refus partiel se lit dans le résultat, il n échoue pas plus tard', () => {
    const { granted, denied } = applyGrant(full, { accept: ['identity', 'identity:id', 'storage.user'] })
    expect(granted).toEqual(['identity', 'identity:id', 'storage.user'])
    expect(denied).toContain('net:10.0.0.5')
    expect(denied).toContain('storage.instance.write')
  })

  it('accorder ce qui n a pas été demandé n élargit rien', () => {
    // Sinon l'écran de permissions cesserait d'être la vérité.
    const { granted } = applyGrant(full, { accept: ['storage.user', 'core:forum:read', 'net:evil.example'] })
    expect(granted).toEqual(['storage.user'])
  })

  it('les capacités accordées sont enregistrées telles quelles', async () => {
    const manifest = { ...MANIFEST, permissions: { identity: ['id'], storage: { user: '1mb' } } }
    await installExtension(
      { archive: zipOf(manifest), origin: 'file', grant: { accept: ['identity', 'identity:id'] } },
      { query, dir },
    )
    const granted = JSON.parse(query.mock.calls[0][1][6] as string)
    expect(granted).toEqual(['identity', 'identity:id'])
    expect(granted).not.toContain('storage.user')     // demandé, mais non accordé
  })
})
