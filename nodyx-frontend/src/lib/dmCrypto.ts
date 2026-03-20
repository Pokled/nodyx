/**
 * NODYX — Pipeline de chiffrement E2E pour les DMs
 *
 * Architecture :
 *   [AES-256-GCM Layer 1] + [ESY Barbare Layer 2]
 *
 * Génération de la paire de clés (une fois par utilisateur) :
 *   ECDH P-256 via WebCrypto API (native navigateur, pas de lib externe)
 *   - Clé publique  → envoyée au serveur via PATCH /api/v1/users/me/public-key
 *   - Clé privée    → jamais envoyée, stockée en localStorage (JWK)
 *
 * Envoi d'un DM :
 *   1. Récupérer la clé publique du destinataire
 *   2. Dériver le secret partagé ECDH
 *   3. Chiffrer avec AES-256-GCM (nonce 12 bytes aléatoires)
 *   4. Barbariser avec ESY
 *   5. Encoder en base64 URL-safe
 *
 * Réception d'un DM :
 *   1. Débarbariser avec ESY
 *   2. Déchiffrer AES-256-GCM avec le secret partagé
 *   3. Afficher le texte clair dans le navigateur uniquement
 *
 * Stockage clé privée :
 *   localStorage["nodyx_ecdh_private"] = JWK stringifié
 *   localStorage["nodyx_ecdh_public"]  = base64 SPKI (aussi envoyé au serveur)
 *
 * IMPORTANT : La clé privée ne quitte jamais le navigateur.
 *             L'admin de l'instance ne peut pas lire les DMs.
 */

import { barbarize, debarbarize, loadEsyKey, toBase64, fromBase64, type EsyKey } from './esy'

// ── Constantes ────────────────────────────────────────────────────────────────

const ECDH_CURVE          = 'P-256'
const AES_ALGO            = 'AES-GCM'
const AES_KEY_LEN         = 256
const AES_NONCE_LEN       = 12    // bytes — recommandation GCM
const STORAGE_PRIV_KEY    = 'nodyx_ecdh_private'
const STORAGE_PUB_KEY     = 'nodyx_ecdh_public'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DmKeyPair {
  publicKeyB64:  string    // base64 SPKI — envoyé au serveur
  privateKeyJwk: string    // JWK stringifié — reste dans le browser
}

export interface EncryptedDm {
  ciphertext: string    // base64url : contenu barbarisé + chiffré AES-GCM
  nonce:      string    // base64url : 12 bytes nonce AES-GCM
}

// ── Génération et stockage des clés ──────────────────────────────────────────

/**
 * Génère une nouvelle paire ECDH P-256 et la stocke en localStorage.
 * Retourne la clé publique en base64 SPKI pour envoi au serveur.
 *
 * Si une paire existe déjà, elle est retournée sans régénération.
 */
export async function ensureKeyPair(): Promise<DmKeyPair> {
  // Déjà générée ?
  const stored = loadStoredKeyPair()
  if (stored) return stored

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    true,   // extractable — nécessaire pour le stockage JWK
    ['deriveKey', 'deriveBits'],
  )

  // Exporter clé publique en SPKI (base64) → envoyée au serveur
  const spkiBuf     = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const publicKeyB64 = toBase64(new Uint8Array(spkiBuf))

  // Exporter clé privée en JWK → stockée localement
  const privateJwk   = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  const privateKeyJwk = JSON.stringify(privateJwk)

  localStorage.setItem(STORAGE_PRIV_KEY, privateKeyJwk)
  localStorage.setItem(STORAGE_PUB_KEY,  publicKeyB64)

  return { publicKeyB64, privateKeyJwk }
}

/**
 * Charge la paire de clés depuis localStorage.
 * Retourne null si aucune paire n'a été générée.
 */
export function loadStoredKeyPair(): DmKeyPair | null {
  try {
    const priv = localStorage.getItem(STORAGE_PRIV_KEY)
    const pub  = localStorage.getItem(STORAGE_PUB_KEY)
    if (!priv || !pub) return null
    return { publicKeyB64: pub, privateKeyJwk: priv }
  } catch {
    return null
  }
}

