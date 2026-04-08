<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import type { HomepagePosition, HomepageWidget } from '$lib/types/homepage';
	import { PLUGIN_REGISTRY, PLUGIN_LIST } from '$lib/components/homepage/plugins';
	import type { WidgetFamily } from '$lib/components/homepage/plugins';

	let { data }: { data: PageData } = $props();

	// ── State ──────────────────────────────────────────────────────────────────

	// Group widgets by position
	let widgetsByPos = $state<Record<string, HomepageWidget[]>>(
		groupWidgets(data.widgets, data.positions)
	);

	let positions = $state<HomepagePosition[]>(data.positions as HomepagePosition[]);

	let saving   = $state(false);
	let toasts   = $state<{ id: number; text: string; ok: boolean }[]>([]);
	let toastId  = 0;

	// Modal state
	let showAddModal  = $state(false);
	let editingWidget = $state<HomepageWidget | null>(null);
	let targetPos     = $state('');
	let showSkeleton  = $state(false);
	let hideEmpty     = $state(false);

	// Form state
	let form = $state({
		widget_type: '',
		title: '',
		config_fields: {} as Record<string, unknown>,  // valeurs champs du schema
		visibility_audience: 'all' as 'all' | 'guests' | 'members',
		enabled: true,
		width: 'full',
		hide_mobile: false,
	});

	// Widgets installés (externes) depuis le store public
	interface ExternalWidget { id: string; manifest: { label: string; icon?: string; family?: string; schema?: any[]; description?: string } }
	const externalWidgets = $derived((data as any).externalWidgets as ExternalWidget[] ?? []);
	const externalById    = $derived(Object.fromEntries(externalWidgets.map((w: ExternalWidget) => [w.id, w])));

	// Plugin actif selon le widget sélectionné (natif OU externe)
	const activePlugin   = $derived(PLUGIN_REGISTRY[form.widget_type] ?? null);
	const activeExternal = $derived(!activePlugin ? (externalById[form.widget_type] ?? null) : null);
	// Schema actif (natif ou manifest externe)
	const activeSchema   = $derived(
		activePlugin?.schema ??
		(activeExternal?.manifest?.schema as any[] | undefined) ??
		[]
	);

	// Initialise les champs avec les valeurs par défaut du schema du plugin
	function initConfigFields(widgetType: string, existingConfig?: Record<string, unknown>) {
		const plugin = PLUGIN_REGISTRY[widgetType];
		const ext    = externalById[widgetType];
		const schema = plugin?.schema ?? (ext?.manifest?.schema as any[] | undefined) ?? [];
		const fields: Record<string, unknown> = {};
		for (const f of schema) {
			fields[f.key] = existingConfig?.[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '');
		}
		if (schema.length === 0 && existingConfig) { form.config_fields = existingConfig; return; }
		form.config_fields = fields;
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	function groupWidgets(
		widgets: HomepageWidget[],
		positions: HomepagePosition[]
	): Record<string, HomepageWidget[]> {
		const map: Record<string, HomepageWidget[]> = {};
		for (const p of positions) map[p.id] = [];
		for (const w of widgets) {
			if (!map[w.position_id]) map[w.position_id] = [];
			map[w.position_id].push(w);
		}
		// Sort by sort_order
		for (const key of Object.keys(map)) {
			map[key].sort((a, b) => a.sort_order - b.sort_order);
		}
		return map;
	}

	function toast(text: string, ok = true) {
		const id = ++toastId;
		toasts = [...toasts, { id, text, ok }];
		setTimeout(() => { toasts = toasts.filter(t => t.id !== id); }, 3000);
	}

	function getToken() { return ($page.data as any).token as string ?? ''; }

	// ── Widget catalogue (Phase 1 + futures) ─────────────────────────────────
	const FAMILY_COLORS: Record<string, string> = {
		media:     '#a78bfa',
		gaming:    '#06b6d4',
		community: '#4ade80',
		esport:    '#f97316',
		social:    '#3b82f6',
		content:   '#94a3b8',
	};

	// ── CRUD Actions ──────────────────────────────────────────────────────────

	function openAdd(posId: string) {
		targetPos = posId;
		editingWidget = null;
		form = { widget_type: '', title: '', config_fields: {}, visibility_audience: 'all', enabled: true, width: 'full', hide_mobile: false };
		showAddModal = true;
	}

	function openEdit(w: HomepageWidget) {
		editingWidget = w;
		targetPos = w.position_id;
		form = {
			widget_type: w.widget_type,
			title: w.title ?? '',
			config_fields: {},
			visibility_audience: (w.visibility?.audience ?? 'all') as 'all' | 'guests' | 'members',
			enabled: w.enabled,
			width: w.width,
			hide_mobile: w.hide_mobile,
		};
		initConfigFields(w.widget_type, w.config as Record<string, unknown>);
		showAddModal = true;
	}

	async function saveWidget() {
		if (!targetPos) { toast('Choisissez une position', false); return; }
		if (!form.widget_type) { toast('Choisissez un type de widget', false); return; }
		const config = form.config_fields;

		saving = true;
		const token = getToken();
		const body = {
			position_id: targetPos,
			widget_type: form.widget_type,
			title: form.title || undefined,
			config,
			visibility: { audience: form.visibility_audience },
			enabled: form.enabled,
			width: form.width,
			hide_mobile: form.hide_mobile,
		};

		try {
			if (editingWidget) {
				// Update
				const res = await fetch(`/api/v1/admin/homepage/widgets/${editingWidget.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
					body: JSON.stringify(body),
				});
				if (!res.ok) throw new Error();
				// Update local state — gère aussi le changement de position
				const oldPosId = editingWidget.position_id;
				const updated = { ...editingWidget, ...body } as HomepageWidget;
				if (oldPosId !== targetPos) {
					// Retirer de l'ancienne position
					widgetsByPos[oldPosId] = (widgetsByPos[oldPosId] ?? []).filter(w => w.id !== editingWidget!.id);
					// Ajouter à la nouvelle
					if (!widgetsByPos[targetPos]) widgetsByPos[targetPos] = [];
					widgetsByPos[targetPos] = [...widgetsByPos[targetPos], updated];
				} else {
					const idx = (widgetsByPos[oldPosId] ?? []).findIndex(w => w.id === editingWidget!.id);
					if (idx !== -1) widgetsByPos[oldPosId][idx] = updated;
				}
				toast('Widget mis à jour');
			} else {
				// Create
				const res = await fetch('/api/v1/admin/homepage/widgets', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
					body: JSON.stringify({ ...body, sort_order: (widgetsByPos[targetPos] ?? []).length }),
				});
				if (!res.ok) throw new Error();
				const json = await res.json();
				const newW: HomepageWidget = {
					id: json.id, position_id: targetPos, widget_type: form.widget_type,
					title: form.title || null, config, sort_order: (widgetsByPos[targetPos] ?? []).length,
					enabled: form.enabled, visibility: { audience: form.visibility_audience },
					width: form.width, mobile_height: null,
					hide_mobile: form.hide_mobile, hide_tablet: false,
				};
				widgetsByPos[targetPos] = [...(widgetsByPos[targetPos] ?? []), newW];
				toast('Widget ajouté');
			}
			showAddModal = false;
		} catch {
			toast('Erreur lors de la sauvegarde', false);
		} finally {
			saving = false;
		}
	}

	async function deleteWidget(w: HomepageWidget) {
		if (!confirm(`Supprimer le widget "${w.widget_type}" ?`)) return;
		const token = getToken();
		const res = await fetch(`/api/v1/admin/homepage/widgets/${w.id}`, {
			method: 'DELETE',
			headers: { 'Authorization': `Bearer ${token}` },
		});
		if (res.ok) {
			widgetsByPos[w.position_id] = (widgetsByPos[w.position_id] ?? []).filter(x => x.id !== w.id);
			toast('Widget supprimé');
		} else {
			toast('Erreur suppression', false);
		}
	}

	async function toggleWidget(w: HomepageWidget) {
		const token = getToken();
		const newEnabled = !w.enabled;
		const res = await fetch(`/api/v1/admin/homepage/widgets/${w.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
			body: JSON.stringify({ enabled: newEnabled }),
		});
		if (res.ok) {
			const idx = (widgetsByPos[w.position_id] ?? []).findIndex(x => x.id === w.id);
			if (idx !== -1) widgetsByPos[w.position_id][idx].enabled = newEnabled;
		}
	}

	async function moveWidget(w: HomepageWidget, dir: -1 | 1) {
		const arr = [...(widgetsByPos[w.position_id] ?? [])];
		const idx = arr.findIndex(x => x.id === w.id);
		const newIdx = idx + dir;
		if (newIdx < 0 || newIdx >= arr.length) return;
		[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
		// Re-assign sort_orders
		const items = arr.map((x, i) => ({ id: x.id, position_id: x.position_id, sort_order: i }));
		const token = getToken();
		const res = await fetch('/api/v1/admin/homepage/widgets/reorder', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
			body: JSON.stringify({ items }),
		});
		if (res.ok) {
			widgetsByPos[w.position_id] = arr.map((x, i) => ({ ...x, sort_order: i }));
		}
	}

	const LAYOUT_ROWS: { positions: string[]; fractions?: number[] }[] = [
		{ positions: ['banner'] },
		{ positions: ['hero'] },
		{ positions: ['stats-bar'] },
		{ positions: ['main', 'sidebar'],                  fractions: [2, 1] },
		{ positions: ['wide-1'] },
		{ positions: ['half-1', 'half-2'],                 fractions: [1, 1] },
		{ positions: ['wide-2'] },
		{ positions: ['trio-1', 'trio-2', 'trio-3'],       fractions: [1, 1, 1] },
		{ positions: ['footer-1', 'footer-2', 'footer-3'], fractions: [1, 1, 1] },
		{ positions: ['footer-bar'] },
	];

	const POSITION_ICONS: Record<string, string> = {
		'banner': '📢', 'hero': '🌟', 'stats-bar': '📊',
		'main': '📰', 'sidebar': '📌',
		'wide-1': '▬', 'half-1': '▐', 'half-2': '▌',
		'wide-2': '▬', 'trio-1': '▏', 'trio-2': '▎', 'trio-3': '▍',
		'footer-1': '🦶', 'footer-2': '🦶', 'footer-3': '🦶', 'footer-bar': '─',
	};
</script>

<svelte:head><title>Homepage Builder — Admin</title></svelte:head>

<!-- Toast notifications -->
<div class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
	{#each toasts as t (t.id)}
		<div class="px-4 py-2.5 text-sm font-medium text-white rounded-none pointer-events-auto"
		     style="background:{t.ok ? '#166534' : '#7f1d1d'}; border:1px solid {t.ok ? '#16a34a' : '#dc2626'}">
			{t.text}
		</div>
	{/each}
</div>

<div class="min-h-screen p-6" style="background:#05050a; color:#e2e8f0">

	<!-- Header -->
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-2xl font-black" style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#a78bfa,#06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text">
				Homepage Builder
			</h1>
			<p class="text-sm mt-1" style="color:#6b7280">
				Gérez les widgets de votre page d'accueil publique — zéro code, zéro rebuild.
			</p>
		</div>
		<div class="flex items-center gap-3">
		<!-- Toggle positions vides -->
		<button
			onclick={() => hideEmpty = !hideEmpty}
			class="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all"
			style="border:1px solid rgba(255,255,255,.1); color:{hideEmpty ? '#a78bfa' : '#4b5563'}; background:{hideEmpty ? 'rgba(124,58,237,.1)' : 'transparent'}"
			title={hideEmpty ? 'Afficher toutes les positions' : 'Masquer les positions vides'}
		>
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				{#if hideEmpty}
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
				{:else}
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
				{/if}
			</svg>
			{hideEmpty ? 'Tout afficher' : 'Masquer vides'}
		</button>
		<button
			onclick={() => openAdd('')}
			class="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-wider transition-all"
			style="background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(6,182,212,.15)); border:1px solid rgba(124,58,237,.4); color:#a78bfa"
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
			</svg>
			Créer un widget
		</button>
		<a href="/" target="_blank"
		   class="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-wider transition-all"
		   style="border:1px solid rgba(255,255,255,.1); color:#9ca3af">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
			</svg>
			Aperçu
		</a>
		</div>
	</div>

	<!-- Layout visuel — reflète la vraie structure de la page -->
	<div class="flex flex-col gap-3">

		{#snippet posCard(posId: string)}
			{@const pos = positions.find(p => p.id === posId)}
			{@const widgets = widgetsByPos[posId] ?? []}
			{#if pos}
			<div class="flex-1 min-w-0" style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">

				<!-- Position header -->
				<div class="flex items-center justify-between px-4 py-3"
				     style="border-bottom:1px solid rgba(255,255,255,.05)">
					<div class="flex items-center gap-3">
						<span class="text-base">{POSITION_ICONS[pos.id] ?? '⬜'}</span>
						<div>
							<span class="font-bold text-sm text-white">{pos.label}</span>
							<span class="ml-2 text-xs px-1.5 py-0.5 rounded font-mono"
							      style="background:rgba(255,255,255,.06); color:#6b7280">
								{pos.id}
							</span>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-xs" style="color:#4b5563">
							{widgets.length} widget{widgets.length !== 1 ? 's' : ''}
						</span>
						<button
							onclick={() => openAdd(pos.id)}
							class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all"
							style="background:rgba(124,58,237,.15); border:1px solid rgba(124,58,237,.3); color:#a78bfa"
						>
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
							</svg>
							Ajouter
						</button>
					</div>
				</div>

				<!-- Widgets in position -->
				{#if widgets.length > 0}
					<div class="divide-y" style="border-color:rgba(255,255,255,.04)">
						{#each widgets as w, i (w.id)}
							{@const meta = PLUGIN_REGISTRY[w.widget_type] ?? null}
							{@const fcolor = FAMILY_COLORS[meta?.family ?? 'content'] ?? '#94a3b8'}
							<div class="flex items-center gap-3 px-4 py-3"
							     class:opacity-50={!w.enabled}>
								<!-- Color dot -->
								<div class="w-2 h-2 rounded-full shrink-0" style="background:{fcolor}"></div>

								<!-- Widget info -->
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="font-mono text-sm font-bold" style="color:#e2e8f0">
											{w.widget_type}
										</span>
										{#if w.title}
											<span class="text-xs" style="color:#6b7280">— {w.title}</span>
										{/if}
										{#if meta?.phase && meta.phase > 1}
											<span class="text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider"
											      style="background:rgba(251,146,60,.1); border:1px solid rgba(251,146,60,.3); color:#fb923c">
												Phase {meta.phase}
											</span>
										{/if}
										{#if !w.enabled}
											<span class="text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider"
											      style="background:rgba(255,255,255,.05); color:#4b5563">
												Désactivé
											</span>
										{/if}
										{#if w.visibility?.audience !== 'all'}
											<span class="text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider"
											      style="background:rgba(6,182,212,.1); border:1px solid rgba(6,182,212,.2); color:#67e8f9">
												{w.visibility.audience}
											</span>
										{/if}
									</div>
									<div class="text-xs mt-0.5" style="color:#4b5563">
										Position {i + 1} · largeur: {w.width}
									</div>
								</div>

								<!-- Actions -->
								<div class="flex items-center gap-1 shrink-0">
									<!-- Move up -->
									<button
										onclick={() => moveWidget(w, -1)}
										disabled={i === 0}
										class="w-7 h-7 flex items-center justify-center transition-colors disabled:opacity-20"
										style="border:1px solid rgba(255,255,255,.08); color:#6b7280"
										title="Monter"
									>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/>
										</svg>
									</button>
									<!-- Move down -->
									<button
										onclick={() => moveWidget(w, 1)}
										disabled={i === widgets.length - 1}
										class="w-7 h-7 flex items-center justify-center transition-colors disabled:opacity-20"
										style="border:1px solid rgba(255,255,255,.08); color:#6b7280"
										title="Descendre"
									>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
										</svg>
									</button>
									<!-- Toggle -->
									<button
										onclick={() => toggleWidget(w)}
										class="w-7 h-7 flex items-center justify-center transition-colors"
										style="border:1px solid rgba(255,255,255,.08); color:{w.enabled ? '#4ade80' : '#6b7280'}"
										title={w.enabled ? 'Désactiver' : 'Activer'}
									>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
											<circle cx="12" cy="12" r="10"/>
											{#if w.enabled}
												<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/>
											{/if}
										</svg>
									</button>
									<!-- Edit -->
									<button
										onclick={() => openEdit(w)}
										class="w-7 h-7 flex items-center justify-center transition-colors"
										style="border:1px solid rgba(255,255,255,.08); color:#a78bfa"
										title="Configurer"
									>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
										</svg>
									</button>
									<!-- Delete -->
									<button
										onclick={() => deleteWidget(w)}
										class="w-7 h-7 flex items-center justify-center transition-colors"
										style="border:1px solid rgba(255,255,255,.08); color:#6b7280"
										title="Supprimer"
										onmouseenter={e => (e.currentTarget as HTMLElement).style.color='#ef4444'}
										onmouseleave={e => (e.currentTarget as HTMLElement).style.color='#6b7280'}
									>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
										</svg>
									</button>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="px-4 py-5 text-center text-sm" style="color:#374151">
						Position vide — cliquez sur <strong style="color:#a78bfa">Ajouter</strong> pour placer un widget ici.
					</div>
				{/if}
			</div>
			{/if}
		{/snippet}

		<!-- Rendu ligne par ligne selon le vrai layout de la page -->
		{#each LAYOUT_ROWS as row}
			{@const rowHasWidgets = row.positions.some(id => (widgetsByPos[id] ?? []).length > 0)}
			{#if !hideEmpty || rowHasWidgets}
			{#if row.positions.length === 1}
				{@render posCard(row.positions[0])}
			{:else}
				<div class="flex gap-2">
					{#each row.positions as posId, i}
						<div style="flex:{row.fractions ? row.fractions[i] : 1}; min-width:0">
							{@render posCard(posId)}
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		{/each}

	</div>
</div>

<!-- Add/Edit Modal -->
{#if showAddModal}
	<!-- svelte-ignore a11y_click_outside -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4"
	     style="background:rgba(0,0,0,.8)"
	     onclick={e => e.target === e.currentTarget && (showAddModal = false)}>
		<div class="w-full max-w-lg flex flex-col gap-5 p-6"
		     style="background:#0d0d12; border:1px solid rgba(255,255,255,.1); max-height:90vh; overflow-y:auto">

			<div class="flex items-center justify-between">
				<h2 class="font-black text-lg text-white" style="font-family:'Space Grotesk',sans-serif">
					{editingWidget ? 'Configurer le widget' : 'Ajouter un widget'}
				</h2>
				<button onclick={() => showAddModal = false} aria-label="Fermer" style="color:#6b7280">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
					</svg>
				</button>
			</div>

			<!-- Position selector -->
			<div>
					<div class="flex items-center gap-2 mb-2">
						<p class="text-xs font-bold uppercase tracking-wider" style="color:#6b7280">Position</p>
						<button
							type="button"
							onclick={() => showSkeleton = !showSkeleton}
							title="Voir le plan des positions"
							class="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center transition-colors"
							style="background:{showSkeleton ? 'rgba(124,58,237,.3)' : 'rgba(255,255,255,.06)'}; border:1px solid rgba(255,255,255,.1); color:{showSkeleton ? '#a78bfa' : '#6b7280'}"
						>?</button>
					</div>

					<!-- Skeleton map popover -->
					{#if showSkeleton}
						{@const sk = (id: string, label: string) => ({
							id, label,
							count: widgetsByPos[id]?.length ?? 0,
							active: targetPos === id,
						})}
						<div class="mb-3 p-3 flex flex-col gap-1 text-[10px] font-mono"
						     style="background:#080810; border:1px solid rgba(124,58,237,.25)">

							{#snippet skBtn(z: ReturnType<typeof sk>, flex?: string)}
								<button type="button" onclick={() => { targetPos = z.id; showSkeleton = false; }}
								        class="flex items-center justify-between px-2 py-1.5 transition-colors"
								        style="flex:{flex ?? 'none'}; width:{flex ? 'auto' : '100%'}; background:{z.active ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.03)'}; border:1px solid {z.active ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.06)'}; color:{z.active ? '#a78bfa' : '#6b7280'}">
									<span>{z.label}</span>
									<span style="color:{z.active ? '#7c3aed' : '#374151'}">{z.count > 0 ? `${z.count}w` : '·'}</span>
								</button>
							{/snippet}

							{@render skBtn(sk('banner','Bandeau'))}
							{@render skBtn(sk('hero','Hero'))}
							{@render skBtn(sk('stats-bar','Barre de stats'))}

							<div class="flex gap-1">
								{@render skBtn(sk('main','Contenu principal'), '2')}
								{@render skBtn(sk('sidebar','Sidebar'), '1')}
							</div>

							{@render skBtn(sk('wide-1','Section large 1'))}

							<div class="flex gap-1">
								{@render skBtn(sk('half-1','2 col — Gauche'), '1')}
								{@render skBtn(sk('half-2','2 col — Droite'), '1')}
							</div>

							{@render skBtn(sk('wide-2','Section large 2'))}

							<div class="flex gap-1">
								{@render skBtn(sk('trio-1','3 col — 1'), '1')}
								{@render skBtn(sk('trio-2','3 col — 2'), '1')}
								{@render skBtn(sk('trio-3','3 col — 3'), '1')}
							</div>

							<div class="flex gap-1">
								{@render skBtn(sk('footer-1','Footer 1'), '1')}
								{@render skBtn(sk('footer-2','Footer 2'), '1')}
								{@render skBtn(sk('footer-3','Footer 3'), '1')}
							</div>

							{@render skBtn(sk('footer-bar','Barre de footer'))}

						</div>
					{/if}

					<select
						bind:value={targetPos}
						class="w-full px-3 py-2 text-sm text-white"
						style="background:#12121a; border:1px solid {targetPos ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.1)'}"
					>
						<option value="">— Choisir une position —</option>
						{#each positions as pos}
							<option value={pos.id}>{pos.label} ({pos.id})</option>
						{/each}
					</select>
			</div>

			<!-- Widget type selector -->
			{#if !editingWidget}
				<div>
					<p class="text-xs font-bold uppercase tracking-wider mb-3" style="color:#6b7280">Type de widget</p>

					<!-- Grille visuelle par famille -->
					{#each Object.entries(
						PLUGIN_LIST.reduce((acc: Record<string, typeof PLUGIN_LIST>, w) => {
							if (!acc[w.family]) acc[w.family] = [];
							acc[w.family].push(w);
							return acc;
						}, {})
					) as [family, widgets]}
						<div class="mb-3">
							<p class="text-[10px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5"
							   style="color:{FAMILY_COLORS[family] ?? '#6b7280'}">
								<span class="inline-block w-1.5 h-1.5 rounded-full" style="background:{FAMILY_COLORS[family] ?? '#6b7280'}"></span>
								{family}
							</p>
							<div class="grid grid-cols-2 gap-1.5">
								{#each widgets as w}
									{@const available = w.phase === 1}
									{@const selected  = form.widget_type === w.id}
									<button
										type="button"
										disabled={!available}
										onclick={() => { if (available) { form.widget_type = w.id; initConfigFields(w.id); } }}
										class="text-left px-3 py-2.5 transition-all relative"
										style="
											background:{selected ? 'rgba(124,58,237,.2)' : available ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.015)'};
											border:1px solid {selected ? 'rgba(124,58,237,.6)' : available ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.04)'};
											opacity:{available ? '1' : '0.5'};
											cursor:{available ? 'pointer' : 'not-allowed'}
										"
									>
										<div class="flex items-start gap-2">
											<span class="text-lg leading-none mt-0.5 shrink-0">{w.icon}</span>
											<div class="min-w-0">
												<div class="text-xs font-bold truncate" style="color:{selected ? '#a78bfa' : available ? '#e2e8f0' : '#4b5563'}">{w.label}</div>
												<div class="text-[10px] mt-0.5 leading-tight" style="color:{available ? '#4b5563' : '#374151'}">{w.desc}</div>
											</div>
										</div>
										{#if !available}
											<span class="absolute top-1.5 right-1.5 text-[9px] font-bold px-1 py-0.5 rounded"
											      style="background:rgba(251,146,60,.15); color:#fb923c; border:1px solid rgba(251,146,60,.2)">
												P{w.phase}
											</span>
										{/if}
										{#if selected}
											<span class="absolute top-1.5 right-1.5 w-3 h-3 rounded-full flex items-center justify-center"
											      style="background:#7c3aed">
												<svg class="w-2 h-2" fill="white" viewBox="0 0 20 20">
													<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
												</svg>
											</span>
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/each}

					<!-- Widgets installés (externes) -->
					{#if externalWidgets.length > 0}
						<div class="mb-3">
							<p class="text-[10px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5"
							   style="color:#06b6d4">
								<span class="inline-block w-1.5 h-1.5 rounded-full" style="background:#06b6d4"></span>
								Installés
							</p>
							<div class="grid grid-cols-2 gap-1.5">
								{#each externalWidgets as w}
									{@const selected = form.widget_type === w.id}
									<button
										type="button"
										onclick={() => { form.widget_type = w.id; initConfigFields(w.id); }}
										class="text-left px-3 py-2.5 transition-all relative"
										style="
											background:{selected ? 'rgba(6,182,212,.15)' : 'rgba(255,255,255,.03)'};
											border:1px solid {selected ? 'rgba(6,182,212,.5)' : 'rgba(255,255,255,.08)'};
										"
									>
										<div class="flex items-start gap-2">
											<span class="text-lg leading-none mt-0.5 shrink-0">{w.manifest.icon ?? '🧩'}</span>
											<div class="min-w-0">
												<div class="text-xs font-bold truncate" style="color:{selected ? '#06b6d4' : '#e2e8f0'}">{w.manifest.label}</div>
												<div class="text-[10px] mt-0.5 leading-tight" style="color:#4b5563">{w.manifest.description ?? w.id}</div>
											</div>
										</div>
										{#if selected}
											<span class="absolute top-1.5 right-1.5 w-3 h-3 rounded-full flex items-center justify-center"
											      style="background:#06b6d4">
												<svg class="w-2 h-2" fill="white" viewBox="0 0 20 20">
													<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
												</svg>
											</span>
										{:else}
											<span class="absolute top-1.5 right-1.5 text-[9px] font-bold px-1 py-0.5"
											      style="background:rgba(6,182,212,.1); color:#06b6d4; border:1px solid rgba(6,182,212,.2)">ext</span>
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}

				</div>
			{:else}
				{@const meta = PLUGIN_REGISTRY[editingWidget?.widget_type ?? ''] ?? externalById[editingWidget?.widget_type ?? ''] ?? null}
				<div class="flex items-center gap-2.5 px-3 py-2.5"
				     style="background:rgba(124,58,237,.08); border:1px solid rgba(124,58,237,.2)">
					<span class="text-lg">{(meta as any)?.icon ?? (meta as any)?.manifest?.icon ?? '🧩'}</span>
					<div>
						<div class="font-bold text-sm" style="color:#a78bfa">{(meta as any)?.label ?? (meta as any)?.manifest?.label ?? editingWidget?.widget_type}</div>
						<div class="text-[10px]" style="color:#4b5563">{(meta as any)?.desc ?? (meta as any)?.manifest?.description ?? ''}</div>
					</div>
				</div>
			{/if}

			<!-- Title override -->
			<div>
				<label class="block text-xs font-bold uppercase tracking-wider mb-2" style="color:#6b7280">
					Titre (optionnel — surcharge le titre par défaut)
				</label>
				<input
					type="text"
					bind:value={form.title}
					placeholder="Laissez vide pour le titre par défaut"
					class="w-full px-3 py-2 text-sm text-white placeholder-gray-600"
					style="background:#12121a; border:1px solid rgba(255,255,255,.1)"
				/>
			</div>

			<!-- Config fields — générés depuis le schema du plugin -->
			{#if activeSchema.length > 0}
				<div class="flex flex-col gap-4">
					<p class="text-xs font-bold uppercase tracking-wider" style="color:#6b7280">Configuration</p>
					{#each activeSchema as field}
						<div>
							{#if field.type !== 'boolean'}
								<p class="text-xs font-semibold mb-1.5" style="color:#9ca3af">
									{field.label}
									{#if field.required}<span style="color:#f87171"> *</span>{/if}
								</p>
							{/if}

							{#if field.type === 'boolean'}
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="checkbox"
										checked={!!form.config_fields[field.key]}
										onchange={(e) => { form.config_fields[field.key] = (e.target as HTMLInputElement).checked; }}
										class="w-4 h-4"
									/>
									<span class="text-sm" style="color:#9ca3af">{field.label}</span>
								</label>

							{:else if field.type === 'select'}
								<select
									value={form.config_fields[field.key] ?? field.default ?? ''}
									onchange={(e) => { form.config_fields[field.key] = (e.target as HTMLSelectElement).value; }}
									class="w-full px-3 py-2 text-sm text-white"
									style="background:#12121a; border:1px solid rgba(255,255,255,.1)"
								>
									{#each field.options ?? [] as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>

							{:else if field.type === 'number'}
								<input
									type="number"
									value={form.config_fields[field.key] ?? field.default ?? ''}
									oninput={(e) => { form.config_fields[field.key] = parseFloat((e.target as HTMLInputElement).value); }}
									min={field.min}
									max={field.max}
									step="0.1"
									placeholder={field.placeholder}
									class="w-full px-3 py-2 text-sm text-white"
									style="background:#12121a; border:1px solid rgba(255,255,255,.1)"
								/>

							{:else if field.type === 'color'}
								<div class="flex items-center gap-3">
									<input
										type="color"
										value={(form.config_fields[field.key] as string) ?? field.default ?? '#7c3aed'}
										oninput={(e) => { form.config_fields[field.key] = (e.target as HTMLInputElement).value; }}
										class="w-10 h-10 rounded cursor-pointer"
										style="background:none; border:1px solid rgba(255,255,255,.1)"
									/>
									<input
										type="text"
										value={(form.config_fields[field.key] as string) ?? field.default ?? '#7c3aed'}
										oninput={(e) => { form.config_fields[field.key] = (e.target as HTMLInputElement).value; }}
										placeholder="#7c3aed"
										class="flex-1 px-3 py-2 text-sm text-white font-mono"
										style="background:#12121a; border:1px solid rgba(255,255,255,.1)"
									/>
								</div>

							{:else if field.type === 'textarea'}
								<textarea
									value={(form.config_fields[field.key] as string) ?? ''}
									oninput={(e) => { form.config_fields[field.key] = (e.target as HTMLTextAreaElement).value; }}
									rows="4"
									placeholder={field.placeholder}
									class="w-full px-3 py-2 text-sm text-white"
									style="background:#12121a; border:1px solid rgba(255,255,255,.1); resize:vertical"
								></textarea>

							{:else}
								<!-- text | url | image -->
								<input
									type={field.type === 'url' || field.type === 'image' ? 'url' : 'text'}
									value={(form.config_fields[field.key] as string) ?? ''}
									oninput={(e) => { form.config_fields[field.key] = (e.target as HTMLInputElement).value; }}
									placeholder={field.placeholder}
									class="w-full px-3 py-2 text-sm text-white"
									style="background:#12121a; border:1px solid rgba(255,255,255,.1)"
								/>
							{/if}

							{#if field.hint}
								<p class="mt-1 text-xs" style="color:#6b7280">{field.hint}</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else if form.widget_type && !activePlugin}
				<p class="text-xs italic" style="color:#6b7280">Ce widget (phase 2+) sera configurable dans une prochaine version.</p>
			{/if}

			<!-- Visibility -->
			<div>
				<label class="block text-xs font-bold uppercase tracking-wider mb-2" style="color:#6b7280">
					Visibilité
				</label>
				<select
					bind:value={form.visibility_audience}
					class="w-full px-3 py-2 text-sm text-white"
					style="background:#12121a; border:1px solid rgba(255,255,255,.1)"
				>
					<option value="all">Tout le monde</option>
					<option value="guests">Visiteurs non connectés seulement</option>
					<option value="members">Membres connectés seulement</option>
				</select>
			</div>

			<!-- Width + options row -->
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label class="block text-xs font-bold uppercase tracking-wider mb-2" style="color:#6b7280">
						Largeur
					</label>
					<select
						bind:value={form.width}
						class="w-full px-3 py-2 text-sm text-white"
						style="background:#12121a; border:1px solid rgba(255,255,255,.1)"
					>
						<option value="full">Pleine largeur</option>
						<option value="1/2">1/2</option>
						<option value="1/3">1/3</option>
						<option value="2/3">2/3</option>
						<option value="1/4">1/4</option>
						<option value="3/4">3/4</option>
					</select>
				</div>
				<div class="flex flex-col gap-2 justify-end pb-0.5">
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={form.enabled} class="w-4 h-4" />
						<span class="text-sm" style="color:#9ca3af">Activé</span>
					</label>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={form.hide_mobile} class="w-4 h-4" />
						<span class="text-sm" style="color:#9ca3af">Masqué sur mobile</span>
					</label>
				</div>
			</div>

			<!-- Actions -->
			<div class="flex items-center justify-end gap-3 pt-2" style="border-top:1px solid rgba(255,255,255,.06)">
				<button
					onclick={() => showAddModal = false}
					class="px-4 py-2 text-sm font-bold uppercase tracking-wider"
					style="color:#6b7280; border:1px solid rgba(255,255,255,.1)"
				>
					Annuler
				</button>
				<button
					onclick={saveWidget}
					disabled={saving || (!editingWidget && !form.widget_type)}
					class="px-5 py-2 text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40"
					style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#7c3aed,#0e7490); border:1px solid rgba(124,58,237,.4)"
				>
					{saving ? 'Sauvegarde...' : editingWidget ? 'Mettre à jour' : 'Ajouter'}
				</button>
			</div>
		</div>
	</div>
{/if}
