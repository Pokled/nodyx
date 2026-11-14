<script lang="ts">
	// Réglages › Notifications › Mentions (maquette https://nodyx.org/mentions-maquette.html,
	// section 5 ; D54-D55). Chaque changement s'enregistre aussitôt.
	import { onMount } from 'svelte'
	import { page } from '$app/state'
	import { t, locale } from '$lib/i18n'
	import { apiFetch } from '$lib/api'

	type Who = 'all' | 'following' | 'team'
	interface Muted { id: string; username: string; display_name: string | null; avatar: string | null }

	const token = $derived(((page.data as any)?.token ?? null) as string | null)
	let who = $state<Who>('all')
	let quietOn = $state(false)
	let quietStart = $state(22 * 60)
	let quietEnd = $state(8 * 60)
	let mutes = $state<Muted[]>([])
	let loaded = $state(false)
	let saved = $state(false)
	let error = $state('')
	let savedTimer: ReturnType<typeof setTimeout> | null = null

	const auth = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})

	onMount(async () => {
		try {
			const [p, m] = await Promise.all([
				apiFetch(fetch, '/mentions/prefs', { headers: auth() }).then(r => r.json()),
				apiFetch(fetch, '/mentions/mutes', { headers: auth() }).then(r => r.json()),
			])
			who = p.prefs?.who ?? 'all'
			if (p.prefs?.quiet_start !== null && p.prefs?.quiet_start !== undefined) {
				quietOn = true; quietStart = p.prefs.quiet_start; quietEnd = p.prefs.quiet_end
			}
			mutes = m.mutes ?? []
		} catch { /* réglages par défaut affichés */ }
		loaded = true
	})

	async function save() {
		error = ''
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
		const r = await apiFetch(fetch, '/mentions/prefs', {
			method: 'PUT', headers: auth(),
			body: JSON.stringify({ who, quiet_start: quietOn ? quietStart : null, quiet_end: quietOn ? quietEnd : null, quiet_tz: quietOn ? tz : null }),
		}).catch(() => null)
		if (!r?.ok) { error = $t('mention.settings_error'); return }
		saved = true
		if (savedTimer) clearTimeout(savedTimer)
		savedTimer = setTimeout(() => (saved = false), 1800)
	}

	async function unmute(m: Muted) {
		const r = await apiFetch(fetch, `/mentions/mutes/${m.id}`, { method: 'DELETE', headers: auth() }).catch(() => null)
		if (r?.ok) mutes = mutes.filter(x => x.id !== m.id)
	}

	const slots = Array.from({ length: 48 }, (_, i) => i * 30)
	const hhmm = (m: number) => new Intl.DateTimeFormat($locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(2026, 0, 1, Math.floor(m / 60), m % 60))
	const COLORS = ['#7c3aed', '#0f766e', '#b45309', '#be185d', '#334155', '#1d4ed8', '#15803d']
	const colorOf = (n: string) => COLORS[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]
</script>

