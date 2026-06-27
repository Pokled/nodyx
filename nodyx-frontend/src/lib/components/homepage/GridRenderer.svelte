<script lang="ts">
	import type { GridLayout, GridTheme, GridRow, GridColumn } from '$lib/types/homepage'
	import { DEFAULT_THEME, autoSpanMd, autoSpanSm } from '$lib/types/homepage'
	import { PLUGIN_REGISTRY } from './plugins'
	import DynamicWidget from './DynamicWidget.svelte'

	interface Props {
		layout:           GridLayout
		theme?:           Partial<GridTheme>
		instance?:        Record<string, unknown>
		user?:            Record<string, unknown> | null
		installedWidgets?: Record<string, { entry: string; [k: string]: unknown }>
		// Mode édition : affiche overlays, handles, slots vides
		editMode?:         boolean
		// Callbacks édition
		onRowDragStart?:   (e: PointerEvent, rowId: string) => void
		onColClick?:       (rowId: string, colId: string) => void
		onAddWidget?:      (rowId: string, colId: string) => void
		onRowSettings?:    (rowId: string) => void
		onRowDelete?:      (rowId: string) => void
		onResizeStart?:    (e: PointerEvent, rowId: string, colIdx: number) => void
		// Highlight pour drag feedback
		dragOverRowId?:    string | null
		selectedColKey?:   string | null  // 'rowId:colId'
	}

	let {
		layout,
		theme = {},
		instance = {},
		user = null,
		installedWidgets = {},
		editMode = false,
		onRowDragStart,
		onColClick,
		onAddWidget,
		onRowSettings,
		onRowDelete,
		onResizeStart,
		dragOverRowId = null,
		selectedColKey = null,
	}: Props = $props()

	const t = $derived({ ...DEFAULT_THEME, ...theme } as GridTheme)

	// ── CSS custom properties thème ──────────────────────────────────────────
	const cssVars = $derived([
		`--np: ${t.primary}`,
		`--na: ${t.accent}`,
		`--nb: ${t.bg}`,
		`--nc: ${t.card_bg}`,
		`--nborder: ${t.border_color}`,
		`--nr: ${t.border_radius}`,
		`--nfont: ${t.font_family}, Inter, sans-serif`,
		`--nfs: ${t.font_size_base}`,
		`--nfwh: ${t.font_weight_heading}`,
		`--nt: ${t.text_primary}`,
		`--ntm: ${t.text_secondary}`,
		`--nsh: ${t.shadow}`,
	].join('; '))

	// ── Helpers span responsive ──────────────────────────────────────────────
	function colSpanMd(col: GridColumn): number {
		return col.span_md ?? autoSpanMd(col.span)
	}
	function colSpanSm(col: GridColumn): number {
		return col.span_sm ?? autoSpanSm(col.span)
	}

	// ── Rendu widget ────────────────────────────────────────────────────────
	function getPlugin(widgetType: string) {
		return PLUGIN_REGISTRY[widgetType] ?? null
	}
	function getDynamic(widgetType: string) {
		return installedWidgets[widgetType] ?? null
	}

	function colKey(row: GridRow, col: GridColumn) {
		return `${row.id}:${col.id}`
	}
</script>

