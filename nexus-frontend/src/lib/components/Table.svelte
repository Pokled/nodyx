<script lang="ts">
	import { voiceStore, setPeerVolume, inputLevel } from '$lib/voice'
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

	const vs = $derived($voiceStore)
	const jb = $derived($jukeboxStore)

	// ── Layout ─────────────────────────────────────────────────────────────────
	const S  = 960
	const C  = S / 2
	const RT = 256   // rayon table
	const RA = 320   // rayon avatars

	// ── Brasserie de Nuit ──────────────────────────────────────────────────────
	const T = {
		bg:          '#131210',
		tableBg:     '#1c1814',
		tableRim:    '#2d2520',
		accent:      '#c8914a',
		voiceRing:   '#c8914a',
		textPrimary: '#e8e0d5',
		textMuted:   '#9a8f82',
	}

	// ── Audio-réactif : inputLevel 0-100 → niveau lissé 0-1 ───────────────────
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

	// ── Jukebox init / cleanup ─────────────────────────────────────────────────
	$effect(() => {
		if (!joined || !socket) return
		initJukebox(socket, channelId, me.username)
		const id = ytContainerId
		// $effect runs after DOM update, safe to mount immediately
		mountYTPlayer(id).catch(() => {})
		return () => { cleanupJukebox(socket!) }
	})

	// ── Types ──────────────────────────────────────────────────────────────────
	interface Player {
		id:        string
		username:  string
		avatar:    string | null
		isMe:      boolean
		speaking:  boolean
		muted?:    boolean
		socketId?: string
	}
	interface Positioned extends Player { x: number; y: number }

	// ── Players — vides si pas encore rejoint ──────────────────────────────────
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

	function getPositions(list: Player[]): Positioned[] {
		if (list.length === 0) return []
		return list.map((p, i) => {
			const angle = (2 * Math.PI / list.length) * i + Math.PI / 2
			return { ...p, x: C + RA * Math.cos(angle), y: C + RA * Math.sin(angle) }
		})
	}
	const positioned = $derived(getPositions(players))

	// ── Sourdine locale ────────────────────────────────────────────────────────
	let mutedPeers = $state<Set<string>>(new Set())

	function toggleMutePeer(p: Positioned) {
		if (!p.socketId) return
		if (mutedPeers.has(p.socketId)) { mutedPeers.delete(p.socketId); setPeerVolume(p.socketId, 1) }
		else { mutedPeers.add(p.socketId); setPeerVolume(p.socketId, 0) }
		mutedPeers = new Set(mutedPeers)
		closeMenu()
	}

	// ── Menu contextuel ────────────────────────────────────────────────────────
	let menuPlayer = $state<Positioned | null>(null)

	function openMenu(p: Positioned, e: MouseEvent) {
		e.stopPropagation()
		menuPlayer = menuPlayer?.id === p.id ? null : p
	}
	function closeMenu() { menuPlayer = null }

	async function whisperPeer(p: Positioned) {
		closeMenu()
		if (!token) { goto('/auth/login'); return }
		const res = await fetch(`${PUBLIC_API_URL}/api/v1/whispers`, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ context_type: 'voice', context_id: channelId, context_label: p.username, name: `🤫 ${p.username}` }),
		})
		if (res.ok) { const { room } = await res.json(); goto(`/whisper/${room.id}`) }
	}

	// ── Jukebox UI ─────────────────────────────────────────────────────────────
	let showJukeboxInput = $state(false)
	let jukeboxUrl       = $state('')

	let jukeboxError     = $state('')

	const fid           = $derived(channelId.replace(/[^a-z0-9]/gi, ''))
	const ytContainerId = $derived(`yt-jukebox-${fid}`)

	function handleJukeboxLoad() {
		if (!jukeboxUrl.trim()) return
		jukeboxError = ''
		const ok = jukeboxLoad(jukeboxUrl.trim())
		if (ok) {
			showJukeboxInput = false
			jukeboxUrl = ''
		} else {
			jukeboxError = 'Lien YouTube invalide. Exemples : youtube.com/watch?v=... ou youtu.be/...'
		}
	}


</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="relative select-none mx-auto shrink-0"
	style="width:{S}px; height:{S}px; background: radial-gradient(ellipse 72% 72% at 50% 50%, #1f1b16 0%, {T.bg} 62%, #09080700 100%);"
	onclick={closeMenu}
