// Client de registre : telecharger une extension depuis un index distant.
//
// C'est le seul endroit du coeur qui va chercher du CODE ailleurs. Trois
// controles y sont non negociables, et chacun ferme une porte differente.
//
// 1. Le registre doit etre dans la liste configuree de l'instance. Sans ca, un
//    lien fabrique avec `src=<registre_de_l_attaquant>` envoye a un owner
//    installerait du code arbitraire en un clic.
// 2. L'index porte l'empreinte, et on la verifie sur les octets recus. Le
//    telechargement devient verifiable, l'URL de paquet n'a plus a etre crue.
// 3. Le paquet passe ensuite par la MEME chaine qu'un televersement : lecteur,
//    validateur, assainissement. Venir d'un registre n'accorde aucune faveur.
//
// cf SPECS/NODYX_SDK_CDC.md §9.2 et §9.5

import { createHash } from 'crypto'
import { PACKAGE } from './limits'

/** Registres de confiance. Le defaut est remplacable par l'instance. */
export function configuredRegistries(): string[] {
  const raw = process.env.NODYX_EXTENSION_REGISTRIES
  if (raw) return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return ['extensions.nodyx.org']
}

export type RegistryError =
  | 'REGISTRY_NOT_ALLOWED' | 'REGISTRY_UNREACHABLE' | 'REGISTRY_MALFORMED'
  | 'EXTENSION_NOT_IN_REGISTRY' | 'VERSION_NOT_IN_REGISTRY'
  | 'DOWNLOAD_FAILED' | 'CHECKSUM_MISMATCH' | 'ARCHIVE_TOO_LARGE'

export type RegistryResult<T> =
  | { ok: true;  value: T }
  | { ok: false; code: RegistryError; message: string }

const fail = (code: RegistryError, message: string): RegistryResult<never> => ({ ok: false, code, message })

export interface RegistryVersion {
  version: string
  sha256:  string
  url:     string
  permissions?: string[]
}

export interface RegistryEntry {
  id:       string
  label?:   string
  versions: RegistryVersion[]
}

/** Le registre demande est il un de ceux que l'instance accepte ? */
export function registryAllowed(host: unknown): host is string {
  if (typeof host !== 'string') return false
  const clean = host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return configuredRegistries().includes(clean)
}

export interface FetchLike {
  (url: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean
    status: number
    json(): Promise<unknown>
    arrayBuffer(): Promise<ArrayBuffer>
  }>
}

/** Trouve une version dans un index deja telecharge. */
export function findVersion(index: unknown, id: string, version: string): RegistryResult<RegistryVersion> {
  const extensions = (index as { extensions?: unknown })?.extensions
  if (!Array.isArray(extensions)) return fail('REGISTRY_MALFORMED', 'index illisible')

  const entry = (extensions as RegistryEntry[]).find((e) => e?.id === id)
  if (!entry) return fail('EXTENSION_NOT_IN_REGISTRY', `${id} n'est pas dans ce registre`)

  const found = (entry.versions ?? []).find((v) => v?.version === version)
  if (!found) return fail('VERSION_NOT_IN_REGISTRY', `la version ${version} de ${id} n'est pas publiée dans ce registre`)

  if (!/^[a-f0-9]{64}$/.test(found.sha256 ?? '')) return fail('REGISTRY_MALFORMED', 'empreinte absente ou mal formée')
  if (!/^https:\/\//.test(found.url ?? ''))       return fail('REGISTRY_MALFORMED', 'URL de paquet non sécurisée')

  return { ok: true, value: found }
}

export interface DownloadedPackage {
  archive: Buffer
  version: RegistryVersion
}

/**
 * Telecharge un paquet depuis un registre autorise, et VERIFIE son empreinte.
 *
 * L'empreinte vient de l'index, pas du paquet : c'est ce qui rend le
 * telechargement verifiable. Un paquet dont les octets ne correspondent pas est
 * refuse, quelle qu'en soit la raison.
 */
export async function downloadFromRegistry(
  registry: unknown, id: string, version: string, doFetch: FetchLike,
): Promise<RegistryResult<DownloadedPackage>> {
  if (!registryAllowed(registry)) {
    return fail('REGISTRY_NOT_ALLOWED', 'ce registre ne fait pas partie de ceux configurés sur cette instance')
  }
  const host = String(registry).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')

  let index: unknown
  try {
    const res = await doFetch(`https://${host}/index.json`)
    if (!res.ok) return fail('REGISTRY_UNREACHABLE', `le registre a répondu ${res.status}`)
    index = await res.json()
  } catch {
    return fail('REGISTRY_UNREACHABLE', 'le registre est injoignable')
  }

  const found = findVersion(index, id, version)
  if (!found.ok) return found

  let archive: Buffer
  try {
    const res = await doFetch(found.value.url)
    if (!res.ok) return fail('DOWNLOAD_FAILED', `le paquet a répondu ${res.status}`)
    archive = Buffer.from(await res.arrayBuffer())
  } catch {
    return fail('DOWNLOAD_FAILED', 'le paquet est introuvable')
  }

  if (archive.length > PACKAGE.maxArchiveBytes) {
    return fail('ARCHIVE_TOO_LARGE', `archive au dessus du plafond de ${PACKAGE.maxArchiveBytes / 1024 / 1024} Mo`)
  }

  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== found.value.sha256) {
    return fail('CHECKSUM_MISMATCH', 'les octets reçus ne correspondent pas à l\'empreinte publiée : téléchargement refusé')
  }

  return { ok: true, value: { archive, version: found.value } }
}
