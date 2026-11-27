<script lang="ts">
	// Le nouvel éditeur de page d'accueil, lot L1a (SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md §3,
	// maquette https://nodyx.org/builder-maquette.html). Plein écran : à gauche la Structure,
	// au centre la vraie page, à droite les réglages du bloc choisi. Tout s'applique en direct
	// et part dans le brouillon (R1) ; rien n'est visible des visiteurs avant « Publier ».
	import { page } from '$app/state'
	import { onMount } from 'svelte'
	import { t } from '$lib/i18n'
	import GridRenderer from '$lib/components/homepage/GridRenderer.svelte'
	import { PLUGIN_REGISTRY } from '$lib/components/homepage/plugins'
	import { CATALOG_GROUPS, catalogEntry, catalogGroup, type SketchRect } from '$lib/homepage/catalog'
	import type { FieldSchema } from '$lib/components/homepage/plugins'
	import type { GridColumn, GridLayout, GridRow, GridTheme } from '$lib/types/homepage'
	import {
		toBlocks, toLayout, moveBlock, removeBlock, duplicateBlock, setSpan, insertRowAfter, insertIntoEmpty,
		widthOf, WIDTHS, type EditorBlock, type WidthWord,
	} from '$lib/homepage/editorModel'
	import { historyStart, historyPush, historyUndo, historyRedo, publishStatus, blockTitle, structureBlocks, withHidden } from '$lib/homepage/editorState'
	import { visibleFields, defaultsFor } from '$lib/homepage/fields'
	import { ambiancePalette, type ShellTheme } from '$lib/shellTheme'
	import { shellPreview } from '$lib/shellPreview'
	import { ArrowUp, ArrowDown, Copy, Eye, EyeOff, Trash2, Undo2, Redo2, ChevronLeft, Monitor, Tablet, Smartphone, Plus, Search } from 'lucide-svelte'

	let { data } = $props()
	const tFn = $derived($t)
	// Libellés des widgets : clés « hpw. » traduites, texte des anciens widgets tel quel
	const tr = (s: string | undefined) => (s && s.startsWith('hpw.') ? tFn(s) : (s ?? ''))
	const token = () => ((page.data as { token?: string }).token ?? '')

	// ── L'état ────────────────────────────────────────────────────────────────
	const start = (data.draft ?? data.published ?? { rows: [] }) as GridLayout
	// $state.raw : l'historique n'est jamais modifié en place (chaque geste rend une nouvelle
	// liste) ; un $state profond en ferait des proxys, que structuredClone (editorModel) refuse.
	let hist = $state.raw(historyStart<EditorBlock[]>(toBlocks(start)))
	const blocks = $derived(hist.present)
	const layout = $derived(toLayout(blocks))
	let published = $state.raw<GridLayout | null>((data.published as GridLayout | null) ?? null)
	const status = $derived(publishStatus(layout, published))

	let selectedId = $state<string | null>(null)
	const selected = $derived(blocks.find(b => b.id === selectedId) ?? null)
	const selectedPlugin = $derived(selected?.widget ? PLUGIN_REGISTRY[selected.widget] ?? null : null)
	let tab = $state<'structure' | 'add'>('structure')
	/** Où ira le prochain bloc ajouté : une place libre précise, ou après le bloc choisi */
	let addTarget = $state<{ kind: 'empty'; emptyId: string } | { kind: 'after'; blockId: string } | null>(null)
	let device = $state<'desktop' | 'tablet' | 'phone'>('desktop')

	// ── Gestes, annuler, rétablir (R3) ────────────────────────────────────────
	let lastEdit = { key: '', at: 0 }
	function commit(next: EditorBlock[], mergeKey = '') {
		const now = Date.now()
		const merge = !!mergeKey && lastEdit.key === mergeKey && now - lastEdit.at < 1200
		lastEdit = { key: mergeKey, at: now }
		hist = historyPush(hist, next, merge)
		scheduleSave()
	}
	function undo() { hist = historyUndo(hist); lastEdit = { key: '', at: 0 }; scheduleSave() }
	function redo() { hist = historyRedo(hist); lastEdit = { key: '', at: 0 }; scheduleSave() }

	function patchBlock(id: string, patch: (b: EditorBlock) => EditorBlock, mergeKey = '') {
		commit(blocks.map(b => (b.id === id ? patch(b) : b)), mergeKey)
	}
	function setField(key: string, value: unknown) {
		if (!selected) return
		patchBlock(selected.id, b => ({ ...b, config: { ...b.config, [key]: value } }), `${selected.id}:${key}`)
	}
	function toggleHidden(id: string) {
		patchBlock(id, b => ({ ...b, extra: withHidden(b.extra, !b.extra.hidden) }))
	}
	function move(id: string, dir: -1 | 1) { commit(moveBlock(blocks, id, dir)) }
	function duplicate(id: string) { commit(duplicateBlock(blocks, id)) }
	function setWidth(id: string, w: WidthWord) { commit(setSpan(blocks, id, WIDTHS[w])) }

	let toast = $state<{ text: string; undo: boolean } | null>(null)
	let toastTimer: ReturnType<typeof setTimeout> | undefined
	function showToast(text: string, withUndo = false) {
		toast = { text, undo: withUndo }
		clearTimeout(toastTimer)
		toastTimer = setTimeout(() => (toast = null), 6000)
	}
	function remove(id: string) {
		commit(removeBlock(blocks, id))
		if (selectedId === id) selectedId = null
		showToast(tFn('hpe.toast_removed'), true)
	}

	function addBlock(widget: string) {
		const p = PLUGIN_REGISTRY[widget]
		if (!p) return
		const nb = { widget, config: defaultsFor(p.schema, p.advanced ?? []) }
		const before = new Set(blocks.map(b => b.id))
		const next = addTarget?.kind === 'empty'
			? insertIntoEmpty(blocks, addTarget.emptyId, nb)
			: insertRowAfter(blocks, addTarget?.kind === 'after' ? addTarget.blockId : (selectedId ?? blocks[blocks.length - 1]?.id ?? null), nb)
		commit(next)
		addTarget = null
		tab = 'structure'
		selectedId = next.find(b => !before.has(b.id) && b.widget === widget)?.id ?? null
	}

	// ── Brouillon automatique (R1) et publication ─────────────────────────────
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
	let saveTimer: ReturnType<typeof setTimeout> | undefined
	function scheduleSave() {
		saveState = 'saving'
		clearTimeout(saveTimer)
		saveTimer = setTimeout(saveNow, 700)
	}
	async function saveNow() {
		clearTimeout(saveTimer)
		saveState = 'saving'
		try {
			const res = await fetch('/api/v1/admin/homepage/grid/draft', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
				body: JSON.stringify({ layout: toLayout(hist.present) }),
			})
			saveState = res.ok ? 'saved' : 'error'
		} catch {
			saveState = 'error'
		}
	}
	let publishing = $state(false)
	async function publish() {
		publishing = true
		try {
			if (saveState === 'saving' || saveState === 'error') await saveNow()
			if (saveState === 'error') throw new Error()
			const snapshot = toLayout(hist.present)
			const res = await fetch('/api/v1/admin/homepage/grid/publish', { method: 'POST', headers: { Authorization: `Bearer ${token()}` } })
			if (!res.ok) throw new Error()
			published = snapshot
			showToast(tFn('hpe.toast_published'))
		} catch {
			showToast(tFn('hpe.toast_publish_error'))
		} finally {
			publishing = false
		}
	}
	// Ne pas perdre un geste en quittant pendant l'enregistrement
	function beforeUnload(e: BeforeUnloadEvent) { if (saveState === 'saving' || saveState === 'error') e.preventDefault() }

	// ── Clavier (raccourcis rappelés dans le panneau) ─────────────────────────
	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement
		const typing = el?.closest('input, textarea, select, [contenteditable="true"]')
		const mod = e.ctrlKey || e.metaKey
		if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
		if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return }
		// Échap sort d'abord du champ (le geste suivant, Ctrl+Z, défait alors le réglage),
		// puis, une seconde fois, ne choisit plus aucun bloc.
		if (typing) { if (e.key === 'Escape') (typing as HTMLElement).blur(); return }
		if (e.key === 'Escape') selectedId = null
		if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); remove(selectedId) }
	}

	// ── La page au centre : un clic choisit un bloc, aucun lien ne quitte l'éditeur ──
	function onCanvasClick(e: MouseEvent) {
		const el = e.target as HTMLElement
		if (el.closest('.gr-chrome-tools, .gr-chrome-add, .gr-between')) return
		if (el.closest('a, button, input, select, textarea')) e.preventDefault()
		const col = el.closest('[data-block]') as HTMLElement | null
		const id = col?.dataset.block ?? null
		const b = blocks.find(x => x.id === id)
		if (b?.widget) { selectedId = b.id; tab = 'structure' }
		else if (!col) selectedId = null
	}
	function startAddHere(emptyId: string) { addTarget = { kind: 'empty', emptyId }; openAdd() }
	/** « Ajouter un bloc ici » entre deux rangées : le bloc ira sous la rangée du dessus. */
	function startAddBelow(blockId: string) { addTarget = { kind: 'after', blockId }; openAdd() }
	let searchEl = $state<HTMLInputElement | null>(null)
	function openAdd() { tab = 'add'; selectedId = null; addQuery = ''; setTimeout(() => searchEl?.focus(), 0) }

	// ── Thème : la page de l'éditeur ressemble à la page publiée ──────────────
	const shellTheme = $derived(($shellPreview ?? (page.data as { shellTheme?: ShellTheme | null }).shellTheme ?? null) as ShellTheme | null)
	const gridTheme = $derived((data.theme ?? {}) as Partial<GridTheme>)
	const designPage = $derived(!!gridTheme.follow_ambiance && shellTheme?.version === 2)
	const DEVICE_W = { desktop: '100%', tablet: '820px', phone: '390px' } as const

	// ── Libellés ──────────────────────────────────────────────────────────────
	// Le nom simple du catalogue (« Chiffres »), sinon le libellé du widget (extensions, anciens)
	const pluginName = (w: string | null) => {
		if (!w) return ''
		const e = catalogEntry(w)
		return e ? tFn(e.nameKey) : PLUGIN_REGISTRY[w] ? tr(PLUGIN_REGISTRY[w].label) : w
	}
	const widthName = (span: number) => { const w = widthOf(span); return w === 'custom' ? tFn('hpe.width_custom') : tFn(`hpe.width_${w}`) }
	// La phrase du catalogue (la même que dans « Ajouter un bloc »), sinon celle du widget
	const selectedDesc = $derived.by(() => {
		if (!selected?.widget) return ''
		const e = catalogEntry(selected.widget)
		return e ? tFn(e.descKey) : tr(selectedPlugin?.desc)
	})
	const structure = $derived(structureBlocks(blocks))
	/** La 2e ligne d'un bloc dans la Structure : son type s'il a un titre (sinon le titre EST le
	 *  type, pas de redite), sa largeur si ce n'est pas toute la largeur, « masqué ». */
	const itemSub = (b: EditorBlock) => {
		const parts: string[] = []
		if (blockTitle(b)) parts.push(pluginName(b.widget))
		if (widthOf(b.span) !== 'full') parts.push(widthName(b.span))
		if (b.extra.hidden) parts.push(tFn('hpe.hidden'))
		return parts.map((x, i) => (i ? x.toLowerCase() : x)).join(', ')
	}
	const hiddenCount = $derived(structure.filter(b => b.extra.hidden).length)
	const fields = $derived(selected && selectedPlugin ? visibleFields(selectedPlugin.schema, selected.config) : [] as FieldSchema[])
	const SIMPLE = new Set(['text', 'textarea', 'url', 'image', 'number', 'boolean', 'select', 'color'])

	let addQuery = $state('')
	const groups = $derived(CATALOG_GROUPS.map(g => ({ g, items: catalogGroup(g, addQuery, k => tFn(k)).filter(e => PLUGIN_REGISTRY[e.id]) })).filter(x => x.items.length))
	const blockName = (id: string) => { const b = blocks.find(x => x.id === id); return b ? (blockTitle(b) || pluginName(b.widget)) : '' }
	const addWhere = $derived(
		addTarget?.kind === 'empty' ? tFn('hpe.add_into_space')
		: addTarget?.kind === 'after' ? tFn('hpe.add_between', { name: blockName(addTarget.blockId) })
		: selected ? tFn('hpe.add_after', { name: blockTitle(selected) || pluginName(selected.widget) })
		: tFn('hpe.add_where_bottom'))
	const TONE: Record<SketchRect['tone'], string> = { ink: 'var(--nx-text)', accent: 'var(--nx-header-accent)', soft: 'var(--nx-border)' }
	const TONE_OP: Record<SketchRect['tone'], number> = { ink: 0.72, accent: 0.5, soft: 1 }

	onMount(() => {
		if (data.draft) saveState = 'saved'
		return () => { clearTimeout(saveTimer); clearTimeout(toastTimer) }
	})
