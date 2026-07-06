/**
 * NODYX — Voice SFU signaling relay (P1, CDC SFU §17)
 *
 * Relais PUR entre les clients socket.io et le daemon `nodyx-sfud` (API HTTP
 * interne localhost). Aucune logique média ici : le core transporte des blobs
 * de signaling opaques (ICE/DTLS/RTP params) entre le client et le daemon.
 *
 * DOCTRINE CHIRURGICALE (validée par le owner, 2026-07-06) :
 * - Fichier ADDITIF : le mesh existant (voice.ts) n'est modifié en rien.
 *   Les events sont namespacés `voice:sfu_*`, aucun ne collisionne.
 * - DORMANT par défaut : sans VOICE_SFU_URL dans l'env, chaque handler répond
 *   `sfu_disabled` et ne contacte jamais rien. Rollback = retirer la variable.
 * - Dégradation gracieuse : daemon injoignable => réponse d'erreur propre au
 *   client, JAMAIS d'exception qui remonte, le mesh continue sa vie.
 * - Mêmes gardes d'admission que le mesh : isUuid + getCommunityRoleForChannel
 *   (réutilisées depuis voice.ts, pas dupliquées), + rate limiting par event.
 * - L'identité vient TOUJOURS de socket.data (JWT vérifié), jamais du payload.
 *
 * Style ack (callback socket.io) : nouveau dans ce fichier uniquement. Le
 * signaling SFU est un protocole requête/réponse strict (connect -> produce ->
 * consume s'enchaînent), les acks éliminent toute erreur de corrélation.
 *
 * Env : VOICE_SFU_URL   (ex: http://127.0.0.1:3901) — absent = SFU désactivé
 *       VOICE_SFU_TOKEN (= SFU_TOKEN du daemon)
 */

import { Server, Socket } from 'socket.io'
import { checkRateLimit } from './rateLimiter'
import { getCommunityRoleForChannel, isUuid, voiceRoom } from './voice'

/**
 * Room socket.io DÉDIÉE aux clients SFU d'un salon. SURTOUT PAS voiceRoom()
 * du mesh : la liste des membres vocaux de la sidebar est reconstruite depuis
 * cette room-là (broadcastVoiceChannelUpdate fetchSockets) — y mettre les
 * clients SFU les ferait apparaître en fantômes. Les annonces SFU
 * (new_producer…) circulent ici ; voice:sfu_mode reste émis vers la room mesh
 * (ce sont les clients MESH qu'une bascule doit prévenir, §17-B).
 */
function sfuRoom(channelId: string): string {
  return `voicesfu:${channelId}`
}

// ── Configuration (lue à CHAQUE appel : cohérent avec le système de settings
//    tier-3 qui ré-applique les valeurs DB sur process.env à chaud) ───────────

function sfuUrl(): string | null {
  const v = process.env.VOICE_SFU_URL?.trim()
  return v ? v.replace(/\/+$/, '') : null
}

// ── Garde-fous ────────────────────────────────────────────────────────────────

/** Taille max d'un blob client (rtpParameters/capabilities ~2-3 Ko réels). */
const MAX_CLIENT_BLOB = 64_000
/** Timeout d'un appel daemon : au-delà, on répond une erreur propre. */
const DAEMON_TIMEOUT_MS = 5_000

type Ack = (response: Record<string, unknown>) => void

/** Un ack manquant ou malformé = requête ignorée (pas de crash possible). */
function isAck(cb: unknown): cb is Ack {
  return typeof cb === 'function'
}

/** Sérialise un objet client borné, ou null si invalide/trop gros. */
function boundedJson(value: unknown): string | null {
  if (value === null || value === undefined) return '{}'
  try {
    const s = JSON.stringify(value)
    if (typeof s !== 'string' || s.length > MAX_CLIENT_BLOB) return null
    return s
  } catch {
    return null
  }
}

/** Parse un blob JSON renvoyé par le daemon (string) en objet pour le client. */
function parseBlob(s: unknown): unknown {
  if (typeof s !== 'string') return s
  try { return JSON.parse(s) } catch { return s }
}

// ── Appel daemon : ne throw JAMAIS ───────────────────────────────────────────

type DaemonResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }

