/**
 * Webhooks : le catalogue des événements (CDC SPECS/NODYX_WEBHOOKS_CDC.md).
 *
 * Deux sortes de familles, séparées une fois pour toutes (D39) :
 *  - PUBLIQUES : ce que tout le monde peut déjà voir sur la communauté ;
 *  - D'ÉQUIPE : la modération. Elle nomme des membres : elle ne part JAMAIS vers
 *    une destination publique (refus à l'enregistrement ET filtre à l'envoi).
 */

export const PUBLIC_FAMILIES = ['forum_article', 'forum_pinned', 'music', 'calendar', 'polls', 'wiki', 'live', 'members'] as const
export const TEAM_FAMILIES = ['shield', 'sanctions', 'reports', 'held', 'appeals', 'ladder', 'og_settings', 'observations'] as const
export type PublicFamily = typeof PUBLIC_FAMILIES[number]
export type TeamFamily = typeof TEAM_FAMILIES[number]
export type Family = PublicFamily | TeamFamily
export const ALL_FAMILIES: readonly Family[] = [...PUBLIC_FAMILIES, ...TEAM_FAMILIES]

export const isPublicFamily = (f: string): f is PublicFamily => (PUBLIC_FAMILIES as readonly string[]).includes(f)
export const isTeamFamily = (f: string): f is TeamFamily => (TEAM_FAMILIES as readonly string[]).includes(f)
export const isFamily = (f: string): f is Family => isPublicFamily(f) || isTeamFamily(f)

/** Les familles cochées par défaut pour une nouvelle destination, selon sa sorte. */
export const DEFAULT_EVENTS: Record<'public' | 'team', Family[]> = {
  public: ['forum_article', 'music', 'calendar', 'live'],
  team: ['shield', 'sanctions', 'reports', 'held', 'appeals', 'ladder'],
}

/** Un événement, en valeurs : le texte se construit à l'envoi, dans la langue de l'instance. */
export interface NodyxEvent {
  type: string                  // ex. 'forum.article', 'sanction.mute'
  family: Family
  at: string
  actor?: { type: 'member' | 'octoguard' | 'system'; name?: string | null }
  target?: { type: string; name?: string | null }
  item?: { title?: string | null; excerpt?: string | null; category?: string | null; artist?: string | null; duration_seconds?: number | null; starts_at?: string | null; place?: string | null; game?: string | null }
  rule?: string | null
  place?: string | null
  details?: Record<string, string | number | boolean | null>
  /** Chemin dans la communauté (lien du message), relatif. */
  path?: string | null
  /** Le texte d'un message signalé : ne part que si la destination d'équipe l'a demandé. */
  text?: string | null
  test?: boolean
}

/**
 * Une entrée du journal d'OctoGuard devient un événement d'équipe. null : rien à
 * envoyer (réglage du webhook lui-même, bruit interne).
 */
export function fromOctoGuardLog(entry: { action: string; target_type: string | null; target_label: string | null; metadata?: Record<string, unknown> }): NodyxEvent | null {
  const a = entry.action.replace(/^octoguard\./, '')
  const md = (entry.metadata ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  // Un signalement d'un MEMBRE est journalisé au nom d'OctoGuard : c'est le membre qui signale
  const actorAuto = !md.reporter_id && (md.actor === 'octoguard:auto' || !!md.rule_id)
  const base = {
    at: new Date().toISOString(),
    actor: actorAuto ? { type: 'octoguard' as const } : { type: 'member' as const, name: str(md.actor_username) },
    // Le nom d'un membre visé se relit en base par son id (logger.ts) : `target_label` change de
    // sens selon l'action (pseudo, motif, lieu ou extrait du message), on ne s'y fie pas
    target: entry.target_type ? { type: entry.target_type, name: null } : undefined,
    rule: str(md.rule_name),
    // Signalement d'un membre : `target_label` est l'endroit du contenu signalé
    place: str(md.channel_name) ?? str(md.place) ?? (md.reporter_id ? str(entry.target_label) : null),
    // Le texte du message en cause (actions automatiques et messages retenus : `target_label` en
    // est l'extrait). Ne part que vers une destination d'équipe qui l'a demandé (shapeFor).
    text: (!md.reporter_id && (md.rule_id || /^(message_held|held_|would_)/.test(entry.action.replace(/^octoguard\./, '')))) ? str(entry.target_label) : null,
  }
  const ev = (type: string, family: Family, details?: NodyxEvent['details']): NodyxEvent => ({ ...base, type, family, ...(details ? { details } : {}) })
  const minutes = typeof md.duration_min === 'number' ? md.duration_min : null

  if (a.startsWith('would_')) return ev('observation.' + a.slice(6), 'observations')
  switch (a) {
    case 'warn_user': return ev('sanction.warn', 'sanctions')
    case 'mute_user': case 'escalation_mute': return ev('sanction.mute', 'sanctions', { duration_minutes: minutes })
    case 'unmute_user': return ev('sanction.unmute', 'sanctions')
    case 'ban_temp_user': case 'escalation_ban_temp': return ev('sanction.ban', 'sanctions', { duration_minutes: minutes })
    case 'delete_message': case 'hate_symbol_blocked': return ev('sanction.delete', 'sanctions')
    case 'action_undone': case 'false_positive': return ev('sanction.undone', 'sanctions')
    case 'report_filed': case 'notify': return ev('report.created', 'reports')
    case 'message_held': return ev('held.created', 'held')
    case 'held_approved': return ev('held.approved', 'held')
    case 'held_refused': case 'held_expired': return ev('held.refused', 'held')
    case 'appeal_filed': return ev('appeal.filed', 'appeals')
    case 'appeal_upheld': return ev('appeal.upheld', 'appeals')
    case 'appeal_overturned': return ev('appeal.overturned', 'appeals')
    case 'ladder_applied': return ev('ladder.applied', 'ladder', { step: (md.step as number) ?? null, sanction: str(md.sanction) })
    case 'ladder_proposed': return ev('ladder.pending', 'ladder', { step: (md.step as number) ?? null, sanction: str(md.sanction) })
    case 'ladder_approved': return ev('ladder.approved', 'ladder', { step: (md.step as number) ?? null, sanction: str(md.sanction) })
    case 'ladder_refused': case 'ladder_expired': case 'ladder_undone': return ev('ladder.dropped', 'ladder')
    case 'ladder_engine_alert': return ev('ladder.alert', 'ladder')
    // Le bouclier anti-raid (lot 6) : levé (à la main ou tout seul), proposé, baissé
    case 'shield_raised': return ev('shield.raised', 'shield', { minutes: (md.minutes as number) ?? null, until: str(md.until), reason: str(md.reason) })
    case 'shield_suggested': return ev('shield.suggested', 'shield')
    case 'shield_lowered': return ev('shield.lowered', 'shield')
    case 'enabled': return ev('octoguard.enabled', 'og_settings')
    case 'disabled': return ev('octoguard.disabled', 'og_settings')
  }
  if (/^(rule|profile|command|welcome|ladder_settings)_/.test(a) || a === 'ladder_settings') return ev('octoguard.settings', 'og_settings')
  return null
}