/**
 * Retourne true si une paire de clés E2E est disponible pour cet utilisateur.
 */
export function hasKeyPair(): boolean {
  return !!loadStoredKeyPair()
}

/**
 * Supprime la paire de clés locale (ex : déconnexion, réinitialisation).
 * ATTENTION : les DMs chiffrés avec cette clé deviendront illisibles.
 */
export function clearKeyPair(): void {
  localStorage.removeItem(STORAGE_PRIV_KEY)
  localStorage.removeItem(STORAGE_PUB_KEY)
}

// ── Import des clés WebCrypto ─────────────────────────────────────────────────

/** Importe la clé privée ECDH depuis le JWK stocké. */
async function importPrivateKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString) as JsonWebKey
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    false,   // non extractable une fois re-importée
    ['deriveKey', 'deriveBits'],
  )
}

/** Importe la clé publique ECDH depuis le base64 SPKI. */
async function importPublicKey(b64Spki: string): Promise<CryptoKey> {
  const spki = fromBase64(b64Spki)
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    false,
    [],    // les clés publiques ECDH n'ont pas d'usages dans SubtleCrypto
  )
}

// ── Dérivation du secret partagé ECDH ────────────────────────────────────────

/**
 * Dérive une clé AES-256-GCM à partir de la paire ECDH (A privée × B publique).
 * Le résultat est le même quel que soit le sens (A×B = B×A).
 */
async function deriveAesKey(
  myPrivateKeyJwk: string,
  theirPublicKeyB64: string,
): Promise<CryptoKey> {
  const [myPrivKey, theirPubKey] = await Promise.all([
    importPrivateKey(myPrivateKeyJwk),
    importPublicKey(theirPublicKeyB64),
  ])

  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPubKey },
    myPrivKey,
    { name: AES_ALGO, length: AES_KEY_LEN },
    false,    // non extractable — on ne sort jamais la clé symétrique
    ['encrypt', 'decrypt'],
  )
}

// ── Chiffrement ───────────────────────────────────────────────────────────────

/**
 * Chiffre un message texte pour un destinataire donné.
 *
 * @param plaintext         Texte clair à chiffrer
 * @param myPrivateKeyJwk   Clé privée de l'expéditeur (JWK stringifié)
 * @param theirPublicKeyB64 Clé publique SPKI du destinataire (base64)
 * @returns { ciphertext, nonce } — les deux champs à stocker en base
 */
export async function encryptDm(
  plaintext:         string,
  myPrivateKeyJwk:   string,
  theirPublicKeyB64: string,
): Promise<EncryptedDm> {
  // 1. Dériver la clé AES partagée
  const aesKey = await deriveAesKey(myPrivateKeyJwk, theirPublicKeyB64)

  // 2. Générer un nonce aléatoire (jamais réutilisé)
  const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LEN))

  // 3. Chiffrer avec AES-256-GCM
  const encoder    = new TextEncoder()
  const plainBytes = encoder.encode(plaintext)
  const encrypted  = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv: nonce },
    aesKey,
    plainBytes,
  )

  // 4. Couche ESY — barbarize
  const esyKey   = await loadEsyKey()
  const cipherRaw = new Uint8Array(encrypted)
  const barbarized = esyKey ? barbarize(cipherRaw, esyKey) : cipherRaw

  return {
    ciphertext: toBase64(barbarized),
    nonce:      toBase64(nonce),
  }
}

// ── Déchiffrement ─────────────────────────────────────────────────────────────

/**
 * Déchiffre un DM reçu.
 *
 * @param ciphertext        base64url : données barbarisées + chiffrées
 * @param nonce             base64url : nonce AES-GCM
 * @param myPrivateKeyJwk   Clé privée du destinataire (JWK stringifié)
 * @param senderPublicKeyB64 Clé publique SPKI de l'expéditeur (base64)
 * @returns Texte clair, ou null si le déchiffrement échoue
 */
