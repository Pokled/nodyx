<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
		});
	}
	function formatTime(iso: string) {
		return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}
	function formatDateRange(ev: any): string {
		if (ev.is_all_day) return formatDate(ev.starts_at);
		const start = `${formatDate(ev.starts_at)} à ${formatTime(ev.starts_at)}`;
		if (!ev.ends_at) return start;
		const sameDay = new Date(ev.starts_at).toDateString() === new Date(ev.ends_at).toDateString();
		return sameDay ? `${start} – ${formatTime(ev.ends_at)}` : `${start} → ${formatDate(ev.ends_at)}`;
	}

	function isUpcoming(ev: any): boolean {
		return new Date(ev.starts_at) >= new Date();
	}

	function isToday(ev: any): boolean {
		const now  = new Date();
		const d    = new Date(ev.starts_at);
		return d.getDate() === now.getDate() &&
		       d.getMonth() === now.getMonth() &&
		       d.getFullYear() === now.getFullYear();
	}

	// Grouper par mois
	const grouped = $derived(() => {
		const map = new Map<string, any[]>();
		for (const ev of data.events) {
			const key = new Date(ev.starts_at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(ev);
		}
		return [...map.entries()];
	});
</script>

<svelte:head>
	<title>Calendrier</title>
</svelte:head>

<!-- ── En-tête ─────────────────────────────────────────────────────────────── -->
<div class="relative mb-6 overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-900 to-emerald-950/30 p-7 shadow-xl">
	<div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
	<div class="absolute -top-16 -right-16 w-64 h-64 bg-emerald-600/10 rounded-full blur-3xl"></div>

	<div class="relative flex items-start justify-between gap-4 flex-wrap">
		<div>
			<div class="flex items-center gap-3 mb-2">
				<div class="w-9 h-9 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-lg">📅</div>
				<h1 class="text-2xl font-bold text-white">Calendrier</h1>
			</div>
			<p class="text-gray-400 text-sm">Les événements de la communauté — à venir et passés.</p>
		</div>

		<div class="flex items-center gap-3 flex-wrap">
			<!-- Bascule à venir / passés -->
			<div class="flex rounded-xl overflow-hidden border border-gray-700">
				<a href="/calendar"
				   class="px-4 py-2 text-xs font-medium transition-colors {!data.past ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}">
					À venir
				</a>
				<a href="/calendar?past=true"
				   class="px-4 py-2 text-xs font-medium transition-colors {data.past ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}">
					Passés
				</a>
			</div>

			{#if data.token}
				<a href="/calendar/new"
				   class="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors">
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
					</svg>
					Créer un événement
				</a>
			{/if}
		</div>
	</div>
</div>

<!-- ── Contenu ─────────────────────────────────────────────────────────────── -->
{#if data.events.length === 0}
	<div class="flex flex-col items-center justify-center py-24 text-center">
		<div class="w-16 h-16 rounded-2xl bg-gray-800/60 border border-gray-700/50 flex items-center justify-center text-3xl mb-4">📅</div>
		<p class="text-gray-400 text-sm mb-1">Aucun événement {data.past ? 'passé' : 'à venir'}.</p>
		{#if data.token && !data.past}
			<p class="text-gray-600 text-xs">Soyez le premier à <a href="/calendar/new" class="text-emerald-400 hover:underline">créer un événement</a>.</p>
		{/if}
	</div>
{:else}
	<div class="space-y-8">
		{#each grouped() as [month, events]}
			<section>
				<!-- Séparateur mois -->
				<div class="flex items-center gap-3 mb-4">
					<h2 class="text-xs font-semibold uppercase tracking-widest text-gray-500 capitalize">{month}</h2>
					<div class="flex-1 h-px bg-gray-800"></div>
				</div>

				<div class="space-y-3">
					{#each events as ev}
						<a href="/calendar/{ev.id}"
						   class="group flex gap-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4
						          hover:border-emerald-700/50 hover:bg-gray-900/80 hover:shadow-lg hover:shadow-emerald-600/5
						          transition-all {ev.is_cancelled ? 'opacity-50' : ''}">

							<!-- Pastille date -->
							<div class="flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center
							           border {isToday(ev) ? 'bg-emerald-600/20 border-emerald-500/40' : 'bg-gray-800/60 border-gray-700/50'}">
								<span class="text-xs font-medium {isToday(ev) ? 'text-emerald-300' : 'text-gray-500'}">
									{new Date(ev.starts_at).toLocaleDateString('fr-FR', { month: 'short' }).toUpperCase()}
								</span>
								<span class="text-xl font-bold {isToday(ev) ? 'text-emerald-200' : 'text-white'} leading-none">
									{new Date(ev.starts_at).getDate()}
								</span>
							</div>

							<div class="flex-1 min-w-0">
								<div class="flex items-start gap-2 flex-wrap mb-1">
									<h3 class="text-white font-semibold text-sm leading-snug group-hover:text-emerald-200 transition-colors {ev.is_cancelled ? 'line-through' : ''}">
										{ev.title}
									</h3>
									{#if ev.is_cancelled}
										<span class="text-[10px] px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-800/40 font-medium">Annulé</span>
									{/if}
									{#if isToday(ev)}
										<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-800/40 font-medium">Aujourd'hui</span>
									{/if}
								</div>

								<p class="text-gray-500 text-xs mb-2">{formatDateRange(ev)}</p>

								{#if ev.location}
									<p class="text-gray-600 text-xs flex items-center gap-1 mb-2">
										<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
											<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
										</svg>
										{ev.location}
									</p>
								{/if}

								<div class="flex items-center gap-3 flex-wrap">
									{#if ev.rsvp_enabled}
										<span class="text-[11px] text-gray-500 flex items-center gap-1">
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/>
											</svg>
											{ev.going_count} participant{ev.going_count !== 1 ? 's' : ''}
										</span>
									{/if}

									{#if ev.tags?.length > 0}
										<div class="flex flex-wrap gap-1">
											{#each ev.tags.slice(0, 4) as tag}
												<span class="px-1.5 py-0.5 rounded-md text-[10px] bg-gray-800 text-gray-400 border border-gray-700/50">{tag}</span>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}
