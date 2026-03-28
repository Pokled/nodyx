<script lang="ts">
	import type { PageData } from './$types'
	import { MODULE_DISPLAY, FAMILY_META, FAMILY_ORDER, type ModuleFamily } from '$lib/modules'
	import { page } from '$app/stores'

	let { data }: { data: PageData } = $props()

	// ── State ─────────────────────────────────────────────────────────────────

	// Keyed by module id — live state (optimistic updates)
	let moduleState = $state<Record<string, boolean>>(
		Object.fromEntries(data.modules.map(m => [m.id, m.enabled]))
	)

	let saving   = $state<Record<string, boolean>>({})
	let toasts   = $state<Array<{ id: string; text: string; ok: boolean }>>([])
	let activeFamily = $state<ModuleFamily | 'all'>('all')

	// ── Computed ──────────────────────────────────────────────────────────────

	const enabledCount = $derived(
		Object.values(moduleState).filter(Boolean).length
	)

	const byFamily = $derived(() => {
		const map: Record<ModuleFamily, typeof data.modules> = {
			core: [], community: [], website: [], integration: [],
		}
		for (const m of data.modules) {
			map[m.family as ModuleFamily]?.push(m)
		}
		return map
	})

	const visibleFamilies = $derived(
		activeFamily === 'all'
			? FAMILY_ORDER
			: [activeFamily]
	)

	// ── Actions ───────────────────────────────────────────────────────────────

	async function toggle(id: string, currentlyEnabled: boolean) {
		if (saving[id]) return
		const display = MODULE_DISPLAY[id]
		if (display?.core) return              // core modules are locked
		if (display?.status === 'soon') return // not yet implemented

		// Optimistic update
		moduleState[id] = !currentlyEnabled
		saving[id]      = true

		try {
			const token = $page.data.token as string | null
			const res = await fetch(`/api/v1/admin/modules/${id}`, {
				method:  'PATCH',
				headers: {
					'Content-Type':  'application/json',
					'Authorization': `Bearer ${token}`,
				},
				body: JSON.stringify({ enabled: !currentlyEnabled }),
			})

			if (res.ok) {
				pushToast(`${display?.name ?? id} ${!currentlyEnabled ? 'activé' : 'désactivé'}`, true)
			} else {
				moduleState[id] = currentlyEnabled  // revert
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? 'Erreur lors de la mise à jour', false)
			}
		} catch {
			moduleState[id] = currentlyEnabled  // revert
			pushToast('Erreur réseau', false)
		} finally {
			saving[id] = false
		}
	}

	function pushToast(text: string, ok: boolean) {
		const id = crypto.randomUUID()
		toasts = [...toasts, { id, text, ok }]
		setTimeout(() => { toasts = toasts.filter(t => t.id !== id) }, 3000)
	}
</script>

<!-- ── Page ─────────────────────────────────────────────────────────────────── -->

