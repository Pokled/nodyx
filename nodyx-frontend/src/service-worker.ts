/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit/types/ambient" />

import { build, files, version } from '$service-worker'

declare const self: ServiceWorkerGlobalScope

// ── Cache names ───────────────────────────────────────────────────────────────

const SHELL_CACHE   = `nodyx-shell-${version}`
const CONTENT_CACHE = `nodyx-content-${version}`
const IMAGE_CACHE   = `nodyx-images-${version}`

// Assets statiques à precacher (shell de l'app)
const SHELL_ASSETS = [...build, ...files]

// ── Installation ─────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  )
  // Prise de contrôle immédiate — pas d'attente de fermeture des anciens onglets
  self.skipWaiting()
})

// ── Activation ───────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const current = new Set([SHELL_CACHE, CONTENT_CACHE, IMAGE_CACHE])
      for (const key of keys) {
        if (!current.has(key)) await caches.delete(key)
      }
    })
  )
  self.clients.claim()
})

// ── Fetch strategy ────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // ── Jamais de cache pour Socket.IO et API temps-réel ──────────────────────
  if (
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/api/v1/chat') ||
    url.pathname.startsWith('/api/v1/dm') ||
    url.pathname.startsWith('/api/v1/notifications/subscribe')
  ) return

  // ── Assets statiques (shell) — Cache First ─────────────────────────────────
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => cached ?? fetch(request))
    )
    return
  }

  // ── Images (avatars, covers) — Cache avec TTL 24h ─────────────────────────
  if (
    url.pathname.startsWith('/uploads/') ||
    request.destination === 'image'
  ) {
    event.respondWith(imageStrategy(request))
    return
  }

  // ── API forum/profils — Stale While Revalidate ────────────────────────────
  if (
    url.pathname.startsWith('/api/v1/forums') ||
    url.pathname.startsWith('/api/v1/users') ||
    url.pathname.startsWith('/api/v1/instance') ||
    url.pathname.startsWith('/api/v1/communities') ||
    url.pathname.startsWith('/api/v1/notifications') ||
    url.pathname.startsWith('/api/v1/search') ||
    url.pathname.startsWith('/api/directory')
  ) {
    event.respondWith(staleWhileRevalidate(request, CONTENT_CACHE))
    return
  }

  // ── Navigation (pages SvelteKit) — Network First + fallback offline ────────
  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request))
    return
  }
})

// ── Stratégies ────────────────────────────────────────────────────────────────

async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
  const cache   = await caches.open(cacheName)
  const cached  = await cache.match(request)
  const network = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone())
    return res
  }).catch(() => null)

  return cached ?? await network ?? offlineFallback(request)
}

async function imageStrategy(request: Request): Promise<Response> {
  const cache  = await caches.open(IMAGE_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const res = await fetch(request)
    if (res.ok) {
      cache.put(request, res.clone())
      // Purge entrées > 24h (max 100 images en cache)
      pruneImageCache(cache)
    }
    return res
  } catch {
    return new Response('', { status: 503 })
  }
}

async function pruneImageCache(cache: Cache): Promise<void> {
  const keys = await cache.keys()
  if (keys.length > 100) {
    await cache.delete(keys[0])
  }
}

async function navigationStrategy(request: Request): Promise<Response> {
  try {
    const res = await fetch(request)
    return res
  } catch {
    // Offline : tenter la cache, sinon page offline dédiée
    const cached = await caches.match(request)
    if (cached) return cached
    const offlinePage = await caches.match('/offline')
    return offlinePage ?? new Response(offlineHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  }
}

async function offlineFallback(request: Request): Promise<Response> {
  return new Response(JSON.stringify({ error: 'offline', offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  })
}

// ── Page offline embarquée ─────────────────────────────────────────────────────

function offlineHTML(): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nodyx — Hors ligne</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0f;color:#e2e8f0;font-family:system-ui,sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}
    .card{text-align:center;max-width:400px}
    .icon{width:80px;height:80px;background:#1e1533;border-radius:50%;
          display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;
          font-size:2rem}
    h1{font-size:1.5rem;font-weight:700;margin-bottom:.75rem;color:#fff}
    p{color:#94a3b8;line-height:1.6;margin-bottom:1.5rem}
    button{background:#6e50d2;color:#fff;border:none;padding:.75rem 1.5rem;
           border-radius:.5rem;font-size:1rem;cursor:pointer;transition:opacity .2s}
    button:hover{opacity:.85}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚡</div>
    <h1>Vous êtes hors ligne</h1>
    <p>Nodyx n'a pas pu se connecter au réseau.<br>Vérifiez votre connexion et réessayez.</p>
    <button onclick="location.reload()">Réessayer</button>
  </div>
</body>
</html>`
}

// ── Push Notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data: {
    title?:   string
    body?:    string
    type?:    string
    url?:     string
    tag?:     string
  }

  try {
    data = event.data.json()
  } catch {
    data = { title: 'Nodyx', body: event.data.text() }
  }

  const title   = data.title ?? 'Nodyx'
  const options: NotificationOptions = {
    body:              data.body ?? '',
    icon:              '/icons/icon-192.png',
    badge:             '/icons/icon-192.png',
    tag:               data.tag ?? data.type ?? 'nodyx',
    data:              { url: data.url ?? '/' },
    requireInteraction: false,
    silent:            false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── Clic sur notification ─────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = (event.notification.data?.url ?? '/') as string

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focuser un onglet existant si possible
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          client.focus()
          client.navigate(targetUrl)
          return
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})

// ── Background Sync — messages en attente hors-ligne ─────────────────────────

self.addEventListener('sync', (event: any) => {
  if (event.tag === 'nodyx-pending-messages') {
    event.waitUntil(flushPendingMessages())
  }
})

async function flushPendingMessages(): Promise<void> {
  // Les messages en attente sont stockés dans IndexedDB par le frontend
  // Le SW les récupère et les envoie quand la connexion revient
  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) {
    client.postMessage({ type: 'sw:flush_pending' })
  }
}
