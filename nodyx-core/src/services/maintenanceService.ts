// ════════════════════════════════════════════════════════════════════════════
//  Nodyx Maintenance Service
//
//  A single Redis flag — `nodyx:maintenance:meta` — that gates all user-facing
//  writes (registration, posts, messages, uploads...) while a critical
//  operation runs (backup create / restore / future schema migration).
//
//  Contract:
//    setMaintenance(reason, ttl)   → start a window with auto-expiry
//    clearMaintenance()            → end the window early
//    getMaintenance()              → { active, reason, since } | { active: false }
//
//  The TTL is a safety belt: if the operation crashes mid-flight without
//  reaching its `finally`, the flag self-clears after `ttl` seconds rather
//  than locking the instance forever.
//
//  Source of truth shape:
//    {
//      reason: 'backup_create' | 'backup_restore' | 'manual',
//      since:  ISO 8601 timestamp,
//      label?: string  // free text shown to users in the banner
//    }
// ════════════════════════════════════════════════════════════════════════════

import { redis } from '../config/database'

const KEY = 'maintenance:meta'   // ioredis keyPrefix 'nodyx:' is auto-applied

export type MaintenanceReason = 'backup_create' | 'backup_restore' | 'manual'

export interface MaintenanceMeta {
  reason: MaintenanceReason
  since:  string                 // ISO 8601
  label?: string
}

export interface MaintenanceStatus {
  active: boolean
  reason?: MaintenanceReason
  since?:  string
  label?:  string
}

export async function setMaintenance(
  reason: MaintenanceReason,
  ttlSeconds: number,
  label?: string,
): Promise<void> {
  const meta: MaintenanceMeta = {
    reason,
    since: new Date().toISOString(),
    label,
  }
  await redis.set(KEY, JSON.stringify(meta), 'EX', Math.max(60, ttlSeconds))
}

export async function clearMaintenance(): Promise<void> {
  await redis.del(KEY)
}

export async function getMaintenance(): Promise<MaintenanceStatus> {
  const raw = await redis.get(KEY)
  if (!raw) return { active: false }
  try {
    const meta = JSON.parse(raw) as MaintenanceMeta
    return { active: true, reason: meta.reason, since: meta.since, label: meta.label }
  } catch {
    // Corrupted value — treat as no maintenance, but clean it up so we don't
    // leave a stuck flag behind.
    await redis.del(KEY)
    return { active: false }
  }
}
