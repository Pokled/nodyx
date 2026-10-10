/**
 * La suite de tests ne joint jamais les vrais services (09/10/2026).
 * Lancée dans /var/www/nexus/nodyx-core, dotenv lisait le .env de production :
 * 3 fichiers ouvraient alors une connexion au Redis de prod. setup.ts fixe
 * désormais Redis et PostgreSQL sur un port fermé ; ce test vérifie la
 * configuration RÉELLEMENT obtenue par le module, .env présent ou non.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { db, redis } from '../config/database'

afterAll(() => { redis.disconnect(); void db.end() })

describe('isolement des services pendant les tests', () => {
  it('Redis pointe vers un port fermé, jamais le vrai', () => {
    expect(redis.options.host).toBe('127.0.0.1')
    expect(redis.options.port).toBe(1)
  })
  it('PostgreSQL pointe vers un port fermé, jamais la vraie base', () => {
    const opts = (db as unknown as { options: { host: string; port: number } }).options
    expect(opts.host).toBe('127.0.0.1')
    expect(opts.port).toBe(1)
  })
})
