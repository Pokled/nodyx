<script lang="ts">
	// Fenêtre « Signaler » (CDC modération, E2). Le motif est obligatoire, la
	// précision facultative. La personne signalée ne sait jamais qui l'a
	// signalée (D7) ; le signaleur est prévenu quand l'équipe a traité (D6).
	import { page } from '$app/state'
	import { tick } from 'svelte'
	import { PUBLIC_API_URL } from '$app/env/public'
	import { t } from '$lib/i18n'
	import { portal } from '$lib/actions/portal'
	import { reportRequest } from '$lib/report'

	const tFn = $derived($t)

	const CATEGORIES = ['spam', 'harassment', 'hate', 'illegal', 'other'] as const
	type Category = (typeof CATEGORIES)[number]

	let category = $state<Category | null>(null)
	let reason = $state('')
	let sending = $state(false)
	let done = $state(false)
	let error = $state('')
	let dialogEl: HTMLDivElement | undefined = $state()
	let lastFocus: HTMLElement | null = null

	const req = $derived($reportRequest)

	$effect(() => {
		if (req) {
			category = null
			reason = ''
			done = false
			error = ''
			lastFocus = document.activeElement as HTMLElement | null
			tick().then(() => dialogEl?.querySelector<HTMLElement>('input[type=radio]')?.focus())
		}
	})

	function close() {
		reportRequest.set(null)
		lastFocus?.focus?.()
	}

	const ERROR_KEYS: Record<string, string> = {
		COOLDOWN: 'report.err_cooldown',
		RATE_LIMITED: 'report.err_rate',
		CANNOT_REPORT_SELF: 'report.err_self',
		NOT_FOUND: 'report.err_gone',
		DISABLED: 'report.err_disabled',
	}

	async function send() {
		if (!req || !category || sending) return
		sending = true
		error = ''
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/reports`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${(page.data as any).token}`,
				},
				body: JSON.stringify({ target_type: req.type, target_id: req.id, category, reason: reason.trim() || undefined }),
			})
			if (res.ok) {
				done = true
			} else {
				const j = await res.json().catch(() => ({}))
				error = tFn(ERROR_KEYS[j.code] ?? 'report.err_generic')
			}
		} catch {
			error = tFn('report.err_generic')
		} finally {
			sending = false
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close()
	}
</script>

