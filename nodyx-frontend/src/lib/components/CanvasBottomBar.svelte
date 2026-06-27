<script lang="ts">
	import type { ViewTransform } from '$lib/canvas'

	let {
		transform,
		canUndo     = false,
		canRedo     = false,
		showGrid    = $bindable(true),
		snapEnabled = $bindable(false),
		bgColor     = $bindable('#0a0a12'),
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
		bgColor:     string
		onZoomIn:    () => void
		onZoomOut:   () => void
		onResetView: () => void
		onUndo:      () => void
		onRedo:      () => void
	} = $props()

	const pct = $derived(Math.round(transform.scale * 100))

	const BG_PRESETS = [
		// Sombres
		{ color: '#0a0a12', label: 'Nuit'        },
		{ color: '#0f172a', label: 'Minuit'      },
		{ color: '#111827', label: 'Ardoise'     },
		{ color: '#1c1917', label: 'Charbon'     },
		{ color: '#030712', label: 'Encre'       },
		{ color: '#0e1117', label: 'Obsidienne'  },
		{ color: '#18181b', label: 'Zinc'        },
		// Colorés sombres
		{ color: '#0a1628', label: 'Océan'       },
		{ color: '#0d1f0d', label: 'Forêt'       },
		{ color: '#1a0a1a', label: 'Prune'       },
		{ color: '#1a1430', label: 'Lavande'     },
		{ color: '#1a0f0a', label: 'Braise'      },
		{ color: '#0d1a14', label: 'Émeraude'    },
		{ color: '#0f1a1a', label: 'Pétrole'     },
		// Clairs
		{ color: '#f8fafc', label: 'Blanc'       },
		{ color: '#faf7f2', label: 'Papier'      },
		{ color: '#e8f4f8', label: 'Ciel pâle'   },
		{ color: '#fef3c7', label: 'Soleil doux' },
		{ color: '#f0fdf4', label: 'Menthe'      },
		{ color: '#fdf2f8', label: 'Rose pâle'   },
		{ color: '#fffbeb', label: 'Ivoire'      },
	]

	const isCustomColor = $derived(!BG_PRESETS.some(p => p.color === bgColor))

	let colorPickerEl: HTMLInputElement
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

	<div class="sep-v"></div>

	<!-- Background -->
	<div class="bg-section">
		<span class="bg-label">Fond</span>
		<div class="bg-grid">
			{#each BG_PRESETS as preset}
				<button
					class="bg-swatch"
					class:active={bgColor === preset.color}
					style="background:{preset.color};"
					onclick={() => bgColor = preset.color}
					title={preset.label}
					aria-label="Fond {preset.label}"
				></button>
			{/each}

			<!-- Color picker custom -->
			<button
				class="bg-swatch bg-picker"
				class:active={isCustomColor}
				style={isCustomColor ? `background:${bgColor};` : ''}
				onclick={() => colorPickerEl.click()}
				title="Couleur personnalisée"
				aria-label="Couleur personnalisée"
			>
				{#if !isCustomColor}
					<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"/>
						<path d="M12 2a10 10 0 0 1 0 20" fill="url(#rg)"/>
					</svg>
				{/if}
			</button>
			<input
				bind:this={colorPickerEl}
				type="color"
				value={bgColor}
				oninput={(e) => bgColor = (e.target as HTMLInputElement).value}
				style="position:absolute; opacity:0; pointer-events:none; width:0; height:0;"
				tabindex="-1"
				aria-hidden="true"
			/>
		</div>
	</div>

	<div class="sep-v"></div>
	<span class="hint">Molette: zoom · Espace+drag: pan</span>
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
		box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgb(var(--nx-accent-2-rgb) / 0.05);
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
		background: rgb(var(--nx-accent-2-rgb) / 0.18);
		color: var(--nx-accent-2-soft);
	}
	.bar-btn.toggle.on:hover { background: rgb(var(--nx-accent-2-rgb) / 0.25); }

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

	.bg-section {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 4px 8px;
	}

	.bg-label {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #374151;
		line-height: 1;
		text-align: center;
	}

	.bg-grid {
		display: grid;
		grid-template-columns: repeat(8, 14px);
		gap: 3px;
		position: relative;
	}

	.bg-swatch {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1.5px solid rgba(255,255,255,0.10);
		cursor: pointer;
		transition: all 0.12s;
		flex-shrink: 0;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.bg-swatch:hover {
		transform: scale(1.25);
		border-color: rgba(255,255,255,0.35);
		z-index: 1;
	}
	.bg-swatch.active {
		border-color: var(--nx-accent-soft);
		box-shadow: 0 0 0 2px rgba(129,140,248,0.45);
		transform: scale(1.2);
		z-index: 1;
	}

	.bg-picker {
		background: conic-gradient(
			#f87171, #fb923c, #fbbf24, #4ade80,
			#22d3ee, var(--nx-accent-soft), #e879f9, #f87171
		);
		border-color: rgba(255,255,255,0.2);
		color: transparent;
	}
	.bg-picker:hover { border-color: rgba(255,255,255,0.5); }
	.bg-picker.active { border-color: var(--nx-accent-soft); }
</style>
