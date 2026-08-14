// Lecture et vérification d'un paquet d'extension .nyx (une archive zip).
//
// Ce module ne touche PAS au disque : il travaille sur un tampon et rend un
// paquet vérifié en mémoire. L'écriture appartient à l'installateur, qui n'a
// plus qu'à poser des fichiers déjà jugés sûrs.
//
// Toutes les défenses d'extraction vivent ici, et pas ailleurs :
// zip slip, chemin absolu, lien symbolique, plafonds de taille et de nombre,
// ratio de décompression, liste blanche d'extensions, assainissement SVG.
// cf NODYX_SDK_SECURITY.md §4.6 et §4.7

import AdmZip from 'adm-zip'
import path from 'path'
import { PACKAGE } from './limits'
import { validateManifest, isSafePackagePath, type ExtensionManifest, type ValidationIssue } from './manifest'
import { sanitizeSvg, SvgRejected } from './svg'

export interface PackageFile {
  /** Chemin relatif normalisé, séparateurs en barre oblique. */
  path:    string
  content: Buffer
}

export interface ExtensionPackage {
  manifest:            ExtensionManifest
  files:               PackageFile[]
  /** Locale -> dictionnaire plat. */
  messages:            Record<string, Record<string, string>>
  privateNetworkHosts: string[]
  /** Éléments retirés d'un SVG, par chemin de fichier. */
  sanitized:           Record<string, string[]>
}

export type PackageResult =
  | { ok: true;  pkg: ExtensionPackage }
  | { ok: false; issues: ValidationIssue[] }

const fail = (code: string, message: string, p = ''): ValidationIssue => ({ code, path: p, message })

/** Le mode POSIX d'une entrée zip vit dans les 16 bits de poids fort. */
function isSymlink(entry: AdmZip.IZipEntry): boolean {
  const mode = (entry.header.attr >>> 16) & 0xf000
  return mode === 0xa000
}

function depthOf(p: string): number {
  return p.split('/').length - 1
}