export async function decryptDm(
  ciphertext:          string,
  nonce:               string,
  myPrivateKeyJwk:     string,
  senderPublicKeyB64:  string,
): Promise<string | null> {
  try {
    // 1. Débarbariser (couche ESY inverse)
    const esyKey     = await loadEsyKey()
    const barbarized = fromBase64(ciphertext)
    const cipherRaw  = esyKey ? debarbarize(barbarized, esyKey) : barbarized

    // 2. Dériver la clé AES partagée
    const aesKey     = await deriveAesKey(myPrivateKeyJwk, senderPublicKeyB64)

    // 3. Déchiffrer AES-256-GCM
    const nonceBytes = fromBase64(nonce)
    const decrypted  = await crypto.subtle.decrypt(
      { name: AES_ALGO, iv: nonceBytes },
      aesKey,
      cipherRaw,
    )

    // 4. Décoder UTF-8
    return new TextDecoder().decode(decrypted)
  } catch {
    // Déchiffrement échoué (mauvaise clé, données corrompues, etc.)
    return null
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────

/**
 * Enregistre la clé publique de l'utilisateur sur le serveur.
 * À appeler une fois après ensureKeyPair(), ou après chaque re-génération.
 */
export async function registerPublicKey(publicKeyB64: string): Promise<void> {
  const res = await fetch('/api/v1/users/me/public-key', {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ public_key: publicKeyB64 }),
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error(`Impossible d'enregistrer la clé publique : ${res.status}`)
  }
}

/**
 * Récupère la clé publique d'un utilisateur depuis le serveur.
 * Retourne null si l'utilisateur n'a pas encore activé le chiffrement E2E.
 */
export async function fetchPublicKey(username: string): Promise<string | null> {
  const res = await fetch(`/api/v1/users/${encodeURIComponent(username)}/public-key`, {
    credentials: 'same-origin',
  })
  if (!res.ok) return null
  const { public_key } = await res.json() as { public_key: string | null }
  return public_key
}

// ── Initialisation auto ───────────────────────────────────────────────────────

/**
 * Initialise le chiffrement E2E pour l'utilisateur courant.
 *
 * - Génère la paire de clés si elle n'existe pas
 * - Enregistre la clé publique sur le serveur si nécessaire
 * - Retourne true si le chiffrement est actif, false sinon
 *
 * À appeler au montage du composant DM (une fois par session).
 */
export async function initDmEncryption(): Promise<boolean> {
  try {
    const pair     = await ensureKeyPair()
    const isNew    = !localStorage.getItem('nodyx_e2e_registered')

    // Enregistrer sur le serveur si jamais fait (ou si nouvelle clé)
    if (isNew) {
      await registerPublicKey(pair.publicKeyB64)
      localStorage.setItem('nodyx_e2e_registered', '1')
    }

    return true
  } catch (e) {
    console.warn('[DM Crypto] Initialisation échouée :', e)
    return false
  }
}

// ── Empreinte visuelle de clé ─────────────────────────────────────────────────

/**
 * Génère une "empreinte visuelle" de la clé publique d'un utilisateur.
 * Affichée sur le profil — permet la vérification hors-bande (comme Signal).
 *
 * Retourne une chaîne de 6 mots (format : "alpha-bravo-charlie-delta-echo-foxtrot")
 * dérivée du SHA-256 de la clé publique.
 */
const WORDLIST = [
  'alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel',
  'india','juliet','kilo','lima','mike','november','oscar','papa',
  'quebec','romeo','sierra','tango','uniform','victor','whiskey','xray',
  'yankee','zulu','nexus','nodyx','cipher','signal','delta','forge',
]

export async function keyFingerprint(publicKeyB64: string): Promise<string> {
  const raw    = fromBase64(publicKeyB64)
  const hash   = await crypto.subtle.digest('SHA-256', raw)
  const bytes  = new Uint8Array(hash)
  const words: string[] = []

  for (let i = 0; i < 6; i++) {
    // 2 bytes → 16-bit index → modulo wordlist length
    const idx = ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) % WORDLIST.length
    words.push(WORDLIST[idx])
  }

  return words.join('-')
}
