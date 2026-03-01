<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

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
		// Submit after state update
		setTimeout(() => reorderForm?.requestSubmit(), 0);
	}

	let name        = $state('');
	let description = $state('');
</script>

<svelte:head><title>Canaux texte — Admin Nexus</title></svelte:head>

<div class="space-y-8">

	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Canaux textuels</h1>
		<p class="text-sm text-gray-500">Canaux de discussion en temps réel (Socket.IO). Les membres y accèdent via le menu Chat.</p>
	</div>

	<!-- Error / success -->
	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}

	<!-- Hidden reorder form -->
	<form
		bind:this={reorderForm}
		method="POST"
		action="?/reorder"
		use:enhance
		class="hidden"
	>
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
					<li class="flex items-center gap-3 px-5 py-3">
						<!-- Position controls -->
						<div class="flex flex-col gap-0.5 shrink-0">
							<button
								type="button"
								onclick={() => moveChannel(i, -1)}
								disabled={i === 0}
								class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1"
								title="Monter"
							>▲</button>
							<button
								type="button"
								onclick={() => moveChannel(i, 1)}
								disabled={i === orderedChannels.length - 1}
								class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1"
								title="Descendre"
							>▼</button>
						</div>
						<span class="font-mono text-gray-400 text-sm shrink-0">#</span>
						<div class="flex-1 min-w-0">
							<p class="text-sm text-white font-medium truncate">{ch.name}</p>
							{#if ch.description}
								<p class="text-xs text-gray-500 truncate">{ch.description}</p>
							{/if}
						</div>
						<span class="text-xs text-gray-700 font-mono shrink-0">{ch.slug}</span>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="id" value={ch.id} />
							<button
								type="submit"
								class="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-900/20"
								onclick={(e) => { if (!confirm(`Supprimer #${ch.slug} ?`)) e.preventDefault() }}
							>
								Supprimer
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Create form -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
		<h2 class="text-sm font-semibold text-gray-300 mb-4">Créer un canal</h2>
		<form method="POST" action="?/create" use:enhance class="space-y-4">
			<div>
				<label for="name" class="block text-xs font-medium text-gray-400 mb-1">Nom <span class="text-red-500">*</span></label>
				<input
					id="name"
					name="name"
					type="text"
					maxlength="100"
					required
					placeholder="général"
					bind:value={name}
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
				/>
				<p class="text-xs text-gray-600 mt-1">Le slug sera généré automatiquement (ex: "Général" → "general").</p>
			</div>
			<div>
				<label for="description" class="block text-xs font-medium text-gray-400 mb-1">Description <span class="text-gray-600">(optionnel)</span></label>
				<input
					id="description"
					name="description"
					type="text"
					maxlength="500"
					placeholder="Discussions générales"
					bind:value={description}
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
				/>
			</div>
			<button
				type="submit"
				disabled={!name.trim()}
				class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
			>
				Créer le canal
			</button>
		</form>
	</div>
</div>