export function readExtensionPackage(archive: Buffer): PackageResult {
  const issues: ValidationIssue[] = []

  if (archive.length > PACKAGE.maxArchiveBytes) {
    return { ok: false, issues: [fail('ARCHIVE_TOO_LARGE', `archive au dessus du plafond de ${PACKAGE.maxArchiveBytes / 1024 / 1024} Mo`)] }
  }

  let zip: AdmZip
  let entries: AdmZip.IZipEntry[]
  try {
    zip = new AdmZip(archive)
    entries = zip.getEntries()
  } catch {
    return { ok: false, issues: [fail('ARCHIVE_UNREADABLE', 'archive illisible, ce n\'est pas un zip valide')] }
  }

  const files: PackageFile[] = []
  let unpacked = 0
  let fileCount = 0

  for (const entry of entries) {
    const raw = entry.entryName

    // Le lien symbolique se refuse AVANT toute lecture : c'est une évasion,
    // pas un fichier. Un lien vers /etc/passwd ressemble à un .json innocent.
    if (isSymlink(entry)) {
      issues.push(fail('SYMLINK_REFUSED', 'lien symbolique refusé', raw))
      continue
    }
    if (entry.isDirectory) continue

    const normalized = raw.replace(/\\/g, '/')
    if (!isSafePackagePath(normalized)) {
      issues.push(fail('UNSAFE_PATH', 'chemin absolu, remontant, ou porteur de caractères refusés', raw))
      continue
    }
    if (depthOf(normalized) > PACKAGE.maxDepth) {
      issues.push(fail('PATH_TOO_DEEP', `arborescence au delà de ${PACKAGE.maxDepth} niveaux`, raw))
      continue
    }

    const ext = path.extname(normalized).toLowerCase()
    if (!(PACKAGE.allowedExtensions as readonly string[]).includes(ext)) continue   // ignoré, pas fatal

    if (++fileCount > PACKAGE.maxFiles) {
      issues.push(fail('TOO_MANY_FILES', `plus de ${PACKAGE.maxFiles} fichiers dans l'archive`))
      break
    }

    const declared = entry.header.size
    if (declared > PACKAGE.maxFileBytes) {
      issues.push(fail('FILE_TOO_LARGE', `fichier au dessus du plafond de ${PACKAGE.maxFileBytes / 1024 / 1024} Mo`, raw))
      continue
    }

    // Bombe de décompression : on juge sur la taille DÉCLARÉE avant de
    // décompresser, sinon la défense arrive après le dégât.
    const compressed = entry.header.compressedSize || 1
    if (declared / compressed > PACKAGE.maxCompressionRatio && declared > 64 * 1024) {
      issues.push(fail('COMPRESSION_RATIO', 'ratio de décompression anormal, archive refusée', raw))
      continue
    }

    unpacked += declared
    if (unpacked > PACKAGE.maxUnpackedBytes) {
      issues.push(fail('UNPACKED_TOO_LARGE', `contenu décompressé au dessus du plafond de ${PACKAGE.maxUnpackedBytes / 1024 / 1024} Mo`))
      break
    }

    files.push({ path: normalized, content: entry.getData() })
  }

  if (issues.length) return { ok: false, issues }

  const byPath = new Map(files.map(f => [f.path, f]))

  // ── Manifeste ───────────────────────────────────────────────────────────
  const manifestFile = byPath.get('manifest.json')
  if (!manifestFile) {
    return { ok: false, issues: [fail('MANIFEST_MISSING', 'manifest.json absent de la racine de l\'archive. Piège classique : les fichiers sont dans un sous-dossier, il faut zipper le CONTENU du dossier, pas le dossier')] }
  }

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(manifestFile.content.toString('utf8'))
  } catch (e) {
    return { ok: false, issues: [fail('MANIFEST_MALFORMED', 'manifest.json n\'est pas du JSON valide : ' + (e as Error).message, 'manifest.json')] }
  }

  const validated = validateManifest(rawManifest)
  if (!validated.ok) return { ok: false, issues: validated.issues }
  const { manifest, messageKeys, privateNetworkHosts } = validated

  // ── Points d'entrée et icône ────────────────────────────────────────────
  for (const [i, s] of manifest.surfaces.entries()) {
    if (!byPath.has(s.entry)) {
      issues.push(fail('ENTRY_MISSING', `le point d'entrée "${s.entry}" est déclaré mais absent de l'archive`, `surfaces[${i}].entry`))
    }
  }
  if (manifest.icon && !byPath.has(manifest.icon)) {
    issues.push(fail('ICON_MISSING', `l'icône "${manifest.icon}" est déclarée mais absente de l'archive`, 'icon'))
  }

  // ── Traductions ─────────────────────────────────────────────────────────
  const messages: Record<string, Record<string, string>> = {}
  for (const f of files) {
    const m = /^i18n\/([a-z]{2}(?:-[A-Za-z]{2})?)\.json$/.exec(f.path)
    if (!m) continue
    try {
      const parsed = JSON.parse(f.content.toString('utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push(fail('BUNDLE_MALFORMED', 'un dictionnaire de traduction doit être un objet plat', f.path))
        continue
      }
      const flat: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== 'string') {
          issues.push(fail('BUNDLE_NOT_FLAT', `la clé "${k}" ne vaut pas une chaîne. Les dictionnaires sont plats, les clés portent des points`, f.path))
          continue
        }
        flat[k] = v
      }
      messages[m[1]] = flat
    } catch (e) {
      issues.push(fail('BUNDLE_MALFORMED', 'JSON invalide : ' + (e as Error).message, f.path))
    }
  }

  const source = messages[manifest.default_locale]
  if (!source) {
    issues.push(fail('DEFAULT_BUNDLE_MISSING', `default_locale vaut "${manifest.default_locale}" mais i18n/${manifest.default_locale}.json est absent`, 'default_locale'))
  } else {
    const missing = messageKeys.filter(k => !(k in source))
    if (missing.length) {
      issues.push(fail('MESSAGE_KEY_MISSING', `le manifeste référence des clés absentes de i18n/${manifest.default_locale}.json : ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? `, et ${missing.length - 8} autres` : ''}`, 'i18n'))
    }
  }

  // ── SVG ─────────────────────────────────────────────────────────────────
  const sanitized: Record<string, string[]> = {}
  for (const f of files) {
    if (!f.path.endsWith('.svg')) continue
    try {
      const { svg, stripped } = sanitizeSvg(f.content.toString('utf8'))
      f.content = Buffer.from(svg, 'utf8')
      if (stripped.length) sanitized[f.path] = stripped
    } catch (e) {
      const why = e instanceof SvgRejected ? e.reason : 'SVG illisible'
      issues.push(fail('SVG_REJECTED', why, f.path))
    }
  }

  if (issues.length) return { ok: false, issues }

  return { ok: true, pkg: { manifest, files, messages, privateNetworkHosts, sanitized } }
}
