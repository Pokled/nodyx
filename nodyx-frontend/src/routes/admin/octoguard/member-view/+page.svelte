<script lang="ts">
	// « Vu par un membre » : ce qu'un membre voit vraiment quand OctoGuard agit.
	// Les textes sont les VRAIS (mêmes clés, même fonction octoguardMessage que
	// le chat et le forum) : cette page ne peut pas mentir sur ce que lit un membre.
	import { t, locale } from '$lib/i18n'
	import { octoguardMessage } from '$lib/octoguardMessages'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { OG_ICON } from '$lib/octoguard/nav'
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { og } from '$lib/octoguard/api'
	import NudgeBanner from '$lib/components/octoguard/NudgeBanner.svelte'
	import type { Nudge } from '$lib/octoguard/nudge'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)

	// Clés du cœur reconstruites par morceaux (sinon le vérificateur i18n les
	// prendrait pour des clés de l'interface), comme dans octoguardMessages.ts.
	const core = (a: string, b: string) => ['octoguard', a, b].join('.')
	const sampleUser = $derived(tFn('og2.wel_sample_user'))
	const welcomeText = $derived(
		(data.welcome?.public_message ?? '')
			.replace(/\{user\}/g, sampleUser)
			.replace(/\{userMention\}/g, '@' + sampleUser)
			.replace(/\{communityName\}/g, data.communityName)
			.replace(/\{rulesUrl\}/g, tFn('og2.wel_sample_rules')),
	)
	const welcomeOn = $derived(!!data.welcome?.enabled && !!data.welcome?.public_message)
	const until = $derived(new Date(Date.now() + 2 * 3600_000).toLocaleString(String($locale ?? 'fr'), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))
	const CATS = ['spam', 'harassment', 'hate', 'illegal', 'other']

	// « Tu es sûr ? » (lot 5) : l'aperçu est le VRAI bandeau, avec trois exemples.
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const SAMPLES: Array<{ id: string; nudge: Nudge }> = [
		{ id: 'words', nudge: { outcome: 'hold', kind: 'words' } },
		{ id: 'links', nudge: { outcome: 'refuse', kind: 'links' } },
		{ id: 'caps', nudge: { outcome: 'warn', kind: 'caps' } },
	]
	let sample = $state(SAMPLES[0])
	// Valeur de départ seulement : l'interrupteur la fait vivre ensuite
	let nudgeOn = $state(untrack(() => !!data.settings?.nudge))
	const ogOn = $derived(!!data.settings?.enabled)
	let nudgeSaving = $state(false)
	let nudgeError = $state<string | null>(null)
	async function setNudge(on: boolean) {
		nudgeSaving = true; nudgeError = null
		try {
			const r = await og<{ nudge: boolean }>(token, '/settings', 'PUT', { nudge: on })
			nudgeOn = r.nudge
		} catch {
			nudgeError = tFn('og2.mv_nudge_err')
		} finally { nudgeSaving = false }
	}
</script>

