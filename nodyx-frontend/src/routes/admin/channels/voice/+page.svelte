<script lang="ts">
	import type { PageData, ActionData } from './$types'
	import { enhance } from '$app/forms'
	import ChannelStyleEditor from '$lib/components/admin/ChannelStyleEditor.svelte'
	import ChannelIcon from '$lib/components/ChannelIcon.svelte'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let orderedChannels = $state<any[]>([])
	$effect(() => { orderedChannels = data.channels?.slice() ?? [] })

	let reorderForm = $state<HTMLFormElement | null>(null)
	let idsJson = $derived(JSON.stringify(orderedChannels.map((c: any) => c.id)))

	function moveChannel(index: number, dir: -1 | 1) {
		const target = index + dir
		if (target < 0 || target >= orderedChannels.length) return
		const copy = orderedChannels.slice()
		;[copy[index], copy[target]] = [copy[target], copy[index]]
		orderedChannels = copy
		setTimeout(() => reorderForm?.requestSubmit(), 0)
	}

	let name        = $state('')
	let description = $state('')
	let cName_color = $state<string | null>(null)
	let cName_bold  = $state(false)
	let cName_italic= $state(false)
	let cName_under = $state(false)
	let cIcon_emoji = $state<string | null>(null)

	let editingId = $state<string | null>(null)
	let eName        = $state('')
	let eDescription = $state('')
	let eName_color  = $state<string | null>(null)
	let eName_bold   = $state(false)
	let eName_italic = $state(false)
	let eName_under  = $state(false)
	let eIcon_emoji  = $state<string | null>(null)

	function startEdit(ch: any) {
		editingId    = ch.id
		eName        = ch.name ?? ''
		eDescription = ch.description ?? ''
		eName_color  = ch.name_color ?? null
		eName_bold   = !!ch.name_bold
		eName_italic = !!ch.name_italic
		eName_under  = !!ch.name_underline
		eIcon_emoji  = ch.icon_emoji ?? null
	}
	function cancelEdit() { editingId = null }
</script>

<svelte:head><title>{tFn('achvoice.page_title')}</title></svelte:head>

