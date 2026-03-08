<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ev  = $derived(data.event);
	const me  = $derived(data.event.my_rsvp ?? null);

	let deleting = $state(false);

	// ── Formatage dates ────────────────────────────────────────────────────────
	function fDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
		});
	}
	function fTime(iso: string) {
		return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}
	function fDateShort(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
	}
	function dayNum(iso: string) { return new Date(iso).getDate(); }
	function monthShort(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', { month: 'short' }).toUpperCase();
	}
	function isPast(iso: string) { return new Date(iso) < new Date(); }

	// ── OSM embed ─────────────────────────────────────────────────────────────
	const osmEmbedUrl = $derived(() => {
		if (!ev.location_lat || !ev.location_lng) return null;
		const la = ev.location_lat;
		const lo = ev.location_lng;
		const d  = 0.015;
		return `https://www.openstreetmap.org/export/embed.html?bbox=${lo-d},${la-d},${lo+d},${la+d}&layer=mapnik&marker=${la},${lo}`;
	});
	const osmLinkUrl = $derived(() => {
		if (!ev.location_lat || !ev.location_lng) {
			if (!ev.location) return null;
			return `https://www.openstreetmap.org/search?query=${encodeURIComponent(ev.location)}`;
		}
		return `https://www.openstreetmap.org/?mlat=${ev.location_lat}&mlon=${ev.location_lng}&zoom=15`;
	});

	// ── Prix ticket ───────────────────────────────────────────────────────────
	function formatPrice(price: number | null, currency: string): string {
		if (price === null || price === undefined) return 'Gratuit';
		if (price === 0) return 'Gratuit';
		return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(price);
	}

	// ── Statut capacité ───────────────────────────────────────────────────────
	const capacityPct = $derived(() => {
		if (!ev.max_attendees || !ev.going_count) return 0;
		return Math.min(100, Math.round((ev.going_count / ev.max_attendees) * 100));
	});
	const isFull = $derived(() => ev.max_attendees && ev.going_count >= ev.max_attendees);
</script>

