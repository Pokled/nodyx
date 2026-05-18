/**
 * OctoGuard, module Commandes custom (Module 3, spec v2.1.1).
 *
 * Détection des messages chat commençant par "!cmd" (alphanumérique) et,
 * si une commande correspondante existe dans octoguard_commands :
 *  - Vérifie le cooldown par user (Redis avec TTL)
 *  - Vérifie les channels autorisés (allowed_channels NULL = tous)
 *  - Vérifie les rôles autorisés (allowed_roles NULL = tous)
 *  - Renvoie la réponse comme un message public dans le channel,
 *    attribué au user fantôme OctoGuard (Module 2)
 *
 * Pattern stricte : ^!cmd(\s|$) — commande en début de message seulement.
 * Évite les faux positifs sur du texte naturel type "regarde !regle de trois".
 */

import { db, redis } from '../../config/database'
import { io } from '../../socket/io'
import { ensureOctoGuardBotUser } from './welcome'
import { logOctoGuardAction } from './logger'
import { randomUUID } from 'crypto'
import type { CommandRow } from './types'

// ─── Detection ───────────────────────────────────────────────────────────────

const CMD_RE = /^!([a-z0-9_-]{1,64})(?:\s|$)/i

/**
 * Extrait le nom de commande depuis un message.
 * Retourne null si ce n'est pas une commande (n'importe quel autre texte).
 */
export function extractCommand(content: string): string | null {
  // Strip HTML balises pour détecter "<p>!cmd</p>" comme commande
  const plain = content.replace(/<[^>]+>/g, '').trim()
  const m = plain.match(CMD_RE)
  return m ? m[1].toLowerCase() : null
}

// ─── Cooldown ────────────────────────────────────────────────────────────────

/** Vérifie + pose le cooldown atomiquement via Redis SET NX EX. */
async function checkAndSetCooldown(cmdId: string, userId: string, seconds: number): Promise<boolean> {
  if (seconds <= 0) return true  // pas de cooldown configuré
  try {
    // SET NX : pose la clé seulement si absente. Si présente (cooldown actif), retourne null.
    // Note : keyPrefix 'nodyx:' déjà appliqué automatiquement par le client redis
    const key = `octoguard:cooldown:${cmdId}:${userId}`
    const ok = await redis.set(key, '1', 'EX', seconds, 'NX')
    return ok === 'OK'
  } catch (err) {
    console.warn('[octoguard:commands] cooldown check error, fail-open:', err)
    return true  // fail-open : si Redis tombe, on laisse passer
  }
}

// ─── Recherche en DB ─────────────────────────────────────────────────────────

/**
 * Recherche une commande active par son nom dans la DB.
 * Pas de cache RAM ici : peu fréquent, moins critique que les règles auto-mod.
 */
async function findCommand(cmd: string): Promise<CommandRow | null> {
  try {
    const { rows } = await db.query<CommandRow>(
      `SELECT id, command, response, cooldown_seconds, allowed_channels, allowed_roles, enabled,
              created_at::text AS created_at, updated_at::text AS updated_at
         FROM octoguard_commands
        WHERE command = $1 AND enabled = true
        LIMIT 1`,
      [cmd]
    )
    return rows[0] ?? null
  } catch (err) {
    console.warn('[octoguard:commands] findCommand error:', err)
    return null
  }
}

// ─── Handler principal ──────────────────────────────────────────────────────

export interface CommandContext {
  content:    string
  userId:     string
  username:   string
  userRole:   string
  channelId:  string
}

export interface CommandOutcome {
  handled:  boolean  // true = c'était une commande (qu'elle réussisse ou non)
  blocked?: boolean  // true = on doit bloquer le message original
  reason?:  string
}

/**
 * Détecte si le message est une commande et l'exécute si oui.
 * Retourne { handled: false } si ce n'est pas une commande (le pipeline continue).
 * Retourne { handled: true, blocked: true } si commande détectée (le message
 * original est supprimé et remplacé par la réponse).
 *
 * Jamais throw. Toute erreur → { handled: false } et fail-open.
 */
export async function tryHandleCommand(ctx: CommandContext): Promise<CommandOutcome> {
  try {
    const cmdName = extractCommand(ctx.content)
    if (!cmdName) return { handled: false }

    const cmd = await findCommand(cmdName)
    if (!cmd) {
      // Commande inconnue : on ne bloque pas, on laisse le message passer
      // (l'utilisateur pourrait avoir voulu écrire "!regarde" en texte)
      return { handled: false }
    }

    // Channel autorisé ?
    if (cmd.allowed_channels && cmd.allowed_channels.length > 0) {
      if (!cmd.allowed_channels.includes(ctx.channelId)) {
        return { handled: false }  // mauvais channel, on ignore silencieusement
      }
    }

    // Rôle autorisé ?
    if (cmd.allowed_roles && cmd.allowed_roles.length > 0) {
      if (!cmd.allowed_roles.includes(ctx.userRole)) {
        return { handled: false }  // pas le bon rôle, on ignore silencieusement
      }
    }

    // Cooldown ?
    const cooldownOk = await checkAndSetCooldown(cmd.id, ctx.userId, cmd.cooldown_seconds)
    if (!cooldownOk) {
      // En cooldown : on bloque le message d'origine sans poster de réponse
      // pour éviter le spam de la commande
      return {
        handled: true,
        blocked: true,
        reason:  `Commande "${cmdName}" en cooldown`,
      }
    }

    // Tout OK : on poste la réponse comme message du bot
    const botId = await ensureOctoGuardBotUser()
    if (!botId) {
      // Pas de bot dispo, on log et on bloque le message original
      console.warn('[octoguard:commands] bot user not available, command response skipped')
      return { handled: true, blocked: true, reason: `Commande "${cmdName}" (réponse indisponible)` }
    }

    // INSERT + récupère le message complet pour le broadcaster.
    const inserted = await db.query<{
      id:         string
      channel_id: string
      author_id:  string
      content:    string
      created_at: string
    }>(
      `INSERT INTO channel_messages (channel_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, channel_id, author_id, content, created_at::text AS created_at`,
      [ctx.channelId, botId, cmd.response]
    )
    const msg = inserted.rows[0]

    // Broadcast aux clients du channel (cohérent avec le flow normal chat:send).
    if (io && msg) {
      io.to(`channel:${ctx.channelId}`).emit('chat:message', {
        ...msg,
        author_username:  'OctoGuard',
        author_avatar:    null,
        edited_at:        null,
        is_deleted:       false,
        reactions:        [],
        reply_to_id:      null,
        reply_to_username: null,
        reply_to_content:  null,
      })
    }

    // Log
    logOctoGuardAction({
      action:       'octoguard.command_invoked',
      target_type:  'user',
      target_id:    ctx.userId,
      target_label: `!${cmdName}`,
      metadata: {
        event_id:     randomUUID(),
        actor:        'octoguard:auto',
        command:      cmdName,
        command_id:   cmd.id,
        channel_id:   ctx.channelId,
        invoker:      ctx.username,
      },
    })

    return {
      handled: true,
      blocked: true,           // on supprime le "!cmd" du user
      reason:  `Commande "!${cmdName}"`,
    }
  } catch (err) {
    console.warn('[octoguard:commands] tryHandleCommand error:', err)
    return { handled: false }
  }
}
