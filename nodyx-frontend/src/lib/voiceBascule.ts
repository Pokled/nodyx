// ── Bascule mesh ↔ SFU — orchestrateur CLIENT (§17-B) ─────────────────────────
//
// N'agit QUE sur événement serveur (voice:mode / voice:sfu_commit), lesquels ne
// sont émis que si le flag backend VOICE_SFU_AUTO est actif. Sans bascule, ces
// fonctions ne sont jamais appelées ⇒ le mesh (voice.ts) est strictement inchangé.
//
// Zéro-coupure SANS son différé (qui se faisait bloquer par la politique autoplay,
// surtout mobile) : on JOUE le flux SFU immédiatement (comme le labo, prouvé), et
// on coupe le mesh de chaque personne au moment EXACT où son flux SFU se met à
// jouer (crossfade par personne). Donc pour chacun : mesh OU SFU, jamais les deux,
// jamais le vide. voice.ts fournit les opérations mesh (pas d'import circulaire).

import { sfuJoin, sfuLeave, sfuIsActive, sfuSetConsumerPlayingCallback, sfuCollectStats } from './voiceSfu'

type Emitter = { emit: (event: string, payload: unknown) => void }

// Stats de la session SFU (RTT/type + perte/gigue par userId), pour alimenter le
// même panneau réseau que le mesh. voice.ts fait le mapping userId → socketId.
export const basculeCollectStats = sfuCollectStats

// Cas A/C : le canal bascule (ou j'arrive pendant switching). On établit l'SFU en
// PARALLÈLE du mesh, en JOUANT tout de suite ; `onSfuPeerPlaying(userId)` coupe le
// mesh de cette personne à l'instant où son flux SFU démarre. Puis on confirme.
export async function basculeBeginSwitch(
  socket: Emitter,
  channelId: string,
  onSfuPeerPlaying: (userId: string) => void,
): Promise<void> {
  sfuSetConsumerPlayingCallback(onSfuPeerPlaying)
  await sfuJoin(channelId)
  if (sfuIsActive()) {
    socket.emit('voice:sfu_ready', { channelId })
  }
  // sinon : établissement échoué → le serveur abandonnera au timeout (voice:mode mesh)
}

// Cas B : j'arrive sur un canal DÉJÀ en SFU → rejoindre l'SFU directement (pas de
// mesh, donc pas de crossfade à gérer).
export async function basculeJoinDirectSfu(channelId: string): Promise<void> {
  await sfuJoin(channelId)
}

// Abandon / départ : on lâche l'SFU et on oublie le callback. Le mesh (jamais
// lâché) reste seul. Idempotent.
export async function basculeLeaveSfu(): Promise<void> {
  sfuSetConsumerPlayingCallback(null)
  await sfuLeave()
}

// Commit : tout le monde est sur l'SFU (chaque flux joue déjà, le mesh de chacun a
// été coupé au passage). On coupe un éventuel résidu mesh et on démonte les PC.
export function basculeCommit(
  meshMutePlayback: (muted: boolean) => void,
  meshTeardownConnections: () => void,
): void {
  sfuSetConsumerPlayingCallback(null)
  meshMutePlayback(true)      // filet de sécurité (résidu éventuel)
  meshTeardownConnections()   // démonte les PC mesh (roster/session conservés)
}
