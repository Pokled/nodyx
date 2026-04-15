<script lang="ts">
	import { enhance } from '$app/forms';
	import { PUBLIC_API_URL } from '$env/static/public';
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte';
	import type { PageData, ActionData } from './$types';
	import { untrack } from 'svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ev = untrack(() => data.event);

	let submitting     = $state(false);
	let coverPreview   = $state<string | null>(ev.cover_url ?? null);
	let coverUrl       = $state(ev.cover_url ?? '');
	let uploadingCover = $state(false);
	let uploadError    = $state<string | null>(null);

	// Dates → format datetime-local (YYYY-MM-DDTHH:mm)
	function toLocal(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toISOString().slice(0, 16);
	}
	function toDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toISOString().slice(0, 10);
	}

	let isAllDay    = $state(ev.is_all_day   ?? false);
	let rsvpEnabled = $state(ev.rsvp_enabled ?? false);
	let isPublic    = $state(ev.is_public    ?? true);
	let currency    = $state(ev.ticket_currency ?? 'EUR');
	let hasTicket   = $state(ev.ticket_price !== null && ev.ticket_price !== undefined);

	// Lieu
	let locationText = $state(ev.location ?? '');
	let lat = $state(ev.location_lat ? String(ev.location_lat) : '');
	let lng = $state(ev.location_lng ? String(ev.location_lng) : '');

	const osmPreviewUrl = $derived(() => {
		const la = parseFloat(lat);
		const lo = parseFloat(lng);
		if (!lat || !lng || isNaN(la) || isNaN(lo)) return null;
		const d = 0.02;
		return `https://www.openstreetmap.org/export/embed.html?bbox=${lo-d},${la-d},${lo+d},${la+d}&layer=mapnik&marker=${la},${lo}`;
	});

	async function onCoverChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file  = input.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = ev => { coverPreview = ev.target?.result as string; };
		reader.readAsDataURL(file);

		uploadingCover = true;
		uploadError    = null;
		try {
			const fd = new FormData();
			fd.append('name',        file.name.replace(/\.[^.]+$/, ''));
			fd.append('description', '');
			fd.append('asset_type',  'banner');
			fd.append('is_public',   'true');
			fd.append('file',        file);

			const res = await fetch(`${PUBLIC_API_URL}/api/v1/assets`, {
				method:  'POST',
				headers: data.token ? { Authorization: `Bearer ${data.token}` } : {},
				body:    fd,
			});
			if (res.ok) {
				const json = await res.json();
				coverUrl = `${PUBLIC_API_URL}/uploads/${json.asset?.file_path ?? ''}`;
			} else {
				const json = await res.json().catch(() => ({}));
				uploadError = json.error ?? `Erreur ${res.status} lors de l'upload`;
				coverPreview = null;
			}
		} catch (err) {
			uploadError = "Erreur réseau lors de l'upload";
			coverPreview = null;
		} finally {
			uploadingCover = false;
		}
	}

	function geolocate() {
		if (!navigator.geolocation) return;
		navigator.geolocation.getCurrentPosition(pos => {
			lat = pos.coords.latitude.toFixed(6);
			lng = pos.coords.longitude.toFixed(6);
		});
	}

	const osmSearchUrl = $derived(() => {
		if (!locationText) return 'https://www.openstreetmap.org/';
		return `https://nominatim.openstreetmap.org/ui/search.html?q=${encodeURIComponent(locationText)}`;
	});

	const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'BRL'];
</script>

<svelte:head>
	<title>Modifier — {ev.title}</title>
</svelte:head>

