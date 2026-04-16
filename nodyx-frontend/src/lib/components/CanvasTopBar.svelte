<script lang="ts">
	import type { CanvasTool, AdvancedShape } from '$lib/canvas'

	let {
		tool              = $bindable<CanvasTool>('pen'),
		color             = $bindable('#e879f9'),
		lineWidth         = $bindable(3),
		textBold          = $bindable(false),
		textItalic        = $bindable(false),
		textUnderline     = $bindable(false),
		textStrike        = $bindable(false),
		textAlign         = $bindable<'left'|'center'|'right'>('left'),
		textFontSize      = $bindable(18),
		textFontFamily    = $bindable<'sans'|'serif'|'mono'>('sans'),
		shapeFill         = $bindable(true),
		shapeStroke       = $bindable('#7c3aed'),
		shapeStrokeW      = $bindable(2),
		shapeType         = $bindable<AdvancedShape>('triangle'),
		arrowStyle        = $bindable<'solid'|'dashed'|'dotted'>('solid'),
		arrowEndCap       = $bindable<'arrow'|'none'|'dot'>('arrow'),
		connectorType     = $bindable<'straight'|'bezier'|'elbow'>('bezier'),
		connectorStyle    = $bindable<'solid'|'dashed'|'dotted'>('solid'),
		connectorStartCap = $bindable<'none'|'arrow'|'dot'>('none'),
		connectorEndCap   = $bindable<'none'|'arrow'|'dot'>('arrow'),
	}: {
		tool:              CanvasTool
		color:             string
		lineWidth:         number
		textBold:          boolean
		textItalic:        boolean
		textUnderline:     boolean
		textStrike:        boolean
		textAlign:         'left'|'center'|'right'
		textFontSize:      number
		textFontFamily:    'sans'|'serif'|'mono'
		shapeFill:         boolean
		shapeStroke:       string
		shapeStrokeW:      number
		shapeType:         AdvancedShape
		arrowStyle:        'solid'|'dashed'|'dotted'
		arrowEndCap:       'arrow'|'none'|'dot'
		connectorType:     'straight'|'bezier'|'elbow'
		connectorStyle:    'solid'|'dashed'|'dotted'
		connectorStartCap: 'none'|'arrow'|'dot'
		connectorEndCap:   'none'|'arrow'|'dot'
	} = $props()

	const PRESET_COLORS = [
		'#e879f9','#a855f7','#3b82f6','#06b6d4','#10b981',
		'#eab308','#f97316','#ef4444','#f8fafc','#1e293b',
	]

	const STICKY_COLORS = [
		'#fef08a','#fca5a5','#86efac','#93c5fd','#c4b5fd',
		'#fdba74','#ffffff','#1e293b',
	]

	const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64]
	const LINE_WIDTHS = [1, 2, 3, 5, 8, 12]
</script>

