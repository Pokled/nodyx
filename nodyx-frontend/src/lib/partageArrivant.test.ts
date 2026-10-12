import { describe, it, expect, vi } from 'vitest'
import { proposerPartageEnCours, type ConnexionPartage } from './partageArrivant'

function piste(kind: 'video' | 'audio', etat: 'live' | 'ended' = 'live') {
  return { kind, readyState: etat } as unknown as MediaStreamTrack
}
function flux(...pistes: MediaStreamTrack[]) {
  return { getVideoTracks: () => pistes.filter(p => p.kind === 'video') } as unknown as MediaStream
}

/** Une fausse connexion qui ne connaît que l'audio, comme celle créée pour un arrivant. */
function connexion(etat: RTCSignalingState = 'stable', deja: MediaStreamTrack[] = [piste('audio')]) {
  const senders = deja.map(track => ({ track }))
  let locale: RTCSessionDescriptionInit | null = null
  const pc = {
    signalingState: etat,
    get localDescription() { return locale },
    getSenders: () => senders,
    addTrack: vi.fn((track: MediaStreamTrack) => { const s = { track }; senders.push(s); return s as unknown as RTCRtpSender }),
    createOffer: vi.fn(async () => ({ type: 'offer' as const, sdp: 'm=audio\r\nm=video\r\n' })),
    setLocalDescription: vi.fn(async (d: RTCSessionDescriptionInit) => { locale = d }),
  }
  return pc as typeof pc & ConnexionPartage
}

describe('proposerPartageEnCours : un arrivant reçoit le partage déjà lancé', () => {
  it('partageur qui répond à l\'arrivant : ajoute la vidéo ET envoie lui-même l\'offre', async () => {
    const video = piste('video'); const ecran = flux(video)
    const pc = connexion()
    const envoyerOffre = vi.fn()
    expect(await proposerPartageEnCours(pc, ecran, { offrir: true, envoyerOffre })).toBe(true)
    expect(pc.addTrack).toHaveBeenCalledWith(video, ecran)
    expect(envoyerOffre).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer' }))
  })

  it('partageur à l\'initiative : ajoute la vidéo tout de suite, sans offre (onnegotiationneeded s\'en charge)', async () => {
    const video = piste('video'); const pc = connexion()
    const envoyerOffre = vi.fn()
    const promesse = proposerPartageEnCours(pc, flux(video), { offrir: false, envoyerOffre })
    // Ajout synchrone : la première offre de l'initiateur doit déjà contenir la vidéo.
    expect(pc.addTrack).toHaveBeenCalledTimes(1)
    expect(await promesse).toBe(true)
    expect(envoyerOffre).not.toHaveBeenCalled()
  })

  it('le débit du partage est plafonné aussi pour l\'arrivant', async () => {
    const plafonner = vi.fn(async () => {})
    await proposerPartageEnCours(connexion(), flux(piste('video')), { offrir: true, plafonner })
    expect(plafonner).toHaveBeenCalledTimes(1)
  })

  it('le SDP passe par la préparation (réglages Opus) avant d\'être posé', async () => {
    const pc = connexion()
    await proposerPartageEnCours(pc, flux(piste('video')), { offrir: true, preparerSdp: s => s + 'a=prepare\r\n' })
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'm=audio\r\nm=video\r\na=prepare\r\n' })
  })

  it('aucun partage, ou partage terminé : rien', async () => {
    const pc = connexion()
    expect(await proposerPartageEnCours(pc, null, { offrir: true })).toBe(false)
    expect(await proposerPartageEnCours(pc, flux(piste('video', 'ended')), { offrir: true })).toBe(false)
    expect(pc.addTrack).not.toHaveBeenCalled()
  })

  it('vidéo déjà portée par la connexion : pas de doublon, pas d\'offre', async () => {
    const video = piste('video')
    const pc = connexion('stable', [piste('audio'), video])
    const envoyerOffre = vi.fn()
    expect(await proposerPartageEnCours(pc, flux(video), { offrir: true, envoyerOffre })).toBe(false)
    expect(pc.addTrack).not.toHaveBeenCalled()
    expect(envoyerOffre).not.toHaveBeenCalled()
  })

  it('négociation déjà en cours : la vidéo est ajoutée, l\'offre n\'est pas forcée', async () => {
    const pc = connexion('have-remote-offer')
    const envoyerOffre = vi.fn()
    expect(await proposerPartageEnCours(pc, flux(piste('video')), { offrir: true, envoyerOffre })).toBe(true)
    expect(pc.createOffer).not.toHaveBeenCalled()
  })
})
