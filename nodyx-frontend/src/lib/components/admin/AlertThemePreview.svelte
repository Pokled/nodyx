<script lang="ts">
	// Mini-preview d'un thème d'alert box, utilisé dans le picker de
	// AlertBoxConfigEditor. Reprend les mêmes règles CSS que la vraie page
	// overlay (/overlay/alert/[token]) à une échelle réduite, pour que le
	// streamer voie exactement à quoi ressemblera son alert avant de la
	// sauvegarder. Pour le thème custom, on accepte un CustomTheme prop
	// pour montrer un preview live des couleurs / image de fond en cours
	// d'édition.

	type AlertTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'holographic' | 'minimal' | 'custom'
	type CustomTheme = {
		bgImageUrl?:  string | null
		bgColor?:     string | null
		accentColor?: string | null
		textColor?:   string | null
	}

	interface Props {
		theme:        AlertTheme
		customTheme?: CustomTheme
	}

	let { theme, customTheme }: Props = $props()

	// Mock data pour le preview. On garde court pour rentrer dans la box.
	const MOCK_LABEL   = 'Follow'
	const MOCK_MESSAGE = 'Alice a follow !'
	const MOCK_ACCENT  = '#06b6d4'

	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 500)
	}

	const customStyle = $derived(
		theme === 'custom' && customTheme
			? buildCustomStyle(customTheme)
			: '',
	)

	function buildCustomStyle(c: CustomTheme): string {
		const parts: string[] = []
		if (c.bgImageUrl) parts.push(`background-image: url("${safeCssValue(c.bgImageUrl)}")`)
		if (c.bgColor)    parts.push(`background-color: ${safeCssValue(c.bgColor)}`)
		if (c.textColor)  parts.push(`--text-color: ${safeCssValue(c.textColor)}`)
		return parts.join('; ')
	}

	const accent = $derived(
		theme === 'custom' && customTheme?.accentColor
			? safeCssValue(customTheme.accentColor)
			: MOCK_ACCENT,
	)
</script>

