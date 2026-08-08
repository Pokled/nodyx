#!/usr/bin/env ts-node
// ─── nodyx-recover — reprendre la main sur son instance ──────────────────────
//
//   cd <instance>/nodyx-core
//   npm run recover                      # interactif : choisir un compte, obtenir un lien
//   npm run recover -- --list            # lister les propriétaires et admins
//   npm run recover -- --reset <qui>     # lien de réinitialisation pour <username|email>
//   npm run recover -- --promote <qui>   # promouvoir un compte en propriétaire
//
// ─── Le principe ─────────────────────────────────────────────────────────────
// Pour un auto-hébergement, le point d'ancrage de confiance n'est ni le mot de
// passe, ni l'e-mail, ni un appareil (tout ça peut être perdu) : c'est L'ACCÈS À
// LA MACHINE. Qui peut lancer cette commande sur le serveur EST le propriétaire.
// L'outil ne demande donc aucune authentification en ligne : il s'appuie sur le
// fait que tu as déjà un shell ici.
//
// Il ne démarre PAS l'application (ni Redis, ni Socket.IO). Il se connecte juste
// à la base, comme le cœur, et génère le MÊME jeton qu'un e-mail « mot de passe
// oublié » aurait envoyé. Tu ouvres le lien, tu tombes sur le formulaire de
// réinitialisation habituel. Robuste : marche même quand l'app est cassée.

import * as dotenv from 'dotenv'
import { Pool } from 'pg'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { generateResetToken } from './recoveryToken'

dotenv.config()

const RESET_TTL_SEC = 30 * 60 // 30 min : le temps de passer du terminal au navigateur

const db = new Pool({
	host:     process.env.DB_HOST,
	port:     Number(process.env.DB_PORT) || 5432,
	database: process.env.DB_NAME,
	user:     process.env.DB_USER,
	password: process.env.DB_PASSWORD,
})

const C = {
	reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
	green: '\x1b[32m', cyan: '\x1b[36m', red: '\x1b[31m', yellow: '\x1b[33m',
}
const ok   = (s: string) => console.log(`${C.green}✔${C.reset}  ${s}`)
const info = (s: string) => console.log(`${C.cyan}•${C.reset}  ${s}`)
const bad  = (s: string) => console.error(`${C.red}✘${C.reset}  ${s}`)

interface Account {
	id: string
	username: string
	email: string | null
	role: string
}

// Les rôles vivent dans community_members. On liste les décideurs de l'instance.
async function listPrivileged(): Promise<Account[]> {
	const { rows } = await db.query<Account>(
		`SELECT u.id, u.username, u.email, cm.role
		   FROM community_members cm
		   JOIN users u ON u.id = cm.user_id
		  WHERE cm.role IN ('owner', 'admin')
		  ORDER BY CASE cm.role WHEN 'owner' THEN 0 ELSE 1 END, u.username`,
	)
	return rows
}

async function findAccount(who: string): Promise<Account | null> {
	const { rows } = await db.query<Account>(
		`SELECT u.id, u.username, u.email, COALESCE(cm.role, 'member') AS role
		   FROM users u
		   LEFT JOIN community_members cm ON cm.user_id = u.id
		  WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1)
		  LIMIT 1`,
		[who],
	)
	return rows[0] ?? null
}

function frontendBase(): string {
	const url = process.env.FRONTEND_URL
	if (!url) {
		console.log(`${C.yellow}⚠${C.reset}  FRONTEND_URL absent du .env : je mets un lien relatif, remplace le domaine à la main.`)
		return ''
	}
	return url.replace(/\/$/, '')
}

