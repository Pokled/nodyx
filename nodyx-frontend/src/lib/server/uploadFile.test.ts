/**
 * Régression 03/10 : la carte de profil (card.png) lisait n'importe quel
 * fichier du serveur via un avatar `/uploads/../…`. Vrai dossier temporaire,
 * vrais fichiers, vrais liens symboliques.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readUploadFile } from './uploadFile'

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
