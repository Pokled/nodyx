<script lang="ts">
	import {
		jukeboxStore, jukeboxVolume, jukeboxMuted, jukeboxAutoplayBlocked,
		jukeboxPlay, jukeboxPause, jukeboxSeek, jukeboxClear,
		jukeboxSkipNext, jukeboxSkipPrev,
		jukeboxToggleRepeat, jukeboxToggleShuffle,
		jukeboxLoad, jukeboxAddToQueue, jukeboxVote, jukeboxRemoveFromQueue,
		jukeboxSetVolume, jukeboxToggleMute, jukeboxUnblock,
		jukeboxReplayFromHistory,
		parseYouTubeUrl, fmtTime,
	} from '$lib/jukebox'

	interface Props {
		joined:  boolean
		me:      { username: string }
	}

	let { joined, me }: Props = $props()

	const jb             = $derived($jukeboxStore)
	const vol            = $derived($jukeboxVolume)
	const muted          = $derived($jukeboxMuted)
	const autoplayBlocked = $derived($jukeboxAutoplayBlocked)

	// ── Theme ──────────────────────────────────────────────────────────────────
	const accent      = '#c8914a'
	const textPrimary = '#e8e0d5'
	const textMuted   = '#9a8f82'

	// ── Progress ───────────────────────────────────────────────────────────────
	const progress = $derived(jb.duration > 0 ? Math.min(100, (jb.position / jb.duration) * 100) : 0)

	function handleProgressClick(e: MouseEvent) {
		if (jb.duration <= 0) return
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
		jukeboxSeek(pct * jb.duration)
	}

	// ── Thumbnail ──────────────────────────────────────────────────────────────
	const thumbUrl = $derived(
		jb.track ? `https://img.youtube.com/vi/${jb.track.videoId}/mqdefault.jpg` : ''
	)
	const shortTitle = $derived(
		jb.track
			? (jb.track.title.length > 55 ? jb.track.title.slice(0, 55) + '…' : jb.track.title)
			: ''
	)

	// ── Volume ─────────────────────────────────────────────────────────────────
	function handleVolSlider(e: Event) {
		jukeboxSetVolume(+(e.target as HTMLInputElement).value)
	}

	// ── URL input ──────────────────────────────────────────────────────────────
	let urlInput    = $state('')
	let urlError    = $state('')
	let showUrlInput = $state(false)
	let urlMode     = $state<'play' | 'queue'>('play')

	function submitUrl() {
		urlError = ''
		const url = urlInput.trim()
		if (!url) return
		if (!parseYouTubeUrl(url)) { urlError = 'Lien YouTube invalide'; return }
		const ok = urlMode === 'play' ? jukeboxLoad(url) : jukeboxAddToQueue(url)
		if (ok) { urlInput = ''; urlError = ''; showUrlInput = false }
	}

	function openUrlInput(mode: 'play' | 'queue') {
		urlMode = mode
		urlError = ''
		urlInput = ''
		showUrlInput = true
	}

	// ── Queue (sorted by votes desc, FIFO within same vote count) ──────────────
	const sortedQueue = $derived(
		[...jb.queue].sort((a, b) => b.votes.length - a.votes.length)
	)

	// ── Sections ───────────────────────────────────────────────────────────────
	let showQueue   = $state(true)
	let showHistory = $state(false)
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="w-full shrink-0 overflow-y-auto"
	style="max-height:340px; background:rgba(13,11,8,0.98); border-bottom:1px solid rgba(200,145,74,0.12);"
