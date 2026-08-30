// Bundle applicatif d'une activité (cf SPECS/NODYX_ACTIVITIES_CDC.md §2.3).
//
// Le runtime lourd (wasm Godot, etc.) ne rentre pas dans le `.nyx`. Le manifeste
// déclare `app: { url, sha256, bytes }`. À l'installation, ce module :
//   1. obtient les octets (téléversés, ou téléchargés sous garde SSRF)
//   2. vérifie l'empreinte sha256 déclarée
//   3. décompresse dans <versionDir>/app/ avec les mêmes défenses que le .nyx
//      (symlink, zip-slip, liste blanche de types, plafonds)
//   4. vérifie que l'`entry` de chaque surface activity est présent
//
// Ensuite l'instance sert ce dossier elle-même : plus aucune dépendance réseau.

import { createHash } from 'crypto'
import dns from 'dns'
import http from 'http'
import https from 'https'
import path from 'path'
import { promises as fs } from 'fs'
import AdmZip from 'adm-zip'
import { addressAllowed } from './net'
import { APP_BUNDLE } from './limits'
import { isSafePackagePath, type ExtensionManifest, type ValidationIssue } from './manifest'

const fail = (code: string, message: string, p = ''): ValidationIssue => ({ code, path: p, message })

/** Le mode POSIX d'une entrée zip vit dans les 16 bits de poids fort. */
function isSymlink(entry: AdmZip.IZipEntry): boolean {
  return ((entry.header.attr >>> 16) & 0xf000) === 0xa000
}

const DOWNLOAD_TIMEOUT_MS = 60_000

/**
 * GET binaire avec épinglage de résolution : la pile appelle NOTRE lookup, qui
 * refuse toute adresse privée / lien local (sauf `allowPrivate`, en dev). Une
 * redirection est refusée : la cible est celle du manifeste, pas une autre.
 */
export function downloadAppBundle(rawUrl: string, allowPrivate: boolean): Promise<Buffer> {
  const url = new URL(rawUrl)
  const mod = url.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    const req = mod.get(
      {
        protocol:   url.protocol,
        hostname:   url.hostname,
        port:       url.port || (url.protocol === 'https:' ? 443 : 80),
        path:       url.pathname + url.search,
        servername: url.hostname,
        timeout:    DOWNLOAD_TIMEOUT_MS,
        lookup: ((host: string, _opts: unknown, cb: (e: NodeJS.ErrnoException | null, a: string, f: number) => void) => {
          dns.lookup(host, { all: true, verbatim: true }, (err, addrs) => {
            if (err) return cb(err, '', 4)
            const list = Array.isArray(addrs) ? addrs : []
            if (!list.length) return cb(Object.assign(new Error('résolution vide'), { code: 'ENOTFOUND' }), '', 4)
            for (const a of list) {
              if (!addressAllowed(a.address, allowPrivate).ok) {
                return cb(Object.assign(new Error('adresse refusée (privée ou lien local)'), { code: 'EBLOCKED' }), '', 4)
              }
            }
            cb(null, list[0].address, list[0].family)
          })
        }) as unknown as undefined,
      },
      (res) => {
        const code = res.statusCode ?? 0
        if (code >= 300 && code < 400) {
          res.destroy()
          return reject(Object.assign(new Error('redirection refusée'), { code: 'EREDIRECT' }))
        }
        if (code !== 200) {
          res.destroy()
          return reject(new Error(`réponse HTTP ${code}`))
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > APP_BUNDLE.maxBytes) {
            res.destroy()
            reject(Object.assign(new Error('bundle au delà du plafond'), { code: 'ETOOBIG' }))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
  })
}

/** Décompresse un bundle vérifié dans `destDir`, en posant les mêmes gardes que le `.nyx`. */
export async function extractAppBundleTo(
  bytes: Buffer, destDir: string,
): Promise<{ ok: boolean; issues: ValidationIssue[]; files: string[] }> {
  const issues: ValidationIssue[] = []
  let zip: AdmZip
  try { zip = new AdmZip(bytes) } catch {
    return { ok: false, issues: [fail('APP_BUNDLE_UNREADABLE', 'le bundle n\'est pas un zip valide', 'app')], files: [] }
  }

  const rootResolved = path.resolve(destDir)
  const written: string[] = []
  let count = 0
  let total = 0

  for (const e of zip.getEntries()) {
    if (isSymlink(e)) { issues.push(fail('APP_SYMLINK_REFUSED', 'lien symbolique dans le bundle', e.entryName)); continue }
    if (e.isDirectory) continue

    const norm = e.entryName.replace(/\\/g, '/')
    if (!isSafePackagePath(norm)) { issues.push(fail('APP_UNSAFE_PATH', 'chemin absolu, remontant ou refusé', e.entryName)); continue }

    const ext = path.extname(norm).toLowerCase()
    if (!(APP_BUNDLE.allowedExtensions as readonly string[]).includes(ext)) continue   // ignoré, pas fatal

    if (++count > APP_BUNDLE.maxFiles) { issues.push(fail('APP_TOO_MANY_FILES', `plus de ${APP_BUNDLE.maxFiles} fichiers`, 'app')); break }

    const declared = e.header.size
    if (declared > APP_BUNDLE.maxFileBytes) { issues.push(fail('APP_FILE_TOO_LARGE', `fichier au delà de ${APP_BUNDLE.maxFileBytes / 1024 / 1024} Mo`, norm)); continue }

    const compressed = e.header.compressedSize || 1
    if (declared / compressed > 200 && declared > 64 * 1024) { issues.push(fail('APP_COMPRESSION_RATIO', 'ratio de décompression anormal', norm)); continue }

    total += declared
    if (total > APP_BUNDLE.maxBytes) { issues.push(fail('APP_UNPACKED_TOO_LARGE', 'contenu décompressé au delà du plafond', 'app')); break }

    const dest = path.join(destDir, norm)
    if (!path.resolve(dest).startsWith(rootResolved + path.sep)) { issues.push(fail('APP_UNSAFE_PATH', 'zip-slip', e.entryName)); continue }

    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, e.getData())
    written.push(norm)
  }

  return { ok: issues.length === 0, issues, files: written }
}

