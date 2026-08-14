// Traduction des permissions du manifeste en capacités.
//
// Le manifeste DEMANDE, l'admin ACCORDE, le jeton PORTE. Ce module fait la
// jonction, et la distinction n'est pas cosmétique : une extension n'obtient
// jamais que ce qu'un humain a vu et accepté.
//
// Une capacité est une chaîne plate, parce que c'est ce qui voyage dans le
// jeton et ce qui se compare sans ambiguïté à l'exécution.
// cf SPECS/NODYX_SDK_SECURITY.md §4.5

import type { ExtensionManifest } from './manifest'
import { classifyHost } from './manifest'

/** Ce que le manifeste demande, sous forme de capacités plates. */
export function requestedCapabilities(m: ExtensionManifest): string[] {
  const caps = new Set<string>()
  const p = m.permissions
  if (!p) return []

  if (p.identity?.length) {
    caps.add('identity')
    for (const f of p.identity) caps.add(`identity:${f}`)
  }
  if (p.storage?.user)           caps.add('storage.user')
  if (p.storage?.instance)       caps.add('storage.instance.read')
  if (p.storage?.instance_write) caps.add('storage.instance.write')
  for (const scope of p.core ?? []) caps.add(`core:${scope}`)
  for (const host of Object.keys(p.network ?? {})) caps.add(`net:${host}`)

  return [...caps].sort()
}

/**
 * Ce qui exige un consentement DISTINCT, montré à part sur l'écran de
 * permissions plutôt que noyé dans la liste ordinaire.
 *
 * Deux familles : l'écriture sur les données partagées de l'instance, et les
 * appels vers un réseau privé. La seconde existe parce qu'une instance en
 * intranet est un usage normal, pas une anomalie : on ne l'interdit pas, on la
 * fait remarquer.
 */
export function sensitiveCapabilities(m: ExtensionManifest): string[] {
  const out: string[] = []
  if (m.permissions?.storage?.instance_write) out.push('storage.instance.write')
  for (const host of Object.keys(m.permissions?.network ?? {})) {
    if (classifyHost(host) === 'private') out.push(`net:${host}`)
  }
  return out.sort()
}

export interface GrantDecision {
  /** Capacités que l'admin accepte. Absent vaut « tout ce qui est demandé ». */
  accept?: string[]
}

export interface GrantResult {
  granted: string[]
  /** Demandé mais refusé par l'admin, pour le dire à l'extension plutôt qu'échouer plus tard. */
  denied:  string[]
}

/**
 * Applique la décision de l'admin.
 *
 * Une capacité accordée qui n'a pas été demandée est ignorée : l'accord ne
 * peut pas élargir ce que le manifeste déclare, sinon l'écran de permissions
 * cesserait d'être la vérité.
 */
export function applyGrant(m: ExtensionManifest, decision: GrantDecision = {}): GrantResult {
  const requested = requestedCapabilities(m)
  if (!decision.accept) return { granted: requested, denied: [] }

  const accepted = new Set(decision.accept)
  const granted  = requested.filter(c => accepted.has(c))
  const denied   = requested.filter(c => !accepted.has(c))
  return { granted, denied }
}
