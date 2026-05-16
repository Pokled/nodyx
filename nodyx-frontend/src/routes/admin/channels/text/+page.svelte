<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import ChannelStyleEditor from '$lib/components/admin/ChannelStyleEditor.svelte';
	import ChannelIcon from '$lib/components/ChannelIcon.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let orderedChannels = $state<any[]>([]);
	$effect(() => { orderedChannels = data.channels?.slice() ?? []; });

	let reorderForm = $state<HTMLFormElement | null>(null);
	let idsJson = $derived(JSON.stringify(orderedChannels.map((c: any) => c.id)));

	function moveChannel(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= orderedChannels.length) return;
		const copy = orderedChannels.slice();
		[copy[index], copy[target]] = [copy[target], copy[index]];
		orderedChannels = copy;
		setTimeout(() => reorderForm?.requestSubmit(), 0);
	}

	// Create state
	let name           = $state('');
	let description    = $state('');
	let cName_color    = $state<string | null>(null);
	let cName_bold     = $state(false);
	let cName_italic   = $state(false);
	let cName_under    = $state(false);
	let cIcon_emoji    = $state<string | null>(null);

	// Edit state (per channel)
	let editingId = $state<string | null>(null);
	let eName           = $state('');
	let eDescription    = $state('');
	let eName_color     = $state<string | null>(null);
	let eName_bold      = $state(false);
	let eName_italic    = $state(false);
	let eName_under     = $state(false);
	let eIcon_emoji     = $state<string | null>(null);

	function startEdit(ch: any) {
		editingId      = ch.id;
		eName          = ch.name ?? '';
		eDescription   = ch.description ?? '';
		eName_color    = ch.name_color ?? null;
		eName_bold     = !!ch.name_bold;
		eName_italic   = !!ch.name_italic;
		eName_under    = !!ch.name_underline;
		eIcon_emoji    = ch.icon_emoji ?? null;
	}
	function cancelEdit() { editingId = null }
</script>

<svelte:head><title>Canaux texte — Admin Nodyx</title></svelte:head>