{#if req}
	<div class="rp-backdrop" use:portal onclick={(e) => { if (e.target === e.currentTarget) close() }} onkeydown={onKey} role="presentation">
		<div class="rp-dialog" role="dialog" aria-modal="true" aria-labelledby="rp-title" bind:this={dialogEl}>
			{#if done}
				<div class="rp-done">
					<div class="rp-done-icon" aria-hidden="true">
						<svg fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
					</div>
					<h2 id="rp-title">{tFn('report.done_title')}</h2>
					<p>{tFn('report.done_body')}</p>
					<button type="button" class="rp-btn rp-btn--primary" onclick={close}>{tFn('report.close')}</button>
				</div>
			{:else}
				<header class="rp-head">
					<div class="rp-flag" aria-hidden="true">
						<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 21V4m0 0h11l-1.5 4L15 12H4"/></svg>
					</div>
					<div>
						<h2 id="rp-title">{tFn('report.title')}</h2>
						<p class="rp-sub">{req.label}</p>
					</div>
				</header>

				<fieldset class="rp-cats">
					<legend>{tFn('report.why')}</legend>
					{#each CATEGORIES as c (c)}
						<label class="rp-cat">
							<input type="radio" name="rp-category" value={c} bind:group={category} />
							<span>
								<span class="rp-cat-name">{tFn(`report.cat_${c}`)}</span>
								<span class="rp-cat-desc">{tFn(`report.cat_${c}_desc`)}</span>
							</span>
						</label>
					{/each}
				</fieldset>

				<label class="rp-field">
					<span>{tFn('report.details')}</span>
					<textarea bind:value={reason} maxlength="1000" rows="3" placeholder={tFn('report.details_ph')}></textarea>
				</label>

				<p class="rp-note">{tFn('report.anonymous')}</p>

				{#if error}<p class="rp-error" role="alert">{error}</p>{/if}

				<footer class="rp-actions">
					<button type="button" class="rp-btn" onclick={close}>{tFn('report.cancel')}</button>
					<button type="button" class="rp-btn rp-btn--primary" disabled={!category || sending} onclick={send}>
						{sending ? tFn('report.sending') : tFn('report.send')}
					</button>
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.rp-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.55);
		backdrop-filter: blur(3px);
	}
	.rp-dialog {
		width: min(100%, 30rem);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		border: 1px solid var(--nx-border);
		border-radius: 14px;
		background: var(--nx-surface);
		color: var(--nx-text);
		padding: 1.25rem;
		box-shadow: 0 24px 60px -12px rgb(0 0 0 / 0.45);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.rp-head { display: flex; gap: 0.75rem; align-items: flex-start; }
	.rp-flag {
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--nx-bad);
		background: color-mix(in srgb, var(--nx-bad) 12%, transparent);
	}
	.rp-flag svg { width: 1.1rem; height: 1.1rem; }
	h2 { margin: 0; font-size: 1.0625rem; font-weight: 650; }
	.rp-sub { margin: 0.15rem 0 0; font-size: 0.8125rem; color: var(--nx-text-muted); word-break: break-word; }
	.rp-cats { margin: 0; padding: 0; border: none; display: flex; flex-direction: column; gap: 0.4rem; }
	.rp-cats legend { font-size: 0.75rem; font-weight: 600; color: var(--nx-text-muted); margin-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.05em; }
	.rp-cat {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--nx-border);
		border-radius: 10px;
		cursor: pointer;
		transition: border-color 0.15s, background-color 0.15s;
	}
	.rp-cat:hover { border-color: color-mix(in srgb, var(--nx-header-accent) 35%, var(--nx-border)); }
	.rp-cat:has(input:checked) {
		border-color: color-mix(in srgb, var(--nx-header-accent) 55%, transparent);
		background: color-mix(in srgb, var(--nx-header-accent) 8%, transparent);
	}
	.rp-cat input { accent-color: var(--nx-header-accent); margin-top: 0.2rem; }
	.rp-cat-name { display: block; font-size: 0.875rem; font-weight: 600; }
	.rp-cat-desc { display: block; font-size: 0.75rem; color: var(--nx-text-muted); margin-top: 0.1rem; }
	.rp-field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.75rem; font-weight: 600; color: var(--nx-text-muted); }
	.rp-field textarea {
		font: inherit;
		font-size: 0.875rem;
		font-weight: 400;
		color: var(--nx-text);
		background: var(--nx-surface);
		border: 1px solid var(--nx-border);
		border-radius: 8px;
		padding: 0.5rem 0.65rem;
		resize: vertical;
	}
	.rp-field textarea:focus { outline: none; border-color: var(--nx-header-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--nx-header-accent) 18%, transparent); }
	.rp-note { margin: 0; font-size: 0.75rem; color: var(--nx-text-muted); }
	.rp-error { margin: 0; font-size: 0.8125rem; color: var(--nx-bad); }
	.rp-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
	.rp-btn {
		min-height: 2.25rem;
		padding: 0 0.95rem;
		border-radius: 8px;
		border: 1px solid var(--nx-border);
		background: var(--nx-surface);
		color: var(--nx-text);
		font-size: 0.8125rem;
		font-weight: 550;
		cursor: pointer;
	}
	.rp-btn:hover { background: color-mix(in srgb, var(--nx-text) 6%, var(--nx-surface)); }
	.rp-btn:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.rp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.rp-btn--primary { border-color: transparent; background: var(--nx-header-accent); color: var(--nx-on-accent, #fff); }
	.rp-btn--primary:hover { background: color-mix(in srgb, var(--nx-header-accent) 88%, black); }
	.rp-done { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.6rem; padding: 0.5rem 0; }
	.rp-done p { margin: 0; font-size: 0.875rem; color: var(--nx-text-muted); max-width: 22rem; }
	.rp-done-icon { width: 3rem; height: 3rem; border-radius: 999px; display: flex; align-items: center; justify-content: center; color: var(--nx-ok); background: color-mix(in srgb, var(--nx-ok) 14%, transparent); }
	.rp-done-icon svg { width: 1.5rem; height: 1.5rem; }
</style>
