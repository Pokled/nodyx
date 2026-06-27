<!-- Liste de followers/following — style aligné avec /members (Nodyx tech). -->
<script lang="ts">
	interface FollowUser {
		id:           string
		username:     string
		display_name: string | null
		avatar_url:   string | null
		followed_at:  string
	}
	interface Props {
		username: string
		users:    FollowUser[]
		mode:     'followers' | 'following'
	}

	let { username, users, mode }: Props = $props()

	function timeAgo(iso: string): string {
		const diff = Math.max(0, Date.now() - new Date(iso).getTime())
		const s = Math.floor(diff / 1000)
		if (s < 60)    return 'à l\'instant'
		if (s < 3600)  return `il y a ${Math.floor(s/60)} min`
		if (s < 86400) return `il y a ${Math.floor(s/3600)} h`
		const d = Math.floor(s/86400)
		if (d < 7)    return `il y a ${d} j`
		if (d < 30)   return `il y a ${Math.floor(d/7)} sem`
		if (d < 365)  return `il y a ${Math.floor(d/30)} mois`
		return `il y a ${Math.floor(d/365)} an${d >= 730 ? 's' : ''}`
	}

	const title = $derived(mode === 'followers' ? `Abonnés de ${username}` : `Abonnements de ${username}`)
	const emptyMsg = $derived(mode === 'followers'
		? `${username} n'a pas encore d'abonnés.`
		: `${username} ne suit personne pour l'instant.`)
</script>

<svelte:head><title>{title} · Nodyx</title></svelte:head>

<div class="fl-page">
	<header class="fl-header">
		<a href={`/users/${username}`} class="fl-back" aria-label="Retour au profil">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
			</svg>
		</a>
		<div class="fl-title-wrap">
			<h1 class="fl-title">{title}</h1>
			<p class="fl-count"><span class="fl-count-num">{users.length}</span> {mode === 'followers' ? 'abonné' : 'abonnement'}{users.length !== 1 ? 's' : ''}</p>
		</div>
	</header>

	{#if users.length === 0}
		<div class="fl-empty">{emptyMsg}</div>
	{:else}
		<ul class="fl-list">
			{#each users as u (u.id)}
				<li class="fl-row">
					<a href={`/users/${u.username}`} class="fl-row-link">
						{#if u.avatar_url}
							<img src={u.avatar_url} alt="" class="fl-avatar" />
						{:else}
							<div class="fl-avatar fl-avatar--init">{u.username[0].toUpperCase()}</div>
						{/if}
						<div class="fl-info">
							<div class="fl-name">{u.display_name || u.username}</div>
							<div class="fl-user">@{u.username}</div>
						</div>
						<div class="fl-date">{timeAgo(u.followed_at)}</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.fl-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 28px 16px 64px;
	}

	.fl-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-bottom: 14px;
		margin-bottom: 18px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.fl-back {
		flex-shrink: 0;
		width: 28px; height: 28px;
		display: flex; align-items: center; justify-content: center;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.02);
		color: #94a3b8;
		text-decoration: none;
		transition: background .1s linear, color .1s linear;
	}
	.fl-back:hover { background: rgba(255, 255, 255, 0.05); color: #e2e8f0; }
	.fl-back :global(svg) { width: 13px; height: 13px; }

	.fl-title-wrap { min-width: 0; flex: 1; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
	.fl-title {
		font-size: 18px;
		font-weight: 700;
		color: #f1f5f9;
		margin: 0;
		font-family: 'Space Grotesk', system-ui, sans-serif;
		letter-spacing: -0.01em;
	}
	.fl-count {
		font-size: 12px;
		color: #475569;
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.fl-count-num { color: #e2e8f0; font-weight: 600; }

	.fl-empty {
		padding: 28px 16px;
		text-align: center;
		color: #475569;
		font-size: 12px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		border: 1px dashed rgba(255, 255, 255, 0.06);
		border-radius: 4px;
	}

	.fl-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 4px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.01);
	}
	.fl-row { padding: 0; }
	.fl-row + .fl-row { border-top: 1px solid rgba(255, 255, 255, 0.04); }
	.fl-row-link {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		text-decoration: none;
		color: inherit;
		transition: background .1s linear;
	}
	.fl-row-link:hover { background: rgba(255, 255, 255, 0.03); }

	.fl-avatar {
		width: 36px; height: 36px;
		border-radius: 4px;
		object-fit: cover;
		background: rgb(var(--nx-accent-rgb) / 0.08);
		flex-shrink: 0;
	}
	.fl-avatar--init {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #a5b4fc;
		font-weight: 700;
		font-size: 15px;
		font-family: 'Space Grotesk', sans-serif;
	}

	.fl-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.fl-name {
		font-size: 14px;
		font-weight: 600;
		color: #e2e8f0;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.fl-user {
		font-size: 11px;
		color: #64748b;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}

	.fl-date {
		flex-shrink: 0;
		font-size: 11px;
		color: #475569;
		font-family: ui-monospace, SFMono-Regular, monospace;
		white-space: nowrap;
	}
</style>
