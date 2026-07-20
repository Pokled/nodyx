/**
 * Nodyx Voice Settings — store persisté dans localStorage
 */
import { writable } from 'svelte/store'
import { browser } from '$app/environment'

export interface VoiceSettings {
  /** Gain micro 0.1–2.0 (1.0 = nominal, 2.0 = boost ×2)  */
  micGain:              number
  /** Filtre passe-haut 80 Hz (supprime grondements, ventilo…) */
  highPassEnabled:      boolean
  /** Suppression de bruit IA via RNNoise WASM (nécessite @jitsi/rnnoise-wasm) */
  rnnoiseEnabled:       boolean
  /**
   * ✨ Mode Broadcast — EQ 3-bandes calé pour la voix humaine :
   *   • Coupe la boue      (peaking  200 Hz  −3 dB)
   *   • Boost présence     (peaking 3000 Hz  +4 dB)
   *   • Air haute fréquence (shelf  8000 Hz  +3 dB)
   * Résultat : son "radio / podcast" sans équipement dédié.
   * Discord n'a rien d'équivalent côté client.
   */
  broadcastModeEnabled: boolean
  /** Intensité du Mode Broadcast 0.0–1.0 */
  broadcastIntensity:   number
  /** Bitrate Opus en kbps — appliqué via SDP (CBR, donc constant) */
  bitrate:              32 | 64 | 96 | 128
  /**
   * Noise gate — coupe le signal sous le seuil entre les prises de parole.
   * Réduit la transmission du fond sonore en silence.
   * Implémenté via AudioWorklet (nodyx-noise-gate).
   */
  noiseGateEnabled:     boolean
  /** Seuil du noise gate en dBFS (−80 à 0). Défaut : −50 dBFS */
  noiseGateThreshold:   number
}

const DEFAULTS: VoiceSettings = {
  micGain:              1.0,
  highPassEnabled:      true,
  rnnoiseEnabled:       false,     // off par défaut (package optionnel)
  broadcastModeEnabled: false,
  broadcastIntensity:   0.6,
  bitrate:              64,        // 64 kbps CBR — qualité vocale correcte sans artefacts
  noiseGateEnabled:     false,     // off par défaut — l'utilisateur l'active selon son environnement
  noiseGateThreshold:   -50,       // −50 dBFS — coupe le fond sonore sans couper la voix
}

function _load(): VoiceSettings {
  if (!browser) return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem('nodyx:voiceSettings')
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const voiceSettingsStore = writable<VoiceSettings>(_load())

// Persist every change
voiceSettingsStore.subscribe(v => {
  if (browser) {
    localStorage.setItem('nodyx:voiceSettings', JSON.stringify(v))
  }
})

// ── Volume par utilisateur (mémorisé entre sessions) ──────────────────────────
// Indexé par userId (STABLE) et non par socketId (qui change à chaque connexion) :
// le volume qu'on attribue à quelqu'un survit ainsi au refresh et aux reconnexions.
const PEER_VOL_KEY = 'nodyx:peerVolumes'

export function loadPeerVolumes(): Record<string, number> {
  if (!browser) return {}
  try { return JSON.parse(localStorage.getItem(PEER_VOL_KEY) || '{}') } catch { return {} }
}

export function getPeerVolume(userId: string): number {
  const v = loadPeerVolumes()[userId]
  return typeof v === 'number' ? v : 100
}

export function savePeerVolume(userId: string, volume: number): void {
  if (!browser || !userId) return
  const all = loadPeerVolumes()
  all[userId] = volume
  try { localStorage.setItem(PEER_VOL_KEY, JSON.stringify(all)) } catch { /* quota */ }
}
