<script lang="ts">
	import { overlayScroll } from '$lib/actions/overlayScroll';
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n';
	import { editZone } from '$lib/actions/editZone';
	import { buildNameStyle, buildAnimClass } from '$lib/nameEffects';
	import { isDarkTheme } from '$lib/theme';
	import NodyxVersionBadge from '$lib/components/NodyxVersionBadge.svelte';
	import type { OnlineMember } from '$lib/socket';

	const tFn = $derived($t);

	interface UserLite {
		id?: string; username: string; avatar?: string | null;
	}
	interface SidebarBg {
		background_image_url?: string | null;
		background_offset_x?: number | null;
		background_offset_y?: number | null;
		background_scale?: number | null;
		overlay_opacity?: number | null;
		visibility?: 'guests' | 'members' | 'all' | null;
	}
	interface OfflineMember {
		user_id: string; username: string; avatar: string | null;
	}

	let {
		membersCollapsed = $bindable(),
		isDraggingRight = $bindable(),
		rightPanelWidth = $bindable(),
		sidebarBg,
		user,
		onlineMembers,
		memberGroups,
		offlineMembers,
		memberCount,
		screenSharingUserIds,
		streamingUserIds,
		nodyxVersion,
		onShowScreenPreview,
		onHideScreenPreview,
		onOpenStatusModal,
		onToggleMembers,
	}: {
		membersCollapsed: boolean;
		isDraggingRight: boolean;
		rightPanelWidth: number;
		sidebarBg: SidebarBg | null | undefined;
		user: UserLite | null;
		onlineMembers: OnlineMember[];
		memberGroups: { groups: Map<string, OnlineMember[]>; ungrouped: OnlineMember[] };
		offlineMembers: OfflineMember[];
		memberCount: number;
		screenSharingUserIds: Set<string>;
		streamingUserIds: Set<string>;
		nodyxVersion: string;
		onShowScreenPreview: (e: MouseEvent, userId: string | null, username: string, avatar: string | null, side: 'left' | 'right') => void;
		onHideScreenPreview: () => void;
		onOpenStatusModal: () => void;
		onToggleMembers: (velocity?: number | MouseEvent) => void;
	} = $props();

	// Fond de la sidebar membres : visibilité tout/visiteurs/connectés — pour les
	// connectés la sidebar est fonctionnelle (liste des membres), un fond trop
	// présent la rend illisible ; les visiteurs, eux, n'ont qu'une carte
	// d'invitation, l'image peut y rester pleinement.
	const sidebarBgVisible = $derived.by(() => {
		const bg = sidebarBg;
		if (!bg?.background_image_url) return false;
		const vis = bg.visibility ?? 'guests';
		if (vis === 'guests')  return !user;
		if (vis === 'members') return !!user;
		return true;
	});

	// ── Redimensionnement du panneau ────────────────────────────────────────
	// Sous-système autonome, copié tel quel depuis +layout.svelte (comme pour
	// ChannelSidebar) : seuls `rightPanelWidth`/`isDraggingRight`/`membersCollapsed`
	// sont partagés avec le parent (nav du header à droite non concernée pour
	// l'instant — seule la sidebar canaux gauche pousse le header aujourd'hui).
	let draggingPastBoundaryRight = $state(false);
	let dragStartWidthRight = 0;
	let rightDragMoved = false;

	function startRightDrag(e: PointerEvent) {
		if (window.innerWidth < 1280) return;
		if (e.button !== 0) return;
		isDraggingRight = true;
		rightDragMoved = false;
		dragStartWidthRight = rightPanelWidth;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function handleRightDragMove(e: PointerEvent) {
		if (!isDraggingRight) return;
		rightDragMoved = true;
		const width = window.innerWidth - e.clientX;
		if (width < 130) {
			draggingPastBoundaryRight = true;
			rightPanelWidth = Math.max(0, width);
		} else {
			draggingPastBoundaryRight = false;
			rightPanelWidth = Math.max(160, Math.min(500, width));
		}
	}

	function stopRightDrag(e: PointerEvent) {
		if (!isDraggingRight) return;
		isDraggingRight = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch { /* ignore */ }

		if (!rightDragMoved) {
			onToggleMembers();
		} else if (rightPanelWidth < 130) {
			membersCollapsed = true;
			rightPanelWidth = 220;
		} else if (rightPanelWidth < 160) {
			rightPanelWidth = 160;
		}
		draggingPastBoundaryRight = false;
	}
</script>

<aside class="hidden xl:flex members members-c nx-plate"
       class:collapsed={membersCollapsed}
       class:has-bg={sidebarBgVisible}
       id="members-c"
       style="width: {membersCollapsed ? '0px' : 'var(--right-panel-width, 220px)'};"
       data-nx-zone="members"
       use:editZone={{ zone: 'members', label: tFn('edit.zone_members') }}
       class:dragging={isDraggingRight}>
	<div class="nx-zone-img" aria-hidden="true"></div>
	{#if sidebarBgVisible && sidebarBg?.background_image_url}
		<img class="members-bg" src={sidebarBg.background_image_url} alt=""
			style="object-position:{sidebarBg.background_offset_x ?? 50}% {sidebarBg.background_offset_y ?? 50}%; transform-origin:{sidebarBg.background_offset_x ?? 50}% {sidebarBg.background_offset_y ?? 50}%; transform: scale({Math.min(2.5, Math.max(0.4, sidebarBg.background_scale ?? 1))})" />
		<div class="members-bg-overlay" style="opacity:{sidebarBg.overlay_opacity ?? 0.6}"></div>
	{/if}
	<button class="edge-handle"
	        onpointerdown={startRightDrag}
	        onpointermove={handleRightDragMove}
	        onpointerup={stopRightDrag}
	        onclick={(e) => {
	            if (rightDragMoved) {
	                e.preventDefault();
	                e.stopPropagation();
	            } else {
	                onToggleMembers();
	            }
	        }}
	        class:dragging-past-boundary={draggingPastBoundaryRight}
	        aria-label={tFn('members.toggle_aria')}
	        title={tFn('members.toggle_aria')}></button>
	<div class="members-header">
		<span class="label">{tFn('common.members')}</span>
		<div class="online-count">
			<span class="online-dot"></span>
			<span class="online-num">{onlineMembers.length}</span>
		</div>
	</div>

	{#if user}
	<div class="members-scroll" use:overlayScroll={{ inset: 8 }}>
		<div class="scroll-inner">

			<!-- ── Grouped by grade ──────────────────────────────────────── -->
			{#each [...memberGroups.groups.entries()] as [gradeName, members]}
				<div class="group-label">
					<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background: {members[0]?.grade?.color ?? '#6b7280'}"></span>
					<span class="gt">{gradeName}</span>
					<span class="gc">{members.length}</span>
				</div>
				{#each members as member (member.userId)}
					{@const isMe        = member.userId === user?.id}
					{@const hasStatus   = !!(member.status?.text || member.status?.emoji)}
					{@const isSharing   = screenSharingUserIds.has(member.userId)}
					{@const isStreaming = streamingUserIds.has(member.userId)}
					{@const avatarColor = members[0]?.grade?.color ?? 'var(--nx-accent-2-strong)'}

					<button type="button"
					        class="member {isMe ? 'me' : ''}"
					        onclick={isMe ? onOpenStatusModal : () => goto(`/users/${member.username}`)}
					        onmouseenter={isSharing && !isMe ? (e: MouseEvent) => onShowScreenPreview(e, member.userId, member.username, member.avatar, 'left') : undefined}
					        onmouseleave={onHideScreenPreview}>
						<span class="hover-bar"></span>
						<div class="avatar-wrap">
							{#if member.avatar}
								<img src={member.avatar} alt="" class="avatar object-cover" />
							{:else}
								<div class="avatar" style="background: linear-gradient(135deg, {avatarColor}80, var(--nx-cyan-deep))">{member.username.charAt(0).toUpperCase()}</div>
							{/if}
							<span class="status-dot">
								{#if isSharing}
									<svg style="width:10px;height:10px;color:rgb(96,165,250)" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
										<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
									</svg>
								{:else if isStreaming}
									<span class="w-2 h-2 rounded-full bg-red-500 block animate-pulse"></span>
								{:else}
									<span class="d"></span>
								{/if}
							</span>
						</div>
						<div class="info">
							<div class="name-row">
								<span class="name {buildAnimClass(member)}" style={buildNameStyle(member, isMe ? 'var(--nx-accent-2-soft2)' : '#9ca3af', $isDarkTheme)}>{member.username}</span>
								{#if isMe}<span class="you-tag">{tFn('common.you')}</span>{/if}
							</div>
							{#if isSharing || isStreaming}
								<div class="status-text flex items-center gap-1">
									{#if isSharing}
										<span class="text-[9px] font-bold px-1 py-px bg-blue-500/10 border border-blue-500/20 text-blue-400">{tFn('voice.screen_badge')}</span>
									{/if}
									{#if isStreaming}
										<span class="text-[9px] font-bold px-1 py-px bg-red-500/10 border border-red-500/20 text-red-400">LIVE</span>
									{/if}
								</div>
							{:else if hasStatus}
								<div class="status-text">{member.status?.emoji} {member.status?.text}</div>
							{:else if isMe}
								<div class="status-text">{tFn('common.set_status')}</div>
							{/if}
						</div>
					</button>
				{/each}
			{/each}

			<!-- ── No-grade online members ───────────────────────────────── -->
			{#if memberGroups.ungrouped.length > 0}
				<div class="group-label">
					<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-green-400"></span>
					<span class="gt">{tFn('members.online')}</span>
					<span class="gc">{memberGroups.ungrouped.length}</span>
				</div>
				{#each memberGroups.ungrouped as member (member.userId)}
					{@const isMe        = member.userId === user?.id}
					{@const hasStatus   = !!(member.status?.text || member.status?.emoji)}
					{@const isSharing   = screenSharingUserIds.has(member.userId)}
					{@const isStreaming = streamingUserIds.has(member.userId)}

					<button type="button"
					        class="member {isMe ? 'me' : ''}"
					        onclick={isMe ? onOpenStatusModal : () => goto(`/users/${member.username}`)}
					        onmouseenter={isSharing && !isMe ? (e: MouseEvent) => onShowScreenPreview(e, member.userId, member.username, member.avatar, 'left') : undefined}
					        onmouseleave={onHideScreenPreview}>
						<span class="hover-bar"></span>
						<div class="avatar-wrap">
							{#if member.avatar}
								<img src={member.avatar} alt="" class="avatar object-cover" />
							{:else}
								<div class="avatar bg-linear-to-br from-[#7c3aed80] to-[var(--nx-cyan-deep)]">{member.username.charAt(0).toUpperCase()}</div>
							{/if}
							<span class="status-dot">
								{#if isSharing}
									<svg style="width:10px;height:10px;color:rgb(96,165,250)" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
										<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
									</svg>
								{:else if isStreaming}
									<span class="w-2 h-2 rounded-full bg-red-500 block animate-pulse"></span>
								{:else}
									<span class="d"></span>
								{/if}
							</span>
						</div>
						<div class="info">
							<div class="name-row">
								<span class="name {buildAnimClass(member)}" style={buildNameStyle(member, isMe ? 'var(--nx-accent-2-soft2)' : '#9ca3af', $isDarkTheme)}>{member.username}</span>
								{#if isMe}<span class="you-tag">{tFn('common.you')}</span>{/if}
							</div>
							{#if isSharing || isStreaming}
								<div class="status-text flex items-center gap-1">
									{#if isSharing}
										<span class="text-[9px] font-bold px-1 py-px bg-blue-500/10 border border-blue-500/20 text-blue-400">{tFn('voice.screen_badge')}</span>
									{/if}
									{#if isStreaming}
										<span class="text-[9px] font-bold px-1 py-px bg-red-500/10 border border-red-500/20 text-red-400">LIVE</span>
									{/if}
								</div>
							{:else if hasStatus}
								<div class="status-text">{member.status?.emoji} {member.status?.text}</div>
							{:else if isMe}
								<div class="status-text">{tFn('common.set_status')}</div>
							{/if}
						</div>
					</button>
				{/each}
			{/if}

			<!-- ── Offline members ───────────────────────────────────────── -->
			{#if offlineMembers.length > 0}
				<div class="group-label">
					<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-700"></span>
					<span class="gt">{tFn('members.offline')}</span>
					<span class="gc">{offlineMembers.length}</span>
				</div>
				{#each offlineMembers.slice(0, 10) as member (member.user_id)}
					<button type="button"
					        class="member offline"
					        onclick={() => goto(`/users/${member.username}`)}>
						<div class="avatar-wrap">
							{#if member.avatar}
								<img src={member.avatar} alt="" class="avatar grayscale object-cover" />
							{:else}
								<div class="avatar">{member.username.charAt(0).toUpperCase()}</div>
							{/if}
							<span class="status-dot"><span class="d offline"></span></span>
						</div>
						<div class="info">
							<div class="name-row">
								<span class="name">{member.username}</span>
							</div>
						</div>
					</button>
				{/each}
				{#if offlineMembers.length > 10}
					<a href="/members" class="flex items-center justify-center gap-1 mx-2 my-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors text-gray-700 border border-white/5">
						{tFn('members.see_all')} <span class="text-[9px] text-gray-600">({offlineMembers.length})</span>
					</a>
				{/if}
			{/if}

		</div>
	</div>
	{:else}
		<!-- Not logged in — invite card -->
		<a href="/auth/login" class="guest-members-card" aria-label={tFn('members.guest_aria')}>
			<!-- Radar animé -->
			<div class="guest-radar">
				<div class="guest-radar-ring r1"></div>
				<div class="guest-radar-ring r2"></div>
				<div class="guest-radar-ring r3"></div>
				<div class="guest-radar-core">
					<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
					</svg>
				</div>
			</div>
			<!-- Avatars fantômes -->
			<div class="guest-ghosts">
				{#each ['M','J','A','K','S','T','R','L'] as letter, i}
				<div class="guest-ghost" style="--gi:{i}; --gc:{['var(--nx-accent-soft)','var(--nx-accent-2-soft)','#34d399','#fb923c','#f472b6','var(--nx-cyan-soft)','#facc15','#f87171'][i]}">
					{letter}
				</div>
				{/each}
			</div>
			<div class="guest-live-row">
				<span class="guest-live-dot"></span>
				<span class="guest-live-label">
					{memberCount > 0 ? tFn('members.guest_count', { count: memberCount }) : tFn('members.guest_active')}
				</span>
			</div>
			<p class="guest-tagline">{tFn('members.guest_tagline')}</p>
			<div class="guest-cta">
				<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
					<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
				</svg>
				{tFn('common.login')}
			</div>
		</a>
	{/if}
	<div class="members-footer">
		<NodyxVersionBadge version={nodyxVersion} variant="footer" />
	</div>
</aside>

<style>
	/* 28/09 : plaque flottante en verre (.nx-plate, app.css), sous la barre
	   du haut et décollée du bord droit. Un fond d'image posé par l'admin
	   reste clippé par les coins arrondis (overflow: hidden plus bas). */
	.members-c {
	  position: fixed;
	  right: var(--shell-gap);
	  top: calc(var(--shell-gap) * 2 + var(--shell-head-h));
	  bottom: var(--shell-gap);
	  width: var(--right-panel-width, 220px);
	  font-family: var(--font-shell);
	  /* PAS de `display: flex` ici : ce sélecteur scopé (spécificité + hash Svelte)
	     écrasait le `hidden` de Tailwind et la sidebar restait visible sous 1280px,
	     superposée au contenu sur mobile. On laisse Tailwind piloter l'affichage
	     (`hidden xl:flex` sur l'aside) ; flex-direction ne s'applique que quand
	     Tailwind a mis display:flex à >=1280px. */
	  flex-direction: column;
	  z-index: 30;
	  transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), width 280ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease-out;
	  will-change: transform, width;
	  overflow: hidden;
	}

	.members-c.dragging {
	  transition: none !important;
	}

	.members-bg {
	  position: absolute;
	  inset: 0;
	  width: 100%;
	  height: 100%;
	  object-fit: cover;
	  z-index: -1;
	}
	.members-bg-overlay {
	  position: absolute;
	  inset: 0;
	  background: var(--nx-surface);
	  z-index: -1;
	}

	/* Lisibilité du texte/avatars quand un fond d'image est actif : la teinte de
	   l'overlay assure l'essentiel, ce filet supplémentaire évite que le texte se
	   perde sur les zones les plus claires d'une image chargée. */
	.members-c.has-bg .members-header .label,
	.members-c.has-bg .members-header .online-num,
	.members-c.has-bg .guest-members-card {
	  text-shadow: 0 1px 4px rgba(0, 0, 0, .85);
	}
	.members-c.has-bg .members-header {
	  background: color-mix(in srgb, var(--nx-surface) 65%, transparent);
	  backdrop-filter: blur(3px);
	}

	.members-c.collapsed {
	  width: 0;
	  opacity: 0;
	  pointer-events: none;
	}

	/* Poignée de redimensionnement — `.panel .edge-handle` (canaux) vit dans
	   ChannelSidebar.svelte depuis son extraction (20/09), copiée verbatim du
	   même bloc d'origine dans +layout.svelte. Celle-ci en est la sœur côté
	   membres, extraite le même jour. */
	.members-c .edge-handle {
	  display: none;
	  position: absolute;
	  top: 0;
	  bottom: 0;
	  width: 10px;
	  cursor: ew-resize;
	  z-index: 10;
	  background: transparent;
	  transition: background-color 120ms ease-out, transform 80ms ease-out;
	  border: none;
	  padding: 0;
	  left: 0;
	}

	@media (min-width: 1024px) {
	  .members-c .edge-handle { display: block; }
	}

	.members-c .edge-handle:hover {
	  background: var(--nx-border);
	}

	.members-c .edge-handle:active {
	  transform: scaleX(1.1);
	}

	.members-c .edge-handle.dragging-past-boundary {
	  transform: scaleX(1.1);
	  opacity: 0.7;
	  background: rgba(239, 68, 68, 0.15) !important;
	}

	.members-c .members-header {
	  height: 48px;
	  padding: 0 16px;
	  border-bottom: 1px solid var(--nx-border-soft);
	  background: var(--nx-surface);
	  display: flex;
	  align-items: center;
	  justify-content: space-between;
	  shrink: 0;
	  overflow: hidden;
	}

	.members-c.collapsed .members-header {
	  padding: 0;
	  justify-content: center;
	  transition: padding 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.members-c .members-header .label {
	  font-size: 11px;
	  font-weight: 700;
	  text-transform: uppercase;
	  letter-spacing: 0.1em;
	  color: var(--nx-text-faint);
	}

	.members-c.collapsed .members-header .label {
	  opacity: 0;
	  transform: translateX(-8px);
	  transition: opacity 200ms ease-out, transform 200ms ease-out;
	}

	.members-c .members-header .online-count {
	  display: flex;
	  align-items: center;
	  gap: 6px;
	}

	.members-c.collapsed .members-header .online-count {
	  opacity: 0;
	  transform: translateX(-8px);
	  transition: opacity 200ms ease-out, transform 200ms ease-out;
	}

	.members-c .members-header .online-dot {
	  width: 6px;
	  height: 6px;
	  border-radius: 50%;
	  background: #4ade80;
	  box-shadow: 0 0 8px #4ade8088;
	}

	.members-c .members-header .online-num {
	  font-size: 11px;
	  font-weight: 600;
	  color: #4ade80;
	}

	.members-c .members-scroll {
	  flex: 1;
	  overflow-y: auto;
	  overflow-x: hidden;
	  scrollbar-width: thin;
	  scrollbar-color: var(--nx-border) transparent;
	}

	/* Pied de la sidebar membres : le badge version est centré (avant ce wrapper il
	   était un enfant flex nu, donc collé au bord gauche = décentré). Bordure haute
	   comme l'en-tête, épinglé en bas (flex-shrink: 0). */
	.members-c .members-footer {
	  flex-shrink: 0;
	  display: flex;
	  justify-content: center;
	  padding: 8px 12px;
	  border-top: 1px solid var(--nx-border-soft);
	}

	.members-c .scroll-inner {
	  padding: 8px;
	  display: flex;
	  flex-direction: column;
	  gap: 2px;
	}

	.members-c .group-label {
	  display: flex;
	  align-items: center;
	  gap: 8px;
	  padding: 12px 8px 6px;
	  font-size: 10px;
	  font-weight: 600;
	  text-transform: uppercase;
	  letter-spacing: 0.08em;
	  color: var(--nx-text-faint);
	  overflow: hidden;
	}

	.members-c.collapsed .group-label {
	  opacity: 0;
	  transform: translateY(-4px);
	  pointer-events: none;
	  transition: opacity 200ms ease-out, transform 200ms ease-out;
	}

	.members-c .group-label .gt {
	  flex: 1;
	  overflow: hidden;
	  text-overflow: ellipsis;
	  white-space: nowrap;
	}

	.members-c .group-label .gc {
	  font-weight: 600;
	}

	.members-c .member {
	  position: relative;
	  width: 100%;
	  display: flex;
	  align-items: center;
	  gap: 10px;
	  padding: 6px 8px;
	  background: transparent;
	  border: none;
	  border-radius: 7px;
	  text-align: left;
	  cursor: pointer;
	  transition: background-color 120ms ease-out, transform 80ms ease-out;
	}

	.members-c .member:active {
	  transform: scale(0.98);
	}

	.members-c.collapsed .member {
	  justify-content: center;
	  padding: 6px 0;
	  transition: padding 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.members-c .member:hover {
	  background: var(--nx-surface-raised);
	}

	.members-c .member.me {
	  background: var(--nx-header-accent-soft);
	}

	.members-c .member.offline {
	  opacity: 0.5;
	}

	.members-c .member .hover-bar {
	  position: absolute;
	  left: 0;
	  top: 4px;
	  bottom: 4px;
	  width: 2px;
	  border-radius: 0 2px 2px 0;
	  background: var(--nx-header-accent);
	  opacity: 0;
	  transition: opacity 180ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.members-c .member:hover .hover-bar {
	  opacity: 1;
	}

	.members-c.collapsed .member .hover-bar {
	  opacity: 0;
	}

	.members-c .member .avatar-wrap {
	  position: relative;
	  shrink: 0;
	}

	.members-c .member .avatar {
	  width: 28px;
	  height: 28px;
	  border-radius: 50%;
	  display: flex;
	  align-items: center;
	  justify-content: center;
	  font-size: 11px;
	  font-weight: 700;
	  color: #fff;
	  background: var(--nx-surface-raised);
	  border: 1px solid var(--nx-border);
	  user-select: none;
	}

	.members-c .member .status-dot {
	  position: absolute;
	  bottom: -2px;
	  right: -2px;
	  width: 10px;
	  height: 10px;
	  border-radius: 50%;
	  background: var(--nx-surface);
	  display: flex;
	  align-items: center;
	  justify-content: center;
	}

	.members-c .member .status-dot .d {
	  width: 6px;
	  height: 6px;
	  border-radius: 50%;
	  background: #4ade80;
	  box-shadow: 0 0 4px #4ade8088;
	}

	.members-c .member .status-dot .d.offline {
	  background: var(--nx-text-faint);
	  box-shadow: none;
	}

	.members-c .member .info {
	  flex: 1;
	  min-width: 0;
	  display: flex;
	  flex-direction: column;
	  gap: 2px;
	}

	.members-c.collapsed .member .info {
	  opacity: 0;
	  transform: translateX(-8px);
	  pointer-events: none;
	  transition: opacity 200ms ease-out, transform 200ms ease-out;
	}

	.members-c .member .name-row {
	  display: flex;
	  align-items: center;
	  gap: 6px;
	  min-width: 0;
	}

	.members-c .member .name {
	  font-size: 13px;
	  font-weight: 500;
	  color: var(--nx-text-muted);
	  white-space: nowrap;
	  overflow: hidden;
	  text-overflow: ellipsis;
	}

	.members-c .member.me .name {
	  color: var(--nx-header-accent);
	}

	.members-c .member .you-tag {
	  font-size: 9px;
	  font-weight: 700;
	  text-transform: uppercase;
	  padding: 1px 4px;
	  border-radius: 4px;
	  background: var(--nx-header-accent-soft);
	  color: var(--nx-header-accent);
	  line-height: 1;
	  shrink: 0;
	}

	.members-c .member .status-text {
	  font-size: 11px;
	  color: var(--nx-text-faint);
	  white-space: nowrap;
	  overflow: hidden;
	  text-overflow: ellipsis;
	}

	.members-c .member.me .status-text {
	  color: var(--nx-text-muted);
	}

	/* ── Guest members sidebar (visiteur non connecté) ───────────────────────── */
	.guest-members-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		gap: 18px;
		padding: 28px 16px;
		text-decoration: none;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		transition: background 0.3s;
	}
	.guest-members-card::before {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(ellipse at 50% 40%, var(--nx-header-accent-soft) 0%, transparent 70%);
		pointer-events: none;
		transition: opacity 0.4s;
		opacity: 1;
	}
	.guest-members-card:hover::before { opacity: 1.6; }
	.guest-members-card:hover { background: var(--nx-surface-raised); }

	/* Radar */
	.guest-radar {
		position: relative;
		width: 72px;
		height: 72px;
		display: flex;
		align-items: center;
		justify-content: center;
		shrink: 0;
	}
	.guest-radar-ring {
		position: absolute;
		border-radius: 50%;
		border: 1px solid var(--nx-header-accent);
		opacity: 0.5;
		animation: guest-ping 2.4s ease-out infinite;
	}
	.r1 { width: 72px; height: 72px; animation-delay: 0s; }
	.r2 { width: 72px; height: 72px; animation-delay: 0.8s; }
	.r3 { width: 72px; height: 72px; animation-delay: 1.6s; }
	@keyframes guest-ping {
		0%   { transform: scale(0.4); opacity: 0.8; }
		100% { transform: scale(1.9); opacity: 0; }
	}
	.guest-radar-core {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--nx-header-accent-soft);
		border: 1px solid var(--nx-header-accent);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--nx-header-accent);
		position: relative;
		z-index: 1;
		transition: background 0.3s, border-color 0.3s;
	}
	.guest-members-card:hover .guest-radar-core {
		background: var(--nx-header-accent);
		border-color: var(--nx-header-accent);
		color: var(--nx-on-accent);
	}

	/* Ghost avatars */
	.guest-ghosts {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		width: 100%;
		max-width: 160px;
	}
	.guest-ghost {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--nx-surface-raised);
		border: 1px solid var(--nx-border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-weight: 700;
		color: var(--gc);
		filter: blur(0.5px);
		opacity: 0.55;
		animation: guest-ghost-float 3s ease-in-out infinite;
		animation-delay: calc(var(--gi) * 0.3s);
		transition: opacity 0.3s, filter 0.3s;
	}
	.guest-members-card:hover .guest-ghost {
		opacity: 0.8;
		filter: blur(0px);
	}
	@keyframes guest-ghost-float {
		0%, 100% { transform: translateY(0px); }
		50%       { transform: translateY(-3px); }
	}

	/* Live row */
	.guest-live-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.guest-live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #4ade80;
		box-shadow: 0 0 6px rgba(74,222,128,0.6);
		animation: guest-live-pulse 1.8s ease-in-out infinite;
		shrink: 0;
	}
	@keyframes guest-live-pulse {
		0%, 100% { box-shadow: 0 0 6px rgba(74,222,128,0.6); }
		50%       { box-shadow: 0 0 12px rgba(74,222,128,0.9), 0 0 20px rgba(74,222,128,0.3); }
	}
	.guest-live-label {
		font-size: 11px;
		font-weight: 700;
		color: #4ade80;
		letter-spacing: 0.03em;
	}

	/* Tagline */
	.guest-tagline {
		font-size: 11px;
		line-height: 1.6;
		color: var(--nx-text-faint);
		text-align: center;
		margin: 0;
	}

	/* CTA */
	.guest-cta {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 9px 18px;
		border-radius: 20px;
		background: var(--nx-header-accent-soft);
		border: 1px solid var(--nx-header-accent);
		color: var(--nx-header-accent);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.02em;
		transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
	}
	.guest-members-card:hover .guest-cta {
		background: var(--nx-header-accent);
		border-color: var(--nx-header-accent);
		color: var(--nx-on-accent);
		box-shadow: 0 0 18px var(--nx-header-accent-soft);
	}

	@media (prefers-reduced-motion: reduce) {
		.guest-radar-ring,
		.guest-ghost,
		.guest-live-dot {
			animation: none;
		}
	}
</style>
