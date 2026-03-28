<script lang="ts">
	import Table        from '$lib/components/Table.svelte';
	import NodyxCanvas  from '$lib/components/NodyxCanvas.svelte';
	import VoiceJukebox from '$lib/components/VoiceJukebox.svelte';
	import { localScreenStore, remoteScreenStore, screenShareStore } from '$lib/voice';
	import { jukeboxStore } from '$lib/jukebox';
	import type { Socket } from 'socket.io-client';

	let {
		selectedChannel,
		voiceState,
		drawerOpen = $bindable(false),
		myUsername = '',
		myAvatar = null as string | null,
		token = null as string | null,
		socket = null as Socket | null,
		userId = '',
		canvasRecapChannelId = null as string | null,
		onjoinCurrentVoice,
	}: {
		selectedChannel: any;
		voiceState: any;
		drawerOpen?: boolean;
		myUsername: string;
		myAvatar: string | null;
		token: string | null;
		socket: Socket | null;
		userId: string;
		canvasRecapChannelId: string | null;
		onjoinCurrentVoice: () => Promise<void>;
	} = $props();

	const localScreen      = $derived($localScreenStore);
	const remoteScreens    = $derived($remoteScreenStore);
	const anyScreenSharing = $derived($screenShareStore || $remoteScreenStore.size > 0);

	let showScreenShare = $state(false);
	$effect(() => { if (anyScreenSharing) showScreenShare = true; });

	const jbState = $derived($jukeboxStore);
	const jbTrackTitle = $derived(
		jbState.track
			? (jbState.track.title.length > 26 ? jbState.track.title.slice(0, 26) + '…' : jbState.track.title)
			: null
	);

	let showJukebox = $state(false);
	let showCanvas  = $state(false);

	const connected = $derived(voiceState.active && voiceState.channelId === selectedChannel.id);
	const peerCount = $derived(connected ? voiceState.peers.length + 1 : 0);

	function srcStream(node: HTMLVideoElement, stream: MediaStream | null) {
		node.srcObject = stream ?? null;
		return {
			update(s: MediaStream | null) { node.srcObject = s ?? null; },
			destroy() { node.srcObject = null; },
		};
	}
</script>

