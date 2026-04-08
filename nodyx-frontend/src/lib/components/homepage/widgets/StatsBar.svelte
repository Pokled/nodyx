<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { t } from '$lib/i18n';
	import { browser } from '$app/environment';
	const tFn = $derived($t);

	interface Props {
		config:   Record<string, unknown>;
		instance: Record<string, unknown>;
		user:     Record<string, unknown> | null;
		title?:   string | null;
	}

	let { config, instance }: Props = $props();

	const statTypes    = $derived((config.stats as string[]) ?? ['members', 'online', 'threads', 'posts']);
	const animated     = $derived((config.animated_count as boolean) ?? true);
	const liveUpdates  = $derived((config.live_updates as boolean) ?? true);

	// Live counters (updated via socket)
	let memberCount  = $state((instance.member_count as number) ?? 0);
	let onlineCount  = $state((instance.online_count as number) ?? 0);
	let threadCount  = $state((instance.thread_count as number) ?? 0);
	let postCount    = $state((instance.post_count as number) ?? 0);

	// Animated counting state
	let displayed = $state({
		members: animated ? 0 : memberCount,
		online:  animated ? 0 : onlineCount,
		threads: animated ? 0 : threadCount,
		posts:   animated ? 0 : postCount,
	});

	function animateTo(key: keyof typeof displayed, target: number) {
		if (!animated) { displayed[key] = target; return; }
		const start = displayed[key];
		const diff  = target - start;
		if (!diff) return;
		const steps  = 40;
		const delay  = 25;
		let   step   = 0;
		const timer  = setInterval(() => {
			step++;
			displayed[key] = Math.round(start + diff * (step / steps));
			if (step >= steps) { displayed[key] = target; clearInterval(timer); }
		}, delay);
	}

	onMount(() => {
		// Trigger animations
		animateTo('members', memberCount);
		animateTo('online',  onlineCount);
		animateTo('threads', threadCount);
		animateTo('posts',   postCount);

		if (!browser || !liveUpdates) return;

		// Subscribe to live updates via socket /public namespace
		import('$lib/socket').then(({ getSocket }) => {
			// Socket connection is optional — stats work without it
		});
	});

	interface StatDef {
		key:   string;
		value: number;
		label: string;
		color: string;
		pulse: boolean;
		glow:  boolean;
	}

	const allStats: Record<string, () => StatDef> = {
		members: () => ({
			key: 'members', value: displayed.members,
			label: tFn('common.members'), color: '#a78bfa', pulse: false, glow: true,
		}),
		online: () => ({
			key: 'online', value: displayed.online,
			label: tFn('common.online'), color: '#4ade80', pulse: true, glow: false,
		}),
		threads: () => ({
			key: 'threads', value: displayed.threads,
			label: tFn('common.topics'), color: '#67e8f9', pulse: false, glow: false,
		}),
		posts: () => ({
			key: 'posts', value: displayed.posts,
			label: tFn('nav.dm'), color: '#94a3b8', pulse: false, glow: false,
		}),
	};

	const visibleStats = $derived(
		statTypes
			.filter(s => s in allStats)
			.map(s => allStats[s]())
	);
</script>

<div class="flex flex-wrap items-stretch gap-0.5">
	{#each visibleStats as stat (stat.key)}
		<div class="flex flex-col items-center justify-center px-6 py-2 gap-0.5"
		     style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06)">
			<span
				class="font-black text-xl tabular-nums"
				class:sglow={stat.glow}
				style="font-family:'Space Grotesk',sans-serif; color:{stat.color}"
			>
				{#if stat.pulse}
					<span class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full opulse" style="background:{stat.color}"></span>
						{stat.value.toLocaleString()}
					</span>
				{:else}
					{stat.value.toLocaleString()}
				{/if}
			</span>
			<span class="text-[9px] uppercase tracking-[.18em] font-bold" style="color:#374151">
				{stat.label}
			</span>
		</div>
	{/each}
</div>

<style>
	@keyframes sglow {
		0%,100% { text-shadow: 0 0 0 rgba(124,58,237,0); }
		50%      { text-shadow: 0 0 20px rgba(124,58,237,.5); }
	}
	.sglow { animation: sglow 4s ease-in-out infinite; }

	@keyframes opulse {
		0%   { box-shadow: 0 0 0 0 rgba(74,222,128,.5); }
		100% { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
	}
	.opulse { animation: opulse 2s ease-out infinite; }
</style>
