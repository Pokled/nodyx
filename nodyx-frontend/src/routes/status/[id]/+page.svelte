<script lang="ts">
	import { page } from '$app/stores'
	import { apiFetch } from '$lib/api'
	import { t } from '$lib/i18n'
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn   = $derived($t)
	const me    = $derived(($page.data as any).user)
	const token = $derived(data.token as string)

	let post    = $state<any>(data.post)
	let replies = $state<any[]>(data.replies ?? [])

	const REACTIONS = ['❤️', '👍', '😂', '🔥', '😮', '🎉']
	let pickerFor = $state<string | null>(null)   // id de la cible dont le picker est ouvert

	// Composer de réponse
	let replyContent = $state('')
	let replyTarget  = $state<any | null>(null)   // null = répondre au post racine
	let editorKey    = $state(0)
	let sending      = $state(false)

	function timeAgo(iso: string): string {
		const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
		if (s < 60) return `${s}s`
		if (s < 3600) return `${Math.floor(s / 60)}min`
		if (s < 86400) return `${Math.floor(s / 3600)}h`
		return new Date(iso).toLocaleDateString()
	}

	function applyReaction(p: any, prev: string | null, next: string | null) {
		const myname = me?.username
		const reactions: Record<string, { count: number; users: string[] }> = JSON.parse(JSON.stringify(p.reactions || {}))
		if (prev && reactions[prev]) {
			reactions[prev].count = Math.max(0, reactions[prev].count - 1)
			reactions[prev].users = (reactions[prev].users || []).filter((u) => u !== myname)
			if (reactions[prev].count <= 0) delete reactions[prev]
		}
		if (next) {
			if (!reactions[next]) reactions[next] = { count: 0, users: [] }
			reactions[next].count += 1
			if (!reactions[next].users.includes(myname)) reactions[next].users.push(myname)
		}
		const delta = (!prev && next) ? 1 : (prev && !next) ? -1 : 0
		return { ...p, my_reaction: next, liked_by_me: !!next, likes_count: Math.max(0, (p.likes_count || 0) + delta), reactions }
	}

	// React sur le post racine OU une réponse (cible identifiée par id)
	async function react(target: any, emoji: string) {
		pickerFor = null
		const prev = target.my_reaction || null
		const next = prev === emoji ? null : emoji
		const updated = applyReaction(target, prev, next)
		if (target.id === post.id) post = updated
		else replies = replies.map(r => r.id === target.id ? updated : r)
		const id = target.id
		if (!next) {
			await apiFetch(fetch, `/social/status/${id}/like`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
		} else {
			await apiFetch(fetch, `/social/status/${id}/react`, {
				method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji: next }),
			}).catch(() => {})
		}
	}

	async function toggleReshare() {
		const now = !post.reshared_by_me
		post = { ...post, reshared_by_me: now, reshares_count: Math.max(0, (post.reshares_count ?? 0) + (now ? 1 : -1)) }
		await apiFetch(fetch, `/social/status/${post.id}/reshare`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
	}

	function startReply(target: any | null) {
		replyTarget = target
		// focus le composer
		setTimeout(() => document.querySelector('.s-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
	}

	const replyEmpty = $derived(replyContent === '' || replyContent === '<p></p>' || replyContent === '<p><br></p>')

	async function sendReply() {
		if (replyEmpty || sending) return
		sending = true
		try {
			const res = await apiFetch(fetch, '/social/status', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: replyContent, reply_to_id: (replyTarget?.id ?? post.id) }),
			})
			if (res.ok) {
				// Recharge le fil aplati pour refléter la nouvelle réponse + compteurs
				const fresh = await apiFetch(fetch, `/social/status/${post.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
				if (fresh.ok) {
					const j = await fresh.json()
					post = j.post
					replies = j.replies ?? []
				}
				replyContent = ''
				replyTarget = null
				editorKey++
			}
		} finally {
			sending = false
		}
	}
</script>

<svelte:head><title>Publication de {post.display_name || post.username} — Nodyx</title></svelte:head>

{#snippet actions(p: any)}
	<div class="s-actions">
		<div class="s-react-wrap">
			{#if pickerFor === p.id}
				<div class="s-picker">
					{#each REACTIONS as e}
						<button class="s-pick" onclick={() => react(p, e)} aria-label={e}>{e}</button>
					{/each}
				</div>
			{/if}
			<button class="s-action" class:s-action--on={p.my_reaction} onclick={() => (pickerFor = pickerFor === p.id ? null : p.id)}>
				♡ {p.likes_count > 0 ? p.likes_count : tFn('feed.react')}
			</button>
		</div>
		<button class="s-action" onclick={() => startReply(p.id === post.id ? null : p)}>↩ {tFn('feed.reply')}</button>
		{#if p.id === post.id}
			<button class="s-action" class:s-action--reshare={post.reshared_by_me} onclick={toggleReshare}>🔁 {post.reshares_count || 0}</button>
			<span class="s-action s-action--static">💬 {post.replies_count || 0}</span>
		{/if}
	</div>
	{#if p.reactions && Object.keys(p.reactions).length > 0}
		<div class="s-chips">
			{#each Object.entries(p.reactions) as [e, info]}
				<span class="s-chip" class:s-chip--mine={p.my_reaction === e} title={((info as any).users || []).join(', ')}>{e} {(info as any).count}</span>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet body(p: any)}
	<div class="s-head">
		<a href="/users/{p.username}" class="s-avatar-link">
			{#if p.avatar_url}<img src={p.avatar_url} alt="" class="s-avatar" />{:else}<span class="s-avatar s-avatar--i">{(p.display_name || p.username || '?').charAt(0).toUpperCase()}</span>{/if}
		</a>
		<div class="s-meta">
			<a href="/users/{p.username}" class="s-name">{p.display_name || p.username}</a>
			<span class="s-handle">@{p.username} · {timeAgo(p.created_at)}{#if p.reply_to_username && p.reply_to_id !== post.id} · <span class="s-replyto">↳ @{p.reply_to_username}</span>{/if}</span>
		</div>
	</div>
	{#if p.content}<div class="s-text prose-feed">{@html p.content}</div>{/if}
	{#if p.media_url}<img src={p.media_url} alt="" class="s-media" loading="lazy" />{/if}
	{#if p.link_preview}
		<a href={p.link_preview.url} target="_blank" rel="noopener noreferrer nofollow" class="s-link">
			{#if p.link_preview.image}<img src={p.link_preview.image} alt="" class="s-link-img" />{/if}
			<div class="s-link-body">
				{#if p.link_preview.site_name}<span class="s-link-site">{p.link_preview.site_name}</span>{/if}
				{#if p.link_preview.title}<span class="s-link-title">{p.link_preview.title}</span>{/if}
			</div>
		</a>
	{/if}
{/snippet}

<div class="s-wrap">
	<a href="/feed" class="s-back">← Retour au fil</a>

	<article class="s-card">
		{#if post.reshare_of}
			<div class="s-reshare-label">🔁 <a href="/users/{post.username}">{post.display_name || post.username}</a> a repartagé</div>
		{/if}
		{@render body(post)}
		{@render actions(post)}
	</article>

	<!-- Composer de réponse -->
	<div class="s-composer">
		{#if replyTarget}
			<div class="s-composer-target">
				En réponse à <strong>@{replyTarget.username}</strong>
				<button class="s-composer-cancel" onclick={() => (replyTarget = null)} aria-label="annuler">×</button>
			</div>
		{/if}
		{#key editorKey}
			<NodyxEditor compact={true} placeholder={tFn('feed.reply_placeholder', { username: replyTarget?.username ?? post.username })} onchange={(v) => (replyContent = v)} />
		{/key}
		<div class="s-composer-foot">
			<button class="s-send" onclick={sendReply} disabled={replyEmpty || sending}>{sending ? '…' : tFn('feed.reply')}</button>
		</div>
	</div>

	{#if replies.length > 0}
		<h2 class="s-replies-title">{replies.length > 1 ? tFn('feed.replies_count_plural', { n: replies.length }) : tFn('feed.replies_count', { n: replies.length })}</h2>
		{#each replies as r (r.id)}
			<article class="s-card s-card--reply">
				{@render body(r)}
				{@render actions(r)}
			</article>
		{/each}
	{/if}

	{#if pickerFor}<div class="s-backdrop" onclick={() => (pickerFor = null)} role="presentation"></div>{/if}
</div>

<style>
	.s-wrap { max-width: 780px; margin: 0 auto; padding: 1.25rem 1rem 5rem; }
	.s-back { display: inline-block; margin-bottom: 1rem; color: var(--nx-accent-soft); text-decoration: none; font-size: 0.875rem; }
	.s-back:hover { text-decoration: underline; }
	.s-card { border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: rgba(255,255,255,0.02); padding: 1.1rem; margin-bottom: 0.75rem; }
	.s-card--reply { background: rgba(255,255,255,0.01); }
	.s-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
	.s-avatar { width: 42px; height: 42px; border-radius: 999px; object-fit: cover; display: block; }
	.s-avatar--i { display: inline-flex; align-items: center; justify-content: center; background: rgb(var(--nx-accent-2-rgb) / 0.3); color: #fff; font-weight: 700; }
	.s-name { font-weight: 700; color: #fff; text-decoration: none; }
	.s-handle { display: block; color: rgba(255,255,255,0.45); font-size: 0.8rem; }
	.s-replyto { color: var(--nx-accent-soft); }
	.s-text { color: rgba(255,255,255,0.9); font-size: 0.95rem; line-height: 1.55; }
	.s-media { width: 100%; max-height: 420px; object-fit: cover; border-radius: 12px; margin-top: 0.6rem; display: block; }
	.s-link { display: block; margin-top: 0.6rem; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; text-decoration: none; }
	.s-link-img { width: 100%; max-height: 220px; object-fit: cover; display: block; }
	.s-link-body { padding: 0.6rem 0.8rem; display: flex; flex-direction: column; gap: 0.2rem; }
	.s-link-site { font-size: 0.7rem; text-transform: uppercase; color: var(--nx-accent-soft); font-weight: 700; }
	.s-link-title { font-weight: 700; color: rgba(255,255,255,0.9); font-size: 0.9rem; }
	.s-reshare-label { font-size: 0.78rem; color: rgba(255,255,255,0.45); font-weight: 600; margin-bottom: 0.5rem; }
	.s-reshare-label a { color: rgba(255,255,255,0.6); text-decoration: none; }
	.s-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.9rem; flex-wrap: wrap; }
	.s-react-wrap { position: relative; }
	.s-action { border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.7); border-radius: 999px; padding: 0.35rem 0.8rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.s-action:hover { border-color: var(--nx-accent-soft); color: #fff; }
	.s-action--static { cursor: default; }
	.s-action--on { color: #f43f5e; border-color: rgba(244,63,94,0.4); }
	.s-action--reshare { color: #34d399; border-color: rgba(52,211,153,0.4); }
	.s-picker { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 50; display: flex; gap: 0.15rem; padding: 0.3rem; border-radius: 999px; background: #1a1a24; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 8px 28px rgba(0,0,0,0.5); }
	.s-pick { border: none; background: transparent; cursor: pointer; font-size: 1.25rem; padding: 0.2rem 0.3rem; border-radius: 999px; }
	.s-pick:hover { transform: scale(1.3); }
	.s-backdrop { position: fixed; inset: 0; z-index: 40; }
	.s-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.6rem; }
	.s-chip { font-size: 0.8rem; padding: 0.1rem 0.5rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); }
	.s-chip--mine { background: rgb(var(--nx-accent-2-rgb) / 0.22); border-color: rgb(var(--nx-accent-2-rgb) / 0.6); }
	.s-replies-title { font-size: 0.95rem; font-weight: 700; color: rgba(255,255,255,0.8); margin: 1.4rem 0 0.6rem; }
	.s-composer { border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: rgba(255,255,255,0.02); padding: 0.9rem; margin-bottom: 1rem; }
	.s-composer-target { font-size: 0.8rem; color: rgba(255,255,255,0.6); margin-bottom: 0.5rem; }
	.s-composer-target strong { color: var(--nx-accent-soft); }
	.s-composer-cancel { border: none; background: transparent; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 1rem; margin-left: 0.3rem; }
	.s-composer-foot { display: flex; justify-content: flex-end; margin-top: 0.6rem; }
	.s-send { border: none; border-radius: 999px; padding: 0.45rem 1.2rem; font-size: 0.85rem; font-weight: 700; color: #fff; cursor: pointer; background: linear-gradient(135deg, var(--nx-accent), var(--nx-accent-2)); }
	.s-send:disabled { opacity: 0.4; cursor: default; }
</style>
