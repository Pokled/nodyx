/**
 * Nodyx E2E — Chiffrement de bout en bout pour les DMs
 *
 * Stack :
 *   ECDH P-256 (WebCrypto natif) → secret partagé
 *   → AES-256-GCM (chiffrement principal, authentifié)
 *   → Couche ESY Barbare (défense en profondeur, propre à l'instance)
 *
 * La clé privée ne quitte JAMAIS le navigateur.
 * Elle est stockée dans IndexedDB comme CryptoKey non-extractable.
 * Le serveur ne voit que du ciphertext base64 opaque.
 */

import { browser } from '$app/environment'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EsyKey {
  permutation:         number[]
  inverse_permutation: number[]
  noise_seed:          number
  rounds:              number
  glyphs:              string[]
  fingerprint:         string
}

export interface EncryptedDM {
  ciphertext: string  // base64 — AES-GCM ciphertext après couche ESY
  nonce:      string  // base64 — 12 bytes IV aléatoire
}

export type E2EStatus =
  | 'active'     // Les deux ont une clé publique enregistrée → E2E complet
  | 'partial'    // Seulement moi ou l'autre a une clé → dégradé
  | 'inactive'   // Aucun ne l'a → messages en clair
  | 'unknown'    // Pas encore vérifié

// ── IndexedDB ──────────────────────────────────────────────────────────────────

const DB_NAME    = 'nodyx_e2e'
const DB_VERSION = 1
const STORE      = 'keys'
const KEY_ID     = 'ecdh_keypair'

interface StoredKeys {
  id:           string
  privateKey:   CryptoKey      // non-extractable — ne sort jamais du navigateur
  publicKeyJwk: JsonWebKey     // exportable — envoyé au serveur
}

function _openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function _loadStoredKeys(): Promise<StoredKeys | null> {
  const db = await _openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY_ID)
    req.onsuccess = () => { resolve(req.result ?? null); db.close() }
    req.onerror   = () => { reject(req.error); db.close() }
  })
}

async function _saveKeys(keys: StoredKeys): Promise<void> {
  const db = await _openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(keys)
    req.onsuccess = () => { resolve(); db.close() }
    req.onerror   = () => { reject(req.error); db.close() }
  })
}

// ── State (module-level cache) ─────────────────────────────────────────────────

let _keys:   StoredKeys | null = null
let _esyKey: EsyKey     | null = null

// ── Key management ────────────────────────────────────────────────────────────

/**
 * Initialise la paire ECDH.
 * Charge depuis IndexedDB si elle existe, sinon génère + stocke.
 * Retourne la clé publique en base64 (JWK encodé).
 */
export async function initKeyPair(): Promise<string> {
  if (!browser) throw new Error('E2E init requires browser context')

  if (_keys) return _jwkToB64(_keys.publicKeyJwk)

  // Essayer IndexedDB d'abord
  try {
    const stored = await _loadStoredKeys()
    if (stored) {
      _keys = stored
      return _jwkToB64(stored.publicKeyJwk)
    }
  } catch { /* IndexedDB indisponible (navigation privée, etc.) — génère en mémoire */ }

  // Générer une paire ECDH P-256 fraîche
  // private key non-extractable : le navigateur garantit qu'elle ne sort pas
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,                          // private key non-extractable
    ['deriveKey', 'deriveBits']
  )

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const keys: StoredKeys = { id: KEY_ID, privateKey: pair.privateKey, publicKeyJwk }

  // Tenter la persistance — silencieux si IDB indisponible
  try { await _saveKeys(keys) } catch { /* session-only en navigation privée */ }

  _keys = keys
  return _jwkToB64(publicKeyJwk)
}

/** Vérifie si une paire de clés existe localement. */
export async function hasKeyPair(): Promise<boolean> {
  if (!browser) return false
  if (_keys) return true
  const stored = await _loadStoredKeys()
  if (stored) _keys = stored
  return stored !== null
}

/** Retourne la clé publique base64 si disponible (null sinon). */
export async function getPublicKeyB64(): Promise<string | null> {
  if (!browser) return null
  if (_keys) return _jwkToB64(_keys.publicKeyJwk)
  const stored = await _loadStoredKeys()
  if (stored) { _keys = stored; return _jwkToB64(stored.publicKeyJwk) }
  return null
}

