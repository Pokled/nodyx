// Stockage clé/valeur des extensions.
//
// Deux règles portent tout le reste.
//
// 1. L'extension ne nomme JAMAIS son propre espace. La clé d'extension vient
//    du jeton, la portée est validée ici, et l'identifiant d'utilisateur vient
//    de la session portée par le jeton. Une requête ne peut pas designer
//    l'espace d'une autre extension ni d'un autre membre.
//
// 2. Un quota en octets ne suffit pas. Sans limites fines, une extension épuise
//    le processeur et la base sans jamais approcher son mégaoctet : des clés
//    interminables, du JSON profond, des écritures en rafale.
//
// Module sans import de base : il reçoit sa fonction de requête, comme
// l'installateur. cf SPECS/NODYX_SDK_REFERENCE.md §9, NODYX_SDK_SECURITY.md §4.5

import { STORAGE } from './limits'

export type Scope = 'user' | 'instance'

export type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>

export interface StorageCaller {
  extensionId: string
  /** Utilisateur de la session portée par le jeton, ou null pour un visiteur. */
  userId:      string | null
  /** Capacités ACCORDÉES par l'admin, telles qu'elles voyagent dans le jeton. */
  granted:     string[]
  /** Quota en octets accordé pour cette portée. */
  quotaBytes:  number
}

export type StorageError =
  | 'PERMISSION_DENIED' | 'NOT_AUTHENTICATED' | 'INVALID_ARGUMENT'
  | 'KEY_TOO_LONG' | 'VALUE_TOO_LARGE' | 'TOO_MANY_KEYS' | 'JSON_TOO_DEEP'
  | 'QUOTA_EXCEEDED' | 'NOT_FOUND'

export type StorageResult<T> =
  | { ok: true;  value: T }
  | { ok: false; code: StorageError; message: string }

const RE_KEY = /^[A-Za-z0-9_.:-]+$/

function fail(code: StorageError, message: string): StorageResult<never> {
  return { ok: false, code, message }
}

/** Profondeur d'une valeur JSON, tableaux compris. */
export function jsonDepth(value: unknown, depth = 1): number {
  if (value === null || typeof value !== 'object') return depth
  if (depth > STORAGE.maxJsonDepth) return depth
  let max = depth
  for (const v of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, jsonDepth(v, depth + 1))
  }
  return max
}

/** Taille sérialisée, en octets, telle qu'elle sera stockée. */
export function valueBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
}

export function validateKey(key: unknown): StorageResult<string> {
  if (typeof key !== 'string' || key.length === 0) return fail('INVALID_ARGUMENT', 'clé absente')
  if (key.length > STORAGE.maxKeyLength)           return fail('KEY_TOO_LONG', `clé au delà de ${STORAGE.maxKeyLength} caractères`)
  if (!RE_KEY.test(key))                           return fail('INVALID_ARGUMENT', 'clé aux caractères refusés')
  return { ok: true, value: key }
}

/**
 * Résout la portée demandée en droit effectif.
 *
 * Règle des deux axes : la capacité de l'extension et les droits de
 * l'utilisateur sont deux dimensions distinctes, et le droit effectif est leur
 * intersection. Une extension qui détient l'écriture partagée n'écrit pas
 * parce qu'un membre a ouvert son interface.
 */
export function resolveScope(
  raw: unknown,
  caller: StorageCaller,
  intent: 'read' | 'write',
): StorageResult<{ scope: Scope; userId: string | null }> {
  const scope = raw === undefined ? 'user' : raw
  if (scope !== 'user' && scope !== 'instance') return fail('INVALID_ARGUMENT', 'portée inconnue')

  if (scope === 'user') {
    if (!caller.granted.includes('storage.user')) return fail('PERMISSION_DENIED', 'la capacité storage.user n\'a pas été accordée')
    if (!caller.userId)                           return fail('NOT_AUTHENTICATED', 'la portée utilisateur exige une session : gardez l\'état en mémoire pour un visiteur')
    return { ok: true, value: { scope, userId: caller.userId } }
  }

  const needed = intent === 'write' ? 'storage.instance.write' : 'storage.instance.read'
  if (!caller.granted.includes(needed)) return fail('PERMISSION_DENIED', `la capacité ${needed} n'a pas été accordée`)
  return { ok: true, value: { scope, userId: null } }
}

// ── Opérations ───────────────────────────────────────────────────────────────