<div class="space-y-8">

	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Canaux textuels</h1>
		<p class="text-sm text-gray-500">Personnalise chaque canal (nom, couleur, style, icône) selon l'identité de ta communauté.</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}

	<form bind:this={reorderForm} method="POST" action="?/reorder" use:enhance class="hidden">
		<input name="ids" value={idsJson} />
	</form>

	<!-- Channel list -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40">
		<div class="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-gray-300">Canaux configurés</h2>
			<span class="text-xs text-gray-600">{orderedChannels.length} canal{orderedChannels.length !== 1 ? 'x' : ''}</span>
		</div>

		{#if orderedChannels.length === 0}
			<p class="px-5 py-8 text-sm text-gray-600 text-center italic">Aucun canal créé pour le moment.</p>
		{:else}
			<ul class="divide-y divide-gray-800">
				{#each orderedChannels as ch, i (ch.id)}
					<li>
						<div class="flex items-center gap-3 px-5 py-3">
							<div class="flex flex-col gap-0.5 shrink-0">
								<button type="button" onclick={() => moveChannel(i, -1)} disabled={i === 0}
									class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1" title="Monter">▲</button>
								<button type="button" onclick={() => moveChannel(i, 1)} disabled={i === orderedChannels.length - 1}
									class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1" title="Descendre">▼</button>
							</div>

							<span class="shrink-0 inline-flex items-center justify-center min-w-[18px]">
								<ChannelIcon value={ch.icon_emoji} fallback="#" size={16} color={ch.name_color ?? '#9ca3af'} />
							</span>

							<div class="flex-1 min-w-0">
								<p class="text-sm truncate"
									style="
										color: {ch.name_color ?? '#ffffff'};
										font-weight: {ch.name_bold ? '700' : '500'};
										font-style: {ch.name_italic ? 'italic' : 'normal'};
										text-decoration: {ch.name_underline ? 'underline' : 'none'};
									">{ch.name}</p>
								{#if ch.description}
									<p class="text-xs text-gray-500 truncate">{ch.description}</p>
								{/if}
							</div>

							<span class="text-xs text-gray-700 font-mono shrink-0">{ch.slug}</span>

							<button type="button"
								onclick={() => editingId === ch.id ? cancelEdit() : startEdit(ch)}
								class="text-xs text-gray-500 hover:text-indigo-400 transition-colors px-2 py-1 rounded hover:bg-indigo-900/20">
								{editingId === ch.id ? 'Fermer' : 'Modifier'}
							</button>

							<form method="POST" action="?/delete" use:enhance>
								<input type="hidden" name="id" value={ch.id} />
								<button type="submit"
									class="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-900/20"
									onclick={(e) => { if (!confirm(`Supprimer #${ch.slug} ?`)) e.preventDefault() }}>
									Supprimer
								</button>
							</form>
						</div>

						{#if editingId === ch.id}
							<div class="px-5 pb-5 pt-1 border-t border-gray-800 bg-gray-950/40">
								<form method="POST" action="?/update" use:enhance={() => async ({ result, update }) => {
									await update();
									if (result.type === 'success') editingId = null;
								}} class="space-y-4">
									<input type="hidden" name="id" value={ch.id} />
									<div class="grid sm:grid-cols-2 gap-3">
										<div>
											<label for={`name-${ch.id}`} class="block text-xs font-medium text-gray-400 mb-1">Nom</label>
											<input id={`name-${ch.id}`} name="name" type="text" maxlength="100" required bind:value={eName}
												class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600" />
										</div>
										<div>
											<label for={`desc-${ch.id}`} class="block text-xs font-medium text-gray-400 mb-1">Description</label>
											<input id={`desc-${ch.id}`} name="description" type="text" maxlength="500" bind:value={eDescription}
												class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600" />
										</div>
									</div>

									<ChannelStyleEditor
										type="text"
										bind:name={eName}
										bind:name_color={eName_color}
										bind:name_bold={eName_bold}
										bind:name_italic={eName_italic}
										bind:name_underline={eName_under}
										bind:icon_emoji={eIcon_emoji}
									/>

									<!-- Hidden fields to submit styling -->
									<input type="hidden" name="name_color"     value={eName_color ?? ''} />
									<input type="hidden" name="name_bold"      value={eName_bold ? '1' : '0'} />
									<input type="hidden" name="name_italic"    value={eName_italic ? '1' : '0'} />
									<input type="hidden" name="name_underline" value={eName_under ? '1' : '0'} />
									<input type="hidden" name="icon_emoji"     value={eIcon_emoji ?? ''} />

									<div class="flex justify-end gap-2 pt-2">
										<button type="button" onclick={cancelEdit}
											class="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
											Annuler
										</button>
										<button type="submit"
											class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors">
											Enregistrer
										</button>
									</div>
								</form>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Create form -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
		<h2 class="text-sm font-semibold text-gray-300 mb-4">Créer un canal</h2>
		<form method="POST" action="?/create" use:enhance class="space-y-4">
			<div class="grid sm:grid-cols-2 gap-3">
				<div>
					<label for="new-name" class="block text-xs font-medium text-gray-400 mb-1">Nom <span class="text-red-500">*</span></label>
					<input id="new-name" name="name" type="text" maxlength="100" required placeholder="général" bind:value={name}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600" />
				</div>
				<div>
					<label for="new-desc" class="block text-xs font-medium text-gray-400 mb-1">Description <span class="text-gray-600">(optionnel)</span></label>
					<input id="new-desc" name="description" type="text" maxlength="500" placeholder="Discussions générales" bind:value={description}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600" />
				</div>
			</div>

			<ChannelStyleEditor
				type="text"
				bind:name={name}
				bind:name_color={cName_color}
				bind:name_bold={cName_bold}
				bind:name_italic={cName_italic}
				bind:name_underline={cName_under}
				bind:icon_emoji={cIcon_emoji}
			/>

			<input type="hidden" name="name_color"     value={cName_color ?? ''} />
			<input type="hidden" name="name_bold"      value={cName_bold ? '1' : '0'} />
			<input type="hidden" name="name_italic"    value={cName_italic ? '1' : '0'} />
			<input type="hidden" name="name_underline" value={cName_under ? '1' : '0'} />
			<input type="hidden" name="icon_emoji"     value={cIcon_emoji ?? ''} />

			<button type="submit" disabled={!name.trim()}
				class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors">
				Créer le canal
			</button>
		</form>
	</div>
</div>
