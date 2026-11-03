/**
 * OctoGuard 2 : les réglages acceptés pour chaque type de règle.
 *
 * Avant ce module, le serveur acceptait `params` tels quels (passthrough). Le
 * moteur retombe sur ses valeurs par défaut quand un réglage est absent, mais
 * il ne se protège PAS d'une valeur absurde : une inondation à 1 répétition,
 * -1 lien toléré ou 1 % de capitales font prendre TOUS les messages.
 *
 * Mêmes bornes que l'écran (nodyx-frontend, RuleDrawer) : l'API ne laisse pas
 * passer ce que l'interface refuse. Les planchers sont volontaires (Majuscules :
 * 5 lettres, 50 %). Les clés inconnues sont tolérées (anciens profils), les
 * clés connues sont vérifiées.
 */

import { z } from 'zod'

const int = (min: number, max: number) => z.number().int().min(min).max(max)

/**
 * Un site : « exemple.com », « *.exemple.com », ou « exemple.com/chemin »
 * (le chemin restreint l'entrée : « discord.com/invite » ne prend que les
 * invitations, pas tout discord.com).
 */
export const SITE_ENTRY = /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(\/[a-z0-9._~%/-]*)?$/i

const site = z.string().trim().max(253).regex(SITE_ENTRY)
const word = z.string().max(100)

export const PARAMS_BY_TYPE: Record<string, z.ZodTypeAny> = {
  link_spam:    z.object({ max_links: int(0, 50).optional() }).passthrough(),
  mention_spam: z.object({ max_mentions: int(1, 100).optional() }).passthrough(),
  caps:         z.object({ min_length: int(5, 500).optional(), threshold_percent: int(50, 100).optional() }).passthrough(),
  flood:        z.object({
    max_repeats: int(2, 50).optional(), repeat_window_s: int(5, 3600).optional(),
    max_messages: int(2, 100).optional(), burst_window_s: int(1, 600).optional(),
  }).passthrough(),
  zalgo:        z.object({ max_combining: int(1, 20).optional() }).passthrough(),
  link_domain:  z.object({ mode: z.enum(['whitelist', 'blacklist']).optional(), domains: z.array(site).max(200) }).passthrough(),
  // Le moteur ne lit que les 500 premiers mots : au-delà, ils seraient ignorés sans bruit.
  keywords:     z.object({ words: z.array(word).max(500).optional(), exceptions: z.array(word).max(500).optional() }).passthrough(),
  regex:        z.object({ pattern: z.string().min(1).max(1000), flags: z.string().regex(/^[gimsuy]*$/).max(6).optional() }).passthrough(),
}

export type ParamsProblem = { field: string; message: string }

/** null si les réglages conviennent au type, sinon le premier problème trouvé. */
export function checkRuleParams(type: string, params: unknown): ParamsProblem | null {
  const schema = PARAMS_BY_TYPE[type]
  if (!schema) return { field: 'type', message: `unknown rule type: ${type}` }
  const res = schema.safeParse(params ?? {})
  if (res.success) return null
  const issue = res.error.issues[0]
  return { field: issue.path.join('.') || 'params', message: issue.message }
}