<!-- Injecter les CSS vars thème sur le conteneur racine -->
<div class="gr-root" style="{cssVars}; background: var(--nb); font-family: var(--nfont); font-size: var(--nfs); color: var(--nt)">
	{#each layout.rows as row (row.id)}
		<!-- ── ROW ─────────────────────────────────────────────────────────── -->
		<div
			class="gr-row"
			class:gr-row--edit={editMode}
			class:gr-row--dragover={dragOverRowId === row.id}
			style="
				gap: {row.gap};
				padding-top: {editMode ? '28px' : row.padding_y};
				padding-bottom: {row.padding_y};
				{row.bg_override ? `background: ${row.bg_override};` : ''}
			"
			data-row-id={row.id}
		>
			{#if editMode}
				<!-- ── Barre de contrôle row (inside, top) ── -->
				<div class="gr-row-bar">
					<button
						class="gr-row-bar-handle"
						title="Déplacer la ligne"
						onpointerdown={(e) => onRowDragStart?.(e, row.id)}
					>⠿ déplacer</button>
					<div class="gr-row-bar-actions">
						<button class="gr-row-btn" title="Paramètres" onclick={() => onRowSettings?.(row.id)}>⚙</button>
						<button class="gr-row-btn gr-row-btn--del" title="Supprimer" onclick={() => onRowDelete?.(row.id)}>✕</button>
					</div>
				</div>
			{/if}

			{#each row.columns as col, colIdx (col.id)}
				{@const plugin  = col.widget ? getPlugin(col.widget) : null}
				{@const dynamic = col.widget ? getDynamic(col.widget) : null}
				{@const isSelected = selectedColKey === colKey(row, col)}

				<!-- ── COLUMN ──────────────────────────────────────────────── -->
				<div
					class="gr-col"
					class:gr-col--edit={editMode}
					class:gr-col--empty={!col.widget && editMode}
					class:gr-col--selected={isSelected}
					class:hide-mobile={col.hide_mobile}
					class:hide-tablet={col.hide_tablet}
					style="
						--col-span: {col.span};
						--col-span-md: {colSpanMd(col)};
						--col-span-sm: {colSpanSm(col)};
					"
					onclick={() => editMode && col.widget && onColClick?.(row.id, col.id)}
					role={editMode && col.widget ? 'button' : undefined}
				>
					{#if plugin}
						<plugin.component
							config={col.config}
							{instance}
							{user}
							title={col.title}
						/>
					{:else if dynamic}
						<DynamicWidget
							widgetId={col.widget ?? ''}
							entry={dynamic.entry}
							config={col.config}
							{instance}
							{user}
							title={col.title}
						/>
					{:else if editMode}
						<!-- Colonne vide en mode éditeur -->
						<button class="gr-col-empty-btn" onclick={() => onAddWidget?.(row.id, col.id)}>
							<span class="gr-col-empty-icon">＋</span>
							<span class="gr-col-empty-label">Ajouter un widget</span>
							<span class="gr-col-empty-hint">span {col.span}/12</span>
						</button>
					{/if}

					{#if editMode && col.widget}
						<!-- Badge edit/supprimer sur le widget -->
						<div class="gr-col-overlay">
							<button class="gr-col-overlay-btn" onclick={(e) => { e.stopPropagation(); onColClick?.(row.id, col.id) }}>⚙ Config</button>
							<button class="gr-col-overlay-btn gr-col-overlay-btn--add" onclick={(e) => { e.stopPropagation(); onAddWidget?.(row.id, col.id) }}>↩ Changer</button>
						</div>
					{/if}

					{#if editMode && colIdx < row.columns.length - 1}
						<!-- Poignée resize — à l'intérieur de la colonne, bord droit, abs positionné
						     → hors du flux CSS Grid, n'occupe pas de cellule -->
						<button
							class="gr-resize-handle"
							title="Redimensionner les colonnes"
							onpointerdown={(e) => { e.stopPropagation(); onResizeStart?.(e, row.id, colIdx) }}
						>◀▶</button>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>

<style>
	/* ── Root ──────────────────────────────────────────────────────────────── */
	.gr-root {
		width: 100%;
		overflow-x: hidden;
	}

	/* ── Row ───────────────────────────────────────────────────────────────── */
	.gr-row {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		width: 100%;
		min-width: 0;
		position: relative; /* ancre pour gr-row-handle et gr-row-actions (absolus) */
		transition: outline 0.15s;
	}

	.gr-row--edit {
		outline: 1px dashed rgba(167,139,250,.2);
		outline-offset: 2px;
	}
	.gr-row--edit:hover {
		outline-color: rgba(167,139,250,.5);
	}
	.gr-row--dragover {
		outline: 2px solid var(--nx-accent-2-soft) !important;
		background: rgba(167,139,250,.05) !important;
	}

	/* ── Row control bar (inside, top) ────────────────────────────────────── */
	.gr-row-bar {
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 6px 0 4px;
		background: rgba(167,139,250,.08);
		border-bottom: 1px solid rgba(167,139,250,.18);
		z-index: 15;
		opacity: 0;
		transition: opacity 0.15s;
		/* Span toutes les colonnes de la grille */
		grid-column: 1 / -1;
		pointer-events: none;
	}
	.gr-row--edit:hover .gr-row-bar {
		opacity: 1;
		pointer-events: all;
	}
	.gr-row--dragover .gr-row-bar {
		opacity: 1;
		pointer-events: all;
	}

	.gr-row-bar-handle {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		font-size: 11px;
		font-weight: 600;
		color: var(--nx-accent-2-soft);
		background: rgba(167,139,250,.12);
		border: 1px solid rgba(167,139,250,.3);
		border-radius: 3px;
		cursor: grab;
		user-select: none;
		letter-spacing: .02em;
	}
	.gr-row-bar-handle:active { cursor: grabbing; }

	.gr-row-bar-actions {
		display: flex;
		gap: 3px;
	}

	.gr-row-btn {
		padding: 1px 8px;
		font-size: 11px;
		background: rgba(13,13,18,.9);
		border: 1px solid rgba(167,139,250,.3);
		color: var(--nx-accent-2-soft);
		cursor: pointer;
		border-radius: 3px;
		height: 20px;
		display: flex;
		align-items: center;
	}
	.gr-row-btn--del {
		color: #f87171;
		border-color: rgba(248,113,113,.3);
	}

	/* ── Column ────────────────────────────────────────────────────────────── */
	.gr-col {
		grid-column: span var(--col-span);
		min-width: 0;
		overflow: hidden;
		position: relative;
	}

	.gr-col--edit {
		transition: outline 0.1s;
	}
	.gr-col--edit:hover:not(.gr-col--empty) {
		outline: 1px solid rgba(167,139,250,.4);
		outline-offset: -1px;
	}
	.gr-col--selected {
		outline: 2px solid var(--nx-accent-2-soft) !important;
		outline-offset: -1px;
	}
	.gr-col--empty {
		min-height: 80px;
	}

	/* ── Column overlay (hover actions) ───────────────────────────────────── */
	.gr-col-overlay {
		position: absolute;
		inset: 0;
		background: rgba(5,5,10,.6);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		opacity: 0;
		transition: opacity 0.15s;
		pointer-events: none;
		z-index: 5;
	}
	.gr-col--edit:hover .gr-col-overlay {
		opacity: 1;
		pointer-events: all;
	}
	.gr-col--selected .gr-col-overlay {
		opacity: 1;
		pointer-events: all;
	}

	.gr-col-overlay-btn {
		padding: 4px 12px;
		font-size: 11px;
		background: rgba(167,139,250,.2);
		border: 1px solid rgba(167,139,250,.4);
		color: #e2e8f0;
		cursor: pointer;
		border-radius: 4px;
		white-space: nowrap;
	}
	.gr-col-overlay-btn--add {
		background: rgb(var(--nx-cyan-rgb) / .15);
		border-color: rgb(var(--nx-cyan-rgb) / .3);
	}

	/* ── Empty column slot ─────────────────────────────────────────────────── */
	.gr-col-empty-btn {
		width: 100%;
		min-height: 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		background: rgba(167,139,250,.04);
		border: 1px dashed rgba(167,139,250,.25);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
		border-radius: 4px;
		padding: 16px;
	}
	.gr-col-empty-btn:hover {
		background: rgba(167,139,250,.1);
		border-color: rgba(167,139,250,.5);
	}
	.gr-col-empty-icon { font-size: 20px; color: var(--nx-accent-2-soft); }
	.gr-col-empty-label { font-size: 12px; color: #e2e8f0; }
	.gr-col-empty-hint { font-size: 10px; color: #6b7280; }

	/* ── Resize handle ─────────────────────────────────────────────────────── */
	/* Positionné DANS la colonne (bord droit), abs → ne consomme aucune cellule CSS Grid */
	.gr-resize-handle {
		position: absolute;
		right: -8px;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		min-height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		color: var(--nx-accent-2-soft);
		background: rgba(167,139,250,.15);
		border: 1px solid rgba(167,139,250,.3);
		cursor: col-resize;
		z-index: 20;
		border-radius: 3px;
		opacity: 0;
		transition: opacity 0.15s;
		padding: 0;
	}
	.gr-col--edit:hover .gr-resize-handle { opacity: 1; }
	.gr-resize-handle:hover {
		background: rgba(167,139,250,.35);
		border-color: var(--nx-accent-2-soft);
		opacity: 1;
	}

	/* ── Responsive ─────────────────────────────────────────────────────────── */
	@media (min-width: 640px) and (max-width: 1023px) {
		.gr-col { grid-column: span var(--col-span-md); }
		:global(.hide-tablet) { display: none !important; }
	}
	@media (max-width: 639px) {
		.gr-col { grid-column: span var(--col-span-sm); }
		:global(.hide-mobile) { display: none !important; }
	}

	/* ── Touch targets mobile ───────────────────────────────────────────────── */
	@media (max-width: 639px) {
		.gr-root :global(a),
		.gr-root :global(button) {
			min-height: 44px;
			min-width: 44px;
		}
	}

	/* ── Safe area mobile ───────────────────────────────────────────────────── */
	.gr-root {
		padding-left:  max(0px, env(safe-area-inset-left));
		padding-right: max(0px, env(safe-area-inset-right));
	}
</style>
