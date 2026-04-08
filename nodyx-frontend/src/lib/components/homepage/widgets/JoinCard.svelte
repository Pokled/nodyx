<script lang="ts">
	import { t } from '$lib/i18n';
	import { apiFetch } from '$lib/api';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	const tFn = $derived($t);

	interface Props {
		config:   Record<string, unknown>;
		instance: Record<string, unknown>;
		user:     Record<string, unknown> | null;
		title?:   string | null;
	}

	let { config, instance, user }: Props = $props();

	const showAvatars     = $derived((config.show_recent_avatars as boolean) ?? true);
	const showOnlineCount = $derived((config.show_online_count as boolean) ?? true);
	const cardTitle       = $derived((config.title as string) ?? null);
	const cardSubtitle    = $derived((config.subtitle as string) ?? null);
	const ctaText         = $derived((config.cta_text as string) ?? null);

	const memberCount = $derived((instance.member_count as number) ?? 0);
	const onlineCount = $derived((instance.online_count as number) ?? 0);
	const instanceName = $derived((instance.name as string) ?? 'Nodyx');

	// Recent joiners avatars
	let recentAvatars: { username: string; avatar_url: string | null }[] = $state([]);

	onMount(async () => {
		if (!browser || !showAvatars) return;
		try {
			const res = await apiFetch(fetch, '/users?order=created_at&limit=5');
			if (res.ok) {
				const json = await res.json();
				recentAvatars = json.users ?? [];
			}
		} catch {
			// silent — not critical
		}
	});
</script>

<div class="p-5 flex flex-col gap-4"
     style="background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07)">

	<!-- Title -->
	<div>
		<h3 class="font-extrabold text-base text-white mb-0.5"
		    style="font-family:'Space Grotesk',sans-serif">
			{cardTitle || tFn('home.join_community') || `Rejoindre ${instanceName}`}
		</h3>
		{#if cardSubtitle}
			<p class="text-xs leading-relaxed" style="color:#6b7280">{cardSubtitle}</p>
		{/if}
	</div>

	<!-- Social proof: recent avatars + counts -->
	<div class="flex items-center gap-3">
		{#if showAvatars && recentAvatars.length > 0}
			<div class="flex -space-x-2">
				{#each recentAvatars.slice(0, 5) as u}
					<div class="w-7 h-7 rounded-full overflow-hidden shrink-0"
					     style="background:rgba(124,58,237,.3); border:2px solid #0d0d12; outline:1px solid rgba(124,58,237,.25)">
						{#if u.avatar_url}
							<img src={u.avatar_url} alt={u.username} class="w-full h-full object-cover" />
						{:else}
							<span class="w-full h-full flex items-center justify-center text-[10px] font-bold text-white">
								{u.username.charAt(0).toUpperCase()}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="text-xs leading-tight" style="color:#6b7280">
			<span style="color:#a78bfa; font-weight:700">{memberCount.toLocaleString()}</span>
			{tFn('common.members')}
			{#if showOnlineCount}
				<span class="mx-1" style="color:#374151">·</span>
				<span style="color:#4ade80; font-weight:700">{onlineCount}</span>
				{tFn('common.online')}
			{/if}
		</div>
	</div>

	<!-- CTA -->
	<a href="/auth/register"
	   class="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all"
	   style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#7c3aed,#0e7490); border:1px solid rgba(124,58,237,.4)">
		{ctaText || tFn('common.join') || 'Rejoindre'}
		<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
		</svg>
	</a>
</div>
