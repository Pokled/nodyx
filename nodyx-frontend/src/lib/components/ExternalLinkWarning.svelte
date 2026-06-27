<!--
  Modal éducatif pour les liens externes.

  Philosophie :
  - Pas un sceau de confiance, un frein dissuasif. Aucun bouton vert "OK".
  - L'URL est affichée en gros, en mono, avec le hostname mis en évidence
    distinctement du chemin. Le user doit pouvoir LIRE le domaine.
  - Si des red flags sont détectés, ils sont expliqués clairement.
  - Une section permanente "Vérifie aussi par toi-même" liste les pièges
    visuels que notre détection automatique ne peut pas attraper :
    confusables 0/O, l/I/|, rn/m, etc., et donne 3 conseils pour ne pas
    se faire rouler.
  - Bouton "Quitter Nodyx" en gris neutre + icône warning, pas une CTA verte.
  - Bouton "Copier l'URL" pour permettre au user de coller manuellement
    dans la barre d'adresse (anti-clickjacking).
  - Pas de checkbox "ne plus demander". Trop facile à manipuler par habitude.
-->
<script lang="ts">
	import { pendingExternalLink, dismissExternalLink } from '$lib/stores/externalLinkGuard'
	import { analyzeUrl, splitForDisplay, type RedFlag } from '$lib/urlAnalysis'

	const link = $derived($pendingExternalLink)
	const analysis = $derived(link ? analyzeUrl(link.url) : null)
	const parts = $derived(link ? splitForDisplay(link.url) : null)

	let copyState = $state<'idle' | 'copied'>('idle')

	function onCopy() {
		if (!link) return
		navigator.clipboard.writeText(link.url).then(() => {
			copyState = 'copied'
			setTimeout(() => { copyState = 'idle' }, 1500)
		}).catch(() => {
			// Fallback : on selectionne le texte pour que le user puisse Ctrl+C
			const el = document.getElementById('elg-url-display')
			if (el) {
				const range = document.createRange()
				range.selectNodeContents(el)
				const sel = window.getSelection()
				sel?.removeAllRanges()
				sel?.addRange(range)
			}
		})
	}

	function onProceed() {
		if (!link) return
		// Ouverture explicite dans un nouvel onglet. rel anti-fishing aussi.
		const w = window.open(link.url, '_blank', 'noopener,noreferrer')
		if (w) w.opener = null
		copyState = 'idle'
		dismissExternalLink()
	}

	function onCancel() {
		copyState = 'idle'
		dismissExternalLink()
	}

	function flagIcon(severity: RedFlag['severity']): string {
		return severity === 'high' ? '⚠' : severity === 'medium' ? '⚠' : 'ℹ'
	}
	function flagColor(severity: RedFlag['severity']): string {
		return severity === 'high'   ? 'elg-flag--high'
		     : severity === 'medium' ? 'elg-flag--medium'
		     : 'elg-flag--low'
	}

	function onKeydown(e: KeyboardEvent) {
		if (!link) return
		if (e.key === 'Escape') onCancel()
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if link && analysis && parts}
	<div class="elg-overlay" role="dialog" aria-modal="true" aria-labelledby="elg-title">
		<div class="elg-modal" class:elg-modal--danger={analysis.highestSeverity === 'high'}>

			<!-- ── Header ──────────────────────────────────────────────────── -->
			<header class="elg-header">
				<div class="elg-icon-wrap" class:elg-icon-wrap--danger={analysis.highestSeverity === 'high'}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="elg-icon">
						<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
						<line x1="12" y1="9"  x2="12" y2="13"/>
						<line x1="12" y1="17" x2="12.01" y2="17"/>
					</svg>
				</div>
				<div>
					<h2 id="elg-title" class="elg-title">Tu sors de Nodyx</h2>
					<p class="elg-subtitle">
						Nodyx <strong>ne peut pas garantir</strong> la sécurité de ce site. Vérifie le domaine avant de cliquer.
					</p>
				</div>
				<button onclick={onCancel} class="elg-close" aria-label="Annuler">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</header>

			<!-- ── URL display ──────────────────────────────────────────────── -->
			<div class="elg-url-box">
				<div class="elg-url-label">Destination du lien</div>
				<div id="elg-url-display" class="elg-url-display">
					{#if parts.scheme}<span class="elg-url-scheme">{parts.scheme}://</span>{/if}<span
						class="elg-url-hostname"
						class:elg-url-hostname--danger={analysis.highestSeverity === 'high'}
					>{parts.hostname}</span><span class="elg-url-path">{parts.pathRest}</span>
				</div>
				<div class="elg-url-hint">
					Le vrai site est <strong>{parts.hostname}</strong> (en gras).
					Lis le domaine de la droite vers la gauche en t'arrêtant au premier point.
				</div>
			</div>

			<!-- ── Flags détectés ───────────────────────────────────────────── -->
			{#if analysis.flags.length > 0}
				<div class="elg-section">
					<div class="elg-section-title">🚩 Signaux détectés automatiquement</div>
					<ul class="elg-flag-list">
						{#each analysis.flags as f}
							<li class="elg-flag {flagColor(f.severity)}">
								<span class="elg-flag-icon">{flagIcon(f.severity)}</span>
								<div class="elg-flag-content">
									<div class="elg-flag-message">{f.message}</div>
									{#if f.detail}
										<div class="elg-flag-detail">{f.detail}</div>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- ── Pièges visuels à vérifier soi-même ──────────────────────── -->
			<div class="elg-section elg-section--education">
				<div class="elg-section-title">🧠 Vérifie aussi par toi-même</div>
				<p class="elg-edu-intro">
					Notre détection ne voit pas tout. Les attaquants exploitent des caractères qui se
					ressemblent visuellement. À l'œil nu, vérifie&nbsp;:
				</p>
				<div class="elg-confusables">
					<div class="elg-confusable">
						<span class="elg-confusable-char">0</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">O</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">o</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">°</span>
					</div>
					<div class="elg-confusable">
						<span class="elg-confusable-char">l</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">I</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">|</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">1</span>
					</div>
					<div class="elg-confusable">
						<span class="elg-confusable-char">rn</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">m</span>
						<span class="elg-confusable-vs">·</span>
						<span class="elg-confusable-char">vv</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">w</span>
					</div>
					<div class="elg-confusable">
						<span class="elg-confusable-char">-</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">_</span>
						<span class="elg-confusable-vs">·</span>
						<span class="elg-confusable-char">а</span>
						<span class="elg-confusable-vs">≠</span>
						<span class="elg-confusable-char">a</span>
					</div>
				</div>
				<div class="elg-edu-tips">
					<div class="elg-edu-tip">
						<span class="elg-edu-tip-num">1</span>
						<span>Lis le domaine <strong>de la fin vers le début</strong>. Le vrai site est juste avant le premier <code>/</code>.</span>
					</div>
					<div class="elg-edu-tip">
						<span class="elg-edu-tip-num">2</span>
						<span>Si tu ne connais pas l'expéditeur, ou si le lien arrive sans contexte, <strong>ne clique pas</strong>. Demande confirmation par un autre canal.</span>
					</div>
					<div class="elg-edu-tip">
						<span class="elg-edu-tip-num">3</span>
						<span>En cas de doute, <strong>copie l'URL</strong> ci-dessus et colle-la dans la barre d'adresse de ton navigateur. Tu verras exactement où tu vas.</span>
					</div>
				</div>
			</div>

			<!-- ── Actions ──────────────────────────────────────────────────── -->
			<footer class="elg-actions">
				<button onclick={onCancel} class="elg-btn elg-btn--cancel">
					Annuler
				</button>
				<button onclick={onCopy} class="elg-btn elg-btn--copy">
					{#if copyState === 'copied'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="elg-btn-icon">
							<polyline points="20 6 9 17 4 12"/>
						</svg>
						URL copiée
					{:else}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="elg-btn-icon">
							<rect x="9" y="9" width="13" height="13" rx="2"/>
							<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
						</svg>
						Copier l'URL
					{/if}
				</button>
				<button onclick={onProceed} class="elg-btn elg-btn--leave" class:elg-btn--leave-danger={analysis.highestSeverity === 'high'}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="elg-btn-icon">
						<path d="M15 3h6v6"/>
						<path d="M10 14L21 3"/>
						<path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>
					</svg>
					Quitter Nodyx
				</button>
			</footer>

		</div>
	</div>
{/if}

<style>
	.elg-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.72);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		animation: elg-fade-in 0.18s ease-out;
	}
	.elg-modal {
		width: 100%;
		max-width: 560px;
		max-height: 92vh;
		overflow-y: auto;
		background: #14141c;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), 0 4px 16px rgba(0, 0, 0, 0.5);
		color: #e2e8f0;
		animation: elg-pop-in 0.22s cubic-bezier(.2, .8, .25, 1);
	}
	.elg-modal--danger {
		border-color: rgba(239, 68, 68, 0.35);
		box-shadow: 0 24px 80px rgba(239, 68, 68, 0.18), 0 0 0 1px rgba(239, 68, 68, 0.15), 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	/* Header */
	.elg-header {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		padding: 18px 20px 16px 20px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		position: relative;
	}
	.elg-icon-wrap {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: rgba(234, 179, 8, 0.12);
		color: #fbbf24;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.elg-icon-wrap--danger {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}
	.elg-icon { width: 22px; height: 22px; }
	.elg-title {
		font-size: 17px;
		font-weight: 700;
		margin: 0 0 4px 0;
		color: #f1f5f9;
	}
	.elg-subtitle {
		font-size: 13px;
		line-height: 1.5;
		margin: 0;
		color: #94a3b8;
	}
	.elg-subtitle strong { color: #fca5a5; }
	.elg-close {
		position: absolute;
		top: 14px;
		right: 14px;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: #64748b;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background .15s, color .15s;
	}
	.elg-close:hover { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; }
	.elg-close svg { width: 16px; height: 16px; }

	/* URL display */
	.elg-url-box {
		padding: 14px 20px;
		background: rgba(255, 255, 255, 0.02);
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}
	.elg-url-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: 700;
		color: rgba(226, 232, 240, 0.4);
		margin-bottom: 6px;
	}
	.elg-url-display {
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 14px;
		line-height: 1.45;
		word-break: break-all;
		padding: 10px 12px;
		background: #0a0a10;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		color: #94a3b8;
		user-select: all;
	}
	.elg-url-scheme   { color: #64748b; }
	.elg-url-hostname { color: #f1f5f9; font-weight: 700; }
	.elg-url-hostname--danger { color: #fca5a5; }
	.elg-url-path     { color: #64748b; }
	.elg-url-hint {
		margin-top: 8px;
		font-size: 11px;
		color: #64748b;
		line-height: 1.5;
	}
	.elg-url-hint strong { color: #cbd5e1; }

	/* Sections */
	.elg-section {
		padding: 14px 20px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}
	.elg-section--education {
		background: rgb(var(--nx-accent-rgb) / 0.03);
	}
	.elg-section-title {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #94a3b8;
		margin-bottom: 10px;
	}

	/* Flags */
	.elg-flag-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.elg-flag {
		display: flex;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 8px;
		font-size: 13px;
		line-height: 1.45;
		border: 1px solid;
	}
	.elg-flag--high   { background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.22); color: #fecaca; }
	.elg-flag--medium { background: rgba(234, 179, 8, 0.06); border-color: rgba(234, 179, 8, 0.20); color: #fde68a; }
	.elg-flag--low    { background: rgb(var(--nx-accent-rgb) / 0.06); border-color: rgb(var(--nx-accent-rgb) / 0.20); color: #c7d2fe; }
	.elg-flag-icon { flex-shrink: 0; font-size: 16px; line-height: 1.2; }
	.elg-flag-message { font-weight: 600; margin-bottom: 2px; }
	.elg-flag-detail  { font-size: 12px; opacity: 0.8; line-height: 1.5; }

	/* Confusables */
	.elg-edu-intro {
		font-size: 12px;
		color: #94a3b8;
		margin: 0 0 12px 0;
		line-height: 1.5;
	}
	.elg-confusables {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 14px;
	}
	.elg-confusable {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: rgba(15, 15, 22, 0.5);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 13px;
	}
	.elg-confusable-char {
		color: #f1f5f9;
		font-weight: 700;
		min-width: 18px;
		text-align: center;
	}
	.elg-confusable-vs { color: #64748b; font-weight: 400; }

	.elg-edu-tips { display: flex; flex-direction: column; gap: 8px; }
	.elg-edu-tip {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		font-size: 12px;
		color: #cbd5e1;
		line-height: 1.5;
	}
	.elg-edu-tip strong { color: #f1f5f9; }
	.elg-edu-tip code {
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 11px;
	}
	.elg-edu-tip-num {
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: rgb(var(--nx-accent-rgb) / 0.18);
		color: #a5b4fc;
		font-size: 10px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 1px;
	}

	/* Actions */
	.elg-actions {
		display: flex;
		gap: 8px;
		padding: 14px 20px 16px 20px;
		flex-wrap: wrap;
	}
	.elg-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		padding: 9px 16px;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: background .15s, border-color .15s, color .15s;
		font-family: inherit;
	}
	.elg-btn-icon { width: 14px; height: 14px; }
	.elg-btn--cancel {
		background: transparent;
		color: #94a3b8;
		border-color: rgba(255, 255, 255, 0.08);
	}
	.elg-btn--cancel:hover { background: rgba(255, 255, 255, 0.04); color: #cbd5e1; }
	.elg-btn--copy {
		background: rgba(255, 255, 255, 0.04);
		color: #cbd5e1;
		border-color: rgba(255, 255, 255, 0.08);
	}
	.elg-btn--copy:hover { background: rgba(255, 255, 255, 0.08); }
	.elg-btn--leave {
		background: rgba(100, 116, 139, 0.18);
		color: #cbd5e1;
		border-color: rgba(100, 116, 139, 0.3);
		margin-left: auto;
	}
	.elg-btn--leave:hover { background: rgba(100, 116, 139, 0.28); }
	.elg-btn--leave-danger {
		background: rgba(239, 68, 68, 0.12);
		color: #fecaca;
		border-color: rgba(239, 68, 68, 0.3);
	}
	.elg-btn--leave-danger:hover { background: rgba(239, 68, 68, 0.2); }

	@keyframes elg-fade-in { from { opacity: 0; } to { opacity: 1; } }
	@keyframes elg-pop-in {
		from { opacity: 0; transform: translateY(8px) scale(0.97); }
		to   { opacity: 1; transform: translateY(0)   scale(1);    }
	}

	@media (max-width: 480px) {
		.elg-modal { max-height: 96vh; border-radius: 12px; }
		.elg-actions { flex-direction: column; }
		.elg-btn--leave { margin-left: 0; }
		.elg-btn { width: 100%; }
	}
</style>
