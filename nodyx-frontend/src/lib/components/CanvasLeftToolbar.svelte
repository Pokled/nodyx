<script lang="ts">
	import type { CanvasTool } from '$lib/canvas'

	let {
		tool    = $bindable<CanvasTool>('pen'),
		onClose = () => {},
	}: { tool: CanvasTool; onClose: () => void } = $props()

	type ToolDef = { id: CanvasTool; label: string; key: string }

	const groups: ToolDef[][] = [
		[{ id: 'select', label: 'Sélection', key: 'V' }],
		[
			{ id: 'pen',    label: 'Stylo',      key: 'P' },
			{ id: 'text',   label: 'Texte',      key: 'T' },
			{ id: 'sticky', label: 'Post-it',    key: 'N' },
		],
		[
			{ id: 'rect',      label: 'Rectangle',  key: 'R' },
			{ id: 'circle',    label: 'Cercle',     key: 'C' },
			{ id: 'shape',     label: 'Forme',      key: 'S' },
		],
		[
			{ id: 'arrow',     label: 'Flèche',     key: 'A' },
			{ id: 'connector', label: 'Connecteur', key: 'X' },
		],
		[
			{ id: 'image',  label: 'Image',      key: 'I' },
			{ id: 'frame',  label: 'Frame',      key: 'F' },
			{ id: 'eraser', label: 'Gomme',      key: 'E' },
		],
	]
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="canvas-toolbar">

	{#each groups as group, gi}
		{#if gi > 0}<div class="sep"></div>{/if}

		{#each group as t}
			<button
				onclick={() => tool = t.id}
				class="tool-btn"
				class:active={tool === t.id}
				title="{t.label} ({t.key})"
				aria-label={t.label}
			>
				{#if t.id === 'select'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M3.75 3.75l7.5 18 3-7.5 7.5-3-18-7.5z"/>
					</svg>
				{:else if t.id === 'pen'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"/>
					</svg>
				{:else if t.id === 'text'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M3.75 6.75h16.5M3.75 12H12m-8.25 5.25H12M15 12l4.5 4.5m0 0L15 21m4.5-4.5H9.75"/>
					</svg>
				{:else if t.id === 'sticky'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"/>
					</svg>
				{:else if t.id === 'rect'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M5.25 7.5A2.25 2.25 0 013 5.25v-1.5A2.25 2.25 0 015.25 1.5h1.5A2.25 2.25 0 019 3.75M9 3.75h6M9 3.75a2.25 2.25 0 002.25 2.25h1.5A2.25 2.25 0 0015 3.75m0 0a2.25 2.25 0 012.25-2.25h1.5A2.25 2.25 0 0121 3.75v1.5a2.25 2.25 0 01-2.25 2.25M3 9v6M21 9v6M3 15a2.25 2.25 0 002.25 2.25h1.5A2.25 2.25 0 009 15m0 0h6m-6 0a2.25 2.25 0 012.25 2.25h1.5A2.25 2.25 0 0015 15m0 0a2.25 2.25 0 012.25 2.25h1.5A2.25 2.25 0 0021 15v-1.5a2.25 2.25 0 00-2.25-2.25"/>
					</svg>
				{:else if t.id === 'circle'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<circle cx="12" cy="12" r="9"/>
					</svg>
				{:else if t.id === 'arrow'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75"/>
					</svg>
				{:else if t.id === 'image'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>
					</svg>
				{:else if t.id === 'frame'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/>
					</svg>
				{:else if t.id === 'shape'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<polygon points="12,3 22,20 2,20" stroke-linejoin="round"/>
					</svg>
				{:else if t.id === 'connector'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<circle cx="5" cy="12" r="2.5"/>
						<circle cx="19" cy="12" r="2.5"/>
						<path stroke-linecap="round" d="M7.5 12 C10 7, 14 7, 16.5 12"/>
					</svg>
				{:else if t.id === 'eraser'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>
					</svg>
				{/if}

				<!-- Keyboard shortcut badge -->
				<span class="key-badge">{t.key}</span>
			</button>
		{/each}
	{/each}

	<div class="sep"></div>

	<!-- Close -->
	<button class="tool-btn close-btn" onclick={onClose} title="Fermer (Échap)" aria-label="Fermer">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
			<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
		</svg>
	</button>
</div>

<style>
	.canvas-toolbar {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 6px;
		background: rgba(10, 10, 18, 0.94);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 16px;
		box-shadow:
			0 0 0 1px rgba(124, 58, 237, 0.08),
			0 8px 32px rgba(0,0,0,0.5),
			0 2px 8px rgba(0,0,0,0.4);
		user-select: none;
	}

	.sep {
		width: 24px;
		height: 1px;
		background: rgba(255,255,255,0.06);
		margin: 4px 0;
		flex-shrink: 0;
	}

	.tool-btn {
		position: relative;
		width: 40px;
		height: 40px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.12s ease;
		flex-shrink: 0;
	}

	.tool-btn:hover {
		background: rgba(255,255,255,0.06);
		color: #d1d5db;
		transform: scale(1.05);
	}

	.tool-btn:active {
		transform: scale(0.95);
	}

	.tool-btn.active {
		background: linear-gradient(135deg, #6d28d9, #7c3aed);
		color: white;
		box-shadow: 0 0 0 1px rgba(124,58,237,0.4), 0 4px 12px rgba(124,58,237,0.35);
	}

	.tool-btn svg {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.key-badge {
		position: absolute;
		bottom: 3px;
		right: 3px;
		font-size: 8px;
		font-weight: 700;
		color: rgba(255,255,255,0.25);
		line-height: 1;
		letter-spacing: 0.02em;
		font-family: monospace;
		pointer-events: none;
	}

	.tool-btn.active .key-badge {
		color: rgba(255,255,255,0.5);
	}

	.close-btn {
		margin-top: 2px;
		color: #4b5563;
	}

	.close-btn:hover {
		background: rgba(239,68,68,0.12);
		color: #f87171;
	}
</style>
