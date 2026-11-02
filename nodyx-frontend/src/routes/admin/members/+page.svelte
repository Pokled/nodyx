<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData } from './$types'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { PUBLIC_API_URL } from '$app/env/public'
	import { untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	// ── Reset link génération ────────────────────────────────────────────────
	let resetLinkResult = $state<{ username: string; reset_url: string; expires_at: string } | null>(null)
	let resetLinkError  = $state('')
	let generatingFor   = $state<string | null>(null)

	async function generateResetLink(userId: string) {
		generatingFor = userId
		resetLinkError = ''
		resetLinkResult = null
		try {
			const token = (page.data as any).token as string | null
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/admin/members/${userId}/reset-link`, {
				method:  'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			})
			if (!res.ok) {
				const j = await res.json().catch(() => ({}))
				resetLinkError = j.error ?? tFn('amem.err_gen_link')
			} else {
				resetLinkResult = await res.json()
			}
		} catch {
			resetLinkError = tFn('amem.err_network')
		} finally {
			generatingFor = null
		}
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text)
	}

	let search  = $state('')
	let members = $state(untrack(() => data.members.map((m: any) => ({ ...m }))))

	// ── Recherche, filtre par rôle, tri ───────────────────────────────────────
	// Recherche sur le pseudo, le grade, le rôle (dans la langue affichée) et
	// l'adresse si elle a été révélée. Tri par en-tête de colonne (aria-sort).
	const ROLES = ['owner', 'admin', 'moderator', 'member'] as const
	const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, moderator: 2, member: 3 }

	// Ce que l'utilisateur peut faire ici (D3) : les admins tout ; un modérateur
	// exclut (moderate_members), bannit seulement avec un grade ban_members (D4).
	// Changer un rôle, voir une adresse, générer un lien de réinitialisation :
	// admins seulement. Sous le rang d'admin, on n'agit que sur un rang
	// inférieur (le serveur le revérifie).
	const access     = $derived((page.data as any).access as { role: string | null; permissions: string[] } | undefined)
	const isAdmin    = $derived(access?.role === 'owner' || access?.role === 'admin')
	const canKick    = $derived(!!access?.permissions.includes('moderate_members'))
	const canBan     = $derived(!!access?.permissions.includes('ban_members'))
	const canGrades  = $derived(!!access?.permissions.includes('manage_grades'))
	// ROLE_RANK ici : 0 = le plus haut. Viser = être strictement au-dessus.
	// Un clic n'importe où sur la ligne ouvre la fiche, sauf sur un contrôle
	// (lien, bouton, menu, sélecteur de rôle) qui garde son propre rôle.
	function openFileFromRow(e: MouseEvent, userId: string) {
		if ((e.target as HTMLElement).closest('a, button, select, input, form, [popover], label')) return
		if (window.getSelection()?.toString()) return
		goto(`/admin/members/${userId}`)
	}
	const mayTarget  = (role: string) => isAdmin || (ROLE_RANK[access?.role ?? 'member'] ?? 9) < (ROLE_RANK[role] ?? 9)
	type SortKey = 'username' | 'role' | 'grade' | 'threads' | 'posts' | 'joined'
	let roleFilter = $state<string>('all')
	let sortKey    = $state<SortKey | null>(null)
	let sortDir    = $state<'asc' | 'desc'>('asc')

	const roleCounts = $derived(
		Object.fromEntries(ROLES.map((r) => [r, members.filter((m: any) => m.role === r).length]))
	)

	function toggleSort(key: SortKey) {
		if (sortKey === key) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; return }
		sortKey = key
		// Les quantités et les dates se lisent d'abord du plus grand au plus récent.
		sortDir = key === 'threads' || key === 'posts' || key === 'joined' ? 'desc' : 'asc'
	}
	const ariaSort = (key: SortKey) =>
		sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase()
		const list = members.filter((m: any) =>
			(roleFilter === 'all' || m.role === roleFilter) &&
			(!q ||
				m.username.toLowerCase().includes(q) ||
				(m.grade_name ?? '').toLowerCase().includes(q) ||
				tFn(`amem.role_${m.role}`).toLowerCase().includes(q) ||
				(revealed[m.user_id] ?? '').toLowerCase().includes(q))
		)
		if (!sortKey) return list
		const dir = sortDir === 'asc' ? 1 : -1
		const key = sortKey
		return [...list].sort((a: any, b: any) => {
			switch (key) {
				case 'username': return a.username.localeCompare(b.username, $locale) * dir
				case 'role':     return ((ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9)) * dir
				case 'grade':    return (a.grade_name ?? '\uffff').localeCompare(b.grade_name ?? '\uffff', $locale) * dir
				case 'threads':  return (a.thread_count - b.thread_count) * dir
				case 'posts':    return (a.post_count - b.post_count) * dir
				case 'joined':   return (new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()) * dir
			}
		})
	})

	// ── Menu d'actions par ligne (popover natif : jamais coupé par le tableau) ─
	function placeMenu(button: HTMLElement, id: string) {
		const menu = document.getElementById(id)
		if (!menu) return
		const r = button.getBoundingClientRect()
		menu.style.top = `${Math.round(r.bottom + 4)}px`
		menu.style.right = `${Math.round(window.innerWidth - r.right)}px`
		menu.style.left = 'auto'
	}
	function closeMenu(id: string) {
		const menu = document.getElementById(id) as (HTMLElement & { hidePopover?: () => void }) | null
		menu?.hidePopover?.()
	}

	// Adresses revelees pendant cette session d'ecran, jamais persistees.
	let revealed:  Record<string, string>  = $state({})
	let revealing: Record<string, boolean> = $state({})

	async function revealEmail(userId: string) {
		if (revealed[userId] || revealing[userId]) return
		revealing[userId] = true
		try {
			const res = await fetch(`/api/v1/admin/members/${userId}/email`, {
				headers: { Authorization: `Bearer ${page.data.token}` },
			})
			if (res.ok) revealed[userId] = (await res.json()).email
		} finally {
			revealing[userId] = false
		}
	}

	const bans: Array<{ user_id: string; username: string; email: string; reason: string | null; banned_at: string; banned_by_username: string | null }> = untrack(() => data.bans ?? [])
	const ipBans: Array<{ ip: string; reason: string | null; banned_at: string; banned_by_username: string | null }> = untrack(() => data.ipBans ?? [])
	const emailBans: Array<{ email: string; reason: string | null; banned_at: string; banned_by_username: string | null }> = untrack(() => data.emailBans ?? [])

	// ── Ban modal ─────────────────────────────────────────────────────────────
	let banTarget  = $state<{ userId: string; username: string } | null>(null)
	let banReason  = $state('')
	let banIp      = $state(false)
	let banEmail   = $state(false)
	// Message affiché après un ban : dit si l'IP a réellement été bannie.
	let banNotice  = $state<{ kind: 'ok' | 'warn'; text: string } | null>(null)

	function luminance(hex: string): number {
		const r = parseInt(hex.slice(1,3), 16)
		const g = parseInt(hex.slice(3,5), 16)
		const b = parseInt(hex.slice(5,7), 16)
		return (0.299*r + 0.587*g + 0.114*b) / 255
	}
</script>

<svelte:head><title>{tFn('amem.page_title')}</title></svelte:head>

{#snippet sortHead(key: 'username' | 'role' | 'grade' | 'threads' | 'posts' | 'joined', label: string, num = false)}
	<th aria-sort={ariaSort(key)} class={num ? 'adm-num' : ''}>
		<button type="button" class="adm-sort" onclick={() => toggleSort(key)}>
			{label}
			<svg class="adm-sort-arrow" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
		</button>
	</th>
{/snippet}

{#snippet email(userId: string, masked: string)}
	<!-- Adresse masquée par défaut, révélée par un geste explicite qui laisse une
	     trace dans le journal d'audit. Un mode discret à activer ne protégerait
	     personne : c'est le soir où on oublie de l'allumer que ça se voit. -->
	<span class="member-mail">
		<span>{revealed[userId] ?? masked}</span>
		{#if !revealed[userId] && isAdmin}
			<button type="button" class="member-reveal" onclick={() => revealEmail(userId)} disabled={revealing[userId]}>
				{revealing[userId] ? tFn('amem.revealing') : tFn('amem.reveal_email')}
			</button>
		{/if}
	</span>
{/snippet}

<div class="adm-page">
	{#if banNotice}
		<div class="adm-notice {banNotice.kind === 'ok' ? 'adm-notice--ok' : 'adm-notice--warn'}" role="status">
			<span>{banNotice.text}</span>
			<button type="button" class="adm-btn adm-btn--sm" onclick={() => banNotice = null}>{tFn('amem.close')}</button>
		</div>
	{/if}

	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('amem.title')}</h1>
			<p class="adm-desc">
				{members.length > 1 ? tFn('amem.total_many', { n: members.length }) : tFn('amem.total_one', { n: members.length })}
				{#if filtered.length !== members.length} · {tFn('amem.shown', { n: filtered.length })}{/if}
			</p>
		</div>
		<label class="adm-search">
			<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
			<input type="search" class="adm-input" placeholder={tFn('amem.search_ph2')} aria-label={tFn('amem.search_ph2')} bind:value={search} />
		</label>
	</header>

	<div class="adm-chips" role="group" aria-label={tFn('amem.col_role')}>
		<button type="button" class="adm-chip" aria-pressed={roleFilter === 'all'} onclick={() => roleFilter = 'all'}>
			{tFn('amem.filter_all')} <span class="adm-chip-count">{members.length}</span>
		</button>
		{#each ROLES as r}
			{#if roleCounts[r] > 0}
				<button type="button" class="adm-chip" aria-pressed={roleFilter === r} onclick={() => roleFilter = r}>
					{tFn(`amem.role_${r}`)} <span class="adm-chip-count">{roleCounts[r]}</span>
				</button>
			{/if}
		{/each}
	</div>

	<div class="adm-table-wrap">
		<table class="adm-table">
			<thead>
				<tr>
					{@render sortHead('username', tFn('amem.col_member'))}
					{@render sortHead('role', tFn('amem.col_role'))}
					{@render sortHead('grade', tFn('amem.col_grade'))}
					{@render sortHead('threads', tFn('amem.col_threads'), true)}
					{@render sortHead('posts', tFn('amem.col_messages'), true)}
					{@render sortHead('joined', tFn('amem.col_joined'))}
					<th class="adm-num"><span class="sr-only">{tFn('amem.col_actions')}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as member (member.user_id)}
					{@const menuId = `menu-${member.user_id}`}
					<!-- Toute la ligne ouvre la fiche (sauf les commandes qu'elle contient). Au
					     clavier, le pseudo et le bouton « Fiche » sont les vrais liens. -->
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<tr class="adm-row-link" onclick={(e) => openFileFromRow(e, member.user_id)}>
						<td class="adm-cell-main">
							<div class="flex items-center gap-2.5 min-w-0">
								<a class="member-avatar" href="/admin/members/{member.user_id}" tabindex="-1" aria-hidden="true">
									{#if member.avatar}<img src={member.avatar} alt="" />{:else}{member.username.charAt(0).toUpperCase()}{/if}
								</a>
								<div class="min-w-0 text-left">
									<a href="/admin/members/{member.user_id}" class="member-name" title={tFn('amem.open_file')}>{member.username}</a>
									{@render email(member.user_id, member.email)}
								</div>
							</div>
						</td>

						<td data-label={tFn('amem.col_role')}>
							{#if member.role === 'owner' || !isAdmin}
								<span class="adm-pill adm-pill--{member.role}">{tFn(`amem.role_${member.role}`)}</span>
							{:else}
								<form method="POST" action="?/changeRole" use:enhance={() => {
									return async ({ update }) => { await update({ reset: false }) }
								}}>
									<input type="hidden" name="user_id" value={member.user_id} />
									<select
										name="role"
										aria-label={tFn('amem.col_role')}
										class="adm-pill adm-pill--{member.role}"
										onchange={(e) => {
											const newRole = (e.currentTarget as HTMLSelectElement).value
											const m = members.find((x: any) => x.user_id === member.user_id)
											if (m) m.role = newRole;
											(e.currentTarget as HTMLSelectElement).form?.submit()
										}}
									>
										{#each ['admin', 'moderator', 'member'] as r}
											<option value={r} selected={r === member.role}>{tFn(`amem.role_${r}`)}</option>
										{/each}
									</select>
								</form>
							{/if}
						</td>

						<td data-label={tFn('amem.col_grade')}>
							{#if member.grade_name && member.grade_color}
								<span class="grade" style="background-color:{member.grade_color}; color:{luminance(member.grade_color) > 0.5 ? '#111' : '#fff'}">{member.grade_name}</span>
							{:else}
								<span class="adm-muted">·</span>
							{/if}
						</td>

						<td class="adm-num" data-label={tFn('amem.col_threads')}>{member.thread_count}</td>
						<td class="adm-num" data-label={tFn('amem.col_messages')}>{member.post_count}</td>
						<td class="adm-muted" data-label={tFn('amem.col_joined')}>{new Date(member.joined_at).toLocaleDateString($locale)}</td>

						<td class="adm-num">
							<div class="adm-actions adm-actions--row">
							<a class="adm-btn adm-btn--sm" href="/admin/members/{member.user_id}" aria-label={tFn('amem.open_file_for', { username: member.username })}>
								<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6a1 1 0 01.7.3l5.4 5.4a1 1 0 01.3.7V19a2 2 0 01-2 2z"/></svg>
								<span class="max-md:sr-only">{tFn('amem.file_btn')}</span>
							</a>
							{#if member.role !== 'owner' && mayTarget(member.role) && (isAdmin || canKick || canBan || canGrades)}
								<button type="button" class="adm-btn adm-btn--icon" popovertarget={menuId}
								        aria-label={tFn('amem.actions_for', { username: member.username })}
								        onclick={(e) => placeMenu(e.currentTarget, menuId)}>
									<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
								</button>
								<div id={menuId} popover class="adm-menu" role="menu">
									<a role="menuitem" class="adm-menu-item" href="/admin/members/{member.user_id}">
										<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6a1 1 0 01.7.3l5.4 5.4a1 1 0 01.3.7V19a2 2 0 01-2 2z"/></svg>
										{tFn('amem.open_file')}
									</a>
									<div class="adm-menu-sep" role="separator"></div>
									{#if canGrades}
									<a role="menuitem" class="adm-menu-item" href="/admin/grades">
										<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z"/></svg>
										{tFn('amem.action_grade')}
									</a>
									{/if}
									{#if isAdmin}
									<button type="button" role="menuitem" class="adm-menu-item" disabled={generatingFor === member.user_id}
									        onclick={() => { closeMenu(menuId); generateResetLink(member.user_id) }}>
										<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
										{tFn('amem.action_reset')}
									</button>
									{/if}
									{#if canKick || canBan}
									<div class="adm-menu-sep" role="separator"></div>
									{/if}
									{#if canKick}
									<form method="POST" action="?/kick" use:enhance>
										<input type="hidden" name="user_id" value={member.user_id} />
										<button type="submit" role="menuitem" class="adm-menu-item adm-menu-item--danger"
										        onclick={(e) => { if (!confirm(tFn('amem.confirm_kick', { username: member.username }))) e.preventDefault(); else closeMenu(menuId) }}>
											<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
											{tFn('amem.kick')}
										</button>
									</form>
									{/if}
									{#if canBan}
									<button type="button" role="menuitem" class="adm-menu-item adm-menu-item--danger"
									        onclick={() => { closeMenu(menuId); banTarget = { userId: member.user_id, username: member.username }; banReason = ''; banIp = false; banEmail = false; banNotice = null }}>
										<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
										{tFn('amem.ban')}
									</button>
									{/if}
								</div>
							{/if}
							</div>
						</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="adm-empty">{tFn('amem.none_found')}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- ── Membres bannis ─────────────────────────────────────────────────── -->
	{#if canBan && bans.length > 0}
		<section class="flex flex-col gap-3 mt-4">
			<div>
				<h2 class="section-title">{tFn('amem.banned_members')} <span class="adm-muted font-normal">({bans.length})</span></h2>
				<p class="adm-desc">{tFn('amem.banned_hint')}</p>
			</div>
			<div class="adm-table-wrap">
				<table class="adm-table">
					<thead><tr>
						<th>{tFn('amem.col_member')}</th><th>{tFn('amem.col_reason')}</th><th>{tFn('amem.col_banned_by')}</th><th>{tFn('amem.col_date')}</th>
						<th class="adm-num"><span class="sr-only">{tFn('amem.col_action')}</span></th>
					</tr></thead>
					<tbody>
						{#each bans as ban}
							<tr>
								<td class="adm-cell-main">
									<div class="flex items-center gap-2.5 min-w-0">
										<span class="member-avatar member-avatar--banned">{ban.username.charAt(0).toUpperCase()}</span>
										<div class="min-w-0 text-left">
											<span class="member-name">{ban.username}</span>
											<!-- Même masquage par défaut que la liste des membres (#540) :
											     ce panneau s'ouvre parfois en direct/partage d'écran. -->
											{@render email(ban.user_id, ban.email)}
										</div>
									</div>
								</td>
								<td class="adm-muted reason" title={ban.reason ?? ''} data-label={tFn('amem.col_reason')}>{ban.reason || '·'}</td>
								<td class="adm-muted" data-label={tFn('amem.col_banned_by')}>{ban.banned_by_username ?? '·'}</td>
								<td class="adm-muted" data-label={tFn('amem.col_date')}>{new Date(ban.banned_at).toLocaleDateString($locale)}</td>
								<td class="adm-num">
									<form method="POST" action="?/unban" use:enhance>
										<input type="hidden" name="user_id" value={ban.user_id} />
										<button type="submit" class="adm-btn adm-btn--sm"
										        onclick={(e) => { if (!confirm(tFn('amem.confirm_unban', { username: ban.username }))) e.preventDefault() }}>
											{tFn('amem.unban')}
										</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<!-- ── Bans d'adresses IP et d'emails : ban_members ─────────────────── -->
	{#if canBan}
	<section class="adm-card flex flex-col gap-3 mt-4">
		<div>
			<h2 class="section-title">{tFn('amem.ban_ip_title')}</h2>
			<p class="adm-desc">{@html tFn('amem.ban_ip_hint')}</p>
		</div>
		<form method="POST" action="?/banIp" use:enhance class="ban-form">
			<label class="field field--sm">
				<span class="adm-label">{tFn('amem.ip_cidr')}</span>
				<input name="ip" type="text" required placeholder="93.123.109.163" class="adm-input font-mono" />
			</label>
			<label class="field">
				<span class="adm-label">{tFn('amem.reason_optional')}</span>
				<input name="reason" type="text" placeholder={tFn('amem.ip_reason_ph')} class="adm-input" />
			</label>
			<button type="submit" class="adm-btn adm-btn--danger">{tFn('amem.ban_ip_btn')}</button>
		</form>
		{#if ipBans.length > 0}
			<div>
				<h3 class="adm-label mt-2">{tFn('amem.banned_ips')} ({ipBans.length})</h3>
				<p class="adm-desc mb-2">{tFn('amem.banned_ips_hint')}</p>
				<div class="adm-table-wrap">
					<table class="adm-table">
						<thead><tr>
							<th>{tFn('amem.col_ip')}</th><th>{tFn('amem.col_reason')}</th><th>{tFn('amem.col_banned_by')}</th><th>{tFn('amem.col_date')}</th>
							<th class="adm-num"><span class="sr-only">{tFn('amem.col_action')}</span></th>
						</tr></thead>
						<tbody>
							{#each ipBans as ban}
								<tr>
									<td class="adm-cell-main font-mono">{ban.ip}</td>
									<td class="adm-muted reason" data-label={tFn('amem.col_reason')}>{ban.reason || '·'}</td>
									<td class="adm-muted" data-label={tFn('amem.col_banned_by')}>{ban.banned_by_username ?? '·'}</td>
									<td class="adm-muted" data-label={tFn('amem.col_date')}>{new Date(ban.banned_at).toLocaleDateString($locale)}</td>
									<td class="adm-num">
										<form method="POST" action="?/unbanIp" use:enhance>
											<input type="hidden" name="ip" value={ban.ip} />
											<button type="submit" class="adm-btn adm-btn--sm"
											        onclick={(e) => { if (!confirm(tFn('amem.confirm_unban_ip', { ip: ban.ip }))) e.preventDefault() }}>
												{tFn('amem.remove')}
											</button>
										</form>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</section>

	<!-- ── Bans d'adresses e-mail et de domaines ──────────────────────────── -->
	<section class="adm-card flex flex-col gap-3">
		<div>
			<h2 class="section-title">{tFn('amem.ban_email_title')}</h2>
			<p class="adm-desc">{@html tFn('amem.ban_email_hint')}</p>
		</div>
		<form method="POST" action="?/banEmail" use:enhance class="ban-form">
			<label class="field field--sm">
				<span class="adm-label">{tFn('amem.email_or_domain')}</span>
				<input name="email" type="text" required placeholder={tFn('amem.email_ph')} class="adm-input font-mono" />
			</label>
			<label class="field">
				<span class="adm-label">{tFn('amem.reason_optional')}</span>
				<input name="reason" type="text" placeholder={tFn('amem.email_reason_ph')} class="adm-input" />
			</label>
			<button type="submit" class="adm-btn adm-btn--danger">{tFn('amem.ban')}</button>
		</form>
		{#if emailBans.length > 0}
			<div>
				<h3 class="adm-label mt-2">{tFn('amem.banned_emails')} ({emailBans.length})</h3>
				<p class="adm-desc mb-2">{tFn('amem.banned_emails_hint')}</p>
				<div class="adm-table-wrap">
					<table class="adm-table">
						<thead><tr>
							<th>{tFn('amem.col_email_domain')}</th><th>{tFn('amem.col_reason')}</th><th>{tFn('amem.col_banned_by')}</th><th>{tFn('amem.col_date')}</th>
							<th class="adm-num"><span class="sr-only">{tFn('amem.col_action')}</span></th>
						</tr></thead>
						<tbody>
							{#each emailBans as ban}
								<tr>
									<td class="adm-cell-main font-mono">{ban.email}</td>
									<td class="adm-muted reason" data-label={tFn('amem.col_reason')}>{ban.reason || '·'}</td>
									<td class="adm-muted" data-label={tFn('amem.col_banned_by')}>{ban.banned_by_username ?? '·'}</td>
									<td class="adm-muted" data-label={tFn('amem.col_date')}>{new Date(ban.banned_at).toLocaleDateString($locale)}</td>
									<td class="adm-num">
										<form method="POST" action="?/unbanEmail" use:enhance>
											<input type="hidden" name="email" value={ban.email} />
											<button type="submit" class="adm-btn adm-btn--sm"
											        onclick={(e) => { if (!confirm(tFn('amem.confirm_unban_email', { email: ban.email }))) e.preventDefault() }}>
												{tFn('amem.remove')}
											</button>
										</form>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</section>
	{/if}
</div>

<!-- Fenêtre de bannissement -->
{#if banTarget}
	<div class="adm-dialog-backdrop" role="presentation"
	     onclick={() => banTarget = null}
	     onkeydown={(e) => { if (e.key === 'Escape') banTarget = null }}>
		<div class="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="ban-title" tabindex="-1"
		     onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<h2 id="ban-title">{tFn('amem.ban')} <span style="color: var(--nx-bad)">{banTarget.username}</span></h2>
			<p class="adm-desc">{tFn('amem.ban_modal_desc')}</p>
			<form method="POST" action="?/ban" class="flex flex-col gap-3" use:enhance={() => {
					return async ({ result, update }) => {
						await update()
						if (result.type === 'success') {
							const d = result.data as { ipBanRequested?: boolean; ipBanApplied?: string | null } | undefined
							if (d?.ipBanRequested) {
								banNotice = d.ipBanApplied
									? { kind: 'ok',   text: tFn('amem.ip_ban_applied', { ip: d.ipBanApplied }) }
									: { kind: 'warn', text: tFn('amem.ip_ban_unavailable') }
							}
						}
						if (result.type !== 'failure') banTarget = null
					}
				}}>
				<input type="hidden" name="user_id" value={banTarget.userId} />
				<input type="hidden" name="ban_ip" value={banIp ? 'true' : 'false'} />
				<input type="hidden" name="ban_email" value={banEmail ? 'true' : 'false'} />
				<label class="field">
					<span class="adm-label">{tFn('amem.reason')} <span class="font-normal normal-case tracking-normal">{tFn('amem.optional')}</span></span>
					<input type="text" name="reason" bind:value={banReason} placeholder={tFn('amem.ban_reason_ph')} class="adm-input" />
				</label>
				<label class="check"><input type="checkbox" bind:checked={banIp} /> {tFn('amem.ban_ip_check')}</label>
				<label class="check"><input type="checkbox" bind:checked={banEmail} /> {tFn('amem.ban_email_check')}</label>
				<div class="flex gap-2 justify-end pt-1">
					<button type="button" class="adm-btn" onclick={() => banTarget = null}>{tFn('amem.cancel')}</button>
					<button type="submit" class="adm-btn adm-btn--danger">{tFn('amem.confirm_ban')}</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Lien de réinitialisation -->
{#if resetLinkResult || resetLinkError}
	<div class="adm-dialog-backdrop" role="presentation"
	     onclick={() => { resetLinkResult = null; resetLinkError = '' }}
	     onkeydown={(e) => { if (e.key === 'Escape') { resetLinkResult = null; resetLinkError = '' } }}>
		<div class="adm-dialog" style="width: min(100%, 32rem)" role="dialog" aria-modal="true" aria-labelledby="reset-title" tabindex="-1"
		     onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			{#if resetLinkResult}
				<h2 id="reset-title">{tFn('amem.reset_link_title')}</h2>
				<p class="adm-desc">{@html tFn('amem.reset_link_desc', { username: resetLinkResult.username })}</p>
				<div class="reset-box">
					<code class="break-all flex-1 select-all">{resetLinkResult.reset_url}</code>
					<button type="button" class="adm-btn adm-btn--sm" onclick={() => copyToClipboard(resetLinkResult!.reset_url)}>{tFn('amem.copy')}</button>
				</div>
				<p class="adm-desc">{tFn('amem.expires_at', { date: new Date(resetLinkResult.expires_at).toLocaleString($locale) })}</p>
				<div class="flex justify-end"><button type="button" class="adm-btn" onclick={() => resetLinkResult = null}>{tFn('amem.close')}</button></div>
			{:else if resetLinkError}
				<h2 id="reset-title">{tFn('amem.error')}</h2>
				<p class="adm-desc" style="color: var(--nx-bad)">{resetLinkError}</p>
				<div class="flex justify-end"><button type="button" class="adm-btn" onclick={() => resetLinkError = ''}>{tFn('amem.close')}</button></div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.section-title { margin: 0; font-size: 0.9375rem; font-weight: 650; color: var(--nx-text); }
	.member-avatar {
		width: 2rem; height: 2rem; flex: none; border-radius: 999px; overflow: hidden;
		display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 650;
		background: color-mix(in srgb, var(--nx-header-accent) 16%, transparent); color: var(--nx-header-accent);
	}
	.member-avatar img { width: 100%; height: 100%; object-fit: cover; }
	.member-avatar--banned { background: color-mix(in srgb, var(--nx-bad) 14%, transparent); color: var(--nx-bad); }
	.adm-row-link { cursor: pointer; }
	a.member-avatar { text-decoration: none; }
	.member-name { display: block; font-weight: 600; color: var(--nx-text); text-decoration: none; }
	a.member-name:hover { color: var(--nx-header-accent); }
	.member-mail { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: var(--nx-text-muted); }
	.member-reveal {
		all: unset; cursor: pointer; font-size: 0.6875rem; text-decoration: underline; text-underline-offset: 2px;
		color: var(--nx-text-muted);
	}
	.member-reveal:hover { color: var(--nx-text); }
	.member-reveal:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.grade { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.6875rem; font-weight: 600; }
	.reason { max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ban-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.6rem; }
	.field { display: flex; flex-direction: column; gap: 0.35rem; flex: 2 1 14rem; min-width: 0; }
	.field--sm { flex: 1 1 11rem; }
	.field .adm-input { width: 100%; }
	.check { display: flex; align-items: center; gap: 0.55rem; font-size: 0.8125rem; color: var(--nx-text); cursor: pointer; }
	.check input { width: 1rem; height: 1rem; accent-color: var(--nx-header-accent); }
	.reset-box {
		display: flex; align-items: center; gap: 0.6rem; padding: 0.65rem 0.75rem; border-radius: 10px;
		border: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-text) 4%, transparent);
		font-size: 0.75rem;
	}
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
