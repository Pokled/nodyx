import { browser } from '$app/environment'
import { writable, type Writable } from 'svelte/store'
import type { Socket } from 'socket.io-client'

export interface UserStatus {
  emoji: string
  text:  string
}

export interface OnlineMember {
  userId:            string
  username:          string
  avatar:            string | null
  nameColor:         string | null
  nameGlow:          string | null
  nameGlowIntensity: number | null
  nameAnimation:     string | null
  nameFontFamily:    string | null
  nameFontUrl:       string | null
  grade:             { name: string; color: string } | null
  status:            UserStatus | null
}

export const unreadCountStore:   Writable<number>          = writable(0)
export const chatMentionStore:   Writable<number>          = writable(0)
export const dmUnreadStore:      Writable<number>          = writable(0)
export const socket:             Writable<Socket | null>   = writable(null)
export const onlineMembersStore: Writable<OnlineMember[]>  = writable([])
export const tokenStore:         Writable<string | null>   = writable(null)
export const apiBaseUrl: Writable<string> = writable("")

let _socket: Socket | null = null

export async function initSocket(token: string, initialCount: number): Promise<void> {
  if (!browser) return
  // Guard against double-init: if a socket already exists (even while still
  // connecting), don't create a second one — it causes two simultaneous
  // WebSocket attempts and blocks browser connections for several seconds.
  if (_socket) return

  localStorage.setItem('nodyx_token', token);

  unreadCountStore.set(initialCount)
  tokenStore.set(token)

  // Dynamic import — keeps socket.io-client out of SSR bundle
  const { io: ioClient } = await import('socket.io-client')

  const { PUBLIC_API_URL } = await import('$env/static/public')
  // Si PUBLIC_API_URL est relatif (/api/v1), Socket.IO se connecte à l'origine courante
  // → le proxy Vite (dev) ou le reverse proxy (prod) redirige vers le backend
  const baseUrl = PUBLIC_API_URL.startsWith('/')
    ? window.location.origin
    : PUBLIC_API_URL.replace('/api/v1', '')

  _socket = ioClient(baseUrl, {
    auth:       { token },
    // Polling first: establishes the session reliably on both direct and
    // relay-mode instances. Socket.IO then probes for a WebSocket upgrade;
    // on relay instances the probe fails gracefully and the connection stays
    // on polling. On direct instances the upgrade succeeds transparently.
    // NOTE: ['websocket', 'polling'] does NOT fall back — Socket.IO v4 keeps
    // retrying the first transport on connect_error, so relay users never connect.
    transports: ['polling', 'websocket'],
  })


  // ── Notifications ──────────────────────────────────────────────────────────
  _socket.on('notification:new', ({ unreadCount }: { unreadCount: number }) => {
    unreadCountStore.set(unreadCount)
  })

  // ── Chat mention badge (separate from general notification bell) ────────────
  _socket.on('chat:mention', () => {
    chatMentionStore.update(n => n + 1)
  })

  // ── Presence ───────────────────────────────────────────────────────────────
  _socket.on('presence:init', (members: OnlineMember[]) => {
    onlineMembersStore.set(members.map(m => ({ ...m, status: m.status ?? null })))
  })

  _socket.on('presence:online', (member: OnlineMember) => {
    onlineMembersStore.update(list => {
      // Ignore if already in list (reconnect race condition)
      if (list.some(m => m.userId === member.userId)) return list
      return [...list, { ...member, status: member.status ?? null }]
    })
  })

  _socket.on('presence:offline', ({ userId }: { userId: string }) => {
    onlineMembersStore.update(list => list.filter(m => m.userId !== userId))
  })

  _socket.on('presence:status_update', ({ userId, status }: { userId: string; status: UserStatus | null }) => {
    onlineMembersStore.update(list =>
      list.map(m => m.userId === userId ? { ...m, status: status ?? null } : m)
    )
  })

  _socket.on('presence:effects_update', (data: {
    userId:            string
    nameColor:         string | null
    nameGlow:          string | null
    nameGlowIntensity: number | null
    nameAnimation:     string | null
    nameFontFamily:    string | null
    nameFontUrl:       string | null
    avatar?:           string | null
  }) => {
    onlineMembersStore.update(list =>
      list.map(m => {
        if (m.userId !== data.userId) return m
        const updated: OnlineMember = {
          ...m,
          nameColor:         data.nameColor,
          nameGlow:          data.nameGlow,
          nameGlowIntensity: data.nameGlowIntensity,
          nameAnimation:     data.nameAnimation,
          nameFontFamily:    data.nameFontFamily,
          nameFontUrl:       data.nameFontUrl,
        }
        if (data.avatar !== undefined) updated.avatar = data.avatar ?? null
        return updated
      })
    )
  })

  // ── Ban ────────────────────────────────────────────────────────────────────
  // Server disconnects the socket and emits 'banned' when an admin bans the user.
  // Redirect immediately to /banned so the user can't keep browsing.
  _socket.on('banned', () => {
    if (window.location.pathname !== '/banned') {
      window.location.href = '/banned'
    }
  })

  // ── DM ─────────────────────────────────────────────────────────────────────
  // Incrémenter le badge DM quand un message arrive d'un autre utilisateur
  _socket.on('dm:message', (msg: { sender_id: string }) => {
    // `$app/state` n'expose plus de `.subscribe()`, et surtout : on n'a besoin
    // ici que du chemin courant, dans un gestionnaire d'evenement du navigateur.
    // `window.location.pathname` le donne directement, y compris apres une
    // navigation cote client (SvelteKit passe par `history.pushState`). C'est
    // deja ce qu'utilise le gestionnaire `banned` quelques lignes plus haut.
    // Au passage : plus d'import dynamique, donc plus de repli en `.catch()` qui
    // incrementait le compteur deux fois si l'import echouait.
    if (!window.location.pathname.startsWith('/dm/')) {
      dmUnreadStore.update(n => n + 1)
    }
  })

  socket.set(_socket)
}

export function getSocket(): Socket | null {
  return _socket
}

export async function tryAutoConnect(): Promise<void> {
  if (!browser) return
  const savedToken = localStorage.getItem('nodyx_token')
  if (!savedToken || _socket) return

  // Vérifier que le token est encore valide avant de se reconnecter
  // Évite de se reconnecter avec un token expiré/révoqué
  try {
    const { PUBLIC_API_URL } = await import('$env/static/public')
    const res = await fetch(`${PUBLIC_API_URL}/api/v1/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
    if (res.status === 401) {
      // Token expiré ou révoqué — nettoyer le localStorage
      localStorage.removeItem('nodyx_token')
      return
    }
    const data = res.ok ? await res.json() : { count: 0 }
    await initSocket(savedToken, data.count ?? 0)
  } catch {
    // Réseau indisponible — tenter quand même (le socket gérera l'erreur)
    await initSocket(savedToken, 0)
  }
}