async function sfuFetch(path: string, payload: Record<string, unknown>): Promise<DaemonResult> {
  const base = sfuUrl()
  if (!base) return { ok: false, error: 'sfu_disabled' }
  try {
    const res = await fetch(`${base}${path}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.VOICE_SFU_TOKEN ?? ''}`,
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(DAEMON_TIMEOUT_MS),
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') {
      return { ok: false, error: `sfu_bad_response_${res.status}` }
    }
    if (data.ok !== true) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : `sfu_error_${res.status}` }
    }
    return { ok: true, data }
  } catch {
    // Daemon éteint, timeout, refus de connexion : le mesh n'est pas concerné.
    return { ok: false, error: 'sfu_unreachable' }
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerVoiceSfuHandlers(socket: Socket, server: Server): void {
  const { userId } = socket.data

  /** Salons SFU rejoints par CE socket (nettoyage garanti au disconnect). */
  const joined = new Set<string>()

  /**
   * Gardes communes à tous les handlers. Retourne le rôle communauté si tout
   * passe, sinon répond l'erreur dans l'ack et retourne null.
   */
  async function guard(event: string, channelId: unknown, cb: Ack): Promise<string | null> {
    if (!sfuUrl()) { cb({ ok: false, error: 'sfu_disabled' }); return null }
    if (checkRateLimit(userId, event)) { cb({ ok: false, error: 'rate_limited' }); return null }
    if (!isUuid(channelId)) { cb({ ok: false, error: 'bad_channel' }); return null }
    const role = await getCommunityRoleForChannel(channelId, userId)
    if (!role) { cb({ ok: false, error: 'forbidden' }); return null }
    return role
  }

  // ── voice:sfu_join — rejoint le salon côté SFU (§17-A) ─────────────────────
  // Réponse : { ok, mode, caps?, transportParams? } (caps + params seulement en
  // mode SFU : tout ce qu'il faut au client pour device.load + créer sa PC).
  socket.on('voice:sfu_join', async (channelId: unknown, cb: unknown) => {
    if (!isAck(cb)) return
    if (!(await guard('voice:sfu_join', channelId, cb))) return

    const join = await sfuFetch('/v1/join', { room: channelId, participant: userId })
    if (!join.ok) { cb({ ok: false, error: join.error }); return }

    joined.add(channelId as string)
    // Rejoint la room d'annonces SFU : sans elle, le premier arrivé n'apprend
    // JAMAIS les flux publiés après lui (bug du labo : PC silencieux).
    await socket.join(sfuRoom(channelId as string))
    const mode = join.data.mode

    if (mode !== 'sfu') { cb({ ok: true, mode }); return }

    // Mode SFU : capabilities + les DEUX transports (mediasoup-client fixe la
    // direction d'un transport à sa création : send XOR recv).
    const [caps, sendParams, recvParams] = await Promise.all([
      sfuFetch('/v1/caps', { room: channelId }),
      sfuFetch('/v1/transport_params', { room: channelId, participant: userId, direction: 'send' }),
      sfuFetch('/v1/transport_params', { room: channelId, participant: userId, direction: 'recv' }),
    ])
    if (!caps.ok) { cb({ ok: false, error: caps.error }); return }
    if (!sendParams.ok) { cb({ ok: false, error: sendParams.error }); return }
    if (!recvParams.ok) { cb({ ok: false, error: recvParams.error }); return }

    // Si cette arrivée a fait basculer le salon (des participants ont été
    // migrés), on prévient le salon : chacun fera son propre sfu_join pour
    // récupérer SES transport params.
    const migrated = Array.isArray(join.data.migrated) ? join.data.migrated : []
    if (migrated.length > 0) {
      server.to(voiceRoom(channelId as string)).emit('voice:sfu_mode', { channelId, mode: 'sfu' })
    }

    cb({
      ok: true,
      mode,
      caps:                parseBlob(caps.data.caps),
      sendTransportParams: parseBlob(sendParams.data.params),
      recvTransportParams: parseBlob(recvParams.data.params),
    })
  })

  // ── voice:sfu_connect — finalise la PC (dtlsParameters du client) ──────────
  socket.on('voice:sfu_connect', async (payload: unknown, cb: unknown) => {
    if (!isAck(cb)) return
    const { channelId, direction, dtlsParameters } = (payload ?? {}) as Record<string, unknown>
    if (!(await guard('voice:sfu_connect', channelId, cb))) return
    if (direction !== 'send' && direction !== 'recv') {
      cb({ ok: false, error: 'bad_direction' }); return
    }
    const client = boundedJson({ dtlsParameters })
    if (!client) { cb({ ok: false, error: 'payload_too_large' }); return }

    const res = await sfuFetch('/v1/connect', {
      room: channelId, participant: userId, direction, client,
    })
    cb(res.ok ? { ok: true } : { ok: false, error: res.error })
  })

  // ── voice:sfu_produce — publie un flux (rtpParameters du client) ───────────
  socket.on('voice:sfu_produce', async (payload: unknown, cb: unknown) => {
    if (!isAck(cb)) return
    const { channelId, kind, rtpParameters } = (payload ?? {}) as Record<string, unknown>
    if (!(await guard('voice:sfu_produce', channelId, cb))) return
    if (kind !== 'audio' && kind !== 'screen' && kind !== 'cam') {
      cb({ ok: false, error: 'bad_kind' }); return
    }
    const client = boundedJson(rtpParameters)
    if (!client) { cb({ ok: false, error: 'payload_too_large' }); return }

    const res = await sfuFetch('/v1/produce', { room: channelId, participant: userId, kind, client })
    if (!res.ok) { cb({ ok: false, error: res.error }); return }

    // Annonce aux autres clients SFU : un nouveau flux est à souscrire.
    socket.to(sfuRoom(channelId as string)).emit('voice:sfu_new_producer', {
      channelId,
      producerId: res.data.producer,
      kind,
      userId,
    })
    cb({ ok: true, producerId: res.data.producer })
  })

  // ── voice:sfu_consume — souscrit à un flux publié ──────────────────────────
  socket.on('voice:sfu_consume', async (payload: unknown, cb: unknown) => {
    if (!isAck(cb)) return
    const { channelId, producerId, rtpCapabilities } = (payload ?? {}) as Record<string, unknown>
    if (!(await guard('voice:sfu_consume', channelId, cb))) return
    if (typeof producerId !== 'string' || producerId.length === 0 || producerId.length > 200) {
      cb({ ok: false, error: 'bad_producer' }); return
    }
    const clientCaps = boundedJson(rtpCapabilities)
    if (!clientCaps) { cb({ ok: false, error: 'payload_too_large' }); return }

    const res = await sfuFetch('/v1/consume', {
      room: channelId, participant: userId, producer: producerId, clientCaps,
    })
    if (!res.ok) { cb({ ok: false, error: res.error }); return }
    cb({ ok: true, consumerId: res.data.consumer, params: parseBlob(res.data.params) })
  })

  // ── voice:sfu_publications — liste des flux du salon (§17-A) ───────────────
  socket.on('voice:sfu_publications', async (channelId: unknown, cb: unknown) => {
    if (!isAck(cb)) return
    if (!(await guard('voice:sfu_publications', channelId, cb))) return

    const res = await sfuFetch('/v1/publications', { room: channelId })
    if (!res.ok) { cb({ ok: false, error: res.error }); return }
    cb({ ok: true, publications: res.data.publications ?? [] })
  })

  // ── voice:sfu_leave ─────────────────────────────────────────────────────────
  socket.on('voice:sfu_leave', async (channelId: unknown, cb: unknown) => {
    const ack: Ack = isAck(cb) ? cb : () => {}
    if (!sfuUrl()) { ack({ ok: false, error: 'sfu_disabled' }); return }
    if (!isUuid(channelId)) { ack({ ok: false, error: 'bad_channel' }); return }
    // Pas de check de rôle au leave : on doit toujours pouvoir sortir.
    joined.delete(channelId)
    await socket.leave(sfuRoom(channelId))
    const res = await sfuFetch('/v1/leave', { room: channelId, participant: userId })
    ack(res.ok ? { ok: true } : { ok: false, error: res.error })
  })

  // ── Nettoyage garanti : un socket qui meurt libère ses salons SFU ───────────
  // (listener ADDITIONNEL au disconnect existant de voice.ts : socket.io
  // supporte plusieurs listeners, celui du mesh n'est pas touché)
  socket.on('disconnect', () => {
    for (const channelId of joined) {
      // fire-and-forget : le daemon évince, personne n'attend de réponse
      void sfuFetch('/v1/leave', { room: channelId, participant: userId })
    }
    joined.clear()
  })
}
