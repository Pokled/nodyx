// ── Bascule mesh ↔ SFU — orchestrateur CLIENT (§17-B) ─────────────────────────
//
// N'agit QUE sur événement serveur (voice:mode / voice:sfu_commit), lesquels ne
// sont émis que si le flag backend VOICE_SFU_AUTO est actif. Sans bascule, ces
// fonctions ne sont jamais appelées ⇒ le mesh (voice.ts) est strictement inchangé.
//
// Zéro import de voice.ts : le commit reçoit les opérations mesh en paramètres
// (pas d'import circulaire). N'importe que voiceSfu (la couche SFU).

import { sfuJoin, sfuLeave, sfuActivatePlayback, sfuIsActive } from './voiceSfu'

// Type minimal : on n'a besoin que d'emit pour confirmer au serveur.
type Emitter = { emit: (event: string, payload: unknown) => void }

// Cas A/C : le canal bascule (ou j'arrive pendant switching) → établir l'SFU EN
// PARALLÈLE du mesh, SANS jouer (holdPlayback), puis confirmer au serveur. Le mesh
// n'est PAS touché : on entend toujours via lui jusqu'au commit.
export async function basculeBeginSwitch(socket: Emitter, channelId: string): Promise<void> {
  await sfuJoin(channelId, { holdPlayback: true })
  if (sfuIsActive()) {
    socket.emit('voice:sfu_ready', { channelId })
  }
  // sinon : établissement échoué → le serveur abandonnera au timeout (voice:mode mesh)
}

// Cas B : j'arrive sur un canal DÉJÀ en SFU → rejoindre l'SFU directement, en
// jouant (pas de mesh, donc pas d'overlap à gérer).
export async function basculeJoinDirectSfu(channelId: string): Promise<void> {
  await sfuJoin(channelId) // holdPlayback false ⇒ lecture immédiate
}

// Abandon / départ : on lâche l'SFU. Le mesh (jamais lâché) reste seul. Idempotent
// (sfuLeave gère l'absence de session).
export async function basculeLeaveSfu(): Promise<void> {
  await sfuLeave()
}

// Commit : l'instant zéro-coupure. On joue l'SFU (bref overlap : les deux jouent),
// puis on coupe et démonte le mesh. Les opérations mesh sont fournies par voice.ts.
export function basculeCommit(
  meshMutePlayback: (muted: boolean) => void,
  meshTeardownConnections: () => void,
): void {
  sfuActivatePlayback()        // l'SFU prend le relais
  meshMutePlayback(true)       // le mesh se tait
  meshTeardownConnections()    // puis on démonte les PC mesh (roster/session conservés)
}
