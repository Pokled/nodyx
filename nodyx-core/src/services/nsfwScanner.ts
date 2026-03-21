/**
 * nsfwScanner.ts — Détection de contenu NSFW dans les images uploadées.
 *
 * Dépend de `nsfwjs` + `@tensorflow/tfjs-node` (NON inclus par défaut).
 * Activation : NSFW_SCAN=true dans .env + installer les packages :
 *   npm install nsfwjs @tensorflow/tfjs-node
 *
 * Si les packages ne sont pas installés ou si la variable est absente,
 * le scanner est désactivé silencieusement (fail-open).
 *
 * Seuil par défaut : 70 % (Porn + Hentai cumulé).
 * Ajustable via NSFW_THRESHOLD (0.0–1.0).
 *
 * Catégories retournées par nsfwjs :
 *   Drawings, Hentai, Neutral, Porn, Sexy
 */

export interface NsfwScanResult {
  ok:      boolean
  reason?: string
}

// ── Cache modèle (chargé une seule fois au premier appel) ─────────────────────

let _model: unknown = null
let _loadPromise: Promise<unknown> | null = null

async function getModel(): Promise<unknown> {
  if (_model) return _model
  if (!_loadPromise) {
    _loadPromise = (async () => {
      const nsfwjs = await import('nsfwjs' as string)
      _model = await (nsfwjs as any).load()
      console.log('[NSFW] Modèle chargé')
      return _model
    })()
  }
  return _loadPromise
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse un buffer d'image pour détecter du contenu NSFW.
 *
 * @returns { ok: true } si propre ou scanner désactivé
 *          { ok: false, reason } si NSFW détecté
 */
export async function scanImageNSFW(buffer: Buffer): Promise<NsfwScanResult> {
  if (process.env.NSFW_SCAN !== 'true') return { ok: true }

  const threshold = parseFloat(process.env.NSFW_THRESHOLD ?? '0.7')

  try {
    const tf = await import('@tensorflow/tfjs-node' as string) as any
    const model = await getModel() as any

    const decoded = tf.node.decodeImage(buffer, 3) as any
    const predictions = await model.classify(decoded)
    decoded.dispose()

    const porn    = (predictions as any[]).find(p => p.className === 'Porn')?.probability    ?? 0
    const hentai  = (predictions as any[]).find(p => p.className === 'Hentai')?.probability  ?? 0
    const nsfw    = porn + hentai

    if (nsfw > threshold) {
      return {
        ok:     false,
        reason: `Contenu NSFW détecté (${Math.round(nsfw * 100)} %) — upload refusé`,
      }
    }

    return { ok: true }
  } catch (err: unknown) {
    // Si nsfwjs ou tfjs-node n'est pas installé → fail-open (ne pas bloquer)
    if ((err as any)?.code === 'MODULE_NOT_FOUND') {
      console.warn('[NSFW] nsfwjs / @tensorflow/tfjs-node non installé — scan désactivé')
    } else {
      console.error('[NSFW] Erreur scanner:', err)
    }
    return { ok: true }
  }
}
