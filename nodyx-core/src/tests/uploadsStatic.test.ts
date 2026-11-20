// /uploads/ tel que le cœur le monte (config/uploadsStatic.ts) : les fichiers des
// membres sont servis, rien de caché ne l'est, rien hors du dossier non plus.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { uploadsStaticOptions } from '../config/uploadsStatic'

const dir = mkdtempSync(path.join(os.tmpdir(), 'uploads-static-'))
let app: FastifyInstance

beforeAll(async () => {
  mkdirSync(path.join(dir, 'uploads/avatars'), { recursive: true })
  mkdirSync(path.join(dir, 'uploads/.cache'), { recursive: true })
  writeFileSync(path.join(dir, 'uploads/avatars/a.png'), 'avatar')
  writeFileSync(path.join(dir, 'uploads/avatars/.gitkeep'), '')
  writeFileSync(path.join(dir, 'uploads/avatars/.cachee.png'), 'cachée')
  writeFileSync(path.join(dir, 'uploads/.env'), 'SECRET=1')
  writeFileSync(path.join(dir, 'uploads/.cache/x.txt'), 'cache')
  writeFileSync(path.join(dir, 'uploads/dix.txt'), '0123456789')
  writeFileSync(path.join(dir, 'secret.txt'), 'hors du dossier')
  app = Fastify()
  await app.register(fastifyStatic, uploadsStaticOptions(dir))
  await app.ready()
})
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers })

describe('/uploads/ : la configuration réelle du cœur', () => {
  it('sert les fichiers des membres, en entier ou par morceau', async () => {
    const r = await get('/uploads/avatars/a.png')
    expect([r.statusCode, r.body]).toEqual([200, 'avatar'])
    const part = await get('/uploads/dix.txt', { range: 'bytes=2-4' })
    expect([part.statusCode, part.body]).toEqual([206, '234'])
  })
  it('ne sert aucun fichier ni dossier caché : 404, comme s’il n’existait pas', async () => {
    for (const u of ['/uploads/.env', '/uploads/avatars/.gitkeep', '/uploads/avatars/.cachee.png', '/uploads/.cache/x.txt', '/uploads/%2eenv'])
      expect([u, (await get(u)).statusCode]).toEqual([u, 404])
  })
  it('ne sort jamais du dossier', async () => {
    for (const u of ['/uploads/../secret.txt', '/uploads/%2e%2e/secret.txt', '/uploads/avatars/..%2f..%2fsecret.txt']) {
      const r = await get(u)
      expect([u, r.statusCode === 200, r.body.includes('hors du dossier')]).toEqual([u, false, false])
    }
  })
})
