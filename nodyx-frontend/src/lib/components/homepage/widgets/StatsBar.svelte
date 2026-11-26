<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import { browser } from '$app/env';
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

	// Live counters (updated via socket) — untrack: init volontairement depuis les props serveur
	let memberCount  = $state(untrack(() => (instance.member_count as number) ?? 0));
	let onlineCount  = $state(untrack(() => (instance.online_count as number) ?? 0));
	let threadCount  = $state(untrack(() => (instance.thread_count as number) ?? 0));
	let postCount    = $state(untrack(() => (instance.post_count as number) ?? 0));

	// Animated counting state
	let displayed = $state(untrack(() => {
		const anim = (config.animated_count as boolean) ?? true;
		return {
			members: anim ? 0 : ((instance.member_count as number) ?? 0),
			online:  anim ? 0 : ((instance.online_count as number) ?? 0),
			threads: anim ? 0 : ((instance.thread_count as number) ?? 0),
			posts:   anim ? 0 : ((instance.post_count as number) ?? 0),
		};
	}));

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
			label: tFn('common.members'), color: 'var(--np)', pulse: false, glow: true,
		}),
		online: () => ({
			// Vert "en ligne" volontairement fixe : couleur de statut sémantique,
			// pas un accent de thème (cohérence avec les autres indicateurs "online" du site).
			key: 'online', value: displayed.online,
			label: tFn('common.online'), color: '#4ade80', pulse: true, glow: false,
		}),
		threads: () => ({
			key: 'threads', value: displayed.threads,
			label: tFn('common.topics'), color: 'var(--na)', pulse: false, glow: false,
		}),
		posts: () => ({
			key: 'posts', value: displayed.posts,
			label: tFn('home.stat_posts'), color: 'var(--ntm)', pulse: false, glow: false,
		}),
	};

	const visibleStats = $derived(
		statTypes
			.filter(s => s in allStats)
			.map(s => allStats[s]())
	);
</script>

<div class="sb flex flex-wrap items-stretch gap-0.5">
	{#each visibleStats as stat (stat.key)}
		<div class="sb-cell flex flex-col items-center justify-center px-6 py-2 gap-0.5"
		     style="background:var(--nc); border:var(--nbw) solid var(--nborder); border-radius:var(--nr, 0px)">
			<span
				class="sb-value font-black text-xl tabular-nums"
				class:sglow={stat.glow}
				style="font-family:var(--nfont); color:{stat.color}"
			>
				{#if stat.pulse}
					<span class="flex items-center gap-2">
						<span class="sb-dot w-2 h-2 rounded-full opulse" style="background:{stat.color}"></span>
						{stat.value.toLocaleString()}
					</span>
				{:else}
					{stat.value.toLocaleString()}
				{/if}
			</span>
			<span class="sb-label text-[9px] uppercase tracking-[.18em] font-bold" style="color:var(--ntm)">
				{stat.label}
			</span>
		</div>
	{/each}
</div>

<style>
	@keyframes sglow {
		0%,100% { text-shadow: 0 0 0 rgb(var(--np-rgb) / 0); }
		50%      { text-shadow: 0 0 20px rgb(var(--np-rgb) / .5); }
	}
	.sglow { animation: sglow 4s ease-in-out infinite; }

	@keyframes opulse {
		0%   { box-shadow: 0 0 0 0 rgba(74,222,128,.5); }
		100% { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
	}
	.opulse { animation: opulse 2s ease-out infinite; }

	/* Base de design v2 (maquette « Polygone dans l'application ») : des cases égales sur toute
	   la largeur, chiffre en texte, libellé en casse normale, ni halo ni pulsation ; le vert
	   « en ligne » est celui de la base (lisible en clair comme en sombre). */
	:global(.gr-design) .sb { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0;
		border: var(--nbw) solid var(--nborder); background: var(--nc); }
	:global(.gr-design) .sb-cell { align-items: flex-start; padding: 16px 20px; border: 0 !important;
		border-left: var(--nbw) solid var(--nborder) !important; border-radius: 0 !important; background: transparent !important; }
	:global(.gr-design) .sb-cell:first-child { border-left: 0 !important; }
	:global(.gr-design) .sb-value { color: var(--nt) !important; font-size: 1.75rem; font-weight: 700; line-height: 1.15; animation: none; }
	:global(.gr-design) .sb-dot { background: var(--nx-ok) !important; animation: none; }
	:global(.gr-design) .sb-label { font-size: .875rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
</style>
