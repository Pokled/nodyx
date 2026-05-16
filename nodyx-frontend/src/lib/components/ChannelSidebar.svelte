<script lang="ts">
	import { fade } from 'svelte/transition';
	import VoicePanel from '$lib/components/VoicePanel.svelte';
	import ChannelIcon from '$lib/components/ChannelIcon.svelte';
	import { unreadCountsStore, flashChannelIdStore } from '$lib/unreadStore';

	type Channel = {
		id:              string
		name:            string
		slug?:           string
		type?:           string
		description?:    string
		name_color?:     string | null
		name_bold?:      boolean
		name_italic?:    boolean
		name_underline?: boolean
		icon_emoji?:     string | null
	};

	function nameStyle(ch: Channel): string {
		const parts: string[] = []
		if (ch.name_color)     parts.push(`color: ${ch.name_color}`)
		if (ch.name_bold)      parts.push('font-weight: 700')
		if (ch.name_italic)    parts.push('font-style: italic')
		if (ch.name_underline) parts.push('text-decoration: underline')
		return parts.join(';')
	}

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
		<span class="text-xs font-bold text-gray-300 uppercase tracking-wider">Canaux</span>
	</div>

	<nav class="flex-1 overflow-y-auto py-2 px-2 custom-scrollbar">
		<!-- Canaux texte -->
		{#if textChannels.length > 0}
			<div class="ch-section-header">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M7.875 14.25l1.214 1.942a2.25 2.25 0 001.908 1.058h2.006c.776 0 1.497-.4 1.908-1.058l1.214-1.942M2.41 9h4.636a2.25 2.25 0 011.872 1.002l.164.246a2.25 2.25 0 001.872 1.002h2.092a2.25 2.25 0 001.872-1.002l.164-.246A2.25 2.25 0 0116.954 9h4.636M2.41 9a2.25 2.25 0 00-.16.832V12a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25V9.832c0-.287-.055-.57-.16-.832M2.41 9a2.25 2.25 0 01.382-.632l3.285-3.832a2.25 2.25 0 011.708-.786h8.43c.657 0 1.281.287 1.709.786l3.284 3.832c.163.19.291.404.382.632"/>
				</svg>
				<span>Texte</span>
			</div>
			<div class="space-y-0.5 mb-3">
				{#each textChannels as ch (ch.id)}
					{@const unread = ($unreadCountsStore[ch.id] ?? 0)}
					{@const isFlashing = $flashChannelIdStore === ch.id}
					{@const isActive = selectedChannelId === ch.id}
					{@const hasUnread = unread > 0 && !isActive}
					<button
						onclick={() => onjoinChannel(ch)}
						draggable={isAdmin}
						ondragstart={isAdmin ? (e) => onDragStart(e, ch) : undefined}
						ondragover={isAdmin ? onDragOver : undefined}
						ondrop={isAdmin ? (e) => onDrop(e, ch) : undefined}
						class="ch-item w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded text-sm
						       {isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}
						       {isActive ? 'ch-active' : hasUnread ? 'ch-unread' : 'ch-idle'}
						       {isFlashing ? 'ch-flash' : ''}"
					>
						<span class="ch-hash" class:ch-hash-unread={hasUnread}>
							<ChannelIcon value={ch.icon_emoji} fallback="#" size={14} color={ch.name_color ?? null} />
						</span>
						<span class="truncate flex-1" class:font-semibold={hasUnread} style={nameStyle(ch)}>{ch.slug ?? ch.name}</span>
						{#if hasUnread}
							<span class="ch-badge">{unread > 99 ? '99+' : unread}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Canaux vocaux -->
		{#if voiceChannels.length > 0}
			<div class="ch-section-header ch-section-header--voice">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/>
				</svg>
				<span>Vocal</span>
			</div>
			<div class="space-y-0.5">
				{#each voiceChannels as ch (ch.id)}
					{@const inThisChannel = voiceState.channelId === ch.id}
					<button
						onclick={() => onjoinVoice(ch)}
						draggable={isAdmin}
						ondragstart={isAdmin ? (e) => onDragStart(e, ch) : undefined}
						ondragover={isAdmin ? onDragOver : undefined}
						ondrop={isAdmin ? (e) => onDrop(e, ch) : undefined}
						class="ch-voice-item w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded text-sm
						       {isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}
						       {inThisChannel ? 'ch-voice-active' : 'ch-voice-idle'}"
						title={inThisChannel ? 'Quitter le salon vocal' : 'Rejoindre le salon vocal'}
					>
						<!-- Icône : custom prioritaire, sinon onde/micro animé -->
						{#if ch.icon_emoji}
							<span class="ch-voice-icon {inThisChannel ? 'ch-voice-icon--live' : ''}" aria-hidden="true">
								<ChannelIcon value={ch.icon_emoji} size={14} color={ch.name_color ?? null} />
							</span>
						{:else if inThisChannel}
							<span class="ch-voice-icon ch-voice-icon--live" aria-hidden="true">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/>
								</svg>
							</span>
						{:else}
							<span class="ch-voice-icon" aria-hidden="true">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"/>
								</svg>
							</span>
						{/if}
						<span class="truncate flex-1" style={nameStyle(ch)}>{ch.name}</span>
						{#if inThisChannel}
							<span class="ch-voice-live-pill" aria-label="Vous êtes dans ce salon">
								<span class="ch-voice-live-dot"></span>
								Live
							</span>
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

	/* ── Channel item base ─────────────────────────────────────────────────── */
	.ch-item {
		position: relative;
		overflow: hidden;
		transition: color .15s, background .15s;
	}

	.ch-idle  { color: #9ca3af; }
	.ch-idle:hover { color: #f1f5f9; background: rgba(255,255,255,.06); }

	.ch-active {
		color: #e2e8f0;
		background: rgba(124,58,237,.14);
		box-shadow: inset 2px 0 0 #7c3aed;
	}

	/* ── Unread state: bioluminescent breathing glow ───────────────────────── */
	.ch-unread {
		color: #e2e8f0;
		background: rgba(99,102,241,.07);
		box-shadow: inset 2px 0 0 rgba(124,58,237,.7);
		animation: ch-breathe 2.8s ease-in-out infinite;
	}
	.ch-unread:hover { background: rgba(99,102,241,.14); }

	@keyframes ch-breathe {
		0%,100% {
			box-shadow: inset 2px 0 0 rgba(124,58,237,.55), 0 0 0 rgba(99,102,241,0);
			background: rgba(99,102,241,.06);
		}
		50% {
			box-shadow: inset 2px 0 0 rgba(167,139,250,.95), 0 0 14px rgba(99,102,241,.14);
			background: rgba(99,102,241,.11);
		}
	}

	/* ── Flash: sonar wave sweeps left → right ─────────────────────────────── */
	.ch-flash::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(99,102,241,.22) 35%,
			rgba(167,139,250,.30) 50%,
			rgba(99,102,241,.22) 65%,
			transparent 100%
		);
		transform: translateX(-110%);
		animation: ch-sweep .55s cubic-bezier(.4,0,.2,1) forwards;
		pointer-events: none;
	}
	@keyframes ch-sweep {
		from { transform: translateX(-110%); }
		to   { transform: translateX(110%); }
	}

	/* ── Section headers ───────────────────────────────────────────────────── */
	.ch-section-header {
		display: flex; align-items: center; gap: 6px;
		padding: 14px 10px 6px;
		font-size: 11px; font-weight: 700;
		text-transform: uppercase; letter-spacing: .12em;
		color: #94a3b8;
		border-bottom: 1px solid rgba(255,255,255,.04);
		margin-bottom: 4px;
	}
	.ch-section-header svg { width: 12px; height: 12px; flex-shrink: 0; }
	.ch-section-header--voice { color: #6ee7b7; }
	.ch-section-header--voice svg { stroke: #34d399; }

	/* ── Hash symbol ───────────────────────────────────────────────────────── */
	.ch-hash { color: #6b7280; transition: color .15s; min-width: 14px; display: inline-flex; justify-content: center; }
	.ch-hash-unread { color: #a78bfa; }
	.ch-idle:hover .ch-hash { color: #cbd5e1; }

	/* ── Voice channel items ───────────────────────────────────────────────── */
	.ch-voice-item {
		position: relative; overflow: hidden;
		transition: color .15s, background .15s;
	}
	.ch-voice-idle {
		color: #9ca3af;
	}
	.ch-voice-idle:hover {
		color: #d1fae5;
		background: rgba(16,185,129,.08);
	}
	.ch-voice-active {
		color: #86efac;
		background: rgba(16,185,129,.1);
		box-shadow: inset 2px 0 0 #16a34a;
	}

	/* Voice icon */
	.ch-voice-icon {
		width: 14px; height: 14px; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		color: #6b7280; transition: color .15s;
		font-size: 14px; line-height: 1;
	}
	.ch-voice-icon svg { width: 14px; height: 14px; }
	.ch-voice-idle:hover .ch-voice-icon { color: #4ade80; }
	.ch-voice-icon--live { color: #4ade80; animation: micpulse 2.5s ease-in-out infinite; }
	@keyframes micpulse {
		0%,100% { filter: drop-shadow(0 0 0 rgba(74,222,128,0)); }
		50%      { filter: drop-shadow(0 0 4px rgba(74,222,128,.7)); }
	}

	/* Live pill */
	.ch-voice-live-pill {
		display: flex; align-items: center; gap: 4px;
		padding: 1px 6px;
		font-size: 9px; font-weight: 800;
		text-transform: uppercase; letter-spacing: .1em;
		color: #4ade80;
		background: rgba(16,185,129,.12);
		border: 1px solid rgba(16,185,129,.25);
		border-radius: 99px;
		flex-shrink: 0;
	}
	.ch-voice-live-dot {
		width: 5px; height: 5px; border-radius: 50%;
		background: #4ade80;
		animation: dotpulse2 1.8s ease-out infinite;
	}
	@keyframes dotpulse2 {
		0%   { box-shadow: 0 0 0 0 rgba(74,222,128,.6); }
		100% { box-shadow: 0 0 0 5px rgba(74,222,128,0); }
	}

	/* ── Unread badge ──────────────────────────────────────────────────────── */
	.ch-badge {
		flex-shrink: 0;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 99px;
		background: #7c3aed;
		color: white;
		font-size: 9px;
		font-weight: 800;
		text-align: center;
		line-height: 16px;
		animation: ch-badge-pop .2s cubic-bezier(.34,1.56,.64,1) both;
	}
	@keyframes ch-badge-pop {
		from { transform: scale(0); opacity: 0; }
		to   { transform: scale(1); opacity: 1; }
	}
</style>
