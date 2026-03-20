/**
 * NODYX — Moteur ESY (Barbarization Engine)
 *
 * La couche ESY est une surcouche de défense en profondeur par-dessus AES-256-GCM.
 * Elle n'est PAS une primitive cryptographique. Seule ou avec XOR elle est cassable.
 * Combinée à AES-256-GCM : si AES est cassé dans 10 ans, l'attaquant tombe sur ESY.
 * Les règles ESY sont différentes sur chaque instance (permutation aléatoire unique).
 *
 * Pipeline de chiffrement DM :
 *   plaintext → [AES-256-GCM] → ciphertext → [ESY barbarize] → barbare (stocké en base)
 *
 * Pipeline de déchiffrement DM :
 *   barbare → [ESY debarbarize] → ciphertext → [AES-256-GCM] → plaintext
 *
 * Algorithme de barbarization (3 rounds par défaut) :
 *   Pour chaque round r :
 *     noise_i = xorshift32(seed XOR (r * 0x9e3779b9)) → prochain byte
 *     out[i] = permutation[(in[i] XOR noise_i XOR (i & 0xFF)) & 0xFF]
 *
 *   L'inversion utilise la table inverse_permutation.
 *
 * Rendu visuel (toGlyphs) :
 *   Chaque byte du texte chiffré est rendu comme un caractère de base + 0-2 diacritiques
 *   choisis dans le jeu de glyphes de l'instance. Résultat : "Ŧ҉҉̷̢ ĥ҉̨͝ẃ҉̷"
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EsyKey {
  version:             number
  permutation:         number[]   // 256 valeurs — bijection des bytes
  inverse_permutation: number[]   // inverse (invPerm[perm[i]] = i)
  noise_seed:          number     // uint32 — graine PRNG xorshift32
  rounds:              number     // nombre de passes
  glyphs:              string[]   // 64 glyphes pour le rendu visuel
  fingerprint:         string     // identifiant court de cette clé
  enabled:             boolean    // false si instance.esy manquant
}

// ── Cache module-level ────────────────────────────────────────────────────────

let _cachedKey: EsyKey | null = null
let _fetchPromise: Promise<EsyKey | null> | null = null

// ── PRNG — xorshift32 ─────────────────────────────────────────────────────────
// Déterministe, rapide, suffisant pour le bruit de barbarization.
// IMPORTANT : pas un CSPRNG, utilisé uniquement pour l'obfuscation ESY.

function makeXorshift32(seed: number) {
  // On s'assure que le seed est un uint32 non-nul (xorshift32 tourne sur 0)
  let state = (seed >>> 0) || 0xdeadbeef
  return {
    nextByte(): number {
      // xorshift32 classique
      state ^= (state << 13)  >>> 0
      state ^= (state >>> 17)
      state ^= (state << 5)   >>> 0
      state  = state >>> 0
      return state & 0xff
    }
  }
}

// ── Barbarize ─────────────────────────────────────────────────────────────────

/**
 * Applique la transformation barbare ESY sur un Uint8Array.
 *
 * Chaque round :
 *   out[i] = perm[(in[i] XOR noise XOR (i & 0xFF)) & 0xFF]
 *
 * Le mélange avec la position (i & 0xFF) rend l'attaque par analyse de fréquence
 * d'autant plus coûteuse (bytes identiques donnent des sorties différentes selon
 * leur position dans le flux).
 */
export function barbarize(data: Uint8Array, key: EsyKey): Uint8Array<ArrayBuffer> {
  if (!key.enabled) { const copy = new Uint8Array(data.length); copy.set(data); return copy }

  const { permutation, noise_seed, rounds } = key
  let buf: Uint8Array<ArrayBuffer> = (() => { const b = new Uint8Array(data.length); b.set(data); return b })()

  for (let r = 0; r < rounds; r++) {
    // Seed unique par round : noise_seed XOR (r * 0x9e3779b9) — golden ratio constant
    const seed  = (noise_seed ^ Math.imul(r, 0x9e3779b9)) >>> 0
    const prng  = makeXorshift32(seed)
    const out   = new Uint8Array(buf.length)

    for (let i = 0; i < buf.length; i++) {
      const noise   = prng.nextByte()
      const mixed   = (buf[i] ^ noise ^ (i & 0xff)) & 0xff
      out[i]        = permutation[mixed]
    }
    buf = out
  }
  return buf
}

// ── Debarbarize ───────────────────────────────────────────────────────────────

/**
 * Inverse de barbarize. Les rounds sont appliqués dans l'ordre inverse.
 *
 * Pour chaque round r (de rounds-1 à 0) :
 *   step1 = invPerm[in[i]]
 *   out[i] = step1 XOR noise XOR (i & 0xFF)
 */
