<script lang="ts">
	import { fade } from 'svelte/transition';
	import VoicePanel from '$lib/components/VoicePanel.svelte';

	type Channel = { id: string; name: string; slug?: string; type?: string; description?: string };

	let {
		textChannels = [],
		voiceChannels = [],
		selectedChannelId = null,
		voiceState,
		voiceChannelMembers = {},
		isAdmin = false,
		myUsername = '',
		myAvatar = null as string | null,
		token = null as string | null,
		voiceError = null as string | null,
		drawerOpen = $bindable(false),
		localChannels = $bindable<Channel[]>([]),
		onjoinChannel,
		onjoinVoice,
		onopenVoiceMemberPanel,
		ondismissVoiceError,
	}: {
		textChannels: Channel[];
		voiceChannels: Channel[];
		selectedChannelId: string | null;
		voiceState: any;
		voiceChannelMembers: Record<string, any[]>;
		isAdmin: boolean;
		myUsername: string;
		myAvatar: string | null;
		token: string | null;
		voiceError: string | null;
		drawerOpen?: boolean;
		localChannels?: Channel[];
		onjoinChannel: (ch: Channel) => void;
		onjoinVoice: (ch: Channel) => void;
		onopenVoiceMemberPanel: (m: { username: string; avatar: string | null }) => void;
		ondismissVoiceError?: () => void;
	} = $props();

	// ── Drag & Drop (admin only) ────────────────────────────────────────────
	let dragSrcId = $state<string | null>(null);

	function onDragStart(e: DragEvent, ch: Channel) {
		dragSrcId = ch.id;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', ch.id);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
	}

	async function onDrop(e: DragEvent, targetCh: Channel) {
		e.preventDefault();
		if (!dragSrcId || dragSrcId === targetCh.id) return;
		const srcCh = localChannels.find((c) => c.id === dragSrcId);
		if (!srcCh) return;
		const srcType = (srcCh as any).type ?? 'text';
		const tgtType = (targetCh as any).type ?? 'text';
		if (srcType !== tgtType) return;

		const copy = localChannels.slice();
		const srcIdx = copy.findIndex((c) => c.id === dragSrcId);
		const tgtIdx = copy.findIndex((c) => c.id === targetCh.id);
		if (srcIdx === -1 || tgtIdx === -1) return;
		const [removed] = copy.splice(srcIdx, 1);
		copy.splice(tgtIdx, 0, removed);
		localChannels = copy;
		dragSrcId = null;

		try {
			const { PUBLIC_API_URL } = await import('$env/static/public');
			await fetch(`${PUBLIC_API_URL}/admin/channels/reorder`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ ids: localChannels.map((c) => c.id) }),
			});
		} catch { /* ignore */ }
	}
</script>

