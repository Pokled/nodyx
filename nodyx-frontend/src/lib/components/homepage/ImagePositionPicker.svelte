<script lang="ts">
	import { t } from '$lib/i18n'
	const tFn = $derived($t)

	interface Props {
		imageUrl:    string
		offsetX:     number
		offsetY:     number
		scale?:      number
		showZoom?:   boolean
		height?:     string
		emptyLabel?: string
		alt?:        string
		onChangeLive: (patch: { offsetX?: number; offsetY?: number; scale?: number }) => void
		onCommit:     () => void
	}

	let {
		imageUrl, offsetX, offsetY, scale = 1, showZoom = false,
		height = '140px', emptyLabel = '', alt = '',
		onChangeLive, onCommit,
	}: Props = $props()

	// Aperçu purement visuel, sans aucun handler pointeur : un clic sur l'image
	// elle-même ne fait jamais rien de fiable (drag natif du navigateur, image
	// non cliquable derrière pointer-events:none...). Le positionnement se fait
	// à 100% via des sliders natifs, robustes sur tous les navigateurs.
	function onOffsetXInput(e: Event) {
		onChangeLive({ offsetX: Number((e.target as HTMLInputElement).value) })
	}
	function onOffsetYInput(e: Event) {
		onChangeLive({ offsetY: Number((e.target as HTMLInputElement).value) })
	}
	function onZoomInput(e: Event) {
		onChangeLive({ scale: Number((e.target as HTMLInputElement).value) })
	}
</script>

<div class="ipp-frame" class:ipp-frame--empty={!imageUrl} style="height:{height}">
	{#if imageUrl}
		<img src={imageUrl} {alt} class="ipp-img" style="object-position:{offsetX}% {offsetY}%; transform-origin:{offsetX}% {offsetY}%; transform: scale({scale})" />
	{:else}
		<div class="ipp-empty">{emptyLabel}</div>
	{/if}
</div>

{#if imageUrl}
	<div class="ipp-sliders">
		<label class="ipp-slider-row">
			<span>{tFn('hpb.header_pos_x')}</span>
			<input type="range" min="0" max="100" step="1" value={offsetX} oninput={onOffsetXInput} onchange={onCommit} aria-label={tFn('hpb.header_pos_x')} />
		</label>
		<label class="ipp-slider-row">
			<span>{tFn('hpb.header_pos_y')}</span>
			<input type="range" min="0" max="100" step="1" value={offsetY} oninput={onOffsetYInput} onchange={onCommit} aria-label={tFn('hpb.header_pos_y')} />
		</label>
		{#if showZoom}
			<label class="ipp-slider-row">
				<span>{tFn('hpb.header_zoom')}</span>
				<input type="range" min="0.4" max="2.5" step="0.05" value={scale} oninput={onZoomInput} onchange={onCommit} aria-label={tFn('hpb.header_zoom')} />
			</label>
		{/if}
	</div>
{/if}

<style>
	.ipp-frame {
		position: relative;
		width: 100%;
		overflow: hidden;
		border-radius: 6px;
		border: 1px solid var(--nborder, rgba(255,255,255,.12));
		background: rgba(255,255,255,.03);
	}
	.ipp-frame--empty { display: flex; align-items: center; justify-content: center; }
	.ipp-img {
		position: absolute; inset: 0;
		width: 100%; height: 100%;
		object-fit: cover;
	}
	.ipp-empty {
		font-size: 12px; color: var(--ntm, #6b7280);
		padding: 0 1rem; text-align: center;
	}
	.ipp-sliders {
		display: flex; flex-direction: column; gap: 4px;
		margin-top: 6px;
	}
	.ipp-slider-row {
		display: flex; align-items: center; gap: 8px;
	}
	.ipp-slider-row span {
		font-size: 10px; color: #9ca3af;
		width: 60px; flex-shrink: 0;
	}
	.ipp-slider-row input[type="range"] { flex: 1; }
</style>