<svelte:head><title>{tFn('og2.nav_member_view')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_member_view')}</h1>
				<p class="adm-desc">{tFn('og2.mv_desc')}</p>
			</div>
		</div>
	</header>
	<div class="og-note"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" />{tFn('og2.mv_real')}</div>

	<div class="og-grid2">
		<!-- 1. L'arrivée -->
		<section class="adm-card og-scene" aria-labelledby="mv1">
			<p class="og-step"><span>1</span><span id="mv1">{tFn('og2.mv_s1')}</span></p>
			<div class="og-phone">
				<div class="og-phone-top"># {data.welcomeChannel ?? tFn('og2.mv_channel')}</div>
				{#if welcomeOn}
					<div class="og-msg"><span class="og-av og-av-bot"><Icon d={OG_ICON} /></span><div><div class="og-who">OctoGuard <span class="adm-pill">{tFn('og2.mv_bot')}</span></div><div class="og-text">{welcomeText}</div></div></div>
				{:else}
					<div class="og-phone-empty">{tFn('og2.mv_welcome_off')}</div>
				{/if}
			</div>
			<p class="og-help">{tFn(welcomeOn ? 'og2.mv_s1_help' : 'og2.mv_s1_off')} <a class="og-linkbtn" href="/admin/octoguard/welcome">{tFn('og2.nav_welcome')}</a></p>
		</section>

		<!-- 2. Avant d'envoyer : « Tu es sûr ? » (lot 5) -->
		<section class="adm-card og-scene" aria-labelledby="mv2">
			<div class="og-scene-head">
				<p class="og-step"><span>2</span><span id="mv2">{tFn('og2.mv_nudge')}</span></p>
				<label class="og-switch">
					<input type="checkbox" checked={nudgeOn} disabled={nudgeSaving} onchange={(e) => setNudge(e.currentTarget.checked)} />
					<span class="og-track"></span>
					<span>{tFn(nudgeOn ? 'og2.mv_nudge_on' : 'og2.mv_nudge_off')}</span>
				</label>
			</div>
			<div class="og-samples" role="group" aria-label={tFn('og2.mv_nudge_examples')}>
				{#each SAMPLES as x (x.id)}
					<button type="button" class="og-chip" aria-pressed={sample.id === x.id} onclick={() => (sample = x)}>{tFn(`og2.mv_nudge_ex_${x.id}`)}</button>
				{/each}
			</div>
			<div class="og-phone" class:og-phone-off={!nudgeOn}>
				<div class="og-phone-top"># {tFn('og2.mv_channel')}</div>
				<div class="og-nudge-wrap"><NudgeBanner nudge={sample.nudge} autofocus={false} onReformulate={() => {}} onSendAnyway={() => {}} /></div>
				<div class="og-composer"><span class="adm-input" style="display:flex;align-items:center">{tFn(`og2.mv_nudge_draft_${sample.id}`)}</span></div>
			</div>
			<p class="og-help">{tFn('og2.mv_nudge_help')}</p>
			{#if nudgeOn && !ogOn}<p class="og-help og-warnline">{tFn('og2.mv_nudge_og_off')}</p>{/if}
			{#if nudgeError}<p class="og-help og-warnline" role="alert">{nudgeError}</p>{/if}
		</section>

		<!-- 3. Un message retenu -->
		<section class="adm-card og-scene" aria-labelledby="mv3">
			<p class="og-step"><span>3</span><span id="mv3">{tFn('og2.mv_s2')}</span></p>
			<div class="og-phone">
				<div class="og-phone-top"># {tFn('og2.mv_channel')}</div>
				<div class="og-alert og-k-delete" role="note"><Icon d={'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'} />{octoguardMessage(tFn, core('message', 'deleted'))}</div>
				<div class="og-composer"><span class="adm-input" style="display:flex;align-items:center">{tFn('og2.mv_s2_draft')}</span></div>
			</div>
			<p class="og-help">{tFn('og2.mv_s2_help')} <i>{tFn('forum.text_kept')}</i></p>
		</section>

		<!-- 4. Un avertissement -->
		<section class="adm-card og-scene" aria-labelledby="mv4">
			<p class="og-step"><span>4</span><span id="mv4">{tFn('og2.mv_s3')}</span></p>
			<div class="og-phone"><div class="og-phone-top"># {tFn('og2.mv_channel')}</div>
				<div class="og-alert og-k-warn" role="note"><Icon d={'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'} />{octoguardMessage(tFn, core('warn', 'given'))}</div>
			</div>
			<p class="og-help">{tFn('og2.mv_s3_help')}</p>
		</section>

		<!-- 5. En sourdine -->
		<section class="adm-card og-scene" aria-labelledby="mv5">
			<p class="og-step"><span>5</span><span id="mv5">{tFn('og2.mv_s4')}</span></p>
			<div class="og-phone"><div class="og-phone-top"># {tFn('og2.mv_channel')}</div>
				<div class="og-alert og-k-delete" role="note"><Icon d="M11 5L6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6" />{octoguardMessage(tFn, core('mute', 'applied'))}</div>
				<div class="og-composer"><span class="adm-input og-disabled">{tFn('chat.muted_until', { date: until })}</span></div>
			</div>
			<p class="og-help">{tFn('og2.mv_s4_help')} <i>{tFn('forum.err_muted_until', { date: until })}</i></p>
		</section>

		<!-- 6. Exclusion temporaire -->
		<section class="adm-card og-scene" aria-labelledby="mv6">
			<p class="og-step"><span>6</span><span id="mv6">{tFn('og2.mv_s5')}</span></p>
			<div class="og-alert og-k-delete" role="note"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M5.6 5.6l12.8 12.8" />{octoguardMessage(tFn, core('ban_temp', 'applied'))}</div>
			<p class="og-help">{tFn('og2.mv_s5_help')}</p>
		</section>

		<!-- 7. Les commandes -->
		<section class="adm-card og-scene" aria-labelledby="mv7">
			<p class="og-step"><span>7</span><span id="mv7">{tFn('og2.mv_s6')}</span></p>
			{#if data.commands.length}
				<div class="og-phone"><div class="og-phone-top"># {tFn('og2.mv_channel')}</div>
					{#each data.commands as c (c.id)}
						<div class="og-msg"><span class="og-av">{sampleUser.slice(0, 1)}</span><div><div class="og-who">{sampleUser}</div><div class="og-text"><code>!{c.command}</code></div></div></div>
						<div class="og-msg"><span class="og-av og-av-bot"><Icon d={OG_ICON} /></span><div><div class="og-who">OctoGuard <span class="adm-pill">{tFn('og2.mv_bot')}</span></div><div class="og-text">{c.response}</div></div></div>
					{/each}
				</div>
			{:else}
				<p class="og-phone-empty">{tFn('og2.mv_no_commands')}</p>
			{/if}
			<p class="og-help"><a class="og-linkbtn" href="/admin/octoguard/commands">{tFn('og2.nav_commands')}</a></p>
		</section>

		<!-- 8. Signaler -->
		<section class="adm-card og-scene" aria-labelledby="mv8">
			<p class="og-step"><span>8</span><span id="mv8">{tFn('og2.mv_s7')}</span></p>
			<div class="og-phone"><div class="og-phone-top">{tFn('report.title')}</div>
				<div style="padding:0.75rem;display:flex;flex-direction:column;gap:0.5rem">
					<b style="font-size:0.8125rem">{tFn('report.why')}</b>
					{#each CATS as c (c)}<div class="og-cat"><b>{tFn(`report.cat_${c}`)}</b>{#if c !== 'other'}<span class="og-help">{tFn(`report.cat_${c}_desc`)}</span>{/if}</div>{/each}
				</div>
			</div>
			<p class="og-help">{tFn('og2.mv_s7_help', { action: tFn('report.action') })}</p>
		</section>

		<!-- 9. Ce qui ne se voit jamais -->
		<section class="adm-card og-scene" aria-labelledby="mv9">
			<p class="og-step"><span>9</span><span id="mv9">{tFn('og2.mv_s8')}</span></p>
			<ul class="og-keys-mv">
				<li><span class="adm-pill og-tone og-k-observe">{tFn('og2.lv_observe')}</span>{tFn('og2.mv_s8_observe')}</li>
				<li><span class="adm-pill og-tone og-k-report">{tFn('og2.lv_report')}</span>{tFn('og2.mv_s8_report')}</li>
				<li><span class="adm-pill">{tFn('og2.mv_s8_dm_tag')}</span>{tFn('og2.mv_s8_dm')}</li>
			</ul>
		</section>
	</div>
</div>

<style>
	.og-scene { display: flex; flex-direction: column; gap: 0.75rem; }
	.og-step { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-weight: 600; font-size: 0.875rem; }
	.og-step span:first-child { width: 1.375rem; height: 1.375rem; border-radius: 99px; display: grid; place-items: center; font-size: 0.75rem; background: color-mix(in srgb, var(--nx-header-accent) 15%, transparent); color: var(--nx-header-accent); }
	.og-phone { border: 1px solid var(--nx-border); border-radius: 10px; overflow: hidden; background: var(--nx-surface); }
	.og-phone-top { padding: 0.5rem 0.75rem; font-size: 0.75rem; font-weight: 600; color: var(--nx-text-muted); border-bottom: 1px solid var(--nx-border); }
	.og-phone-empty { padding: 1rem 0.75rem; font-size: 0.8125rem; color: var(--nx-text-muted); margin: 0; }
	.og-msg { display: grid; grid-template-columns: 1.75rem 1fr; gap: 0.625rem; padding: 0.5rem 0.75rem; font-size: 0.8125rem; }
	.og-av { width: 1.75rem; height: 1.75rem; border-radius: 99px; display: grid; place-items: center; font-weight: 650; font-size: 0.7rem; background: #6b7a8f; color: #fff; }
	.og-av-bot { background: var(--nx-header-accent); color: var(--nx-on-accent, #fff); }
	.og-av-bot :global(svg) { width: 1rem; height: 1rem; }
	.og-who { font-weight: 600; font-size: 0.78rem; display: flex; align-items: center; gap: 0.375rem; }
	.og-text { white-space: pre-wrap; overflow-wrap: anywhere; }
	.og-alert { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.625rem 0.75rem; padding: 0.625rem 0.75rem; border-radius: 8px; font-size: 0.8125rem; line-height: 1.45; color: var(--nx-text); border: 1px solid color-mix(in srgb, var(--k) 40%, transparent); background: color-mix(in srgb, var(--k) 8%, var(--nx-surface)); }
	.og-alert :global(svg) { color: var(--k); margin-top: 2px; }
	.og-composer { padding: 0.625rem 0.75rem; border-top: 1px solid var(--nx-border); }
	.og-disabled { opacity: .7; display: flex; align-items: center; font-size: 0.75rem; }
	.og-cat { display: flex; flex-direction: column; padding: 0.4rem 0.6rem; border: 1px solid var(--nx-border); border-radius: 8px; font-size: 0.78rem; }
	.og-keys-mv { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.625rem; font-size: 0.8125rem; line-height: 1.5; }
	.og-scene-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.og-samples { display: flex; flex-wrap: wrap; gap: 0.375rem; }
	.og-chip { padding: 0.2rem 0.65rem; border-radius: 99px; font-size: 0.75rem; cursor: pointer; color: var(--nx-text-muted); border: 1px solid var(--nx-border); background: transparent; }
	.og-chip[aria-pressed='true'] { color: var(--nx-header-accent); border-color: color-mix(in srgb, var(--nx-header-accent) 50%, transparent); background: color-mix(in srgb, var(--nx-header-accent) 10%, transparent); }
	.og-chip:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.og-nudge-wrap { padding: 0.625rem 0.75rem 0; }
	.og-phone-off { opacity: 0.55; }
	.og-warnline { color: var(--nx-warn); }
	.og-keys-mv li { display: flex; gap: 0.5rem; align-items: flex-start; flex-wrap: wrap; }
</style>