<div class="preview-wrap">
	<div class="preview-scale theme-{theme}" style="--accent: {accent}">
		<div class="alert-card" style={customStyle}>
			<div class="alert-bar"></div>
			<div class="alert-content">
				<div class="alert-eyebrow">{MOCK_LABEL}</div>
				<div class="alert-message">{MOCK_MESSAGE}</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* Wrapper qui clippe le preview à la taille du picker */
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
	}

	/* Échelle plus généreuse pour que le streamer puisse vraiment lire et
	   sentir la personnalité de chaque thème dans la preview. */
	.preview-scale {
		transform: scale(0.8);
		transform-origin: center;
		display: flex;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
	}

	/* ══ Identique aux thèmes de overlay/alert/[token]/+page.svelte ════════ */

	.theme-cyber .alert-card {
		display: flex;
		min-width: 280px;
		background: rgba(15, 23, 42, 0.92);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-left: 3px solid var(--accent);
		border-radius: 10px;
		overflow: hidden;
		box-shadow: 0 4px 16px color-mix(in oklab, var(--accent) 30%, transparent);
	}
	.theme-cyber .alert-bar { width: 4px; background: var(--accent); }
	.theme-cyber .alert-content { padding: 12px 16px; }
	.theme-cyber .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.12em; margin-bottom: 4px; color: var(--accent);
	}
	.theme-cyber .alert-message { color: #f1f5f9; font-size: 15px; font-weight: 600; }

	.theme-soft .alert-card {
		display: flex;
		min-width: 280px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 22px;
		overflow: hidden;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	.theme-soft .alert-bar { width: 6px; background: var(--accent); }
	.theme-soft .alert-content { padding: 14px 18px; }
	.theme-soft .alert-eyebrow {
		font-size: 11px; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.08em; margin-bottom: 3px;
		color: color-mix(in oklab, var(--accent) 70%, black);
	}
	.theme-soft .alert-message { color: #1e293b; font-size: 16px; font-weight: 600; }

	.theme-retro .alert-card {
		display: flex;
		flex-direction: column;
		min-width: 260px;
		background: #1a1a2e;
		border: 4px solid var(--accent);
		box-shadow: 6px 6px 0 0 color-mix(in oklab, var(--accent) 60%, black);
		font-family: 'VT323', monospace;
	}
	.theme-retro .alert-bar { display: none; }
	.theme-retro .alert-content { padding: 12px 16px; }
	.theme-retro .alert-eyebrow {
		font-size: 14px; letter-spacing: 0.2em; margin-bottom: 6px;
		color: var(--accent); text-transform: uppercase;
	}
	.theme-retro .alert-message { color: #f1f5f9; font-size: 20px; }

	.theme-neon .alert-card {
		display: flex;
		min-width: 280px;
		background: #050511;
		border: 2px solid var(--accent);
		border-radius: 12px;
		overflow: hidden;
		box-shadow:
			0 0 18px var(--accent),
			0 0 36px color-mix(in oklab, var(--accent) 60%, transparent);
	}
	.theme-neon .alert-bar { width: 4px; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
	.theme-neon .alert-content { padding: 14px 18px; }
	.theme-neon .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.18em; margin-bottom: 4px;
		color: var(--accent); text-shadow: 0 0 8px var(--accent);
	}
	.theme-neon .alert-message {
		color: #f1f5f9; font-size: 16px; font-weight: 700;
		text-shadow: 0 0 6px color-mix(in oklab, var(--accent) 50%, transparent);
	}

	.theme-holographic .alert-card {
		display: flex;
		min-width: 280px;
		position: relative;
		background: linear-gradient(135deg, #1a0033 0%, #001a33 50%, #003322 100%);
		border-radius: 14px;
		overflow: hidden;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
		isolation: isolate;
	}
	.theme-holographic .alert-card::after {
		content: '';
		position: absolute; inset: 0;
		border-radius: 14px;
		padding: 1.5px;
		background: linear-gradient(135deg, #ec4899, var(--nx-accent), #06b6d4, var(--nx-accent-2));
		-webkit-mask:
			linear-gradient(#fff 0 0) content-box,
			linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
	}
	.theme-holographic .alert-bar { display: none; }
	.theme-holographic .alert-content { padding: 14px 18px; position: relative; z-index: 1; }
	.theme-holographic .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.14em; margin-bottom: 4px;
		background: linear-gradient(90deg, #ec4899, #06b6d4);
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
	}
	.theme-holographic .alert-message { color: #f1f5f9; font-size: 16px; font-weight: 600; }

	.theme-minimal .alert-card {
		display: flex; flex-direction: column;
		background: transparent;
		padding: 0;
	}
	.theme-minimal .alert-bar { display: none; }
	.theme-minimal .alert-content { padding: 0; }
	.theme-minimal .alert-eyebrow {
		font-size: 11px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.2em; margin-bottom: 2px;
		color: var(--accent); text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
	}
	.theme-minimal .alert-message {
		color: #ffffff; font-size: 24px; font-weight: 800;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9), 0 4px 16px rgba(0, 0, 0, 0.7);
	}

	.theme-custom .alert-card {
		display: flex;
		min-width: 280px;
		background: #0f172a;
		background-size: cover;
		background-position: center;
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-left: 4px solid var(--accent);
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
	}
	.theme-custom .alert-bar { display: none; }
	.theme-custom .alert-content {
		padding: 14px 18px;
		background: linear-gradient(90deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 70%, transparent 100%);
	}
	.theme-custom .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.14em; margin-bottom: 4px; color: var(--accent);
	}
	.theme-custom .alert-message {
		color: var(--text-color, #f1f5f9);
		font-size: 16px; font-weight: 700;
		text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
	}
</style>