<!-- ── Header ─────────────────────────────────────────────────────────────── -->
<div class="h-12 shrink-0 flex items-center gap-3 px-4"
     style="background: #0a0a10; border-bottom: 1px solid rgba(255,255,255,0.05);">

	<!-- Mobile: drawer toggle -->
	<button class="lg:hidden -ml-1 p-2 text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors focus:outline-none min-w-[44px] min-h-[44px] flex items-center justify-center"
	        onclick={() => drawerOpen = true} aria-label="Ouvrir les canaux">
		<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
		</svg>
	</button>

	<!-- Waveform icon -->
	<div class="shrink-0 flex items-end gap-[2px] h-4"
	     style="color: {connected ? '#7c3aed' : '#4b5563'};">
		<div class="w-[3px] rounded-sm" style="height: 45%; background: currentColor;"></div>
		<div class="w-[3px] rounded-sm" style="height: 100%; background: currentColor;"></div>
		<div class="w-[3px] rounded-sm" style="height: 65%; background: currentColor;"></div>
		<div class="w-[3px] rounded-sm" style="height: 35%; background: currentColor;"></div>
		<div class="w-[3px] rounded-sm" style="height: 80%; background: currentColor;"></div>
	</div>

	<!-- Channel name -->
	<span class="font-bold text-sm text-gray-200 tracking-tight">{selectedChannel.name}</span>

	{#if selectedChannel.description}
		<span class="text-gray-700 text-xs hidden sm:inline truncate">{selectedChannel.description}</span>
	{/if}

	<!-- Connected badge -->
	{#if connected}
		<div class="ml-auto flex items-center gap-1.5 shrink-0">
			<span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em]"
			      style="color: rgba(124,58,237,0.7);">
				<span class="w-1.5 h-1.5 rounded-full bg-violet-500/80 animate-pulse shrink-0"></span>
				{peerCount} connecté{peerCount > 1 ? 's' : ''}
			</span>
		</div>
	{/if}
</div>

<!-- ── Toolbar ────────────────────────────────────────────────────────────── -->
<div class="h-10 shrink-0 flex items-center gap-0.5 px-2"
     style="background: #09090f; border-bottom: 1px solid rgba(255,255,255,0.04);">

	<!-- Jukebox -->
	<button
		onclick={() => showJukebox = !showJukebox}
		class="toolbar-btn {showJukebox ? 'active-amber' : jbState.track ? 'idle-amber' : ''}"
		title="Jukebox"
	>
		{#if jbState.track && jbState.playing}
			<span class="relative flex w-1.5 h-1.5 shrink-0">
				<span class="absolute inline-flex h-full w-full rounded-full bg-amber-400/60 animate-ping"></span>
				<span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400"></span>
			</span>
		{:else}
			<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
			</svg>
		{/if}
		<span>{jbTrackTitle ?? 'Jukebox'}</span>
	</button>

	<div class="toolbar-sep"></div>

	<!-- Canvas collaboratif -->
	<button
		onclick={() => showCanvas = !showCanvas}
		class="toolbar-btn {showCanvas ? 'active-violet' : ''}"
		title="Tableau collaboratif P2P"
	>
		{#if showCanvas}
			<span class="relative flex w-1.5 h-1.5 shrink-0">
				<span class="absolute inline-flex h-full w-full rounded-full bg-violet-400/60 animate-ping"></span>
				<span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-400"></span>
			</span>
		{:else}
			<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/>
			</svg>
		{/if}
		<span>Tableau</span>
	</button>

	<div class="toolbar-sep"></div>

	<!-- Partage d'écran -->
	<button
		onclick={() => showScreenShare = !showScreenShare}
		class="toolbar-btn {showScreenShare && anyScreenSharing ? 'active-blue' : anyScreenSharing ? 'idle-blue' : ''} {!anyScreenSharing ? 'opacity-35' : ''}"
		title={anyScreenSharing ? "Partage d'écran actif" : "Partage d'écran (inactif)"}
		disabled={!anyScreenSharing}
	>
		{#if anyScreenSharing}
			<span class="relative flex w-1.5 h-1.5 shrink-0">
				<span class="absolute inline-flex h-full w-full rounded-full bg-blue-400/60 animate-ping"></span>
				<span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400"></span>
			</span>
		{:else}
			<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3"/>
			</svg>
		{/if}
		<span>Écran</span>
	</button>

	<div class="toolbar-sep"></div>

	<!-- Fichiers (stub) -->
	<button disabled title="Partage de fichiers — bientôt"
		class="toolbar-btn opacity-25 cursor-not-allowed">
		<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"/>
		</svg>
		<span>Fichiers</span>
	</button>

	<!-- Jeux (stub) -->
	<button disabled title="Jeux — bientôt"
		class="toolbar-btn opacity-25 cursor-not-allowed">
		<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.401.604-.401.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z"/>
		</svg>
		<span>Jeux</span>
	</button>
</div>

<!-- ── Jukebox panel ───────────────────────────────────────────────────────── -->
{#if showJukebox}
	<VoiceJukebox
		joined={voiceState.active && voiceState.channelId === selectedChannel.id}
		me={{ username: myUsername }}
	/>
{/if}

<!-- ── Screen share panel ──────────────────────────────────────────────────── -->
{#if showScreenShare && (localScreen || remoteScreens.size > 0)}
	<div class="shrink-0 flex items-center justify-center gap-3 p-3 overflow-x-auto"
	     style="max-height: 38vh; background: #07070f; border-bottom: 1px solid rgba(255,255,255,0.05);">
		{#if localScreen}
			<div class="relative shrink-0 h-40 overflow-hidden bg-gray-900"
			     style="border: 1px solid rgba(59,130,246,0.35); box-shadow: 0 0 20px rgba(59,130,246,0.1);">
				<video class="h-full object-contain" autoplay muted playsinline use:srcStream={localScreen}></video>
				<span class="absolute bottom-1 left-2 text-[10px] text-white font-semibold px-2 py-0.5"
				      style="background: rgba(0,0,0,0.75);">Vous</span>
			</div>
		{/if}
		{#each [...remoteScreens.entries()] as [socketId, stream] (socketId)}
			{@const peer = voiceState.peers.find((p: any) => p.socketId === socketId)}
			<div class="relative shrink-0 h-40 overflow-hidden bg-gray-900"
			     style="border: 1px solid rgba(59,130,246,0.25);">
				<video class="h-full object-contain" autoplay playsinline use:srcStream={stream}></video>
				<span class="absolute bottom-1 left-2 text-[10px] text-white font-semibold px-2 py-0.5"
				      style="background: rgba(0,0,0,0.75);">{peer?.username ?? 'Peer'}</span>
			</div>
		{/each}
	</div>
{/if}

<!-- ── Stage (participants) ────────────────────────────────────────────────── -->
<div class="flex-1 overflow-hidden">
	<Table
		channelName={selectedChannel.name}
		channelId={selectedChannel.id}
		me={{ username: myUsername, avatar: myAvatar }}
		{token}
		joined={voiceState.active && voiceState.channelId === selectedChannel.id}
		onjoin={onjoinCurrentVoice}
		socket={socket}
	/>
</div>

<!-- ── NodyxCanvas overlay ─────────────────────────────────────────────────── -->
{#if showCanvas}
	<NodyxCanvas
		channelId={canvasRecapChannelId}
		voiceChannelId={voiceState.channelId}
		socket={socket}
		{userId}
		username={myUsername}
		onclose={() => showCanvas = false}
	/>
{/if}

<style>
	.toolbar-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 10px;
		height: 28px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: #4b5563;
		border: 1px solid transparent;
		transition: color 150ms, background 150ms, border-color 150ms;
		cursor: pointer;
		background: transparent;
	}
	.toolbar-btn:hover:not(:disabled) {
		color: #9ca3af;
		background: rgba(255,255,255,0.04);
	}
	.toolbar-sep {
		width: 1px;
		height: 16px;
		margin: 0 2px;
		background: rgba(255,255,255,0.05);
		flex-shrink: 0;
	}

	/* Amber (jukebox) */
	.active-amber  { color: #c8914a !important; background: rgba(200,145,74,0.12) !important; border-color: rgba(200,145,74,0.3) !important; }
	.idle-amber    { color: #c8914a !important; }
	.active-amber:hover, .idle-amber:hover { color: #e0a86a !important; }

	/* Violet (canvas) */
	.active-violet { color: #a78bfa !important; background: rgba(124,58,237,0.14) !important; border-color: rgba(124,58,237,0.35) !important; }
	.active-violet:hover { color: #c4b5fd !important; }

	/* Blue (screen share) */
	.active-blue   { color: #60a5fa !important; background: rgba(59,130,246,0.12) !important; border-color: rgba(59,130,246,0.3) !important; }
	.idle-blue     { color: #60a5fa !important; }
</style>
