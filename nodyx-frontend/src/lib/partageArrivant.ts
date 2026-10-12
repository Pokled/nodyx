// Proposer un partage d'écran DÉJÀ EN COURS à une connexion qui vient de naître.
//
// Bug reproduit en production le 12/10/2026 (deux fois sur deux) : quelqu'un
// qui rejoint un salon vocal pendant un partage d'écran ne le recevait jamais.
// startScreenShare ajoute la vidéo aux connexions qui existent à ce moment-là,
// et une connexion créée ensuite ne portait que l'audio. Pire, c'est l'arrivant
// qui fait l'offre initiale (audio seul) et le partageur qui répond : sans
// nouvelle offre de sa part, la vidéo n'était jamais négociée.

/** Le strict nécessaire d'une RTCPeerConnection, pour pouvoir le simuler en test. */
export interface ConnexionPartage {
  readonly signalingState: RTCSignalingState
  readonly localDescription: RTCSessionDescriptionInit | null
  getSenders(): Array<{ track: MediaStreamTrack | null }>
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender
  createOffer(): Promise<RTCSessionDescriptionInit>
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>
}

export interface OptionsPartage {
  /**
   * true : envoyer soi-même une offre (on n'est pas à l'initiative de la
   * connexion, personne d'autre ne renégociera). false : l'initiateur s'en
   * charge par onnegotiationneeded.
   */
  offrir: boolean
  plafonner?: (sender: RTCRtpSender) => Promise<void>
  preparerSdp?: (sdp: string) => string
  envoyerOffre?: (description: RTCSessionDescriptionInit) => void
}

/**
 * Ajoute la vidéo du partage en cours à `pc` si elle n'y est pas déjà, et, si
 * demandé, envoie l'offre qui la propose. Renvoie true si la vidéo a été ajoutée.
 */
export async function proposerPartageEnCours(
  pc: ConnexionPartage,
  ecran: MediaStream | null,
  options: OptionsPartage,
): Promise<boolean> {
  const piste = ecran?.getVideoTracks()[0]
  if (!ecran || !piste || piste.readyState === 'ended') return false
  if (pc.getSenders().some(s => s.track === piste)) return false

  // Ajout SYNCHRONE (avant tout await) : dans une connexion qui vient de naître,
  // la première offre de l'initiateur doit déjà la contenir.
  const sender = pc.addTrack(piste, ecran)
  try { await options.plafonner?.(sender) } catch { /* plafond facultatif */ }

  if (!options.offrir || pc.signalingState !== 'stable') return true
  const offre = await pc.createOffer()
  const sdp = options.preparerSdp ? options.preparerSdp(offre.sdp ?? '') : offre.sdp
  await pc.setLocalDescription({ type: 'offer', sdp })
  if (pc.localDescription) options.envoyerOffre?.(pc.localDescription)
  return true
}
