import { browser } from '$app/environment'
import { writable, type Writable } from 'svelte/store'
import type { Socket } from 'socket.io-client'

export interface OnlineMember {
  userId:   string
  username: string
  avatar:   string | null
}

export const unreadCountStore:   Writable<number>          = writable(0)
export const socket:             Writable<Socket | null>   = writable(null)
export const onlineMembersStore: Writable<OnlineMember[]>  = writable([])
export const tokenStore:         Writable<string | null>   = writable(null)
export const apiBaseUrl: Writable<string> = writable("")

let _socket: Socket | null = null

export async function initSocket(token: string, initialCount: number): Promise<void> {
  if (!browser) return
  if (_socket?.connected) return

  localStorage.setItem('nexus_token', token);

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
    // polling first so the connection works through the Nexus Relay (which
    // forwards HTTP but does not support WebSocket upgrades). Once polling
    // is established, Socket.IO will automatically upgrade to WebSocket
    // when a direct connection is available.
    transports: ['polling', 'websocket'],
  })
  

  // ── Notifications ──────────────────────────────────────────────────────────
  _socket.on('notification:new', ({ unreadCount }: { unreadCount: number }) => {
    unreadCountStore.set(unreadCount)
  })

  // ── Presence ───────────────────────────────────────────────────────────────
  _socket.on('presence:init', (members: OnlineMember[]) => {
    onlineMembersStore.set(members)
  })

  _socket.on('presence:online', (member: OnlineMember) => {
    onlineMembersStore.update(list => {
      // Ignore if already in list (reconnect race condition)
      if (list.some(m => m.userId === member.userId)) return list
      return [...list, member]
    })
  })

  _socket.on('presence:offline', ({ userId }: { userId: string }) => {
    onlineMembersStore.update(list => list.filter(m => m.userId !== userId))
  })

  socket.set(_socket)
}

export function getSocket(): Socket | null {
  return _socket
}

export async function tryAutoConnect(): Promise<void> {
  if (!browser) return;
  const savedToken = localStorage.getItem('nexus_token');
  if (savedToken && !_socket) {
    // On relance le socket avec le token stocké
    // Tu peux mettre 0 pour initialCount ou faire un petit fetch rapide avant
    await initSocket(savedToken, 0); 
  }
}