export function debarbarize(data: Uint8Array, key: EsyKey): Uint8Array<ArrayBuffer> {
  if (!key.enabled) { const copy = new Uint8Array(data.length); copy.set(data); return copy }

  const { inverse_permutation, noise_seed, rounds } = key
  let buf: Uint8Array<ArrayBuffer> = (() => { const b = new Uint8Array(data.length); b.set(data); return b })()

  for (let r = rounds - 1; r >= 0; r--) {
    const seed  = (noise_seed ^ Math.imul(r, 0x9e3779b9)) >>> 0
    const prng  = makeXorshift32(seed)
    const out   = new Uint8Array(buf.length)

    for (let i = 0; i < buf.length; i++) {
      const noise = prng.nextByte()
      const step1 = inverse_permutation[buf[i]]
      out[i]      = (step1 ^ noise ^ (i & 0xff)) & 0xff
    }
    buf = out
  }
  return buf
}

// ── Rendu visuel ──────────────────────────────────────────────────────────────

// Caractères de base pour le rendu (24 lettres latines modifiées visuellement distinctes)
const BASE_CHARS = 'ĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖė'

/**
 * Transforme un Uint8Array chiffré en chaîne de glyphes visuellement chaotique.
 * Utilisé pour l'animation de 400ms avant l'envoi et après la réception.
 *
 * Chaque byte → caractère de base + 0 à 2 diacritiques combinants de l'instance.
 * Les espaces (0x20) sont préservés pour conserver vaguement la forme des mots.
 */
export function toGlyphs(data: Uint8Array, key: EsyKey): string {
  if (!key.glyphs || key.glyphs.length === 0) {
    return Array.from(data, b => String.fromCharCode(b & 0x7f || 0x21)).join('')
  }

  const glyphs = key.glyphs
  let result = ''

  for (let i = 0; i < data.length; i++) {
    const byte = data[i]

    // Préserver les espaces : vague ressemblance structurelle avec le texte original
    if (byte === 0x20) {
      result += ' '
      continue
    }

    // Caractère de base dérivé du byte
    const baseIdx  = byte % BASE_CHARS.length
    const base     = BASE_CHARS[baseIdx]

    // Nombre de diacritiques combinants : 0, 1 ou 2 (dérivé des bits 6-7)
    const numDiac  = (byte >> 6) & 0x03  // 0-3 → on plafonne à 2 pour la lisibilité
    const clipped  = Math.min(numDiac, 2)

    // Sélection des diacritiques
    let diacritics = ''
    for (let d = 0; d < clipped; d++) {
      const glyphIdx  = (byte + d * 37 + i * 7) % glyphs.length
      diacritics      += glyphs[glyphIdx]
    }

    result += base + diacritics
  }

  return result
}

// ── Chargement de la clé ─────────────────────────────────────────────────────

/**
 * Charge la clé ESY depuis l'API de l'instance.
 * Mise en cache en mémoire après le premier appel (clé stable par session).
 * Retourne null si l'instance n'a pas de instance.esy configuré.
 */
export async function loadEsyKey(): Promise<EsyKey | null> {
  if (_cachedKey !== null) return _cachedKey

  // Déduplique les appels concurrents
  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async () => {
    try {
      const res = await fetch('/api/v1/instance/esy-public', {
        credentials: 'same-origin',
      })
      if (!res.ok) return null

      const data = await res.json() as EsyKey & { enabled: boolean }
      if (!data.enabled) return null

      // Validation minimale
      if (
        !Array.isArray(data.permutation)         || data.permutation.length !== 256 ||
        !Array.isArray(data.inverse_permutation) || data.inverse_permutation.length !== 256 ||
        typeof data.noise_seed !== 'number'      ||
        typeof data.rounds !== 'number'          || data.rounds < 1 ||
        !Array.isArray(data.glyphs)              || data.glyphs.length < 16
      ) {
        console.warn('[ESY] Clé reçue invalide — barbarization désactivée')
        return null
      }

      // Vérification de cohérence : invPerm[perm[i]] doit être i pour tout i
      for (let i = 0; i < 256; i++) {
        if (data.inverse_permutation[data.permutation[i]] !== i) {
          console.warn('[ESY] Permutation inverse incohérente — barbarization désactivée')
          return null
        }
      }

      _cachedKey = data
      return _cachedKey
    } catch (e) {
      console.warn('[ESY] Impossible de charger la clé :', e)
      return null
    } finally {
      _fetchPromise = null
    }
  })()

  return _fetchPromise
}

/**
 * Invalide le cache (utile après reconnexion ou changement de session).
 */
export function clearEsyCache(): void {
  _cachedKey = null
  _fetchPromise = null
}

// ── Helpers pratiques ─────────────────────────────────────────────────────────

/**
 * Encode un Uint8Array en base64 URL-safe (sans padding).
 * Format utilisé pour stocker le ciphertext barbarisé en base de données.
 */
export function toBase64(buf: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Décode une chaîne base64 URL-safe en Uint8Array.
 */
export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const std    = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = std + '='.repeat((4 - std.length % 4) % 4)
  const binary = atob(padded)
  const buf    = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf
}
