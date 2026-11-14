// Les commandes « ! » que l'aide montre (SPECS/NODYX_COMMANDES_CDC.md, C6, D58) :
// seulement celles qui MARCHENT pour la personne, là où elle les tape.
//  - OctoGuard : quand il tourne, les commandes allumées que son rôle peut lancer,
//    avec les salons où elles marchent (« ici » si tous les salons).
//  - Twitch : quand une chaîne est reliée, les commandes natives et celles écrites
//    par l'équipe, à taper « dans le chat Twitch de <chaîne> ».
// JAMAIS le texte d'une réponse (l'équipe l'écrit pour le chat, pas pour l'aide).
import { db } from '../config/database'
import { isOctoGuardEnabled } from './octoguard'

export interface BangCommand {
  name: string                    // sans le « ! »
  source: 'octoguard' | 'twitch'
  /** OctoGuard : réservée à certains rôles. Twitch : aux modérateurs du chat Twitch. */
  restricted: boolean
  /** OctoGuard : les salons où elle marche (absent = partout). */
  channels?: { id: string; name: string }[]
  /** Twitch : commande native (sa description est traduite dans l'aide). */
  native?: boolean
}
export interface BangCommands { commands: BangCommand[]; twitch: string | null }

const strip = (n: string) => n.replace(/^!/, '')

async function octoguardCommands(viewerId: string | null): Promise<BangCommand[]> {
  if (!viewerId || !isOctoGuardEnabled()) return []
  const { rows: member } = await db.query<{ role: string; community_id: string }>(
    `SELECT role, community_id FROM community_members WHERE user_id = $1 LIMIT 1`, [viewerId])
  if (!member.length) return []
  const { role, community_id } = member[0]
  const { rows } = await db.query<{ command: string; allowed_channels: string[] | null; allowed_roles: string[] | null }>(
    `SELECT command, allowed_channels, allowed_roles FROM octoguard_commands WHERE enabled = true ORDER BY command`)
  const usable = rows.filter(r => !r.allowed_roles?.length || r.allowed_roles.includes(role))
  const ids = [...new Set(usable.flatMap(r => r.allowed_channels ?? []))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { rows: chans } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM channels WHERE id = ANY($1::uuid[]) AND community_id = $2`, [ids, community_id])
    for (const c of chans) names.set(c.id, c.name)
  }
  return usable.flatMap(r => {
    const channels = (r.allowed_channels ?? []).filter(id => names.has(id)).map(id => ({ id, name: names.get(id)! }))
    // Limitée à des salons qui n'existent plus : elle ne marche nulle part, on ne l'annonce pas
    if (r.allowed_channels?.length && !channels.length) return []
    return [{ name: strip(r.command), source: 'octoguard' as const, restricted: !!r.allowed_roles?.length, ...(channels.length ? { channels } : {}) }]
  })
}

async function twitchCommands(): Promise<{ login: string | null; commands: BangCommand[] }> {
  const { rows } = await db.query<{ external_login: string }>(
    `SELECT external_login FROM streamer_oauth_tokens WHERE provider = 'twitch' ORDER BY created_at DESC LIMIT 1`)
  if (!rows.length) return { login: null, commands: [] }
  const { getNativeChatCommands } = await import('./streamer/streamerHubService')
  const native = getNativeChatCommands().map(c => ({ name: strip(c.name), source: 'twitch' as const, restricted: c.modOnly, native: true }))
  const { rows: custom } = await db.query<{ name: string; mod_only: boolean }>(
    `SELECT name, mod_only FROM streamer_chat_commands WHERE enabled = true ORDER BY name`)
  // Une commande personnalisée homonyme d'une native ne s'exécute jamais (la native
  // passe d'abord, streamerHubService) : on ne l'annonce pas. Vécu le 14/11 : « !nodyx ».
  const nativeNames = new Set(native.map(c => c.name))
  return {
    login: rows[0].external_login,
    commands: [...native, ...custom.filter(c => !nativeNames.has(strip(c.name))).map(c => ({ name: strip(c.name), source: 'twitch' as const, restricted: c.mod_only }))],
  }
}

export async function bangCommands(viewerId: string | null): Promise<BangCommands> {
  const [og, tw] = await Promise.all([
    octoguardCommands(viewerId).catch(() => []),
    twitchCommands().catch(() => ({ login: null, commands: [] as BangCommand[] })),
  ])
  return { commands: [...og, ...tw.commands], twitch: tw.login }
}
