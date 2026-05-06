// ════════════════════════════════════════════════════════════════════════════
//  Nodyx Backup Service — Phase 1 MVP (spec 014-backup-system)
//
//  Public API:
//    createBackup(opts)              → BackupRow
//    listBackups(opts?)              → { rows, total }
//    getBackup(id)                   → BackupRow | null
//    verifyBackup(id)                → { ok, errors }
//    deleteBackup(id, opts)
//    restoreBackup(id, opts)
//    getDiffPreview(id)              → DiffPreview
//    getStorageInfo()                → { used, available, total }
//    getBackupSettings()             → BackupSettingsRow
//    auditList(opts?)                → { rows, total }
//
//  Operations shell-out to `pg_dump`, `pg_restore`, and `tar` for performance
//  on large volumes. A Redis lock prevents two backups (or a backup and a
//  restore) from running concurrently. A pre-restore snapshot is created
//  automatically before any restore as a safety net.
// ════════════════════════════════════════════════════════════════════════════

import { db, redis }                                        from '../config/database'
import { spawn }                                             from 'child_process'
import { createReadStream, existsSync, statSync,
         promises as fsp }                                   from 'fs'
import path                                                  from 'path'
import os                                                    from 'os'
import crypto                                                from 'crypto'
import { setMaintenance, clearMaintenance }                  from './maintenanceService'

// ─── Constants ──────────────────────────────────────────────────────────────

const BACKUP_DIR     = process.env.BACKUP_DIR  || path.join(process.cwd(), 'backups')
const UPLOADS_DIR    = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads')
const FORMAT_VERSION = 1
const LOCK_KEY       = 'backup:lock'        // redis keyPrefix already adds 'nodyx:'
const LOCK_TTL_SEC   = 3600                 // 1h ceiling per job
const PRE_RESTORE_RETENTION_HOURS = 24

