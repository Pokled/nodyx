import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { readExtensionPackage } from '../extensions/package'
import { sanitizeSvg, SvgRejected } from '../extensions/svg'

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

const EN = { label: 'Demo', description: 'A demo extension.' }
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'

interface BuildOpts {
  manifest?: unknown
  en?: unknown
  files?: Record<string, string | Buffer>
  omit?: string[]
}

function build(opts: BuildOpts = {}): Buffer {
  const zip = new AdmZip()
  const put = (p: string, c: string | Buffer) => {
    if (opts.omit?.includes(p)) return
    zip.addFile(p, Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8'))
  }
  put('manifest.json', JSON.stringify(opts.manifest ?? MANIFEST, null, 2))
  put('i18n/en.json',  JSON.stringify(opts.en ?? EN))
  put('ui/widget.js',  'export function mount({ root, nodyx }) { root.textContent = nodyx.t("label") }')
  for (const [p, c] of Object.entries(opts.files ?? {})) put(p, c)
  return zip.toBuffer()
}

function codes(buf: Buffer): string[] {
  const r = readExtensionPackage(buf)
  return r.ok ? [] : r.issues.map(i => i.code)
}

describe('paquet valide', () => {
  it('lit un paquet minimal', () => {
    const r = readExtensionPackage(build())
    if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues, null, 2))
    expect(r.pkg.manifest.id).toBe('demo-ext')
    expect(r.pkg.messages.en.label).toBe('Demo')
    expect(r.pkg.files.map(f => f.path).sort()).toEqual(['i18n/en.json', 'manifest.json', 'ui/widget.js'])
  })

  it('ignore un fichier de type non autorisé sans faire échouer l installation', () => {
    const r = readExtensionPackage(build({ files: { 'notes.txt': 'coucou', 'build.sh': '#!/bin/sh' } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pkg.files.some(f => f.path.endsWith('.sh') || f.path.endsWith('.txt'))).toBe(false)
  })

  it('remonte les hôtes privés pour que l admin les voie à part', () => {
    const m = { ...MANIFEST, permissions: { network: { '10.0.0.5': { methods: ['GET'], paths: ['/api'] } } } }
    const r = readExtensionPackage(build({ manifest: m }))
    if (!r.ok) throw new Error('refusé à tort')
    expect(r.pkg.privateNetworkHosts).toEqual(['10.0.0.5'])
  })

  it('accepte une activité SANS aucun JS (le code vit dans le bundle app)', () => {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      ...MANIFEST,
      icon: 'icon.svg',
      surfaces: [{ type: 'activity', id: 'battle', entry: 'index.html', label: '@label' }],
      app: { url: 'https://cdn.example/app.zip', sha256: 'b'.repeat(64), bytes: 12345 },
      permissions: { identity: ['username'], realtime: true },
    })))
    zip.addFile('i18n/en.json', Buffer.from(JSON.stringify(EN)))
    zip.addFile('icon.svg', Buffer.from(ICON))
    const r = readExtensionPackage(zip.toBuffer())
    if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues, null, 2))
    expect(r.pkg.files.map(f => f.path).sort()).toEqual(['i18n/en.json', 'icon.svg', 'manifest.json'])
  })
})

describe('structure du paquet', () => {
  it('refuse une archive sans manifeste et explique le piège du sous-dossier', () => {
    const zip = new AdmZip()
    zip.addFile('demo-ext/manifest.json', Buffer.from(JSON.stringify(MANIFEST)))
    const r = readExtensionPackage(zip.toBuffer())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues[0].code).toBe('MANIFEST_MISSING')
    expect(r.issues[0].message).toContain('sous-dossier')
  })

  it('refuse un manifeste au JSON malformé', () => {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from('{ "api": 1, '))
    expect(codes(zip.toBuffer())).toContain('MANIFEST_MALFORMED')
  })

  it('refuse ce qui n est pas un zip', () => {
    expect(codes(Buffer.from('bonjour'))).toContain('ARCHIVE_UNREADABLE')
  })

  it('refuse un point d entrée déclaré mais absent', () => {
    expect(codes(build({ omit: ['ui/widget.js'] }))).toContain('ENTRY_MISSING')
  })

  it('refuse une icône déclarée mais absente', () => {
    expect(codes(build({ manifest: { ...MANIFEST, icon: 'icon.svg' } }))).toContain('ICON_MISSING')
  })
})

