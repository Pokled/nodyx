/**
 * Nexus Voice Settings — store persisté dans localStorage
 */
import { writable } from 'svelte/store'

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
  /** Bitrate Opus en kbps — appliqué à la prochaine connexion pair */
  bitrate:              32 | 64 | 128
}

const DEFAULTS: VoiceSettings = {
  micGain:              1.0,
  highPassEnabled:      true,
  rnnoiseEnabled:       false,   // off par défaut (package optionnel)
  broadcastModeEnabled: false,
  broadcastIntensity:   0.6,
  bitrate:              64,
}

function _load(): VoiceSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem('nexus:voiceSettings')
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const voiceSettingsStore = writable<VoiceSettings>(_load())

// Persist every change
voiceSettingsStore.subscribe(v => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('nexus:voiceSettings', JSON.stringify(v))
  }
})
