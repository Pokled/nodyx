<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let submitting = $state(false);

	// Date par défaut = demain à 18h
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(18, 0, 0, 0);
	const defaultStart = tomorrow.toISOString().slice(0, 16);
	const defaultEnd   = new Date(tomorrow.getTime() + 2 * 3600_000).toISOString().slice(0, 16);

	let isAllDay    = $state(false);
	let rsvpEnabled = $state(false);
	let isPublic    = $state(true);
</script>

<svelte:head>
	<title>Créer un événement</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<!-- En-tête -->
	<div class="mb-6">
		<a href="/calendar" class="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1.5 mb-4">
			<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
			</svg>
			Retour au calendrier
		</a>
		<h1 class="text-xl font-bold text-white">Créer un événement</h1>
		<p class="text-gray-500 text-sm mt-1">Planifiez et partagez un événement avec la communauté.</p>
	</div>

	{#if form?.error}
		<div class="mb-5 rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-red-300 text-sm">
			{form.error}
		</div>
	{/if}

	<form method="POST" use:enhance={() => {
		submitting = true;
		return async ({ update }) => { await update(); submitting = false; };
	}} class="space-y-5">

		<!-- Titre -->
		<div>
			<label for="title" class="block text-sm font-medium text-gray-300 mb-1.5">Titre <span class="text-red-400">*</span></label>
			<input id="title" name="title" type="text" required
			       placeholder="Concert, réunion mensuelle, game jam..."
			       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
			              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
		</div>

		<!-- Date / heure -->
		<div class="grid grid-cols-2 gap-4">
			<div>
				<label for="starts_at" class="block text-sm font-medium text-gray-300 mb-1.5">Début <span class="text-red-400">*</span></label>
				<input id="starts_at" name="starts_at" type="{isAllDay ? 'date' : 'datetime-local'}" required
				       value={isAllDay ? defaultStart.slice(0,10) : defaultStart}
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors
				              [color-scheme:dark]"/>
			</div>
			<div>
				<label for="ends_at" class="block text-sm font-medium text-gray-300 mb-1.5">Fin <span class="text-gray-600 text-xs">(optionnel)</span></label>
				<input id="ends_at" name="ends_at" type="{isAllDay ? 'date' : 'datetime-local'}"
				       value={isAllDay ? defaultEnd.slice(0,10) : defaultEnd}
				       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors
				              [color-scheme:dark]"/>
			</div>
		</div>

		<!-- Options rapides -->
		<div class="flex flex-wrap gap-4">
			<label class="flex items-center gap-2 cursor-pointer select-none">
				<input type="checkbox" bind:checked={isAllDay} class="w-4 h-4 rounded border-gray-600 accent-emerald-500"/>
				<input type="hidden" name="is_all_day" value={isAllDay ? 'true' : 'false'}/>
				<span class="text-sm text-gray-300">Toute la journée</span>
			</label>
			<label class="flex items-center gap-2 cursor-pointer select-none">
				<input type="checkbox" bind:checked={rsvpEnabled} class="w-4 h-4 rounded border-gray-600 accent-emerald-500"/>
				<input type="hidden" name="rsvp_enabled" value={rsvpEnabled ? 'true' : 'false'}/>
				<span class="text-sm text-gray-300">Activer les RSVPs</span>
			</label>
			<label class="flex items-center gap-2 cursor-pointer select-none">
				<input type="checkbox" bind:checked={isPublic} class="w-4 h-4 rounded border-gray-600 accent-emerald-500"/>
				<input type="hidden" name="is_public" value={isPublic ? 'true' : 'false'}/>
				<span class="text-sm text-gray-300">Événement public</span>
			</label>
		</div>

		{#if rsvpEnabled}
			<div>
				<label for="max_attendees" class="block text-sm font-medium text-gray-300 mb-1.5">
					Places max <span class="text-gray-600 text-xs">(laisser vide = illimité)</span>
				</label>
				<input id="max_attendees" name="max_attendees" type="number" min="1"
				       placeholder="Ex: 30"
				       class="w-32 bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
				              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
			</div>
		{/if}

		<!-- Lieu -->
		<div>
			<label for="location" class="block text-sm font-medium text-gray-300 mb-1.5">
				Lieu <span class="text-gray-600 text-xs">(optionnel)</span>
			</label>
			<input id="location" name="location" type="text"
			       placeholder="Salle des fêtes, Discord #vocal, https://meet.jit.si/..."
			       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
			              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
		</div>

		<!-- Description -->
		<div>
			<label for="description" class="block text-sm font-medium text-gray-300 mb-1.5">
				Description <span class="text-gray-600 text-xs">(optionnel)</span>
			</label>
			<textarea id="description" name="description" rows="5"
			          placeholder="Décrivez l'événement, le programme, ce qu'il faut apporter..."
			          class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
			                 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors resize-none">
			</textarea>
		</div>

		<!-- Tags -->
		<div>
			<label for="tags" class="block text-sm font-medium text-gray-300 mb-1.5">
				Tags <span class="text-gray-600 text-xs">(séparés par des virgules)</span>
			</label>
			<input id="tags" name="tags" type="text"
			       placeholder="musique, jeux, dev, irl..."
			       class="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm
			              focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"/>
		</div>

		<!-- Actions -->
		<div class="flex items-center gap-3 pt-2">
			<button type="submit" disabled={submitting}
			        class="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
			               text-white font-semibold text-sm transition-colors">
				{submitting ? 'Création...' : "Créer l'événement"}
			</button>
			<a href="/calendar"
			   class="px-5 py-3 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 text-sm transition-colors">
				Annuler
			</a>
		</div>
	</form>
</div>
