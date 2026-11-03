<script lang="ts">
	// Les réglages fins d'une règle, dans un panneau à droite : cran, seuils,
	// endroits, équipe exemptée, et ce qu'elle a pris dernièrement.
	import { onMount, untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import { portal } from '$lib/actions/portal'
	import Icon from './Icon.svelte'
	import LevelPicker from './LevelPicker.svelte'
	import { og } from '$lib/octoguard/api'
	import { levelOf, intendedOf, patchForLevel, describe, ruleIcon, SURFACES, IMMUNE_ROLES, categoryOf, type Rule, type Level, type Surface } from '$lib/octoguard/rules'

	let { rule, token, onchange, ondelete, onclose }: {
		rule: Rule
		token: string | null
		onchange: (r: Rule) => void
		ondelete: (id: string) => void
		onclose: () => void
	} = $props()
	const tFn = $derived($t)

	// Brouillon local : rien ne part tant qu'on n'enregistre pas.
	const start = untrack(() => rule)
	let level = $state<Level>(levelOf(start))
	let params = $state<Record<string, any>>($state.snapshot(start.params ?? {}))
	let scopes = $state<Surface[]>([...(start.scopes?.length ? start.scopes : (['chat'] as Surface[]))])
	let immune = $state<string[]>([...(start.immunized_role_types ?? [])])
	let maxAge = $state<number>(start.conditions?.account_max_age_days ?? 0)
	let domainsText = $state<string>((start.params?.domains ?? []).join(', '))

	let busy = $state(false)
	let error = $state<string | null>(null)
	let confirmDelete = $state(false)

	type Hit = { id: string; action: string; excerpt: string | null; at: string; observed: boolean | null }
	let hits = $state<Hit[] | null>(null)
	onMount(async () => {
		try { hits = (await og<{ hits: Hit[] }>(token, `/rules/${start.id}/hits?limit=10`)).hits }
		catch { hits = [] }
	})
	onMount(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onclose() }
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})

	const NUM: Record<string, Array<{ key: string; min: number; max: number }>> = {
		link_spam: [{ key: 'max_links', min: 0, max: 50 }],
		mention_spam: [{ key: 'max_mentions', min: 1, max: 100 }],
		caps: [{ key: 'min_length', min: 1, max: 500 }, { key: 'threshold_percent', min: 1, max: 100 }],
		flood: [{ key: 'max_repeats', min: 2, max: 50 }, { key: 'repeat_window_s', min: 5, max: 3600 }, { key: 'max_messages', min: 2, max: 100 }, { key: 'burst_window_s', min: 1, max: 600 }],
		zalgo: [{ key: 'max_combining', min: 1, max: 20 }],
	}
	const numFields = $derived(NUM[start.type] ?? [])

	function toggleIn<T>(list: T[], v: T): T[] { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v] }

	async function saveAll() {
		if (scopes.length === 0) { error = tFn('og2.err_scope'); return }
		busy = true
		error = null
		const p = { ...params }
		if (start.type === 'link_domain') p.domains = domainsText.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean)
		const body: Record<string, unknown> = { ...patchForLevel(start, level), params: p, scopes, immunized_role_types: immune }
		if (categoryOf(start) === 'newcomers' && maxAge > 0) body.conditions = { ...(start.conditions ?? {}), account_max_age_days: Math.round(maxAge) }
		try {
			const res = await og<{ rule: Rule }>(token, `/rules/${start.id}`, 'PUT', body)
			onchange(res.rule)
			onclose()
		} catch (e: any) {
			error = e?.code === 'RE2_REQUIRED' ? tFn('og2.err_re2') : tFn('og2.err_save')
		} finally { busy = false }
	}

	async function remove() {
		busy = true
		try {
			await og(token, `/rules/${start.id}`, 'DELETE')
			ondelete(start.id)
			onclose()
		} catch { error = tFn('og2.err_save'); busy = false }
	}

	const when = (iso: string) => {
		const d = new Date(iso)
		return isNaN(d.getTime()) ? iso : d.toLocaleString(String($locale ?? 'fr'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
	}
</script>

<div use:portal>
	<div class="og-drawer-scrim" role="presentation" onclick={onclose}></div>
	<div class="og-drawer og-page" role="dialog" aria-modal="true" aria-labelledby="og-drawer-title" tabindex="-1">
		<div class="og-drawer-head">
			<span class="og-rule-ico"><Icon d={ruleIcon(start)} /></span>
			<div style="flex:1;min-width:0">
				<div id="og-drawer-title" style="font-weight:600;font-size:1rem">{start.name}</div>
				<div class="og-help">{describe(start, tFn)}</div>
			</div>
			<button type="button" class="adm-btn adm-btn--icon" onclick={onclose} aria-label={tFn('og2.close')}><Icon d="M6 6l12 12 M18 6L6 18" /></button>
		</div>

		<div class="og-drawer-body">
			<div class="og-field">
				<span class="og-lbl">{tFn('og2.level_label')}</span>
				<LevelPicker value={level} intended={intendedOf(start)} name="dlv-{start.id}" busy={busy} onpick={(l) => (level = l)} />
			</div>

			{#if numFields.length || categoryOf(start) === 'newcomers'}
				<div class="og-field">
					<span class="og-lbl">{tFn('og2.thresholds')}</span>
					{#each numFields as f (f.key)}
						<label class="og-inline"><input class="adm-input og-num" type="number" min={f.min} max={f.max} bind:value={params[f.key]} /><span>{tFn(`og2.p_${f.key}`)}</span></label>
					{/each}
					{#if categoryOf(start) === 'newcomers'}
						<label class="og-inline"><input class="adm-input og-num" type="number" min="1" max="365" bind:value={maxAge} /><span>{tFn('og2.p_account_max_age_days')}</span></label>
					{/if}
				</div>
			{/if}

			{#if start.type === 'link_domain'}
				<div class="og-field">
					<label class="og-lbl" for="og-domains">{tFn('og2.p_domains')}</label>
					<select class="adm-input" bind:value={params.mode}>
						<option value="blacklist">{tFn('og2.p_mode_block')}</option>
						<option value="whitelist">{tFn('og2.p_mode_allow')}</option>
					</select>
					<input id="og-domains" class="adm-input" bind:value={domainsText} placeholder={tFn('og2.p_domains_ph')} />
					<p class="og-help">{tFn('og2.p_domains_help')}</p>
				</div>
			{:else if start.type === 'keywords'}
				<div class="og-note"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" />{tFn('og2.words_in_card')}</div>
			{:else if start.type === 'regex'}
				<div class="og-field">
					<span class="og-lbl">{tFn('og2.p_pattern')}</span>
					<code style="font-size:0.75rem;overflow-wrap:anywhere">{start.params?.pattern}</code>
					<p class="og-help"><a class="og-linkbtn" href="/admin/octoguard/automod">{tFn('og2.edit_advanced')}</a></p>
				</div>
			{/if}

			<div class="og-field">
				<span class="og-lbl">{tFn('og2.where')}</span>
				<div class="adm-chips">
					{#each SURFACES as s (s)}
						<button type="button" class="adm-chip" aria-pressed={scopes.includes(s)} onclick={() => (scopes = toggleIn(scopes, s))}>{tFn(`og2.surface_${s}`)}</button>
					{/each}
				</div>
			</div>

			<div class="og-field">
				<span class="og-lbl">{tFn('og2.exempt')}</span>
				<div class="adm-chips">
					{#each IMMUNE_ROLES as r (r)}
						<button type="button" class="adm-chip" aria-pressed={immune.includes(r)} onclick={() => (immune = toggleIn(immune, r))}>{tFn(`og2.role_${r}`)}</button>
					{/each}
				</div>
				<p class="og-help">{tFn('og2.exempt_help')}</p>
			</div>

			<div class="og-field">
				<span class="og-lbl">{tFn('og2.recent_hits')}</span>
				{#if hits === null}
					<p class="og-help">{tFn('og2.loading')}</p>
				{:else if hits.length === 0}
					<p class="og-help">{tFn('og2.no_hits')}</p>
				{:else}
					<div class="og-rows">
						{#each hits as h (h.id)}
							<div class="og-row">
								<span class="og-ic {h.observed ? 'og-k-observe' : 'og-k-delete'}"><Icon d={h.observed ? 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z' : 'M5 13l4 4L19 7'} /></span>
								<div class="og-row-body">
									<div>{h.excerpt ?? '…'}</div>
									<div class="og-meta">{h.observed ? tFn('og2.hit_observed') : tFn('og2.hit_acted')} · {when(h.at)}</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			{#if error}<p class="og-error" role="alert">{error}</p>{/if}
		</div>

		<div class="og-drawer-foot">
			{#if confirmDelete}
				<span class="adm-actions">
					<span class="og-help">{tFn('og2.delete_confirm')}</span>
					<button type="button" class="adm-btn adm-btn--danger adm-btn--sm" disabled={busy} onclick={remove}>{tFn('og2.delete_yes')}</button>
					<button type="button" class="adm-btn adm-btn--sm" onclick={() => (confirmDelete = false)}>{tFn('og2.cancel')}</button>
				</span>
			{:else}
				<button type="button" class="adm-btn adm-btn--sm" style="color:var(--nx-bad);border-color:transparent;background:transparent" onclick={() => (confirmDelete = true)}>{tFn('og2.delete_rule')}</button>
				<span class="adm-actions">
					<a class="adm-btn" href="/admin/octoguard/sandbox?rule={start.id}">{tFn('og2.try')}</a>
					<button type="button" class="adm-btn adm-btn--primary" disabled={busy} onclick={saveAll}>{tFn('og2.save')}</button>
				</span>
			{/if}
		</div>
	</div>
</div>
