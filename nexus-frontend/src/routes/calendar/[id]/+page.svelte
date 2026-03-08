<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ev = $derived(data.event);
	const me = $derived(data.event.my_rsvp ?? null);

	let deleting = $state(false);

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
		});
	}
	function formatTime(iso: string) {
		return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	function formatDateRange(): string {
		if (ev.is_all_day) return formatDate(ev.starts_at);
		const start = `${formatDate(ev.starts_at)} à ${formatTime(ev.starts_at)}`;
		if (!ev.ends_at) return start;
		const sameDay = new Date(ev.starts_at).toDateString() === new Date(ev.ends_at).toDateString();
		return sameDay ? `${start} – ${formatTime(ev.ends_at)}` : `${start} → ${formatDate(ev.ends_at)}`;
	}

	const isOwner = $derived(data.token && ev.author_id && true); // simplification — vérif côté serveur
	const isPast  = $derived(new Date(ev.starts_at) < new Date());
</script>

<svelte:head>
	<title>{ev.title}</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<!-- Retour -->
	<a href="/calendar" class="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1.5 mb-5">
		<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
		</svg>
		Calendrier
	</a>

	{#if form?.error}
		<div class="mb-4 rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-red-300 text-sm">{form.error}</div>
	{/if}

	<!-- En-tête événement -->
	<div class="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden mb-5">
		{#if ev.cover_url}
			<img src={ev.cover_url} alt="" class="w-full h-48 object-cover"/>
		{/if}

		<div class="p-6">
			<div class="flex items-start justify-between gap-4 mb-4">
				<div class="flex-1">
					<div class="flex items-center gap-2 mb-2 flex-wrap">
						{#if ev.is_cancelled}
							<span class="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-800/40 font-medium">Annulé</span>
						{/if}
						{#if !isPast && !ev.is_cancelled}
							<span class="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-800/40 font-medium">À venir</span>
						{/if}
						{#if !ev.is_public}
							<span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700 font-medium">Privé</span>
						{/if}
					</div>
					<h1 class="text-2xl font-bold text-white {ev.is_cancelled ? 'line-through opacity-60' : ''}">{ev.title}</h1>
				</div>

				{#if data.token && isOwner}
					<div class="flex gap-2">
						{#if !ev.is_cancelled}
							<form method="POST" action="?/cancelEvent" use:enhance>
								<button type="submit" class="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-800/50 text-xs transition-colors">
									Annuler
								</button>
							</form>
						{/if}
						<form method="POST" action="?/deleteEvent" use:enhance={() => {
							deleting = true;
							return async () => { await goto('/calendar'); };
						}}>
							<button type="submit" disabled={deleting} class="px-3 py-1.5 rounded-lg border border-red-800/50 text-red-400 hover:bg-red-950/30 text-xs transition-colors disabled:opacity-50">
								{deleting ? '...' : 'Supprimer'}
							</button>
						</form>
					</div>
				{/if}
			</div>

			<!-- Méta -->
			<div class="space-y-2 text-sm text-gray-400 mb-5">
				<div class="flex items-start gap-2.5">
					<svg class="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
					</svg>
					<span>{formatDateRange()}</span>
				</div>

				{#if ev.location}
					<div class="flex items-start gap-2.5">
						<svg class="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
						</svg>
						{#if ev.location.startsWith('http')}
							<a href={ev.location} target="_blank" rel="noopener" class="text-emerald-400 hover:underline break-all">{ev.location}</a>
						{:else}
							<span>{ev.location}</span>
						{/if}
					</div>
				{/if}

				{#if ev.author_name}
					<div class="flex items-center gap-2.5">
						<svg class="w-4 h-4 flex-shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
						</svg>
						<span class="text-gray-500">Organisé par <span class="text-gray-300">{ev.author_name}</span></span>
					</div>
				{/if}
			</div>

			<!-- Tags -->
			{#if ev.tags?.length > 0}
				<div class="flex flex-wrap gap-1.5 mb-5">
					{#each ev.tags as tag}
						<span class="px-2.5 py-1 rounded-full text-xs bg-gray-800 text-gray-400 border border-gray-700/50">{tag}</span>
					{/each}
				</div>
			{/if}

			<!-- Description -->
			{#if ev.description}
				<div class="prose prose-invert prose-sm max-w-none text-gray-300 border-t border-gray-800 pt-4">
					{@html ev.description}
				</div>
			{/if}
		</div>
	</div>

	<!-- ── RSVP ─────────────────────────────────────────────────────────────── -->
	{#if ev.rsvp_enabled && !isPast && !ev.is_cancelled && data.token}
		<div class="rounded-2xl border border-gray-800 bg-gray-900/60 p-5 mb-5">
			<div class="flex items-center justify-between mb-4">
				<h2 class="font-semibold text-white text-sm">Participation</h2>
				<div class="flex items-center gap-2 text-xs text-gray-500">
					<span class="text-emerald-400 font-medium">{ev.going_count}</span> participe{ev.going_count !== 1 ? 'nt' : ''}
					{#if ev.maybe_count > 0}
						· <span>{ev.maybe_count}</span> peut-être
					{/if}
					{#if ev.max_attendees}
						· <span class="text-gray-600">max {ev.max_attendees}</span>
					{/if}
				</div>
			</div>

			<div class="flex gap-2">
				{#each [['going', 'Je participe', 'bg-emerald-600 hover:bg-emerald-500'], ['maybe', 'Peut-être', 'bg-amber-600/80 hover:bg-amber-500'], ['not_going', 'Je ne peux pas', 'bg-gray-700 hover:bg-gray-600']] as [status, label, cls]}
					<form method="POST" action="?/rsvp" use:enhance class="flex-1">
						<input type="hidden" name="status" value={status}/>
						<button type="submit"
						        class="w-full py-2 rounded-xl text-xs font-medium transition-colors text-white
						               {me === status ? cls + ' ring-2 ring-white/20' : 'bg-gray-800 hover:bg-gray-700 border border-gray-700'}">
							{label}
						</button>
					</form>
				{/each}
			</div>

			{#if me}
				<form method="POST" action="?/cancelRsvp" use:enhance class="mt-2">
					<button type="submit" class="w-full py-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors">
						Annuler ma participation
					</button>
				</form>
			{/if}
		</div>
	{/if}

	<!-- ── Liste des participants ─────────────────────────────────────────────── -->
	{#if ev.rsvp_enabled && data.attendees?.length > 0}
		<div class="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
			<h2 class="font-semibold text-white text-sm mb-3">Participants ({data.attendees.length})</h2>
			<div class="flex flex-wrap gap-2">
				{#each data.attendees as a}
					<a href="/users/{a.username}"
					   class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-800 border border-gray-700/50 hover:border-gray-600 transition-colors">
						{#if a.avatar_url}
							<img src={a.avatar_url} alt="" class="w-5 h-5 rounded-full object-cover"/>
						{:else}
							<div class="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">
								{a.username[0].toUpperCase()}
							</div>
						{/if}
						<span class="text-xs text-gray-300">{a.username}</span>
						{#if a.status === 'maybe'}
							<span class="text-[10px] text-amber-500">?</span>
						{/if}
					</a>
				{/each}
			</div>
		</div>
	{/if}
</div>
