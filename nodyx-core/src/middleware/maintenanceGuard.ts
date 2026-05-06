import { FastifyRequest, FastifyReply } from 'fastify'
import { getMaintenance } from '../services/maintenanceService'

// ════════════════════════════════════════════════════════════════════════════
//  Maintenance guard — global onRequest hook
//
//  When a maintenance window is active (set by backup create/restore), all
//  user-facing write requests get a 503 with a structured payload the frontend
//  can render as a friendly banner. Reads, admin endpoints, and the public
//  maintenance status endpoint stay open so the admin can keep working and
//  visitors can keep browsing existing content.
//
//  Skipped routes (always pass through):
//    - GET / HEAD (read-only)
//    - /api/v1/admin/*           (admin needs to keep working — restore is admin)
//    - /api/v1/instance/maintenance (the very endpoint the frontend polls)
//    - /api/v1/instance/info     (already public, light)
//    - /api/v1/widget-assets/*   (static asset stream)
//    - /socket.io/*              (long-lived connection — Socket.IO will reject
//                                 sends server-side if needed; closing here
//                                 would mass-disconnect everyone for nothing)
// ════════════════════════════════════════════════════════════════════════════

const SKIP_PREFIXES = [
  '/api/v1/admin',
  '/api/v1/instance/maintenance',
  '/api/v1/instance/info',
  '/api/v1/widget-assets',
  '/api/v1/widget-store-public',
  '/socket.io',
]

function shouldGuard(method: string, url: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  for (const prefix of SKIP_PREFIXES) {
    if (url.startsWith(prefix)) return false
  }
  return true
}

export async function maintenanceGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!shouldGuard(request.method, request.url)) return

  const status = await getMaintenance()
  if (!status.active) return

  return reply.code(503).send({
    error:  'Une opération de maintenance est en cours sur l\'instance. Réessaye dans quelques instants.',
    code:   'MAINTENANCE_IN_PROGRESS',
    reason: status.reason,
    since:  status.since,
    label:  status.label,
  })
}
