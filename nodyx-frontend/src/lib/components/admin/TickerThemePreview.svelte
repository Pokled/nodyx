<script lang="ts">
	// Mini-preview d'un thème de ticker pour le picker. Reprend les CSS de
	// la page overlay /overlay/ticker/[token] à échelle réduite avec icon-orb
	// + typo hiérarchisée.

	type TickerTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type CustomTheme = { bgColor?: string | null; textColor?: string | null }

	interface Props {
		theme:        TickerTheme
		customTheme?: CustomTheme
	}

	let { theme, customTheme }: Props = $props()

	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 200)
	}

	const customStyle = $derived(() => {
		if (theme !== 'custom' || !customTheme) return ''
		const parts: string[] = []
		if (customTheme.bgColor)   parts.push(`--bar-bg: ${safeCssValue(customTheme.bgColor)}`)
		if (customTheme.textColor) parts.push(`--text-color: ${safeCssValue(customTheme.textColor)}`)
		return parts.join('; ')
	})
</script>

<div class="preview-wrap">
	<div class="ticker theme-{theme}" style={customStyle()}>
		<div class="ticker-track">
			<div class="token" style="--accent: var(--nx-cyan)">
				<div class="icon-orb">
					<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
				</div>
				<div class="text">
					<div class="eyebrow">Follow</div>
					<div class="name">Alice</div>
				</div>
			</div>
			<div class="token" style="--accent: #ef4444">
				<div class="icon-orb">
					<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
				</div>
				<div class="text">
					<div class="eyebrow">Raid</div>
					<div class="name">Bob</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.preview-wrap {
		position: relative;
		width: 100%;
		height: 110px;
		overflow: hidden;
		border-radius: 6px;
		background:
			linear-gradient(45deg, #0a0a14 25%, transparent 25%),
			linear-gradient(-45deg, #0a0a14 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #0a0a14 75%),
			linear-gradient(-45deg, transparent 75%, #0a0a14 75%);
		background-size: 14px 14px;
		background-position: 0 0, 0 7px, 7px -7px, -7px 0;
		background-color: #1a1a2e;
		display: flex;
		align-items: flex-end;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
	}

	.ticker {
		--bar-bg:     rgba(8, 12, 26, 0.92);
		--text-color: #f1f5f9;
		width: 100%;
		background: var(--bar-bg);
		backdrop-filter: blur(10px);
		padding: 8px 0;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.ticker-track {
		display: flex;
		gap: 10px;
		padding-left: 10px;
		transform: scale(0.7);
		transform-origin: left center;
	}

	.token {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 5px 14px 5px 5px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
		color: var(--text-color);
		box-shadow:
			0 4px 14px color-mix(in oklab, var(--accent) 14%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		flex-shrink: 0;
	}

	.icon-orb {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: linear-gradient(135deg,
			color-mix(in oklab, var(--accent) 100%, transparent),
			color-mix(in oklab, var(--accent) 60%, black));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 6px color-mix(in oklab, var(--accent) 40%, transparent);
	}
	.icon-orb svg {
		width: 14px;
		height: 14px;
		color: #fff;
	}

	.text { display: flex; flex-direction: column; line-height: 1.1; }
	.eyebrow {
		font-size: 9px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.12em; color: var(--accent); opacity: 0.85;
	}
	.name {
		font-size: 13px; font-weight: 700; color: var(--text-color);
		margin-top: 1px;
	}

	/* Themes (versions condensées de la vraie page) */
	.theme-soft {
		--bar-bg:     rgba(255, 255, 255, 0.94);
		--text-color: #1e293b;
	}
	.theme-soft .token { background: rgba(248, 250, 252, 0.95); border: 1px solid rgba(15, 23, 42, 0.08); }
	.theme-soft .eyebrow { opacity: 1; }

	.theme-retro {
		--bar-bg: #1a1a2e;
		font-family: 'VT323', monospace;
	}
	.theme-retro .token {
		border-radius: 0; border: 2px solid var(--accent);
		box-shadow: 3px 3px 0 0 color-mix(in oklab, var(--accent) 50%, black);
	}
	.theme-retro .icon-orb { border-radius: 0; }
	.theme-retro .name     { font-size: 18px; font-weight: 400; }

	.theme-neon {
		--bar-bg: #050511;
		border-top: 2px solid var(--nx-cyan);
	}
	.theme-neon .token {
		background: rgba(255, 255, 255, 0.02);
		border: 1.5px solid var(--accent);
		box-shadow: 0 0 12px color-mix(in oklab, var(--accent) 50%, transparent);
	}

	.theme-minimal {
		--bar-bg: transparent;
		backdrop-filter: none;
		border-top: none;
	}
	.theme-minimal .token {
		background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(6px);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}
</style>