<section class="ms" aria-labelledby="ms-title">
	<header class="ms-head">
		<h3 id="ms-title">{$t('mention.settings_title')}</h3>
		<span class="ms-saved" class:on={saved} role="status" aria-live="polite">{saved ? $t('mention.settings_saved') : ''}</span>
	</header>

	{#if loaded}
	<div class="ms-row">
		<h4>{$t('mention.settings_who')}</h4>
		<p class="ms-sd">{$t('mention.settings_who_desc')}</p>
		<div class="ms-radios" role="radiogroup" aria-label={$t('mention.settings_who')}>
			{#each [['all', 'mention.settings_who_all', 'mention.settings_who_all_desc'], ['following', 'mention.settings_who_following', 'mention.settings_who_following_desc'], ['team', 'mention.settings_who_team', 'mention.settings_who_team_desc']] as [v, k, d] (v)}
				<label class="ms-radio">
					<input type="radio" name="ms-who" value={v} checked={who === v} onchange={() => { who = v as Who; void save() }} />
					<span>{$t(k)}<small>{$t(d)}</small></span>
				</label>
			{/each}
		</div>
	</div>

	<div class="ms-row">
		<h4>{$t('mention.settings_quiet')}</h4>
		<p class="ms-sd">{$t('mention.settings_quiet_desc')}</p>
		<div class="ms-hours">
			<label class="ms-check"><input type="checkbox" bind:checked={quietOn} onchange={() => void save()} /> {$t('mention.settings_quiet_from')}</label>
			<select aria-label={$t('mention.settings_quiet_start')} bind:value={quietStart} disabled={!quietOn} onchange={() => void save()}>
				{#each slots as m (m)}<option value={m}>{hhmm(m)}</option>{/each}
			</select>
			<span>{$t('mention.settings_quiet_to')}</span>
			<select aria-label={$t('mention.settings_quiet_end')} bind:value={quietEnd} disabled={!quietOn} onchange={() => void save()}>
				{#each slots as m (m)}<option value={m}>{hhmm(m)}</option>{/each}
			</select>
		</div>
	</div>

	<div class="ms-row">
		<h4>{$t('mention.settings_mutes')}</h4>
		<p class="ms-sd">{$t('mention.settings_mutes_desc')}</p>
		{#if mutes.length}
			<ul class="ms-mutes">
				{#each mutes as m (m.id)}
					<li>
						<span class="ms-av" style={m.avatar ? '' : `background:${colorOf(m.username)}`}>{#if m.avatar}<img src={m.avatar} alt="" />{:else}{(m.display_name || m.username).slice(0, 1).toUpperCase()}{/if}</span>
						<span class="ms-name">{m.display_name || m.username}</span>
						<button type="button" class="ms-btn" onclick={() => unmute(m)}>{$t('mention.settings_unmute')}</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="ms-empty">{$t('mention.settings_mutes_empty')}</p>
		{/if}
	</div>

	<p class="ms-team">
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
		{$t('mention.settings_team_note')}
	</p>
	{#if error}<p class="ms-error" role="alert">{error}</p>{/if}
	{/if}
</section>

<style>
	.ms { background: var(--nx-surface); border: 1px solid color-mix(in srgb, var(--nx-text) 10%, transparent); border-radius: 14px; padding: 6px 18px 14px; margin-top: 14px; color: var(--nx-text); }
	.ms-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 0 2px; }
	.ms-head h3 { margin: 0; font-size: 15px; }
	.ms-saved { font-size: 12px; color: var(--nx-ok, #15803d); opacity: 0; transition: opacity .2s; }
	.ms-saved.on { opacity: 1; }
	.ms-row { padding: 14px 0; border-top: 1px solid color-mix(in srgb, var(--nx-text) 7%, transparent); }
	.ms-row:first-of-type { border-top: 0; }
	.ms-row h4 { margin: 0; font-size: 14px; font-weight: 600; }
	.ms-sd { font-size: 12.5px; color: var(--nx-text-muted); margin: 2px 0 10px; }
	.ms-radios { display: flex; flex-direction: column; gap: 8px; }
	.ms-radio { display: flex; gap: 9px; align-items: flex-start; font-size: 13.5px; cursor: pointer; }
	.ms-radio small { display: block; color: var(--nx-text-muted); font-size: 12px; }
	.ms-radio input, .ms-check input { accent-color: var(--nx-header-accent); margin-top: 3px; }
	.ms-hours { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
	.ms-check { display: inline-flex; gap: 7px; align-items: center; cursor: pointer; }
	.ms-hours select { font: inherit; font-size: 13px; border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); border-radius: 7px; background: var(--nx-surface); color: var(--nx-text); padding: 3px 6px; }
	.ms-hours select:disabled { opacity: .5; }
	.ms-mutes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.ms-mutes li { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
	.ms-av { width: 24px; height: 24px; border-radius: 7px; flex: none; display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 700; overflow: hidden; }
	.ms-av img { width: 100%; height: 100%; object-fit: cover; }
	.ms-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ms-btn { border: 0; background: transparent; color: var(--nx-text-muted); font-size: 12.5px; cursor: pointer; border-radius: 7px; padding: 3px 8px; }
	.ms-btn:hover { color: var(--nx-text); background: color-mix(in srgb, var(--nx-text) 6%, transparent); }
	.ms-empty { margin: 0; font-size: 13px; color: var(--nx-text-faint); }
	.ms-team { display: flex; gap: 7px; align-items: center; font-size: 12px; color: var(--nx-text-muted); margin: 6px 0 0; }
	.ms-team svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.ms-error { margin: 8px 0 0; font-size: 12.5px; color: var(--nx-bad); }
</style>