</script>

<svelte:window onkeydown={onKey} onbeforeunload={beforeUnload} />
<svelte:head><title>{tFn('hpe.title')}</title></svelte:head>

{#snippet chrome(col: GridColumn)}
	{#if col.widget}
		<div class="gr-chrome" class:on={col.id === selectedId}>
			<span class="gr-chrome-tag">
				<span>{pluginName(col.widget)}{#if col.hidden}, {tFn('hpe.hidden').toLowerCase()}{/if}</span>
				{#if col.id === selectedId}
					<span class="gr-chrome-tools">
						<button type="button" onclick={() => move(col.id, -1)} title={tFn('hpe.up')} aria-label={tFn('hpe.up')}><ArrowUp size={14} /></button>
						<button type="button" onclick={() => move(col.id, 1)} title={tFn('hpe.down')} aria-label={tFn('hpe.down')}><ArrowDown size={14} /></button>
						<button type="button" onclick={() => duplicate(col.id)} title={tFn('hpe.duplicate')} aria-label={tFn('hpe.duplicate')}><Copy size={14} /></button>
						<button type="button" onclick={() => toggleHidden(col.id)} title={col.hidden ? tFn('hpe.show') : tFn('hpe.hide')} aria-label={col.hidden ? tFn('hpe.show') : tFn('hpe.hide')}>{#if col.hidden}<EyeOff size={14} />{:else}<Eye size={14} />{/if}</button>
						<button type="button" onclick={() => remove(col.id)} title={tFn('hpe.remove')} aria-label={tFn('hpe.remove')}><Trash2 size={14} /></button>
					</span>
				{/if}
			</span>
		</div>
	{:else}
		<button type="button" class="gr-chrome-add" onclick={() => startAddHere(col.id)}>
			<span>{tFn('hpe.add_here')}</span>
			<small>{tFn('hpe.free_space')}</small>
		</button>
	{/if}
{/snippet}

{#snippet between(row: GridRow)}
	{@const ref = row.columns.find(c => c.widget)?.id ?? row.columns[0]?.id}
	{#if ref}
		<div class="gr-between">
			<button type="button" onclick={() => startAddBelow(ref)}><Plus size={14} />{tFn('hpe.add_here')}</button>
		</div>
	{/if}
{/snippet}

<div class="ed">
	<!-- ── Barre du haut ── -->
	<header class="ed-top">
		<a class="ed-back" href="/admin"><ChevronLeft size={16} />{tFn('hpe.back_admin')}</a>
		<span class="ed-sep" aria-hidden="true"></span>
		<strong class="ed-name">{tFn('hpe.title')}</strong>
		<span class="ed-status ed-status--{status}">{tFn(`hpe.status_${status}`)}</span>

		<div class="ed-devices" role="group" aria-label={tFn('hpe.device')}>
			{#each (['desktop', 'tablet', 'phone'] as const) as d (d)}
				<button type="button" class:on={device === d} aria-pressed={device === d} onclick={() => (device = d)}>{#if d === 'desktop'}<Monitor size={15} />{:else if d === 'tablet'}<Tablet size={15} />{:else}<Smartphone size={15} />{/if}{tFn(`hpe.device_${d}`)}</button>
			{/each}
		</div>

		<div class="ed-actions">
			<button type="button" class="ed-icon" onclick={undo} disabled={!hist.past.length} title={tFn('hpe.undo')} aria-label={tFn('hpe.undo')}><Undo2 size={17} /></button>
			<button type="button" class="ed-icon" onclick={redo} disabled={!hist.future.length} title={tFn('hpe.redo')} aria-label={tFn('hpe.redo')}><Redo2 size={17} /></button>
			<a class="ed-btn" href="/" target="_blank" rel="noopener">{tFn('hpe.view_site')}</a>
			<button type="button" class="ed-btn ed-btn--main" onclick={publish} disabled={publishing || status === 'published'}>
				{publishing ? tFn('hpe.publishing') : tFn('hpe.publish')}
			</button>
		</div>
	</header>

	<div class="ed-body">
		<!-- ── À gauche : Structure, Ajouter un bloc ── -->
		<aside class="ed-left">
			<div class="ed-tabs" role="tablist">
				<button type="button" role="tab" aria-selected={tab === 'structure'} class:on={tab === 'structure'} onclick={() => { tab = 'structure'; addTarget = null }}>{tFn('hpe.tab_structure')}</button>
				<button type="button" role="tab" aria-selected={tab === 'add'} class:on={tab === 'add'} onclick={() => { addTarget = null; openAdd() }}>{tFn('hpe.tab_add')}</button>
			</div>

			{#if tab === 'structure'}
				<div class="ed-scroll">
					{#if !structure.length}
						<p class="ed-empty">{tFn('hpe.structure_empty')}</p>
					{/if}
					<ul class="ed-list">
						{#each structure as b, i (b.id)}
							<li class="ed-item" class:on={b.id === selectedId} class:off={b.extra.hidden}>
								<button type="button" class="ed-item-main" onclick={() => (selectedId = b.id)}>
									<span class="ed-item-title">{blockTitle(b) || pluginName(b.widget)}</span>
									{#if itemSub(b)}<span class="ed-item-sub">{itemSub(b)}</span>{/if}
								</button>
								<span class="ed-item-tools">
									<button type="button" onclick={() => move(b.id, -1)} disabled={i === 0} aria-label={tFn('hpe.up')} title={tFn('hpe.up')}><ArrowUp size={14} /></button>
									<button type="button" onclick={() => move(b.id, 1)} disabled={i === structure.length - 1} aria-label={tFn('hpe.down')} title={tFn('hpe.down')}><ArrowDown size={14} /></button>
									<button type="button" onclick={() => toggleHidden(b.id)} aria-label={b.extra.hidden ? tFn('hpe.show') : tFn('hpe.hide')} title={b.extra.hidden ? tFn('hpe.show') : tFn('hpe.hide')}>{#if b.extra.hidden}<EyeOff size={14} />{:else}<Eye size={14} />{/if}</button>
								</span>
							</li>
						{/each}
					</ul>
					<p class="ed-hint">{tFn('hpe.structure_hint')}</p>
				</div>
				<div class="ed-left-foot">
					<button type="button" class="ed-btn ed-btn--wide" onclick={() => { addTarget = null; openAdd() }}><Plus size={16} />{tFn('hpe.add_block')}</button>
				</div>
			{:else}
				<div class="ed-scroll">
					<label class="ed-search">
						<Search size={16} />
						<input bind:this={searchEl} type="search" bind:value={addQuery} placeholder={tFn('hpe.search_block')} aria-label={tFn('hpe.search_block')} />
					</label>
					<p class="ed-where">{addWhere}</p>
					{#each groups as { g, items } (g)}
						<h3 class="ed-group">{tFn(`hpe.group_${g}`)}</h3>
						<ul class="ed-cards">
							{#each items as e (e.id)}
								<li>
									<button type="button" class="ed-card" onclick={() => addBlock(e.id)}>
										<svg class="ed-sketch" viewBox="0 0 100 56" aria-hidden="true">
											{#each e.sketch as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" fill={TONE[r.tone]} fill-opacity={TONE_OP[r.tone]} />{/each}
										</svg>
										<span class="ed-card-name">{tFn(e.nameKey)}</span>
										<span class="ed-card-desc">{tFn(e.descKey)}</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="ed-empty">{tFn('hpe.no_block_found')}</p>
					{/each}
				</div>
			{/if}
		</aside>

		<!-- ── Au centre : la vraie page ── -->
		<main class="ed-canvas">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="ed-page ed-page--{device}" class:ed-page--design={designPage} style="max-width:{DEVICE_W[device]}" onclickcapture={onCanvasClick}>
				{#if layout.rows.length}
					<GridRenderer
						{layout}
						theme={gridTheme}
						ambiance={ambiancePalette(shellTheme)}
						instance={data.instance}
						user={null}
						installedWidgets={data.installedWidgets}
						extensions={data.extensions}
						blockChrome={chrome}
						betweenRows={between}
					/>
				{:else}
					<div class="ed-blank">
						<h2>{tFn('hpe.blank_title')}</h2>
						<p>{tFn('hpe.blank_text')}</p>
						<button type="button" class="ed-btn ed-btn--main" onclick={() => (tab = 'add')}><Plus size={16} />{tFn('hpe.add_block')}</button>
					</div>
				{/if}
			</div>
		</main>

		<!-- ── À droite : les réglages ── -->
		<aside class="ed-right">
			<div class="ed-scroll">
				{#if selected && selected.widget}
					<p class="ed-kicker">{tFn('hpe.block')}</p>
					<h2 class="ed-h">{pluginName(selected.widget)}</h2>
					{#if selectedDesc}<p class="ed-p">{selectedDesc}</p>{/if}

					<section class="ed-sec">
						<h3>{tFn('hpe.layout')}</h3>
						{#if widthOf(selected.span) === 'custom'}
							<p class="ed-p">{tFn('hpe.width_custom_note', { span: String(selected.span) })}</p>
						{:else}
							<div class="ed-widths" role="radiogroup" aria-label={tFn('hpe.width')}>
								{#each (Object.keys(WIDTHS) as WidthWord[]) as w (w)}
									<button type="button" role="radio" aria-checked={widthOf(selected.span) === w} class:on={widthOf(selected.span) === w} onclick={() => setWidth(selected!.id, w)}>{tFn(`hpe.width_${w}`)}</button>
								{/each}
							</div>
						{/if}
					</section>

					<section class="ed-sec">
						<h3>{tFn('hpe.content')}</h3>
						{#each fields as f (f.key)}
							{#if SIMPLE.has(f.type)}
								<label class="ed-field">
									<span class="ed-label">{tr(f.label)}</span>
									{#if f.hint}<span class="ed-help">{tr(f.hint)}</span>{/if}
									{#if f.type === 'textarea'}
										<textarea rows="4" value={(selected.config[f.key] as string) ?? ''} placeholder={tr(f.example ?? f.placeholder)} oninput={e => setField(f.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
									{:else if f.type === 'boolean'}
										<input type="checkbox" checked={!!selected.config[f.key]} onchange={e => setField(f.key, (e.currentTarget as HTMLInputElement).checked)} />
									{:else if f.type === 'select'}
										<select value={(selected.config[f.key] as string) ?? (f.default as string) ?? ''} onchange={e => setField(f.key, (e.currentTarget as HTMLSelectElement).value)}>
											{#each f.options ?? [] as o (o.value)}<option value={o.value}>{tr(o.label)}</option>{/each}
										</select>
									{:else if f.type === 'number'}
										<input type="number" min={f.min} max={f.max} value={(selected.config[f.key] as number) ?? (f.default as number) ?? 0} oninput={e => setField(f.key, Number((e.currentTarget as HTMLInputElement).value))} />
									{:else if f.type === 'color'}
										<input type="color" value={(selected.config[f.key] as string) ?? (f.default as string) ?? '#1f56c9'} oninput={e => setField(f.key, (e.currentTarget as HTMLInputElement).value)} />
									{:else}
										<input type="text" value={(selected.config[f.key] as string) ?? ''} placeholder={tr(f.example ?? f.placeholder)} oninput={e => setField(f.key, (e.currentTarget as HTMLInputElement).value)} onkeydown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }} />
									{/if}
								</label>
							{/if}
						{:else}
							<p class="ed-p">{tFn('hpe.no_settings')}</p>
						{/each}
					</section>
				{:else}
					<p class="ed-kicker">{tFn('hpe.page')}</p>
					<h2 class="ed-h">{tFn('hpe.title')}</h2>
					<p class="ed-p">{tFn('hpe.nothing_selected')}</p>
					<section class="ed-sec">
						<h3>{tFn('hpe.glance')}</h3>
						<p class="ed-p">{tFn('hpe.glance_count', { n: String(structure.length), h: String(hiddenCount) })}</p>
						<p class="ed-note">{tFn('hpe.theme_note')} <a href="/admin/appearance">{tFn('hpe.theme_link')}</a></p>
					</section>
					<section class="ed-sec">
						<h3>{tFn('hpe.shortcuts')}</h3>
						<p class="ed-keys"><kbd>Ctrl</kbd> <kbd>Z</kbd> {tFn('hpe.key_undo')}</p>
						<p class="ed-keys"><kbd>Ctrl</kbd> <kbd>⇧</kbd> <kbd>Z</kbd> {tFn('hpe.key_redo')}</p>
						<p class="ed-keys"><kbd>⌦</kbd> {tFn('hpe.key_delete')}</p>
						<p class="ed-keys"><kbd>Esc</kbd> {tFn('hpe.key_escape')}</p>
					</section>
				{/if}
			</div>
			<!-- R2 : valider est toujours possible et visible -->
			<footer class="ed-foot">
				<p class="ed-save ed-save--{saveState}" aria-live="polite">
					{#if saveState === 'saving'}{tFn('hpe.saving')}{:else if saveState === 'error'}{tFn('hpe.save_error')}{:else if saveState === 'saved'}<strong>{tFn('hpe.saved')}</strong><br />{tFn('hpe.saved_note')}{:else}{tFn('hpe.saved_note')}{/if}
				</p>
				{#if selected}<button type="button" class="ed-btn ed-btn--main" onclick={() => (selectedId = null)}>{tFn('hpe.done')}</button>{/if}
			</footer>
		</aside>
	</div>

	{#if toast}
		<div class="ed-toast" role="status">
			<span>{toast.text}</span>
			{#if toast.undo}<button type="button" onclick={() => { undo(); toast = null }}>{tFn('hpe.undo')}</button>{/if}
		</div>
	{/if}
</div>

<style>
	.ed {
		position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column;
		background: var(--nx-bg); color: var(--nx-text); font-family: var(--nx-font, inherit); font-size: 14px;
	}
	/* ── Barre du haut ── */
	.ed-top { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px; background: var(--nx-surface); border-bottom: 1px solid var(--nx-border); flex-shrink: 0; }
	.ed-back { display: inline-flex; align-items: center; gap: 4px; color: var(--nx-text-muted); text-decoration: none; white-space: nowrap; }
	.ed-back:hover { color: var(--nx-text); }
	.ed-sep { width: 1px; height: 22px; background: var(--nx-border); }
	.ed-name { font-size: 15px; white-space: nowrap; }
	.ed-status { font-size: 12px; padding: 2px 8px; border-radius: var(--nx-r-etiquette, 4px); white-space: nowrap; }
	.ed-status--unpublished { background: var(--nx-border-soft); color: var(--nx-text-muted); }
	.ed-status--modified { background: color-mix(in srgb, var(--nx-warn) 14%, transparent); color: var(--nx-warn); }
	.ed-status--published { background: color-mix(in srgb, var(--nx-ok) 14%, transparent); color: var(--nx-ok); }
	.ed-devices { margin: 0 auto; display: flex; gap: 2px; padding: 3px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-bg); }
	.ed-devices button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: var(--nx-r-etiquette, 4px); color: var(--nx-text-muted); }
	.ed-devices button.on { background: var(--nx-surface); color: var(--nx-text); box-shadow: 0 0 0 1px var(--nx-border); }
	.ed-actions { display: flex; align-items: center; gap: 8px; }
	.ed-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--nx-r-controle, 6px); color: var(--nx-text-muted); font-size: 16px; }
	.ed-icon:hover:not(:disabled) { background: var(--nx-bg); color: var(--nx-text); }
	.ed-icon:disabled { opacity: .35; }
	.ed-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 0 14px; border-radius: var(--nx-r-controle, 6px); border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font-weight: 600; text-decoration: none; white-space: nowrap; }
	.ed-btn:hover:not(:disabled) { border-color: var(--nx-text-muted); }
	.ed-btn--main { background: var(--nx-header-accent); border-color: var(--nx-header-accent); color: var(--nx-on-accent); }
	.ed-btn--main:hover:not(:disabled) { background: var(--nx-header-accent-strong); border-color: var(--nx-header-accent-strong); }
	.ed-btn:disabled { opacity: .5; cursor: default; }
	.ed-btn--wide { width: 100%; }

	/* ── Trois colonnes ── */
	.ed-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 264px minmax(0, 1fr) 304px; }
	.ed-left, .ed-right { display: flex; flex-direction: column; min-height: 0; background: var(--nx-surface); }
	.ed-left { border-right: 1px solid var(--nx-border); }
	.ed-right { border-left: 1px solid var(--nx-border); }
	.ed-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
	.ed-tabs { display: flex; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--nx-border); }
	.ed-tabs button { padding: 12px 8px; color: var(--nx-text-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
	.ed-tabs button.on { color: var(--nx-text); border-color: var(--nx-header-accent); font-weight: 600; }
	.ed-left-foot { padding: 12px; border-top: 1px solid var(--nx-border); }

	.ed-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.ed-item { display: flex; align-items: center; border-radius: var(--nx-r-controle, 6px); }
	.ed-item:hover { background: var(--nx-bg); }
	.ed-item.on { background: var(--nx-header-accent-soft); }
	.ed-item.off .ed-item-title { color: var(--nx-text-muted); }
	.ed-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; padding: 8px 10px; text-align: left; }
	.ed-item-title { width: 100%; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ed-item-sub { font-size: 12px; color: var(--nx-text-muted); }
	.ed-item-tools { display: flex; gap: 2px; padding-right: 6px; opacity: 0; }
	.ed-item:hover .ed-item-tools, .ed-item.on .ed-item-tools, .ed-item:focus-within .ed-item-tools { opacity: 1; }
	.ed-item-tools button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--nx-r-etiquette, 4px); color: var(--nx-text-muted); }
	.ed-item-tools button:hover:not(:disabled) { background: var(--nx-surface); color: var(--nx-text); }
	.ed-item-tools button:disabled { opacity: .3; }
	.ed-empty, .ed-hint { color: var(--nx-text-muted); font-size: 13px; line-height: 1.5; }
	.ed-hint { margin-top: 16px; }

	.ed-field input[type=text], .ed-field input[type=number], .ed-field textarea, .ed-field select {
		width: 100%; padding: 8px 10px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px);
		background: var(--nx-surface); color: var(--nx-text); font: inherit;
	}
	.ed-field :is(input, textarea, select):focus { outline: 2px solid var(--nx-header-accent); outline-offset: 1px; }
	/* Ajouter un bloc (maquette) : recherche, où ira le bloc, familles, cartes à croquis */
	.ed-search { display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-surface); color: var(--nx-text-muted); }
	.ed-search:focus-within { outline: 2px solid var(--nx-header-accent); outline-offset: 1px; }
	.ed-search input { flex: 1; min-width: 0; height: 36px; border: 0; background: none; color: var(--nx-text); font: inherit; outline: none; }
	.ed-where { margin: 10px 0 4px; padding: 8px 10px; font-size: 13px; line-height: 1.45; border-radius: var(--nx-r-controle, 6px); background: var(--nx-header-accent-soft); color: var(--nx-text); }
	.ed-group { margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: var(--nx-text-muted); }
	.ed-cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.ed-card { width: 100%; height: 100%; text-align: left; padding: 8px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-panneau, 10px); background: var(--nx-surface); display: flex; flex-direction: column; gap: 4px; }
	.ed-card:hover { border-color: var(--nx-header-accent); }
	.ed-sketch { width: 100%; height: auto; aspect-ratio: 100 / 56; padding: 6px; margin-bottom: 4px; border-radius: var(--nx-r-controle, 6px); background: var(--nx-bg); box-sizing: border-box; }
	.ed-card-name { font-weight: 600; font-size: 13px; line-height: 1.3; }
	.ed-card-desc { font-size: 12px; color: var(--nx-text-muted); line-height: 1.4; }

	/* ── La page ── */
	.ed-canvas { min-width: 0; overflow-y: auto; padding: 24px; background: var(--nx-border-soft); }
	.ed-page { margin: 0 auto; background: var(--nx-bg); min-height: calc(100% - 2px); box-shadow: 0 0 0 1px var(--nx-border); transition: max-width .25s var(--ease-out-soft, ease); }
	.ed-page--design { font-family: var(--nx-font); color: var(--nx-text); }
	.ed-blank { padding: 96px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
	.ed-blank h2 { font-size: 22px; font-weight: 700; }
	.ed-blank p { color: var(--nx-text-muted); }

	/* Tablette et Téléphone : la grille prend les largeurs qu'elle prend vraiment à ces tailles
	   d'écran (GridRenderer, span_md et span_sm), quelle que soit la taille de cette fenêtre. */
	.ed-page--tablet :global(.gr-col) { grid-column: span var(--col-span-md) !important; }
	.ed-page--phone :global(.gr-col) { grid-column: span var(--col-span-sm) !important; }
	.ed-page--phone :global(.gr-design .gr-row) { padding-left: 16px; padding-right: 16px; }

	/* « Ajouter un bloc ici » entre deux rangées : une bande au survol, à cheval sur la limite */
	.ed-page :global(.gr-between) { position: absolute; left: 0; right: 0; bottom: -14px; height: 28px; z-index: 6; display: flex; align-items: center; justify-content: center; }
	.ed-page :global(.gr-between::before) { content: ''; position: absolute; left: 0; right: 0; top: 13px; height: 2px; background: var(--nx-header-accent); opacity: 0; transition: opacity .15s; }
	.ed-page :global(.gr-between button) { position: relative; display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; background: var(--nx-header-accent); color: var(--nx-on-accent); font-size: 12px; font-weight: 600; opacity: 0; transition: opacity .15s; }
	.ed-page :global(.gr-between:hover::before), .ed-page :global(.gr-between:focus-within::before), .ed-page :global(.gr-between:hover button), .ed-page :global(.gr-between button:focus-visible) { opacity: 1; }

	/* L'habillage des blocs (rendu dans GridRenderer, d'où :global) */
	.ed-page :global(.gr-chrome) { position: absolute; inset: 0; pointer-events: none; outline: 1px solid transparent; outline-offset: -1px; z-index: 5; }
	.ed-page :global(.gr-col--chrome:hover > .gr-chrome) { outline-color: var(--nx-header-accent); }
	.ed-page :global(.gr-chrome.on) { outline: 2px solid var(--nx-header-accent); outline-offset: -2px; }
	.ed-page :global(.gr-chrome-tag) { position: absolute; top: 6px; left: 6px; display: none; align-items: center; gap: 6px; white-space: nowrap; padding: 3px 4px 3px 8px; background: var(--nx-header-accent); color: var(--nx-on-accent); font-size: 12px; font-weight: 600; border-radius: var(--nx-r-etiquette, 4px); pointer-events: auto; }
	.ed-page :global(.gr-col--chrome:hover > .gr-chrome .gr-chrome-tag), .ed-page :global(.gr-chrome.on .gr-chrome-tag) { display: inline-flex; }
	.ed-page :global(.gr-chrome-tools) { display: inline-flex; gap: 2px; }
	.ed-page :global(.gr-chrome-tools button) { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px; border-radius: 3px; color: inherit; }
	.ed-page :global(.gr-chrome-tools button:hover) { background: rgb(255 255 255 / .2); }
	.ed-page :global(.gr-chrome-add) {
		width: 100%; height: 100%; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
		border: 1px dashed var(--nx-border); color: var(--nx-text-muted);
		background: repeating-linear-gradient(135deg, transparent 0 8px, var(--nx-border-soft) 8px 9px);
	}
	.ed-page :global(.gr-chrome-add:hover) { border-color: var(--nx-header-accent); color: var(--nx-header-accent); }
	.ed-page :global(.gr-chrome-add small) { font-size: 12px; }

	/* ── Réglages ── */
	.ed-kicker { font-size: 12px; color: var(--nx-text-muted); margin: 0; }
	.ed-h { font-size: 17px; font-weight: 700; margin: 2px 0 6px; }
	.ed-p { color: var(--nx-text-muted); line-height: 1.5; margin: 0 0 8px; }
	.ed-sec { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--nx-border); }
	.ed-sec h3 { font-size: 13px; font-weight: 700; margin: 0 0 10px; }
	.ed-widths { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	.ed-widths button { padding: 8px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-surface); }
	.ed-widths button.on { border-color: var(--nx-header-accent); background: var(--nx-header-accent-soft); font-weight: 600; }
	.ed-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
	.ed-label { font-weight: 600; }
	.ed-field input[type=checkbox] { align-self: flex-start; width: 18px; height: 18px; accent-color: var(--nx-header-accent); }
	.ed-help { font-size: 12px; color: var(--nx-text-muted); line-height: 1.4; }
	.ed-note { font-size: 13px; color: var(--nx-text-muted); line-height: 1.5; padding: 10px; background: var(--nx-bg); border-radius: var(--nx-r-controle, 6px); }
	.ed-note a, .ed-right a { color: var(--nx-header-accent); }
	.ed-keys { margin: 0 0 6px; color: var(--nx-text-muted); font-size: 13px; }
	.ed-keys kbd { display: inline-block; padding: 0 5px; border: 1px solid var(--nx-border); border-radius: 3px; font: 12px/18px var(--nx-font, inherit); color: var(--nx-text); background: var(--nx-bg); }
	.ed-foot { display: flex; align-items: center; gap: 10px; padding: 12px; border-top: 1px solid var(--nx-border); background: var(--nx-surface); }
	.ed-save { flex: 1; margin: 0; font-size: 12px; color: var(--nx-text-muted); line-height: 1.4; }
	.ed-save strong { color: var(--nx-ok); }
	.ed-save--error { color: var(--nx-bad); }

	.ed-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 70; display: flex; align-items: center; gap: 14px; padding: 10px 14px; background: var(--nx-text); color: var(--nx-bg); border-radius: var(--nx-r-controle, 6px); box-shadow: 0 8px 24px rgb(0 0 0 / .2); }
	.ed-toast button { font-weight: 700; text-decoration: underline; color: inherit; }

	button { cursor: pointer; background: none; border: 0; font: inherit; color: inherit; }
	button:focus-visible, a:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }

	/* L'éditeur se travaille sur ordinateur ; en dessous, la page passe seule et les panneaux s'empilent */
	@media (max-width: 1100px) {
		.ed-body { grid-template-columns: 220px minmax(0, 1fr) 260px; }
		.ed-devices { display: none; }
	}
</style>
