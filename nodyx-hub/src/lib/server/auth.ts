import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from './db.js';

const SESSION_HOURS = Number(process.env.HUB_SESSION_HOURS ?? 8);

export function verifyPassword(password: string): boolean {
  const hash = process.env.HUB_PASSWORD_HASH;
  if (!hash) return false;
  return bcrypt.compareSync(password, hash);
}

export function createSession(ip: string): string {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expires = now + SESSION_HOURS * 60 * 60 * 1000;
  db.prepare(`INSERT INTO sessions (id, created_at, expires_at, ip) VALUES (?,?,?,?)`)
    .run(id, now, expires, ip);
  return id;
}

export function validateSession(id: string): boolean {
  if (!id) return false;
  const db = getDb();
  const row = db.prepare(`SELECT expires_at FROM sessions WHERE id=?`).get(id) as { expires_at: number } | undefined;
  if (!row) return false;
  if (Date.now() > row.expires_at) {
    db.prepare(`DELETE FROM sessions WHERE id=?`).run(id);
    return false;
  }
  return true;
}

export function deleteSession(id: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE id=?`).run(id);
}

export function cleanExpiredSessions(): void {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
}
