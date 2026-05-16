<!-- Liste de followers/following partagée par les 2 pages /users/X/followers
     et /users/X/following. Mode passé en prop pour titre + i18n. -->
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

	const title = $derived(mode === 'followers'
		? `Abonnés de ${username}`
		: `Abonnements de ${username}`)
	const emptyMsg = $derived(mode === 'followers'
		? `${username} n'a pas encore d'abonnés.`
		: `${username} ne suit personne pour l'instant.`)
</script>

<svelte:head><title>{title} · Nodyx</title></svelte:head>

<div class="follow-page">
	<header class="follow-header">
		<a href={`/users/${username}`} class="follow-back" aria-label="Retour au profil">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
			</svg>
		</a>
		<div class="follow-title-wrap">
			<h1 class="follow-title">{title}</h1>
			<p class="follow-count">{users.length} {mode === 'followers' ? 'abonné' : 'abonnement'}{users.length !== 1 ? 's' : ''}</p>
		</div>
	</header>

	{#if users.length === 0}
		<div class="follow-empty">{emptyMsg}</div>
	{:else}
		<ul class="follow-list">
			{#each users as u (u.id)}
				<li class="follow-item">
					<a href={`/users/${u.username}`} class="follow-link">
						{#if u.avatar_url}
							<img src={u.avatar_url} alt="" class="follow-avatar" />
						{:else}
							<div class="follow-avatar follow-avatar--initials">{u.username[0].toUpperCase()}</div>
						{/if}
						<div class="follow-info">
							<div class="follow-name">{u.display_name || u.username}</div>
							<div class="follow-username">@{u.username}</div>
						</div>
						<div class="follow-date">{timeAgo(u.followed_at)}</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.follow-page {
		max-width: 640px;
		margin: 0 auto;
		padding: 32px 16px;
	}
	.follow-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 24px;
	}
	.follow-back {
		flex-shrink: 0;
		width: 36px; height: 36px;
		display: flex; align-items: center; justify-content: center;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.04);
		color: #94a3b8;
		text-decoration: none;
		transition: background .15s, color .15s;
	}
	.follow-back:hover { background: rgba(255, 255, 255, 0.08); color: #e2e8f0; }
	.follow-back :global(svg) { width: 16px; height: 16px; }
	.follow-title-wrap { min-width: 0; flex: 1; }
	.follow-title {
		font-size: 22px;
		font-weight: 700;
		color: #f1f5f9;
		margin: 0;
		font-family: 'Space Grotesk', system-ui, sans-serif;
	}
	.follow-count {
		font-size: 13px;
		color: #64748b;
		margin: 2px 0 0;
	}

	.follow-empty {
		text-align: center;
		padding: 48px 16px;
		color: #64748b;
		font-size: 14px;
		font-style: italic;
	}

	.follow-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.follow-item { padding: 0; }
	.follow-link {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-radius: 10px;
		text-decoration: none;
		color: inherit;
		transition: background .12s;
	}
	.follow-link:hover { background: rgba(255, 255, 255, 0.04); }

	.follow-avatar {
		width: 44px; height: 44px;
		border-radius: 50%;
		object-fit: cover;
		background: rgba(124, 58, 237, 0.12);
		flex-shrink: 0;
	}
	.follow-avatar--initials {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #c4b5fd;
		font-weight: 700;
		font-size: 18px;
	}

	.follow-info { flex: 1; min-width: 0; }
	.follow-name {
		font-size: 14px;
		font-weight: 600;
		color: #e2e8f0;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.follow-username {
		font-size: 12px;
		color: #64748b;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}

	.follow-date {
		flex-shrink: 0;
		font-size: 11px;
		color: rgba(226, 232, 240, 0.4);
		white-space: nowrap;
	}
</style>