const NODYX_VERSION = (() => {
  try {
    const pkg = require(path.join(process.cwd(), 'package.json'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BackupContents { db: boolean; uploads: boolean; config: boolean }

export interface BackupStats {
  users:               number
  threads:             number
  posts:               number
  messages:            number
  uploads_count:       number
  uploads_size_bytes:  number
}

export interface BackupManifest {
  format_version: 1
  nodyx_version:  string
  created_at:     string
  instance:       { name?: string | null; slug?: string | null; language?: string | null }
  contents:       BackupContents
  stats:          BackupStats
  encryption:     'none' | 'aes-256-gcm'
  label?:         string
  checksum_algo:  'sha256'
}

export interface BackupRow {
  id:              string
  filename:        string
  size_bytes:      number
  nodyx_version:   string
  format_version:  number
  contents:        BackupContents
  stats:           BackupStats
  label:           string | null
  encrypted:       boolean
  checksum:        string
  created_at:      string
  created_by:      string | null
  source:          'manual' | 'scheduled' | 'pre-restore'
  protected:       boolean
  expires_at:      string | null
}

export interface CreateBackupOpts {
  include_uploads: boolean
  label?:          string
  source:          'manual' | 'scheduled' | 'pre-restore'
  created_by?:     string | null
  audit_actor?:    AuditActor
}

export interface RestoreBackupOpts {
  audit_actor?: AuditActor
  dry_run?:     boolean
}

export interface DeleteBackupOpts {
  audit_actor?:     AuditActor
  bypass_protected?: boolean
}

export interface AuditActor {
  user_id?:    string | null
  ip_address?: string | null
  user_agent?: string | null
}

export interface DiffPreview {
  current: BackupStats
  backup:  BackupStats
  delta:   {
    threads:        number
    posts:          number
    messages:       number
    users:          number
    uploads_count:  number
    uploads_bytes:  number
  }
}

// ─── Lock helpers ───────────────────────────────────────────────────────────

async function acquireLock(jobId: string): Promise<boolean> {
  const res = await redis.set(LOCK_KEY, jobId, 'EX', LOCK_TTL_SEC, 'NX')
  return res === 'OK'
}

async function releaseLock(jobId: string): Promise<void> {
  // Lua to ensure we only release the lock we own (no stomping on a job that
  // overran our local timer). Idempotent: returns 0 if already gone or owned
  // by someone else.
  const lua = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`
  // ioredis adds the keyPrefix to KEYS but not to ARGV. We pass the un-prefixed key.
  await redis.eval(lua, 1, LOCK_KEY, jobId)
}

// ─── pg_dump / pg_restore shell-outs ────────────────────────────────────────

interface PgEnv {
  PGHOST:     string
  PGPORT:     string
  PGUSER:     string
  PGPASSWORD: string
  PGDATABASE: string
  [k: string]: string
}

function pgEnv(): PgEnv {
  return {
    ...process.env as Record<string, string>,
    PGHOST:     process.env.DB_HOST     || 'localhost',
    PGPORT:     process.env.DB_PORT     || '5432',
    PGUSER:     process.env.DB_USER     || '',
    PGPASSWORD: process.env.DB_PASSWORD || '',
    PGDATABASE: process.env.DB_NAME     || '',
  }
}

function spawnAndCollect(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'inherit', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }))
  })
}

// Tables that are part of the backup system itself or migration tracking.
// Excluding them from the dump means a restore can never wipe out:
//   - the row of the backup being restored (and its FK in audit_log)
//   - the pre-restore snapshot row created seconds before the restore
//   - the auto-backup settings the admin spent time configuring
//   - the schema_migrations ledger (would otherwise rewind to the state at
//     dump time, breaking the migration runner's "is this applied?" check)
//
// Discovered the hard way during Phase 1 smoke test on prod: a real restore
// on 2026-05-06 wiped the pre-restore snapshot's DB row at the very moment
// it was supposed to act as the safety net. The .tar.gz file remained on
// disk but the UI couldn't find it. See git log for details.
const SYSTEM_TABLES_EXCLUDED_FROM_DUMP = [
  'backups',
  'backup_settings',
  'backup_audit_log',
  'schema_migrations',
]

async function dumpDatabase(outPath: string): Promise<void> {
  // --format=custom: pg_restore-friendly binary, parallelizable, smaller than plain SQL
  // --compress=9   : maximum gzip compression baked into the dump
  // --no-owner / --no-privileges : portable across users/roles (hosting on a different DB)
  // --exclude-table: keep meta-system tables out of the dump (see comment above)
  const excludeArgs = SYSTEM_TABLES_EXCLUDED_FROM_DUMP.flatMap(t => ['--exclude-table', t])
  const { code, stderr } = await spawnAndCollect(
    'pg_dump',
    ['--format=custom', '--compress=9', '--no-owner', '--no-privileges', ...excludeArgs, '-f', outPath],
    pgEnv(),
  )
  if (code !== 0) throw new Error(`pg_dump failed (code ${code}): ${stderr.trim().slice(-500)}`)
}

async function restoreDatabase(dumpPath: string): Promise<void> {
  // --clean    : DROP existing objects before recreating them
  // --if-exists: don't error if the object doesn't already exist (fresh DB)
  // --no-owner : don't try to set ownership (portable)
  // --single-transaction: atomic — either the whole restore applies or nothing does
  //
  // Note: the dump itself doesn't contain the system tables (see dumpDatabase),
  // so pg_restore cannot drop or rewrite them. The live `backups`,
  // `backup_audit_log`, `backup_settings` and `schema_migrations` tables
  // survive any restore intact.
  const { code, stderr } = await spawnAndCollect(
    'pg_restore',
    ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '-d', process.env.DB_NAME || '', dumpPath],
    pgEnv(),
  )
  if (code !== 0) throw new Error(`pg_restore failed (code ${code}): ${stderr.trim().slice(-500)}`)
}

// ─── tar shell-outs ─────────────────────────────────────────────────────────

async function createTarGz(workDir: string, archivePath: string, items: string[]): Promise<void> {
  const { code, stderr } = await spawnAndCollect(
    'tar',
    ['-czf', archivePath, '-C', workDir, ...items],
    process.env,
  )
  if (code !== 0) throw new Error(`tar create failed (code ${code}): ${stderr.trim().slice(-500)}`)
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const { code, stderr } = await spawnAndCollect(
    'tar',
    ['-xzf', archivePath, '-C', destDir],
    process.env,
  )
  if (code !== 0) throw new Error(`tar extract failed (code ${code}): ${stderr.trim().slice(-500)}`)
}

async function listTarEntries(archivePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', archivePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += c.toString() })
    child.stderr.on('data', (c) => { stderr += c.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`tar list failed: ${stderr}`))
      resolve(stdout.split('\n').filter(Boolean))
    })
  })
}

// ─── Checksum ──────────────────────────────────────────────────────────────

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end',  () => resolve(hash.digest('hex')))
  })
}

// ─── Disk helpers ──────────────────────────────────────────────────────────

async function ensureBackupDir(): Promise<void> {
  await fsp.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 })
}

async function freeBytes(dir: string): Promise<number> {
  // statfs is only available on POSIX. On unsupported systems we return Infinity
  // so the size pre-flight check effectively becomes a no-op rather than blocking.
  try {
    const fsStatfs = (fsp as unknown as { statfs?: (p: string) => Promise<{ bavail: bigint; bsize: bigint }> }).statfs
    if (!fsStatfs) return Number.POSITIVE_INFINITY
    const r = await fsStatfs(dir)
    return Number(r.bavail * r.bsize)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

async function dirSizeBytes(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    const ents = await fsp.readdir(cur, { withFileTypes: true })
    for (const ent of ents) {
      const p = path.join(cur, ent.name)
      if (ent.isDirectory()) stack.push(p)
      else if (ent.isFile()) {
        try { total += (await fsp.stat(p)).size } catch { /* ignore unreadable */ }
      }
    }
  }
  return total
}

async function dirFileCount(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    const ents = await fsp.readdir(cur, { withFileTypes: true })
    for (const ent of ents) {
      const p = path.join(cur, ent.name)
      if (ent.isDirectory()) stack.push(p)
      else if (ent.isFile()) total++
    }
  }
  return total
}

// ─── Stats gathering ───────────────────────────────────────────────────────

async function gatherStats(): Promise<BackupStats> {
  // We don't fail the backup if a count query fails — just return 0 for that field.
  // The stats are informational, not load-bearing.
  const safeCount = async (sql: string): Promise<number> => {
    try {
      const { rows } = await db.query(sql)
      return Number(rows[0]?.count || 0)
    } catch { return 0 }
  }
  const [users, threads, posts, messages, uploads_count] = await Promise.all([
    safeCount('SELECT COUNT(*)::bigint AS count FROM users'),
    safeCount('SELECT COUNT(*)::bigint AS count FROM threads'),
    safeCount('SELECT COUNT(*)::bigint AS count FROM posts'),
    safeCount('SELECT COUNT(*)::bigint AS count FROM messages'),
    Promise.resolve(0),
  ])
  const uploads_size_bytes = await dirSizeBytes(UPLOADS_DIR)
  const uploads_count_disk = await dirFileCount(UPLOADS_DIR)
  return {
    users,
    threads,
    posts,
    messages,
    uploads_count: uploads_count_disk,
    uploads_size_bytes,
  }
}

async function gatherInstanceMeta(): Promise<{ name: string | null; slug: string | null; language: string | null }> {
  // Prefer the env-pinned slug (matches adminOnly.ts behaviour and survives
  // multi-community fixtures where ORDER BY created_at would pick the wrong row).
  // The communities table has no `language` column — that lives in the env.
  const envSlug = process.env.NODYX_COMMUNITY_SLUG
  const language = process.env.NODYX_COMMUNITY_LANGUAGE || null
  try {
    if (envSlug) {
      const { rows } = await db.query(
        `SELECT name, slug FROM communities WHERE slug = $1 LIMIT 1`,
        [envSlug],
      )
      if (rows[0]) return { name: rows[0].name, slug: rows[0].slug, language }
    }
    const { rows } = await db.query(
      `SELECT name, slug FROM communities ORDER BY created_at ASC LIMIT 1`
    )
    if (rows[0]) return { name: rows[0].name, slug: rows[0].slug, language }
  } catch { /* table absent in fresh installs */ }
  return { name: null, slug: null, language }
}

// ─── Filename / slug helpers ───────────────────────────────────────────────

function sanitizeSlug(s: string | null | undefined): string {
  if (!s) return 'instance'
  return s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'instance'
}

function nowISO(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')   // safe for filenames
}

// ─── Audit log ─────────────────────────────────────────────────────────────

async function audit(action: 'create' | 'restore' | 'delete' | 'download' | 'verify' | 'settings_change',
                     args: {
                       backup_id?: string | null
                       actor?:     AuditActor
                       metadata?:  Record<string, unknown>
                       status:     'success' | 'failed'
                       error?:     string
                     }): Promise<void> {
  try {
    await db.query(
      `INSERT INTO backup_audit_log (backup_id, user_id, action, ip_address, user_agent, metadata, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        args.backup_id  ?? null,
        args.actor?.user_id    ?? null,
        action,
        args.actor?.ip_address ?? null,
        args.actor?.user_agent ?? null,
        args.metadata          ? JSON.stringify(args.metadata) : null,
        args.status,
        args.error ?? null,
      ],
    )
  } catch (e) {
    // never let audit logging break the operation it's tracking
    console.error('[backup] audit insert failed:', e)
  }
}

// ─── Public API : createBackup ─────────────────────────────────────────────

export async function createBackup(opts: CreateBackupOpts): Promise<BackupRow> {
  const jobId = crypto.randomUUID()

  if (!await acquireLock(jobId)) {
    throw new Error('Un autre backup ou restore est déjà en cours. Réessaye dans quelques minutes.')
  }

  // Block user-facing writes (registration, posts, uploads...) while the dump
  // is running. The pg_dump itself is read-only, but rows inserted between
  // dump moment and INSERT-of-this-row would be lost on restore (Yannick bug,
  // 2026-05-06). 30 min ceiling acts as a safety belt if the operation crashes.
  await setMaintenance('backup_create', 30 * 60, 'Sauvegarde en cours')

  let workDir: string | null = null
  let archivePath: string | null = null

  try {
    await ensureBackupDir()

    // Disk space pre-flight: refuse if we have less than 2x estimated archive size.
    // Estimation: uploads size + a generous 200 MB cushion for pg_dump.
    const uploadsBytes = opts.include_uploads ? await dirSizeBytes(UPLOADS_DIR) : 0
    const cushion     = 200 * 1024 * 1024
    const free        = await freeBytes(BACKUP_DIR)
    if (free < (uploadsBytes + cushion) * 2) {
      throw new Error(`Espace disque insuffisant (libre : ${(free / 1024 / 1024).toFixed(0)} MB, requis : ${((uploadsBytes + cushion) * 2 / 1024 / 1024).toFixed(0)} MB).`)
    }

    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nodyx-backup-'))
    const dumpPath = path.join(workDir, 'database.dump')
    const manifestPath = path.join(workDir, 'manifest.json')
    const checksumPath = path.join(workDir, 'checksum.sha256')

    // 1. pg_dump
    await dumpDatabase(dumpPath)

    // 2. uploads (optional) — copy via cp -a to preserve symlinks/timestamps
    const items = ['manifest.json', 'database.dump', 'checksum.sha256']
    if (opts.include_uploads && existsSync(UPLOADS_DIR)) {
      const uploadsCopy = path.join(workDir, 'uploads')
      await fsp.mkdir(uploadsCopy)
      const { code, stderr } = await spawnAndCollect('cp', ['-a', UPLOADS_DIR + '/.', uploadsCopy], process.env)
      if (code !== 0) throw new Error(`uploads copy failed: ${stderr}`)
      items.push('uploads')
    }

    // 3. config
    const configDir = path.join(workDir, 'config')
    await fsp.mkdir(configDir)
    const meta = await gatherInstanceMeta()
    await fsp.writeFile(path.join(configDir, 'instance.json'), JSON.stringify(meta, null, 2))
    items.push('config')

    // 4. stats + manifest
    const stats = await gatherStats()
    const manifest: BackupManifest = {
      format_version: FORMAT_VERSION,
      nodyx_version:  NODYX_VERSION,
      created_at:     new Date().toISOString(),
      instance:       meta,
      contents:       { db: true, uploads: opts.include_uploads, config: true },
      stats,
      encryption:     'none',
      label:          opts.label,
      checksum_algo:  'sha256',
    }
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    // 5. compute checksum of database.dump (most important payload) and write it
    const dumpChecksum = await sha256File(dumpPath)
    await fsp.writeFile(checksumPath, `${dumpChecksum}  database.dump\n`)

    // 6. tar everything
    const slug = sanitizeSlug(meta.slug)
    const filename = `nodyx-backup-${slug}-${nowISO()}.tar.gz`
    archivePath = path.join(BACKUP_DIR, filename)
    await createTarGz(workDir, archivePath, items)

    // 7. final SHA-256 of the archive itself
    const archiveChecksum = await sha256File(archivePath)
    const sizeBytes = statSync(archivePath).size

    // 8. insert DB row
    const expiresAt = opts.source === 'pre-restore'
      ? new Date(Date.now() + PRE_RESTORE_RETENTION_HOURS * 3600 * 1000).toISOString()
      : null
    const { rows } = await db.query<BackupRow>(
      `INSERT INTO backups
         (filename, size_bytes, nodyx_version, format_version, contents, stats,
          label, encrypted, checksum, created_by, source, protected, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        filename, sizeBytes, NODYX_VERSION, FORMAT_VERSION,
        JSON.stringify(manifest.contents),
        JSON.stringify(stats),
        opts.label || null,
        false,
        archiveChecksum,
        opts.created_by || null,
        opts.source,
        opts.source === 'pre-restore',
        expiresAt,
      ],
    )

    await audit('create', {
      backup_id: rows[0].id,
      actor:     opts.audit_actor,
      metadata:  { source: opts.source, include_uploads: opts.include_uploads, label: opts.label, size_bytes: sizeBytes },
      status:    'success',
    })

    return rows[0]

  } catch (err) {
    await audit('create', {
      actor:     opts.audit_actor,
      metadata:  { source: opts.source, include_uploads: opts.include_uploads },
      status:    'failed',
      error:     (err as Error).message,
    })
    if (archivePath && existsSync(archivePath)) {
      try { await fsp.unlink(archivePath) } catch { /* best-effort cleanup */ }
    }
    throw err
  } finally {
    if (workDir && existsSync(workDir)) {
      try { await fsp.rm(workDir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
    await releaseLock(jobId)
    // pre-restore snapshots are part of a larger restore window — leave the
    // maintenance flag set so the parent restoreBackup keeps the gate closed
    // until its own finally clears it.
    if (opts.source !== 'pre-restore') {
      await clearMaintenance().catch(() => { /* best-effort */ })
    }
  }
}

// ─── Public API : listBackups ──────────────────────────────────────────────

export async function listBackups(opts: { limit?: number; offset?: number } = {}): Promise<{ rows: BackupRow[]; total: number }> {
  const limit  = Math.min(Math.max(1, opts.limit  ?? 50), 200)
  const offset = Math.max(0, opts.offset ?? 0)
  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query<BackupRow>(
      `SELECT * FROM backups ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    db.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM backups'),
  ])
  return { rows, total: Number(countRows[0].count) }
}

// ─── Public API : getBackup ────────────────────────────────────────────────

export async function getBackup(id: string): Promise<BackupRow | null> {
  const { rows } = await db.query<BackupRow>('SELECT * FROM backups WHERE id = $1', [id])
  return rows[0] ?? null
}

// ─── Public API : verifyBackup ─────────────────────────────────────────────

export async function verifyBackup(id: string): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  const row = await getBackup(id)
  if (!row) return { ok: false, errors: ['backup introuvable en base'] }

  const filePath = path.join(BACKUP_DIR, row.filename)
  if (!existsSync(filePath)) {
    errors.push(`fichier absent : ${row.filename}`)
    return { ok: false, errors }
  }

  const onDiskSize = statSync(filePath).size
  if (onDiskSize !== Number(row.size_bytes)) {
    errors.push(`taille fichier (${onDiskSize}) != taille en base (${row.size_bytes})`)
  }

  const actualChecksum = await sha256File(filePath)
  if (actualChecksum !== row.checksum) {
    errors.push(`checksum SHA-256 ne correspond pas : ${actualChecksum} != ${row.checksum}`)
  }

  // Verify the archive lists the expected entries
  try {
    const entries = await listTarEntries(filePath)
    const required = ['manifest.json', 'database.dump', 'checksum.sha256']
    for (const r of required) {
      if (!entries.includes(r)) errors.push(`entrée manquante dans l'archive : ${r}`)
    }
  } catch (e) {
    errors.push(`impossible de lire le contenu de l'archive : ${(e as Error).message}`)
  }

  return { ok: errors.length === 0, errors }
}

// ─── Public API : deleteBackup ─────────────────────────────────────────────

export async function deleteBackup(id: string, opts: DeleteBackupOpts = {}): Promise<void> {
  const row = await getBackup(id)
  if (!row) throw new Error('backup introuvable')

  if (row.protected && !opts.bypass_protected) {
    const expiry = row.expires_at ? new Date(row.expires_at).toLocaleString('fr-FR') : 'date inconnue'
    throw new Error(`backup protégé (snapshot pré-restore), suppression refusée jusqu'à ${expiry}`)
  }

  const filePath = path.join(BACKUP_DIR, row.filename)
  try {
    if (existsSync(filePath)) await fsp.unlink(filePath)
  } catch (e) {
    await audit('delete', { backup_id: id, actor: opts.audit_actor, status: 'failed', error: (e as Error).message })
    throw e
  }

  await db.query('DELETE FROM backups WHERE id = $1', [id])
  await audit('delete', { backup_id: id, actor: opts.audit_actor, metadata: { filename: row.filename }, status: 'success' })
}

// ─── Public API : restoreBackup ────────────────────────────────────────────

export async function restoreBackup(id: string, opts: RestoreBackupOpts = {}): Promise<void> {
  const row = await getBackup(id)
  if (!row) throw new Error('backup introuvable')

  // Compatibility check — refuse a backup from a future format version we don't know
  if (row.format_version > FORMAT_VERSION) {
    throw new Error(`Format ${row.format_version} non supporté (max ${FORMAT_VERSION}). Mets à jour Nodyx avant de restorer.`)
  }

  // Verify integrity before doing anything destructive
  const verify = await verifyBackup(id)
  if (!verify.ok) {
    throw new Error(`Vérification d'intégrité échouée : ${verify.errors.join(' ; ')}`)
  }

  if (opts.dry_run) {
    await audit('restore', { backup_id: id, actor: opts.audit_actor, metadata: { dry_run: true }, status: 'success' })
    return
  }

  const jobId = crypto.randomUUID()
  if (!await acquireLock(jobId)) {
    throw new Error('Un autre backup ou restore est déjà en cours.')
  }

  // Restore is the most disruptive operation: DB gets dropped + recreated,
  // sessions are flushed. Block writes for the whole window (including the
  // pre-restore snapshot phase). 60 min safety belt.
  await setMaintenance('backup_restore', 60 * 60, 'Restauration en cours')

  let extractDir: string | null = null

  try {
    // 1. Pre-restore snapshot — release lock first because createBackup needs it.
    await releaseLock(jobId)
    const snapshot = await createBackup({
      include_uploads: row.contents.uploads,
      label:           `auto-snapshot avant restore de ${row.filename}`,
      source:          'pre-restore',
      created_by:      opts.audit_actor?.user_id ?? null,
      audit_actor:     opts.audit_actor,
    })
    if (!await acquireLock(jobId)) {
      throw new Error('Lock perdu pendant le snapshot pré-restore.')
    }

    // 2. Extract the archive into a temp dir
    extractDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nodyx-restore-'))
    const archivePath = path.join(BACKUP_DIR, row.filename)
    await extractTarGz(archivePath, extractDir)

    // 3. pg_restore
    const dumpPath = path.join(extractDir, 'database.dump')
    if (!existsSync(dumpPath)) throw new Error('database.dump absent dans l\'archive')
    await restoreDatabase(dumpPath)

    // 4. Restore uploads if present in the archive
    const uploadsExtract = path.join(extractDir, 'uploads')
    if (existsSync(uploadsExtract)) {
      // Replace the live uploads with what's in the backup. We do not delete
      // first — we sync via cp -a so existing files get overwritten and any
      // leftover files in the live dir that aren't in the backup remain.
      // Phase 2 will offer a "strict" mode that mirrors exactly.
      await fsp.mkdir(UPLOADS_DIR, { recursive: true })
      const { code, stderr } = await spawnAndCollect('cp', ['-a', uploadsExtract + '/.', UPLOADS_DIR], process.env)
      if (code !== 0) throw new Error(`uploads restore failed: ${stderr}`)
    }

    // 5. Invalidate all sessions — DB users got restored so existing tokens
    // may reference users that no longer exist (or have stale data).
    try {
      const keys = await redis.keys('session:*')
      if (keys.length) await redis.del(...keys)
    } catch (e) {
      console.warn('[backup] could not flush sessions after restore:', e)
    }

    await audit('restore', {
      backup_id: id,
      actor:     opts.audit_actor,
      metadata:  { snapshot_id: snapshot.id, snapshot_filename: snapshot.filename },
      status:    'success',
    })

  } catch (err) {
    await audit('restore', {
      backup_id: id,
      actor:     opts.audit_actor,
      status:    'failed',
      error:     (err as Error).message,
    })
    throw err
  } finally {
    if (extractDir && existsSync(extractDir)) {
      try { await fsp.rm(extractDir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
    await releaseLock(jobId)
    await clearMaintenance().catch(() => { /* best-effort */ })
  }
}

// ─── Public API : getDiffPreview ───────────────────────────────────────────

export async function getDiffPreview(id: string): Promise<DiffPreview> {
  const row = await getBackup(id)
  if (!row) throw new Error('backup introuvable')
  const current = await gatherStats()
  const backup  = row.stats
  return {
    current,
    backup,
    delta: {
      threads:       current.threads       - backup.threads,
      posts:         current.posts         - backup.posts,
      messages:      current.messages      - backup.messages,
      users:         current.users         - backup.users,
      uploads_count: current.uploads_count - backup.uploads_count,
      uploads_bytes: current.uploads_size_bytes - backup.uploads_size_bytes,
    },
  }
}

// ─── Public API : getStorageInfo ───────────────────────────────────────────

export async function getStorageInfo(): Promise<{ used: number; available: number; total: number }> {
  const used      = await dirSizeBytes(BACKUP_DIR)
  const available = await freeBytes(BACKUP_DIR)
  const total     = used + (Number.isFinite(available) ? available : 0)
  return { used, available: Number.isFinite(available) ? available : 0, total }
}

// ─── Public API : getBackupSettings ────────────────────────────────────────

export async function getBackupSettings(): Promise<Record<string, unknown>> {
  const { rows } = await db.query('SELECT * FROM backup_settings WHERE id = 1')
  return rows[0] || {}
}

// ─── Public API : auditList ────────────────────────────────────────────────

export async function auditList(opts: { limit?: number; offset?: number; backup_id?: string } = {}): Promise<{ rows: unknown[]; total: number }> {
  const limit  = Math.min(Math.max(1, opts.limit  ?? 50), 200)
  const offset = Math.max(0, opts.offset ?? 0)
  if (opts.backup_id) {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      db.query(
        `SELECT a.*, u.username FROM backup_audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.backup_id = $1
         ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,
        [opts.backup_id, limit, offset],
      ),
      db.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM backup_audit_log WHERE backup_id = $1', [opts.backup_id]),
    ])
    return { rows, total: Number(countRows[0].count) }
  }
  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(
      `SELECT a.*, u.username FROM backup_audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    db.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM backup_audit_log'),
  ])
  return { rows, total: Number(countRows[0].count) }
}

// ─── Public API : helpers exposed for routes/tests ─────────────────────────

export function getBackupFilePath(filename: string): string {
  // path.basename() prevents traversal — even if someone manages to inject
  // "../etc/passwd" the resolved path stays inside BACKUP_DIR.
  return path.join(BACKUP_DIR, path.basename(filename))
}

export function backupDir(): string { return BACKUP_DIR }
export function uploadsDir(): string { return UPLOADS_DIR }
export function nodyxVersion(): string { return NODYX_VERSION }

// ─── Audit helper exposed for routes (download tracking) ───────────────────

export async function recordDownload(id: string, actor: AuditActor): Promise<void> {
  await audit('download', { backup_id: id, actor, status: 'success' })
}

// ─── Public API : reindexBackups ───────────────────────────────────────────
//
// Scans BACKUP_DIR for .tar.gz files, parses each archive's manifest.json,
// and INSERTs missing rows in the `backups` table. Idempotent (ON CONFLICT
// DO NOTHING on filename uniqueness, plus a defensive ID check).
//
// Use case: rebuild the DB tracking after a stale state, or after a manual
// .tar.gz drop into the directory by an operator. Files whose manifest is
// unreadable or whose archive is corrupt are skipped (and reported in the
// returned summary) rather than aborting the whole reindex.

export interface ReindexSummary {
  scanned:  number
  added:    number
  existing: number
  skipped:  { filename: string; reason: string }[]
}

export async function reindexBackups(actor?: AuditActor): Promise<ReindexSummary> {
  await ensureBackupDir()
  const summary: ReindexSummary = { scanned: 0, added: 0, existing: 0, skipped: [] }

  let entries: string[] = []
  try {
    entries = await fsp.readdir(BACKUP_DIR)
  } catch {
    return summary
  }
  const archives = entries.filter(n => n.endsWith('.tar.gz'))
  summary.scanned = archives.length

  // Pull existing filenames once to avoid one query per archive.
  const { rows: existing } = await db.query<{ filename: string }>(
    'SELECT filename FROM backups',
  )
  const existingSet = new Set(existing.map(r => r.filename))

  for (const filename of archives) {
    const filePath = path.join(BACKUP_DIR, filename)
    if (existingSet.has(filename)) {
      summary.existing++
      continue
    }

    try {
      // Read manifest.json out of the archive without extracting everything.
      const manifestText = await new Promise<string>((resolve, reject) => {
        const child = spawn('tar', ['-xzOf', filePath, 'manifest.json'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        child.stdout.on('data', c => { out += c.toString() })
        child.stderr.on('data', c => { err += c.toString() })
        child.on('error', reject)
        child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim() || `tar exit ${code}`)))
      })

      const manifest = JSON.parse(manifestText) as BackupManifest
      const checksum = await sha256File(filePath)
      const sizeBytes = statSync(filePath).size
      const isPreRestore = (manifest.label || '').toLowerCase().includes('avant restore')

      await db.query(
        `INSERT INTO backups
           (filename, size_bytes, nodyx_version, format_version, contents, stats,
            label, encrypted, checksum, source, protected, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT DO NOTHING`,
        [
          filename,
          sizeBytes,
          manifest.nodyx_version || '0.0.0',
          manifest.format_version || 1,
          JSON.stringify(manifest.contents || { db: true, uploads: false, config: true }),
          JSON.stringify(manifest.stats || {}),
          manifest.label || null,
          manifest.encryption === 'aes-256-gcm',
          checksum,
          isPreRestore ? 'pre-restore' : 'manual',
          false,                              // expired snapshots are not protected anymore
          null,
        ],
      )
      summary.added++
    } catch (e) {
      summary.skipped.push({ filename, reason: (e as Error).message.slice(0, 200) })
    }
  }

  await audit('settings_change', {
    actor,
    metadata:  { reindex: summary.added + ' added, ' + summary.existing + ' existing, ' + summary.skipped.length + ' skipped' },
    status:    'success',
  })

  return summary
}
