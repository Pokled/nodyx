import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      host:     process.env.DB_HOST     || '127.0.0.1',
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'nexus',
      user:     process.env.DB_USER     || 'nexus',
      password: process.env.DB_PASSWORD || '',
      max: 5,
    });
  }
  return _pool;
}

export interface DirectoryInstance {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  url: string;
  ip: string | null;
  language: string;
  country: string | null;
  members: number;
  online: number;
  version: string | null;
  status: 'pending' | 'active' | 'inactive' | 'banned';
  last_seen: string | null;
  registered_at: string;
  admin_email: string | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  lat: number | null;
  lng: number | null;
  geo_city: string | null;
}

export async function getAllInstances(): Promise<DirectoryInstance[]> {
  const pool = getPool();
  const { rows } = await pool.query<DirectoryInstance>(`
    SELECT id, slug, name, description, url, ip, language, country,
           members, online, version, status, last_seen, registered_at,
           admin_email, blocked_reason, blocked_at, lat, lng, geo_city
    FROM directory_instances
    ORDER BY registered_at DESC
  `);
  return rows;
}

export async function blockInstance(id: number, reason: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE directory_instances SET status='banned', blocked_reason=$1, blocked_at=NOW() WHERE id=$2`,
    [reason, id]
  );
}

export async function unblockInstance(id: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE directory_instances SET status='active', blocked_reason=NULL, blocked_at=NULL WHERE id=$1`,
    [id]
  );
}

export async function getStats() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE status='active')          AS active,
      COUNT(*) FILTER (WHERE status='banned')          AS banned,
      COALESCE(SUM(members),0)                         AS total_members,
      COALESCE(SUM(online),0)                          AS total_online
    FROM directory_instances
  `);
  return rows[0];
}
