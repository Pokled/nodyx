// Prévenir les personnes mentionnées : le point UNIQUE, pour le chat et le forum
// (SPECS/NODYX_MENTIONS_CDC.md). Avant le 13/11/2026, chaque endroit avait sa copie :
// le premier message d'un nouveau sujet ne prévenait personne, et la notification sur
// le téléphone d'une mention du chat affichait le HTML brut du message.
//
// Destinataires = personnes mentionnées (resolveMentions) + groupes développés au
// serveur (mentionGroups, droits vérifiés, plafonné). Jamais l'auteur. Une personne qui
// regarde déjà le salon n'est pas dérangée (elle lit le message en direct).
import { db } from '../config/database'
import { io } from '../socket/io'
import * as NotificationModel from '../models/notification'
import { resolveMentions } from '../utils/mentions'
import { groupRecipients, isTeam } from './mentionGroups'
import { recipientRules, accepts, isQuietNow } from './mentionPrefs'
import { sendPushToUser } from '../routes/notifications'
import { resolveServerLocale, pushStrings } from '../i18n/serverStrings'

export type MentionWhere =
  | { kind: 'chat'; channelId: string; messageId?: string | null }
  | { kind: 'forum'; threadId: string; postId: string | null }

/** Texte brut court d'un message (pour la notification du téléphone). Jamais de HTML. */
export function plainText(html: string, max = 80): string {
  const t = (html ?? '')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

export async function notifyMentions(opts: {
  html: string
  communityId: string
  actorId: string
  actorName: string
  where: MentionWhere
}): Promise<number> {
  const { html, communityId, actorId, actorName, where } = opts
  const people = await resolveMentions(html, communityId).catch(() => [] as string[])
  const groups = await groupRecipients(html, communityId, actorId).catch(() => new Map<string, string>())
  const recipients = new Map<string, string | null>()
  people.forEach(id => recipients.set(id, null))
  groups.forEach((key, id) => { if (!recipients.has(id)) recipients.set(id, key) })
  recipients.delete(actorId)
  if (!recipients.size) return 0

  // D54-D55 : ce que chaque destinataire accepte (sourdine, « qui peut me mentionner »,
  // heures calmes). L'équipe passe toujours : c'est elle qui protège.
  const actorTeam = await isTeam(communityId, actorId).catch(() => false)
  const rules = await recipientRules([...recipients.keys()], actorId).catch(() => new Map())

  // Qui regarde déjà ce salon : pas dérangé
  const viewing = new Set<string>()
  if (where.kind === 'chat' && io) {
    const sockets = await io.in(`channel:${where.channelId}`).fetchSockets().catch(() => [])
    sockets.forEach(s => { if (s.data.activeChannel === where.channelId) viewing.add(s.data.userId as string) })
  }

  const body = plainText(html)
  let sent = 0
  for (const [userId, group] of recipients) {
    if (viewing.has(userId)) continue
    const rule = rules.get(userId)
    if (rule && !accepts(rule, actorTeam)) continue
    // Heures calmes : la notification attend dans la cloche, sans son ni téléphone
    const quiet = !!rule && isQuietNow(rule.prefs)
    const meta: Record<string, unknown> = where.kind === 'chat'
      ? { channel_id: where.channelId, ...(where.messageId ? { message_id: where.messageId } : {}) }
      : {}
    if (group) meta.group = group
    if (quiet) meta.quiet = true
    try {
      await NotificationModel.create({
        user_id: userId, type: 'mention', actor_id: actorId,
        thread_id: where.kind === 'forum' ? where.threadId : null,
        post_id:   where.kind === 'forum' ? where.postId : null,
        meta: Object.keys(meta).length ? meta : null,
      })
      sent++
    } catch { continue }
    if (io) {
      const count = await NotificationModel.getUnreadCount(userId).catch(() => 0)
      io.to(`user:${userId}`).emit('notification:new', { unreadCount: count })
      if (where.kind === 'chat' && !quiet) io.to(`user:${userId}`).emit('chat:mention')
    }
    if (where.kind === 'chat' && !quiet) {
      // Un push envoyé n'est plus retraduisible : la langue du DESTINATAIRE
      const { rows } = await db.query<{ locale: string | null }>(`SELECT locale FROM users WHERE id = $1`, [userId]).catch(() => ({ rows: [] as { locale: string | null }[] }))
      const locale = resolveServerLocale(rows[0]?.locale, process.env.NODYX_COMMUNITY_LANGUAGE)
      sendPushToUser(userId, { title: pushStrings(locale).mentionTitle(actorName), body, type: 'mention', tag: 'chat-mention', url: '/chat' }).catch(() => {})
    }
  }
  return sent
}
