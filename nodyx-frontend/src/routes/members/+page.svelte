<script lang="ts">
	import type { PageData } from './$types'
	import type { FullMember } from './+page.server'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	let query  = $state('')
	let sortBy = $state<'joined_asc' | 'joined_desc' | 'points' | 'username'>('joined_asc')
	let onlyOnline = $state(false)

	const roleLabels: Record<string, string> = {
		owner:     'Fondateur',
		admin:     'Admin',
		moderator: 'Modo',
		member:    'Membre',
	}
	const roleOrder = ['owner', 'admin', 'moderator', 'member']
	function rolePriority(role: string): number {
		const i = roleOrder.indexOf(role)
		return i < 0 ? 99 : i
	}

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase()
		let list = (data.members ?? []).filter((m: FullMember) => {
			if (onlyOnline && !m.is_online) return false
			if (q) {
				const inU = m.username.toLowerCase().includes(q)
				const inD = (m.display_name || '').toLowerCase().includes(q)
				if (!inU && !inD) return false
			}
			return true
		})
		switch (sortBy) {
			case 'joined_asc':
				list = list.sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime())
				break
			case 'joined_desc':
				list = list.sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime())
				break
			case 'points':
				list = list.sort((a, b) => b.points - a.points)
				break
			case 'username':
				list = list.sort((a, b) => a.username.localeCompare(b.username))
				break
		}
		const staff   = list.filter(m => rolePriority(m.role) < 3)
		const members = list.filter(m => rolePriority(m.role) >= 3)
		return { staff, members, total: list.length }
	})

	function fmtDate(iso: string): string {
		try {
			const d = new Date(iso)
			return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })
		} catch { return '' }
	}
</script>

<svelte:head><title>{tFn('members.page_title')}</title></svelte:head>

