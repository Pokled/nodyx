// Installation d'un paquet d'extension.
//
// Le lecteur (package.ts) a déjà tout jugé : ce module ne fait que POSER des
// fichiers déjà sûrs et enregistrer la décision de l'admin. Il ne revalide
// rien, et il ne doit jamais devenir l'endroit où l'on ajoute une garde
// oubliée ailleurs.
//
// Aucun import de `../config/database` ici, volontairement : ce module reçoit
// sa fonction de requête. Cela le rend testable sans monter la moitié de
// l'application, et évite qu'un test touche par accident une base ou un cache
// de production.

import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { readExtensionPackage } from './package'
import { fetchAndUnpackAppBundle } from './appBundle'
import { applyGrant, type GrantDecision } from './capabilities'
import type { ValidationIssue } from './manifest'

export type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>

export interface InstallContext {
  query: QueryFn
  /** Racine des extensions installées, `uploads/extensions` par défaut. */
  dir?:  string
}

export interface InstallInput {
  archive:      Buffer
  /** `file` pour un téléversement, `registry:<hôte>` pour une installation depuis un index. */
  origin:       string
  installedBy?: string | null
  grant?:       GrantDecision
  /** Octets du bundle applicatif, si l'admin le téléverse à côté du `.nyx`
   *  (installation hors ligne). Sinon il est récupéré depuis `manifest.app.url`. */
  appBundle?:   Buffer
}

export interface InstallSuccess {
  id:        string
  version:   string
  sha256:    string
  granted:   string[]
  denied:    string[]
  /** Éléments retirés d'un SVG, par chemin, pour le dire à l'auteur. */
  sanitized: Record<string, string[]>
  dir:       string
}

export type InstallResult =
  | { ok: true;  result: InstallSuccess }
  | { ok: false; issues: ValidationIssue[] }

export function defaultExtensionsDir(): string {
  return path.join(process.cwd(), 'uploads', 'extensions')
}

/**
 * Pose les fichiers, puis enregistre.
 *
 * L'écriture passe par un dossier temporaire renommé à la fin : une
 * installation interrompue ne laisse pas une version à moitié écrite que la
 * route d'assets servirait ensuite. Le dossier est nommé par version, donc
 * deux versions ne se marchent jamais dessus et le cache du navigateur se
 * périme tout seul.
 */
export async function installExtension(input: InstallInput, ctx: InstallContext): Promise<InstallResult> {
  const read = readExtensionPackage(input.archive)
  if (!read.ok) return { ok: false, issues: read.issues }

  const { manifest, files, messages, sanitized } = read.pkg
  const { granted, denied } = applyGrant(manifest, input.grant)

  const sha256 = createHash('sha256').update(input.archive).digest('hex')
  const root    = ctx.dir ?? defaultExtensionsDir()
  const target  = path.join(root, manifest.id, manifest.version)
  const staging = `${target}.tmp-${process.pid}-${Date.now()}`

  try {
    await fs.rm(staging, { recursive: true, force: true })
    for (const f of files) {
      const dest = path.join(staging, f.path)
      // Ceinture : le chemin a déjà été jugé sûr par le lecteur, on vérifie
      // quand même qu'il reste sous la racine. Une garde de pose coûte trois
      // lignes et couvre une régression future du lecteur.
      if (!dest.startsWith(staging + path.sep)) {
        throw new Error(`chemin hors du dossier de destination : ${f.path}`)
      }
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, f.content)
    }

    // Bundle applicatif (activité) : récupéré/vérifié/décompressé DANS le
    // staging, donc l'installation reste atomique — tout ou rien.
    if (manifest.app) {
      const bundle = await fetchAndUnpackAppBundle(manifest, staging, { uploaded: input.appBundle })
      if (!bundle.ok) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
        return { ok: false, issues: bundle.issues }
      }
    }

    await fs.rm(target, { recursive: true, force: true })
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.rename(staging, target)
  } catch (e) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    return { ok: false, issues: [{ code: 'INSTALL_WRITE_FAILED', path: '', message: (e as Error).message }] }
  }

  await ctx.query(
    `INSERT INTO installed_extensions
       (id, manifest, messages, version, origin, sha256, enabled, granted, installed_by, installed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       manifest = $2, messages = $3, version = $4, origin = $5, sha256 = $6,
       enabled = true, granted = $7, updated_at = now()`,
    [
      manifest.id,
      JSON.stringify(manifest),
      JSON.stringify(messages),
      manifest.version,
      input.origin,
      sha256,
      JSON.stringify(granted),
      input.installedBy ?? null,
    ],
  )

  return { ok: true, result: { id: manifest.id, version: manifest.version, sha256, granted, denied, sanitized, dir: target } }
}

/**
 * Retire une extension : la base d'abord, le disque ensuite.
 *
 * Cet ordre est délibéré. Si la suppression des fichiers échoue, il reste des
 * octets orphelins sur le disque, ce qui est bénin. L'ordre inverse laisserait
 * une extension enregistrée dont les fichiers ont disparu, donc une surface
 * cassée pour les membres.
 */
export async function uninstallExtension(id: string, ctx: InstallContext): Promise<void> {
  await ctx.query(`DELETE FROM installed_extensions WHERE id = $1`, [id])
  const root = ctx.dir ?? defaultExtensionsDir()
  await fs.rm(path.join(root, id), { recursive: true, force: true }).catch(() => {})
}