describe('défenses d extraction', () => {
  it('refuse une remontée de chemin, le zip slip', () => {
    // adm-zip normalise les remontées à l'ajout, donc on force le nom d'entrée
    // après coup : c'est exactement ce que contient une archive fabriquée pour
    // sortir du dossier de destination.
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(MANIFEST)))
    zip.addFile('ui/widget.js', Buffer.from('export function mount() {}'))
    zip.addFile('placeholder.json', Buffer.from('{}'))
    zip.getEntries().find(e => e.entryName === 'placeholder.json')!.entryName = '../../../etc/cron.d/pwn.json'
    expect(codes(zip.toBuffer())).toContain('UNSAFE_PATH')
  })

  it('refuse un chemin absolu', () => {
    // adm-zip normalise la barre oblique de tête à l'ajout : on force le nom
    // d'entrée après coup, comme le ferait une archive fabriquée à la main.
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(MANIFEST)))
    zip.addFile('ui/widget.js', Buffer.from('export function mount() {}'))
    zip.addFile('placeholder.json', Buffer.from('{}'))
    zip.getEntries().find(e => e.entryName === 'placeholder.json')!.entryName = '/etc/passwd.json'
    expect(codes(zip.toBuffer())).toContain('UNSAFE_PATH')
  })

  it('refuse un chemin à antislash, remontée à la mode Windows', () => {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(MANIFEST)))
    zip.addFile('ui/widget.js', Buffer.from('export function mount() {}'))
    zip.addFile('placeholder.json', Buffer.from('{}'))
    zip.getEntries().find(e => e.entryName === 'placeholder.json')!.entryName = '..\\..\\evil.json'
    expect(codes(zip.toBuffer())).toContain('UNSAFE_PATH')
  })

  it('refuse un lien symbolique, avant même de le lire', () => {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(MANIFEST)))
    zip.addFile('secrets.json', Buffer.from('/etc/shadow'))
    const entry = zip.getEntries().find(e => e.entryName === 'secrets.json')!
    entry.header.attr = (0xa1ff << 16) >>> 0            // S_IFLNK
    expect(codes(zip.toBuffer())).toContain('SYMLINK_REFUSED')
  })

  it('refuse une arborescence trop profonde', () => {
    expect(codes(build({ files: { 'a/b/c/d/e/f/g/deep.json': '{}' } }))).toContain('PATH_TOO_DEEP')
  })

  it('refuse un fichier au dessus du plafond', () => {
    expect(codes(build({ files: { 'data/big.json': Buffer.alloc(9 * 1024 * 1024, 0x41) } }))).toContain('FILE_TOO_LARGE')
  })

  it('refuse une bombe de décompression', () => {
    // 4 Mo de zéros se compressent à quelques kilo-octets : ratio énorme.
    expect(codes(build({ files: { 'data/bomb.json': Buffer.alloc(4 * 1024 * 1024, 0) } }))).toContain('COMPRESSION_RATIO')
  })
})

describe('traductions', () => {
  it('refuse un paquet sans dictionnaire pour la locale par défaut', () => {
    expect(codes(build({ omit: ['i18n/en.json'] }))).toContain('DEFAULT_BUNDLE_MISSING')
  })

  it('refuse une clé référencée par le manifeste mais absente du dictionnaire', () => {
    const r = readExtensionPackage(build({ en: { label: 'Demo' } }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    const issue = r.issues.find(i => i.code === 'MESSAGE_KEY_MISSING')
    expect(issue).toBeDefined()
    expect(issue!.message).toContain('description')
  })

  it('refuse un dictionnaire imbriqué, les clés sont plates', () => {
    expect(codes(build({ en: { label: 'Demo', description: 'x', nav: { label: 'y' } } }))).toContain('BUNDLE_NOT_FLAT')
  })

  it('accepte des locales supplémentaires, même incomplètes', () => {
    const r = readExtensionPackage(build({ files: { 'i18n/fr.json': JSON.stringify({ label: 'Démo' }) } }))
    if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues))
    expect(r.pkg.messages.fr.label).toBe('Démo')
  })
})

describe('assainissement SVG, la XSS hors du bac à sable', () => {
  it('conserve un SVG sain tel quel', () => {
    const { svg, stripped } = sanitizeSvg(ICON)
    expect(svg).toContain('<path')
    expect(stripped).toEqual([])
  })

  it.each([
    ['<script>', `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('//evil')</script><path d="M0 0h1v1H0z"/></svg>`],
    ['attributs de gestionnaire on*', `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z" onload="alert(1)"/></svg>`],
    ['<foreignObject>', `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(1)"></body></foreignObject><path d="M0 0h1v1H0z"/></svg>`],
    ['références externes', `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/pixel.png"/><path d="M0 0h1v1H0z"/></svg>`],
  ])('retire %s et le signale', (label, raw) => {
    const { svg, stripped } = sanitizeSvg(raw)
    expect(stripped).toContain(label)
    expect(svg).not.toMatch(/<script|on[a-z]+\s*=|foreignObject|<image|javascript:/i)
    // Seule URL tolérée : la déclaration d'espace de noms SVG.
    for (const url of svg.match(/https?:\/\/[^"']+/gi) ?? []) {
      expect(url).toBe('http://www.w3.org/2000/svg')
    }
    expect(svg).toContain('<path')
  })

  it('refuse plutôt que de servir un SVG vidé de sa substance', () => {
    expect(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toThrow(SvgRejected)
  })

  it('refuse un fichier qui n est pas un SVG', () => {
    expect(() => sanitizeSvg('<html><body>coucou</body></html>')).toThrow(SvgRejected)
  })

  it('assainit le SVG DANS le paquet, et remonte ce qui a été retiré', () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0h1v1H0z"/></svg>`
    const r = readExtensionPackage(build({ manifest: { ...MANIFEST, icon: 'icon.svg' }, files: { 'icon.svg': evil } }))
    if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues))
    const icon = r.pkg.files.find(f => f.path === 'icon.svg')!
    expect(icon.content.toString('utf8')).not.toContain('script')
    expect(r.pkg.sanitized['icon.svg']).toContain('<script>')
  })

  it('fait échouer l installation quand un SVG ne survit pas', () => {
    const dead = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
    expect(codes(build({ files: { 'preview.svg': dead } }))).toContain('SVG_REJECTED')
  })
})
