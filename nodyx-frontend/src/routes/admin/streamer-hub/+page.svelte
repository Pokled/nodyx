<script lang="ts">
	import { page } from '$app/stores'
	import { invalidateAll, replaceState } from '$app/navigation'
	import { onMount, onDestroy } from 'svelte'
	import { fly } from 'svelte/transition'
	import { getSocket } from '$lib/socket'
	import { t as i18n } from '$lib/i18n'
	import Sparkline from '$lib/components/admin/Sparkline.svelte'
	import StreamerHero from '$lib/components/admin/StreamerHero.svelte'
	import StreamControlPanel from '$lib/components/admin/StreamControlPanel.svelte'
	import StudioEngagement   from '$lib/components/admin/StudioEngagement.svelte'
	import RewardsManager     from '$lib/components/admin/RewardsManager.svelte'
	import LinkedViewersPanel from '$lib/components/admin/LinkedViewersPanel.svelte'
	import ClipsPanel         from '$lib/components/admin/ClipsPanel.svelte'
	import BotChatTab         from '$lib/components/admin/BotChatTab.svelte'
	import DeckPanel          from '$lib/components/admin/DeckPanel.svelte'
	import SoundLibraryPanel  from '$lib/components/admin/SoundLibraryPanel.svelte'
	import OverlayManager     from '$lib/components/admin/OverlayManager.svelte'
	import ObsScenesPanel     from '$lib/components/admin/obs/ObsScenesPanel.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const tFn = $derived($i18n)

	type Subscription = {
		id:             string
		eventType:      string
		status:         'pending' | 'enabled' | 'revoked' | 'failed'
		externalSubId:  string
		callbackNonce:  string
		createdAt:      string
		enabledAt:      string | null
		revokedAt:      string | null
	}

	type StreamerRow = {
		id:             string
		externalId:     string
		externalLogin:  string
		scopes:         string[]
		expiresAt:      string
		isStreamer:     boolean
		rotatedAt:      string
	}

	type RecentEvent = {
		id:         string
		provider:   string
		eventType:  string
		payload:    { event?: Record<string, unknown>; subscription?: Record<string, unknown> }
		occurredAt: string
	}

	type HealthPayload = {
		chatQueueSize:      number | null
		linkedViewersCount: number | null
		lastEvent:          { eventType: string; occurredAt: string } | null
		currentSession:     { id: string; startedAt: string; endedAt?: string; live: boolean } | null
	}

	type SetupCheck = {
		id:        string
		label:     string
		status:    'ok' | 'warning' | 'down'
		summary:   string
		fix:       string | null
		docAnchor: string | null
	}
	type SetupPayload = {
		overall:      'ok' | 'warning' | 'down'
		checks:       SetupCheck[]
		downCount:    number
		warningCount: number
	}

	type StatsPayload = {
		periodDays: number
		dayLabels:  string[]            // ['2026-05-17', ...] (chronological)
		totals:     Record<string, number>
		daily:      Record<string, number[]>
	}

	type TwitchProfilePayload = {
		user: {
			id:                string
			login:             string
			displayName:       string
			avatarUrl:         string
			profileBannerUrl:  string | null
			description:       string
			broadcasterType:   'partner' | 'affiliate' | ''
			accountCreatedAt:  string
			totalViewCount:    number | null
		}
		stream: {
			isLive:       boolean
			gameName:     string | null
			title:        string | null
			viewerCount:  number | null
			startedAt:    string | null
			thumbnailUrl: string | null
			language:     string | null
		}
		followers: { total: number | null }
		fetchedAt: string
	}

	// Map tone (Tailwind name) → hex couleur pour la sparkline SVG inline.
	const TONE_HEX: Record<string, string> = {
		cyan:    '#06b6d4',
		purple:  '#a855f7',
		pink:    '#ec4899',
		amber:   '#f59e0b',
		red:     '#ef4444',
		indigo:  '#6366f1',
		slate:   '#64748b',
		emerald: '#10b981',
	}

	let connecting     = $state(false)
	let refreshing     = $state(false)
	let disconnecting  = $state(false)
	let syncing        = $state(false)
	let helpOpen       = $state(false)
	let setupOpen      = $state(false)  // collapsed by default, auto-opens below if not OK
	let toast          = $state<{ text: string; ok: boolean } | null>(null)
	let testEventType  = $state('channel.follow')
	let sendingTest    = $state(false)

	const primary       = $derived<StreamerRow | null>(data.primaryStreamer)
	const isConnected   = $derived(!!primary)
	const subs          = $derived<Subscription[]>(data.subscriptions ?? [])
	const enabledCount  = $derived(subs.filter(s => s.status === 'enabled').length)
	const failedCount   = $derived(subs.filter(s => s.status === 'failed').length)
	const pendingCount  = $derived(subs.filter(s => s.status === 'pending').length)
	// Live events arrive via Socket.IO and are prepended to the server-side list.
	// The combined list shows fresh events at the top with a slide+fade transition.
	let liveEvents = $state<RecentEvent[]>([])
	let liveCounter = $state(0)  // pulse the Activité card on each arrival
	const events        = $derived<RecentEvent[]>(
		[...liveEvents, ...(data.recentEvents ?? [])].slice(0, 50)
	)
	const health        = $derived<HealthPayload | null>(data.health ?? null)
	const setup         = $derived<SetupPayload | null>((data as { setup?: SetupPayload | null }).setup ?? null)
	const stats         = $derived<StatsPayload | null>((data as { stats?: StatsPayload | null }).stats ?? null)
	const twitchProfile = $derived<TwitchProfilePayload | null>((data as { profile?: TwitchProfilePayload | null }).profile ?? null)
	const controlHasScope = $derived<boolean>((data as { controlHasScope?: boolean }).controlHasScope === true)
	const engagementHasPolls       = $derived<boolean>((data as { engagementHasPolls?: boolean }).engagementHasPolls === true)
	const engagementHasPredictions = $derived<boolean>((data as { engagementHasPredictions?: boolean }).engagementHasPredictions === true)
	const rewardsHasScope          = $derived<boolean>((data as { rewardsHasScope?: boolean }).rewardsHasScope === true)
	const pageToken     = $derived(($page.data as { token?: string }).token ?? '')

	// ── Onglets ─────────────────────────────────────────────────────────────
	// 6 zones pour ne pas surcharger la page : overview / studio live /
	// récompenses / overlays / audience / config. Synchronisation #hash dans
	// l'URL pour deep-link (ex: /admin/streamer-hub#tab=studio). Si pas
	// connecté, on force "config" pour que l'utilisateur voie le bouton Connect.
	type TabId = 'overview' | 'studio' | 'rewards' | 'overlays' | 'scenes' | 'bot' | 'deck' | 'sounds' | 'audience' | 'config'

	const TABS: Array<{ id: TabId; labelKey: string; iconPath: string; soon?: boolean }> = [
		{ id: 'overview', labelKey: 'shub.tab_overview', iconPath: 'M3 7a4 4 0 014-4h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7z M9 9h6v6H9z' },
		{ id: 'studio',   labelKey: 'shub.tab_studio',   iconPath: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
		{ id: 'rewards',  labelKey: 'shub.tab_rewards',  iconPath: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zM5 21h14a2 2 0 002-2v-9a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2z' },
		{ id: 'overlays', labelKey: 'shub.tab_overlays', iconPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
		{ id: 'scenes',   labelKey: 'shub.tab_scenes',   iconPath: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM9 5v14M3 11h6M3 15h6' },
		{ id: 'bot',      labelKey: 'shub.tab_bot',      iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
		{ id: 'deck',     labelKey: 'shub.tab_deck',     iconPath: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
		{ id: 'sounds',   labelKey: 'shub.tab_sounds',   iconPath: 'M9 18V5l12-2v13 M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z' },
		{ id: 'audience', labelKey: 'shub.tab_audience', iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
		{ id: 'config',   labelKey: 'shub.tab_config',   iconPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
	]

	let activeTab = $state<TabId>('overview')

	function selectTab(t: TabId): void {
		if (TABS.find(x => x.id === t)?.soon) return  // "à venir" → no-op
		activeTab = t
		// La sync URL ↔ activeTab est faite dans un $effect plus bas, on n'a
		// rien à faire ici de plus que muter le state.
	}

	function readTabFromHash(): TabId | null {
		if (typeof window === 'undefined') return null
		const m = window.location.hash.match(/tab=([a-z]+)/)
		if (!m) return null
		const id = m[1] as TabId
		return TABS.some(t => t.id === id) ? id : null
	}

	// Sync activeTab → URL hash. Re-run à chaque changement d'activeTab.
	// On utilise EXCLUSIVEMENT history.replaceState natif (pas celui de
	// $app/navigation) pour ne pas trigger une ré-exécution SvelteKit qui
	// pourrait désynchroniser les handlers DOM du state réactif.
	$effect(() => {
		if (typeof window === 'undefined') return
		const t = activeTab
		const u = new URL(window.location.href)
		const wanted = `#tab=${t}`
		if (u.hash !== wanted) {
			u.hash = wanted
			window.history.replaceState({}, '', u.pathname + u.search + u.hash)
		}
	})

	// Ordre + types affichés dans les cartes Stats. On garde follow / sub /
	// cheer / raid (les "moments" de stream) et on exclut les messages (trop
	// de bruit pour une sparkline lisible).
	const STAT_TYPES = ['channel.follow', 'channel.subscribe', 'channel.cheer', 'channel.raid'] as const

	// Variation jour J vs jour J-1 (dernière barre vs avant-dernière).
	function trendOf(series: number[] | undefined): { dir: 'up' | 'down' | 'flat'; delta: number } {
		if (!series || series.length < 2) return { dir: 'flat', delta: 0 }
		const last = series[series.length - 1]
		const prev = series[series.length - 2]
		const delta = last - prev
		if (delta > 0) return { dir: 'up',   delta }
		if (delta < 0) return { dir: 'down', delta }
		return { dir: 'flat', delta: 0 }
	}

	// Auto-expand the checklist when something needs attention
	$effect(() => {
		if (setup && setup.overall !== 'ok') setupOpen = true
	})

	// Surface the OAuth callback result as a toast (instead of dumping raw JSON
	// in the address bar). The callback redirects here with ?twitch=connected,
	// ?twitch=replayed or ?twitch=error[&reason=...].
	// Init onglet : si déconnecté → config (le streamer doit voir le bouton
	// Connect en premier). Sinon, lis le hash de l'URL (#tab=studio par ex).
	// On écoute aussi hashchange + popstate pour que back/forward du navigateur
	// (ou édition manuelle du hash) re-sync l'onglet courant.
	let hashListener: (() => void) | null = null
	onMount(() => {
		if (!isConnected) {
			activeTab = 'config'
		} else {
			const fromHash = readTabFromHash()
			if (fromHash) activeTab = fromHash
		}

		hashListener = () => {
			const t = readTabFromHash()
			if (t && t !== activeTab) activeTab = t
		}
		window.addEventListener('hashchange', hashListener)
		window.addEventListener('popstate',   hashListener)
	})
	onDestroy(() => {
		if (hashListener && typeof window !== 'undefined') {
			window.removeEventListener('hashchange', hashListener)
			window.removeEventListener('popstate',   hashListener)
		}
	})

	onMount(() => {
		const url = new URL(window.location.href)
		const twitch = url.searchParams.get('twitch')
		if (!twitch) return

		if (twitch === 'connected') {
			const login = url.searchParams.get('login') ?? ''
			const subs  = url.searchParams.get('subs')  ?? '0'
			pushToast(parseInt(subs, 10) > 1 ? tFn('shub.twitch_linked_many', { login, subs }) : tFn('shub.twitch_linked_one', { login, subs }), true)
		} else if (twitch === 'replayed') {
			pushToast(tFn('shub.callback_replayed'), true)
		} else if (twitch === 'error') {
			const reason = url.searchParams.get('reason') ?? 'inconnu'
			pushToast(tFn('shub.twitch_failed', { reason: decodeURIComponent(reason) }), false)
		}

		// Clean the URL so the toast does not re-trigger on refresh.
		// IMPORTANT : on utilise history.replaceState natif et PAS celui de
		// $app/navigation. Le replaceState de SvelteKit peut causer une
		// ré-exécution du composant qui désynchronise les handlers DOM
		// (attachés à l'ancienne instance) du state réactif (sur la nouvelle).
		// Bug observé après Twitch deco/reco : les onglets ne réagissaient
		// plus aux clics tant qu'on n'avait pas refresh la page.
		url.searchParams.delete('twitch')
		url.searchParams.delete('login')
		url.searchParams.delete('subs')
		url.searchParams.delete('reason')
		const search = url.search ? url.search : ''
		const hash   = url.hash   ? url.hash   : ''
		window.history.replaceState({}, '', url.pathname + search + hash)
	})

	// ── Live feed via Socket.IO (admin-only room) ─────────────────────────
	let socketSub: (() => void) | null = null
	onMount(() => {
		const sock = getSocket()
		if (!sock) return
		sock.emit('streamer-hub:join')

		const onEvent = (evt: RecentEvent) => {
			// Skip the chat.message firehose, it's noise at this volume
			if (evt.eventType === 'channel.chat.message') return
			liveEvents = [evt, ...liveEvents].slice(0, 30)
			liveCounter++
			// If the new event is stream.online/offline, refresh the page data
			// so the Live banner + currentSession reflect the new state.
			if (evt.eventType === 'stream.online' || evt.eventType === 'stream.offline') {
				invalidateAll()
			}
		}
		sock.on('streamer:event', onEvent)
		socketSub = () => {
			sock.off('streamer:event', onEvent)
			sock.emit('streamer-hub:leave')
		}
	})
	onDestroy(() => { socketSub?.() })
	const liveNow       = $derived(health?.currentSession?.live === true)
	// Prefer the health endpoint timestamp (DB MAX) over the in-memory list head
	const lastEvent     = $derived(
		health?.lastEvent ?? (events[0] ? { eventType: events[0].eventType, occurredAt: events[0].occurredAt } : null)
	)

	const subsHealth = $derived(
		!primary           ? 'idle'    :
		failedCount  > 0   ? 'down'    :
		pendingCount > 0   ? 'warning' :
		enabledCount > 0   ? 'ok'      : 'idle'
	)
	const activityHealth = $derived(
		!lastEvent  ? 'idle' :
		(Date.now() - new Date(lastEvent.occurredAt).getTime()) < 6 * 60 * 60 * 1000 ? 'ok' : 'warning'
	)

	function pushToast(text: string, ok: boolean) {
		toast = { text, ok }
		setTimeout(() => { if (toast?.text === text) toast = null }, 3500)
	}

	function authHeaders(): Record<string, string> {
		const token = $page.data.token as string | null
		return token ? { 'Authorization': `Bearer ${token}` } : {}
	}

	async function connectTwitch() {
		if (connecting) return
		connecting = true
		try {
			const res = await fetch('/api/v1/streamer/twitch/auth-init', { headers: authHeaders() })
			if (!res.ok) {
				pushToast(tFn('shub.oauth_failed', { status: res.status }), false)
				connecting = false
				return
			}
			const { authorizeUrl } = await res.json()
			window.location.href = authorizeUrl
		} catch {
			pushToast(tFn('shub.err_network'), false)
			connecting = false
		}
	}

	async function refreshTokens() {
		if (!primary || refreshing) return
		refreshing = true
		try {
			const res = await fetch(`/api/v1/streamer/twitch/refresh/${primary.id}`, {
				method:  'POST',
				headers: authHeaders(),
			})
			if (res.ok) {
				pushToast(tFn('shub.tokens_refreshed'), true)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? tFn('shub.refresh_failed'), false)
			}
		} catch {
			pushToast(tFn('shub.err_network'), false)
		} finally {
			refreshing = false
		}
	}

	async function syncSubscriptions() {
		if (!primary || syncing) return
		syncing = true
		try {
			const res = await fetch('/api/v1/streamer/twitch/sync-subscriptions', {
				method:  'POST',
				headers: authHeaders(),
			})
			if (res.ok) {
				const j = await res.json()
				pushToast(tFn('shub.sync_result', { created: j.created, skipped: j.skipped, failed: j.failed }), j.failed === 0)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? tFn('shub.sync_failed'), false)
			}
		} catch {
			pushToast(tFn('shub.err_network'), false)
		} finally {
			syncing = false
		}
	}

	async function sendTestEvent() {
		if (sendingTest) return
		sendingTest = true
		try {
			const res = await fetch('/api/v1/streamer/test-event', {
				method:  'POST',
				headers: { ...authHeaders(), 'Content-Type': 'application/json' },
				body:    JSON.stringify({ eventType: testEventType }),
			})
			if (res.ok) {
				const j = await res.json()
				pushToast(tFn('shub.event_injected', { type: j.eventType }), true)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? tFn('shub.test_failed'), false)
			}
		} catch {
			pushToast(tFn('shub.err_network'), false)
		} finally {
			sendingTest = false
		}
	}

	async function disconnect() {
		if (!primary || disconnecting) return
		if (!confirm(tFn('shub.disconnect_confirm', { login: primary.externalLogin }))) return
		disconnecting = true
		try {
			const res = await fetch(`/api/v1/streamer/twitch/${primary.id}`, {
				method:  'DELETE',
				headers: authHeaders(),
			})
			if (res.ok) {
				pushToast(tFn('shub.disconnected'), true)
				await invalidateAll()
			} else {
				pushToast(tFn('shub.disconnect_failed'), false)
			}
		} catch {
			pushToast(tFn('shub.err_network'), false)
		} finally {
			disconnecting = false
		}
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleString('fr-FR', {
			day: '2-digit', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit',
		})
	}

	function fmtRelative(iso: string): string {
		const ms = Date.now() - new Date(iso).getTime()
		const s  = Math.floor(Math.abs(ms) / 1000)
		const future = ms < 0
		const v =
			s < 60    ? `${s}s` :
			s < 3600  ? `${Math.floor(s/60)}min` :
			s < 86400 ? `${Math.floor(s/3600)}h` :
			            `${Math.floor(s/86400)}j`
		return future ? tFn('shub.rel_future', { v }) : tFn('shub.rel_past', { v })
	}

	function shortId(id: string | null): string {
		return id ? id.slice(0, 8) + '…' : ''
	}

	// Map status -> health bucket + visible label
	const SUBS_STATUS: Record<Subscription['status'], { ring: string; labelKey: string }> = {
		enabled: { ring: 'bg-emerald-500',   labelKey: 'shub.status_enabled' },
		pending: { ring: 'bg-amber-400',     labelKey: 'shub.status_pending' },
		failed:  { ring: 'bg-rose-500',      labelKey: 'shub.status_failed' },
		revoked: { ring: 'bg-rose-500',      labelKey: 'shub.status_revoked' },
	}

	const EVENT_META: Record<string, { labelKey: string; tone: string; descKey: string }> = {
		'channel.follow':            { labelKey: 'shub.evt_follow_label',       tone: 'cyan',    descKey: 'shub.evt_follow_desc' },
		'channel.subscribe':         { labelKey: 'shub.evt_subscribe_label',    tone: 'purple',  descKey: 'shub.evt_subscribe_desc' },
		'channel.subscription.gift': { labelKey: 'shub.evt_gift_label',         tone: 'pink',    descKey: 'shub.evt_gift_desc' },
		'channel.cheer':             { labelKey: 'shub.evt_cheer_label',        tone: 'amber',   descKey: 'shub.evt_cheer_desc' },
		'channel.raid':              { labelKey: 'shub.evt_raid_label',         tone: 'red',     descKey: 'shub.evt_raid_desc' },
		'channel.poll.begin':        { labelKey: 'shub.evt_poll_begin_label',   tone: 'indigo',  descKey: 'shub.evt_poll_begin_desc' },
		'channel.poll.end':          { labelKey: 'shub.evt_poll_end_label',     tone: 'indigo',  descKey: 'shub.evt_poll_end_desc' },
		'channel.chat.message':      { labelKey: 'shub.evt_message_label',      tone: 'slate',   descKey: 'shub.evt_message_desc' },
		'stream.online':             { labelKey: 'shub.evt_online_label',       tone: 'emerald', descKey: 'shub.evt_online_desc' },
		'stream.offline':            { labelKey: 'shub.evt_offline_label',      tone: 'slate',   descKey: 'shub.evt_offline_desc' },
	}

	// Render a human-readable summary from the raw EventSub payload, instead of
	// dumping JSON. Falls back to the event type if the shape is unexpected.
	function humanize(evt: RecentEvent): string {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const e = (evt.payload?.event ?? {}) as Record<string, any>
		switch (evt.eventType) {
			case 'channel.follow':
				return tFn('shub.hum_follow', { name: e.user_name ?? e.user_login ?? '?' })
			case 'channel.subscribe': {
				const tier = String(e.tier ?? '').replace('000', '')
				return tFn('shub.hum_subscribe', { name: e.user_name ?? '?', tier: tier || '1', gift: e.is_gift ? tFn('shub.hum_gift_suffix') : '' })
			}
			case 'channel.subscription.gift':
				return tFn('shub.hum_gift', { name: e.user_name ?? tFn('shub.anonymous'), total: e.total ?? 1 })
			case 'channel.cheer':
				return tFn('shub.hum_cheer', { name: e.is_anonymous ? tFn('shub.anonymous') : e.user_name ?? '?', bits: e.bits ?? '?' })
			case 'channel.raid':
				return tFn('shub.hum_raid', { name: e.from_broadcaster_user_name ?? '?', viewers: e.viewers ?? '?' })
			case 'channel.poll.begin':
				return tFn('shub.hum_poll_begin', { title: e.title ?? '?', n: Array.isArray(e.choices) ? e.choices.length : '?' })
			case 'channel.poll.end':
				return tFn('shub.hum_poll_end', { title: e.title ?? '?' })
			case 'channel.chat.message':
				return `${e.chatter_user_name ?? '?'} : ${typeof e.message === 'object' && e.message && 'text' in e.message ? String((e.message as { text: string }).text).slice(0, 80) : ''}`
			case 'stream.online':
				return tFn('shub.hum_stream_online', { type: e.type ?? 'live' })
			case 'stream.offline':
				return tFn('shub.hum_stream_offline')
			default:
				return evt.eventType
		}
	}

	// Last seen timestamp per eventType, computed from recent events.
	const lastSeenByType = $derived((() => {
		const map = new Map<string, string>()
		for (const e of events) {
			if (!map.has(e.eventType)) map.set(e.eventType, e.occurredAt)
		}
		return map
	})())

	const TONE_CLASSES: Record<string, string> = {
		cyan:    'bg-cyan-500/15    text-cyan-300    border-cyan-500/30',
		purple:  'bg-purple-500/15  text-purple-300  border-purple-500/30',
		pink:    'bg-pink-500/15    text-pink-300    border-pink-500/30',
		amber:   'bg-amber-500/15   text-amber-300   border-amber-500/30',
		red:     'bg-rose-500/15    text-rose-300    border-rose-500/30',
		indigo:  'bg-indigo-500/15  text-indigo-300  border-indigo-500/30',
		emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
		slate:   'bg-slate-500/15   text-slate-300   border-slate-500/30',
	}
</script>

<svelte:head>
	<title>{tFn('shub.page_title')}</title>
</svelte:head>

<div class="max-w-6xl mx-auto space-y-6">

	<!-- Header sobre, sans icône colorée, sans badge tracking-widest. -->
	<header class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold text-zinc-100">Streamer Hub</h1>
			<p class="text-sm text-zinc-500 mt-1 max-w-2xl">
				{tFn('shub.subtitle')}
			</p>
		</div>
		<div class="flex items-center gap-2 px-2.5 py-1 rounded-md border {isConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900'}">
			<span class="w-1.5 h-1.5 rounded-full {isConnected ? 'bg-emerald-400' : 'bg-zinc-600'}"></span>
			<span class="text-xs font-medium {isConnected ? 'text-emerald-300' : 'text-zinc-500'}">
				{isConnected ? tFn('shub.connected') : tFn('shub.disconnected_status')}
			</span>
		</div>
	</header>

	<!-- ── Hero Twitch (avatar, live state, follower count, ticking timer) ─── -->
	{#if isConnected && twitchProfile}
		<StreamerHero profile={twitchProfile} />
	{/if}

	<!-- Tab bar : vrai rail surélevé, fond plein zinc-950 (plus sombre que la page),
	     bordure double pour suggérer le plan supérieur, ombre douce dessous. -->
	{#if isConnected}
		<nav class="sticky top-0 z-20 -mx-2 px-2 bg-zinc-950 border-y border-zinc-800 shadow-lg shadow-black/40">
			<ul class="flex gap-0.5 flex-wrap">
				{#each TABS as tab (tab.id)}
					{@const isActive = activeTab === tab.id}
					<li>
						<button
							type="button"
							onclick={() => selectTab(tab.id)}
							disabled={tab.soon}
							class="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative border-b-2 -mb-px
								{isActive
									? 'border-purple-500 text-zinc-100 bg-zinc-900/50'
									: tab.soon
										? 'border-transparent text-zinc-700 cursor-not-allowed'
										: 'border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/50'}">
							<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d={tab.iconPath}/>
							</svg>
							<span class="hidden sm:inline">{tFn(tab.labelKey)}</span>
							{#if tab.soon}
								<span class="text-[10px] uppercase tracking-wide font-medium text-zinc-500 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5">Soon</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	<!-- ══ Tab: Studio Live ════════════════════════════════════════════════ -->
	{#if isConnected && activeTab === 'studio'}
		{#if twitchProfile}
			<StreamControlPanel
				token={pageToken}
				hasManageScope={controlHasScope}
				currentTitle={twitchProfile.stream.title}
				currentGameName={twitchProfile.stream.gameName}
				isLive={twitchProfile.stream.isLive}
				onProfileUpdated={() => invalidateAll()}
			/>
		{/if}

		<StudioEngagement
			token={pageToken}
			hasPolls={engagementHasPolls}
			hasPredictions={engagementHasPredictions}
			broadcasterType={twitchProfile?.user.broadcasterType ?? ''}
		/>

		<ClipsPanel token={pageToken} />

		<section class="rounded-xl border border-dashed border-slate-700/60 bg-slate-900/30 p-6 text-center space-y-1">
			<div class="text-[11px] text-slate-500">{tFn('shub.studio_soon')}</div>
		</section>
	{/if}

	<!-- ══ Tab: Récompenses (Channel Points Rewards) ════════════════════ -->
	{#if isConnected && activeTab === 'rewards'}
		<RewardsManager
			token={pageToken}
			hasScope={rewardsHasScope}
			broadcasterType={twitchProfile?.user.broadcasterType ?? ''}
		/>
	{/if}

	<!-- ══ Tab: Overlays OBS ═══════════════════════════════════════════════ -->
	{#if isConnected && activeTab === 'overlays'}
		<OverlayManager token={pageToken} />
	{/if}

	<!-- ══ Tab: Scènes (compositeur OBS-like) ════════════════════════════ -->
	{#if isConnected && activeTab === 'scenes'}
		<ObsScenesPanel token={pageToken} />
	{/if}

	<!-- ══ Tab: Bot Chat (sous-nav Timers / Commandes) ═══════════════════ -->
	{#if isConnected && activeTab === 'bot'}
		<BotChatTab token={pageToken} />
	{/if}

	<!-- ══ Tab: Stream Deck ═══════════════════════════════════════════════ -->
	{#if isConnected && activeTab === 'deck'}
		<DeckPanel token={pageToken} />
	{/if}

	<!-- ══ Tab: Soundboard (bibliothèque audio) ══════════════════════════ -->
	{#if isConnected && activeTab === 'sounds'}
		<SoundLibraryPanel token={pageToken} />
	{/if}

	<!-- ══ Tab: Audience (Linked Viewers) ════════════════════════════════ -->
	{#if isConnected && activeTab === 'audience'}
		<LinkedViewersPanel token={pageToken} />
	{/if}

	<!-- ── Setup checklist (config tab — diagnostic visuel point par point) ── -->
	{#if setup && (!isConnected || activeTab === 'config')}
		{@const tone =
			setup.overall === 'ok'      ? 'border-emerald-500/30 bg-emerald-500/5' :
			setup.overall === 'warning' ? 'border-amber-500/30  bg-amber-500/5'   :
			                              'border-rose-500/30   bg-rose-500/5'}
		{@const dot =
			setup.overall === 'ok'      ? 'bg-emerald-400' :
			setup.overall === 'warning' ? 'bg-amber-400'   :
			                              'bg-rose-400'}
		{@const overallLabel =
			setup.overall === 'ok'      ? tFn('shub.checks_passed', { n: setup.checks.length }) :
			setup.overall === 'warning' ? (setup.warningCount > 1 ? tFn('shub.warnings_many', { n: setup.warningCount }) : tFn('shub.warnings_one', { n: setup.warningCount })) :
			                              (setup.downCount > 1 ? tFn('shub.blocking_many', { n: setup.downCount }) : tFn('shub.blocking_one', { n: setup.downCount }))}
		<section class="rounded-xl border {tone} overflow-hidden">
			<button type="button" onclick={() => setupOpen = !setupOpen}
				class="w-full px-5 py-3 flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors text-left">
				<div class="flex items-center gap-3">
					<span class="relative flex h-3 w-3">
						<span class="absolute inline-flex h-full w-full rounded-full {dot} opacity-50 animate-ping"></span>
						<span class="relative inline-flex rounded-full h-3 w-3 {dot}"></span>
					</span>
					<div>
						<div class="text-sm font-semibold text-white">
							{setup.overall === 'ok'      ? tFn('shub.overall_ok') :
							 setup.overall === 'warning' ? tFn('shub.overall_warning') :
							                               tFn('shub.overall_incomplete')}
						</div>
						<div class="text-[11px] text-slate-400 mt-0.5">{overallLabel} · {tFn('shub.click_detail')}</div>
					</div>
				</div>
				<svg class="w-4 h-4 text-slate-400 transition-transform {setupOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
			</button>

			{#if setupOpen}
				<ul class="divide-y divide-white/5">
					{#each setup.checks as c (c.id)}
						{@const iconColor =
							c.status === 'ok'      ? 'text-emerald-400' :
							c.status === 'warning' ? 'text-amber-400'   :
							                         'text-rose-400'}
						<li class="px-5 py-3 flex items-start gap-3">
							<span class="shrink-0 mt-0.5">
								{#if c.status === 'ok'}
									<svg class="w-4 h-4 {iconColor}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
								{:else if c.status === 'warning'}
									<svg class="w-4 h-4 {iconColor}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"/></svg>
								{:else}
									<svg class="w-4 h-4 {iconColor}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
								{/if}
							</span>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-sm font-medium {c.status === 'ok' ? 'text-slate-300' : 'text-white'}">{c.label}</span>
								</div>
								<div class="text-[11px] {c.status === 'ok' ? 'text-slate-500' : 'text-slate-400'} mt-0.5">{c.summary}</div>
								{#if c.status !== 'ok' && c.fix}
									<div class="mt-2 rounded-md bg-slate-900/60 border border-slate-700/40 px-3 py-2 text-[11px] text-slate-300 leading-relaxed">
										<span class="text-[10px] uppercase tracking-wider font-semibold {iconColor} mr-1.5">{tFn('shub.how_to_fix')}</span>
										{c.fix}
									</div>
								{/if}
								{#if c.status !== 'ok' && c.docAnchor}
									<a href="https://nodyx.dev/streamer-hub#{c.docAnchor}" target="_blank" rel="noopener"
										class="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 mt-1.5">
										{tFn('shub.see_doc_section')}
										<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
									</a>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<!-- ── Live banner (overview tab — fallback quand Hero pas dispo) ──────── -->
	{#if liveNow && health?.currentSession && !twitchProfile && activeTab === 'overview'}
		<div class="rounded-xl border border-rose-500/40 bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent p-4 flex items-center gap-3">
			<span class="relative flex h-3 w-3">
				<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-60"></span>
				<span class="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
			</span>
			<div class="flex-1">
				<div class="text-sm font-semibold text-rose-200">{tFn('shub.stream_live_now')}</div>
				<div class="text-[11px] text-rose-300/80">{tFn('shub.started')} {fmtRelative(health.currentSession.startedAt)} · {tFn('shub.events_realtime')}</div>
			</div>
			<span class="text-[10px] font-mono text-rose-400/60">session {shortId(health.currentSession.id)}</span>
		</div>
	{/if}

	<!-- ── Health overview (overview tab) ──────────────────────────────────── -->
	{#if isConnected && primary && activeTab === 'overview'}
		<section class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<!-- Connexion -->
			<div class="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest text-emerald-400/80 font-semibold">{tFn('shub.card_connection')}</span>
					<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
				</div>
				<div class="text-base font-semibold text-white truncate" title={primary.externalLogin}>{primary.externalLogin}</div>
				<div class="text-[11px] text-slate-500 mt-0.5 font-mono">twitch_id={primary.externalId}</div>
			</div>

			<!-- EventSub -->
			<div class="rounded-xl border {subsHealth === 'ok' ? 'border-emerald-500/25 bg-emerald-500/5' : subsHealth === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-rose-500/25 bg-rose-500/5'} p-4">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {subsHealth === 'ok' ? 'text-emerald-400/80' : subsHealth === 'warning' ? 'text-amber-400/80' : 'text-rose-400/80'}">EventSub</span>
					<span class="w-1.5 h-1.5 rounded-full {subsHealth === 'ok' ? 'bg-emerald-400' : subsHealth === 'warning' ? 'bg-amber-400' : 'bg-rose-400'}"></span>
				</div>
				<div class="text-base font-semibold text-white">{enabledCount}<span class="text-slate-500 text-sm font-normal"> / {subs.length}</span></div>
				<div class="text-[11px] text-slate-500 mt-0.5">
					{failedCount > 0 ? tFn('shub.n_failed', { n: failedCount }) : pendingCount > 0 ? tFn('shub.n_pending', { n: pendingCount }) : tFn('shub.all_active')}
				</div>
			</div>

			<!-- Chat bridge -->
			<div class="rounded-xl border {(health?.chatQueueSize ?? 0) > 50 ? 'border-amber-500/25 bg-amber-500/5' : 'border-emerald-500/25 bg-emerald-500/5'} p-4" title={tFn('shub.chat_queue_title')}>
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {(health?.chatQueueSize ?? 0) > 50 ? 'text-amber-400/80' : 'text-emerald-400/80'}">Chat bridge</span>
					<span class="w-1.5 h-1.5 rounded-full {(health?.chatQueueSize ?? 0) > 50 ? 'bg-amber-400' : 'bg-emerald-400'}"></span>
				</div>
				<div class="text-base font-semibold text-white">
					{health?.chatQueueSize ?? '—'}<span class="text-slate-500 text-sm font-normal"> {tFn('shub.in_queue')}</span>
				</div>
				<div class="text-[11px] text-slate-500 mt-0.5">
					{(health?.linkedViewersCount ?? 0) > 1 ? tFn('shub.viewers_linked_many', { n: health?.linkedViewersCount ?? 0 }) : tFn('shub.viewers_linked_one', { n: health?.linkedViewersCount ?? 0 })}
				</div>
			</div>

			<!-- Activité -->
			<div class="rounded-xl border {activityHealth === 'ok' ? 'border-emerald-500/25 bg-emerald-500/5' : activityHealth === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-slate-600/30 bg-slate-700/10'} p-4" title={tFn('shub.activity_title')}>
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {activityHealth === 'ok' ? 'text-emerald-400/80' : activityHealth === 'warning' ? 'text-amber-400/80' : 'text-slate-400/80'}">{tFn('shub.card_activity')}</span>
					<span class="w-1.5 h-1.5 rounded-full {activityHealth === 'ok' ? 'bg-emerald-400' : activityHealth === 'warning' ? 'bg-amber-400' : 'bg-slate-500'}"></span>
				</div>
				<div class="text-base font-semibold text-white">
					{lastEvent ? (EVENT_META[lastEvent.eventType] ? tFn(EVENT_META[lastEvent.eventType].labelKey) : lastEvent.eventType) : tFn('shub.no_event')}
				</div>
				<div class="text-[11px] text-slate-500 mt-0.5">
					{lastEvent ? fmtRelative(lastEvent.occurredAt) : tFn('shub.no_activity_hint')}
				</div>
			</div>
		</section>
	{/if}

	<!-- ── Stats 7 jours (overview tab) ────────────────────────────────────── -->
	{#if isConnected && stats && activeTab === 'overview'}
		<section class="space-y-3">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold text-white">{tFn('shub.stats_title', { n: stats.periodDays })}</h2>
				<span class="text-[11px] text-slate-500">{tFn('shub.stats_update_note')}</span>
			</div>
			<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
				{#each STAT_TYPES as type}
					{@const meta   = EVENT_META[type]}
					{@const total  = stats.totals[type] ?? 0}
					{@const series = stats.daily[type] ?? []}
					{@const color  = TONE_HEX[meta?.tone ?? 'slate'] ?? TONE_HEX.slate}
					{@const trend  = trendOf(series)}
					<div class="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<span class="text-[10px] uppercase tracking-widest font-semibold text-slate-400">{meta ? tFn(meta.labelKey) : type}</span>
							{#if trend.dir === 'up'}
								<span class="text-[10px] font-mono text-emerald-400" title={tFn('shub.trend_title')}>+{trend.delta}</span>
							{:else if trend.dir === 'down'}
								<span class="text-[10px] font-mono text-rose-400" title={tFn('shub.trend_title')}>{trend.delta}</span>
							{:else}
								<span class="text-[10px] font-mono text-slate-500" title={tFn('shub.trend_title')}>=</span>
							{/if}
						</div>
						<div class="flex items-end justify-between gap-3">
							<div class="text-2xl font-semibold text-white leading-none" style="color: {color};">
								{total}
							</div>
							<Sparkline
								series={series}
								labels={stats.dayLabels}
								color={color}
								width={90}
								height={32}
							/>
						</div>
						<div class="text-[11px] text-slate-500">{meta ? tFn(meta.descKey) : ''}</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- ── Connection card (when disconnected) ─────────────────────────────── -->
	{#if !isConnected}
		<section class="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 via-slate-900 to-indigo-950/40 p-6 space-y-5">
			<div class="flex items-start gap-4">
				<div class="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
					<svg class="w-6 h-6 text-cyan-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
				</div>
				<div class="flex-1">
					<h2 class="text-lg font-semibold text-white">{tFn('shub.connect_title')}</h2>
					<p class="text-sm text-slate-400 mt-1.5">
						{tFn('shub.connect_desc')}
					</p>
				</div>
			</div>

			<div class="rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 space-y-3">
				<div class="text-xs font-semibold uppercase tracking-wider text-slate-300">{tFn('shub.scopes_title')}</div>
				<div class="flex flex-wrap gap-1.5">
					{#each ['user:read:email', 'channel:read:subscriptions', 'bits:read', 'moderator:read:followers', 'user:read:chat', 'user:write:chat', 'channel:read:polls'] as scope}
						<code class="text-[10px] font-mono bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded border border-slate-700/60">{scope}</code>
					{/each}
				</div>
				<div class="text-[11px] text-slate-500 leading-relaxed">
					{tFn('shub.scopes_note')}
				</div>
			</div>

			<!-- Où saisir les identifiants : pont vers Admin > Paramètres > Streamer Hub -->
			<a href="/admin/settings"
				class="block rounded-lg border border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 p-4 transition-colors">
				<div class="flex items-start gap-3">
					<svg class="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
					<div class="flex-1 min-w-0">
						<div class="text-sm font-semibold text-indigo-200">{tFn('shub.first_connect_title')}</div>
						<p class="text-[12px] text-slate-400 mt-1 leading-relaxed">
							{tFn('shub.creds_1')} <span class="text-indigo-300 font-medium">Client ID</span>{tFn('shub.creds_2')} <span class="text-indigo-300 font-medium">Client Secret</span> {tFn('shub.creds_3')} <span class="text-indigo-300 font-medium">{tFn('shub.encryption_key')}</span> {tFn('shub.creds_4')}
							<span class="text-indigo-300 font-medium">{tFn('shub.settings_path')}</span>{tFn('shub.creds_5')}
						</p>
						<span class="inline-flex items-center gap-1 text-[12px] text-indigo-300 hover:text-indigo-200 mt-2">
							{tFn('shub.open_settings')}
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
						</span>
					</div>
				</div>
			</a>

			<div class="flex flex-col sm:flex-row sm:justify-end gap-3">
				<button type="button" onclick={() => helpOpen = !helpOpen}
					class="text-sm text-slate-300 hover:text-white px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors inline-flex items-center gap-2">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
					{tFn('shub.prereq_faq')}
				</button>
				<button type="button" onclick={connectTwitch} disabled={connecting}
					class="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold px-5 py-2.5 rounded-lg transition-colors inline-flex items-center gap-2 shadow-lg shadow-cyan-500/30">
					{#if connecting}
						<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M20 4a16 16 0 00-16 16"/></svg>
						{tFn('shub.redirecting')}
					{:else}
						{tFn('shub.connect_twitch_btn')}
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
					{/if}
				</button>
			</div>
		</section>
	{:else if primary}
		<!-- ── Streamer details (config tab) ──────────────────────────────── -->
		{#if activeTab === 'config'}
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
			<div class="flex items-start gap-4">
				<div class="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
					<svg class="w-6 h-6 text-cyan-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
				</div>
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 flex-wrap">
						<h2 class="text-lg font-semibold text-white">{primary.externalLogin}</h2>
						<span class="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded">twitch_id={primary.externalId}</span>
					</div>
					<div class="text-xs text-slate-500 mt-1">
						{tFn('shub.token_expires', { date: fmtDate(primary.expiresAt) })}
					</div>
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each primary.scopes as scope}
							<code class="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700/60">{scope}</code>
						{/each}
					</div>
				</div>
				<div class="flex flex-col gap-2 shrink-0">
					<button type="button" onclick={syncSubscriptions} disabled={syncing}
						title={tFn('shub.sync_title')}
						class="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-50 text-cyan-300 border border-cyan-500/30 px-3 py-1.5 rounded-lg transition-colors">
						{syncing ? tFn('shub.syncing') : tFn('shub.sync_btn')}
					</button>
					<button type="button" onclick={refreshTokens} disabled={refreshing}
						title={tFn('shub.refresh_title')}
						class="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-3 py-1.5 rounded-lg transition-colors">
						{refreshing ? tFn('shub.refreshing') : tFn('shub.refresh_btn')}
					</button>
					<button type="button" onclick={disconnect} disabled={disconnecting}
						title={tFn('shub.disconnect_title')}
						class="text-xs bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-300 border border-rose-500/30 px-3 py-1.5 rounded-lg transition-colors">
						{disconnecting ? tFn('shub.disconnecting') : tFn('shub.disconnect_btn')}
					</button>
				</div>
			</div>
		</section>

		<!-- ── Test event tool ────────────────────────────────────────────── -->
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/30 p-5">
			<div class="flex items-start gap-4 flex-wrap">
				<div class="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
					<svg class="w-5 h-5 text-amber-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
				</div>
				<div class="flex-1 min-w-72">
					<h3 class="text-sm font-semibold text-white">{tFn('shub.test_pipeline_title')}</h3>
					<p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
						{tFn('shub.test_desc_1')} <strong class="text-slate-300">{tFn('shub.locally')}</strong>{tFn('shub.test_desc_2')} <code class="font-mono text-cyan-300">#twitch-chat</code>{tFn('shub.test_desc_3')}
					</p>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					<select bind:value={testEventType} disabled={sendingTest}
						class="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500">
						<option value="channel.follow">Follow</option>
						<option value="channel.subscribe">Sub</option>
						<option value="channel.cheer">Bits (42)</option>
						<option value="channel.raid">Raid (17 viewers)</option>
						<option value="stream.online">Live ON</option>
					</select>
					<button type="button" onclick={sendTestEvent} disabled={sendingTest}
						class="text-xs bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 text-amber-200 border border-amber-500/30 px-3 py-2 rounded-lg transition-colors inline-flex items-center gap-1.5">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
						{sendingTest ? tFn('shub.sending') : tFn('shub.inject_event')}
					</button>
				</div>
			</div>
		</section>

		<!-- ── EventSub subscriptions ─────────────────────────────────────── -->
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/50 overflow-hidden">
			<header class="px-5 py-3 border-b border-slate-700/60 flex items-center justify-between">
				<div>
					<h2 class="text-sm font-semibold text-white">Subscriptions EventSub</h2>
					<p class="text-[11px] text-slate-500 mt-0.5">{tFn('shub.subs_desc')}</p>
				</div>
				<div class="flex items-center gap-3 text-xs">
					<span class="text-emerald-300"><span class="text-emerald-400">●</span> {enabledCount} OK</span>
					{#if pendingCount > 0}<span class="text-amber-300"><span class="text-amber-400">●</span> {pendingCount} {tFn('shub.pending_short')}</span>{/if}
					{#if failedCount > 0}<span class="text-rose-300"><span class="text-rose-400">●</span> {failedCount} {tFn('shub.failed_short')}</span>{/if}
				</div>
			</header>
			<ul class="divide-y divide-slate-700/40">
				{#each subs as sub}
					{@const meta = EVENT_META[sub.eventType]}
					{@const last = lastSeenByType.get(sub.eventType)}
					<li class="px-5 py-3 flex items-center gap-4 hover:bg-slate-800/20 transition-colors">
						<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border {TONE_CLASSES[meta?.tone ?? 'slate']} shrink-0 min-w-20 justify-center">{meta ? tFn(meta.labelKey) : sub.eventType}</span>
						<div class="flex-1 min-w-0">
							<div class="text-sm text-slate-200 font-mono truncate" title={meta ? tFn(meta.descKey) : ''}>{sub.eventType}</div>
							<div class="text-[11px] text-slate-500 mt-0.5">{meta ? tFn(meta.descKey) : ''} · sub_id {shortId(sub.externalSubId)}</div>
						</div>
						<div class="text-[11px] text-slate-500 text-right hidden sm:block">
							{#if last}
								{tFn('shub.last_event_label')}<br/><span class="text-slate-300">{fmtRelative(last)}</span>
							{:else}
								<span class="text-slate-600">{tFn('shub.no_event_received')}</span>
							{/if}
						</div>
						<span class="inline-flex items-center gap-1.5 shrink-0">
							<span class="w-1.5 h-1.5 rounded-full {SUBS_STATUS[sub.status].ring}"></span>
							<span class="text-[10px] font-medium uppercase tracking-wider text-slate-400">{tFn(SUBS_STATUS[sub.status].labelKey)}</span>
						</span>
					</li>
				{:else}
					<li class="px-5 py-10 text-center text-sm text-slate-500">
						{tFn('shub.no_subs')}
					</li>
				{/each}
			</ul>
		</section>
		{/if}<!-- /config tab (streamer details + test event + EventSub subs) -->

		<!-- ── Recent events feed (overview tab) ──────────────────────────── -->
		{#if activeTab === 'overview'}
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/50 overflow-hidden">
			<header class="px-5 py-3 border-b border-slate-700/60 flex items-start justify-between gap-3">
				<div>
					<h2 class="text-sm font-semibold text-white">{tFn('shub.recent_events')}</h2>
					<p class="text-[11px] text-slate-500 mt-0.5">{tFn('shub.feed_desc', { n: events.length })} <code class="font-mono text-cyan-300">#twitch-chat</code>.</p>
				</div>
				<span class="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-emerald-300 shrink-0">
					<span class="relative flex h-2 w-2">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
					</span>
					Live{liveCounter > 0 ? ` · ${liveCounter}` : ''}
				</span>
			</header>
			<ul class="divide-y divide-slate-700/40">
				{#each events as evt (evt.id)}
					{@const meta = EVENT_META[evt.eventType]}
					<li class="px-5 py-2.5 flex items-center gap-3 text-sm hover:bg-slate-800/20 transition-colors"
						in:fly={{ y: -10, duration: 280 }}>
						<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border {TONE_CLASSES[meta?.tone ?? 'slate']} shrink-0 min-w-20 justify-center">{meta ? tFn(meta.labelKey) : evt.eventType}</span>
						<span class="flex-1 text-slate-200 truncate" title={humanize(evt)}>{humanize(evt)}</span>
						<span class="shrink-0 text-[11px] text-slate-500 tabular-nums">{fmtRelative(evt.occurredAt)}</span>
					</li>
				{:else}
					<li class="px-5 py-10 text-center text-sm text-slate-500">
						{tFn('shub.no_events')}
					</li>
				{/each}
			</ul>
		</section>
		{/if}<!-- /overview tab (recent events feed) -->
	{/if}

	<!-- ── Help & FAQ (config tab + always when disconnected) ─────────────── -->
	{#if !isConnected || activeTab === 'config'}
	<section class="rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
		<button type="button" onclick={() => helpOpen = !helpOpen}
			class="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
			<div class="flex items-center gap-3">
				<svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
				<span class="text-sm font-semibold text-slate-200">{tFn('shub.faq_title')}</span>
			</div>
			<svg class="w-4 h-4 text-slate-400 transition-transform {helpOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
		</button>
		{#if helpOpen}
			<div class="px-5 pb-5 space-y-5 text-sm text-slate-300 border-t border-slate-700/60 pt-4">
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">{tFn('shub.faq_before_title')}</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li>{@html tFn('shub.faq_env_1')}</li>
						<li>{@html tFn('shub.faq_env_2')}</li>
						<li>{@html tFn('shub.faq_env_3')}</li>
					</ul>
				</div>
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">{tFn('shub.faq_actions_title')}</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li>{@html tFn('shub.faq_action_1')}</li>
						<li>{@html tFn('shub.faq_action_2')}</li>
						<li>{@html tFn('shub.faq_action_3')}</li>
					</ul>
				</div>
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">{tFn('shub.faq_trouble_title')}</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li>{@html tFn('shub.faq_trouble_1')}</li>
						<li>{@html tFn('shub.faq_trouble_2')}</li>
						<li>{@html tFn('shub.faq_trouble_3')}</li>
					</ul>
				</div>
				<div class="flex flex-wrap gap-3 pt-2 border-t border-slate-700/40">
					<a href="https://nodyx.dev/streamer-hub" target="_blank" rel="noopener" class="text-xs text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">
						{tFn('shub.doc_complete')}
						<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
					</a>
					<a href="https://dev.twitch.tv/docs/eventsub/" class="text-xs text-slate-400 hover:text-slate-300 inline-flex items-center gap-1">
						EventSub Reference Twitch
						<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
					</a>
				</div>
			</div>
		{/if}
	</section>
	{/if}<!-- /config or disconnected (Help & FAQ) -->

	{#if toast}
		<div class="fixed bottom-6 right-6 max-w-sm px-4 py-3 rounded-lg shadow-lg text-sm
		            {toast.ok ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-100'
		                      : 'bg-rose-500/15 border border-rose-500/40 text-rose-100'}">
			{toast.text}
		</div>
	{/if}
</div>
