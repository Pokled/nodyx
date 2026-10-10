/**
 * Lecture sur disque d'un fichier téléversé, à partir de son URL publique
 * (`/uploads/…` ou `https://hôte/uploads/…`), pour la carte de profil.
 *
 * Avant le 03/10, un simple path.join(UPLOADS_DIR, …) : un avatar
 * `/uploads/../../.env` faisait lire le .env du core, et
 * `/uploads/../../../../dev/zero` une lecture sans fin (mémoire saturée,
 * frontend à terre). Désormais, refus de :
 *  - tout segment « . » / « .. » / vide, « \ », « % », caractère nul ;
 *  - tout chemin dont la cible RÉELLE (liens symboliques résolus) sort du
 *    dossier des uploads ;
 *  - tout ce qui n'est pas un fichier ordinaire (périphérique, FIFO, dossier) ;
 *  - tout fichier plus gros que `maxBytes`.
 * Renvoie null dans tous ces cas : la carte s'affiche alors sans avatar.
 */
import fs from 'node:fs'
import path from 'node:path'

const PREFIX = '/uploads/'

export function readUploadFile(url: string, uploadsDir: string, maxBytes = 5 * 1024 * 1024): Buffer | null {
	let pathname: string
	try {
		pathname = /^https?:\/\//i.test(url) ? new URL(url).pathname : url
	} catch {
		return null
	}
	if (!pathname.startsWith(PREFIX) || /[\\%\0]/.test(pathname)) return null
	const segments = pathname.slice(PREFIX.length).split('/')
	if (segments.some(s => s === '' || s === '.' || s === '..')) return null

	try {
		const root = fs.realpathSync(uploadsDir)
		const real = fs.realpathSync(path.join(root, ...segments))
		if (!real.startsWith(root + path.sep)) return null
		const st = fs.statSync(real)
		if (!st.isFile() || st.size > maxBytes) return null
		return fs.readFileSync(real)
	} catch {
		return null   // absent, illisible, dossier des uploads introuvable
	}
}

/**
 * Dossier des uploads de CETTE instance : le frontend tourne dans
 * <instance>/nodyx-frontend, les uploads vivent dans <instance>/nodyx-core/uploads.
 * Avant le 05/10/2026, card.png lisait /var/www/nexus en dur : sur toute autre
 * instance, la carte de profil s'affichait sans avatar. NODYX_UPLOADS_DIR force
 * un autre chemin.
 */
export function instanceUploadsDir(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
	return env.NODYX_UPLOADS_DIR || path.resolve(cwd, '..', 'nodyx-core', 'uploads')
}