/**
 * Enregistre la clé publique sur le serveur.
 * N'envoie le PATCH que si la clé a changé depuis la dernière registration.
 */
export async function registerPublicKey(token: string): Promise<boolean> {
  if (!browser) return false
  try {
    const b64 = await initKeyPair()

    // Éviter d'écraser une clé identique sur le serveur à chaque chargement
    const lastRegistered = localStorage.getItem('nodyx_e2e_registered_key')
    if (lastRegistered === b64) return true  // déjà à jour

    const res = await fetch('/api/v1/users/me/public-key', {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ public_key: b64 }),
    })
    if (res.ok) {
      localStorage.setItem('nodyx_e2e_registered_key', b64)
    }
    return res.ok
  } catch {
    return false
  }
}

/**
 * Récupère la clé publique d'un utilisateur depuis le serveur.
 * Retourne null si l'utilisateur n'a pas encore activé E2E.
 */
export async function fetchPeerPublicKey(username: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/v1/users/${username}/public-key`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const { public_key } = await res.json()
    return public_key ?? null
  } catch {
    return null
  }
}

// ── ESY layer ─────────────────────────────────────────────────────────────────

export async function loadEsyKey(token: string): Promise<EsyKey> {
  if (_esyKey) return _esyKey

  const res = await fetch('/api/v1/instance/esy-public', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('ESY key not available')

  const data = await res.json()
  if (!data.enabled) throw new Error('ESY not configured on this instance')

  _esyKey = {
    permutation:         data.permutation,
    inverse_permutation: data.inverse_permutation,
    noise_seed:          data.noise_seed,
    rounds:              data.rounds,
    glyphs:              data.glyphs,
    fingerprint:         data.fingerprint,
  }
  return _esyKey
}

/** Récupère le fingerprint ESY sans charger toute la clé (pour affichage). */
export function getEsyFingerprint(): string | null {
  return _esyKey?.fingerprint ?? null
}

/**
 * xorshift32 — PRNG déterministe.
 * Même seed → même séquence → débarbarisation possible sans échange de données.
 */
function _xorshift32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s ^= (s << 13) >>> 0
    s ^= (s >> 17) >>> 0
    s ^= (s << 5)  >>> 0
    s >>>= 0
    return s & 0xFF
  }
}

/**
 * Barbarize : AES ciphertext → octets obfusqués ESY
 * Algorithme : N rounds de (substitution par permutation + XOR bruit PRNG)
 */
function _esyBarbarize(data: Uint8Array, key: EsyKey): Uint8Array {
  const next = _xorshift32(key.noise_seed)
  // Pré-générer tous les octets de bruit pour tous les rounds
  const noise = new Uint8Array(data.length * key.rounds)
  for (let i = 0; i < noise.length; i++) noise[i] = next()

  let result = new Uint8Array(data)
  for (let r = 0; r < key.rounds; r++) {
    const offset = r * data.length
    const out    = new Uint8Array(result.length)
    for (let i = 0; i < result.length; i++) {
      out[i] = key.permutation[result[i]] ^ noise[offset + i]
    }
    result = out
  }
  return result
}

/**
 * Debarbarize : octets ESY → AES ciphertext original
 * Inverse exact de barbarize (rounds appliqués en ordre inverse).
 */
function _esyDebarbarize(data: Uint8Array, key: EsyKey): Uint8Array {
  const next = _xorshift32(key.noise_seed)
  // Même seed → même séquence de bruit
  const noise = new Uint8Array(data.length * key.rounds)
  for (let i = 0; i < noise.length; i++) noise[i] = next()

  let result = new Uint8Array(data)
  // Rounds en ordre inverse
  for (let r = key.rounds - 1; r >= 0; r--) {
    const offset = r * data.length
    const out    = new Uint8Array(result.length)
    for (let i = 0; i < result.length; i++) {
      // XOR est son propre inverse — puis permutation inverse
      out[i] = key.inverse_permutation[result[i] ^ noise[offset + i]]
    }
    result = out
  }
  return result
}

/**
 * Génère la représentation visuelle "barbare" d'un message pour l'animation.
 * Utilise les glyphes ESY de l'instance — purement cosmétique.
 */
export function barbarizeVisual(text: string, esy: EsyKey, intensity = 0.4): string {
  if (!esy.glyphs.length) return text
  let out = ''
  for (const char of text) {
    out += char
    if (Math.random() < intensity) {
      const g = esy.glyphs[Math.floor(Math.random() * esy.glyphs.length)]
      out += g
    }
  }
  return out
}

// ── ECDH + AES-GCM ────────────────────────────────────────────────────────────

async function _deriveSharedKey(theirPublicKeyB64: string): Promise<CryptoKey> {
  if (!_keys) throw new Error('Key pair not initialized — call initKeyPair() first')

  const theirJwk = _b64ToJwk(theirPublicKeyB64)
  const theirKey = await crypto.subtle.importKey(
    'jwk',
    theirJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []  // pas de 'deriveKey' côté clé publique — normal
  )

  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirKey },
    _keys.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Chiffre un message DM.
 *   1. AES-256-GCM (clé dérivée via ECDH avec la clé publique du destinataire)
 *   2. Couche ESY Barbare
 *
 * Retourne { ciphertext, nonce } en base64, prêt à être stocké en base.
 */
export async function encryptDM(
  plaintext:         string,
  theirPublicKeyB64: string,
  token:             string
): Promise<EncryptedDM> {
  if (!browser) throw new Error('E2E requires browser context')
  if (!_keys)   await initKeyPair()

  const esy       = await loadEsyKey(token)
  const sharedKey = await _deriveSharedKey(theirPublicKeyB64)
  const nonce     = crypto.getRandomValues(new Uint8Array(12))

  // AES-256-GCM
  const aesResult = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    sharedKey,
    new TextEncoder().encode(plaintext)
  )

  // Couche ESY
  const esyCipher = _esyBarbarize(new Uint8Array(aesResult), esy)

  return {
    ciphertext: _u8ToB64(esyCipher),
    nonce:      _u8ToB64(nonce),
  }
}

/**
 * Déchiffre un message DM reçu.
 *   1. Débarbarisation ESY
 *   2. AES-256-GCM déchiffrement
 *
 * Retourne le texte clair, ou null en cas d'échec
 * (clé manquante, message corrompu, E2E pas encore activé de l'autre côté).
 */
export async function decryptDM(
  ciphertext:        string,
  nonce:             string,
  theirPublicKeyB64: string,
  token:             string
): Promise<string | null> {
  if (!browser) return null
  try {
    if (!_keys) {
      console.warn('[E2E] _keys null — calling initKeyPair()')
      await initKeyPair()
    }

    let esy: EsyKey
    try {
      esy = await loadEsyKey(token)
    } catch (e) {
      console.error('[E2E] loadEsyKey failed:', e)
      return null
    }

    let sharedKey: CryptoKey
    try {
      sharedKey = await _deriveSharedKey(theirPublicKeyB64)
    } catch (e) {
      console.error('[E2E] _deriveSharedKey failed (bad peerPublicKey?):', e)
      return null
    }

    // Débarbarisation ESY
    const aesBytes = _esyDebarbarize(_b64ToU8(ciphertext), esy)

    // AES-256-GCM
    try {
      const decoded = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: _b64ToU8(nonce).buffer as ArrayBuffer },
        sharedKey,
        aesBytes.buffer as ArrayBuffer
      )
      return new TextDecoder().decode(decoded)
    } catch (e) {
      console.error('[E2E] AES-GCM decrypt failed (wrong key or corrupted ciphertext):', e)
      return null
    }
  } catch (err) {
    console.error('[E2E] decryptDM unexpected error:', err)
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _jwkToB64(jwk: JsonWebKey): string {
  return btoa(JSON.stringify(jwk))
}

function _b64ToJwk(b64: string): JsonWebKey {
  return JSON.parse(atob(b64)) as JsonWebKey
}

function _u8ToB64(buf: Uint8Array): string {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s)
}

function _b64ToU8(b64: string): Uint8Array {
  const s   = atob(b64)
  const buf = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i)
  return buf
}
