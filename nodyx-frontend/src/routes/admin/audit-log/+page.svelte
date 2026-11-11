<script lang="ts">
	import type { PageData } from './$types'
	import { t, locale } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	// Toutes les actions que le cœur écrit réellement dans ce journal, rangées
	// par famille. Ton : la couleur dit la nature (sanction, levée, alerte,
	// information), jamais une couleur par action.
	type Tone = 'bad' | 'ok' | 'warn' | 'info' | 'muted'
	const OCTO = 'octoguard' + '.'
	const GROUPS: Array<{ key: string; actions: Array<[string, Tone]> }> = [
		{ key: 'alog.grp_members', actions: [
			['ban_user', 'bad'], ['unban_user', 'ok'], ['kick_member', 'bad'], ['change_role', 'warn'],
			['voice_kick', 'bad'], ['reveal_email', 'warn'], ['warn_user', 'warn'],
		] },
		{ key: 'alog.grp_bans', actions: [
			['ip_ban_add', 'bad'], ['ip_ban_remove', 'ok'], ['email_ban_add', 'bad'], ['email_ban_remove', 'ok'],
		] },
		{ key: 'alog.grp_content', actions: [
			['delete_thread', 'bad'], ['pin_thread', 'warn'], ['unpin_thread', 'muted'], ['lock_thread', 'bad'], ['unlock_thread', 'ok'],
			['category_set_post_role', 'info'],
			['create_announcement', 'info'], ['update_announcement', 'info'], ['delete_announcement', 'muted'],
		] },
		{ key: 'alog.grp_reports', actions: [
			['report_actioned', 'bad'], ['report_dismissed', 'muted'], ['report_reviewed', 'info'],
		] },
		{ key: 'alog.grp_instance', actions: [
			['settings_update', 'info'], ['module_toggle', 'info'], ['publish_appearance', 'info'],
		] },
		// Préfixe « octoguard. » ajouté plus bas : écrit en toutes lettres, le
		// vérificateur i18n prendrait ces noms d'action pour des clés.
		{ key: 'alog.grp_octoguard', actions: ([
			['delete_message', 'bad'], ['warn_user', 'warn'], ['mute_user', 'bad'],
			['unmute_user', 'ok'], ['ban_temp_user', 'bad'], ['notify', 'info'],
			['report_filed', 'warn'], ['action_undone', 'ok'],
			['rule_created', 'info'], ['rule_updated', 'info'], ['rule_deleted', 'muted'],
			['welcome_sent', 'muted'],
			['ladder_applied', 'bad'], ['ladder_proposed', 'warn'], ['ladder_approved', 'bad'],
			['ladder_refused', 'ok'], ['ladder_expired', 'muted'], ['ladder_undone', 'ok'], ['ladder_settings', 'info'],
			['ladder_engine_alert', 'warn'],
			['appeal_filed', 'warn'], ['appeal_upheld', 'info'], ['appeal_overturned', 'ok'],
		] as Array<[string, Tone]>).map(([a, tone]) => [`${OCTO}${a}`, tone] as [string, Tone]) },
	]
	const TONE: Record<string, Tone> = Object.fromEntries(GROUPS.flatMap(g => g.actions))

	// « octoguard·delete_message » → clé « alog.a_octoguard_delete_message »
	const labelKey = (action: string) => `alog.a_${action.replace(/\./g, '_')}`
	function label(action: string): string {
		if (TONE[action]) return tFn(labelKey(action))
		// Action que ce tableau ne connaît pas encore : on la montre telle quelle,
		// rangée sous OctoGuard si c'en est une, plutôt que de la cacher.
		return action.startsWith(OCTO)
			? tFn('alog.a_octoguard_other', { action: action.slice(OCTO.length) })
			: action
	}
	const pillTone = (action: string) => {
		const tone = TONE[action] ?? 'muted'
		return tone === 'bad' ? 'adm-pill--admin' : tone === 'warn' ? 'adm-pill--owner' : tone === 'info' ? 'adm-pill--moderator' : tone === 'ok' ? 'adm-pill--ok' : 'adm-pill--member'
	}

	function actorLabel(name: string) {
		return name === 'octoguard:auto' ? tFn('alog.actor_octoguard') : name
	}

	function timeAgo(d: string) {
		const diff = Date.now() - new Date(d).getTime()
		const m = Math.floor(diff / 60000)
		const h = Math.floor(m / 60)
		const day = Math.floor(h / 24)
		if (m < 1)   return tFn('alog.just_now')
		if (m < 60)  return tFn('alog.ago_min', { n: m })
		if (h < 24)  return tFn('alog.ago_h', { n: h })
		if (day < 7) return tFn('alog.ago_j', { n: day })
		return new Date(d).toLocaleDateString($locale, { day: '2-digit', month: 'short', year: 'numeric' })
	}

	function formatDate(d: string) {
		return new Date(d).toLocaleString($locale, {
			day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
		})
	}

	function detail(entry: any): string {
		const m = entry.metadata ?? {}
		switch (entry.action) {
			case 'ban_user': {
				const parts: string[] = []
				if (m.reason) parts.push(tFn('alog.reason', { reason: m.reason }))
				if (m.ban_ip) parts.push(tFn('alog.ip_banned'))
				if (m.ban_email) parts.push(tFn('alog.email_banned'))
				return parts.join(' · ')
			}
			case 'ip_ban_add':
			case 'email_ban_add':
				return m.reason ? tFn('alog.reason', { reason: m.reason }) : ''
			case 'change_role':
				return m.old_role && m.new_role
					? `${tFn(`amem.role_${m.old_role}`)} → ${tFn(`amem.role_${m.new_role}`)}`
					: ''
			case 'module_toggle':
				return typeof m.enabled === 'boolean' ? (m.enabled ? tFn('alog.enabled') : tFn('alog.disabled')) : ''
			case 'settings_update':
				return m.from !== undefined || m.to !== undefined ? `${m.from || '·'} → ${m.to || '·'}` : ''
			case 'category_set_post_role':
				return m.post_min_role ? tFn(`acat.role_${m.post_min_role}`) : ''
		}
		if (entry.action.startsWith(OCTO) && m.rule_name) return tFn('alog.rule', { name: m.rule_name })
		return ''
	}

	function pageHref(offset: number) {
		const p = new URLSearchParams()
		if (offset > 0) p.set('offset', String(offset))
		if (data.filterAction) p.set('action', data.filterAction)
		if (data.filterActor) p.set('actor', data.filterActor)
		const q = p.toString()
		return q ? `?${q}` : '?'
	}
