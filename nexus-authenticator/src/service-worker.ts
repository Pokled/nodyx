/// <reference types="@sveltejs/kit/types/ambient" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker'

declare const self: ServiceWorkerGlobalScope

const CACHE = `nexus-auth-${version}`
const ASSETS = [...build, ...files]

// ─── Installation ─────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
	)
	self.skipWaiting()
})

// ─── Activation ───────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE) await caches.delete(key)
			}
		})
	)
	self.clients.claim()
})

// ─── Fetch — cache first pour les assets statiques ───────────────────────────

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return

	const url = new URL(event.request.url)

	// On ne cache pas les appels API Hub
	if (url.hostname !== self.location.hostname) return

	event.respondWith(
		caches.match(event.request).then((cached) => {
			return cached ?? fetch(event.request)
		})
	)
})

// ─── Push notifications ───────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
	if (!event.data) return

	let payload: {
		challengeId: string
		deviceId: string
		hubUrl: string
		sourceIp?: string
		issuedAt: number
		ttl: number
	}

	try {
		payload = event.data.json()
	} catch {
		return
	}

	const hubName = payload.hubUrl.replace(/^https?:\/\//, '')
	const time = new Date(payload.issuedAt).toLocaleTimeString('fr-FR', {
		hour: '2-digit', minute: '2-digit'
	})

	event.waitUntil(
		self.registration.showNotification('Nexus — Demande de connexion', {
			body: `Hub : ${hubName}\nÀ : ${time}${payload.sourceIp ? `\nDepuis : ${payload.sourceIp}` : ''}`,
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			tag: `challenge-${payload.challengeId}`,
			requireInteraction: true,
			data: payload,
			actions: [
				{ action: 'reject', title: 'Refuser' },
				{ action: 'approve', title: 'Approuver' }
			]
		} as NotificationOptions)
	)
})

// ─── Click sur notification ───────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
	event.notification.close()

	const payload = event.notification.data as {
		challengeId: string
		deviceId: string
	}

	const url = `/approve?challengeId=${payload.challengeId}&deviceId=${payload.deviceId}`

	if (event.action === 'reject') {
		// Ouvre l'app sur la page d'approbation pour confirmation visuelle du refus
		event.waitUntil(self.clients.openWindow(`/approve?challengeId=${payload.challengeId}&deviceId=${payload.deviceId}&action=reject`))
		return
	}

	event.waitUntil(
		self.clients.matchAll({ type: 'window' }).then((clients) => {
			for (const client of clients) {
				if (client.url.includes(self.location.origin)) {
					client.focus()
					client.navigate(url)
					return
				}
			}
			return self.clients.openWindow(url)
		})
	)
})
