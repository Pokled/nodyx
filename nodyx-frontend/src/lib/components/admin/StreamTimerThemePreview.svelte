<script lang="ts">
	// Mini-preview d'un thème de stream timer pour le picker. Reprend les
	// mêmes CSS que la page overlay /overlay/timer/[token].

	type Theme    = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type CustomTheme = { bgColor?: string | null; textColor?: string | null; accentColor?: string | null }

	interface Props {
		theme:        Theme
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
		if (customTheme.bgColor)     parts.push(`--bg: ${safeCssValue(customTheme.bgColor)}`)
		if (customTheme.textColor)   parts.push(`--text: ${safeCssValue(customTheme.textColor)}`)
		if (customTheme.accentColor) parts.push(`--accent: ${safeCssValue(customTheme.accentColor)}`)
		return parts.join('; ')
	})
</script>

<div class="preview-wrap">
	<div class="timer-card theme-{theme}" style={customStyle()}>
		<span class="dot"></span>
		<span class="timer-text">01:42:08</span>
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
		align-items: center;
		justify-content: center;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
	}

	.timer-card {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px 6px 10px;
		--bg:     rgba(15, 23, 42, 0.78);
		--text:   #f1f5f9;
		--accent: #f43f5e;
		background: var(--bg);
		border-radius: 999px;
		transform: scale(0.85);
	}

	.timer-text {
		font-family: 'JetBrains Mono', 'SF Mono', monospace;
		font-size: 18px;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.5px;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 25%, transparent);
	}

	/* Themes (mirror condensé de la vraie page) */
	.theme-cyber   { border: 1px solid color-mix(in oklab, var(--accent) 35%, transparent); }
	.theme-soft {
		--bg:   rgba(255, 255, 255, 0.95);
		--text: #1e293b;
	}
	.theme-retro {
		--bg: #1a1a2e;
		font-family: 'VT323', monospace;
		border: 3px solid var(--accent);
		border-radius: 0;
		box-shadow: 4px 4px 0 0 color-mix(in oklab, var(--accent) 60%, black);
	}
	.theme-retro .timer-text { font-family: 'VT323', monospace; font-size: 22px; font-weight: 400; }
	.theme-retro .dot        { border-radius: 0; }
	.theme-neon {
		--bg: #050511;
		border: 2px solid var(--accent);
		box-shadow: 0 0 12px var(--accent), 0 0 24px color-mix(in oklab, var(--accent) 60%, transparent);
	}
	.theme-neon .dot { box-shadow: 0 0 8px var(--accent); }
	.theme-minimal {
		background: transparent;
	}
	.theme-minimal .timer-text {
		font-size: 22px;
		font-weight: 800;
		text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
	}
	.theme-custom {
		border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
	}
</style>