>

	{#if !joined}
		<!-- Not in voice — read-only notice -->
		<div class="px-4 py-3 flex items-center gap-2.5">
			<span class="text-xl opacity-20" style="color:{accent};">♫</span>
			<p class="text-xs" style="color:{textMuted};">Rejoignez le canal vocal pour contrôler le Jukebox</p>
		</div>

	{:else if !jb.track}
		<!-- No track playing -->
		<div class="px-4 py-3 flex items-center gap-3">
			<span class="text-2xl opacity-20 shrink-0" style="color:{accent};">♫</span>
			<div class="flex-1 min-w-0">
				<p class="text-xs mb-2.5" style="color:{textMuted};">Aucune piste en cours</p>
				{#if showUrlInput}
					<div class="flex gap-2 items-center">
						<input
							type="url"
							bind:value={urlInput}
							placeholder="URL YouTube…"
							autofocus
							class="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-xs focus:outline-none"
							style="background:rgba(255,255,255,0.05); border:1px solid rgba(200,145,74,0.22); color:{textPrimary}; caret-color:{accent};"
							onkeydown={(e) => { if (e.key === 'Enter') submitUrl(); if (e.key === 'Escape') showUrlInput = false }}
						/>
						<button
							onclick={submitUrl}
							class="px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 focus:outline-none hover:brightness-110 transition-all"
							style="background:{accent}; color:#0d0b08;"
						>▶ Lancer</button>
						<button
							onclick={() => { showUrlInput = false; urlInput = ''; urlError = '' }}
							class="text-xs shrink-0 hover:opacity-80 transition-opacity focus:outline-none"
							style="color:{textMuted};"
						>✕</button>
					</div>
					{#if urlError}
						<p class="text-[10px] mt-1.5 px-0.5" style="color:#f87171;">{urlError}</p>
					{/if}
				{:else}
					<div class="flex items-center gap-2">
						<button
							onclick={() => openUrlInput('play')}
							class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors focus:outline-none hover:opacity-80"
							style="border-color:rgba(200,145,74,0.25); color:{accent};"
						>▶ Lancer une piste</button>
						<button
							onclick={() => openUrlInput('queue')}
							class="px-3 py-1.5 rounded-lg text-xs border transition-colors focus:outline-none hover:opacity-80"
							style="border-color:rgba(200,145,74,0.15); color:{textMuted};"
						>+ File d'attente</button>
					</div>
				{/if}
			</div>
		</div>

	{:else}
		<!-- ── Autoplay blocked banner ───────────────────────────────────────── -->
		{#if autoplayBlocked}
			<button
				onclick={jukeboxUnblock}
				class="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold focus:outline-none transition-opacity hover:opacity-90"
				style="background:rgba(200,145,74,0.18); color:{accent}; border-bottom:1px solid rgba(200,145,74,0.2); animation:nexus-pulse 2s ease-in-out infinite;"
			>
				<span>▶</span>
				<span>Cliquer pour synchroniser la lecture</span>
			</button>
		{/if}

		<!-- ── Now Playing ──────────────────────────────────────────────────── -->
		<div class="px-4 pt-3 pb-2">
			<div class="flex items-center gap-3">
				<!-- Thumbnail -->
				<div class="shrink-0 w-[72px] h-[41px] rounded overflow-hidden" style="background:#111;">
					<img
						src={thumbUrl}
						alt=""
						class="w-full h-full object-cover"
						onerror={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
					/>
				</div>

				<!-- Track info -->
				<div class="flex-1 min-w-0">
					<p class="text-xs font-semibold leading-tight truncate" style="color:{textPrimary};">{shortTitle}</p>
					<p class="text-[10px] mt-0.5" style="color:{textMuted};">par {jb.track.addedBy}</p>
				</div>

				<!-- Controls -->
				<div class="flex items-center gap-0.5 shrink-0">
					<button
						onclick={jukeboxSkipPrev}
						title="Précédent"
						disabled={jb.history.length === 0}
						class="w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-colors hover:bg-white/10 focus:outline-none disabled:opacity-25"
						style="color:{textMuted};"
					>⏮</button>

					<button
						onclick={() => jb.playing ? jukeboxPause() : jukeboxPlay()}
						title={jb.playing ? 'Pause' : 'Lecture'}
						class="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-colors focus:outline-none"
						style="background:rgba(200,145,74,0.14); color:{accent};"
					>{jb.playing ? '⏸' : '▶'}</button>

					<button
						onclick={jukeboxSkipNext}
						title="Suivant"
						disabled={jb.queue.length === 0}
						class="w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-colors hover:bg-white/10 focus:outline-none disabled:opacity-25"
						style="color:{textMuted};"
					>⏭</button>

					<button
						onclick={jukeboxClear}
						title="Arrêter"
						class="w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-colors hover:bg-white/10 focus:outline-none"
						style="color:{textMuted};"
					>■</button>
				</div>
			</div>

			<!-- Progress bar + time -->
			<div class="mt-2.5 flex items-center gap-2">
				<span class="text-[10px] font-mono shrink-0 w-8 text-right" style="color:{textMuted};">{fmtTime(jb.position)}</span>

				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="flex-1 relative h-1 rounded-full cursor-pointer group"
					style="background:rgba(200,145,74,0.15);"
					onclick={handleProgressClick}
					role="slider"
					aria-valuemin={0}
					aria-valuemax={jb.duration}
					aria-valuenow={jb.position}
				>
					<div
						class="h-full rounded-full"
						style="width:{progress}%; background:{accent}; transition:width 0.5s linear;"
					></div>
					{#if jb.duration > 0}
						<div
							class="absolute top-1/2 w-2.5 h-2.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
							style="left:{progress}%; transform:translate(-50%,-50%); background:{accent}; box-shadow:0 0 5px {accent}80;"
						></div>
					{/if}
				</div>

				<span class="text-[10px] font-mono shrink-0 w-8" style="color:{textMuted};">{fmtTime(jb.duration)}</span>

				<!-- Repeat -->
				<button
					onclick={jukeboxToggleRepeat}
					title={jb.repeat === 'none' ? 'Répétition désactivée' : 'Répétition piste activée'}
					class="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors focus:outline-none"
					style="color:{jb.repeat !== 'none' ? accent : textMuted}; background:{jb.repeat !== 'none' ? 'rgba(200,145,74,0.12)' : 'transparent'};"
				>{jb.repeat === 'track' ? '🔂' : '🔁'}</button>

				<!-- Shuffle -->
				<button
					onclick={jukeboxToggleShuffle}
					title="Aléatoire {jb.shuffle ? 'activé' : 'désactivé'}"
					class="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors focus:outline-none"
					style="color:{jb.shuffle ? accent : textMuted}; background:{jb.shuffle ? 'rgba(200,145,74,0.12)' : 'transparent'};"
				>🔀</button>
			</div>

			<!-- Volume row -->
			<div class="mt-2 flex items-center gap-2">
				<button
					onclick={jukeboxToggleMute}
					title={muted ? 'Activer le son' : 'Couper le son'}
					class="w-6 h-6 flex items-center justify-center text-base focus:outline-none shrink-0"
					style="color:{muted ? '#f87171' : textMuted};"
				>{muted ? '🔇' : vol === 0 ? '🔈' : vol < 50 ? '🔉' : '🔊'}</button>

				<input
					type="range" min="0" max="100" value={vol}
					oninput={handleVolSlider}
					class="flex-1 h-1.5 rounded-full cursor-pointer"
					style="accent-color:{accent};"
				/>

				<span class="text-[10px] font-mono w-8 text-right shrink-0" style="color:{textMuted};">{vol}%</span>

				<!-- Add to queue shortcut -->
				<button
					onclick={() => openUrlInput('queue')}
					title="Ajouter à la file"
					class="text-[10px] px-2 py-1 rounded-lg border transition-colors focus:outline-none hover:opacity-80 shrink-0"
					style="border-color:rgba(200,145,74,0.2); color:{accent};"
				>+ File</button>
			</div>
		</div>
	{/if}

	{#if joined}
		<!-- ── Queue section ─────────────────────────────────────────────────── -->
		<div style="border-top:1px solid rgba(200,145,74,0.08);">
			<button
				onclick={() => showQueue = !showQueue}
				class="w-full flex items-center gap-2 px-4 py-2 text-[10px] uppercase tracking-wider font-semibold focus:outline-none hover:opacity-80"
				style="color:{textMuted};"
			>
				<span class="flex-1 text-left">File d'attente ({jb.queue.length})</span>
				<span>{showQueue ? '▲' : '▼'}</span>
			</button>

			{#if showQueue}
				<div class="px-3 pb-2">

					{#if jb.queue.length === 0}
						<p class="text-[10px] py-1 px-1 opacity-50" style="color:{textMuted};">File vide</p>
					{/if}

					{#each sortedQueue as item, i (item.videoId + item.addedBy)}
						{@const hasVoted = item.votes.includes(me.username)}
						<div class="flex items-center gap-2 py-1 px-1 rounded-lg hover:bg-white/5 group">
							<!-- Position badge -->
							<span class="text-[9px] w-4 text-center shrink-0 font-mono" style="color:{textMuted};">{i + 1}</span>

							<!-- Thumbnail mini -->
							<div class="shrink-0 w-9 h-5 rounded overflow-hidden" style="background:#111;">
								<img
									src="https://img.youtube.com/vi/{item.videoId}/mqdefault.jpg"
									alt=""
									class="w-full h-full object-cover"
									onerror={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
								/>
							</div>

							<!-- Title + addedBy -->
							<div class="flex-1 min-w-0">
								<p class="text-xs truncate leading-tight" style="color:{textPrimary};">{item.title}</p>
								<p class="text-[9px]" style="color:{textMuted};">par {item.addedBy}</p>
							</div>

							<!-- Vote -->
							<button
								onclick={() => jukeboxVote(item.videoId, item.addedBy)}
								title={hasVoted ? 'Retirer mon vote' : 'Voter'}
								class="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors focus:outline-none shrink-0"
								style="color:{hasVoted ? accent : textMuted}; background:{hasVoted ? 'rgba(200,145,74,0.12)' : 'transparent'};"
							>👍 {item.votes.length}</button>

							<!-- Play now (hover) -->
							<button
								onclick={() => jukeboxLoad(`https://youtu.be/${item.videoId}`)}
								title="Jouer maintenant"
								class="w-5 h-5 flex items-center justify-center rounded text-[10px] opacity-0 group-hover:opacity-100 transition-all focus:outline-none hover:bg-white/10 shrink-0"
								style="color:{accent};"
							>▶</button>

							<!-- Remove (own track) -->
							{#if item.addedBy === me.username}
								<button
									onclick={() => jukeboxRemoveFromQueue(item.videoId, item.addedBy)}
									title="Retirer de la file"
									class="w-5 h-5 flex items-center justify-center rounded text-[10px] opacity-0 group-hover:opacity-100 transition-all focus:outline-none hover:bg-white/10 shrink-0"
									style="color:{textMuted};"
								>✕</button>
							{:else}
								<div class="w-5 shrink-0"></div>
							{/if}
						</div>
					{/each}

					<!-- URL input for queue -->
					{#if showUrlInput && urlMode === 'queue'}
						<div class="mt-1.5 flex gap-2 items-center">
							<input
								type="url"
								bind:value={urlInput}
								placeholder="URL YouTube…"
								autofocus
								class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs focus:outline-none"
								style="background:rgba(255,255,255,0.05); border:1px solid rgba(200,145,74,0.22); color:{textPrimary}; caret-color:{accent};"
								onkeydown={(e) => { if (e.key === 'Enter') submitUrl(); if (e.key === 'Escape') showUrlInput = false }}
							/>
							<button
								onclick={submitUrl}
								class="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold shrink-0 focus:outline-none hover:brightness-110 transition-all"
								style="background:{accent}; color:#0d0b08;"
							>+ Ajouter</button>
							<button
								onclick={() => { showUrlInput = false; urlInput = ''; urlError = '' }}
								class="text-xs shrink-0 hover:opacity-80 focus:outline-none"
								style="color:{textMuted};"
							>✕</button>
						</div>
						{#if urlError}
							<p class="text-[10px] mt-1 px-0.5" style="color:#f87171;">{urlError}</p>
						{/if}
					{:else}
						<button
							onclick={() => openUrlInput('queue')}
							class="mt-1.5 text-[10px] px-2.5 py-1.5 rounded-lg transition-colors focus:outline-none hover:bg-white/5"
							style="color:{accent}; border:1px dashed rgba(200,145,74,0.22);"
						>+ Ajouter à la file</button>
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── History section ───────────────────────────────────────────────── -->
		{#if jb.history.length > 0}
			<div style="border-top:1px solid rgba(200,145,74,0.08);">
				<button
					onclick={() => showHistory = !showHistory}
					class="w-full flex items-center gap-2 px-4 py-2 text-[10px] uppercase tracking-wider font-semibold focus:outline-none hover:opacity-80"
					style="color:{textMuted};"
				>
					<span class="flex-1 text-left">Historique ({jb.history.length})</span>
					<span>{showHistory ? '▲' : '▼'}</span>
				</button>

				{#if showHistory}
					<div class="flex gap-2 overflow-x-auto px-3 pb-3" style="scrollbar-width:none;">
						{#each jb.history as track (track.videoId + track.addedBy)}
							<button
								onclick={() => jukeboxReplayFromHistory(track)}
								title="Rejouer : {track.title}"
								class="shrink-0 flex flex-col items-center gap-1 p-1.5 rounded-lg transition-colors hover:bg-white/8 focus:outline-none"
								style="max-width:76px;"
							>
								<div class="w-[72px] h-[41px] rounded overflow-hidden" style="background:#111;">
									<img
										src="https://img.youtube.com/vi/{track.videoId}/mqdefault.jpg"
										alt=""
										class="w-full h-full object-cover"
										onerror={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
									/>
								</div>
								<p
									class="text-[9px] text-center leading-tight"
									style="color:{textMuted}; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; width:72px;"
								>{track.title}</p>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}

</div>