{#if tool !== 'select' && tool !== 'image' && tool !== 'frame' && tool !== 'eraser'}
<div class="top-bar">

	<!-- ── PEN ───────────────────────────────────── -->
	{#if tool === 'pen'}
		<div class="section">
			<label class="label">Couleur</label>
			<div class="color-strip">
				{#each PRESET_COLORS as c}
					<button
						class="swatch"
						class:selected={color === c}
						style="background:{c}"
						onclick={() => color = c}
						aria-label={c}
					></button>
				{/each}
				<div class="color-pick" title="Couleur personnalisée">
					<input type="color" bind:value={color} aria-label="Couleur personnalisée"/>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;pointer-events:none">
						<path d="M12 3v1m0 16v1M5.05 5.05l.707.707m12.728 12.728.707.707M3 12h1m16 0h1M5.05 18.95l.707-.707M18.243 5.757l.707-.707"/>
					</svg>
				</div>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Épaisseur</label>
			<div class="row gap4">
				{#each LINE_WIDTHS as w}
					<button
						class="width-btn"
						class:selected={lineWidth === w}
						onclick={() => lineWidth = w}
						title="{w}px"
					>
						<span class="width-dot" style="width:{Math.min(w*2,14)}px;height:{Math.min(w*2,14)}px"></span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── TEXT ──────────────────────────────────── -->
	{#if tool === 'text'}
		<div class="section">
			<div class="row gap2">
				<button class="fmt-btn" class:on={textBold}      onclick={() => textBold      = !textBold}      title="Gras (Ctrl+B)"><b>B</b></button>
				<button class="fmt-btn italic-btn" class:on={textItalic}    onclick={() => textItalic    = !textItalic}    title="Italique (Ctrl+I)"><i>I</i></button>
				<button class="fmt-btn underline-btn" class:on={textUnderline} onclick={() => textUnderline = !textUnderline} title="Souligné (Ctrl+U)"><u>U</u></button>
				<button class="fmt-btn strike-btn" class:on={textStrike}    onclick={() => textStrike    = !textStrike}    title="Barré"><s>S</s></button>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<div class="row gap2">
				{#each (['left','center','right'] as const) as a}
					<button class="icon-btn" class:on={textAlign === a} onclick={() => textAlign = a} title="Aligner {a}">
						{#if a === 'left'}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:15px;height:15px"><path d="M3 6h12M3 12h18M3 18h12"/></svg>
						{:else if a === 'center'}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:15px;height:15px"><path d="M6 6h12M3 12h18M6 18h12"/></svg>
						{:else}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:15px;height:15px"><path d="M9 6h12M3 12h18M9 18h12"/></svg>
						{/if}
					</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Taille</label>
			<div class="row gap2">
				<button class="icon-btn" onclick={() => textFontSize = Math.max(8, textFontSize - 2)}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M5 12h14"/></svg>
				</button>
				<span class="size-val">{textFontSize}</span>
				<button class="icon-btn" onclick={() => textFontSize = Math.min(120, textFontSize + 2)}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M12 5v14M5 12h14"/></svg>
				</button>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Police</label>
			<div class="row gap2">
				{#each ([['sans','Sans'],['serif','Serif'],['mono','Mono']] as const) as [f, label]}
					<button class="font-btn" class:on={textFontFamily === f} onclick={() => textFontFamily = f}
					        style="font-family:{f === 'sans' ? 'Inter,sans-serif' : f === 'serif' ? 'Georgia,serif' : 'monospace'}">{label}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Couleur</label>
			<div class="color-strip compact">
				{#each PRESET_COLORS.slice(0,6) as c}
					<button class="swatch sm" class:selected={color === c} style="background:{c}" onclick={() => color = c} aria-label={c}></button>
				{/each}
				<div class="color-pick sm">
					<input type="color" bind:value={color} aria-label="Couleur personnalisée"/>
				</div>
			</div>
		</div>
	{/if}

	<!-- ── STICKY ─────────────────────────────────── -->
	{#if tool === 'sticky'}
		<div class="section">
			<label class="label">Couleur du post-it</label>
			<div class="color-strip">
				{#each STICKY_COLORS as c}
					<button
						class="swatch"
						class:selected={color === c}
						style="background:{c}; border-color:{c === '#ffffff' ? '#d1d5db' : c}"
						onclick={() => color = c}
						aria-label={c}
					></button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── RECT / CIRCLE ──────────────────────────── -->
	{#if tool === 'rect' || tool === 'circle'}
		<div class="section">
			<label class="label">Remplissage</label>
			<div class="row gap4">
				<button class="fill-toggle" class:on={shapeFill} onclick={() => shapeFill = !shapeFill} title="Remplissage">
					{#if shapeFill}
						<svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
					{:else}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:16px;height:16px"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
					{/if}
				</button>
				<div class="color-pick inline" title="Couleur remplissage">
					<input type="color" bind:value={color} aria-label="Couleur remplissage"/>
					<span class="swatch sm noclick" style="background:{color}"></span>
				</div>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Contour</label>
			<div class="row gap4">
				<div class="color-pick inline">
					<input type="color" bind:value={shapeStroke} aria-label="Couleur contour"/>
					<span class="swatch sm noclick" style="background:{shapeStroke}"></span>
				</div>
				<div class="row gap2">
					{#each [1,2,3,5] as w}
						<button class="width-btn sm" class:selected={shapeStrokeW === w} onclick={() => shapeStrokeW = w}>
							<span class="width-dot" style="width:{Math.min(w*2.5,12)}px;height:{Math.min(w*2.5,12)}px"></span>
						</button>
					{/each}
				</div>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Couleur de trait</label>
			<div class="color-strip compact">
				{#each PRESET_COLORS.slice(0,7) as c}
					<button class="swatch sm" class:selected={shapeStroke === c} style="background:{c}" onclick={() => shapeStroke = c} aria-label={c}></button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── SHAPE ─────────────────────────────────── -->
	{#if tool === 'shape'}
		<div class="section">
			<label class="label">Forme</label>
			<div class="row gap2">
				{#each ([
					['triangle','△'],['diamond','◇'],['star','★'],
					['hexagon','⬡'],['cloud','☁'],
				] as const) as [s, icon]}
					<button class="dash-btn shape-pick" class:on={shapeType === s}
					        onclick={() => shapeType = s} title={s}>{icon}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Remplissage</label>
			<div class="row gap4">
				<button class="fill-toggle" class:on={shapeFill} onclick={() => shapeFill = !shapeFill} title="Remplissage">
					{#if shapeFill}
						<svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><polygon points="12,3 22,20 2,20"/></svg>
					{:else}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:16px;height:16px"><polygon points="12,3 22,20 2,20"/></svg>
					{/if}
				</button>
				<div class="color-pick inline" title="Couleur remplissage">
					<input type="color" bind:value={color} aria-label="Couleur remplissage"/>
					<span class="swatch sm noclick" style="background:{color}"></span>
				</div>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Contour</label>
			<div class="row gap4">
				<div class="color-pick inline">
					<input type="color" bind:value={shapeStroke} aria-label="Couleur contour"/>
					<span class="swatch sm noclick" style="background:{shapeStroke}"></span>
				</div>
				<div class="row gap2">
					{#each [1,2,3,5] as w}
						<button class="width-btn sm" class:selected={shapeStrokeW === w} onclick={() => shapeStrokeW = w}>
							<span class="width-dot" style="width:{Math.min(w*2.5,12)}px;height:{Math.min(w*2.5,12)}px"></span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- ── CONNECTOR ──────────────────────────────── -->
	{#if tool === 'connector'}
		<div class="section">
			<label class="label">Type</label>
			<div class="row gap2">
				{#each ([['straight','──'],['bezier','⌒'],['elbow','⌐']] as const) as [t, icon]}
					<button class="dash-btn" class:on={connectorType === t}
					        onclick={() => connectorType = t} title={t}>{icon}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Style</label>
			<div class="row gap2">
				{#each ([['solid','─────'],['dashed','- - -'],['dotted','·····']] as const) as [s, label]}
					<button class="dash-btn" class:on={connectorStyle === s} onclick={() => connectorStyle = s}>{label}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Début</label>
			<div class="row gap2">
				{#each ([['none','─'],['arrow','←'],['dot','●']] as const) as [cap, icon]}
					<button class="dash-btn" class:on={connectorStartCap === cap}
					        onclick={() => connectorStartCap = cap}>{icon}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Fin</label>
			<div class="row gap2">
				{#each ([['none','─'],['arrow','→'],['dot','●']] as const) as [cap, icon]}
					<button class="dash-btn" class:on={connectorEndCap === cap}
					        onclick={() => connectorEndCap = cap}>{icon}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Couleur</label>
			<div class="color-strip compact">
				{#each PRESET_COLORS.slice(0,7) as c}
					<button class="swatch sm" class:selected={color === c} style="background:{c}" onclick={() => color = c} aria-label={c}></button>
				{/each}
				<div class="color-pick sm"><input type="color" bind:value={color} aria-label="Couleur"/></div>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Épaisseur</label>
			<div class="row gap2">
				{#each [1,2,3,5] as w}
					<button class="width-btn sm" class:selected={lineWidth === w} onclick={() => lineWidth = w}>
						<span class="width-dot" style="width:{Math.min(w*3,13)}px;height:{Math.min(w*3,13)}px"></span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── ARROW ──────────────────────────────────── -->
	{#if tool === 'arrow'}
		<div class="section">
			<label class="label">Couleur</label>
			<div class="color-strip compact">
				{#each PRESET_COLORS.slice(0,7) as c}
					<button class="swatch sm" class:selected={color === c} style="background:{c}" onclick={() => color = c} aria-label={c}></button>
				{/each}
				<div class="color-pick sm"><input type="color" bind:value={color} aria-label="Couleur"/></div>
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Style</label>
			<div class="row gap2">
				{#each ([['solid','─────'],['dashed','- - -'],['dotted','·····']] as const) as [s, label]}
					<button class="dash-btn" class:on={arrowStyle === s} onclick={() => arrowStyle = s}>{label}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Pointe</label>
			<div class="row gap2">
				{#each ([['arrow','→'],['dot','●'],['none','─']] as const) as [cap, icon]}
					<button class="dash-btn" class:on={arrowEndCap === cap} onclick={() => arrowEndCap = cap}>{icon}</button>
				{/each}
			</div>
		</div>
		<div class="divider"></div>
		<div class="section">
			<label class="label">Épaisseur</label>
			<div class="row gap2">
				{#each [1,2,3,5] as w}
					<button class="width-btn sm" class:selected={lineWidth === w} onclick={() => lineWidth = w}>
						<span class="width-dot" style="width:{Math.min(w*3,13)}px;height:{Math.min(w*3,13)}px"></span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

</div>
{/if}

<style>
	.top-bar {
		display: flex;
		align-items: center;
		gap: 0;
		padding: 8px 12px;
		background: rgba(10, 10, 18, 0.94);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 14px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.06);
		user-select: none;
		white-space: nowrap;
		max-width: calc(100vw - 140px);
		overflow-x: auto;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 0 8px;
	}

	.divider {
		width: 1px;
		height: 36px;
		background: rgba(255,255,255,0.06);
		flex-shrink: 0;
	}

	.label {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #4b5563;
	}

	.row { display: flex; align-items: center; }
	.gap2 { gap: 2px; }
	.gap4 { gap: 6px; }

	.color-strip {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.color-strip.compact { gap: 3px; }

	.swatch {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		transition: all 0.1s;
		flex-shrink: 0;
	}
	.swatch.sm { width: 16px; height: 16px; }
	.swatch:hover { transform: scale(1.15); }
	.swatch.selected { border-color: white; box-shadow: 0 0 0 1px rgba(255,255,255,0.4); }
	.swatch.noclick { pointer-events: none; }

	.color-pick {
		position: relative;
		width: 26px;
		height: 26px;
		border-radius: 8px;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.1);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		overflow: hidden;
		flex-shrink: 0;
		color: #6b7280;
	}
	.color-pick.sm { width: 20px; height: 20px; border-radius: 50%; }
	.color-pick.inline { width: auto; height: auto; background: none; border: none; padding: 0; overflow: visible; }
	.color-pick input[type="color"] {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
		border: none;
		padding: 0;
	}
	.color-pick.inline input[type="color"] { position: absolute; width: 24px; height: 24px; }

	/* Format buttons (B I U S) */
	.fmt-btn {
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: #9ca3af;
		cursor: pointer;
		font-size: 13px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.1s;
	}
	.fmt-btn:hover { background: rgba(255,255,255,0.06); color: white; }
	.fmt-btn.on { background: rgba(124,58,237,0.25); color: #a78bfa; }
	.italic-btn { font-style: italic; }
	.underline-btn { text-decoration: underline; }
	.strike-btn { text-decoration: line-through; }

	.icon-btn {
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: #9ca3af;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.1s;
	}
	.icon-btn:hover { background: rgba(255,255,255,0.06); color: white; }
	.icon-btn.on { background: rgba(124,58,237,0.25); color: #a78bfa; }

	.size-val {
		font-size: 12px;
		font-weight: 600;
		color: #d1d5db;
		min-width: 22px;
		text-align: center;
	}

	.font-btn {
		padding: 2px 8px;
		height: 24px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		font-size: 11px;
		font-weight: 500;
		transition: all 0.1s;
	}
	.font-btn:hover { background: rgba(255,255,255,0.06); color: #d1d5db; }
	.font-btn.on { background: rgba(124,58,237,0.2); color: #a78bfa; }

	.fill-toggle {
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 6px;
		background: rgba(255,255,255,0.04);
		color: #6b7280;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.1s;
	}
	.fill-toggle:hover { background: rgba(255,255,255,0.08); color: #d1d5db; }
	.fill-toggle.on { background: rgba(124,58,237,0.2); color: #a78bfa; }

	.width-btn {
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.1s;
	}
	.width-btn:hover { background: rgba(255,255,255,0.06); }
	.width-btn.selected { background: rgba(124,58,237,0.25); }
	.width-btn.sm { width: 24px; height: 24px; }

	.width-dot {
		border-radius: 50%;
		background: #9ca3af;
		display: block;
		flex-shrink: 0;
	}
	.width-btn.selected .width-dot { background: #a78bfa; }

	.dash-btn {
		padding: 2px 7px;
		height: 24px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		font-size: 11px;
		font-family: monospace;
		transition: all 0.1s;
	}
	.dash-btn:hover { background: rgba(255,255,255,0.06); color: #d1d5db; }
	.dash-btn.on { background: rgba(124,58,237,0.2); color: #a78bfa; }
</style>