>

	<!-- ── Table SVG ─────────────────────────────────────────────────────────── -->
	<svg width={S} height={S} class="absolute inset-0 pointer-events-none">
		<defs>
			<!-- Grain bois -->
			<filter id="grain{fid}" x="-20%" y="-20%" width="140%" height="140%">
				<feTurbulence type="fractalNoise" baseFrequency="0.65 0.12"
					numOctaves="4" seed="7" result="noise"/>
				<feColorMatrix type="saturate" values="0" in="noise" result="bw"/>
				<feComponentTransfer in="bw" result="tex">
					<feFuncA type="linear" slope="0.10"/>
				</feComponentTransfer>
				<feBlend in="SourceGraphic" in2="tex" mode="multiply"/>
			</filter>

			<!-- Surface bois -->
			<radialGradient id="surf{fid}" cx="44%" cy="38%" r="70%">
				<stop offset="0%"   stop-color={T.tableBg}/>
				<stop offset="100%" stop-color="#0f0d0a"/>
			</radialGradient>

			<!-- Rebord -->
			<radialGradient id="rim{fid}" cx="44%" cy="38%" r="70%">
				<stop offset="0%"   stop-color={T.tableRim}/>
				<stop offset="100%" stop-color="#1a1510"/>
			</radialGradient>

			<!-- Lueur ambrée — s'intensifie avec ma voix -->
			<radialGradient id="glow{fid}" cx="50%" cy="46%" r="58%">
				<stop offset="0%"   stop-color={T.accent} stop-opacity={0.06 + _myLevel * 0.20}/>
				<stop offset="70%"  stop-color={T.accent} stop-opacity={0.01 + _myLevel * 0.05}/>
				<stop offset="100%" stop-color={T.accent} stop-opacity="0"/>
			</radialGradient>

			<!-- Dégradé étiquette vinyle -->
			<radialGradient id="label{fid}" cx="35%" cy="30%" r="75%">
				<stop offset="0%"   stop-color="#d4a06a"/>
				<stop offset="100%" stop-color="#8b5e2e"/>
			</radialGradient>
		</defs>

		<!-- Ombre portée -->
		<circle cx={C} cy={C + 6} r={RT + 14} fill="rgba(0,0,0,0.55)"/>

		<!-- Rebord -->
		<circle cx={C} cy={C} r={RT + 9} fill="url(#rim{fid})"/>

		<!-- Surface bois -->
		<circle cx={C} cy={C} r={RT} fill="url(#surf{fid})" filter="url(#grain{fid})"/>

		<!-- Lueur ambiante — respire + réagit à la voix -->
		<circle class="table-glow" cx={C} cy={C} r={RT - 12} fill="url(#glow{fid})"/>

		<!-- Liseré intérieur décoratif -->
		<circle cx={C} cy={C} r={RT - 6} fill="none" stroke={T.accent} stroke-width="0.8" opacity="0.20"/>

		<!-- ── Zone Jukebox (centre de la table, visible quand joined) ────────── -->
		{#if joined}
			<g transform="translate({C}, {C})">

				{#if jb.track}
					<!-- ── Vinyle ───────────────────────────────────────────────── -->

					<!-- Ombre du vinyle -->
					<ellipse cx="0" cy="8" rx="82" ry="14" fill="rgba(0,0,0,0.45)"/>

					<!-- Corps du vinyle (rotatif) -->
					<g class="vinyl-disc {jb.playing ? '' : 'paused'}">
						<!-- Disque principal -->
						<circle r="80" fill="#0b0908"/>
						<!-- Sillons -->
						{#each [74, 67, 60, 53, 46, 39] as gr}
							<circle r={gr} fill="none" stroke="#181410" stroke-width="1.5"/>
						{/each}
						<!-- Étiquette centrale -->
						<circle r="26" fill="url(#label{fid})" opacity="0.92"/>
						<!-- Reflet sur étiquette -->
						<ellipse cx="-7" cy="-7" rx="7" ry="4.5" fill="white" opacity="0.13" transform="rotate(-35)"/>
						<!-- Trou de broche -->
						<circle r="3.5" fill="#0b0908"/>
					</g>

					<!-- Titre de la piste (hors rotation) -->
					<text
						y="106"
						text-anchor="middle"
						font-size="10.5"
						font-family="ui-sans-serif, system-ui, sans-serif"
						fill={T.textMuted}
						opacity="0.75"
					>
						{jb.track.title.length > 40 ? jb.track.title.slice(0, 40) + '…' : jb.track.title}
					</text>

				{:else}
					<!-- ── Pas de piste — icône Jukebox discrète ────────────────── -->
					<circle r="50" fill="rgba(200,145,74,0.04)" stroke={T.accent} stroke-width="0.7" stroke-dasharray="3 4" opacity="0.22"/>
					<text y="8"  text-anchor="middle" font-size="28" opacity="0.18" fill={T.accent}>♫</text>
					<text y="26" text-anchor="middle" font-size="9" font-family="ui-sans-serif, system-ui, sans-serif" fill={T.textMuted} opacity="0.30">Jukebox</text>
				{/if}

			</g>
		{/if}

	</svg>

	<!-- ── Bouton transparent "Rejoindre le Jukebox" (clickable sur l'icône) ── -->
	<!-- Séparé du SVG pour garder pointer-events:none sur tout le SVG -->
	{#if joined && !jb.track}
		<button
			class="absolute rounded-full focus:outline-none"
			style="left:{C - 50}px; top:{C - 50}px; width:100px; height:100px; background:transparent; cursor:pointer; z-index:5;"
			onclick={(e) => { e.stopPropagation(); showJukeboxInput = true }}
			title="Ouvrir le Jukebox"
		/>
	{/if}

	<!-- ── Player "stop" overlay (clic sur le vinyle) ────────────────────────── -->
	{#if joined && jb.track}
		<button
			class="absolute rounded-full focus:outline-none"
			style="left:{C - 80}px; top:{C - 80}px; width:160px; height:160px; background:transparent; cursor:pointer; z-index:5;"
			onclick={(e) => { e.stopPropagation(); showJukeboxInput = true }}
			title="Changer la piste"
		/>
	{/if}

	<!-- ── Lecteur YouTube caché (audio uniquement) ──────────────────────────── -->
	<!-- Container fixed 0×0 avec overflow:hidden — le player YouTube interne (200×113)
	     existe dans le DOM avec des dimensions légitimes mais n'est pas visible.
	     Évite l'artefact visuel et les restrictions autoplay Chrome sur les mini-iframes. -->
	{#if joined}
		<div style="position:fixed; bottom:0; right:0; width:0; height:0; overflow:hidden; pointer-events:none; z-index:-1;">
			<div id={ytContainerId}></div>
		</div>
	{/if}

	<!-- ── Bouton "Rejoindre" — affiché avant de rejoindre ───────────────────── -->
	{#if !joined}
		<!-- svelte-ignore a11y_consider_explicit_label -->
		<div class="absolute inset-0 flex items-center justify-center z-20">
			<button
				onclick={onjoin}
				class="group relative flex items-center justify-center focus:outline-none"
				style="width:168px; height:168px;"
			>
				<!-- Halo externe pulsant -->
				<div class="absolute inset-0 rounded-full join-halo"
				     style="background: radial-gradient(circle, {T.accent}55 0%, transparent 70%); filter:blur(20px);"></div>

				<!-- Cercle principal -->
				<div class="relative w-40 h-40 rounded-full flex flex-col items-center justify-center gap-3
				            group-hover:scale-105 transition-transform duration-300"
				     style="background: rgba(26,21,16,0.95);
				            border: 1.5px solid {T.accent}60;
				            box-shadow: 0 0 40px rgba(200,145,74,0.10), inset 0 1px 0 rgba(255,255,255,0.04);">
					<span class="text-4xl">🎙️</span>
					<span class="text-[11px] font-semibold tracking-[0.18em] uppercase"
					      style="color:{T.accent};">Rejoindre</span>
				</div>
			</button>
		</div>
	{/if}

	<!-- ── Avatars ───────────────────────────────────────────────────────────── -->
	{#each positioned as p (p.id)}
		{@const isMutedLocal = !p.isMe && !!p.socketId && mutedPeers.has(p.socketId)}
		{@const peerRing     = p.speaking ? T.voiceRing
		                     : (p.isMe && p.muted) || isMutedLocal ? '#374151'
		                     : T.accent + '55'}
		<!-- Anneau audio-réactif pour moi, statique pour les peers -->
		{@const myGlow   = (2.5 + _myLevel * 3.5).toFixed(1)}
		{@const myAlpha1 = (0.25 + _myLevel * 0.75).toFixed(2)}
		{@const myAlpha2 = (_myLevel * 0.55).toFixed(2)}
		{@const myOuter  = (_myLevel * 34).toFixed(0)}
		{@const boxShadow = p.isMe
			? (vs.muted
				? '0 0 0 2.5px #374151'
				: `0 0 0 ${myGlow}px rgba(200,145,74,${myAlpha1}), 0 0 ${myOuter}px rgba(200,145,74,${myAlpha2})`)
			: `0 0 0 2.5px ${peerRing}, 0 0 ${p.speaking ? 18 : 0}px ${T.voiceRing}70`}

		<button
			class="absolute flex flex-col items-center gap-1.5 focus:outline-none"
			style="left:{p.x - 40}px; top:{p.y - 40}px; cursor:{p.isMe ? 'default' : 'pointer'};"
			onclick={(e) => { if (!p.isMe) openMenu(p, e) }}
			title={p.isMe ? 'Vous' : p.username}
		>
			<div class="relative w-20 h-20">

				<!-- Ondes concentriques (peers qui parlent) -->
				{#if p.speaking && !p.isMe}
					<div class="speak-ring absolute inset-0 rounded-full"
					     style="border:2px solid {T.voiceRing}55; animation-delay:0s;"></div>
					<div class="speak-ring absolute inset-0 rounded-full"
					     style="border:2px solid {T.voiceRing}38; animation-delay:0.53s;"></div>
					<div class="speak-ring absolute inset-0 rounded-full"
					     style="border:2px solid {T.voiceRing}22; animation-delay:1.06s;"></div>
				{/if}

				<!-- Avatar — "posé sur la table" -->
				<div class="relative z-10 w-20 h-20"
				     style="filter:drop-shadow(0 6px 14px rgba(0,0,0,0.85));">
					{#if p.avatar}
						<img
							src={p.avatar} alt={p.username}
							class="w-20 h-20 rounded-full object-cover"
							style="box-shadow:{boxShadow}; transition: box-shadow 80ms linear;"
						/>
					{:else}
						<div
							class="w-20 h-20 rounded-full flex items-center justify-center text-xl font-bold text-white"
							style="background:{T.accent}; box-shadow:{boxShadow}; transition: box-shadow 80ms linear;"
						>
							{p.username.charAt(0).toUpperCase()}
						</div>
					{/if}
				</div>

				<!-- Badges statut -->
				{#if p.isMe && vs.muted}
					<span class="absolute -bottom-1 -right-1 z-20 w-6 h-6 rounded-full flex items-center justify-center text-xs"
					      style="background:{T.bg}; border:1px solid {T.accent}30;">🔇</span>
				{:else if isMutedLocal}
					<span class="absolute -bottom-1 -right-1 z-20 w-6 h-6 rounded-full flex items-center justify-center text-xs"
					      style="background:{T.bg}; border:1px solid {T.accent}30;">🔕</span>
				{/if}

			</div>

			<!-- Nom — s'illumine quand on parle -->
			<span
				class="text-[11px] truncate max-w-[90px] leading-none px-2.5 py-1 rounded-full transition-all duration-300"
				style="background:rgba(0,0,0,0.5);
				       color:{p.speaking ? T.textPrimary : T.textMuted};
				       {p.speaking ? `text-shadow:0 0 12px ${T.accent}80; box-shadow:0 0 12px ${T.accent}28;` : ''}"
			>
				{p.isMe ? 'Vous' : p.username}
			</span>
		</button>
	{/each}

	<!-- ── Panel URL Jukebox ──────────────────────────────────────────────────── -->
	{#if showJukeboxInput}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="absolute inset-0 z-50 flex items-center justify-center"
			style="background: rgba(13,11,8,0.7); backdrop-filter:blur(4px);"
			onclick={() => { showJukeboxInput = false; jukeboxError = '' }}
		>
			<!-- Panel -->
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				class="rounded-2xl p-7 w-[440px]"
				style="background: rgba(20,17,13,0.98);
				       border: 1px solid {T.accent}28;
				       box-shadow: 0 24px 60px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(255,255,255,0.05);"
				onclick={(e) => e.stopPropagation()}
			>
				<!-- Header -->
				<div class="flex items-center gap-3 mb-5">
					<div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
					     style="background: rgba(200,145,74,0.12); border:1px solid {T.accent}30;">
						♫
					</div>
					<div>
						<h3 class="text-sm font-semibold" style="color:{T.textPrimary};">Jukebox</h3>
						<p class="text-[10px]" style="color:{T.textMuted};">Colle un lien YouTube pour tous</p>
					</div>
					<button
						class="ml-auto w-7 h-7 rounded-full flex items-center justify-center text-xs hover:bg-white/10 transition-colors focus:outline-none"
						style="color:{T.textMuted};"
						onclick={() => { showJukeboxInput = false; jukeboxError = '' }}
					>
						✕
					</button>
				</div>

				<!-- Input -->
				<input
					type="url"
					bind:value={jukeboxUrl}
					placeholder="https://www.youtube.com/watch?v=..."
					class="w-full rounded-xl px-4 py-3 text-sm focus:outline-none mb-3"
					style="background: rgba(255,255,255,0.04);
					       border: 1px solid {T.accent}25;
					       color: {T.textPrimary};
					       caret-color: {T.accent};"
					onkeydown={(e) => { if (e.key === 'Enter') handleJukeboxLoad() }}
				/>

				{#if jukeboxError}
					<p class="text-[10px] mb-3 px-1" style="color:#f87171;">{jukeboxError}</p>
				{/if}

				<!-- Bouton -->
				<button
					class="w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 focus:outline-none"
					style="background:{T.accent}; color:#0d0b08; box-shadow:0 0 20px {T.accent}30;"
					onclick={handleJukeboxLoad}
				>
					▶  Lancer pour tous
				</button>

				<!-- Exemples -->
				<p class="text-[10px] mt-4 leading-relaxed text-center" style="color:{T.textMuted}; opacity:0.55;">
					Fonctionne avec youtube.com/watch, youtu.be et /shorts
				</p>
			</div>
		</div>
	{/if}

	<!-- ── Menu contextuel ───────────────────────────────────────────────────── -->
	{#if menuPlayer}
		{@const mp      = menuPlayer}
		{@const isMuted = !!mp.socketId && mutedPeers.has(mp.socketId)}
		{@const ml      = Math.min(mp.x + 44, S - 190)}
		{@const mt      = Math.max(mp.y - 88, 4)}

		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="absolute z-50 rounded-xl backdrop-blur-sm py-1.5 min-w-[168px]"
			style="left:{ml}px; top:{mt}px;
			       background:rgba(20,17,13,0.97);
			       border:1px solid {T.accent}22;
			       box-shadow:0 20px 40px rgba(0,0,0,0.7);"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="px-3 py-1.5 mb-1" style="border-bottom:1px solid {T.accent}18;">
				<p class="text-xs font-semibold truncate" style="color:{T.textPrimary};">{mp.username}</p>
			</div>

			<button onclick={() => goto(`/users/${mp.username}`)}
				class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
				style="color:{T.textMuted};">
				<span>👤</span> Voir le profil
			</button>

			<button onclick={() => whisperPeer(mp)}
				class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
				style="color:{T.textMuted};">
				<span>🤫</span> Chuchoter
			</button>

			<div class="mt-1 pt-1" style="border-top:1px solid {T.accent}18;">
				<button onclick={() => toggleMutePeer(mp)}
					class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
					style="color:{isMuted ? T.accent : T.textMuted};">
					<span>{isMuted ? '🔔' : '🔕'}</span>
					{isMuted ? 'Réactiver' : 'Sourdine locale'}
				</button>
			</div>
		</div>
	{/if}

</div>

<style>
	/* ── Vinyle rotatif ─────────────────────────────────────────────────────── */
	@keyframes vinyl-spin {
		from { transform: rotate(0deg); }
		to   { transform: rotate(360deg); }
	}
	.vinyl-disc {
		animation: vinyl-spin 3.5s linear infinite;
		transform-origin: 0 0;
	}
	.vinyl-disc.paused {
		animation-play-state: paused;
	}

	/* ── Ondes concentriques — peers qui parlent ───────────────────────────── */
	@keyframes ring-spread {
		0%   { transform: scale(1);   opacity: 0.55; }
		100% { transform: scale(2.7); opacity: 0;    }
	}
	.speak-ring {
		animation: ring-spread 1.6s ease-out infinite;
	}

	/* ── Respiration ambiante de la table ──────────────────────────────────── */
	@keyframes glow-breathe {
		0%, 100% { opacity: 0.7; }
		50%       { opacity: 1.0; }
	}
	.table-glow {
		animation: glow-breathe 5s ease-in-out infinite;
	}

	/* ── Halo du bouton "Rejoindre" ────────────────────────────────────────── */
	@keyframes halo-pulse {
		0%, 100% { opacity: 0.18; transform: scale(1);    }
		50%       { opacity: 0.38; transform: scale(1.08); }
	}
	.join-halo {
		animation: halo-pulse 2.8s ease-in-out infinite;
	}
</style>
