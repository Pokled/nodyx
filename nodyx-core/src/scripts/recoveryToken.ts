import crypto from 'crypto'

// ─── Jeton de réinitialisation, compatible avec /auth/reset-password ─────────
//
// L'endpoint POST /api/v1/auth/reset-password/:token attend un jeton dont il
// recalcule le SHA-256 pour retrouver la ligne password_resets. On génère ici
// EXACTEMENT le même format (32 octets aléatoires en hex, hash SHA-256), pour
// que le lien produit par l'outil de récupération soit consommé par le flux web
// déjà éprouvé, sans rien dupliquer côté serveur.
//
// Isolé dans son propre module pour être testable : un test prouve que ce que
// l'outil génère est bien accepté par l'endpoint réel.

export interface ResetToken {
	/** À mettre dans l'URL, montré une seule fois. Jamais stocké en clair. */
	rawToken:  string
	/** Ce qu'on stocke en base (colonne token_hash). */
	tokenHash: string
	expiresAt: Date
}

export function generateResetToken(ttlSeconds: number): ResetToken {
	const rawToken  = crypto.randomBytes(32).toString('hex')
	const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
	return { rawToken, tokenHash, expiresAt }
}

/** Le hash tel que l'endpoint le recalcule à partir du jeton reçu dans l'URL. */
export function hashResetToken(rawToken: string): string {
	return crypto.createHash('sha256').update(rawToken).digest('hex')
}