/**
 * Obtient, vérifie et décompresse le bundle applicatif du manifeste dans
 * `<versionDir>/app/`. Ne fait rien si le manifeste n'a pas de champ `app`.
 * `uploaded` : octets fournis par l'admin à côté du `.nyx` (installation hors ligne).
 */
export async function fetchAndUnpackAppBundle(
  manifest: ExtensionManifest, versionDir: string, opts: { uploaded?: Buffer } = {},
): Promise<{ ok: boolean; issues: ValidationIssue[] }> {
  if (!manifest.app) return { ok: true, issues: [] }
  const allowPrivate = process.env.NODE_ENV !== 'production'

  let bytes: Buffer
  if (opts.uploaded) {
    bytes = opts.uploaded
  } else {
    try {
      bytes = await downloadAppBundle(manifest.app.url, allowPrivate)
    } catch (e) {
      return { ok: false, issues: [fail('APP_DOWNLOAD_FAILED', `téléchargement du bundle échoué : ${(e as Error).message}`, 'app.url')] }
    }
  }

  if (bytes.length > APP_BUNDLE.maxBytes) {
    return { ok: false, issues: [fail('APP_BUNDLE_TOO_LARGE', `bundle au delà de ${APP_BUNDLE.maxBytes / 1024 / 1024} Mo`, 'app')] }
  }

  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== manifest.app.sha256) {
    return { ok: false, issues: [fail('APP_CHECKSUM_MISMATCH', 'les octets du bundle ne correspondent pas à l\'empreinte du manifeste', 'app.sha256')] }
  }

  const appDir = path.join(versionDir, 'app')
  const ext = await extractAppBundleTo(bytes, appDir)
  if (!ext.ok) return { ok: false, issues: ext.issues }

  const missing: ValidationIssue[] = []
  const present = new Set(ext.files)
  for (const s of manifest.surfaces) {
    if (s.type === 'activity' && !present.has(s.entry.replace(/\\/g, '/'))) {
      missing.push(fail('APP_ENTRY_MISSING', `l'entrée "${s.entry}" est absente du bundle applicatif`, 'app'))
    }
  }
  if (missing.length) return { ok: false, issues: missing }

  return { ok: true, issues: [] }
}
