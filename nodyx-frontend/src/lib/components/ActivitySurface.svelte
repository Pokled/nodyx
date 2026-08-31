<script lang="ts">
	// Monte une ACTIVITÉ (surface d'extension `type: "activity"`) en overlay
	// plein écran dans un canal vocal.
	//
	// Le bundle applicatif (le jeu) est servi PAR L'INSTANCE elle-même, depuis
	// `/api/v1/extensions/<id>/<version>/app/<entry>` (téléchargé et vérifié à
	// l'installation) : même origine que ce frontend, aucune dépendance externe
	// au runtime. Cf SPECS/NODYX_ACTIVITIES_CDC.md §2.
	//
	// Différences avec ExtensionSurface :
	//   - `sandbox="allow-scripts allow-same-origin"` : Godot a besoin de
	//     `allow-same-origin` (IndexedDB). Le `sandbox` bloque quand même nav du
	//     top, popups, alert(), formulaires, téléchargements.
	//   - aucune session, aucun jeton : l'identité vient des props
	//   - l'hôte relaie le temps-réel via le socket AUTHENTIFIÉ de la page, et
	//     seulement dans `voice:<channelId>` (cf CDC §3)
	//
	// Sécurité : le `channelId` est fixé par le parent, jamais fourni par
	// l'activité ; le serveur re-vérifie l'appartenance à la room ; le `from` des
	// messages est estampillé serveur ; le bundle servi est épinglé par sha256.

	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import {
		buildActivityBootPayload, createActivityHostHandler,
		type ActivityMember,
	} from '$lib/extensions/host'

	const tFn = $derived($t)

	interface Props {
		activityId: string
		/** Id de la surface `activity` dans le manifeste (ex. 'battle'). */
		surfaceId:  string
		version:    string
		/** Chemin relatif servi par l'instance : /api/v1/extensions/<id>/<version>/app/<entry> */
		appUrl:     string
		label:      string
		/** Le canal vocal rejoint. Lié par le parent, jamais par l'activité. */
		channelId:  string
		socket:     any
		/** Jeton de session de l'utilisateur : projette son identité dans le
		 *  jeton d'extension (records `scope: user`). */
		token?:     string | null
		userId:     string
		username:   string
		userAvatar?: string | null
		/** Roster du canal vocal, dérivé par le parent. */
		members?:   ActivityMember[]
		locale?:    string
		theme?:     Record<string, string>
		/** Retour à la galerie des jeux. */
		onclose?:   () => void
		/** Fermer complètement (revenir aux participants du salon). */
		onexit?:    () => void
	}

	let {
		activityId, surfaceId, version, appUrl, label, channelId, socket,
		token = null, userId, username, userAvatar = null,
		members = [], locale = 'fr', theme = {},
		onclose = () => {}, onexit = () => {},
	}: Props = $props()

	// ── Plein écran ────────────────────────────────────────────────────────
	// Par défaut le jeu vit dans la zone de contenu du salon (entre les
	// sidebars). Un bouton bascule en vrai plein écran (API Fullscreen) : pas
	// de démontage de l'iframe, donc le jeu ne redémarre pas.
	let rootEl: HTMLDivElement | null = $state(null)
	let isFs = $state(false)
	function onFsChange() { isFs = browser && document.fullscreenElement === rootEl }
	async function toggleFs() {
		if (!browser || !rootEl) return
		try {
			if (document.fullscreenElement === rootEl) await document.exitFullscreen()
			else await rootEl.requestFullscreen()
		} catch { /* refusé (permissions, iframe) : on reste en fenêtré */ }
	}

	// ── Persistance (records, classement) ──────────────────────────────────
	// Jeton court frappé par l'hôte (la frame n'a pas de session) et passé dans
	// le boot. La frame étant same-origin, elle appelle /storage directement.
	// Cf SPECS/NODYX_ACTIVITIES_CDC.md §10.
	const storageSurface = `activity:${surfaceId}`
	const storageUrl     = `/api/v1/extensions/${activityId}/storage`
	let storageToken: string | null = $state(null)
	let mintTimer: ReturnType<typeof setInterval> | null = null

	async function mintToken(): Promise<string | null> {
		try {
			const res = await fetch(`/api/v1/extensions/${activityId}/session`, {
				method:  'POST',
				headers: {
					'content-type': 'application/json',
					// Sans ça le jeton est frappé pour un visiteur : les records
					// `scope: user` ne pourraient pas s'écrire.
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
				body:    JSON.stringify({ surface: storageSurface }),
			})
			if (!res.ok) return null
			const body = await res.json()
			storageToken = body.token ?? null
			return storageToken
		} catch {
			return null
		}
	}

	// Le bundle est servi sur notre propre origine.
	const activityOrigin = typeof window !== 'undefined' ? window.location.origin : ''
	const originHost = (() => { try { return new URL(activityOrigin).host } catch { return '' } })()

	let frame:  HTMLIFrameElement | null = $state(null)
	let status: 'loading' | 'ready' | 'error' = $state('loading')
	let channel: MessageChannel | null = null
	let bootTimer: ReturnType<typeof setTimeout> | null = null
	/** userIds présents au dernier envoi, pour diffuser des deltas de roster. */
	let sentMemberIds = new Set<string>()

	function toGuest(msg: Record<string, unknown>) {
		channel?.port1.postMessage(msg)
	}

	// ── Avatars Nodyx -> PNG 64x64 en base64 ────────────────────────────────
	// L'activité tourne avec `connect-src 'self'` : elle ne peut pas récupérer
	// un avatar cross-origin (nexusnode.app, un CDN…). L'hôte, lui, le peut. On
	// réduit à 64x64 pour rester léger dans le roster.
	const avatarCache = new Map<string, string | null>()

	// Un avatar hébergé par l'instance (chemin /uploads/…) est ramené sur
	// l'origine courante : le domaine stocké en base peut être un ancien nom
	// (rebrand), et rester same-origin évite tout souci CORS.
	function sameOriginIfLocal(raw: string): string {
		try {
			const u = new URL(raw, activityOrigin)
			if (u.pathname.startsWith('/uploads/')) return activityOrigin + u.pathname + u.search
			return u.href
		} catch { return raw }
	}

	async function resolveAvatarPng(rawUrl: string): Promise<string | null> {
		const url = sameOriginIfLocal(rawUrl)
		if (avatarCache.has(url)) return avatarCache.get(url) ?? null
		try {
			const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
			if (!res.ok) throw new Error(String(res.status))
			const bmp = await createImageBitmap(await res.blob())
			const S = 64
			const c = document.createElement('canvas')
			c.width = S; c.height = S
			const ctx = c.getContext('2d')
			if (!ctx) throw new Error('no 2d context')
			const scale = Math.max(S / bmp.width, S / bmp.height)
			const w = bmp.width * scale, h = bmp.height * scale
			ctx.drawImage(bmp, (S - w) / 2, (S - h) / 2, w, h)
			bmp.close?.()
			const b64 = c.toDataURL('image/png').split(',')[1] ?? null
			avatarCache.set(url, b64)
			return b64
		} catch {
			avatarCache.set(url, null)   // échec (CORS, 404…) : on n'insiste pas
			return null
		}
	}

	function withCachedAvatar(m: ActivityMember): ActivityMember {
		const png = m.avatar_url ? avatarCache.get(sameOriginIfLocal(m.avatar_url)) : undefined
		return png === undefined ? m : { ...m, avatar_png: png }
	}

	/** Lance la résolution des avatars manquants ; pousse un `member_update` quand un avatar arrive. */
	function resolvePending(list: ActivityMember[]) {
		for (const m of list) {
			if (!m.avatar_url || avatarCache.has(sameOriginIfLocal(m.avatar_url))) continue
			resolveAvatarPng(m.avatar_url).then((png) => {
				if (status === 'ready' && png) {
					toGuest({ event: 'member_update', member: { ...m, avatar_png: png } })
				}
			})
		}
	}

	// ── Le pont : messages de l'activité -> émissions socket ─────────────────
	const handle = createActivityHostHandler({
		room: {
			send: (payload, { to }) => {
				socket?.emit('activity:send', { channelId, to, payload })
			},
			snapshot: (blob) => {
				socket?.emit('activity:snapshot', { channelId, blob })
			},
			requestSync: () => {
				socket?.emit('activity:sync_request', { channelId })
			},
		},
		toast: (message) => { console.info('[activity]', activityId, message) },
	})

	// ── Socket -> port de l'activité ────────────────────────────────────────
	function onActivityMsg(d: { from?: string; payload?: unknown }) {
		if (status !== 'ready') return
		toGuest({ event: 'msg', from: d.from, payload: d.payload })
	}
	function onActivitySnap(d: { from?: string; blob?: string }) {
		if (status !== 'ready') return
		toGuest({ event: 'snap', from: d.from, blob: d.blob })
	}
	function onActivitySync(d: { from?: string }) {
		if (status !== 'ready') return
		toGuest({ event: 'sync', from: d.from })
	}
	function onVoiceSpeaking(d: { userId?: string; speaking?: boolean }) {
		if (status !== 'ready') return
		toGuest({ event: 'speaking', userId: d.userId, speaking: !!d.speaking })
	}

	// Deltas de roster : on n'envoie plus jamais le roster complet après le boot
	// (un reset effacerait l'état "prêt" côté activité). Uniquement join / leave.
	$effect(() => {
		const current = new Map(members.map((m) => [m.id, m]))
		if (status !== 'ready') { return }
		for (const [id, m] of current) {
			if (!sentMemberIds.has(id)) toGuest({ event: 'member_join', member: withCachedAvatar(m) })
		}
		for (const id of sentMemberIds) {
			if (!current.has(id)) toGuest({ event: 'member_leave', member: { id } })
		}
		sentMemberIds = new Set(current.keys())
		resolvePending(members)
	})

	function onWindowMessage(e: MessageEvent) {
		if (!frame || e.source !== frame.contentWindow) return
		// L'iframe est same-origin (bundle servi par l'instance) : `e.origin` est
		// vérifiable et vaut notre propre origine.
		if (e.origin !== activityOrigin) return
		if (e.data?.type !== 'nodyx:hello') return

		if (status === 'error') status = 'loading'
		channel?.port1.close()

		channel = new MessageChannel()
		channel.port1.onmessage = (ev) => {
			if (ev.data?.event === 'ready') { status = 'ready'; clearBootTimer(); return }
			if (ev.data?.event === 'error') { status = 'error'; clearBootTimer(); return }
			// La frame demande un jeton frais (le sien a expiré en pleine partie).
			if (ev.data?.type === 'session.refresh') {
				mintToken().then((tok) => toGuest({ event: 'session', token: tok }))
				return
			}
			handle(ev.data)
		}
		channel.port1.start()

		sentMemberIds = new Set(members.map((m) => m.id))
		const snap = ($state.snapshot(members) as ActivityMember[]).map(withCachedAvatar)
		const boot = buildActivityBootPayload(activityId, version, {
			user:    { id: userId, name: username, avatar: userAvatar ?? '' },
			members: snap,
			locale,
			theme:   $state.snapshot(theme) as Record<string, string>,
			storage: { url: storageUrl, surface: storageSurface, token: storageToken },
		})
		frame.contentWindow?.postMessage(boot, activityOrigin, [channel.port2])
		resolvePending(snap)   // les avatars qui manquent arriveront en `member_update`
	}

	function clearBootTimer() {
		if (bootTimer) { clearTimeout(bootTimer); bootTimer = null }
	}

	onMount(() => {
		if (!browser) return
		if (!activityOrigin) { status = 'error'; return }
		resolvePending(members)   // pré-charge les avatars pendant que le wasm télécharge
		void mintToken()          // jeton prêt avant le boot (sinon la frame en redemandera un)
		// Le jeton vit 600 s : on le renouvelle et on le pousse dans la frame.
		mintTimer = setInterval(() => {
			void mintToken().then((tok) => { if (status === 'ready') toGuest({ event: 'session', token: tok }) })
		}, 8 * 60 * 1000)
		window.addEventListener('message', onWindowMessage)
		document.addEventListener('fullscreenchange', onFsChange)
		bootTimer = setTimeout(() => { if (status === 'loading') status = 'error' }, 15000)
		socket?.on('activity:msg',          onActivityMsg)
		socket?.on('activity:snap',         onActivitySnap)
		socket?.on('activity:sync_request', onActivitySync)
		socket?.on('voice:speaking',        onVoiceSpeaking)
	})

	onDestroy(() => {
		if (!browser) return
		window.removeEventListener('message', onWindowMessage)
		document.removeEventListener('fullscreenchange', onFsChange)
		if (document.fullscreenElement === rootEl) document.exitFullscreen().catch(() => {})
		clearBootTimer()
		if (mintTimer) clearInterval(mintTimer)
		channel?.port1.close()
		socket?.off('activity:msg',          onActivityMsg)
		socket?.off('activity:snap',         onActivitySnap)
		socket?.off('activity:sync_request', onActivitySync)
		socket?.off('voice:speaking',        onVoiceSpeaking)
	})
</script>

<div
	bind:this={rootEl}
	aria-label={label}
	class="act-shell"
	class:act-fs={isFs}
>
	<!-- Chrome dessiné par l'HÔTE : une activité ne peut ni l'imiter ni le
	     masquer. Sans lui, un faux écran de connexion serait indiscernable. -->
	<div class="act-bar">
		<button class="act-back" onclick={onclose}>‹ {tFn('games.back_to_list')}</button>
		<span class="act-marker" aria-label={tFn('activity.marker_aria', { name: label })}>
			<span class="act-dot" aria-hidden="true"></span>
			<span class="act-name">{label}</span>
			<span class="act-origin">{originHost}</span>
		</span>
		<button class="act-fsbtn" onclick={toggleFs} title={tFn('voice_room.fullscreen')} aria-label={tFn('voice_room.fullscreen')}>
			{#if isFs}
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4M9 9H4m0 6h5v5m6-11h5m-5 0V4m0 16v-5m0 0h5"/></svg>
			{:else}
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
			{/if}
		</button>
		<button class="act-leave" onclick={onexit}>{tFn('activity.leave')}</button>
	</div>

	{#if status === 'error'}
		<div class="act-msg act-err">{tFn('activity.failed', { name: label })}</div>
	{:else}
		<iframe
			bind:this={frame}
			src={appUrl}
			title={label}
			sandbox="allow-scripts allow-same-origin"
			allow="fullscreen"
			referrerpolicy="no-referrer"
			class="act-frame"
			class:act-hidden={status !== 'ready'}
		></iframe>
		{#if status === 'loading'}
			<div class="act-msg">{tFn('activity.loading')}</div>
		{/if}
	{/if}
</div>

<style>
	/* Docké : remplit la zone de contenu du salon vocal (entre les sidebars). */
	.act-shell {
		position: relative; width: 100%; height: 100%;
		background: #07070c;
		display: flex; flex-direction: column; overflow: hidden;
	}
	/* En plein écran (API Fullscreen), le navigateur fait du .act-shell le bloc
	   conteneur = le viewport ; width/height:100% ci-dessus suffisent. .act-fs
	   n'est là que pour l'état des icônes de la barre. */
	.act-bar {
		flex-shrink: 0; height: 34px;
		display: flex; align-items: center; justify-content: space-between;
		padding: 0 10px;
		background: #0d0d14; border-bottom: 1px solid rgba(255,255,255,0.06);
	}
	.act-back {
		flex: none; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
		color: #9aa3b2; background: transparent; border: 0; border-radius: 6px;
	}
	.act-back:hover { color: #cbd5e1; background: rgba(255,255,255,0.06); }
	.act-marker {
		display: flex; align-items: center; gap: 8px;
		font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
		color: var(--nx-text-muted, #6b7280); min-width: 0;
		flex: 1; justify-content: center;
	}
	.act-dot { width: 5px; height: 5px; border-radius: 999px; background: #73cc8c; flex: none; }
	.act-name { color: var(--nx-text, #cbd5e1); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.act-origin { color: #4b5563; text-transform: none; letter-spacing: 0; }
	.act-fsbtn {
		flex: none; width: 26px; height: 22px; margin-right: 6px; padding: 3px; cursor: pointer;
		color: #9aa3b2; background: transparent; border: 0; border-radius: 6px;
	}
	.act-fsbtn svg { width: 100%; height: 100%; display: block; }
	.act-fsbtn:hover { color: #cbd5e1; background: rgba(255,255,255,0.06); }
	.act-leave {
		flex: none; padding: 4px 12px; font-size: 11px; font-weight: 700; cursor: pointer;
		color: #cbd5e1; background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
	}
	.act-leave:hover { background: rgba(255,255,255,0.12); }
	.act-frame { flex: 1; width: 100%; border: 0; display: block; background: #000; }
	.act-hidden { visibility: hidden; }
	.act-msg {
		position: absolute; inset: 34px 0 0 0;
		display: flex; align-items: center; justify-content: center;
		font-size: 13px; color: var(--nx-text-muted, #6b7280);
	}
	.act-err { color: #fca5a5; }
</style>
