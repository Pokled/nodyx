<script lang="ts">
	import type { ViewTransform } from '$lib/canvas'

	let {
		transform,
		canUndo     = false,
		canRedo     = false,
		showGrid    = $bindable(true),
		snapEnabled = $bindable(false),
		onZoomIn,
		onZoomOut,
		onResetView,
		onUndo,
		onRedo,
	}: {
		transform:   ViewTransform
		canUndo:     boolean
		canRedo:     boolean
		showGrid:    boolean
		snapEnabled: boolean
		onZoomIn:    () => void
		onZoomOut:   () => void
		onResetView: () => void
		onUndo:      () => void
		onRedo:      () => void
	} = $props()

	const pct = $derived(Math.round(transform.scale * 100))
</script>

<div class="bottom-bar">
	<!-- Undo / Redo -->
	<div class="group">
		<button class="bar-btn" class:disabled={!canUndo} onclick={onUndo} title="Annuler (Ctrl+Z)" disabled={!canUndo}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/>
			</svg>
		</button>
		<button class="bar-btn" class:disabled={!canRedo} onclick={onRedo} title="Rétablir (Ctrl+Y)" disabled={!canRedo}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/>
			</svg>
		</button>
	</div>

	<div class="sep-v"></div>

	<!-- Zoom -->
	<div class="group">
		<button class="bar-btn" onclick={onZoomOut} title="Dézoomer">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6"/>
			</svg>
		</button>
		<button class="zoom-val" onclick={onResetView} title="Réinitialiser la vue (100%)">
			{pct}%
		</button>
		<button class="bar-btn" onclick={onZoomIn} title="Zoomer">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6"/>
			</svg>
		</button>
	</div>

	<div class="sep-v"></div>

	<!-- Grid & Snap -->
	<div class="group">
		<button
			class="bar-btn toggle"
			class:on={showGrid}
			onclick={() => showGrid = !showGrid}
			title="Grille (G)"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round"
					d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/>
			</svg>
			<span class="toggle-label">Grille</span>
		</button>

		<button
			class="bar-btn toggle"
			class:on={snapEnabled}
			onclick={() => snapEnabled = !snapEnabled}
			title="Snap à la grille"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round"
					d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
			</svg>
			<span class="toggle-label">Snap</span>
		</button>
	</div>

	<!-- Hint -->
	<div class="sep-v"></div>
	<span class="hint">Molette: zoom · Espace+drag: déplacer</span>
</div>

<style>
	.bottom-bar {
		display: flex;
		align-items: center;
		gap: 0;
		padding: 6px 10px;
		background: rgba(10, 10, 18, 0.94);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 12px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(124,58,237,0.05);
		user-select: none;
	}

	.group {
		display: flex;
		align-items: center;
		gap: 1px;
		padding: 0 4px;
	}

	.sep-v {
		width: 1px;
		height: 24px;
		background: rgba(255,255,255,0.06);
		margin: 0 2px;
		flex-shrink: 0;
	}

	.bar-btn {
		width: 30px;
		height: 30px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.1s;
	}
	.bar-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #d1d5db; }
	.bar-btn:disabled, .bar-btn.disabled { opacity: 0.25; cursor: not-allowed; }
	.bar-btn svg { width: 16px; height: 16px; }

	.bar-btn.toggle {
		width: auto;
		padding: 0 8px;
		gap: 5px;
		font-size: 11px;
		font-weight: 500;
		color: #4b5563;
	}
	.bar-btn.toggle.on {
		background: rgba(124,58,237,0.18);
		color: #a78bfa;
	}
	.bar-btn.toggle.on:hover { background: rgba(124,58,237,0.25); }

	.toggle-label { font-size: 11px; font-weight: 500; }

	.zoom-val {
		min-width: 46px;
		height: 30px;
		border: none;
		border-radius: 8px;
		background: rgba(255,255,255,0.04);
		color: #e2e8f0;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.1s;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
		text-align: center;
	}
	.zoom-val:hover { background: rgba(255,255,255,0.08); }

	.hint {
		font-size: 10px;
		color: #374151;
		padding: 0 6px;
		white-space: nowrap;
	}
</style>
