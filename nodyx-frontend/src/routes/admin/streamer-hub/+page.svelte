<script lang="ts">
	import { page } from '$app/stores'
	import { invalidateAll } from '$app/navigation'
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

	let connecting    = $state(false)
	let refreshing    = $state(false)
	let disconnecting = $state(false)
	let syncing       = $state(false)
	let toast         = $state<{ text: string; ok: boolean } | null>(null)

	const primary       = $derived<StreamerRow | null>(data.primaryStreamer)
	const isConnected   = $derived(!!primary)
	const subs          = $derived<Subscription[]>(data.subscriptions ?? [])
	const enabledCount  = $derived(subs.filter(s => s.status === 'enabled').length)
	const failedCount   = $derived(subs.filter(s => s.status === 'failed').length)
	const events        = $derived(data.recentEvents ?? [])

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
				pushToast('Tokens refresh OK', true)
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
				pushToast(
					`Sync : ${j.created} créées, ${j.skipped} skippées, ${j.failed} en échec`,
					j.failed === 0,
				)
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

	async function disconnect() {
		if (!primary || disconnecting) return
		if (!confirm(`Déconnecter ${primary.externalLogin} ? Les tokens seront supprimés et toutes les subscriptions EventSub seront orphelines côté Twitch.`)) return
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
		const s  = Math.floor(ms / 1000)
		if (s < 60)        return `il y a ${s}s`
		if (s < 3600)      return `il y a ${Math.floor(s/60)}min`
		if (s < 86400)     return `il y a ${Math.floor(s/3600)}h`
		if (s < 86400*30)  return `il y a ${Math.floor(s/86400)}j`
		return fmtDate(iso)
	}

	function shortId(id: string | null): string {
		if (!id) return '—'
		return id.slice(0, 8) + '…'
	}

	const STATUS_STYLE: Record<Subscription['status'], string> = {
		pending:  'bg-amber-900/40 text-amber-300 border-amber-800/60',
		enabled:  'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
		revoked:  'bg-rose-900/40 text-rose-300 border-rose-800/60',
		failed:   'bg-rose-900/40 text-rose-300 border-rose-800/60',
	}

	const EVENT_LABELS: Record<string, { label: string; icon: string }> = {
		'channel.follow':              { label: 'Follow',           icon: '➕' },
		'channel.subscribe':           { label: 'Sub',              icon: '⭐' },
		'channel.subscription.gift':   { label: 'Sub gift',         icon: '🎁' },
		'channel.cheer':               { label: 'Bits',             icon: '💎' },
		'channel.raid':                { label: 'Raid',             icon: '🚀' },
		'channel.poll.begin':          { label: 'Poll start',       icon: '📊' },
		'channel.poll.end':            { label: 'Poll end',         icon: '🏁' },
		'stream.online':               { label: 'Stream live',      icon: '🎬' },
		'stream.offline':              { label: 'Stream offline',   icon: '⏹️' },
	}
</script>

<svelte:head>
	<title>Streamer Hub — Administration</title>
</svelte:head>

