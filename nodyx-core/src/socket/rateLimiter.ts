/**
 * Socket.IO in-process rate limiter — fenêtre glissante par (userId, event)
 *
 * Algorithme : sliding window counter.
 * On garde pour chaque (userId, eventKey) un tableau de timestamps.
 * À chaque appel, on purge les timestamps hors fenêtre, on en ajoute un,
 * puis on compare le compte au plafond.
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

// Catalogue des règles par event
export const RATE_RULES: Record<string, RuleConfig> = {
  'chat:send':            { limit: 5,  windowMs: 1_000  },
  'chat:typing':          { limit: 3,  windowMs: 1_000  },
  'chat:react':           { limit: 10, windowMs: 1_000  },
  'chat:edit':            { limit: 5,  windowMs: 1_000  },
  'dm:send':              { limit: 5,  windowMs: 1_000  },
  'dm:typing':            { limit: 3,  windowMs: 1_000  },
  'presence:set_status':  { limit: 2,  windowMs: 5_000  },
  'whisper:message':      { limit: 5,  windowMs: 1_000  },
  'whisper:typing':       { limit: 3,  windowMs: 1_000  },
  'voice:speaking':       { limit: 10, windowMs: 1_000  },
  'jukebox:update':       { limit: 5,  windowMs: 1_000  },
}

// Clé composite : `${userId}::${eventKey}`
type BucketKey = string

// Chaque bucket est un tableau de timestamps (ms)
const _buckets = new Map<BucketKey, number[]>()

/**
 * Vérifie si l'action est autorisée pour cet utilisateur sur cet event.
 *
 * @returns `true` → autorisé, `false` → bloqué (rate limit atteint)
 */
export function checkRateLimit(userId: string, eventKey: string): boolean {
  const rule = RATE_RULES[eventKey]
  if (!rule) return true  // Pas de règle → toujours autorisé

  const key: BucketKey = `${userId}::${eventKey}`
  const now = Date.now()
  const cutoff = now - rule.windowMs

  // Récupère ou crée le bucket
  let timestamps = _buckets.get(key)
  if (!timestamps) {
    timestamps = []
    _buckets.set(key, timestamps)
  }

  // Purge les timestamps hors fenêtre (sliding window)
  let i = 0
  while (i < timestamps.length && timestamps[i] < cutoff) i++
  if (i > 0) timestamps.splice(0, i)

  // Vérifie le plafond
  if (timestamps.length >= rule.limit) {
    return false  // Rate limit atteint
  }

  // Enregistre ce nouvel appel
  timestamps.push(now)
  return true
}

// ── Nettoyage périodique ───────────────────────────────────────────────────────
// Supprime les buckets vides ou périmés pour éviter les fuites mémoire.
// Exécuté toutes les 5 minutes.

const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000

function cleanupBuckets(): void {
  const now = Date.now()
  for (const [key, timestamps] of _buckets) {
    // Détermine la fenêtre maximale possible pour cette clé
    const eventKey = key.split('::')[1]
    const rule = RATE_RULES[eventKey]
    const windowMs = rule?.windowMs ?? 60_000

    const cutoff = now - windowMs
    const validCount = timestamps.filter(t => t >= cutoff).length
    if (validCount === 0) {
      _buckets.delete(key)
    }
  }
}

// Démarre le timer de nettoyage (sans bloquer la fin du process Node)
const _cleanupTimer = setInterval(cleanupBuckets, CLEANUP_INTERVAL_MS)
_cleanupTimer.unref()
