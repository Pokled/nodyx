<!--
  Editeur de style canal : couleur du nom, bold/italic/underline, emoji icon.
  Liberté maximale, aucun garde-fou de goût.
  Affiche un live preview tel que rendu dans la sidebar.
-->
<script lang="ts">
	import ChannelIcon from '$lib/components/ChannelIcon.svelte'
	import { COLORE_CATEGORIES, SOBRE_CATEGORIES, isIconId } from '$lib/channelIcons'

	type Props = {
		type:           'text' | 'voice'
		name:           string
		name_color:     string | null
		name_bold:      boolean
		name_italic:    boolean
		name_underline: boolean
		icon_emoji:     string | null
		sidebarBg?:     string
		showLabel?:     boolean
	}

	let {
		type,
		name           = $bindable(''),
		name_color     = $bindable(null),
		name_bold      = $bindable(false),
		name_italic    = $bindable(false),
		name_underline = $bindable(false),
		icon_emoji     = $bindable(null),
		sidebarBg      = '#111827',
		showLabel      = true,
	}: Props = $props()

	const PRESETS = [
		'#ffffff', '#e2e8f0', '#a3e635', '#22d3ee',
		'#6366f1', '#a855f7', '#ec4899', '#ef4444',
		'#f59e0b', '#facc15', '#10b981', '#0ea5e9',
	]

	// Hex input mirror for typing
	let colorHex = $state(name_color ?? '')
	$effect(() => {
		colorHex = name_color ?? ''
	})

	function commitHex(v: string) {
		const trimmed = v.trim()
		if (trimmed === '') { name_color = null; return }
		const m = trimmed.match(/^#?[0-9A-Fa-f]{6}$/)
		if (m) name_color = trimmed.startsWith('#') ? trimmed : '#' + trimmed
	}

	function reset() {
		name_color     = null
		name_bold      = false
		name_italic    = false
		name_underline = false
		icon_emoji     = null
		colorHex       = ''
	}

	// Contraste WCAG (info seulement, jamais bloquant)
	function hexToRgb(h: string): [number, number, number] | null {
		const m = h.match(/^#?([0-9A-Fa-f]{6})$/)
		if (!m) return null
		const n = parseInt(m[1], 16)
		return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
	}
	function luminance([r, g, b]: [number, number, number]): number {
		const a = [r, g, b].map(v => {
			const x = v / 255
			return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
		})
		return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
	}
	const contrastRatio = $derived(() => {
		const fg = hexToRgb(name_color ?? '#e2e8f0')
		const bg = hexToRgb(sidebarBg)
		if (!fg || !bg) return null
		const Lfg = luminance(fg)
		const Lbg = luminance(bg)
		const ratio = (Math.max(Lfg, Lbg) + 0.05) / (Math.min(Lfg, Lbg) + 0.05)
		return Math.round(ratio * 10) / 10
	})

	const previewName  = $derived(name?.trim() || (type === 'voice' ? 'salon-vocal' : 'canal'))
	const previewFallback = $derived(type === 'voice' ? '🔊' : '#')
	const previewColor = $derived(name_color ?? '#9ca3af')

	// Onglets du picker : 0 = Coloré, 1 = Sobre, 2 = Personnalisé
	let pickerTab = $state(0)
</script>

<div class="cse-root">
	{#if showLabel}
		<div class="cse-section-label">Personnalisation visuelle</div>
	{/if}

	<!-- Live preview -->
	<div class="cse-preview" style="background: {sidebarBg}">
		<span class="cse-preview-row">
			<span class="cse-preview-icon">
				<ChannelIcon value={icon_emoji} fallback={previewFallback} size={16} color={previewColor} />
			</span>
			<span
				class="cse-preview-name"
				style="
					color: {previewColor};
					font-weight: {name_bold ? '700' : '400'};
					font-style: {name_italic ? 'italic' : 'normal'};
					text-decoration: {name_underline ? 'underline' : 'none'};
				"
			>{previewName}</span>
		</span>
		<span class="cse-preview-label">aperçu sidebar</span>
	</div>

	<div class="cse-grid">
		<!-- Couleur -->
		<div class="cse-field">
			<label for="cse-color" class="cse-label">Couleur du nom</label>
			<div class="cse-color-row">
				<input
					id="cse-color"
					type="color"
					value={name_color ?? '#9ca3af'}
					oninput={(e) => commitHex((e.currentTarget as HTMLInputElement).value)}
					class="cse-color-picker"
					title="Choisir une couleur"
				/>
				<input
					type="text"
					value={colorHex}
					placeholder="#RRGGBB"
					maxlength="7"
					oninput={(e) => { colorHex = (e.currentTarget as HTMLInputElement).value; commitHex(colorHex) }}
					class="cse-color-hex"
				/>
				<button type="button" class="cse-clear" onclick={() => { name_color = null; colorHex = '' }} title="Couleur par défaut">×</button>
			</div>
			<div class="cse-palette">
				{#each PRESETS as p}
					<button
						type="button"
						class="cse-swatch"
						style="background: {p}"
						title={p}
						aria-label="Couleur {p}"
						onclick={() => { name_color = p; colorHex = p }}
					></button>
				{/each}
			</div>
			{#if name_color && contrastRatio() !== null}
				{@const r = contrastRatio() as number}
				<p class="cse-contrast" class:cse-contrast--low={r < 3} class:cse-contrast--ok={r >= 4.5}>
					Contraste : {r}:1
					{#if r >= 4.5}<span>· lisible</span>
					{:else if r >= 3}<span>· acceptable</span>
					{:else}<span>· faible (mais c'est ton choix)</span>{/if}
				</p>
			{/if}
		</div>

		<!-- Style -->
		<div class="cse-field">
			<span class="cse-label">Style du texte</span>
			<div class="cse-style-row">
				<button
					type="button"
					class="cse-style-btn"
					class:cse-style-btn--active={name_bold}
					onclick={() => name_bold = !name_bold}
					title="Gras"
				><b>B</b></button>
				<button
					type="button"
					class="cse-style-btn"
					class:cse-style-btn--active={name_italic}
					onclick={() => name_italic = !name_italic}
					title="Italique"
				><i>I</i></button>
				<button
					type="button"
					class="cse-style-btn"
					class:cse-style-btn--active={name_underline}
					onclick={() => name_underline = !name_underline}
					title="Souligné"
				><u>U</u></button>
			</div>
		</div>

	</div>

	<!-- ─── Picker d'icônes (Coloré / Sobre / Personnalisé) ─────────────────── -->
	<div class="cse-icon-picker">
		<div class="cse-picker-header">
			<span class="cse-label">Icône du canal</span>
			{#if icon_emoji}
				<button type="button" class="cse-icon-clear" onclick={() => icon_emoji = null} title="Retirer l'icône custom">
					Retirer
				</button>
			{/if}
		</div>

		<div class="cse-tabs">
			<button type="button" class="cse-tab" class:cse-tab--active={pickerTab === 0} onclick={() => pickerTab = 0}>
				Coloré
			</button>
			<button type="button" class="cse-tab" class:cse-tab--active={pickerTab === 1} onclick={() => pickerTab = 1}>
				Sobre
			</button>
			<button type="button" class="cse-tab" class:cse-tab--active={pickerTab === 2} onclick={() => pickerTab = 2}>
				Personnalisé
			</button>
		</div>

		<div class="cse-tab-panel">
			{#if pickerTab === 0}
				{#each COLORE_CATEGORIES as cat}
					<div class="cse-cat">
						<div class="cse-cat-name">{cat.name}</div>
						<div class="cse-icon-grid">
							{#each cat.icons as ico}
								<button
									type="button"
									class="cse-icon-btn"
									class:cse-icon-btn--active={icon_emoji === ico.id}
									title={ico.label}
									onclick={() => icon_emoji = ico.id}
								>
									<ChannelIcon value={ico.id} size={20} />
								</button>
							{/each}
						</div>
					</div>
				{/each}
			{:else if pickerTab === 1}
				{#each SOBRE_CATEGORIES as cat}
					<div class="cse-cat">
						<div class="cse-cat-name">{cat.name}</div>
						<div class="cse-icon-grid">
							{#each cat.icons as ico}
								<button
									type="button"
									class="cse-icon-btn"
									class:cse-icon-btn--active={icon_emoji === ico.id}
									title={ico.label}
									onclick={() => icon_emoji = ico.id}
								>
									<ChannelIcon value={ico.id} size={18} color={name_color ?? '#cbd5e1'} />
								</button>
							{/each}
						</div>
					</div>
				{/each}
			{:else}
				<div class="cse-custom">
					<label for="cse-emoji" class="cse-label">Emoji ou caractère unicode</label>
					<input
						id="cse-emoji"
						type="text"
						maxlength="8"
						value={icon_emoji && !isIconId(icon_emoji) ? icon_emoji : ''}
						placeholder={type === 'voice' ? '🔊' : '#'}
						oninput={(e) => {
							const v = (e.currentTarget as HTMLInputElement).value
							icon_emoji = v.trim() === '' ? null : v
						}}
						class="cse-emoji-input"
					/>
					<p class="cse-custom-hint">
						Tape un emoji ou colle un caractère. Note : sur Windows, les drapeaux pays
						(🇫🇷, 🇩🇪, etc.) ne s'affichent qu'en lettres faute de support natif. Préfère
						l'onglet <b>Coloré</b> pour les drapeaux.
					</p>
				</div>
			{/if}
		</div>
	</div>

	<div class="cse-actions">
		<button type="button" class="cse-reset" onclick={reset}>Réinitialiser le style</button>
	</div>
</div>

<style>
	.cse-root {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.cse-section-label {
		font-size: 11px;
		font-weight: 600;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.cse-preview {
		padding: 10px 12px;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 38px;
	}
	.cse-preview-row {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.cse-preview-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		font-size: 14px;
	}
	.cse-preview-name {
		font-size: 14px;
	}
	.cse-preview-label {
		font-size: 10px;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.cse-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	@media (max-width: 640px) { .cse-grid { grid-template-columns: 1fr } }
	.cse-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cse-label {
		font-size: 11px;
		font-weight: 500;
		color: #94a3b8;
	}
	.cse-color-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cse-color-picker {
		appearance: none;
		-webkit-appearance: none;
		width: 36px;
		height: 30px;
		padding: 0;
		border: 1px solid #374151;
		border-radius: 4px;
		background: transparent;
		cursor: pointer;
	}
	.cse-color-picker::-webkit-color-swatch-wrapper { padding: 2px; }
	.cse-color-picker::-webkit-color-swatch { border: none; border-radius: 3px; }
	.cse-color-hex {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 12px;
		color: #e2e8f0;
		background: #1f2937;
		border: 1px solid #374151;
		border-radius: 4px;
	}
	.cse-color-hex:focus { outline: none; border-color: #6366f1; }
	.cse-clear {
		width: 30px;
		height: 30px;
		border: 1px solid #374151;
		border-radius: 4px;
		background: transparent;
		color: #94a3b8;
		font-size: 16px;
		cursor: pointer;
	}
	.cse-clear:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
	.cse-palette {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 4px;
	}
	.cse-swatch {
		aspect-ratio: 1;
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 3px;
		cursor: pointer;
		padding: 0;
		transition: transform .1s;
	}
	.cse-swatch:hover { transform: scale(1.15); border-color: rgba(255,255,255,0.4); }
	.cse-contrast {
		margin: 4px 0 0;
		font-size: 10px;
		color: #64748b;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.cse-contrast--ok  { color: #4ade80; }
	.cse-contrast--low { color: #fb923c; }
	.cse-style-row {
		display: flex;
		gap: 6px;
	}
	.cse-style-btn {
		width: 32px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #374151;
		border-radius: 4px;
		background: #1f2937;
		color: #94a3b8;
		font-size: 13px;
		cursor: pointer;
		transition: all .1s;
	}
	.cse-style-btn:hover { background: #283142; color: #e2e8f0; }
	.cse-style-btn--active {
		background: rgba(99, 102, 241, 0.18);
		border-color: #6366f1;
		color: #c7d2fe;
	}
	.cse-emoji-input {
		width: 80px;
		padding: 6px 8px;
		text-align: center;
		font-size: 16px;
		background: #1f2937;
		border: 1px solid #374151;
		border-radius: 4px;
		color: #e2e8f0;
	}
	.cse-emoji-input:focus { outline: none; border-color: #6366f1; }

	/* ─── Icon picker ──────────────────────────────────────────────────── */
	.cse-icon-picker {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid rgba(255,255,255,0.04);
		padding-top: 12px;
	}
	.cse-picker-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.cse-icon-clear {
		font-size: 10px;
		color: #94a3b8;
		background: transparent;
		border: 1px solid #374151;
		border-radius: 3px;
		padding: 2px 8px;
		cursor: pointer;
	}
	.cse-icon-clear:hover { color: #fca5a5; border-color: #7f1d1d; }
	.cse-tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid #374151;
	}
	.cse-tab {
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 500;
		color: #94a3b8;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: color .1s, border-color .1s;
	}
	.cse-tab:hover { color: #e2e8f0; }
	.cse-tab--active {
		color: #c7d2fe;
		border-bottom-color: #6366f1;
	}
	.cse-tab-panel {
		max-height: 280px;
		overflow-y: auto;
		padding: 6px 2px 4px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.cse-tab-panel::-webkit-scrollbar { width: 6px; }
	.cse-tab-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
	.cse-cat-name {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
		margin-bottom: 4px;
	}
	.cse-icon-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
		gap: 4px;
	}
	.cse-icon-btn {
		width: 100%;
		aspect-ratio: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 4px;
		background: rgba(255,255,255,0.02);
		color: #e2e8f0;
		cursor: pointer;
		transition: background .1s, border-color .1s, transform .1s;
		padding: 0;
	}
	.cse-icon-btn:hover {
		background: rgba(99,102,241,0.1);
		transform: scale(1.08);
	}
	.cse-icon-btn--active {
		background: rgba(99,102,241,0.2);
		border-color: #6366f1;
	}
	.cse-custom {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cse-custom-hint {
		font-size: 10px;
		color: #64748b;
		line-height: 1.4;
		margin: 4px 0 0;
	}
	.cse-custom-hint b { color: #a5b4fc; font-weight: 600; }
	.cse-actions {
		display: flex;
		justify-content: flex-end;
	}
	.cse-reset {
		padding: 4px 10px;
		font-size: 11px;
		color: #94a3b8;
		background: transparent;
		border: 1px solid #374151;
		border-radius: 4px;
		cursor: pointer;
	}
	.cse-reset:hover { color: #fca5a5; border-color: #7f1d1d; }
</style>
