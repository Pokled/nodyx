<script lang="ts">
	import { voiceStore, setPeerVolume, inputLevel, peerStatsStore, getQuality } from '$lib/voice'
	import { jukeboxStore, initJukebox, cleanupJukebox, mountYTPlayer, jukeboxLoad } from '$lib/jukebox'
	import { goto } from '$app/navigation'
	import { PUBLIC_API_URL } from '$env/static/public'
	import type { Socket } from 'socket.io-client'

	interface Props {
		channelName: string
		channelId:   string
		me:          { username: string; avatar: string | null }
		token:       string | null
		joined:      boolean
		onjoin:      () => void
		socket:      Socket | null
	}

	let { channelName, channelId, me, token, joined, onjoin, socket }: Props = $props()

	const vs       = $derived($voiceStore)
	const jb       = $derived($jukeboxStore)
	const statsMap = $derived($peerStatsStore)

	type NetQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'
	const QUALITY_COLOR: Record<NetQuality, string> = {
		excellent: '#4ade80',
		good:      '#86efac',
		fair:      '#facc15',
		poor:      '#f87171',
		unknown:   '#374151',
	}
	const QUALITY_BARS: Record<NetQuality, number> = {
		excellent: 3, good: 3, fair: 2, poor: 1, unknown: 0,
	}

	// ── Audio-réactif : inputLevel 0-100 → niveau lissé 0-1 ──────────────────
	let _targetLevel = 0
	let _myLevel     = $state(0)

	$effect(() => {
		const unsub = inputLevel.subscribe(v => { _targetLevel = v / 100 })
		let raf: number
		const tick = () => {
			_myLevel += (_targetLevel - _myLevel) * 0.18
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => { unsub(); cancelAnimationFrame(raf) }
	})

	// ── Jukebox init / cleanup ────────────────────────────────────────────────
	$effect(() => {
		if (!joined || !socket) return
		initJukebox(socket, channelId, me.username)
		const id = ytContainerId
		mountYTPlayer(id).catch(() => {})
		return () => { cleanupJukebox(socket!) }
	})

	// ── Types ─────────────────────────────────────────────────────────────────
	interface Player {
		id:        string
		username:  string
		avatar:    string | null
		isMe:      boolean
		speaking:  boolean
		muted?:    boolean
		socketId?: string
	}

	// ── Players ───────────────────────────────────────────────────────────────
	const players = $derived<Player[]>(
		!joined ? [] : [
			{ id: 'me', username: me.username, avatar: me.avatar, isMe: true, speaking: vs.mySpeaking, muted: vs.muted },
			...vs.peers.map(p => ({
				id:       p.socketId,
				username: p.username,
				avatar:   p.avatar,
				isMe:     false,
				speaking: p.speaking,
				socketId: p.socketId,
			})),
		]
	)

	// ── Grid cols ─────────────────────────────────────────────────────────────
	const gridCols = $derived(
		players.length <= 1 ? 1 :
		players.length <= 4 ? 2 :
		players.length <= 9 ? 3 : 4
	)
	const gridMax = $derived(
		gridCols === 1 ? '280px' :
		gridCols === 2 ? '560px' :
		gridCols === 3 ? '720px' : '940px'
	)

	// ── Local mute ────────────────────────────────────────────────────────────
	let mutedPeers = $state<Set<string>>(new Set())

	function toggleMutePeer(p: Player) {
		if (!p.socketId) return
		if (mutedPeers.has(p.socketId)) { mutedPeers.delete(p.socketId); setPeerVolume(p.socketId, 1) }
		else { mutedPeers.add(p.socketId); setPeerVolume(p.socketId, 0) }
		mutedPeers = new Set(mutedPeers)
		closeMenu()
	}

	// ── Context menu ──────────────────────────────────────────────────────────
	let menuPlayer = $state<Player | null>(null)
	let menuX = $state(0)
	let menuY = $state(0)

	function openMenu(p: Player, e: MouseEvent) {
		e.stopPropagation()
		if (menuPlayer?.id === p.id) { closeMenu(); return }
		menuPlayer = p
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
		menuX = Math.min(rect.right + 8, window.innerWidth - 200)
		menuY = Math.min(rect.top, window.innerHeight - 160)
	}
	function closeMenu() { menuPlayer = null }

	async function whisperPeer(p: Player) {
		closeMenu()
		if (!token) { goto('/auth/login'); return }
		const res = await fetch(`${PUBLIC_API_URL}/api/v1/whispers`, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ context_type: 'voice', context_id: channelId, context_label: p.username, name: `🤫 ${p.username}` }),
		})
		if (res.ok) { const { room } = await res.json(); goto(`/whisper/${room.id}`) }
	}

	// ── Jukebox URL input ─────────────────────────────────────────────────────
	let showJukeboxInput = $state(false)
	let jukeboxUrl       = $state('')
	let jukeboxError     = $state('')

	const fid           = $derived(channelId.replace(/[^a-z0-9]/gi, ''))
	const ytContainerId = $derived(`yt-jukebox-${fid}`)

	function handleJukeboxLoad() {
		if (!jukeboxUrl.trim()) return
		jukeboxError = ''
		const ok = jukeboxLoad(jukeboxUrl.trim())
		if (ok) { showJukeboxInput = false; jukeboxUrl = '' }
		else { jukeboxError = 'Lien YouTube invalide. Exemples : youtube.com/watch?v=... ou youtu.be/...' }
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="relative w-full h-full flex flex-col overflow-hidden select-none"
	style="background: #07070f;"
	onclick={closeMenu}
>

	<!-- ── Ambient background ──────────────────────────────────────────────── -->
	<div class="absolute inset-0 pointer-events-none overflow-hidden">
		<!-- Static orbs -->
		<div class="absolute -top-64 -left-64 w-[700px] h-[700px]"
		     style="background: radial-gradient(circle, rgba(124,58,237,0.05) 0%, transparent 65%); filter: blur(80px);"></div>
		<div class="absolute -bottom-64 -right-64 w-[700px] h-[700px]"
		     style="background: radial-gradient(circle, rgba(6,182,212,0.04) 0%, transparent 65%); filter: blur(80px);"></div>
		<!-- Audio-reactive center glow -->
		<div class="absolute inset-0 flex items-center justify-center"
		     style="opacity: {(0.3 + _myLevel * 0.7).toFixed(2)}; transition: opacity 80ms linear;">
			<div class="w-[600px] h-[600px]"
			     style="background: radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 55%); filter: blur(100px);"></div>
		</div>
	</div>

	{#if !joined}

		<!-- ── Join screen ──────────────────────────────────────────────────── -->
		<div class="flex-1 flex flex-col items-center justify-center gap-10 p-8 relative z-10">

			<div class="text-center space-y-1.5">
				<p class="text-[10px] font-black uppercase tracking-[0.25em] text-gray-700">Canal vocal</p>
				<h2 class="text-3xl font-black text-white tracking-tight">{channelName}</h2>
			</div>

			<!-- Join button with pulsing halos -->
			<button
				onclick={onjoin}
				class="group relative flex items-center justify-center focus:outline-none"
				style="width: 176px; height: 176px;"
			>
				<!-- Halo rings -->
				<div class="absolute inset-0 rounded-full join-ring"></div>
				<div class="absolute inset-0 rounded-full join-ring" style="animation-delay: 0.8s;"></div>
				<div class="absolute inset-[10px] rounded-full join-ring" style="animation-delay: 0.4s; border-color: rgba(6,182,212,0.3);"></div>

				<!-- Button disk -->
				<div class="relative w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2.5
				            group-hover:scale-105 transition-all duration-300"
				     style="background: linear-gradient(145deg, rgba(124,58,237,0.25) 0%, rgba(6,182,212,0.12) 100%);
				            border: 1px solid rgba(124,58,237,0.45);
				            box-shadow: 0 0 60px rgba(124,58,237,0.18), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06);">
					<svg class="w-10 h-10" fill="none" stroke="white" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:0.9;">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/>
					</svg>
					<span class="text-[11px] font-black uppercase tracking-[0.18em] text-white/75">Rejoindre</span>
				</div>
			</button>

			<p class="text-xs text-gray-700">Microphone requis pour participer</p>
		</div>

	{:else}

		<!-- ── Players stage grid ──────────────────────────────────────────── -->
		<div class="flex-1 flex items-center justify-center p-6 relative z-10 overflow-auto">
			<div
				class="grid gap-3 w-full"
				style="grid-template-columns: repeat({gridCols}, minmax(0, 1fr)); max-width: {gridMax};"
			>
				{#each players as p (p.id)}
					{@const isMutedLocal  = !p.isMe && !!p.socketId && mutedPeers.has(p.socketId)}
					{@const isSpeaking    = p.speaking && !((p.isMe && vs.muted) || isMutedLocal)}
					{@const myActive      = p.isMe && !vs.muted && _myLevel > 0.04}
					{@const pStats        = !p.isMe && p.socketId ? statsMap.get(p.socketId) : undefined}
					{@const quality       = getQuality(pStats) as NetQuality}
					{@const qColor        = QUALITY_COLOR[quality]}
					{@const qBars         = QUALITY_BARS[quality]}
					{@const glowLevel     = p.isMe ? _myLevel : (isSpeaking ? 0.6 : 0)}
					{@const borderOpacity = isSpeaking ? (0.35 + glowLevel * 0.3).toFixed(2) : myActive ? (0.12 + _myLevel * 0.5).toFixed(2) : '0.05'}
					{@const shadowSize    = isSpeaking ? (16 + glowLevel * 20).toFixed(0) : myActive ? (8 + _myLevel * 24).toFixed(0) : '0'}
					{@const shadowAlpha   = isSpeaking ? (0.12 + glowLevel * 0.12).toFixed(2) : myActive ? (0.06 + _myLevel * 0.18).toFixed(2) : '0'}
					{@const ringSize      = myActive ? (1.5 + _myLevel * 2.5).toFixed(1) : isSpeaking ? '2.5' : '1.5'}
					{@const ringAlpha     = myActive ? (0.35 + _myLevel * 0.55).toFixed(2) : isSpeaking ? '0.7' : '0.08'}

					<!-- svelte-ignore a11y_interactive_supports_focus -->
					<div
						role={p.isMe ? undefined : 'button'}
						class="relative flex flex-col items-center gap-4 py-7 px-4 transition-all duration-150"
						style="
							background: {isSpeaking || myActive ? 'rgba(124,58,237,0.07)' : 'rgba(13,13,20,0.9)'};
							border: 1px solid rgba(124,58,237,{borderOpacity});
							box-shadow: 0 0 {shadowSize}px rgba(124,58,237,{shadowAlpha}), 0 2px 12px rgba(0,0,0,0.5);
							cursor: {p.isMe ? 'default' : 'pointer'};
						"
						onclick={(e) => { if (!p.isMe) openMenu(p, e) }}
					>

						<!-- Avatar + rings -->
						<div class="relative flex items-center justify-center">
							<!-- Outer speak ring (peers) -->
							{#if isSpeaking && !p.isMe}
								<div class="absolute rounded-full speak-ring"
								     style="inset: -8px; border: 1.5px solid rgba(124,58,237,0.35);"></div>
								<div class="absolute rounded-full speak-ring"
								     style="inset: -14px; border: 1px solid rgba(124,58,237,0.18); animation-delay: 0.55s;"></div>
							{/if}

							{#if p.avatar}
								<img
									src={p.avatar} alt={p.username}
									class="w-[72px] h-[72px] rounded-full object-cover relative z-10"
									style="
										box-shadow: 0 0 0 {ringSize}px rgba(124,58,237,{ringAlpha}), 0 4px 20px rgba(0,0,0,0.7);
										transition: box-shadow 60ms linear;
									"
								/>
							{:else}
								<div
									class="w-[72px] h-[72px] rounded-full flex items-center justify-center text-2xl font-black text-white relative z-10"
									style="
										background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%);
										box-shadow: 0 0 0 {ringSize}px rgba(124,58,237,{ringAlpha}), 0 4px 20px rgba(0,0,0,0.7);
										transition: box-shadow 60ms linear;
									"
								>
									{p.username.charAt(0).toUpperCase()}
								</div>
							{/if}

							<!-- Mute badge -->
							{#if (p.isMe && vs.muted) || isMutedLocal}
								<div class="absolute -bottom-1 -right-1 z-20 w-5 h-5 rounded-full flex items-center justify-center"
								     style="background: #0d0d12; border: 1px solid rgba(239,68,68,0.5);">
									<svg class="w-2.5 h-2.5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clip-rule="evenodd"/>
									</svg>
								</div>
							{/if}
						</div>

						<!-- Quality indicator (peers only, top-right corner) -->
					{#if !p.isMe && pStats}
						<div class="absolute top-2.5 right-2.5 flex items-end gap-[2px]" title="Qualité réseau : {quality}">
							{#each [1,2,3] as bar}
								<div class="w-[3px] rounded-sm transition-colors duration-500"
								     style="height: {4 + bar * 3}px; background: {bar <= qBars ? qColor : 'rgba(255,255,255,0.1)'};">
								</div>
							{/each}
						</div>
					{/if}

					<!-- Name + EQ bars -->
						<div class="flex flex-col items-center gap-1.5">
							<span
								class="text-xs font-semibold tracking-wide truncate max-w-[120px] transition-colors duration-200"
								style="color: {isSpeaking || myActive ? '#c4b5fd' : '#6b7280'};"
							>
								{p.isMe ? 'Vous' : p.username}
							</span>

							<!-- EQ bars when active -->
							<div class="flex items-end gap-[2px] h-3 transition-opacity duration-200"
							     style="opacity: {isSpeaking || myActive ? 1 : 0};">
								<div class="w-[3px] rounded-sm eq-bar" style="background: #7c3aed; animation-delay: 0.00s;"></div>
								<div class="w-[3px] rounded-sm eq-bar" style="background: #8b5cf6; animation-delay: 0.18s;"></div>
								<div class="w-[3px] rounded-sm eq-bar" style="background: #a78bfa; animation-delay: 0.08s;"></div>
								<div class="w-[3px] rounded-sm eq-bar" style="background: #8b5cf6; animation-delay: 0.25s;"></div>
								<div class="w-[3px] rounded-sm eq-bar" style="background: #7c3aed; animation-delay: 0.13s;"></div>
							</div>
						</div>

					</div>
				{/each}
			</div>
		</div>

		<!-- ── Jukebox bar ─────────────────────────────────────────────────── -->
		{#if jb.track}
			<div class="shrink-0 flex items-center gap-3 px-5 py-2.5 relative z-10"
			     style="background: rgba(7,7,15,0.95); border-top: 1px solid rgba(255,255,255,0.04);">
				<!-- Mini vinyl disc -->
				<div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center vinyl-mini {jb.playing ? '' : 'paused'}"
				     style="background: radial-gradient(circle, #1c1814 0%, #0b0908 100%);
				            border: 1px solid rgba(200,145,74,0.3);
				            box-shadow: 0 0 10px rgba(200,145,74,0.12);">
					<div class="w-2 h-2 rounded-full" style="background: rgba(200,145,74,0.55);"></div>
				</div>
				<div class="flex-1 min-w-0">
					<p class="text-xs font-semibold text-gray-300 truncate">{jb.track.title}</p>
					<p class="text-[10px] text-gray-600">{jb.playing ? 'Jukebox · En lecture' : 'Jukebox · En pause'}</p>
				</div>
				<button
					class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors focus:outline-none"
					style="color: rgba(200,145,74,0.55); border: 1px solid rgba(200,145,74,0.15);"
					onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(200,145,74,0.9)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,145,74,0.4)' }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(200,145,74,0.55)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,145,74,0.15)' }}
					onclick={(e) => { e.stopPropagation(); showJukeboxInput = true }}
				>
					Changer
				</button>
			</div>
		{:else if joined}
			<div class="shrink-0 flex items-center justify-center px-5 py-2 relative z-10"
			     style="border-top: 1px solid rgba(255,255,255,0.03);">
				<button
					class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors focus:outline-none jukebox-idle"
					style="color: rgba(200,145,74,0.28);"
					onclick={(e) => { e.stopPropagation(); showJukeboxInput = true }}
				>
					<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
					</svg>
					Lancer le Jukebox
				</button>
			</div>
		{/if}

	{/if}

	<!-- ── YouTube hidden player ─────────────────────────────────────────────── -->
	{#if joined}
		<div style="position:fixed; bottom:0; right:0; width:0; height:0; overflow:hidden; pointer-events:none; z-index:-1;">
			<div id={ytContainerId}></div>
		</div>
	{/if}

	<!-- ── Jukebox URL overlay ───────────────────────────────────────────────── -->
	{#if showJukeboxInput}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="absolute inset-0 z-50 flex items-center justify-center"
			style="background: rgba(7,7,15,0.8); backdrop-filter: blur(12px);"
			onclick={() => { showJukeboxInput = false; jukeboxError = '' }}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				class="w-[440px] p-7"
				style="background: rgba(13,13,20,0.98);
				       border: 1px solid rgba(255,255,255,0.07);
				       box-shadow: 0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.03);"
				onclick={(e) => e.stopPropagation()}
			>
				<div class="flex items-center gap-3 mb-6">
					<div class="w-9 h-9 flex items-center justify-center shrink-0"
					     style="background: rgba(200,145,74,0.1); border: 1px solid rgba(200,145,74,0.25);">
						<svg class="w-4 h-4" fill="none" stroke="rgba(200,145,74,0.9)" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
						</svg>
					</div>
					<div>
						<h3 class="text-sm font-bold text-gray-100">Jukebox</h3>
						<p class="text-[11px] text-gray-600">Diffuse un lien YouTube pour tout le canal</p>
					</div>
					<button
						class="ml-auto w-7 h-7 flex items-center justify-center text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors focus:outline-none"
						onclick={() => { showJukeboxInput = false; jukeboxError = '' }}
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
						</svg>
					</button>
				</div>

				<input
					type="url"
					bind:value={jukeboxUrl}
					placeholder="https://www.youtube.com/watch?v=..."
					class="w-full px-4 py-3 text-sm text-gray-200 focus:outline-none mb-3"
					style="background: rgba(255,255,255,0.04);
					       border: 1px solid rgba(255,255,255,0.08);
					       caret-color: #7c3aed;"
					onkeydown={(e) => { if (e.key === 'Enter') handleJukeboxLoad() }}
				/>

				{#if jukeboxError}
					<p class="text-[11px] mb-3 text-red-400">{jukeboxError}</p>
				{/if}

				<button
					class="w-full py-2.5 text-sm font-bold transition-all duration-200 focus:outline-none"
					style="background: rgba(200,145,74,0.9); color: #07070f; box-shadow: 0 0 24px rgba(200,145,74,0.25);"
					onclick={handleJukeboxLoad}
				>
					Lancer pour tous
				</button>

				<p class="text-[10px] mt-4 text-center text-gray-700">
					Compatible youtube.com/watch, youtu.be et /shorts
				</p>
			</div>
		</div>
	{/if}

	<!-- ── Context menu (fixed) ──────────────────────────────────────────────── -->
	{#if menuPlayer}
		{@const mp      = menuPlayer}
		{@const isMuted = !!mp.socketId && mutedPeers.has(mp.socketId)}

		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed z-[9999] py-1.5 min-w-[172px]"
			style="left: {menuX}px; top: {menuY}px;
			       background: rgba(13,13,20,0.98);
			       border: 1px solid rgba(255,255,255,0.07);
			       box-shadow: 0 20px 50px rgba(0,0,0,0.8);"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="px-3 py-2 mb-0.5" style="border-bottom: 1px solid rgba(255,255,255,0.05);">
				<p class="text-xs font-bold text-gray-200 truncate">{mp.username}</p>
			</div>

			<button onclick={() => goto(`/users/${mp.username}`)}
				class="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-white/[.04] transition-colors text-gray-500 hover:text-gray-200">
				<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
				</svg>
				Voir le profil
			</button>

			<button onclick={() => whisperPeer(mp)}
				class="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-white/[.04] transition-colors text-gray-500 hover:text-gray-200">
				<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/>
				</svg>
				Chuchoter
			</button>

			<div class="mt-0.5 pt-0.5" style="border-top: 1px solid rgba(255,255,255,0.05);">
				<button onclick={() => toggleMutePeer(mp)}
					class="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-white/[.04] transition-colors"
					style="color: {isMuted ? '#a78bfa' : '#6b7280'};">
					{#if isMuted}
						<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"/>
						</svg>
						Réactiver
					{:else}
						<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"/>
						</svg>
						Sourdine locale
					{/if}
				</button>
			</div>
		</div>
	{/if}

</div>

<style>
	/* ── Halo bouton rejoindre ───────────────────────────────────────────── */
	@keyframes join-ring-pulse {
		0%   { transform: scale(1);   opacity: 0.5; }
		100% { transform: scale(1.7); opacity: 0;   }
	}
	.join-ring {
		border: 1px solid rgba(124, 58, 237, 0.35);
		animation: join-ring-pulse 2.2s ease-out infinite;
	}

	/* ── Ondes concentriques — peers qui parlent ─────────────────────────── */
	@keyframes speak-ring {
		0%   { transform: scale(1);   opacity: 0.6; }
		100% { transform: scale(2.2); opacity: 0;   }
	}
	.speak-ring {
		animation: speak-ring 1.6s ease-out infinite;
	}

	/* ── Barres égaliseur ────────────────────────────────────────────────── */
	@keyframes eq-dance {
		0%, 100% { height: 25%; }
		50%       { height: 100%; }
	}
	.eq-bar {
		height: 100%;
		animation: eq-dance 0.75s ease-in-out infinite;
	}

	/* ── Mini vinyle Jukebox ─────────────────────────────────────────────── */
	@keyframes vinyl-spin {
		from { transform: rotate(0deg); }
		to   { transform: rotate(360deg); }
	}
	.vinyl-mini {
		animation: vinyl-spin 2.8s linear infinite;
	}
	.vinyl-mini.paused {
		animation-play-state: paused;
	}

	/* ── Hover Jukebox idle ──────────────────────────────────────────────── */
	.jukebox-idle:hover {
		color: rgba(200, 145, 74, 0.75) !important;
	}
</style>