export async function storageGet(caller: StorageCaller, rawKey: unknown, rawScope: unknown, query: QueryFn): Promise<StorageResult<unknown>> {
  const key = validateKey(rawKey)
  if (!key.ok) return key
  const scope = resolveScope(rawScope, caller, 'read')
  if (!scope.ok) return scope

  const { rows } = await query(
    `SELECT value FROM extension_storage
      WHERE extension_id = $1 AND scope = $2 AND user_id IS NOT DISTINCT FROM $3 AND key = $4`,
    [caller.extensionId, scope.value.scope, scope.value.userId, key.value],
  )
  const row = rows[0] as { value: unknown } | undefined
  return { ok: true, value: row ? row.value : undefined }
}

export async function storageSet(caller: StorageCaller, rawKey: unknown, value: unknown, rawScope: unknown, query: QueryFn): Promise<StorageResult<{ bytes: number }>> {
  const key = validateKey(rawKey)
  if (!key.ok) return key
  const scope = resolveScope(rawScope, caller, 'write')
  if (!scope.ok) return scope

  if (value === undefined) return fail('INVALID_ARGUMENT', 'valeur absente : utilisez delete pour retirer une clé')

  let bytes: number
  try {
    bytes = valueBytes(value)
  } catch {
    return fail('INVALID_ARGUMENT', 'valeur non sérialisable : pas de référence circulaire, pas de Map, pas de Date')
  }
  if (bytes > STORAGE.maxValueBytes)              return fail('VALUE_TOO_LARGE', `valeur au delà de ${STORAGE.maxValueBytes / 1024} Ko`)
  if (jsonDepth(value) > STORAGE.maxJsonDepth)    return fail('JSON_TOO_DEEP', `imbrication au delà de ${STORAGE.maxJsonDepth} niveaux`)

  // On mesure l'espace occupé SANS la clé visée : une réécriture ne doit pas
  // se faire refuser au motif de la place qu'elle libère.
  const { rows } = await query(
    `SELECT count(*)::int AS n, coalesce(sum(bytes), 0)::int AS total
       FROM extension_storage
      WHERE extension_id = $1 AND scope = $2 AND user_id IS NOT DISTINCT FROM $3 AND key <> $4`,
    [caller.extensionId, scope.value.scope, scope.value.userId, key.value],
  )
  const { n, total } = (rows[0] ?? { n: 0, total: 0 }) as { n: number; total: number }

  if (n + 1 > STORAGE.maxKeysPerScope)     return fail('TOO_MANY_KEYS', `au delà de ${STORAGE.maxKeysPerScope} clés pour cette portée`)
  if (total + bytes > caller.quotaBytes)   return fail('QUOTA_EXCEEDED', `quota de ${Math.round(caller.quotaBytes / 1024)} Ko atteint`)

  await query(
    `INSERT INTO extension_storage (extension_id, scope, user_id, key, value, bytes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (extension_id, scope, user_id, key)
     DO UPDATE SET value = $5, bytes = $6, updated_at = now()`,
    [caller.extensionId, scope.value.scope, scope.value.userId, key.value, JSON.stringify(value), bytes],
  )
  return { ok: true, value: { bytes } }
}

export async function storageDelete(caller: StorageCaller, rawKey: unknown, rawScope: unknown, query: QueryFn): Promise<StorageResult<{ deleted: boolean }>> {
  const key = validateKey(rawKey)
  if (!key.ok) return key
  const scope = resolveScope(rawScope, caller, 'write')
  if (!scope.ok) return scope

  const { rows } = await query(
    `DELETE FROM extension_storage
      WHERE extension_id = $1 AND scope = $2 AND user_id IS NOT DISTINCT FROM $3 AND key = $4
      RETURNING key`,
    [caller.extensionId, scope.value.scope, scope.value.userId, key.value],
  )
  return { ok: true, value: { deleted: rows.length > 0 } }
}

export async function storageList(caller: StorageCaller, rawScope: unknown, query: QueryFn): Promise<StorageResult<Array<{ key: string; bytes: number; updatedAt: string }>>> {
  const scope = resolveScope(rawScope, caller, 'read')
  if (!scope.ok) return scope

  const { rows } = await query(
    `SELECT key, bytes, updated_at FROM extension_storage
      WHERE extension_id = $1 AND scope = $2 AND user_id IS NOT DISTINCT FROM $3
      ORDER BY key`,
    [caller.extensionId, scope.value.scope, scope.value.userId],
  )
  return {
    ok: true,
    value: (rows as Array<{ key: string; bytes: number; updated_at: string | Date }>).map(r => ({
      key: r.key, bytes: r.bytes, updatedAt: new Date(r.updated_at).toISOString(),
    })),
  }
}
