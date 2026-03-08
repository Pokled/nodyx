<script lang="ts">
	import { enhance } from '$app/forms';
	import { PUBLIC_API_URL } from '$env/static/public';
	import NexusEditor from '$lib/components/editor/NexusEditor.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting    = $state(false);
	let coverPreview  = $state<string | null>(null);
	let coverUrl      = $state('');
	let uploadingCover = $state(false);

	// Date par défaut = demain à 18h
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(18, 0, 0, 0);
	const defaultStart = tomorrow.toISOString().slice(0, 16);
	const defaultEnd   = new Date(tomorrow.getTime() + 2 * 3600_000).toISOString().slice(0, 16);

	let isAllDay    = $state(false);
	let rsvpEnabled = $state(false);
	let isPublic    = $state(true);
	let hasTicket   = $state(false);
	let currency    = $state('EUR');

	// Géolocalisation
	let locationText = $state('');
	let lat = $state('');
	let lng = $state('');

	// Construction URL embed OSM pour prévisualisation
	const osmPreviewUrl = $derived(() => {
		const la = parseFloat(lat);
		const lo = parseFloat(lng);
		if (!lat || !lng || isNaN(la) || isNaN(lo)) return null;
		const d = 0.02;
		return `https://www.openstreetmap.org/export/embed.html?bbox=${lo-d},${la-d},${lo+d},${la+d}&layer=mapnik&marker=${la},${lo}`;
	});

	// Upload cover image
	async function onCoverChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file  = input.files?.[0];
		if (!file) return;

		// Preview local instantané
		const reader = new FileReader();
		reader.onload = ev => { coverPreview = ev.target?.result as string; };
		reader.readAsDataURL(file);

		// Upload vers /api/v1/assets
		uploadingCover = true;
		try {
			const fd = new FormData();
			fd.append('name',        file.name.replace(/\.[^.]+$/, ''));
			fd.append('description', '');
			fd.append('asset_type',  'image');
			fd.append('is_public',   'true');
			fd.append('file',        file);

			const res = await fetch(`${PUBLIC_API_URL}/api/v1/assets`, {
				method:  'POST',
				headers: data.token ? { Authorization: `Bearer ${data.token}` } : {},
				body:    fd,
			});
			if (res.ok) {
				const json = await res.json();
				const base = PUBLIC_API_URL.replace('/api/v1', '');
				coverUrl = `${base}/uploads/${json.asset?.file_path ?? ''}`;
			}
		} finally {
			uploadingCover = false;
		}
	}

	// Géolocalisation navigateur
	function geolocate() {
		if (!navigator.geolocation) return;
		navigator.geolocation.getCurrentPosition(pos => {
			lat = pos.coords.latitude.toFixed(6);
			lng = pos.coords.longitude.toFixed(6);
		});
	}

	// Lien OSM pour trouver les coordonnées
	const osmSearchUrl = $derived(() => {
		if (!locationText) return 'https://www.openstreetmap.org/';
		return `https://nominatim.openstreetmap.org/ui/search.html?q=${encodeURIComponent(locationText)}`;
	});

	const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'BRL'];
</script>

<svelte:head>
	<title>Créer un événement</title>
</svelte:head>

