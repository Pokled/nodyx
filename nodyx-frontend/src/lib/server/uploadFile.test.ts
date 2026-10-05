/**
 * Régression 03/10 : la carte de profil (card.png) lisait n'importe quel
 * fichier du serveur via un avatar `/uploads/../…`. Vrai dossier temporaire,
 * vrais fichiers, vrais liens symboliques.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readUploadFile, instanceUploadsDir } from './uploadFile'

let base: string
let uploads: string

beforeAll(() => {
	base = fs.mkdtempSync(path.join(os.tmpdir(), 'nodyx-uploads-'))
	uploads = path.join(base, 'uploads')
	fs.mkdirSync(path.join(uploads, 'avatars'), { recursive: true })
	fs.writeFileSync(path.join(uploads, 'avatars', 'ok.png'), 'PNGDATA')
	fs.writeFileSync(path.join(base, '.env'), 'JWT_SECRET=ne-doit-jamais-sortir')
	fs.writeFileSync(path.join(uploads, 'avatars', 'big.png'), Buffer.alloc(2048))
	fs.symlinkSync(path.join(base, '.env'), path.join(uploads, 'avatars', 'lien.png'))
	fs.symlinkSync('/dev/zero', path.join(uploads, 'avatars', 'zero.png'))
})
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe('readUploadFile', () => {
	it('lit un vrai avatar, en chemin relatif comme en URL absolue', () => {
		expect(readUploadFile('/uploads/avatars/ok.png', uploads)?.toString()).toBe('PNGDATA')
		expect(readUploadFile('https://demo.nodyx.org/uploads/avatars/ok.png', uploads)?.toString()).toBe('PNGDATA')
	})

	it('ne remonte jamais hors du dossier des uploads', () => {
		for (const bad of [
			'/uploads/../.env',
			'/uploads/avatars/../../.env',
			'/uploads/%2e%2e/.env',
			'/uploads/..\\.env',
			'/uploads//.env',
		]) expect(readUploadFile(bad, uploads), bad).toBeNull()
	})

	it('un lien symbolique qui pointe dehors est refusé', () => {
		expect(readUploadFile('/uploads/avatars/lien.png', uploads)).toBeNull()
	})

	it('/dev/zero (lecture sans fin) est refusé, même via un lien', () => {
		expect(readUploadFile('/uploads/avatars/zero.png', uploads)).toBeNull()
		expect(readUploadFile('/uploads/../../../../../../dev/zero', uploads)).toBeNull()
	})

	it('un fichier trop gros est refusé', () => {
		expect(readUploadFile('/uploads/avatars/big.png', uploads, 1024)).toBeNull()
		expect(readUploadFile('/uploads/avatars/big.png', uploads, 4096)).not.toBeNull()
	})

	it('absent ou invalide : null, sans exception', () => {
		expect(readUploadFile('/uploads/avatars/absent.png', uploads)).toBeNull()
		expect(readUploadFile('/icons/icon-192.png', uploads)).toBeNull()
		expect(readUploadFile('https://[mal-forme', uploads)).toBeNull()
	})
})

/**
 * Régression 05/10 : card.png cherchait les uploads dans /var/www/nexus en dur.
 * Sur vieuxlooters, demo, sleemstudio ou une installation standard (/opt/nodyx),
 * la carte s'affichait sans avatar alors que le fichier existait.
 */
describe('instanceUploadsDir', () => {
	it('se déduit du dossier de l\'instance, quel qu\'il soit', () => {
		expect(instanceUploadsDir('/opt/vieuxlooters/nodyx-frontend', {})).toBe('/opt/vieuxlooters/nodyx-core/uploads')
		expect(instanceUploadsDir('/opt/nodyx/nodyx-frontend', {})).toBe('/opt/nodyx/nodyx-core/uploads')
	})
	it('NODYX_UPLOADS_DIR force un autre chemin', () => {
		expect(instanceUploadsDir('/opt/nodyx/nodyx-frontend', { NODYX_UPLOADS_DIR: '/srv/uploads' })).toBe('/srv/uploads')
	})
	it('lit vraiment l\'avatar d\'une instance installée ailleurs que /var/www/nexus', () => {
		const instance = path.join(base, 'instance')
		fs.mkdirSync(path.join(instance, 'nodyx-core', 'uploads', 'avatars'), { recursive: true })
		fs.mkdirSync(path.join(instance, 'nodyx-frontend'), { recursive: true })
		fs.writeFileSync(path.join(instance, 'nodyx-core', 'uploads', 'avatars', 'a.jpg'), 'PHOTO')
		const dir = instanceUploadsDir(path.join(instance, 'nodyx-frontend'), {})
		expect(readUploadFile('https://autre.example/uploads/avatars/a.jpg', dir)?.toString()).toBe('PHOTO')
	})
	it('card.png n\'a plus de chemin d\'instance écrit en dur', () => {
		const src = fs.readFileSync(path.resolve(__dirname, '../../routes/users/[username]/card.png/+server.ts'), 'utf8')
		expect(src).not.toContain('/var/www/nexus')
		expect(src).toContain('instanceUploadsDir()')
	})
})