</script>

<svelte:head><title>{tFn('alog.page_title')}</title></svelte:head>

<div class="adm-page">
	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('alog.title')}</h1>
			<p class="adm-desc">{data.total > 1 ? tFn('alog.total_many', { n: data.total }) : tFn('alog.total_one', { n: data.total })}</p>
		</div>
	</header>

	<form method="GET" class="adm-actions">
		<label>
			<span class="sr-only">{tFn('alog.col_action')}</span>
			<select name="action" class="adm-input" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}>
				<option value="">{tFn('alog.all_actions')}</option>
				{#each GROUPS as g (g.key)}
					<optgroup label={tFn(g.key)}>
						{#each g.actions as [a] (a)}
							<option value={a} selected={a === data.filterAction}>{tFn(labelKey(a))}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</label>
		<label class="adm-search">
			<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
			<input type="search" name="actor" class="adm-input" placeholder={tFn('alog.filter_ph')} aria-label={tFn('alog.filter_ph')} value={data.filterActor} />
		</label>
		<button type="submit" class="adm-btn">{tFn('alog.filter')}</button>
		{#if data.filterAction || data.filterActor}
			<a href="/admin/audit-log" class="adm-btn adm-btn--sm">{tFn('alog.reset')}</a>
		{/if}
	</form>

	<div class="adm-table-wrap">
		<table class="adm-table">
			<thead>
				<tr>
					<th>{tFn('alog.col_action')}</th>
					<th>{tFn('alog.col_admin')}</th>
					<th>{tFn('alog.col_target')}</th>
					<th>{tFn('alog.col_detail')}</th>
					<th class="adm-num">{tFn('alog.col_date')}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.entries as entry (entry.id)}
					<tr>
						<td class="adm-cell-main">
							<span class="adm-pill {pillTone(entry.action)}">{label(entry.action)}</span>
						</td>
						<td data-label={tFn('alog.col_admin')}>
							{#if entry.actor_username === 'octoguard:auto'}
								<span class="adm-muted">{actorLabel(entry.actor_username)}</span>
							{:else}
								<a href="/users/{entry.actor_username}" class="font-medium hover:underline" style="color:var(--nx-text)">{entry.actor_username}</a>
							{/if}
						</td>
						<td data-label={tFn('alog.col_target')}>
							{#if entry.target_label}
								{#if entry.target_type === 'user'}
									<a href="/users/{entry.target_label}" class="hover:underline truncate inline-block align-bottom" style="color:var(--nx-text); max-width:16rem">{entry.target_label}</a>
								{:else}
									<span class="line-clamp-1" style="max-width:16rem" title={entry.target_label}>{entry.target_label}</span>
								{/if}
							{:else}
								<span class="adm-muted">·</span>
							{/if}
						</td>
						<td class="adm-muted text-xs" data-label={tFn('alog.col_detail')}>
							<span class="line-clamp-2" style="max-width:18rem">{detail(entry) || '·'}</span>
						</td>
						<td class="adm-num adm-muted whitespace-nowrap" data-label={tFn('alog.col_date')}>
							<time datetime={entry.created_at} title={formatDate(entry.created_at)}>{timeAgo(entry.created_at)}</time>
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="adm-empty">{data.filterAction || data.filterActor ? tFn('alog.none_found') : tFn('alog.empty')}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if data.total > data.limit}
		<nav class="adm-pager" aria-label={tFn('amod.pager_label')}>
			<span>{tFn('alog.pagination', { from: data.offset + 1, to: Math.min(data.offset + data.limit, data.total), total: data.total })}</span>
			<div class="adm-pager-links">
				{#if data.offset > 0}
					<a class="adm-btn adm-btn--sm" href={pageHref(Math.max(0, data.offset - data.limit))}>{tFn('alog.prev')}</a>
				{/if}
				{#if data.offset + data.limit < data.total}
					<a class="adm-btn adm-btn--sm" href={pageHref(data.offset + data.limit)}>{tFn('alog.next')}</a>
				{/if}
			</div>
		</nav>
	{/if}
</div>
