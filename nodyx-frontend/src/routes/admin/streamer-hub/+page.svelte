<script lang="ts">
	import { page } from '$app/stores'
	import { invalidateAll, replaceState } from '$app/navigation'
	import { onMount, onDestroy } from 'svelte'
	import { fly } from 'svelte/transition'
	import { getSocket } from '$lib/socket'
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

	const TABS: Array<{ id: TabId; label: string; iconPath: string; soon?: boolean }> = [
		{ id: 'overview', label: 'Vue d\'ensemble', iconPath: 'M3 7a4 4 0 014-4h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7z M9 9h6v6H9z' },
		{ id: 'studio',   label: 'Studio Live',     iconPath: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
		{ id: 'rewards',  label: 'Récompenses',     iconPath: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zM5 21h14a2 2 0 002-2v-9a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2z' },
		{ id: 'overlays', label: 'Overlays OBS',    iconPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
		{ id: 'scenes',   label: 'Scènes',           iconPath: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM9 5v14M3 11h6M3 15h6' },
		{ id: 'bot',      label: 'Bot Chat',         iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
		{ id: 'deck',     label: 'Stream Deck',      iconPath: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
		{ id: 'sounds',   label: 'Soundboard',       iconPath: 'M9 18V5l12-2v13 M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z' },
		{ id: 'audience', label: 'Audience',        iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
		{ id: 'config',   label: 'Configuration',   iconPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
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
			pushToast(`Twitch lié : @${login} · ${subs} subscription${parseInt(subs, 10) > 1 ? 's' : ''} EventSub créée${parseInt(subs, 10) > 1 ? 's' : ''}`, true)
		} else if (twitch === 'replayed') {
			pushToast('Callback déjà traité (probable double-redirect). Le compte est lié.', true)
		} else if (twitch === 'error') {
			const reason = url.searchParams.get('reason') ?? 'inconnu'
			pushToast(`Connexion Twitch échouée : ${decodeURIComponent(reason)}`, false)
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
				pushToast('Impossible de démarrer OAuth (HTTP ' + res.status + ')', false)
				connecting = false
				return
			}
			const { authorizeUrl } = await res.json()
			window.location.href = authorizeUrl
		} catch {
			pushToast('Erreur réseau', false)
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
				pushToast('Tokens rafraîchis', true)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? 'Refresh échoué', false)
			}
		} catch {
			pushToast('Erreur réseau', false)
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
				pushToast(`Sync : ${j.created} créées, ${j.skipped} déjà OK, ${j.failed} en échec`, j.failed === 0)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? 'Sync échoué', false)
			}
		} catch {
			pushToast('Erreur réseau', false)
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
				pushToast(`Event ${j.eventType} injecté dans le pipeline`, true)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? 'Test event échoué', false)
			}
		} catch {
			pushToast('Erreur réseau', false)
		} finally {
			sendingTest = false
		}
	}

	async function disconnect() {
		if (!primary || disconnecting) return
		if (!confirm(`Déconnecter ${primary.externalLogin} ?\n\nLes tokens chiffrés seront supprimés et les subscriptions EventSub côté Twitch deviendront orphelines. Une reconnexion future les recréera.`)) return
		disconnecting = true
		try {
			const res = await fetch(`/api/v1/streamer/twitch/${primary.id}`, {
				method:  'DELETE',
				headers: authHeaders(),
			})
			if (res.ok) {
				pushToast('Streamer déconnecté', true)
				await invalidateAll()
			} else {
				pushToast('Déconnexion échouée', false)
			}
		} catch {
			pushToast('Erreur réseau', false)
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
		return future ? `dans ${v}` : `il y a ${v}`
	}

	function shortId(id: string | null): string {
		return id ? id.slice(0, 8) + '…' : ''
	}

	// Map status -> health bucket + visible label
	const SUBS_STATUS: Record<Subscription['status'], { ring: string; label: string }> = {
		enabled: { ring: 'bg-emerald-500',   label: 'OK'      },
		pending: { ring: 'bg-amber-400',     label: 'En attente' },
		failed:  { ring: 'bg-rose-500',      label: 'Échec'   },
		revoked: { ring: 'bg-rose-500',      label: 'Révoqué' },
	}

	const EVENT_META: Record<string, { label: string; tone: string; desc: string }> = {
		'channel.follow':            { label: 'Follow',         tone: 'cyan',    desc: 'Nouveau follower' },
		'channel.subscribe':         { label: 'Sub',            tone: 'purple',  desc: 'Abonnement direct' },
		'channel.subscription.gift': { label: 'Sub offert',     tone: 'pink',    desc: 'Sub offert à un viewer' },
		'channel.cheer':             { label: 'Bits',           tone: 'amber',   desc: 'Don de bits' },
		'channel.raid':              { label: 'Raid',           tone: 'red',     desc: 'Raid entrant' },
		'channel.poll.begin':        { label: 'Poll lancé',     tone: 'indigo',  desc: 'Sondage démarré' },
		'channel.poll.end':          { label: 'Poll terminé',   tone: 'indigo',  desc: 'Sondage clôturé' },
		'channel.chat.message':      { label: 'Message',        tone: 'slate',   desc: 'Message Twitch chat' },
		'stream.online':             { label: 'Live ON',        tone: 'emerald', desc: 'Diffusion en direct' },
		'stream.offline':            { label: 'Live OFF',       tone: 'slate',   desc: 'Diffusion terminée' },
	}

	// Render a human-readable summary from the raw EventSub payload, instead of
	// dumping JSON. Falls back to the event type if the shape is unexpected.
	function humanize(evt: RecentEvent): string {
		const e = evt.payload?.event ?? {}
		switch (evt.eventType) {
			case 'channel.follow':
				return `${e.user_name ?? e.user_login ?? '?'} a follow`
			case 'channel.subscribe': {
				const tier = String(e.tier ?? '').replace('000', '')
				return `${e.user_name ?? '?'} s'abonne (tier ${tier || '1'}${e.is_gift ? ' • offert' : ''})`
			}
			case 'channel.subscription.gift':
				return `${e.user_name ?? 'Anonyme'} offre ${e.total ?? 1} sub(s)`
			case 'channel.cheer':
				return `${e.is_anonymous ? 'Anonyme' : e.user_name ?? '?'} a cheer ${e.bits ?? '?'} bits`
			case 'channel.raid':
				return `Raid de ${e.from_broadcaster_user_name ?? '?'} avec ${e.viewers ?? '?'} viewers`
			case 'channel.poll.begin':
				return `Poll lancé : « ${e.title ?? '?'} » (${Array.isArray(e.choices) ? e.choices.length : '?'} choix)`
			case 'channel.poll.end':
				return `Poll terminé : « ${e.title ?? '?'} »`
			case 'channel.chat.message':
				return `${e.chatter_user_name ?? '?'} : ${typeof e.message === 'object' && e.message && 'text' in e.message ? String((e.message as { text: string }).text).slice(0, 80) : ''}`
			case 'stream.online':
				return `Stream live (${e.type ?? 'live'})`
			case 'stream.offline':
				return 'Stream terminé'
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
	<title>Streamer Hub : Administration</title>
</svelte:head>

<div class="max-w-6xl mx-auto space-y-6">

	<!-- Header sobre, sans icône colorée, sans badge tracking-widest. -->
	<header class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold text-zinc-100">Streamer Hub</h1>
			<p class="text-sm text-zinc-500 mt-1 max-w-2xl">
				Bridge Twitch auto-hébergé. OAuth chiffré AES-256-GCM, EventSub HMAC, chat unifié bidirectionnel.
			</p>
		</div>
		<div class="flex items-center gap-2 px-2.5 py-1 rounded-md border {isConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900'}">
			<span class="w-1.5 h-1.5 rounded-full {isConnected ? 'bg-emerald-400' : 'bg-zinc-600'}"></span>
			<span class="text-xs font-medium {isConnected ? 'text-emerald-300' : 'text-zinc-500'}">
				{isConnected ? 'Connecté' : 'Déconnecté'}
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
							<span class="hidden sm:inline">{tab.label}</span>
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
			<div class="text-[11px] text-slate-500">Bientôt dans Studio Live : raid composer (chercher un streamer + lancer un raid en un clic).</div>
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
			setup.overall === 'ok'      ? `${setup.checks.length} checks passés` :
			setup.overall === 'warning' ? `${setup.warningCount} avertissement${setup.warningCount > 1 ? 's' : ''}` :
			                              `${setup.downCount} bloquant${setup.downCount > 1 ? 's' : ''}`}
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
							{setup.overall === 'ok'      ? 'Ton stream est bien lié, tout passe.' :
							 setup.overall === 'warning' ? 'Connexion fonctionnelle, des points à surveiller.' :
							                               'Configuration incomplète, voici ce qu\'il manque.'}
						</div>
						<div class="text-[11px] text-slate-400 mt-0.5">{overallLabel} · clique pour voir le détail</div>
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
										<span class="text-[10px] uppercase tracking-wider font-semibold {iconColor} mr-1.5">Comment fixer</span>
										{c.fix}
									</div>
								{/if}
								{#if c.status !== 'ok' && c.docAnchor}
									<a href="https://nodyx.dev/streamer-hub#{c.docAnchor}" target="_blank" rel="noopener"
										class="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 mt-1.5">
										Voir la section dans la doc
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
				<div class="text-sm font-semibold text-rose-200">Stream live en cours</div>
				<div class="text-[11px] text-rose-300/80">Démarré {fmtRelative(health.currentSession.startedAt)} · les events EventSub arrivent en temps réel.</div>
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
					<span class="text-[10px] uppercase tracking-widest text-emerald-400/80 font-semibold">Connexion</span>
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
					{failedCount > 0 ? `${failedCount} en échec` : pendingCount > 0 ? `${pendingCount} en attente` : 'Toutes actives'}
				</div>
			</div>

			<!-- Chat bridge -->
			<div class="rounded-xl border {(health?.chatQueueSize ?? 0) > 50 ? 'border-amber-500/25 bg-amber-500/5' : 'border-emerald-500/25 bg-emerald-500/5'} p-4" title="Queue Redis des messages Nodyx en route vers le chat Twitch. > 50 = surcharge (Twitch rate-limit), Nodyx drop avec audit après 5 tentatives.">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {(health?.chatQueueSize ?? 0) > 50 ? 'text-amber-400/80' : 'text-emerald-400/80'}">Chat bridge</span>
					<span class="w-1.5 h-1.5 rounded-full {(health?.chatQueueSize ?? 0) > 50 ? 'bg-amber-400' : 'bg-emerald-400'}"></span>
				</div>
				<div class="text-base font-semibold text-white">
					{health?.chatQueueSize ?? '—'}<span class="text-slate-500 text-sm font-normal"> en queue</span>
				</div>
				<div class="text-[11px] text-slate-500 mt-0.5">
					{health?.linkedViewersCount ?? 0} viewer{(health?.linkedViewersCount ?? 0) > 1 ? 's' : ''} lié{(health?.linkedViewersCount ?? 0) > 1 ? 's' : ''}
				</div>
			</div>

			<!-- Activité -->
			<div class="rounded-xl border {activityHealth === 'ok' ? 'border-emerald-500/25 bg-emerald-500/5' : activityHealth === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-slate-600/30 bg-slate-700/10'} p-4" title="Heure du dernier événement reçu via EventSub. Si > 6h, vérifie que tes subscriptions sont enabled.">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {activityHealth === 'ok' ? 'text-emerald-400/80' : activityHealth === 'warning' ? 'text-amber-400/80' : 'text-slate-400/80'}">Activité</span>
					<span class="w-1.5 h-1.5 rounded-full {activityHealth === 'ok' ? 'bg-emerald-400' : activityHealth === 'warning' ? 'bg-amber-400' : 'bg-slate-500'}"></span>
				</div>
				<div class="text-base font-semibold text-white">
					{lastEvent ? EVENT_META[lastEvent.eventType]?.label ?? lastEvent.eventType : 'Aucun event'}
				</div>
				<div class="text-[11px] text-slate-500 mt-0.5">
					{lastEvent ? fmtRelative(lastEvent.occurredAt) : 'Lance un live ou demande un follow'}
				</div>
			</div>
		</section>
	{/if}

	<!-- ── Stats 7 jours (overview tab) ────────────────────────────────────── -->
	{#if isConnected && stats && activeTab === 'overview'}
		<section class="space-y-3">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold text-white">Stats des {stats.periodDays} derniers jours</h2>
				<span class="text-[11px] text-slate-500">Mise à jour à chaque rechargement</span>
			</div>
			<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
				{#each STAT_TYPES as type}
					{@const meta   = EVENT_META[type] ?? { label: type, tone: 'slate', desc: '' }}
					{@const total  = stats.totals[type] ?? 0}
					{@const series = stats.daily[type] ?? []}
					{@const color  = TONE_HEX[meta.tone] ?? TONE_HEX.slate}
					{@const trend  = trendOf(series)}
					<div class="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<span class="text-[10px] uppercase tracking-widest font-semibold text-slate-400">{meta.label}</span>
							{#if trend.dir === 'up'}
								<span class="text-[10px] font-mono text-emerald-400" title="J vs J-1">+{trend.delta}</span>
							{:else if trend.dir === 'down'}
								<span class="text-[10px] font-mono text-rose-400" title="J vs J-1">{trend.delta}</span>
							{:else}
								<span class="text-[10px] font-mono text-slate-500" title="J vs J-1">=</span>
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
						<div class="text-[11px] text-slate-500">{meta.desc}</div>
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
					<h2 class="text-lg font-semibold text-white">Connecter ton compte Twitch</h2>
					<p class="text-sm text-slate-400 mt-1.5">
						Tu seras redirigé vers Twitch pour autoriser Nodyx. Au retour, on souscrit automatiquement aux 9 événements EventSub Phase 1 + 2 et on chiffre les tokens AES-256-GCM avant écriture en base.
					</p>
				</div>
			</div>

			<div class="rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 space-y-3">
				<div class="text-xs font-semibold uppercase tracking-wider text-slate-300">Ce qui sera demandé à Twitch</div>
				<div class="flex flex-wrap gap-1.5">
					{#each ['user:read:email', 'channel:read:subscriptions', 'bits:read', 'moderator:read:followers', 'user:read:chat', 'user:write:chat', 'channel:read:polls'] as scope}
						<code class="text-[10px] font-mono bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded border border-slate-700/60">{scope}</code>
					{/each}
				</div>
				<div class="text-[11px] text-slate-500 leading-relaxed">
					Aucun de ces scopes ne donne accès à ta clé de streaming, à tes paramètres Twitch ou à ton historique de paiement. Seuls les events temps réel et l'envoi de messages dans ton propre chat sont permis.
				</div>
			</div>

			<!-- Où saisir les identifiants : pont vers Admin > Paramètres > Streamer Hub -->
			<a href="/admin/settings"
				class="block rounded-lg border border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 p-4 transition-colors">
				<div class="flex items-start gap-3">
					<svg class="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
					<div class="flex-1 min-w-0">
						<div class="text-sm font-semibold text-indigo-200">Première connexion ? Configure tes identifiants Twitch d'abord</div>
						<p class="text-[12px] text-slate-400 mt-1 leading-relaxed">
							Le <span class="text-indigo-300 font-medium">Client ID</span>, le <span class="text-indigo-300 font-medium">Client Secret</span> et la <span class="text-indigo-300 font-medium">clé de chiffrement</span> se saisissent dans
							<span class="text-indigo-300 font-medium">Paramètres → Streamer Hub</span>, sans toucher au fichier .env. Le diagnostic ci-dessus indique ce qui manque.
						</p>
						<span class="inline-flex items-center gap-1 text-[12px] text-indigo-300 hover:text-indigo-200 mt-2">
							Ouvrir les Paramètres
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
						</span>
					</div>
				</div>
			</a>

			<div class="flex flex-col sm:flex-row sm:justify-end gap-3">
				<button type="button" onclick={() => helpOpen = !helpOpen}
					class="text-sm text-slate-300 hover:text-white px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors inline-flex items-center gap-2">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
					Prérequis et FAQ
				</button>
				<button type="button" onclick={connectTwitch} disabled={connecting}
					class="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold px-5 py-2.5 rounded-lg transition-colors inline-flex items-center gap-2 shadow-lg shadow-cyan-500/30">
					{#if connecting}
						<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M20 4a16 16 0 00-16 16"/></svg>
						Redirection…
					{:else}
						Connecter Twitch
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
						Token expire {fmtDate(primary.expiresAt)} · Refresh auto programmé 30 min avant
					</div>
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each primary.scopes as scope}
							<code class="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700/60">{scope}</code>
						{/each}
					</div>
				</div>
				<div class="flex flex-col gap-2 shrink-0">
					<button type="button" onclick={syncSubscriptions} disabled={syncing}
						title="Recrée les subscriptions EventSub côté Twitch. Utile après l'ajout de nouveaux types d'events sans avoir à reconnecter."
						class="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-50 text-cyan-300 border border-cyan-500/30 px-3 py-1.5 rounded-lg transition-colors">
						{syncing ? 'Sync…' : 'Synchroniser EventSub'}
					</button>
					<button type="button" onclick={refreshTokens} disabled={refreshing}
						title="Force le refresh du access token Twitch via le refresh token. Sans effet si tokens encore frais."
						class="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-3 py-1.5 rounded-lg transition-colors">
						{refreshing ? 'Refresh…' : 'Refresh tokens'}
					</button>
					<button type="button" onclick={disconnect} disabled={disconnecting}
						title="Supprime les tokens chiffrés et révoque la subscription EventSub côté Twitch."
						class="text-xs bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-300 border border-rose-500/30 px-3 py-1.5 rounded-lg transition-colors">
						{disconnecting ? 'Déconnexion…' : 'Déconnecter'}
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
					<h3 class="text-sm font-semibold text-white">Tester le pipeline</h3>
					<p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
						Injecte un faux événement <strong class="text-slate-300">localement</strong>. Pas d'appel à Twitch, juste du test bout-en-bout (persist en base + dispatch vers <code class="font-mono text-cyan-300">#twitch-chat</code>). Utile pour valider sans attendre un vrai follow.
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
						{sendingTest ? 'Envoi…' : 'Injecter l\'event'}
					</button>
				</div>
			</div>
		</section>

		<!-- ── EventSub subscriptions ─────────────────────────────────────── -->
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/50 overflow-hidden">
			<header class="px-5 py-3 border-b border-slate-700/60 flex items-center justify-between">
				<div>
					<h2 class="text-sm font-semibold text-white">Subscriptions EventSub</h2>
					<p class="text-[11px] text-slate-500 mt-0.5">Chaque ligne représente un webhook actif côté Twitch. Si une ligne est en échec, clique "Synchroniser" pour la recréer.</p>
				</div>
				<div class="flex items-center gap-3 text-xs">
					<span class="text-emerald-300"><span class="text-emerald-400">●</span> {enabledCount} OK</span>
					{#if pendingCount > 0}<span class="text-amber-300"><span class="text-amber-400">●</span> {pendingCount} attente</span>{/if}
					{#if failedCount > 0}<span class="text-rose-300"><span class="text-rose-400">●</span> {failedCount} échec</span>{/if}
				</div>
			</header>
			<ul class="divide-y divide-slate-700/40">
				{#each subs as sub}
					{@const meta = EVENT_META[sub.eventType] ?? { label: sub.eventType, tone: 'slate', desc: '' }}
					{@const last = lastSeenByType.get(sub.eventType)}
					<li class="px-5 py-3 flex items-center gap-4 hover:bg-slate-800/20 transition-colors">
						<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border {TONE_CLASSES[meta.tone]} shrink-0 min-w-20 justify-center">{meta.label}</span>
						<div class="flex-1 min-w-0">
							<div class="text-sm text-slate-200 font-mono truncate" title={meta.desc}>{sub.eventType}</div>
							<div class="text-[11px] text-slate-500 mt-0.5">{meta.desc} · sub_id {shortId(sub.externalSubId)}</div>
						</div>
						<div class="text-[11px] text-slate-500 text-right hidden sm:block">
							{#if last}
								Dernier event<br/><span class="text-slate-300">{fmtRelative(last)}</span>
							{:else}
								<span class="text-slate-600">aucun event reçu</span>
							{/if}
						</div>
						<span class="inline-flex items-center gap-1.5 shrink-0">
							<span class="w-1.5 h-1.5 rounded-full {SUBS_STATUS[sub.status].ring}"></span>
							<span class="text-[10px] font-medium uppercase tracking-wider text-slate-400">{SUBS_STATUS[sub.status].label}</span>
						</span>
					</li>
				{:else}
					<li class="px-5 py-10 text-center text-sm text-slate-500">
						Aucune subscription créée. Rafraîchis la page après le callback OAuth, ou clique "Synchroniser EventSub".
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
					<h2 class="text-sm font-semibold text-white">Événements récents</h2>
					<p class="text-[11px] text-slate-500 mt-0.5">{events.length} dans le feed. Chaque event est persisté + diffusé dans <code class="font-mono text-cyan-300">#twitch-chat</code>.</p>
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
					{@const meta = EVENT_META[evt.eventType] ?? { label: evt.eventType, tone: 'slate', desc: '' }}
					<li class="px-5 py-2.5 flex items-center gap-3 text-sm hover:bg-slate-800/20 transition-colors"
						in:fly={{ y: -10, duration: 280 }}>
						<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border {TONE_CLASSES[meta.tone]} shrink-0 min-w-20 justify-center">{meta.label}</span>
						<span class="flex-1 text-slate-200 truncate" title={humanize(evt)}>{humanize(evt)}</span>
						<span class="shrink-0 text-[11px] text-slate-500 tabular-nums">{fmtRelative(evt.occurredAt)}</span>
					</li>
				{:else}
					<li class="px-5 py-10 text-center text-sm text-slate-500">
						Aucun événement reçu. Lance un stream ou demande à un viewer de te follow pour vérifier le pipeline end-to-end.
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
				<span class="text-sm font-semibold text-slate-200">Prérequis, dépannage et FAQ</span>
			</div>
			<svg class="w-4 h-4 text-slate-400 transition-transform {helpOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
		</button>
		{#if helpOpen}
			<div class="px-5 pb-5 space-y-5 text-sm text-slate-300 border-t border-slate-700/60 pt-4">
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">Avant de connecter</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li><strong class="text-slate-200">TWITCH_CLIENT_ID</strong> et <strong class="text-slate-200">TWITCH_CLIENT_SECRET</strong> doivent être définis dans <code class="font-mono text-cyan-300">nodyx-core/.env</code>. Crée l'app sur <code class="font-mono">dev.twitch.tv/console</code> avec comme redirect URI <code class="font-mono text-cyan-300">https://&lt;ton-domaine&gt;/api/v1/streamer/twitch/callback</code>.</li>
						<li><strong class="text-slate-200">STREAMER_OAUTH_KEY</strong> (32 octets hex) protège les tokens en base via AES-256-GCM + HKDF. <code class="font-mono text-slate-500">node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code></li>
						<li><strong class="text-slate-200">PUBLIC_BASE_URL</strong> doit pointer vers ton domaine public en HTTPS, c'est l'URL qui sera utilisée pour les webhooks EventSub (Twitch ne livre que sur HTTPS).</li>
					</ul>
				</div>
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">Quand utiliser quelle action</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li><strong class="text-slate-200">Synchroniser EventSub</strong> : après une mise à jour de Nodyx qui ajoute de nouveaux types d'events, ou si une subscription apparaît en échec.</li>
						<li><strong class="text-slate-200">Refresh tokens</strong> : seulement utile en débogage. Le refresh automatique tourne 30 min avant l'expiration.</li>
						<li><strong class="text-slate-200">Déconnecter</strong> : supprime les tokens chiffrés. Les subscriptions EventSub deviennent orphelines côté Twitch et seront recréées à la prochaine connexion.</li>
					</ul>
				</div>
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">Dépannage rapide</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li><strong class="text-slate-200">"Pipeline failure" au callback</strong> : vérifie <code class="font-mono text-cyan-300">TWITCH_CLIENT_SECRET</code>, l'URL de redirect Twitch (exact match), et que <code class="font-mono">PUBLIC_BASE_URL</code> est en HTTPS.</li>
						<li><strong class="text-slate-200">Subscription en échec</strong> : Twitch a renvoyé <code class="font-mono">webhook_callback_verification_failed</code>. Souvent un certificat HTTPS expiré ou un proxy qui bloque le POST avec body brut. Reset la sub via "Synchroniser".</li>
						<li><strong class="text-slate-200">Aucun event après 30 min</strong> : le HMAC est probablement invalide. Vérifie les logs <code class="font-mono text-cyan-300">pm2 logs nodyx-core | grep EventSub</code>.</li>
					</ul>
				</div>
				<div class="flex flex-wrap gap-3 pt-2 border-t border-slate-700/40">
					<a href="https://nodyx.dev/streamer-hub" target="_blank" rel="noopener" class="text-xs text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">
						Documentation complète
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