// Cœur de l'outil : génère un lien de réinitialisation à usage unique, en
// réutilisant la table password_resets et donc le flux web existant.
async function mintResetLink(acc: Account): Promise<void> {
	const { rawToken, tokenHash, expiresAt } = generateResetToken(RESET_TTL_SEC)

	// Un seul lien actif à la fois, comme le flux « mot de passe oublié ».
	await db.query(`DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL`, [acc.id])
	await db.query(
		`INSERT INTO password_resets (user_id, token_hash, expires_at, ip_address, user_agent)
		 VALUES ($1, $2, $3, 'cli-recovery', 'nodyx-recover')`,
		[acc.id, tokenHash, expiresAt],
	)

	const link = `${frontendBase()}/reset-password/${rawToken}`
	console.log('')
	ok(`Lien de réinitialisation pour ${C.bold}${acc.username}${C.reset} (${acc.role}) :`)
	console.log('')
	console.log(`   ${C.cyan}${link}${C.reset}`)
	console.log('')
	info(`Valable 30 minutes, à usage unique. Ouvre-le dans un navigateur.`)
	info(`Toutes les sessions actives de ce compte seront invalidées au changement.`)
}

async function promote(acc: Account): Promise<void> {
	const communityId = (await db.query<{ id: string }>(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)).rows[0]?.id
	if (!communityId) { bad('Aucune communauté trouvée sur cette instance.'); return }

	await db.query(
		`INSERT INTO community_members (community_id, user_id, role)
		 VALUES ($1, $2, 'owner')
		 ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'owner'`,
		[communityId, acc.id],
	)
	ok(`${C.bold}${acc.username}${C.reset} est maintenant propriétaire de l'instance.`)
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

	console.log(`${C.bold}Nodyx — récupération d'accès${C.reset}  ${C.dim}(instance : ${process.env.DB_NAME ?? '?'})${C.reset}\n`)

	if (args.includes('--list')) {
		const accts = await listPrivileged()
		if (!accts.length) { bad('Aucun propriétaire ni admin. Utilise --promote <compte> pour en désigner un.'); return }
		for (const a of accts) info(`${a.role.padEnd(6)}  ${a.username}  ${C.dim}${a.email ?? '(sans email)'}${C.reset}`)
		return
	}

	const resetWho   = flag('--reset')
	const promoteWho = flag('--promote')

	if (promoteWho) {
		const acc = await findAccount(promoteWho)
		if (!acc) { bad(`Compte introuvable : ${promoteWho}`); process.exitCode = 1; return }
		const rl = readline.createInterface({ input, output })
		const ans = (await rl.question(`Promouvoir ${C.bold}${acc.username}${C.reset} en propriétaire ? [o/N] `)).trim().toLowerCase()
		rl.close()
		if (ans === 'o' || ans === 'oui' || ans === 'y') await promote(acc)
		else info('Annulé.')
		return
	}

	if (resetWho) {
		const acc = await findAccount(resetWho)
		if (!acc) { bad(`Compte introuvable : ${resetWho}`); process.exitCode = 1; return }
		await mintResetLink(acc)
		return
	}

	// Mode interactif : lister, choisir, générer.
	const accts = await listPrivileged()
	if (!accts.length) {
		bad('Aucun propriétaire ni admin sur cette instance.')
		info('Pour en désigner un :  npm run recover -- --promote <username|email>')
		return
	}
	console.log('Comptes à privilèges sur cette instance :\n')
	accts.forEach((a, i) => console.log(`  ${C.bold}[${i + 1}]${C.reset} ${a.role.padEnd(6)}  ${a.username}  ${C.dim}${a.email ?? '(sans email)'}${C.reset}`))
	console.log('')

	const rl = readline.createInterface({ input, output })
	const pick = (await rl.question('Réinitialiser lequel ? (numéro, ou Entrée pour annuler) ')).trim()
	rl.close()
	if (!pick) { info('Annulé.'); return }

	const idx = Number(pick) - 1
	if (!Number.isInteger(idx) || idx < 0 || idx >= accts.length) { bad('Choix invalide.'); process.exitCode = 1; return }
	await mintResetLink(accts[idx])
}

main()
	.catch((e) => { bad(`Erreur : ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1 })
	.finally(() => db.end())
