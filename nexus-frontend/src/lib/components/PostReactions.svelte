<script lang="ts">
	interface ReactionSummary {
		emoji: string;
		count: number;
		user_reacted: boolean;
	}

	let {
		postId,
		reactions     = [],
		thanksCount   = 0,
		userThanked   = false,
		isOwnPost     = false,
		isLoggedIn    = false,
	}: {
		postId:       string;
		reactions?:   ReactionSummary[];
		thanksCount?: number;
		userThanked?: boolean;
		isOwnPost?:   boolean;
		isLoggedIn?:  boolean;
	} = $props();

	const EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];

	// Local optimistic state
	let localReactions = $state<ReactionSummary[]>(reactions.map(r => ({ ...r })));
	let localThanksCount = $state(thanksCount);
	let localUserThanked = $state(userThanked);

	function reactionFor(emoji: string): ReactionSummary | undefined {
		return localReactions.find(r => r.emoji === emoji);
	}

	function toggleReaction(emoji: string) {
		const existing = localReactions.find(r => r.emoji === emoji);
		if (existing) {
			if (existing.user_reacted) {
				existing.count = Math.max(0, existing.count - 1);
				existing.user_reacted = false;
				if (existing.count === 0) {
					localReactions = localReactions.filter(r => r.emoji !== emoji);
				}
			} else {
				existing.count += 1;
				existing.user_reacted = true;
			}
		} else {
			localReactions = [...localReactions, { emoji, count: 1, user_reacted: true }];
		}
		fetch(`/api/v1/forums/posts/${postId}/reactions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
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
		fetch(`/api/v1/forums/posts/${postId}/thanks`, { method: 'POST' }).catch(() => {});
	}
</script>

<div class="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-800/60">
	<!-- Emoji reactions -->
	{#each EMOJIS as emoji}
		{@const r = reactionFor(emoji)}
		{#if isLoggedIn}
			<button
				type="button"
				onclick={() => toggleReaction(emoji)}
				class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors
				{r?.user_reacted
					? 'border-indigo-600 bg-indigo-900/40 text-indigo-300'
					: 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600 hover:text-gray-300'}"
				title="{emoji}"
			>
				<span>{emoji}</span>
				{#if r && r.count > 0}
					<span>{r.count}</span>
				{/if}
			</button>
		{:else if r && r.count > 0}
			<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-gray-700 bg-gray-800/40 text-gray-400">
				<span>{emoji}</span>
				<span>{r.count}</span>
			</span>
		{/if}
	{/each}

	<!-- Thanks button -->
	{#if isLoggedIn && !isOwnPost}
		<button
			type="button"
			onclick={toggleThanks}
			class="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors
			{localUserThanked
				? 'border-yellow-600 bg-yellow-900/30 text-yellow-300'
				: 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-yellow-600 hover:text-yellow-300'}"
		>
			<span>🙏</span>
			<span>Merci{localThanksCount > 0 ? ` (${localThanksCount})` : ''}</span>
		</button>
	{:else if localThanksCount > 0}
		<span class="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-gray-700 bg-gray-800/40 text-gray-500">
			🙏 {localThanksCount}
		</span>
	{/if}
</div>
