/**
 * Tests du bundle applicatif d'une activité (extensions/appBundle.ts).
 *
 * On passe les octets en `uploaded` pour ne pas toucher le réseau : le chemin
 * de téléchargement (guardedLookup) est un détail d'infra, la vérification
 * d'empreinte et les défenses d'extraction sont le cœur.
 * Cf SPECS/NODYX_ACTIVITIES_CDC.md §2.3, §7.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import AdmZip from 'adm-zip'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { fetchAndUnpackAppBundle, extractAppBundleTo, resolveGuarded } from '../extensions/appBundle'
import { validateManifest, type ExtensionManifest } from '../extensions/manifest'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

function bundle(files: Record<string, string>): Buffer {
  const zip = new AdmZip()
  for (const [p, c] of Object.entries(files)) zip.addFile(p, Buffer.from(c, 'utf8'))
  return zip.toBuffer()
}

function manifestWith(app: Record<string, unknown>): ExtensionManifest {
  const r = validateManifest({
    api: 1, id: 'kings-race', version: '0.3.0', license: 'MIT', default_locale: 'en',
    label: '@label', description: '@description',
    surfaces: [{ type: 'activity', id: 'battle', entry: 'index.html', label: '@label' }],
    app,
  })
  if (!r.ok) throw new Error('manifeste de test invalide : ' + JSON.stringify(r.issues))
  return r.manifest
}

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodyx-app-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('fetchAndUnpackAppBundle', () => {
  const GOOD = () => bundle({
    'index.html': '<!doctype html><script src="index.js"></script>',
    'index.js':   'console.log(1)',
    'index.wasm': 'fake-wasm-bytes',
  })

  it('empreinte correcte → décompressé sous app/, entry présent', async () => {
    const b = GOOD()
    const r = await fetchAndUnpackAppBundle(
      manifestWith({ url: 'https://cdn.example/app.zip', sha256: sha(b), bytes: b.length }),
      dir, { uploaded: b },
    )
    expect(r.ok).toBe(true)
    expect(await fs.readFile(path.join(dir, 'app', 'index.wasm'), 'utf8')).toBe('fake-wasm-bytes')
  })

  it('empreinte fausse → APP_CHECKSUM_MISMATCH, rien écrit', async () => {
    const b = GOOD()
    const r = await fetchAndUnpackAppBundle(
      manifestWith({ url: 'https://cdn.example/app.zip', sha256: 'f'.repeat(64), bytes: b.length }),
      dir, { uploaded: b },
    )
    expect(r.ok).toBe(false)
    expect(r.issues.map(i => i.code)).toContain('APP_CHECKSUM_MISMATCH')
    await expect(fs.access(path.join(dir, 'app'))).rejects.toThrow()
  })

  it('entry absent du bundle → APP_ENTRY_MISSING', async () => {
    const b = bundle({ 'autre.html': 'x', 'index.js': 'y' })
    const r = await fetchAndUnpackAppBundle(
      manifestWith({ url: 'https://cdn.example/app.zip', sha256: sha(b), bytes: b.length }),
      dir, { uploaded: b },
    )
    expect(r.ok).toBe(false)
    expect(r.issues.map(i => i.code)).toContain('APP_ENTRY_MISSING')
  })

  it('manifeste sans app → no-op réussi', async () => {
    const m = { ...manifestWith({ url: 'https://cdn.example/a.zip', sha256: 'a'.repeat(64), bytes: 1 }) }
    delete (m as { app?: unknown }).app
    const r = await fetchAndUnpackAppBundle(m as ExtensionManifest, dir)
    expect(r.ok).toBe(true)
  })
})

describe('extractAppBundleTo : défenses', () => {
  it('zip-slip refusé', async () => {
    const zip = new AdmZip()
    zip.addFile('index.html', Buffer.from('ok'))
    zip.addFile('placeholder.js', Buffer.from('pwned'))
    // adm-zip normalise `../` à l'ajout : on réécrit l'entrée après coup.
    zip.getEntries().find(e => e.entryName === 'placeholder.js')!.entryName = '../../../tmp/pwn.js'
    const r = await extractAppBundleTo(zip.toBuffer(), path.join(dir, 'app'))
    expect(r.ok).toBe(false)
    expect(r.issues.map(i => i.code)).toContain('APP_UNSAFE_PATH')
    await expect(fs.access(path.join(dir, '..', '..', '..', 'tmp', 'pwn.js'))).rejects.toThrow()
  })

  it('type de fichier hors liste blanche → ignoré, pas fatal', async () => {
    const zip = new AdmZip()
    zip.addFile('index.html', Buffer.from('ok'))
    zip.addFile('run.sh', Buffer.from('#!/bin/sh'))
    const r = await extractAppBundleTo(zip.toBuffer(), path.join(dir, 'app'))
    expect(r.ok).toBe(true)
    expect(r.files).toEqual(['index.html'])
    await expect(fs.access(path.join(dir, 'app', 'run.sh'))).rejects.toThrow()
  })

  it('zip illisible → APP_BUNDLE_UNREADABLE', async () => {
    const r = await extractAppBundleTo(Buffer.from('pas un zip'), path.join(dir, 'app'))
    expect(r.ok).toBe(false)
    expect(r.issues.map(i => i.code)).toContain('APP_BUNDLE_UNREADABLE')
  })
})

describe('resolveGuarded : garde SSRF (redirection incluse)', () => {
  it('refuse la boucle locale, meme en dev', async () => {
    await expect(resolveGuarded('127.0.0.1', true)).rejects.toThrow()
  })

  it('refuse les metadonnees d hebergeur (169.254.169.254)', async () => {
    await expect(resolveGuarded('169.254.169.254', true)).rejects.toThrow()
  })

  it('refuse une adresse privee sans accord', async () => {
    await expect(resolveGuarded('10.0.0.5', false)).rejects.toThrow()
  })

  it('accepte une adresse privee AVEC accord (instance intranet)', async () => {
    await expect(resolveGuarded('10.0.0.5', true)).resolves.toBe('10.0.0.5')
  })
})