<svelte:head>
	<title>{ev.title}</title>
	{#if ev.cover_url}
		<meta property="og:image" content={ev.cover_url}/>
	{/if}
</svelte:head>

<!-- ── HERO IMAGE ──────────────────────────────────────────────────────────── -->
{#if ev.cover_url}
	<div class="relative -mx-4 sm:-mx-6 lg:-mx-8 mb-8 h-72 sm:h-96 overflow-hidden">
		<img src={ev.cover_url} alt="" class="w-full h-full object-cover"/>
		<div class="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/40 to-transparent"></div>

		<!-- Titre overlay sur l'image -->
		<div class="absolute bottom-0 left-0 right-0 p-6">
			<div class="flex items-center gap-2 mb-2 flex-wrap">
				{#if ev.is_cancelled}
					<span class="text-xs px-2.5 py-1 rounded-full bg-red-900/80 text-red-300 border border-red-700/50 font-medium backdrop-blur-sm">Annulé</span>
				{:else if !isPast(ev.starts_at)}
					<span class="text-xs px-2.5 py-1 rounded-full bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 font-medium backdrop-blur-sm">À venir</span>
				{/if}
				{#if !ev.is_public}
					<span class="text-xs px-2.5 py-1 rounded-full bg-gray-800/80 text-gray-300 border border-gray-700/50 font-medium backdrop-blur-sm">Privé</span>
				{/if}
			</div>
			<h1 class="text-3xl font-bold text-white drop-shadow-lg {ev.is_cancelled ? 'line-through opacity-70' : ''}">{ev.title}</h1>
		</div>

		<a href="/calendar" class="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-xl
		   bg-black/50 text-gray-200 hover:bg-black/70 text-xs backdrop-blur-sm transition-colors">
			<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
			</svg>
			Calendrier
		</a>
	</div>
{:else}
	<div class="flex items-start gap-3 mb-6">
		<a href="/calendar" class="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1.5 mt-0.5">
			<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
			</svg>
		</a>
		<div>
			<div class="flex items-center gap-2 mb-1 flex-wrap">
				{#if ev.is_cancelled}
					<span class="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-800/40 font-medium">Annulé</span>
				{:else if !isPast(ev.starts_at)}
					<span class="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-800/40 font-medium">À venir</span>
				{/if}
			</div>
			<h1 class="text-2xl font-bold text-white {ev.is_cancelled ? 'line-through opacity-60' : ''}">{ev.title}</h1>
		</div>
	</div>
{/if}

{#if form?.error}
	<div class="mb-5 rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-red-300 text-sm">{form.error}</div>
{/if}

<!-- ── LAYOUT : contenu + sidebar ─────────────────────────────────────────── -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

	<!-- ── COLONNE PRINCIPALE ─────────────────────────────────────────────── -->
	<div class="lg:col-span-2 space-y-6">

		<!-- Tags -->
		{#if ev.tags?.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each ev.tags as tag}
					<span class="px-3 py-1 rounded-full text-xs bg-gray-800 text-gray-300 border border-gray-700/60">{tag}</span>
				{/each}
			</div>
		{/if}

		<!-- Description -->
		{#if ev.description && ev.description !== '<p></p>'}
			<div class="rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
				<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Description</h2>
				<div class="nexus-prose">
					{@html ev.description}
				</div>
			</div>
		{/if}

		<!-- Carte OpenStreetMap -->
		{#if osmEmbedUrl()}
			<div class="rounded-2xl border border-gray-800 bg-gray-900/50 overflow-hidden">
				<div class="flex items-center justify-between px-5 py-3 border-b border-gray-800">
					<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Lieu</h2>
					{#if osmLinkUrl()}
						<a href={osmLinkUrl()} target="_blank" rel="noopener"
						   class="text-xs text-emerald-400 hover:underline flex items-center gap-1">
							Ouvrir dans OSM
							<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
							</svg>
						</a>
					{/if}
				</div>
				{#if ev.location}
					<div class="px-5 py-2.5 text-sm text-gray-400 bg-gray-900/80 border-b border-gray-800 flex items-center gap-2">
						<svg class="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
						</svg>
						{ev.location}
					</div>
				{/if}
				<div class="h-64">
					<iframe src={osmEmbedUrl()} class="w-full h-full border-0" title="Carte du lieu" loading="lazy"></iframe>
				</div>
			</div>
		{:else if ev.location}
			<!-- Juste le texte du lieu sans carte -->
			<div class="rounded-2xl border border-gray-800 bg-gray-900/50 px-5 py-4">
				<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Lieu</h2>
				<div class="flex items-start gap-3 text-sm text-gray-300">
					<svg class="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
					</svg>
					{#if ev.location.startsWith('http')}
						<a href={ev.location} target="_blank" rel="noopener" class="text-emerald-400 hover:underline break-all">{ev.location}</a>
					{:else}
						<span>{ev.location}</span>
					{/if}
				</div>
				{#if osmLinkUrl()}
					<a href={osmLinkUrl()} target="_blank" rel="noopener"
					   class="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-emerald-400 transition-colors">
						<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
						Voir sur OpenStreetMap
					</a>
				{/if}
			</div>
		{/if}

		<!-- Participants -->
		{#if ev.rsvp_enabled && data.attendees?.length > 0}
			<div class="rounded-2xl border border-gray-800 bg-gray-900/50 px-5 py-5">
				<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
					Participants
					<span class="ml-2 px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-xs font-normal">{data.attendees.length}</span>
				</h2>
				<div class="flex flex-wrap gap-2">
					{#each data.attendees as a}
						<a href="/users/{a.username}"
						   class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-800 border border-gray-700/50 hover:border-gray-600 transition-colors"
						   title="{a.username} — {a.status === 'going' ? 'participe' : a.status === 'maybe' ? 'peut-être' : 'absent'}">
							{#if a.avatar_url}
								<img src={a.avatar_url} alt="" class="w-5 h-5 rounded-full object-cover"/>
							{:else}
								<div class="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400 font-medium">
									{a.username[0].toUpperCase()}
								</div>
							{/if}
							<span class="text-xs text-gray-300">{a.username}</span>
							{#if a.status === 'maybe'}
								<span class="text-[10px] text-amber-500 font-bold">?</span>
							{/if}
						</a>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- ── SIDEBAR ────────────────────────────────────────────────────────── -->
	<aside class="space-y-4">

		<!-- Carte date + heure -->
		<div class="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
			<!-- Pastille date grand format -->
			<div class="bg-emerald-600/20 border-b border-emerald-800/40 px-5 py-4 flex items-center gap-4">
				<div class="flex-shrink-0 w-14 h-14 rounded-xl bg-emerald-600/30 border border-emerald-500/40 flex flex-col items-center justify-center">
					<span class="text-emerald-300 text-[10px] font-bold uppercase tracking-wider">{monthShort(ev.starts_at)}</span>
					<span class="text-white text-2xl font-bold leading-none">{dayNum(ev.starts_at)}</span>
				</div>
				<div>
					<p class="text-white font-semibold text-sm capitalize">{fDate(ev.starts_at)}</p>
					{#if !ev.is_all_day}
						<p class="text-emerald-300 text-sm mt-0.5">{fTime(ev.starts_at)}{ev.ends_at ? ` – ${fTime(ev.ends_at)}` : ''}</p>
					{:else}
						<p class="text-emerald-300 text-xs mt-0.5">Toute la journée</p>
					{/if}
					{#if ev.ends_at && new Date(ev.starts_at).toDateString() !== new Date(ev.ends_at).toDateString()}
						<p class="text-gray-400 text-xs mt-1">→ {fDateShort(ev.ends_at)}</p>
					{/if}
				</div>
			</div>

			<!-- Infos rapides -->
			<div class="px-5 py-4 space-y-3">
				{#if ev.author_name}
					<div class="flex items-center gap-2.5 text-sm">
						<svg class="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
						</svg>
						<span class="text-gray-400">Organisé par</span>
						<a href="/users/{ev.author_name}" class="text-gray-200 hover:text-emerald-300 transition-colors font-medium">{ev.author_name}</a>
					</div>
				{/if}

				{#if ev.rsvp_enabled}
					<div class="flex items-center gap-2.5 text-sm">
						<svg class="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/>
						</svg>
						<span class="text-gray-400">{ev.going_count} participant{ev.going_count !== 1 ? 's' : ''}</span>
						{#if ev.max_attendees}
							<span class="text-gray-600 text-xs">/ {ev.max_attendees} max</span>
						{/if}
					</div>

					{#if ev.max_attendees}
						<!-- Barre de capacité -->
						<div class="w-full bg-gray-800 rounded-full h-1.5">
							<div class="h-1.5 rounded-full transition-all {capacityPct() >= 90 ? 'bg-red-500' : capacityPct() >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}"
							     style="width: {capacityPct()}%"></div>
						</div>
						{#if isFull()}
							<p class="text-xs text-red-400 font-medium">Complet</p>
						{/if}
					{/if}
				{/if}
			</div>
		</div>

		<!-- Billetterie -->
		{#if ev.ticket_price !== null && ev.ticket_price !== undefined}
			<div class="rounded-2xl border border-gray-800 bg-gray-900/60 px-5 py-4">
				<div class="flex items-center justify-between mb-3">
					<h3 class="text-sm font-semibold text-gray-300">Billet</h3>
					<span class="text-xl font-bold {ev.ticket_price === 0 ? 'text-emerald-400' : 'text-white'}">
						{formatPrice(ev.ticket_price, ev.ticket_currency ?? 'EUR')}
					</span>
				</div>
				{#if ev.ticket_url && ev.ticket_price > 0 && !isPast(ev.starts_at) && !ev.is_cancelled}
					<a href={ev.ticket_url} target="_blank" rel="noopener"
					   class="block w-full py-3 text-center rounded-xl bg-emerald-600 hover:bg-emerald-500
					          text-white font-semibold text-sm transition-colors">
						Acheter un billet →
					</a>
				{:else if ev.ticket_price === 0}
					<p class="text-xs text-gray-500">Entrée libre</p>
				{/if}
			</div>
		{/if}

		<!-- RSVP -->
		{#if ev.rsvp_enabled && !isPast(ev.starts_at) && !ev.is_cancelled && data.token}
			<div class="rounded-2xl border border-gray-800 bg-gray-900/60 px-5 py-4">
				<h3 class="text-sm font-semibold text-gray-300 mb-3">Ma participation</h3>

				{#if me}
					<div class="mb-3 px-3 py-2 rounded-xl border text-xs font-medium text-center
					           {me === 'going' ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300'
					           : me === 'maybe' ? 'bg-amber-900/30 border-amber-700/40 text-amber-300'
					           : 'bg-gray-800 border-gray-700 text-gray-400'}">
						{me === 'going' ? '✓ Je participe' : me === 'maybe' ? '? Peut-être' : '✗ Je ne peux pas'}
					</div>
				{/if}

				{#if !isFull() || me === 'going'}
					<div class="space-y-2">
						{#each [['going','Je participe','bg-emerald-600 hover:bg-emerald-500'], ['maybe',"Peut-être",'bg-amber-600/80 hover:bg-amber-500'], ['not_going','Je ne peux pas','bg-gray-700 hover:bg-gray-600']] as [status, label, cls]}
							<form method="POST" action="?/rsvp" use:enhance>
								<input type="hidden" name="status" value={status}/>
								<button type="submit"
								        class="w-full py-2.5 rounded-xl text-xs font-medium transition-colors text-white
								               {me === status ? `${cls} ring-2 ring-white/20` : 'bg-gray-800 hover:bg-gray-700 border border-gray-700'}">
									{label}
								</button>
							</form>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-red-400 text-center py-2">Événement complet</p>
				{/if}

				{#if me}
					<form method="POST" action="?/cancelRsvp" use:enhance class="mt-2">
						<button type="submit" class="w-full py-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors">
							Annuler ma participation
						</button>
					</form>
				{/if}
			</div>
		{/if}

		<!-- Actions admin (auteur + admin/modo) -->
		{#if ev.can_manage}
			<div class="rounded-2xl border border-gray-800 bg-gray-900/50 px-5 py-4 space-y-2">
				<h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Modération</h3>

				<a href="/calendar/{ev.id}/edit"
				   class="flex items-center justify-center gap-2 w-full py-2 rounded-xl border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 text-xs transition-colors">
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
					</svg>
					Modifier l'événement
				</a>

				{#if !ev.is_cancelled}
					<form method="POST" action="?/cancelEvent" use:enhance class="w-full">
						<button type="submit"
						        class="w-full py-2 rounded-xl border border-amber-800/40 text-amber-400 hover:bg-amber-950/30 text-xs transition-colors">
							Annuler l'événement
						</button>
					</form>
				{:else}
					<form method="POST" action="?/uncancelEvent" use:enhance class="w-full">
						<button type="submit"
						        class="w-full py-2 rounded-xl border border-emerald-800/40 text-emerald-400 hover:bg-emerald-950/30 text-xs transition-colors">
							Rétablir l'événement
						</button>
					</form>
				{/if}

				<form method="POST" action="?/deleteEvent" use:enhance={() => {
					deleting = true;
					return async () => { await goto('/calendar'); };
				}} class="w-full">
					<button type="submit" disabled={deleting}
					        class="w-full py-2 rounded-xl border border-red-800/40 text-red-400 hover:bg-red-950/30 text-xs transition-colors disabled:opacity-50">
						{deleting ? 'Suppression...' : 'Supprimer définitivement'}
					</button>
				</form>
			</div>
		{/if}

	</aside>
</div>
