<script lang="ts">
	import { untrack } from 'svelte';
	import ReactionTooltip from './ReactionTooltip.svelte';

	interface ReactionUser {
		username:   string;
		name_color: string | null;
		created_at: string;
	}

	interface ReactionSummary {
		emoji:        string;
		count:        number;
		user_reacted: boolean;
		users?:       ReactionUser[];  // top 8, depuis Layer 1 tooltip vivant
	}

	let {
		postId,
		reactions     = [],
		thanksCount   = 0,
		userThanked   = false,
		isOwnPost     = false,
		isLoggedIn    = false,
		token         = null,
	}: {
		postId:       string;
		reactions?:   ReactionSummary[];
		thanksCount?: number;
		userThanked?: boolean;
		isOwnPost?:   boolean;
		isLoggedIn?:  boolean;
		token?:       string | null;
	} = $props();

	const EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];

	// Local optimistic state
	let localReactions = $state<ReactionSummary[]>(untrack(() => reactions.map(r => ({ ...r, users: r.users ? [...r.users] : [] }))));
	let localThanksCount = $state(untrack(() => thanksCount));
	let localUserThanked = $state(untrack(() => userThanked));

	// Tooltip : on stocke l'emoji en cours de hover. Delay 350ms pour éviter
	// le flash si l'utilisateur traverse simplement la zone.
	let hoveredEmoji = $state<string | null>(null);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;

	function reactionFor(emoji: string): ReactionSummary | undefined {
		return localReactions.find(r => r.emoji === emoji);
	}

	function openTooltip(emoji: string) {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => { hoveredEmoji = emoji; }, 350);
	}
	function closeTooltip() {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => { hoveredEmoji = null; }, 120);
	}

	// Récupère le nom de l'user courant depuis le token JWT (sans le décoder
	// vraiment — on n'a pas accès au profil ici, le placeholder suffit pour
	// l'optimistic UI ; le serveur renverra la vraie liste au prochain refresh).
	function meUsername(): string {
		return 'toi';
	}

	function toggleReaction(emoji: string) {
		const existing = localReactions.find(r => r.emoji === emoji);
		const nowIso   = new Date().toISOString();
		if (existing) {
			if (existing.user_reacted) {
				// Retire la réaction
				existing.count = Math.max(0, existing.count - 1);
				existing.user_reacted = false;
				if (existing.users) {
					existing.users = existing.users.filter(u => u.username !== meUsername());
				}
				if (existing.count === 0) {
					localReactions = localReactions.filter(r => r.emoji !== emoji);
				}
			} else {
				existing.count += 1;
				existing.user_reacted = true;
				if (existing.users) {
					existing.users = [{ username: meUsername(), name_color: null, created_at: nowIso }, ...existing.users];
				}
			}
		} else {
			localReactions = [...localReactions, {
				emoji,
				count: 1,
				user_reacted: true,
				users: [{ username: meUsername(), name_color: null, created_at: nowIso }],
			}];
		}
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (token) headers['Authorization'] = `Bearer ${token}`;
		fetch(`/api/v1/forums/posts/${postId}/reactions`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ emoji }),
		}).catch(() => {});
	}

	function toggleThanks() {
		if (localUserThanked) {
			localThanksCount = Math.max(0, localThanksCount - 1);
			localUserThanked = false;
		} else {
			localThanksCount += 1;
			localUserThanked = true;
		}
		const headers: Record<string, string> = {};
		if (token) headers['Authorization'] = `Bearer ${token}`;
		fetch(`/api/v1/forums/posts/${postId}/thanks`, { method: 'POST', headers }).catch(() => {});
	}
</script>

<div class="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[var(--nx-border)]/60">
	<!-- Emoji reactions -->
	{#each EMOJIS as emoji}
		{@const r = reactionFor(emoji)}
		{@const hasReaction = r && r.count > 0}
		<div class="relative inline-block"
		     onmouseenter={() => hasReaction && openTooltip(emoji)}
		     onmouseleave={closeTooltip}
		     role="presentation">
			{#if isLoggedIn}
				<button
					type="button"
					onclick={() => toggleReaction(emoji)}
					onfocus={() => hasReaction && openTooltip(emoji)}
					onblur={closeTooltip}
					class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors
					{r?.user_reacted
						? 'border-indigo-600 bg-[rgb(var(--nx-accent-rgb)/0.14)] text-[var(--nx-header-accent)]'
						: 'border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/40 text-[var(--nx-text-muted)] hover:border-[var(--nx-border)] hover:text-[var(--nx-text)]'}"
					title=""
				>
					<span>{emoji}</span>
					{#if r && r.count > 0}
						<span>{r.count}</span>
					{/if}
				</button>
			{:else if r && r.count > 0}
				<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/40 text-[var(--nx-text-muted)]">
					<span>{emoji}</span>
					<span>{r.count}</span>
				</span>
			{/if}
			{#if hoveredEmoji === emoji && hasReaction && r && r.users && r.users.length > 0}
				<ReactionTooltip
					users={r.users}
					total={r.count}
					{emoji}
					anchor="top"
				/>
			{/if}
		</div>
	{/each}

	<!-- Thanks button -->
	{#if isLoggedIn && !isOwnPost}
		<button
			type="button"
			onclick={toggleThanks}
			class="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors
			{localUserThanked
				? 'border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--nx-warn)_12%,transparent)] text-[var(--nx-warn)]'
				: 'border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/40 text-[var(--nx-text-muted)] hover:border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)] hover:text-[var(--nx-warn)]'}"
		>
			<span>🙏</span>
			<span>Merci{localThanksCount > 0 ? ` (${localThanksCount})` : ''}</span>
		</button>
	{:else if localThanksCount > 0}
		<span class="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/40 text-[var(--nx-text-muted)]">
			🙏 {localThanksCount}
		</span>
	{/if}
</div>