<div class="mb-page">
	<header class="mb-header">
		<div class="mb-header-title">
			<h1 class="mb-title">{tFn('members.title')}</h1>
			<div class="mb-counts">
				<span class="mb-count">
					<span class="mb-count-num">{data.members?.length ?? 0}</span>
					<span class="mb-count-label">{tFn('members.total')}</span>
				</span>
				<span class="mb-count-sep">·</span>
				<span class="mb-count">
					<span class="mb-count-num">{(data.members ?? []).filter((m: FullMember) => m.is_online).length}</span>
					<span class="mb-count-label">{tFn('members.online')}</span>
				</span>
			</div>
		</div>

		<div class="mb-controls">
			<div class="mb-search">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mb-search-icon">
					<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
				</svg>
				<input
					type="text"
					bind:value={query}
					placeholder={tFn('members.filter_ph')}
					class="mb-search-input"
				/>
			</div>
			<select bind:value={sortBy} class="mb-sort">
				<option value="joined_asc">{tFn('members.sort_oldest')}</option>
				<option value="joined_desc">{tFn('members.sort_newest')}</option>
				<option value="points">{tFn('members.sort_points')}</option>
				<option value="username">{tFn('members.sort_alpha')}</option>
			</select>
			<label class="mb-toggle">
				<input type="checkbox" bind:checked={onlyOnline} />
				<span>{tFn('members.online')}</span>
			</label>
		</div>
	</header>

	{#if data.error}
		<div class="mb-empty mb-empty--error">{tFn('common.error')} : {data.error}</div>
	{:else if filtered.total === 0}
		<div class="mb-empty">{tFn('members.none_match')}</div>
	{:else}
		{#if filtered.staff.length > 0}
			<div class="mb-section-label">{tFn('members.team')}</div>
			<ul class="mb-list">
				{#each filtered.staff as m (m.user_id)}
					{@render row(m)}
				{/each}
			</ul>
		{/if}
		{#if filtered.members.length > 0}
			{#if filtered.staff.length > 0}
				<div class="mb-section-label">{tFn('members.members_section')}</div>
			{/if}
			<ul class="mb-list">
				{#each filtered.members as m (m.user_id)}
					{@render row(m)}
				{/each}
			</ul>
		{/if}
	{/if}
</div>

{#snippet row(m: FullMember)}
	<li class="mb-row">
		<a href={`/users/${m.username}`} class="mb-row-link">
			<div class="mb-avatar-wrap">
				{#if m.avatar}
					<img src={m.avatar} alt="" class="mb-avatar" />
				{:else}
					<div class="mb-avatar mb-avatar--init">{m.username[0].toUpperCase()}</div>
				{/if}
				{#if m.is_online}
					<span class="mb-online-dot" aria-label={tFn('members.online')}></span>
				{/if}
			</div>

			<div class="mb-row-info">
				<div class="mb-row-line1">
					<span
						class="mb-display"
						style={m.name_color ? `color: ${m.name_color}` : ''}
					>{m.display_name || m.username}</span>
					{#if m.grade_name}
						<span
							class="mb-grade"
							style={m.grade_color ? `color: ${m.grade_color}; border-color: ${m.grade_color}55` : ''}
						>{m.grade_name}</span>
					{:else if roleLabels[m.role] && m.role !== 'member'}
						<span class="mb-grade mb-grade--role">{tFn('members.role_' + m.role)}</span>
					{/if}
				</div>
				<div class="mb-row-line2">
					<span class="mb-user">@{m.username}</span>
					<span class="mb-sep">·</span>
					<span class="mb-joined">{tFn('members.since')} {fmtDate(m.joined_at)}</span>
				</div>
			</div>

			<div class="mb-row-meta">
				<span class="mb-points-num">{m.points}</span>
				<span class="mb-points-label">{tFn('members.pts')}</span>
			</div>
		</a>
	</li>
{/snippet}

<style>
	/* Style Nodyx : peu de radius, lignes droites, mono pour technique */
	.mb-page {
		max-width: 880px;
		margin: 0 auto;
		padding: 28px 16px 64px;
	}

	.mb-header {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-bottom: 18px;
		padding-bottom: 14px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.mb-header-title { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
	.mb-title {
		font-size: 22px;
		font-weight: 700;
		color: #f1f5f9;
		margin: 0;
		font-family: 'Space Grotesk', system-ui, sans-serif;
		letter-spacing: -0.01em;
	}
	.mb-counts {
		display: inline-flex;
		gap: 6px;
		align-items: baseline;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 12px;
	}
	.mb-count { display: inline-flex; gap: 4px; }
	.mb-count-num { color: #e2e8f0; font-weight: 600; }
	.mb-count-label { color: #475569; }
	.mb-count-sep { color: #334155; }

	.mb-controls {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}
	.mb-search {
		flex: 1;
		min-width: 200px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
	}
	.mb-search:focus-within {
		border-color: rgb(var(--nx-accent-rgb) / 0.35);
		background: rgb(var(--nx-accent-rgb) / 0.04);
	}
	.mb-search-icon { width: 14px; height: 14px; color: #475569; flex-shrink: 0; }
	.mb-search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #e2e8f0;
		font-size: 13px;
		font-family: inherit;
	}
	.mb-search-input::placeholder { color: #475569; }

	.mb-sort {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		padding: 7px 10px;
		color: #cbd5e1;
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
	}
	.mb-sort:focus { outline: 1px solid rgb(var(--nx-accent-rgb) / 0.4); outline-offset: -1px; }

	.mb-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 10px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		font-size: 12px;
		color: #94a3b8;
		cursor: pointer;
		user-select: none;
	}
	.mb-toggle input { accent-color: var(--nx-accent); }
	.mb-toggle:hover { color: #cbd5e1; }

	.mb-section-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-family: ui-monospace, SFMono-Regular, monospace;
		color: #475569;
		margin: 14px 0 8px;
		padding-left: 4px;
	}

	.mb-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 4px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.01);
	}
	.mb-row { padding: 0; }
	.mb-row + .mb-row { border-top: 1px solid rgba(255, 255, 255, 0.04); }
	.mb-row-link {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		text-decoration: none;
		color: inherit;
		transition: background .1s linear;
	}
	.mb-row-link:hover { background: rgba(255, 255, 255, 0.03); }

	.mb-avatar-wrap { position: relative; flex-shrink: 0; }
	.mb-avatar {
		width: 36px;
		height: 36px;
		border-radius: 4px;
		object-fit: cover;
		background: rgb(var(--nx-accent-rgb) / 0.08);
		display: block;
	}
	.mb-avatar--init {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #a5b4fc;
		font-weight: 700;
		font-size: 15px;
		font-family: 'Space Grotesk', sans-serif;
	}
	.mb-online-dot {
		position: absolute;
		bottom: -2px;
		right: -2px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #22c55e;
		box-shadow: 0 0 0 2px #0a0a0f;
	}

	.mb-row-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mb-row-line1 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}
	.mb-display {
		font-size: 14px;
		font-weight: 600;
		color: #e2e8f0;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.mb-grade {
		display: inline-block;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 6px;
		border: 1px solid rgb(var(--nx-accent-rgb) / 0.3);
		color: #a5b4fc;
		border-radius: 3px;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.mb-grade--role {
		border-color: rgba(148, 163, 184, 0.3);
		color: #94a3b8;
	}

	.mb-row-line2 {
		display: flex;
		gap: 6px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 11px;
		color: #475569;
	}
	.mb-user { color: #64748b; }
	.mb-sep  { color: #334155; }

	.mb-row-meta {
		flex-shrink: 0;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 11px;
	}
	.mb-points-num { color: #cbd5e1; font-weight: 600; }
	.mb-points-label { color: #475569; margin-left: 3px; }

	.mb-empty {
		padding: 32px 16px;
		text-align: center;
		color: #475569;
		font-size: 13px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		border: 1px dashed rgba(255, 255, 255, 0.06);
		border-radius: 4px;
	}
	.mb-empty--error { color: #fca5a5; border-color: rgba(239, 68, 68, 0.3); }
</style>