<!-- Backdrop mobile -->
{#if drawerOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="lg:hidden fixed inset-0 bg-black/60 z-[55] backdrop-blur-sm"
	     role="button" tabindex="-1" aria-label="Fermer les canaux"
	     onclick={() => drawerOpen = false}
	     onkeydown={(e) => e.key === 'Escape' && (drawerOpen = false)}
	     transition:fade={{ duration: 200 }}></div>
{/if}

<!-- Sidebar -->
<aside
	id="channels-drawer"
	role={drawerOpen ? 'dialog' : undefined}
	aria-modal={drawerOpen ? 'true' : undefined}
	aria-label="Canaux"
	class="
		flex flex-col border-r border-gray-800 bg-gray-900 transition-transform duration-300 ease-in-out
		max-lg:fixed max-lg:top-12 max-lg:bottom-0 max-lg:left-0 max-lg:z-[60] max-lg:w-[280px]
		lg:w-56 lg:shrink-0
		{drawerOpen ? 'translate-x-0' : 'max-lg:-translate-x-full'}
	"
>
	<div class="h-12 flex items-center px-4 border-b border-gray-800">
		<span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Canaux</span>
	</div>

	<nav class="flex-1 overflow-y-auto py-2 px-2 custom-scrollbar">
		<!-- Canaux texte -->
		{#if textChannels.length > 0}
			<p class="px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Texte</p>
			<div class="space-y-0.5 mb-3">
				{#each textChannels as ch (ch.id)}
					<button
						onclick={() => onjoinChannel(ch)}
						draggable={isAdmin}
						ondragstart={isAdmin ? (e) => onDragStart(e, ch) : undefined}
						ondragover={isAdmin ? onDragOver : undefined}
						ondrop={isAdmin ? (e) => onDrop(e, ch) : undefined}
						class="w-full text-left flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors
						       {isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}
						       {selectedChannelId === ch.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}"
					>
						<span class="text-gray-500">#</span>
						<span class="truncate">{ch.slug ?? ch.name}</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Canaux vocaux -->
		{#if voiceChannels.length > 0}
			<p class="px-2 pt-1 pb-1 text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Vocal</p>
			<div class="space-y-0.5">
				{#each voiceChannels as ch (ch.id)}
					{@const inThisChannel = voiceState.channelId === ch.id}
					<button
						onclick={() => onjoinVoice(ch)}
						draggable={isAdmin}
						ondragstart={isAdmin ? (e) => onDragStart(e, ch) : undefined}
						ondragover={isAdmin ? onDragOver : undefined}
						ondrop={isAdmin ? (e) => onDrop(e, ch) : undefined}
						class="w-full text-left flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors
						       {isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}
						       {inThisChannel ? 'bg-green-900/40 text-green-300 border border-green-800/40' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}"
						title={inThisChannel ? 'Quitter le salon vocal' : 'Rejoindre le salon vocal'}
					>
						<span class="text-base leading-none">{inThisChannel ? '🔴' : '🔊'}</span>
						<span class="truncate flex-1">{ch.name}</span>
						{#if inThisChannel}
							<span class="text-[10px] text-green-400 shrink-0">En ligne</span>
						{/if}
					</button>

					{@const members = inThisChannel
						? [
								...voiceState.peers.map((p: any) => ({ username: p.username, avatar: p.avatar ?? null, speaking: p.speaking ?? false })),
								{ username: myUsername || 'Vous', avatar: myAvatar ?? null, speaking: voiceState.mySpeaking },
							]
						: (voiceChannelMembers[ch.id] ?? []).map((m: any) => ({ ...m, speaking: false }))}
					{#if members.length > 0}
						<div class="flex flex-col gap-0.5 pl-6 pt-0.5 pb-1.5">
							{#each members.slice(0, 6) as m}
								{@const isMe = m.username === myUsername}
								{@const isInVoice = inThisChannel}
								<button
									onclick={() => isInVoice ? onopenVoiceMemberPanel(m) : undefined}
									class="flex items-center gap-1.5 w-full text-left rounded px-1 py-0.5 -mx-1 transition-colors
									       {isInVoice ? 'hover:bg-gray-800/60 cursor-pointer' : 'cursor-default'}"
									title={isInVoice ? (isMe ? 'Voir mes stats audio' : `Voir les stats de ${m.username}`) : m.username}
								>
									{#if m.avatar}
										<img src={m.avatar} alt={m.username} class="w-4 h-4 rounded-full object-cover shrink-0 {m.speaking ? 'ring-1 ring-green-400' : ''}" />
									{:else}
										<div class="w-4 h-4 rounded-full bg-indigo-700 flex items-center justify-center text-[8px] font-bold text-white shrink-0 {m.speaking ? 'ring-1 ring-green-400' : ''}">
											{m.username.charAt(0).toUpperCase()}
										</div>
									{/if}
									<span class="text-xs truncate leading-tight {isMe ? 'text-green-400' : 'text-gray-400'}">
										{m.username}{isMe ? ' (vous)' : ''}
									</span>
									{#if isInVoice}
										<svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5 text-gray-700 shrink-0 ml-auto opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
										</svg>
									{/if}
								</button>
							{/each}
							{#if members.length > 6}
								<span class="text-[10px] text-gray-600 pl-5">+{members.length - 6} autres</span>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		{#if textChannels.length === 0 && voiceChannels.length === 0}
			<p class="px-3 py-2 text-xs text-gray-600 italic">Aucun canal</p>
		{/if}
	</nav>

	<!-- Erreur micro -->
	{#if voiceError}
		<div class="mx-2 mb-2 p-2.5 rounded-lg bg-red-900/30 border border-red-800/40 text-xs text-red-300 leading-relaxed">
			<div class="flex items-start gap-1.5">
				<span class="shrink-0 mt-0.5">🎙️</span>
				<div>
					<p class="font-medium mb-1">Micro inaccessible</p>
					<p>{voiceError}</p>
				</div>
			</div>
			<button onclick={() => ondismissVoiceError?.()} class="mt-2 text-[10px] text-red-500 hover:text-red-300 underline">Fermer</button>
		</div>
	{/if}

	<!-- Voice controls (sidebar footer Discord-style) -->
	<VoicePanel mode="sidebar" />
</aside>

<!-- VoicePanel flottant mobile-only -->
<VoicePanel mode="float" extraClass="lg:hidden" />

<style>
	.custom-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
	}
	.custom-scrollbar::-webkit-scrollbar { width: 6px !important; }
	.custom-scrollbar::-webkit-scrollbar-track { background: transparent !important; }
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background-color: rgba(255, 255, 255, 0.1) !important;
		border-radius: 20px !important;
	}
	.custom-scrollbar:hover::-webkit-scrollbar-thumb {
		background-color: rgba(99, 102, 241, 0.4) !important;
	}
</style>
