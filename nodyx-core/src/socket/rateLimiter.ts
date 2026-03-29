/**
 * Socket.IO in-process rate limiter — fenêtre glissante par (userId, event)
 *
 * Algorithme : sliding window counter.
 * On garde pour chaque (userId, eventKey) un tableau de timestamps.
 * À chaque appel, on purge les timestamps hors de la fenêtre maximale,
 * puis on vérifie chaque règle (plusieurs règles possibles par event).
 *
 * Retourne 0 si l'action est autorisée, ou le délai d'attente en ms (>0) si bloquée.
 *
 * Pas de Redis : overhead inutile pour du rate-limit in-process.
 * La Map est nettoyée toutes les 5 minutes pour éviter les fuites mémoire.
 */

interface RuleConfig {
  /** Nombre maximum d'appels autorisés sur la fenêtre */
  limit: number
  /** Durée de la fenêtre en millisecondes */
  windowMs: number
}

// Catalogue des règles par event — plusieurs règles possibles par event
export const RATE_RULES: Record<string, RuleConfig[]> = {
  // Anti-spam chat : burst court + soutenu court
  'chat:send': [
    { limit: 5,  windowMs: 3_000  },  // max 5 messages en 3 s  → cooldown max ~3 s
    { limit: 15, windowMs: 15_000 },  // max 15 messages en 15 s → cooldown max ~15 s
  ],
  'chat:typing':          [{ limit: 3,  windowMs: 1_000  }],
  'chat:react':           [{ limit: 10, windowMs: 1_000  }],
  'chat:float_reaction':  [{ limit: 4,  windowMs: 1_000  }],  // réactions flottantes Twitch-style
  'chat:edit':            [{ limit: 5,  windowMs: 1_000  }],
  'dm:send':              [{ limit: 5,  windowMs: 1_000  }],
  'dm:typing':            [{ limit: 3,  windowMs: 1_000  }],
  'presence:set_status':  [{ limit: 2,  windowMs: 5_000  }],
  'whisper:message':      [{ limit: 5,  windowMs: 1_000  }],
  'whisper:typing':       [{ limit: 3,  windowMs: 1_000  }],
  'voice:speaking':       [{ limit: 10, windowMs: 1_000  }],
  'jukebox:update':       [{ limit: 5,  windowMs: 1_000  }],
  'jukebox:request_sync': [{ limit: 3,  windowMs: 1_000  }],
  'voice:ping':           [{ limit: 3,  windowMs: 1_000  }],
  'voice:stats':          [{ limit: 10, windowMs: 1_000  }],
}

// Clé composite : `${userId}::${eventKey}`
type BucketKey = string

// Chaque bucket est un tableau de timestamps (ms), trié croissant
const _buckets = new Map<BucketKey, number[]>()

/**
 * Vérifie si l'action est autorisée pour cet utilisateur sur cet event.
 *
 * @returns `0` → autorisé ; `>0` → bloqué, valeur = délai d'attente en ms
 */
export function checkRateLimit(userId: string, eventKey: string): number {
  const rules = RATE_RULES[eventKey]
  if (!rules) return 0  // Pas de règle → toujours autorisé

  const key: BucketKey = `${userId}::${eventKey}`
  const now = Date.now()

  // Récupère ou crée le bucket
  let timestamps = _buckets.get(key)
  if (!timestamps) {
    timestamps = []
    _buckets.set(key, timestamps)
  }

  // Purge les timestamps plus vieux que la fenêtre maximale (optimisation mémoire)
  const maxWindow = Math.max(...rules.map(r => r.windowMs))
  const globalCutoff = now - maxWindow
  let i = 0
  while (i < timestamps.length && timestamps[i] < globalCutoff) i++
  if (i > 0) timestamps.splice(0, i)

  // Vérifie chaque règle — bloque sur la première violation
  for (const rule of rules) {
    const cutoff = now - rule.windowMs
    let count = 0
    for (const t of timestamps) {
      if (t >= cutoff) count++
    }
    if (count >= rule.limit) {
      // RetryAfter : temps avant que le plus ancien timestamp de la fenêtre expire
      const oldest = timestamps.find(t => t >= cutoff)
      const retryAfter = oldest !== undefined ? oldest + rule.windowMs - now : rule.windowMs
      return Math.max(1, retryAfter)
    }
  }

  // Toutes les règles passent — enregistre ce nouvel appel
  timestamps.push(now)
  return 0
}

// ── Nettoyage périodique ───────────────────────────────────────────────────────
// Supprime les buckets vides ou périmés pour éviter les fuites mémoire.
// Exécuté toutes les 5 minutes.

const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000

function cleanupBuckets(): void {
  const now = Date.now()
  for (const [key, timestamps] of _buckets) {
    const eventKey = key.split('::')[1]
    const rules = RATE_RULES[eventKey]
    const maxWindowMs = rules ? Math.max(...rules.map(r => r.windowMs)) : 60_000

    const cutoff = now - maxWindowMs
    const validCount = timestamps.filter(t => t >= cutoff).length
    if (validCount === 0) {
      _buckets.delete(key)
    }
  }
}

// Démarre le timer de nettoyage (sans bloquer la fin du process Node)
const _cleanupTimer = setInterval(cleanupBuckets, CLEANUP_INTERVAL_MS)
_cleanupTimer.unref()