<div class="max-w-5xl mx-auto space-y-8">

	<!-- Header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-xl font-bold text-white">Modules</h1>
			<p class="text-sm text-gray-400 mt-0.5">
				Activez ou désactivez les fonctionnalités de votre instance.
				Chaque communauté n'active que ce dont elle a besoin.
			</p>
		</div>
		<div class="shrink-0 flex items-center gap-2 bg-gray-800/60 border border-gray-700/50 rounded-xl px-4 py-2.5">
			<span class="text-2xl font-bold text-white tabular-nums">{enabledCount}</span>
			<span class="text-xs text-gray-400 leading-tight">modules<br>actifs</span>
		</div>
	</div>

	<!-- Family filter tabs -->
	<div class="flex gap-1 bg-gray-900/60 border border-gray-800 rounded-xl p-1 w-fit">
		<button
			onclick={() => activeFamily = 'all'}
			class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
			       {activeFamily === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}"
		>
			Tout
		</button>
		{#each FAMILY_ORDER as fam}
			{@const meta  = FAMILY_META[fam]}
			{@const count = (byFamily())[fam]?.filter(m => moduleState[m.id]).length ?? 0}
			<button
				onclick={() => activeFamily = fam}
				class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
				       {activeFamily === fam ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}"
			>
				{meta.label}
				{#if count > 0}
					<span class="text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold"
					      style="background:{meta.accent}22; color:{meta.accent}">
						{count}
					</span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Module sections -->
	{#each visibleFamilies as fam}
		{@const meta    = FAMILY_META[fam]}
		{@const modules = (byFamily())[fam] ?? []}
		{#if modules.length}
			<section>
				<!-- Section header -->
				<div class="flex items-center gap-3 mb-4">
					<div class="h-px flex-1 bg-gray-800"></div>
					<div class="flex items-center gap-2">
						<span class="text-xs font-bold uppercase tracking-widest"
						      style="color:{meta.accent}">{meta.label}</span>
						<span class="text-xs text-gray-600">— {meta.description}</span>
					</div>
					<div class="h-px flex-1 bg-gray-800"></div>
				</div>

				<!-- Cards grid -->
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{#each modules as mod}
						{@const display  = MODULE_DISPLAY[mod.id]}
						{@const enabled  = moduleState[mod.id] ?? false}
						{@const isCore   = display?.core ?? false}
						{@const isSoon   = display?.status === 'soon'}
						{@const isSaving = saving[mod.id] ?? false}

						<div
							class="relative rounded-xl border transition-all duration-200 overflow-hidden group
							       {isCore || isSoon
							         ? 'bg-gray-900/40 border-gray-800/60'
							         : enabled
							           ? 'bg-gray-900/80 border-gray-700/80 shadow-lg'
							           : 'bg-gray-900/30 border-gray-800/40'}"
							style={enabled && !isCore && !isSoon ? `box-shadow: 0 0 0 1px ${display?.color ?? '#7c3aed'}22, 0 4px 20px ${display?.color ?? '#7c3aed'}11` : ''}
						>
							<!-- Enabled glow bar -->
							{#if enabled && !isCore && !isSoon}
								<div class="absolute top-0 left-0 right-0 h-px"
								     style="background: linear-gradient(90deg, transparent, {display?.color ?? '#7c3aed'}88, transparent)"></div>
							{/if}

							<div class="p-4">
								<!-- Top row: icon + badge/toggle -->
								<div class="flex items-start justify-between gap-2 mb-3">
									<!-- Icon badge -->
									<div class="relative">
										<div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0
										            {isSoon || (!enabled && !isCore) ? 'opacity-35' : ''}"
										     style="background: {display?.color ?? '#374151'}18; border: 1px solid {display?.color ?? '#374151'}33">
											{display?.icon ?? '📦'}
										</div>
										{#if display?.isNew}
											<span class="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-amber-500 text-black px-1 rounded-full leading-tight py-0.5">
												NEW
											</span>
										{/if}
									</div>

									<!-- Core lock / Soon badge / Toggle -->
									{#if isCore}
										<div class="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-800/60 rounded-lg px-2 py-1">
											<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
												      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
											</svg>
											<span>Core</span>
										</div>
									{:else if isSoon}
										<div class="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-800/40 rounded-lg px-2 py-1 border border-gray-700/40">
											<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
												      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
											<span>Bientôt</span>
										</div>
									{:else}
										<button
											onclick={() => toggle(mod.id, enabled)}
											disabled={isSaving}
											class="relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900
											       {enabled ? 'focus:ring-violet-500' : 'focus:ring-gray-600'}
											       {isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}"
											style="background: {enabled ? (display?.color ?? '#7c3aed') : '#374151'}"
											aria-label="{enabled ? 'Désactiver' : 'Activer'} {display?.name}"
										>
											<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
											             {enabled ? 'translate-x-5' : 'translate-x-0'}"></span>
										</button>
									{/if}
								</div>

								<!-- Name + description -->
								<div class="mb-2.5">
									<div class="flex items-center gap-2 mb-1">
										<span class="text-sm font-semibold {isSoon || (!enabled && !isCore) ? 'text-gray-500' : 'text-white'}">
											{display?.name ?? mod.id}
										</span>
										{#if isCore}
											<span class="text-[10px] text-gray-600 font-medium">Toujours actif</span>
										{:else if isSoon}
											<span class="text-[10px] text-gray-600 font-medium">En développement</span>
										{:else}
											<span class="text-[10px] font-medium {enabled ? 'text-green-500' : 'text-gray-600'}">
												{enabled ? '● actif' : '○ inactif'}
											</span>
										{/if}
									</div>
									<p class="text-xs text-gray-500 leading-relaxed line-clamp-2">
										{display?.description ?? ''}
									</p>
								</div>

								<!-- Tags -->
								{#if display?.tags?.length}
									<div class="flex flex-wrap gap-1">
										{#each display.tags as tag}
											<span class="text-[10px] px-1.5 py-0.5 rounded-md font-medium
											             {!enabled && !isCore ? 'bg-gray-800/40 text-gray-600' : 'bg-gray-800 text-gray-400'}">
												{tag}
											</span>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
</div>

<!-- ── Toasts ────────────────────────────────────────────────────────────────── -->
<div class="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none">
	{#each toasts as toast (toast.id)}
		<div class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl border
		            transition-all duration-300 pointer-events-auto
		            {toast.ok
		              ? 'bg-gray-900 border-green-500/30 text-green-400'
		              : 'bg-gray-900 border-red-500/30 text-red-400'}">
			<span>{toast.ok ? '✓' : '✗'}</span>
			<span>{toast.text}</span>
		</div>
	{/each}
</div>