<div>
	<div class="flex items-center gap-3 mb-2">
		<h1 class="text-2xl font-bold text-white">{tFn('achvoice.title')}</h1>
		<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-green-900/40 text-green-300 border border-green-800/40">
			WebRTC P2P
		</span>
	</div>
	<p class="text-sm text-gray-500 mb-8">
		{tFn('achvoice.subtitle')}
	</p>

	{#if form?.error}
		<p class="mb-4 text-sm text-red-400 bg-red-900/30 border border-red-800/50 rounded-lg px-4 py-2">{form.error}</p>
	{/if}
	{#if form?.ok}
		<p class="mb-4 text-sm text-green-400 bg-green-900/30 border border-green-800/50 rounded-lg px-4 py-2">{tFn('achvoice.action_ok')}</p>
	{/if}

	<form bind:this={reorderForm} method="POST" action="?/reorder" use:enhance class="hidden">
		<input name="ids" value={idsJson} />
	</form>

	<!-- Liste des salons vocaux -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{tFn('achvoice.active_rooms')}</h2>

		{#if orderedChannels.length === 0}
			<p class="text-sm text-gray-600 italic py-4 text-center">
				{tFn('achvoice.empty')}
			</p>
		{:else}
			<div class="space-y-2">
				{#each orderedChannels as ch, i (ch.id)}
					<div class="rounded-lg bg-gray-800/60 border border-gray-700/60 overflow-hidden">
						<div class="flex items-center justify-between px-4 py-3">
							<div class="flex items-center gap-2 min-w-0 flex-1">
								<div class="flex flex-col gap-0.5 shrink-0">
									<button type="button" onclick={() => moveChannel(i, -1)} disabled={i === 0}
										class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1" title={tFn('achan.move_up')}>▲</button>
									<button type="button" onclick={() => moveChannel(i, 1)} disabled={i === orderedChannels.length - 1}
										class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1" title={tFn('achan.move_down')}>▼</button>
								</div>
								<span class="shrink-0 inline-flex items-center justify-center min-w-[24px]">
								<ChannelIcon value={ch.icon_emoji} fallback="🔊" size={20} color={ch.name_color ?? '#9ca3af'} />
							</span>
								<div class="min-w-0 flex-1">
									<p class="text-sm truncate"
										style="
											color: {ch.name_color ?? '#ffffff'};
											font-weight: {ch.name_bold ? '700' : '500'};
											font-style: {ch.name_italic ? 'italic' : 'normal'};
											text-decoration: {ch.name_underline ? 'underline' : 'none'};
										">{ch.name}</p>
									<p class="text-xs text-gray-500 font-mono">#{ch.slug}</p>
								</div>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								<button type="button"
									onclick={() => editingId === ch.id ? cancelEdit() : startEdit(ch)}
									class="text-xs text-gray-400 hover:text-indigo-400 hover:bg-indigo-900/20 px-3 py-1.5 rounded transition-colors">
									{editingId === ch.id ? tFn('achan.close') : tFn('achan.edit')}
								</button>
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={ch.id} />
									<button type="submit"
										class="text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 px-3 py-1.5 rounded transition-colors"
										onclick={(e) => { if (!confirm(tFn('achvoice.confirm_delete', { name: ch.name }))) e.preventDefault() }}>
										{tFn('achan.delete')}
									</button>
								</form>
							</div>
						</div>

						{#if editingId === ch.id}
							<div class="px-4 pb-4 pt-1 border-t border-gray-700/40 bg-gray-950/40">
								<form method="POST" action="?/update" use:enhance={() => async ({ result, update }) => {
									await update();
									if (result.type === 'success') editingId = null;
								}} class="space-y-4">
									<input type="hidden" name="id" value={ch.id} />
									<div class="grid sm:grid-cols-2 gap-3">
										<div>
											<label for={`v-name-${ch.id}`} class="block text-xs font-medium text-gray-400 mb-1">{tFn('achan.name')}</label>
											<input id={`v-name-${ch.id}`} name="name" type="text" maxlength="100" required bind:value={eName}
												class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600" />
										</div>
										<div>
											<label for={`v-desc-${ch.id}`} class="block text-xs font-medium text-gray-400 mb-1">{tFn('achan.description')}</label>
											<input id={`v-desc-${ch.id}`} name="description" type="text" maxlength="500" bind:value={eDescription}
												class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600" />
										</div>
									</div>

									<ChannelStyleEditor
										type="voice"
										bind:name={eName}
										bind:name_color={eName_color}
										bind:name_bold={eName_bold}
										bind:name_italic={eName_italic}
										bind:name_underline={eName_under}
										bind:icon_emoji={eIcon_emoji}
									/>

									<input type="hidden" name="name_color"     value={eName_color ?? ''} />
									<input type="hidden" name="name_bold"      value={eName_bold ? '1' : '0'} />
									<input type="hidden" name="name_italic"    value={eName_italic ? '1' : '0'} />
									<input type="hidden" name="name_underline" value={eName_under ? '1' : '0'} />
									<input type="hidden" name="icon_emoji"     value={eIcon_emoji ?? ''} />

									<div class="flex justify-end gap-2 pt-2">
										<button type="button" onclick={cancelEdit}
											class="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
											{tFn('achan.cancel')}
										</button>
										<button type="submit"
											class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors">
											{tFn('achan.save')}
										</button>
									</div>
								</form>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Créer un salon vocal -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{tFn('achvoice.create_title')}</h2>
		<form method="POST" action="?/create" use:enhance class="space-y-4">
			<div class="grid sm:grid-cols-2 gap-3">
				<div>
					<label for="v-new-name" class="block text-xs font-medium text-gray-400 mb-1">{tFn('achan.name')} <span class="text-red-500">*</span></label>
					<input id="v-new-name" type="text" name="name" required placeholder={tFn('achvoice.name_ph')} bind:value={name}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
				</div>
				<div>
					<label for="v-new-desc" class="block text-xs font-medium text-gray-400 mb-1">{tFn('achan.description')} <span class="text-gray-600">{tFn('achan.optional')}</span></label>
					<input id="v-new-desc" type="text" name="description" placeholder={tFn('achvoice.desc_ph')} bind:value={description}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
				</div>
			</div>

			<ChannelStyleEditor
				type="voice"
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
				class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors">
				{tFn('achvoice.create_btn')}
			</button>
		</form>
	</div>
</div>
