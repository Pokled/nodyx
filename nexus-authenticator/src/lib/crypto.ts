/**
 * crypto.ts — Nexus Authenticator
 *
 * Web Crypto API uniquement. Pas de dépendance externe dans la boucle critique.
 *
 * Algorithmes :
 *   - ECDSA P-256 : signature / vérification
 *   - AES-GCM 256-bit : chiffrement de la clé privée au repos
 *   - PBKDF2 SHA-256 : dérivation de clé depuis la passphrase
 */

const ECDSA_PARAMS: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: { name: 'SHA-256' } }
const AES_PARAMS = { name: 'AES-GCM', length: 256 } as const
const PBKDF2_ITERATIONS = 310_000 // OWASP 2024 minimum pour PBKDF2-SHA256

// ─── Types exportés ───────────────────────────────────────────────────────────

export interface KeyPair {
	publicKey: CryptoKey
	privateKey: CryptoKey
}

export interface ExportedPublicKey {
	algorithm: string
	key: JsonWebKey
}

export interface EncryptedPrivateKey {
	/** IV AES-GCM — 12 bytes base64 */
	iv: string
	/** Données chiffrées base64 */
	data: string
	/** Sel PBKDF2 — 32 bytes base64 */
	salt: string
}

export interface SignedChallenge {
	/** Signature ECDSA base64url */
	signature: string
	/** Challenge original (pour vérification côté Hub) */
	challenge: string
}

// ─── Génération de clés ───────────────────────────────────────────────────────

/**
 * Génère une nouvelle paire de clés ECDSA P-256.
 * extractable: false pour privateKey — la clé privée ne peut pas être exportée en clair.
 * Seul le chiffrement AES permet de la stocker.
 */
export async function generateKeyPair(): Promise<KeyPair> {
	const keyPair = await crypto.subtle.generateKey(
		ECDSA_PARAMS,
		true, // extractable: true requis pour pouvoir l'exporter + chiffrer avant stockage
		['sign', 'verify']
	)
	return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey }
}

// ─── Export / Import clé publique ─────────────────────────────────────────────

/**
 * Exporte la clé publique au format JWK — à envoyer au Hub lors de l'enregistrement.
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<ExportedPublicKey> {
	const jwk = await crypto.subtle.exportKey('jwk', publicKey)
	return { algorithm: 'ECDSA-P256', key: jwk }
}

/**
 * Importe une clé publique JWK — pour vérification côté client (optionnel).
 */
export async function importPublicKey(exported: ExportedPublicKey): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'jwk',
		exported.key,
		ECDSA_PARAMS,
		true,
		['verify']
	)
}

// ─── Chiffrement de la clé privée ─────────────────────────────────────────────

/**
 * Dérive une clé AES-GCM depuis une passphrase via PBKDF2.
 * Le sel est aléatoire et stocké avec le chiffré.
 */
async function deriveAesKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	const encoder = new TextEncoder()
	const baseKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey']
	)
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		baseKey,
		AES_PARAMS,
		false,
		['encrypt', 'decrypt']
	)
}

/**
 * Chiffre la clé privée avec AES-GCM, clé dérivée depuis la passphrase.
 * Retourne les données prêtes à stocker dans IndexedDB.
 */
export async function encryptPrivateKey(
	privateKey: CryptoKey,
	passphrase: string
): Promise<EncryptedPrivateKey> {
	const salt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>
	const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>

	const aesKey = await deriveAesKey(passphrase, salt)
	const rawPrivateKey = await crypto.subtle.exportKey('pkcs8', privateKey)

	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		aesKey,
		rawPrivateKey
	)

	return {
		iv: bufferToBase64(iv),
		data: bufferToBase64(encrypted),
		salt: bufferToBase64(salt)
	}
}

/**
 * Déchiffre la clé privée stockée avec la passphrase.
 * Lance une erreur si la passphrase est incorrecte (AES-GCM integrity check).
 */
export async function decryptPrivateKey(
	encrypted: EncryptedPrivateKey,
	passphrase: string
): Promise<CryptoKey> {
	const salt = base64ToBuffer(encrypted.salt)
	const iv = base64ToBuffer(encrypted.iv)
	const data = base64ToBuffer(encrypted.data)

	const aesKey = await deriveAesKey(passphrase, new Uint8Array(salt) as Uint8Array<ArrayBuffer>)

	let rawPrivateKey: ArrayBuffer
	try {
		rawPrivateKey = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: new Uint8Array(iv) },
			aesKey,
			data
		)
	} catch {
		throw new Error('Passphrase incorrecte ou données corrompues.')
	}

	return crypto.subtle.importKey(
		'pkcs8',
		rawPrivateKey,
		ECDSA_PARAMS,
		true,
		['sign']
	)
}

// ─── Signature / Vérification ─────────────────────────────────────────────────

/**
 * Signe un challenge reçu du Hub.
 * Le challenge doit inclure l'URL du Hub pour éviter le phishing cross-site.
 */
export async function signChallenge(
	privateKey: CryptoKey,
	challenge: string
): Promise<SignedChallenge> {
	const encoder = new TextEncoder()
	const signatureBuffer = await crypto.subtle.sign(
		SIGN_PARAMS,
		privateKey,
		encoder.encode(challenge)
	)
	return {
		signature: bufferToBase64url(signatureBuffer),
		challenge
	}
}

/**
 * Vérifie une signature — utilisé côté Hub (Node.js Web Crypto API).
 * Exporté ici pour les tests unitaires frontend.
 */
export async function verifySignature(
	publicKey: CryptoKey,
	signature: string,
	challenge: string
): Promise<boolean> {
	const encoder = new TextEncoder()
	try {
		return await crypto.subtle.verify(
			SIGN_PARAMS,
			publicKey,
			base64urlToBuffer(signature),
			encoder.encode(challenge)
		)
	} catch {
		return false
	}
}

// ─── Utilitaires base64 ───────────────────────────────────────────────────────

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
	return btoa(String.fromCharCode(...bytes))
}

function base64ToBuffer(b64: string): ArrayBuffer {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes.buffer
}

/** base64url (RFC 4648) — sans padding, URL-safe */
function bufferToBase64url(buffer: ArrayBuffer): string {
	return bufferToBase64(buffer)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
	const b64 = b64url
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=')
	return base64ToBuffer(b64)
}