<div class="max-w-5xl mx-auto space-y-6">

	<!-- Header -->
	<header class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-white flex items-center gap-3">
				<span class="text-3xl">🎬</span>
				Streamer Hub
			</h1>
			<p class="text-sm text-gray-400 mt-1.5">
				OAuth Twitch + EventSub temps réel. Phase 1 : alertes follow / sub / raid / bits / polls / live.
			</p>
		</div>
		{#if isConnected}
			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
				<span class="text-sm font-medium text-emerald-300">Connecté</span>
			</div>
		{:else}
			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full bg-gray-500"></span>
				<span class="text-sm font-medium text-gray-400">Déconnecté</span>
			</div>
		{/if}
	</header>

	<!-- Connection card -->
	{#if !isConnected}
		<section class="rounded-xl border border-violet-900/40 bg-gradient-to-br from-violet-950/50 to-gray-900 p-6 space-y-4">
			<div class="flex items-start gap-4">
				<div class="w-12 h-12 rounded-xl bg-violet-700/30 border border-violet-700/40 flex items-center justify-center text-2xl shrink-0">
					🎬
				</div>
				<div class="flex-1">
					<h2 class="text-lg font-semibold text-white">Connecter ton compte Twitch</h2>
					<p class="text-sm text-gray-400 mt-1">
						Tu seras redirigé vers Twitch pour autoriser Nodyx Streamer Hub. Au retour, on souscrira
						automatiquement aux 9 événements EventSub Phase 1 sur ta chaîne.
					</p>
				</div>
			</div>
			<div class="text-xs text-gray-500 leading-relaxed pl-16">
				<strong class="text-gray-300">Scopes demandés :</strong>
				user:read:email · channel:read:subscriptions · bits:read · moderator:read:followers ·
				user:read:chat · user:write:chat · channel:read:polls
			</div>
			<div class="flex justify-end pl-16">
				<button
					onclick={connectTwitch}
					disabled={connecting}
					class="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed
					       text-white font-medium px-5 py-2.5 rounded-lg transition-colors
					       inline-flex items-center gap-2"
				>
					{#if connecting}
						<span class="animate-spin">◌</span> Redirection…
					{:else}
						Connecter Twitch
					{/if}
				</button>
			</div>
		</section>
	{:else if primary}
		<!-- Streamer card -->
		<section class="rounded-xl border border-gray-800 bg-gray-900 p-6">
			<div class="flex items-start gap-4">
				<div class="w-12 h-12 rounded-xl bg-violet-700/30 border border-violet-700/40 flex items-center justify-center text-2xl shrink-0">
					🎬
				</div>
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 flex-wrap">
						<h2 class="text-lg font-semibold text-white">{primary.externalLogin}</h2>
						<span class="text-xs text-gray-500 font-mono">twitch_id={primary.externalId}</span>
					</div>
					<div class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-400">
						<div>
							<span class="text-gray-500">Access expire</span>
							<span class="text-gray-200 ml-1.5">{fmtDate(primary.expiresAt)}</span>
						</div>
						<div>
							<span class="text-gray-500">Dernière rotation</span>
							<span class="text-gray-200 ml-1.5">{fmtRelative(primary.rotatedAt)}</span>
						</div>
					</div>
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each primary.scopes as scope}
							<span class="text-[10px] font-mono bg-gray-800 text-gray-300 px-2 py-0.5 rounded">{scope}</span>
						{/each}
					</div>
				</div>
				<div class="flex flex-col gap-2 shrink-0">
					<button
						onclick={syncSubscriptions}
						disabled={syncing}
						class="text-xs bg-violet-900/30 hover:bg-violet-900/50 disabled:opacity-50
						       text-violet-300 border border-violet-900/40 px-3 py-1.5 rounded-lg transition-colors"
						title="Re-souscrit aux events EventSub. Utile pour ajouter les events Phase 2+ sans se reconnecter."
					>
						{syncing ? 'Sync…' : 'Synchroniser'}
					</button>
					<button
						onclick={refreshTokens}
						disabled={refreshing}
						class="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50
						       text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
					>
						{refreshing ? 'Refresh…' : 'Refresh tokens'}
					</button>
					<button
						onclick={disconnect}
						disabled={disconnecting}
						class="text-xs bg-rose-900/30 hover:bg-rose-900/50 disabled:opacity-50
						       text-rose-300 border border-rose-900/40 px-3 py-1.5 rounded-lg transition-colors"
					>
						{disconnecting ? 'Déconnexion…' : 'Déconnecter'}
					</button>
				</div>
			</div>
		</section>

		<!-- Subscriptions -->
		<section class="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
			<header class="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
				<h2 class="text-sm font-semibold text-gray-200">
					EventSub subscriptions
					<span class="text-gray-500 font-normal ml-2">{enabledCount} actives / {subs.length}</span>
				</h2>
				{#if failedCount > 0}
					<span class="text-xs text-rose-300 bg-rose-900/30 border border-rose-900/40 px-2 py-0.5 rounded">
						{failedCount} en échec
					</span>
				{/if}
			</header>
			<ul class="divide-y divide-gray-800">
				{#each subs as sub}
					<li class="px-5 py-2.5 flex items-center justify-between gap-3">
						<div class="flex items-center gap-3 min-w-0">
							<span class="text-base shrink-0">
								{EVENT_LABELS[sub.eventType]?.icon ?? '•'}
							</span>
							<div class="min-w-0">
								<div class="text-sm text-gray-200 font-mono truncate">{sub.eventType}</div>
								<div class="text-[10px] text-gray-500 font-mono truncate">id={shortId(sub.externalSubId)}</div>
							</div>
						</div>
						<span class="text-[10px] font-medium uppercase px-2 py-0.5 rounded border {STATUS_STYLE[sub.status]}">
							{sub.status}
						</span>
					</li>
				{:else}
					<li class="px-5 py-8 text-center text-sm text-gray-500">
						Aucune subscription. Rafraîchis la page après le callback OAuth.
					</li>
				{/each}
			</ul>
		</section>

		<!-- Recent events -->
		<section class="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
			<header class="px-5 py-3 border-b border-gray-800">
				<h2 class="text-sm font-semibold text-gray-200">
					Événements récents
					<span class="text-gray-500 font-normal ml-2">{events.length} dans le feed</span>
				</h2>
				<p class="text-xs text-gray-500 mt-0.5">
					Phase 1 : on persiste les événements EventSub ici. Phase 2+ ajoutera un dispatch live
					vers le chat Nodyx.
				</p>
			</header>
			<ul class="divide-y divide-gray-800">
				{#each events as evt}
					<li class="px-5 py-2.5 flex items-center gap-3 text-sm">
						<span class="shrink-0">{EVENT_LABELS[evt.eventType]?.icon ?? '•'}</span>
						<span class="font-mono text-gray-300">{evt.eventType}</span>
						<span class="flex-1 text-gray-500 text-xs truncate">
							{JSON.stringify(evt.payload?.event ?? {}).slice(0, 80)}
						</span>
						<span class="shrink-0 text-xs text-gray-500">{fmtRelative(evt.occurredAt)}</span>
					</li>
				{:else}
					<li class="px-5 py-8 text-center text-sm text-gray-500">
						Aucun événement reçu pour l'instant. Lance un stream ou demande à un viewer de te follow
						pour voir le pipeline en action.
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if toast}
		<div class="fixed bottom-6 right-6 max-w-sm px-4 py-3 rounded-lg shadow-lg text-sm
		            {toast.ok ? 'bg-emerald-900/80 border border-emerald-700/60 text-emerald-100'
		                      : 'bg-rose-900/80 border border-rose-700/60 text-rose-100'}">
			{toast.text}
		</div>
	{/if}

</div>