<div class="max-w-3xl mx-auto">
	<a href="/calendar/{ev.id}" class="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1.5 mb-5">
		<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
		</svg>
		Retour à l'événement
	</a>

	<h1 class="text-2xl font-bold text-white mb-1">Modifier l'événement</h1>
	<p class="text-gray-500 text-sm mb-7">Les modifications seront visibles immédiatement.</p>

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
								<span class="text-gray-500 text-xs group-hover:text-gray-300 transition-colors">Cliquez ou glissez une image</span>
							{/if}
						</div>
					{/if}
					<input type="file" accept="image/*" onchange={onCoverChange} class="sr-only"/>
				</label>
				{#if uploadError}
					<p class="mt-2 text-xs text-red-400">{uploadError}</p>
				{/if}
				{#if coverPreview && coverUrl !== (ev.cover_url ?? '')}
					<button type="button" onclick={() => { coverPreview = null; coverUrl = ''; uploadError = null; }}
					        class="mt-2 text-xs text-red-400 hover:text-red-300 transition-colors">
						Supprimer l'image
					</button>
				{/if}
				<input type="hidden" name="cover_url" value={coverUrl}/>
			</div>
		</section>

		<!-- ── INFORMATIONS ───────────────────────────────────────────────────── -->
		<section class="space-y-4">
			<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Informations</h2>

			<div>
				<label for="title" class="block text-sm font-medium text-gray-300 mb-1.5">Titre <span class="text-red-400">*</span></label>
				<input id="title" name="title" type="text" required value={ev.title}
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label for="starts_at" class="block text-sm font-medium text-gray-300 mb-1.5">Début <span class="text-red-400">*</span></label>
					<input id="starts_at" name="starts_at" type="{isAllDay ? 'date' : 'datetime-local'}" required
					       value={isAllDay ? toDate(ev.starts_at) : toLocal(ev.starts_at)}
					       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
					              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors [color-scheme:dark]"/>
				</div>
				<div>
					<label for="ends_at" class="block text-sm font-medium text-gray-300 mb-1.5">Fin <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
					<input id="ends_at" name="ends_at" type="{isAllDay ? 'date' : 'datetime-local'}"
					       value={isAllDay ? toDate(ev.ends_at) : toLocal(ev.ends_at)}
					       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
					              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors [color-scheme:dark]"/>
				</div>
			</div>

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

			<div>
				<label for="tags" class="block text-sm font-medium text-gray-300 mb-1.5">Tags <span class="text-gray-600 text-xs font-normal">(virgule-séparés)</span></label>
				<input id="tags" name="tags" type="text" value={ev.tags?.join(', ') ?? ''}
				       placeholder="musique, jeux, irl, dev..."
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
			</div>
		</section>

		<!-- ── DESCRIPTION ────────────────────────────────────────────────────── -->
		<section>
			<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Description</h2>
			<NodyxEditor
				name="description"
				placeholder="Décrivez l'événement — programme, accès, ce qu'il faut apporter..."
				initialContent={ev.description ?? ''}
			/>
		</section>

		<!-- ── LIEU ───────────────────────────────────────────────────────────── -->
		<section class="space-y-4">
			<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Lieu</h2>

			<div>
				<label for="location" class="block text-sm font-medium text-gray-300 mb-1.5">Adresse / nom du lieu <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
				<input id="location" name="location" type="text" bind:value={locationText}
				       placeholder="Parc de la Villette, Paris — ou https://meet.jit.si/monEvent"
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
			</div>

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
						<label for="edit-location-lat" class="block text-xs text-gray-500 mb-1">Latitude</label>
						<input id="edit-location-lat" type="number" name="location_lat" bind:value={lat} step="any"
						       placeholder="48.8584"
						       class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
						              focus:outline-none focus:border-emerald-500 transition-colors"/>
					</div>
					<div>
						<label for="edit-location-lng" class="block text-xs text-gray-500 mb-1">Longitude</label>
						<input id="edit-location-lng" type="number" name="location_lng" bind:value={lng} step="any"
						       placeholder="2.2945"
						       class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
						              focus:outline-none focus:border-emerald-500 transition-colors"/>
					</div>
				</div>

				{#if osmPreviewUrl()}
					<div class="rounded-lg overflow-hidden border border-gray-700 h-44">
						<iframe src={osmPreviewUrl()} class="w-full h-full border-0" title="Aperçu carte" loading="lazy"></iframe>
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
								       value={ev.ticket_price ?? ''}
								       placeholder="9.90"
								       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm pr-16
								              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
								<select name="ticket_currency" bind:value={currency}
								        class="absolute right-2 top-1/2 -translate-y-1/2 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-xs text-white">
									{#each CURRENCIES as c}
										<option value={c} selected={c === currency}>{c}</option>
									{/each}
								</select>
							</div>
						</div>
						<div>
							<label for="max_att" class="block text-sm font-medium text-gray-300 mb-1.5">Places disponibles <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
							<input id="max_att" name="max_attendees" type="number" min="1"
							       value={ev.max_attendees ?? ''}
							       placeholder="Illimité"
							       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
							              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
						</div>
					</div>
					<div>
						<label for="ticket_url" class="block text-sm font-medium text-gray-300 mb-1.5">Lien d'achat <span class="text-gray-600 text-xs font-normal">(Eventbrite, HelloAsso, etc.)</span></label>
						<input id="ticket_url" name="ticket_url" type="url"
						       value={ev.ticket_url ?? ''}
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
					<label for="edit-max-att-rsvp" class="block text-sm font-medium text-gray-300 mb-1.5">Places max <span class="text-gray-600 text-xs font-normal">(optionnel)</span></label>
					<input id="edit-max-att-rsvp" name="max_attendees" type="number" min="1"
					       value={ev.max_attendees ?? ''}
					       placeholder="Illimité"
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
				{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}
			</button>
			<a href="/calendar/{ev.id}"
			   class="px-5 py-3.5 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 text-sm transition-colors">
				Annuler
			</a>
		</div>
	</form>
</div>