<div class="max-w-3xl mx-auto">
	<a href="/calendar" class="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1.5 mb-5">
		<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
		</svg>
		Retour au calendrier
	</a>

	<h1 class="text-2xl font-bold text-white mb-1">Créer un événement</h1>
	<p class="text-gray-500 text-sm mb-7">Planifiez et partagez un événement avec la communauté.</p>

	{#if form?.error}
		<div class="mb-6 rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-red-300 text-sm">{form.error}</div>
	{/if}

	<form method="POST" use:enhance={() => {
		submitting = true;
		return async ({ update }) => { await update(); submitting = false; };
	}} class="space-y-8">

		<!-- ── COVER IMAGE ───────────────────────────────────────────────────── -->
		<section>
			<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Image de couverture</h2>
			<div class="relative">
				<!-- Zone de drop / preview -->
				<label class="block relative cursor-pointer group">
					{#if coverPreview}
						<img src={coverPreview} alt="Aperçu" class="w-full h-52 object-cover rounded-xl border border-gray-700"/>
						<div class="absolute inset-0 bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
							<span class="text-white text-sm">Changer l'image</span>
						</div>
					{:else}
						<div class="w-full h-40 rounded-xl border-2 border-dashed border-gray-700 bg-gray-800/40
						           flex flex-col items-center justify-center gap-2
						           group-hover:border-emerald-600/60 group-hover:bg-gray-800/60 transition-all">
							{#if uploadingCover}
								<svg class="w-6 h-6 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
								</svg>
							{:else}
								<svg class="w-8 h-8 text-gray-500 group-hover:text-emerald-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zM4.5 19.5h15"/>
								</svg>
								<span class="text-gray-500 text-xs group-hover:text-gray-300 transition-colors">Cliquez ou glissez une image (PNG, JPG, WebP)</span>
							{/if}
						</div>
					{/if}
					<input type="file" accept="image/*" onchange={onCoverChange} class="sr-only"/>
				</label>
				<!-- Champ caché envoyé au serveur -->
				<input type="hidden" name="cover_url" value={coverUrl}/>
			</div>
		</section>

		<!-- ── INFORMATIONS ESSENTIELLES ─────────────────────────────────────── -->
		<section class="space-y-4">
			<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Informations</h2>

			<!-- Titre -->
			<div>
				<label for="title" class="block text-sm font-medium text-gray-300 mb-1.5">Titre <span class="text-red-400">*</span></label>
				<input id="title" name="title" type="text" required
				       placeholder="Concert, game jam, réunion mensuelle..."
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
			</div>

			<!-- Dates -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label for="starts_at" class="block text-sm font-medium text-gray-300 mb-1.5">Début <span class="text-red-400">*</span></label>
					<input id="starts_at" name="starts_at" type="{isAllDay ? 'date' : 'datetime-local'}" required
					       value={isAllDay ? defaultStart.slice(0,10) : defaultStart}
					       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
					              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors [color-scheme:dark]"/>
				</div>
				<div>
					<label for="ends_at" class="block text-sm font-medium text-gray-300 mb-1.5">Fin <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
					<input id="ends_at" name="ends_at" type="{isAllDay ? 'date' : 'datetime-local'}"
					       value={isAllDay ? defaultEnd.slice(0,10) : defaultEnd}
					       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
					              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors [color-scheme:dark]"/>
				</div>
			</div>

			<!-- Checkboxes -->
			<div class="flex flex-wrap gap-5">
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input type="checkbox" bind:checked={isAllDay} class="w-4 h-4 rounded border-gray-600 accent-emerald-500"/>
					<input type="hidden" name="is_all_day" value={isAllDay ? 'true' : 'false'}/>
					<span class="text-sm text-gray-300">Toute la journée</span>
				</label>
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input type="checkbox" bind:checked={isPublic} class="w-4 h-4 rounded border-gray-600 accent-emerald-500"/>
					<input type="hidden" name="is_public" value={isPublic ? 'true' : 'false'}/>
					<span class="text-sm text-gray-300">Événement public</span>
				</label>
			</div>

			<!-- Tags -->
			<div>
				<label for="tags" class="block text-sm font-medium text-gray-300 mb-1.5">Tags <span class="text-gray-600 text-xs font-normal">(virgule-séparés)</span></label>
				<input id="tags" name="tags" type="text" placeholder="musique, jeux, irl, dev..."
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
			</div>
		</section>

		<!-- ── DESCRIPTION (NexusEditor) ─────────────────────────────────────── -->
		<section>
			<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Description</h2>
			<NexusEditor
				name="description"
				placeholder="Décrivez l'événement — programme, accès, ce qu'il faut apporter..."
			/>
		</section>

		<!-- ── LIEU & CARTE ───────────────────────────────────────────────────── -->
		<section class="space-y-4">
			<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Lieu</h2>

			<div>
				<label for="location" class="block text-sm font-medium text-gray-300 mb-1.5">Adresse / nom du lieu <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
				<input id="location" name="location" type="text" bind:value={locationText}
				       placeholder="Parc de la Villette, Paris — ou https://meet.jit.si/monEvent"
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
			</div>

			<!-- Coordonnées OSM -->
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3">
				<div class="flex items-center justify-between">
					<p class="text-xs font-medium text-gray-400">Coordonnées GPS <span class="text-gray-600">(pour afficher la carte)</span></p>
					<div class="flex gap-2">
						<button type="button" onclick={geolocate}
						        class="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors flex items-center gap-1">
							<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zM2 13h2M20 13h2M13 2v2M13 20v2"/>
							</svg>
							Ma position
						</button>
						{#if locationText}
							<a href={osmSearchUrl()} target="_blank" rel="noopener"
							   class="text-xs px-3 py-1.5 rounded-lg border border-emerald-800/40 text-emerald-400 hover:bg-emerald-950/30 transition-colors">
								Chercher sur OSM →
							</a>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs text-gray-500 mb-1">Latitude</label>
						<input type="number" name="location_lat" bind:value={lat} step="any"
						       placeholder="48.8584"
						       class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
						              focus:outline-none focus:border-emerald-500 transition-colors"/>
					</div>
					<div>
						<label class="block text-xs text-gray-500 mb-1">Longitude</label>
						<input type="number" name="location_lng" bind:value={lng} step="any"
						       placeholder="2.2945"
						       class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
						              focus:outline-none focus:border-emerald-500 transition-colors"/>
					</div>
				</div>

				<!-- Preview carte OSM -->
				{#if osmPreviewUrl()}
					<div class="rounded-lg overflow-hidden border border-gray-700 h-44">
						<iframe
							src={osmPreviewUrl()}
							class="w-full h-full border-0"
							title="Aperçu carte"
							loading="lazy"
						></iframe>
					</div>
				{:else}
					<p class="text-xs text-gray-600">Entrez les coordonnées pour voir un aperçu de la carte OpenStreetMap.</p>
				{/if}
			</div>
		</section>

		<!-- ── BILLETTERIE ────────────────────────────────────────────────────── -->
		<section class="space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Billetterie</h2>
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input type="checkbox" bind:checked={hasTicket} class="w-4 h-4 rounded border-gray-600 accent-emerald-500"/>
					<span class="text-sm text-gray-400">Événement payant</span>
				</label>
			</div>

			{#if hasTicket}
				<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label for="ticket_price" class="block text-sm font-medium text-gray-300 mb-1.5">Prix du billet</label>
							<div class="relative">
								<input id="ticket_price" name="ticket_price" type="number" min="0" step="0.01"
								       placeholder="9.90"
								       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm pr-16
								              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
								<select name="ticket_currency" bind:value={currency}
								        class="absolute right-2 top-1/2 -translate-y-1/2 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-xs text-white">
									{#each CURRENCIES as c}
										<option value={c}>{c}</option>
									{/each}
								</select>
							</div>
						</div>
						<div>
							<label for="max_att" class="block text-sm font-medium text-gray-300 mb-1.5">Places disponibles <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
							<input id="max_att" name="max_attendees" type="number" min="1" placeholder="Illimité"
							       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
							              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
						</div>
					</div>
					<div>
						<label for="ticket_url" class="block text-sm font-medium text-gray-300 mb-1.5">Lien d'achat <span class="text-gray-600 text-xs font-normal">(Eventbrite, HelloAsso, etc.)</span></label>
						<input id="ticket_url" name="ticket_url" type="url"
						       placeholder="https://..."
						       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
						              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
					</div>
				</div>
			{:else}
				<input type="hidden" name="ticket_price" value=""/>
				<p class="text-xs text-gray-600">L'événement est gratuit. Activez l'option ci-dessus pour ajouter un prix.</p>
			{/if}
		</section>

		<!-- ── RSVP ───────────────────────────────────────────────────────────── -->
		<section class="space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Participation</h2>
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input type="checkbox" bind:checked={rsvpEnabled} class="w-4 h-4 rounded border-gray-600 accent-emerald-500"/>
					<input type="hidden" name="rsvp_enabled" value={rsvpEnabled ? 'true' : 'false'}/>
					<span class="text-sm text-gray-400">Activer les RSVPs</span>
				</label>
			</div>
			{#if rsvpEnabled && !hasTicket}
				<div>
					<label class="block text-sm font-medium text-gray-300 mb-1.5">Places max <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
					<input name="max_attendees" type="number" min="1" placeholder="Illimité"
					       class="w-36 bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
					              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
				</div>
			{/if}
		</section>

		<!-- ── ACTIONS ────────────────────────────────────────────────────────── -->
		<div class="flex items-center gap-3 pt-2 pb-8">
			<button type="submit" disabled={submitting || uploadingCover}
			        class="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
			               text-white font-semibold text-sm transition-colors">
				{submitting ? 'Création...' : "Créer l'événement"}
			</button>
			<a href="/calendar"
			   class="px-5 py-3.5 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 text-sm transition-colors">
				Annuler
			</a>
		</div>
	</form>
</div>
