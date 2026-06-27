<script lang="ts">
	import { t } from '$lib/i18n'
	import type { PageData } from './$types'
	import { page } from '$app/stores'
	import { apiFetch } from '$lib/api'
	import { onMount, untrack } from 'svelte'
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	const me    = $derived(($page.data as any).user)
	const token = $derived(($page.data as any).token as string)

	// ── Posts state ───────────────────────────────────────────────────────────
	let posts     = $state<any[]>(untrack(() => data.posts ?? []))
	let suggested = $state<any[]>([])
	let loading   = $state(false)
	let hasMore   = $state(untrack(() => data.posts?.length === 20))

	// ── Onglets du feed : Découvrir (tout) / Abonnements (ceux que je suis) ────
	let scope = $state<'discover' | 'following'>('discover')
	async function switchScope(s: 'discover' | 'following') {
		if (s === scope || loading) return
		scope = s
		loading = true
		posts = []
		try {
			const res = await apiFetch(fetch, `/social/feed?scope=${s}&limit=20`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				posts = (await res.json()).posts ?? []
				hasMore = posts.length === 20
			}
		} finally {
			loading = false
		}
	}

	// ── Composer ──────────────────────────────────────────────────────────────
	let content     = $state('')
	let composing   = $state(false)
	let sending     = $state(false)
	let replyTo     = $state<any | null>(null)
	let editorKey   = $state(0)           // force-remount editor after submit
	let mediaUrl    = $state<string | null>(null)
	let mediaUploading = $state(false)

	// "+2 ✨" qui s'envole quand on poste (récompense réputation visible)
	let burstOn  = $state(false)
	let burstKey = $state(0)
	function triggerPointsBurst() {
		burstKey++
		burstOn = true
		setTimeout(() => (burstOn = false), 1300)
	}

	// Text length for wave bar (strip HTML tags)
	const textLen   = $derived(content.replace(/<[^>]*>/g, '').length)
	const waveWidth = $derived(Math.min(100, (textLen / 500) * 100))
	const isEmpty   = $derived(content === '' || content === '<p></p>' || content === '<p><br></p>')
	const charLeft  = $derived(500 - textLen)
	const charColor = $derived(charLeft < 0 ? '#ef4444' : charLeft < 100 ? '#f59e0b' : '#6b7280')

	// ── Image upload ──────────────────────────────────────────────────────────
	let fileInput: HTMLInputElement

	async function uploadMedia(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		mediaUploading = true
		try {
			const form = new FormData()
			form.append('file', file)
			const res = await apiFetch(fetch, '/social/upload', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
				body: form,
			})
			if (res.ok) mediaUrl = (await res.json()).url
		} finally {
			mediaUploading = false
			fileInput.value = ''
		}
	}

	// ── Post actions ─────────────────────────────────────────────────────────
	async function submitPost() {
		if (isEmpty || sending) return
		sending = true
		try {
			const body: Record<string, string> = { content }
			if (replyTo) body.reply_to_id = replyTo.id
			if (mediaUrl)  body.media_url  = mediaUrl
			const res = await apiFetch(fetch, '/social/status', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			})
			if (res.ok) {
				const post = await res.json()
				triggerPointsBurst()   // +2 réputation, petit feedback qui s'envole
				if (!replyTo) {
					posts = [post, ...posts]
				} else {
					const parentId = replyTo.id
					posts = posts.map(p => (p.reshare_of || p.id) === parentId
						? { ...p, replies_count: (p.replies_count ?? 0) + 1 }
						: p
					)
					// Refresh the replies thread if already open, else open it
					repliesOpen = { ...repliesOpen, [parentId]: true }
					refreshReplies(parentId)
				}
				content  = ''
				mediaUrl = null
				editorKey++   // reset TipTap
				replyTo = null
				composing = false
			}
		} finally {
			sending = false
		}
	}

	async function toggleLike(post: any) {
		const wasLiked  = post.liked_by_me
		const delta     = wasLiked ? -1 : 1
		// Optimistic update
		posts = posts.map(p => p.id === post.id
			? { ...p, liked_by_me: !wasLiked, likes_count: (p.likes_count ?? 0) + delta }
			: p
		)
		await apiFetch(fetch, `/social/status/${post.id}/like`, {
			method: wasLiked ? 'DELETE' : 'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
	}

	// ── Réactions emoji ─────────────────────────────────────────────────────────
	const REACTIONS = ['❤️', '👍', '😂', '🔥', '😮', '🎉']
	let pickerFor = $state<string | null>(null)

	function applyReaction(p: any, prev: string | null, next: string | null) {
		const myname = me?.username
		const reactions: Record<string, { count: number; users: string[] }> =
			JSON.parse(JSON.stringify(p.reactions || {}))
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

	// Cible effective : sur un repartage, on agit sur l'ORIGINAL (façon retweet).
	const effId = (p: any) => p.reshare_of || p.id

	async function react(post: any, emoji: string) {
		pickerFor = null
		const prev = post.my_reaction || null
		if (prev === emoji) return removeReaction(post)   // re-cliquer son emoji = retirer
		const target = effId(post)
		posts = posts.map(p => effId(p) === target ? applyReaction(p, prev, emoji) : p)
		await apiFetch(fetch, `/social/status/${target}/react`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ emoji }),
		}).catch(() => {})
	}

	async function removeReaction(post: any) {
		pickerFor = null
		const prev = post.my_reaction || null
		if (!prev) return
		const target = effId(post)
		posts = posts.map(p => effId(p) === target ? applyReaction(p, prev, null) : p)
		await apiFetch(fetch, `/social/status/${target}/like`, {
			method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
		}).catch(() => {})
	}

	// ── Repartage ───────────────────────────────────────────────────────────────
	async function toggleReshare(post: any) {
		const now = !post.reshared_by_me
		const delta = now ? 1 : -1
		// MAJ optimiste sur l'original effectif (toutes les lignes qui le ciblent)
		const target = post.reshare_of || post.id
		posts = posts.map(p =>
			(p.id === target || p.reshare_of === target)
				? { ...p, reshared_by_me: now, reshares_count: Math.max(0, (p.reshares_count ?? 0) + delta) }
				: p
		)
		await apiFetch(fetch, `/social/status/${post.id}/reshare`, {
			method: 'POST', headers: { Authorization: `Bearer ${token}` },
		}).catch(() => {})
	}

	async function deletePost(id: string) {
		const res = await apiFetch(fetch, `/social/status/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) posts = posts.filter(p => p.id !== id)
	}

	// ── Replies toggle ────────────────────────────────────────────────────────
	let repliesMap    = $state<Record<string, any[]>>({})
	let repliesLoading = $state<Record<string, boolean>>({})
	let repliesOpen   = $state<Record<string, boolean>>({})

	async function toggleReplies(post: any) {
		const id = post.id
		const src = post.reshare_of || post.id   // les réponses viennent de l'original
		if (repliesOpen[id]) {
			repliesOpen = { ...repliesOpen, [id]: false }
			return
		}
		// Already loaded — just open
		if (repliesMap[id]) {
			repliesOpen = { ...repliesOpen, [id]: true }
			return
		}
		repliesLoading = { ...repliesLoading, [id]: true }
		try {
			const res = await apiFetch(fetch, `/social/status/${src}`)
			if (res.ok) {
				const data = await res.json()
				repliesMap  = { ...repliesMap,  [id]: data.replies ?? [] }
				repliesOpen = { ...repliesOpen, [id]: true }
			}
		} finally {
			repliesLoading = { ...repliesLoading, [id]: false }
		}
	}

	// After submitting a reply, refresh its thread if already open
	async function refreshReplies(postId: string) {
		const res = await apiFetch(fetch, `/social/status/${postId}`)
		if (res.ok) {
			const data = await res.json()
			repliesMap = { ...repliesMap, [postId]: data.replies ?? [] }
		}
	}

	async function loadMore() {
		if (loading || !hasMore) return
		loading = true
		const last = posts[posts.length - 1]
		try {
			const res = await apiFetch(fetch, `/social/feed?scope=${scope}&limit=20&before=${last.created_at}`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const more = (await res.json()).posts ?? []
				posts = [...posts, ...more]
				hasMore = more.length === 20
			}
		} finally {
			loading = false
		}
	}

	// ── Formatting ────────────────────────────────────────────────────────────
	function timeAgo(iso: string): string {
		const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
		if (s <    60) return `${s}s`
		if (s <  3600) return `${Math.floor(s / 60)}min`
		if (s < 86400) return `${Math.floor(s / 3600)}h`
		return `${Math.floor(s / 86400)}j`
	}

	function fmt(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
	}

	// ── Scroll-based load more ────────────────────────────────────────────────
	let sentinel = $state<HTMLElement | undefined>(undefined)
	onMount(() => {
		const obs = new IntersectionObserver(entries => {
			if (entries[0].isIntersecting) loadMore()
		}, { rootMargin: '200px' })
		if (sentinel) obs.observe(sentinel)
		return () => obs.disconnect()
	})
</script>

<svelte:head>
	<title>{tFn('feed.title')} — Nodyx</title>
</svelte:head>

{#snippet linkCard(lp: any)}
	<a href={lp.url} target="_blank" rel="noopener noreferrer nofollow" class="link-card">
		{#if lp.image}
			<div class="link-card-img"><img src={lp.image} alt="" loading="lazy" /></div>
		{/if}
		<div class="link-card-body">
			{#if lp.site_name}<span class="link-card-site">{lp.site_name}</span>{/if}
			{#if lp.title}<span class="link-card-title">{lp.title}</span>{/if}
			{#if lp.description}<span class="link-card-desc">{lp.description}</span>{/if}
		</div>
	</a>
{/snippet}

{#snippet quotedPost(o: any)}
	<a href="/status/{o.id}" class="quoted-post">
		<div class="quoted-head">
			{#if o.avatar_url}<img src={o.avatar_url} alt="" class="quoted-avatar" />{:else}<span class="quoted-avatar quoted-avatar--i">{(o.display_name || o.username || '?').charAt(0).toUpperCase()}</span>{/if}
			<span class="quoted-name">{o.display_name || o.username}</span>
			<span class="quoted-handle">@{o.username}</span>
		</div>
		<div class="quoted-body prose-feed">{@html o.content}</div>
		{#if o.media_url}<img src={o.media_url} alt="" class="quoted-media" loading="lazy" />{/if}
	</a>
{/snippet}

{#if pickerFor}
	<div class="reaction-backdrop" onclick={() => (pickerFor = null)} role="presentation"></div>
{/if}

<div class="feed-root">
	<!-- ── Page header ──────────────────────────────────────────────────────── -->
	<div class="feed-header">
		<div class="feed-header-inner">
			<div>
				<h1 class="feed-title">{tFn('feed.title')}</h1>
				<p class="feed-sub">{tFn('feed.subtitle')}</p>
			</div>
			<a href="/discover" class="feed-explore-btn">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
				</svg>
				Explorer
			</a>
		</div>
	</div>

	<div class="feed-layout">
		<!-- ── Main column ──────────────────────────────────────────────────── -->
		<div class="feed-main">

			<!-- Onglets : Découvrir / Abonnements ──────────────────────────── -->
			<div class="feed-tabs">
				<button class="feed-tab" class:feed-tab--active={scope === 'discover'} onclick={() => switchScope('discover')}>
					{tFn('feed.tab_discover')}
				</button>
				<button class="feed-tab" class:feed-tab--active={scope === 'following'} onclick={() => switchScope('following')}>
					{tFn('feed.tab_following')}
				</button>
			</div>

			<!-- Composer ─────────────────────────────────────────────────── -->
			<div class="composer" class:composer--active={composing || content.length > 0}>
				{#if burstOn}
					{#key burstKey}
						<span class="points-burst">+2&nbsp;✨</span>
					{/key}
				{/if}
				{#if replyTo}
					<div class="composer-reply-banner">
						<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/>
						</svg>
						{tFn('feed.reply_banner', { username: replyTo.username })}
						<button onclick={() => replyTo = null} class="composer-reply-close">×</button>
					</div>
				{/if}

				<div class="composer-inner">
					<div class="composer-avatar">
						{#if me?.avatar_url}
							<img src={me.avatar_url} alt="" class="composer-avatar-img" />
						{:else}
							<span class="composer-avatar-initial">{(me?.display_name || me?.username || '?').charAt(0).toUpperCase()}</span>
						{/if}
					</div>

					<div class="composer-body">
						<div class="composer-editor-wrap" role="button" tabindex="0"
						onclick={() => composing = true}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') composing = true }}>
							{#key editorKey}
								<NodyxEditor
									compact={true}
									placeholder={replyTo ? tFn('feed.reply_placeholder', { username: replyTo.username }) : tFn('feed.composer_placeholder', { name: me?.display_name || me?.username || '' })}
									onchange={(html) => { content = html; composing = true }}
								/>
							{/key}
						</div>

						<!-- Media preview -->
						{#if mediaUrl}
							<div class="composer-media-preview">
								<img src={mediaUrl} alt={tFn('feed.attachment_alt')} class="composer-media-img" />
								<button onclick={() => mediaUrl = null} class="composer-media-remove" title={tFn('feed.remove_media_title')}>×</button>
							</div>
						{/if}

						<div class="composer-toolbar">
							<!-- Image upload -->
							<label class="composer-media-btn" title={tFn('feed.add_image_title')} class:composer-media-btn--loading={mediaUploading}>
								{#if mediaUploading}
									<svg class="w-4 h-4 spin" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
									</svg>
								{:else}
									<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/>
									</svg>
								{/if}
								<input
									bind:this={fileInput}
									type="file"
									accept="image/jpeg,image/png,image/webp,image/gif"
									onchange={uploadMedia}
									class="sr-only"
								/>
							</label>

							<!-- Wave progress bar -->
							<div class="composer-wave-track">
								<div class="composer-wave-fill" style="width: {waveWidth}%; background: {charLeft < 0 ? '#ef4444' : charLeft < 100 ? '#f59e0b' : 'var(--nx-accent)'}"></div>
							</div>
							<span class="composer-char-count" style="color: {charColor}">{charLeft}</span>
							<div class="composer-actions">
								<button onclick={() => { composing = false; content = ''; mediaUrl = null; replyTo = null; editorKey++ }} class="composer-cancel">
									Annuler
								</button>
								<button
									onclick={submitPost}
									disabled={isEmpty || charLeft < 0 || sending}
									class="composer-submit"
								>
									{sending ? '…' : replyTo ? tFn('feed.reply') : tFn('feed.publish')}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Feed ─────────────────────────────────────────────────────── -->
			{#if posts.length === 0}
				<div class="feed-empty">
					<div class="feed-empty-icon">
						<svg fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"/>
						</svg>
					</div>
					<p class="feed-empty-title">{tFn('feed.empty_title')}</p>
					<p class="feed-empty-sub">{tFn('feed.empty_sub')}</p>
					<a href="/discover" class="feed-empty-cta">{tFn('feed.empty_cta')}</a>
				</div>
			{:else}
				<div class="posts-list">
					{#each posts as post (post.id)}
						<article class="post-card" class:post-card--resonant={post.likes_count > 4}>
							<!-- Resonance glow (for popular posts) -->
							{#if post.likes_count > 4}
								<div class="post-resonance-glow" style="opacity: {Math.min(0.6, (post.likes_count - 4) * 0.05)}"></div>
							{/if}

							{#if post.reshare_of}
								<div class="reshare-label">
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
									<a href="/users/{post.username}">{post.display_name || post.username}</a> {tFn('feed.reshared_by')}
								</div>
							{/if}

							<div class="post-inner">
								<!-- Avatar -->
								<a href="/users/{post.username}" class="post-avatar-link">
									{#if post.avatar_url}
										<img src={post.avatar_url} alt="" class="post-avatar" />
									{:else}
										<div class="post-avatar post-avatar--initials">
											{(post.display_name || post.username).charAt(0).toUpperCase()}
										</div>
									{/if}
								</a>

								<!-- Content -->
								<div class="post-content">
									<div class="post-meta">
										<a href="/users/{post.username}" class="post-author">
											{post.display_name || post.username}
										</a>
										<span class="post-username">@{post.username}</span>
										<span class="post-dot">·</span>
										<time class="post-time" datetime={post.created_at}>{timeAgo(post.created_at)}</time>

										{#if me?.id === post.author_id || me?.username === post.username}
											<button onclick={() => deletePost(post.id)} class="post-delete-btn" title="Supprimer">
												<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
												</svg>
											</button>
										{/if}
									</div>

									{#if post.content}
										<div class="post-text prose-feed">{@html post.content}</div>
									{/if}

									{#if post.media_url}
										<div class="post-media">
											<img src={post.media_url} alt="" class="post-media-img" loading="lazy" />
										</div>
									{/if}

									{#if post.link_preview}{@render linkCard(post.link_preview)}{/if}

									{#if post.reshared}{@render quotedPost(post.reshared)}{/if}

									<!-- Actions -->
									<div class="post-actions">
										<!-- Reply -->
										<button
											onclick={() => {
												replyTo = post.reshared || post   // répondre cible l'original (repartage)
												composing = true
												window.scrollTo({ top: 0, behavior: 'smooth' })
											}}
											class="post-action-btn"
											title={tFn('feed.reply')}
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/>
											</svg>
										</button>
										<!-- Repartage -->
										<button
											onclick={() => toggleReshare(post)}
											class="post-action-btn post-reshare-btn"
											class:post-reshare-btn--active={post.reshared_by_me}
											title={tFn('feed.reshare')}
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
											{#if post.reshares_count > 0}<span class="resonance-count">{fmt(post.reshares_count)}</span>{/if}
										</button>
										{#if post.replies_count > 0}
											<button
												onclick={() => toggleReplies(post)}
												class="post-action-btn post-replies-btn"
												class:post-replies-btn--open={repliesOpen[post.id]}
												title={repliesOpen[post.id] ? tFn('feed.hide_replies') : tFn('feed.show_replies')}
											>
												{#if repliesLoading[post.id]}
													<svg class="w-3 h-3 spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
													</svg>
												{:else}
													<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
														style="transition: transform 0.2s; transform: rotate({repliesOpen[post.id] ? '180deg' : '0deg'})"
													>
														<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>
													</svg>
												{/if}
												<span>{tFn(post.replies_count > 1 ? 'feed.replies_count_plural' : 'feed.replies_count', { n: fmt(post.replies_count) })}</span>
											</button>
										{/if}

										<!-- Réaction (résonance emoji) -->
										<div class="reaction-wrap">
											{#if pickerFor === post.id}
												<div class="reaction-picker">
													{#each REACTIONS as e}
														<button class="reaction-pick" class:reaction-pick--mine={post.my_reaction === e}
															onclick={() => react(post, e)} aria-label={e}>{e}</button>
													{/each}
												</div>
											{/if}
											<button
												onclick={() => pickerFor = pickerFor === post.id ? null : post.id}
												class="post-action-btn post-resonance-btn"
												class:post-resonance-btn--active={post.my_reaction}
												aria-label={tFn('feed.react')}
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
												</svg>
											</button>
											{#if post.reactions}
												{#each Object.entries(post.reactions) as [e, info]}
													<button class="reaction-chip" class:reaction-chip--mine={post.my_reaction === e}
														title={((info as any).users || []).join(', ')} onclick={() => react(post, e)}>
														<span class="reaction-chip-e">{e}</span><span class="reaction-chip-n">{(info as any).count}</span>
													</button>
												{/each}
											{/if}
										</div>
									</div>
								</div>
							</div>
						</article>

					<!-- Replies thread -->
					{#if repliesOpen[post.id] && repliesMap[post.id]}
						<div class="replies-thread">
							{#each repliesMap[post.id] as reply (reply.id)}
								<div class="reply-card">
									<div class="reply-line"></div>
									<div class="reply-inner">
										<a href="/users/{reply.username}" class="reply-avatar-link">
											{#if reply.avatar_url}
												<img src={reply.avatar_url} alt="" class="reply-avatar" />
											{:else}
												<div class="reply-avatar reply-avatar--initials">
													{(reply.display_name || reply.username).charAt(0).toUpperCase()}
												</div>
											{/if}
										</a>
										<div class="reply-content">
											<div class="post-meta">
												<a href="/users/{reply.username}" class="post-author">{reply.display_name || reply.username}</a>
												<span class="post-username">@{reply.username}</span>
												<span class="post-dot">·</span>
												<time class="post-time" datetime={reply.created_at}>{timeAgo(reply.created_at)}</time>
												{#if me?.id === reply.author_id || me?.username === reply.username}
													<button onclick={() => deletePost(reply.id)} class="post-delete-btn" title="Supprimer">
														<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
														</svg>
													</button>
												{/if}
											</div>
											<div class="post-text prose-feed">{@html reply.content}</div>
											{#if reply.media_url}
												<div class="post-media">
													<img src={reply.media_url} alt="" class="post-media-img" loading="lazy" />
												</div>
											{/if}
											{#if reply.link_preview}{@render linkCard(reply.link_preview)}{/if}
											<div class="post-actions" style="margin-top: 0.5rem;">
												<button
													onclick={() => { replyTo = reply; composing = true; window.scrollTo({ top: 0, behavior: 'smooth' }) }}
													class="post-action-btn" title={tFn('feed.reply')}
												>
													<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/>
													</svg>
												</button>
												<button
													onclick={() => toggleLike(reply)}
													class="post-action-btn post-resonance-btn"
													class:post-resonance-btn--active={reply.liked_by_me}
												>
													<span class="resonance-icon">
														{#if reply.liked_by_me}
															<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
																<path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z"/>
															</svg>
														{:else}
															<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
															</svg>
														{/if}
													</span>
													{#if reply.likes_count > 0}<span class="resonance-count">{fmt(reply.likes_count)}</span>{/if}
												</button>
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
					{/each}
				</div>

				<!-- Load more sentinel -->
				<div bind:this={sentinel} class="feed-sentinel">
					{#if loading}
						<div class="feed-loader">
							<span></span><span></span><span></span>
						</div>
					{:else if !hasMore}
						<p class="feed-end">{tFn('feed.end_of_feed')}</p>
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── Sidebar ──────────────────────────────────────────────────────── -->
		<aside class="feed-sidebar">
			<div class="sidebar-card">
				<p class="sidebar-title">{tFn('feed.your_profile')}</p>
				<a href="/users/{me?.username}" class="sidebar-me">
					<div class="sidebar-me-avatar">
						{#if me?.avatar_url}
							<img src={me.avatar_url} alt="" class="w-full h-full object-cover" />
						{:else}
							<span>{(me?.display_name || me?.username || '?').charAt(0).toUpperCase()}</span>
						{/if}
					</div>
					<div>
						<p class="sidebar-me-name">{me?.display_name || me?.username}</p>
						<p class="sidebar-me-handle">@{me?.username}</p>
					</div>
				</a>
			</div>

			{#if suggested.length > 0}
				<div class="sidebar-card">
					<p class="sidebar-title">{tFn('feed.suggestions')}</p>
					<ul class="space-y-3">
						{#each suggested as user}
							<li class="flex items-center gap-3">
								<a href="/users/{user.username}" class="sidebar-suggest-avatar">
									{#if user.avatar_url}
										<img src={user.avatar_url} alt="" class="w-full h-full object-cover rounded-full" />
									{:else}
										<span>{(user.display_name || user.username).charAt(0).toUpperCase()}</span>
									{/if}
								</a>
								<div class="flex-1 min-w-0">
									<a href="/users/{user.username}" class="sidebar-suggest-name">{user.display_name || user.username}</a>
									<p class="sidebar-suggest-handle">@{user.username}</p>
								</div>
								<a href="/users/{user.username}" class="sidebar-follow-btn">{tFn('feed.view_btn')}</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</aside>
	</div>
</div>

<style>
/* ── Root ─────────────────────────────────────────────────────────────────── */
.feed-root {
	min-height: 100vh;
	background: #09090f;
}

.feed-header {
	position: sticky;
	top: 0;
	z-index: 20;
	border-bottom: 1px solid rgba(255,255,255,0.06);
	background: rgba(9,9,15,0.85);
	backdrop-filter: blur(16px);
}
.feed-header-inner {
	padding: 0.875rem 1.5rem;
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.feed-title {
	font-size: 1.125rem;
	font-weight: 800;
	color: rgba(255,255,255,0.92);
	letter-spacing: -0.3px;
}
.feed-sub {
	font-size: 0.7rem;
	color: rgba(255,255,255,0.3);
	margin-top: 1px;
}
.feed-explore-btn {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	font-size: 0.75rem;
	font-weight: 600;
	color: rgba(255,255,255,0.5);
	padding: 0.375rem 0.75rem;
	border: 1px solid rgba(255,255,255,0.08);
	transition: all 0.15s;
}
.feed-explore-btn:hover {
	color: rgba(255,255,255,0.8);
	border-color: rgb(var(--nx-accent-rgb) / 0.4);
	background: rgb(var(--nx-accent-rgb) / 0.08);
}

/* ── Layout ───────────────────────────────────────────────────────────────── */
.feed-layout {
	padding: 1.5rem;
	display: flex;
	gap: 1.5rem;
	align-items: flex-start;
}
.feed-main   { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }

/* Onglets Découvrir / Abonnements */
.feed-tabs {
	display: flex;
	gap: 0.25rem;
	margin-bottom: 0.5rem;
	padding: 0.25rem;
	background: rgba(255,255,255,0.03);
	border: 1px solid rgba(255,255,255,0.06);
	border-radius: 14px;
	position: sticky;
	top: 56px;
	z-index: 5;
	backdrop-filter: blur(8px);
}
.feed-tab {
	flex: 1;
	padding: 0.55rem 1rem;
	border: none;
	border-radius: 10px;
	background: transparent;
	color: rgba(255,255,255,0.5);
	font-size: 0.875rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
}
.feed-tab:hover { color: rgba(255,255,255,0.8); }
.feed-tab--active {
	background: linear-gradient(135deg, rgb(var(--nx-accent-2-rgb) / 0.25), rgb(var(--nx-cyan-rgb) / 0.2));
	color: #fff;
}
.feed-sidebar { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; gap: 1rem; position: sticky; top: 68px; }

@media (max-width: 640px) {
	.feed-sidebar  { display: none; }
	.feed-layout   { padding: 0.75rem; }
}

/* ── Composer ─────────────────────────────────────────────────────────────── */
.composer {
	position: relative;
	border: 1px solid rgba(255,255,255,0.07);
	background: rgba(255,255,255,0.02);
	padding: 1rem;
	margin-bottom: 1px;
	transition: border-color 0.2s, background 0.2s;
}
.composer--active {
	border-color: rgb(var(--nx-accent-rgb) / 0.3);
	background: rgb(var(--nx-accent-rgb) / 0.04);
}

.composer-reply-banner {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.7rem;
	color: rgb(var(--nx-accent-rgb) / 0.7);
	margin-bottom: 0.75rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid rgba(255,255,255,0.06);
}
:global(.composer-reply-banner strong) { color: rgb(var(--nx-accent-rgb) / 0.9); }
.composer-reply-close {
	margin-left: auto;
	color: rgba(255,255,255,0.3);
	font-size: 1rem;
	line-height: 1;
	transition: color 0.1s;
}
.composer-reply-close:hover { color: rgba(255,255,255,0.7); }

.composer-inner { display: flex; gap: 0.75rem; }

.composer-avatar {
	width: 36px;
	height: 36px;
	flex-shrink: 0;
	border-radius: 50%;
	overflow: hidden;
	background: rgb(var(--nx-accent-rgb) / 0.15);
	display: flex;
	align-items: center;
	justify-content: center;
}
.composer-avatar-img   { width: 100%; height: 100%; object-fit: cover; }
.composer-avatar-initial { font-size: 0.875rem; font-weight: 700; color: var(--nx-accent); }

.composer-body { flex: 1; min-width: 0; }

.composer-editor-wrap {
	cursor: text;
}
/* Override NodyxEditor inside composer */
.composer-editor-wrap :global(.nodyx-editor) {
	border: none;
	background: transparent;
	border-radius: 0;
}
.composer-editor-wrap :global(.nodyx-toolbar) {
	border-bottom: 1px solid rgba(255,255,255,0.06);
	background: transparent;
	border-radius: 0;
	padding: 0.25rem 0;
}
.composer-editor-wrap :global(.nodyx-content) {
	min-height: 56px;
	font-size: 0.9375rem;
	padding: 0.5rem 0;
}

/* Media preview */
.composer-media-preview {
	position: relative;
	margin-top: 0.75rem;
	max-width: 320px;
}
.composer-media-img {
	width: 100%;
	max-height: 240px;
	object-fit: cover;
	border: 1px solid rgba(255,255,255,0.08);
	display: block;
}
.composer-media-remove {
	position: absolute;
	top: 0.375rem;
	right: 0.375rem;
	width: 22px;
	height: 22px;
	background: rgba(0,0,0,0.7);
	border: 1px solid rgba(255,255,255,0.15);
	border-radius: 50%;
	color: rgba(255,255,255,0.8);
	font-size: 0.875rem;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background 0.15s;
}
.composer-media-remove:hover { background: rgba(239,68,68,0.7); }

/* Upload button */
.composer-media-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border: 1px solid rgba(255,255,255,0.1);
	color: rgba(255,255,255,0.4);
	cursor: pointer;
	transition: all 0.15s;
	flex-shrink: 0;
}
.composer-media-btn:hover { color: rgba(255,255,255,0.7); border-color: rgba(255,255,255,0.2); }
.composer-media-btn--loading { cursor: wait; opacity: 0.6; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.composer-toolbar {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	margin-top: 0.75rem;
	padding-top: 0.75rem;
	border-top: 1px solid rgba(255,255,255,0.06);
	flex-wrap: wrap;
}
.composer-wave-track {
	flex: 1;
	height: 2px;
	background: rgba(255,255,255,0.06);
	overflow: hidden;
}
.composer-wave-fill {
	height: 100%;
	transition: width 0.1s, background 0.2s;
}
.composer-char-count {
	font-size: 0.7rem;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	transition: color 0.2s;
	min-width: 2.5rem;
	text-align: right;
}
.composer-actions { display: flex; gap: 0.5rem; }

/* "+2 ✨" qui s'envole quand on poste (ancré au composer, qui reste monté) */
.points-burst {
	position: absolute;
	right: 1rem;
	top: 0.85rem;
	z-index: 6;
	pointer-events: none;
	font-size: 0.95rem;
	font-weight: 800;
	color: #fde68a;
	text-shadow: 0 0 10px rgba(251, 191, 36, 0.6);
	white-space: nowrap;
	animation: points-burst-rise 1.2s ease-out forwards;
}
@keyframes points-burst-rise {
	0%   { opacity: 0; transform: translateY(6px) scale(0.8); }
	20%  { opacity: 1; transform: translateY(-2px) scale(1.1); }
	60%  { opacity: 1; transform: translateY(-22px) scale(1); }
	100% { opacity: 0; transform: translateY(-48px) scale(0.95); }
}
.composer-cancel {
	font-size: 0.75rem;
	font-weight: 600;
	color: rgba(255,255,255,0.3);
	padding: 0.375rem 0.75rem;
	border: 1px solid rgba(255,255,255,0.08);
	transition: all 0.15s;
}
.composer-cancel:hover { color: rgba(255,255,255,0.6); border-color: rgba(255,255,255,0.15); }
.composer-submit {
	font-size: 0.75rem;
	font-weight: 700;
	color: white;
	padding: 0.375rem 1rem;
	background: var(--nx-accent);
	letter-spacing: 0.2px;
	transition: all 0.15s;
}
.composer-submit:hover:not(:disabled) { background: var(--nx-accent-strong); }
.composer-submit:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Posts ────────────────────────────────────────────────────────────────── */
.posts-list { display: flex; flex-direction: column; }

.post-card {
	position: relative;
	border: 1px solid rgba(255,255,255,0.06);
	border-top: none;
	background: rgba(255,255,255,0.015);
	transition: background 0.15s;
}
.post-card:first-child { border-top: 1px solid rgba(255,255,255,0.06); }
.post-card:hover { background: rgba(255,255,255,0.03); }
.post-card--resonant { border-left-color: rgb(var(--nx-accent-rgb) / 0.3); }

.post-resonance-glow {
	position: absolute;
	inset: 0;
	background: linear-gradient(90deg, rgb(var(--nx-accent-rgb) / 0.08), transparent 40%);
	pointer-events: none;
}

.post-inner { display: flex; gap: 0.75rem; padding: 1rem; }

.post-avatar-link { flex-shrink: 0; }
.post-avatar {
	width: 40px;
	height: 40px;
	border-radius: 50%;
	object-fit: cover;
	border: 1.5px solid rgba(255,255,255,0.08);
}
.post-avatar--initials {
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgb(var(--nx-accent-rgb) / 0.15);
	color: var(--nx-accent-soft);
	font-weight: 700;
	font-size: 0.875rem;
}

.post-content { flex: 1; min-width: 0; }
.post-meta {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	flex-wrap: wrap;
	margin-bottom: 0.375rem;
}
.post-author {
	font-weight: 700;
	font-size: 0.875rem;
	color: rgba(255,255,255,0.85);
	transition: color 0.1s;
}
.post-author:hover { color: var(--nx-accent-soft); }
.post-username { font-size: 0.8rem; color: rgba(255,255,255,0.3); }
.post-dot      { font-size: 0.8rem; color: rgba(255,255,255,0.2); }
.post-time     { font-size: 0.75rem; color: rgba(255,255,255,0.25); }

.post-delete-btn {
	margin-left: auto;
	color: rgba(255,255,255,0.15);
	transition: color 0.15s;
	padding: 0.125rem;
}
.post-delete-btn:hover { color: #ef4444; }

.post-text {
	font-size: 0.9375rem;
	color: rgba(255,255,255,0.78);
	line-height: 1.65;
	word-break: break-word;
}

/* TipTap HTML prose styles */
.prose-feed :global(p)              { margin: 0 0 0.35em; }
.prose-feed :global(p:last-child)   { margin-bottom: 0; }
.prose-feed :global(strong)         { font-weight: 700; color: rgba(255,255,255,0.92); }
.prose-feed :global(em)             { font-style: italic; }
.prose-feed :global(a)              { color: var(--nx-accent-soft); text-decoration: underline; text-decoration-color: rgba(129,140,248,0.4); }
.prose-feed :global(a:hover)        { color: #a5b4fc; }
.prose-feed :global(ul), .prose-feed :global(ol) { padding-left: 1.25rem; margin: 0.35em 0; }
.prose-feed :global(li)             { margin: 0.15em 0; }
.prose-feed :global(h1), .prose-feed :global(h2), .prose-feed :global(h3) {
	font-weight: 700;
	color: rgba(255,255,255,0.9);
	margin: 0.5em 0 0.25em;
	line-height: 1.3;
}
.prose-feed :global(h1) { font-size: 1.15em; }
.prose-feed :global(h2) { font-size: 1.05em; }
.prose-feed :global(h3) { font-size: 0.95em; }
.prose-feed :global(blockquote) {
	border-left: 3px solid rgb(var(--nx-accent-rgb) / 0.5);
	padding-left: 0.75rem;
	color: rgba(255,255,255,0.5);
	font-style: italic;
	margin: 0.5em 0;
}
.prose-feed :global(code) {
	font-family: monospace;
	font-size: 0.85em;
	background: rgba(255,255,255,0.07);
	padding: 0.1em 0.35em;
	border-radius: 3px;
	color: #a5b4fc;
}
.prose-feed :global(pre) {
	background: rgba(0,0,0,0.4);
	border: 1px solid rgba(255,255,255,0.07);
	padding: 0.75rem;
	overflow-x: auto;
	margin: 0.5em 0;
}
.prose-feed :global(pre code) { background: none; padding: 0; }

/* Post media */
/* Carte d'aperçu de lien (Open Graph) */
.link-card {
	display: flex;
	flex-direction: column;
	margin-top: 0.625rem;
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 14px;
	overflow: hidden;
	text-decoration: none;
	background: rgba(255,255,255,0.02);
	transition: border-color 0.15s, background 0.15s;
}
.link-card:hover { border-color: rgb(var(--nx-accent-2-rgb) / 0.5); background: rgba(255,255,255,0.04); }
.link-card-img { width: 100%; max-height: 240px; overflow: hidden; background: rgba(0,0,0,0.2); }
.link-card-img img { width: 100%; height: 100%; max-height: 240px; object-fit: cover; display: block; }
.link-card-body { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.7rem 0.85rem; }
.link-card-site { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--nx-accent-soft); font-weight: 700; }
.link-card-title { font-size: 0.9rem; font-weight: 700; color: rgba(255,255,255,0.92); line-height: 1.3;
	display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.link-card-desc { font-size: 0.8rem; color: rgba(255,255,255,0.55); line-height: 1.4;
	display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.post-media { margin-top: 0.625rem; }
.post-media-img {
	width: 100%;
	max-height: 400px;
	object-fit: cover;
	border: 1px solid rgba(255,255,255,0.08);
	display: block;
	transition: opacity 0.15s;
}
.post-media-img:hover { opacity: 0.9; }

.post-actions {
	display: flex;
	align-items: center;
	gap: 1.25rem;
	margin-top: 0.75rem;
}

.post-action-btn {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	font-size: 0.8rem;
	color: rgba(255,255,255,0.3);
	transition: color 0.15s;
}
.post-action-btn:hover { color: rgba(255,255,255,0.6); }

/* Résonance button */
.post-resonance-btn { position: relative; }
.post-resonance-btn:hover { color: #f43f5e; }
.post-resonance-btn--active { color: #f43f5e; }
.post-resonance-btn--active .resonance-count { color: #f43f5e; }

.resonance-icon { display: flex; }
.resonance-count { font-size: 0.8rem; font-weight: 600; }

/* Réactions emoji */
.reaction-wrap { position: relative; display: flex; align-items: center; gap: 0.4rem; }
.reaction-chip {
	display: inline-flex; align-items: center; gap: 0.2rem;
	padding: 0.1rem 0.5rem; border-radius: 999px; cursor: pointer;
	border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
	font-size: 0.8rem; line-height: 1.4; transition: background 0.12s, border-color 0.12s;
}
.reaction-chip:hover { background: rgba(255,255,255,0.08); }
.reaction-chip--mine { background: rgb(var(--nx-accent-2-rgb) / 0.22); border-color: rgb(var(--nx-accent-2-rgb) / 0.6); }
.reaction-chip-e { font-size: 0.9rem; }
.reaction-chip-n { font-weight: 700; color: rgba(255,255,255,0.7); }

/* Repartage */
.reshare-label {
	display: flex; align-items: center; gap: 0.4rem;
	padding: 0 0 0.4rem 0.25rem; font-size: 0.78rem; color: rgba(255,255,255,0.45); font-weight: 600;
}
.reshare-label a { color: rgba(255,255,255,0.6); text-decoration: none; }
.reshare-label a:hover { text-decoration: underline; }
.post-reshare-btn--active { color: #34d399; }
.post-reshare-btn--active .resonance-count { color: #34d399; }
.quoted-post {
	display: block; margin-top: 0.625rem; padding: 0.7rem 0.85rem; text-decoration: none;
	border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; background: rgba(255,255,255,0.02);
	transition: background 0.15s, border-color 0.15s;
}
.quoted-post:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.18); }
.quoted-head { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.35rem; }
.quoted-avatar { width: 20px; height: 20px; border-radius: 999px; object-fit: cover; }
.quoted-avatar--i { display: inline-flex; align-items: center; justify-content: center; background: rgb(var(--nx-accent-2-rgb) / 0.3); color: #fff; font-size: 0.65rem; font-weight: 700; }
.quoted-name { font-weight: 700; color: rgba(255,255,255,0.9); font-size: 0.85rem; }
.quoted-handle { color: rgba(255,255,255,0.4); font-size: 0.8rem; }
.quoted-body { font-size: 0.875rem; color: rgba(255,255,255,0.8); }
.quoted-media { width: 100%; max-height: 200px; object-fit: cover; border-radius: 10px; margin-top: 0.4rem; display: block; }
.reaction-backdrop { position: fixed; inset: 0; z-index: 40; }
.reaction-picker {
	position: absolute;
	bottom: calc(100% + 6px);
	left: 0;
	z-index: 50;
	display: flex;
	gap: 0.15rem;
	padding: 0.3rem;
	border-radius: 999px;
	background: #1a1a24;
	border: 1px solid rgba(255,255,255,0.12);
	box-shadow: 0 8px 28px rgba(0,0,0,0.5);
	animation: reaction-pop 0.12s ease-out;
}
@keyframes reaction-pop { from { opacity: 0; transform: translateY(4px) scale(0.95); } to { opacity: 1; transform: none; } }
.reaction-pick {
	border: none; background: transparent; cursor: pointer;
	font-size: 1.25rem; line-height: 1; padding: 0.25rem 0.3rem; border-radius: 999px;
	transition: transform 0.1s, background 0.1s;
}
.reaction-pick:hover { transform: scale(1.3); background: rgba(255,255,255,0.08); }
.reaction-pick--mine { background: rgb(var(--nx-accent-2-rgb) / 0.3); }

/* Ripple animation on like */
.post-resonance-btn--active .resonance-icon {
	animation: resonance-pulse 0.4s ease-out;
}
@keyframes resonance-pulse {
	0%   { transform: scale(1); }
	40%  { transform: scale(1.4); }
	70%  { transform: scale(0.9); }
	100% { transform: scale(1); }
}

/* ── Empty / Load more ────────────────────────────────────────────────────── */
.feed-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	padding: 4rem 2rem;
	border: 1px solid rgba(255,255,255,0.06);
}
.feed-empty-icon {
	width: 56px; height: 56px;
	border: 1px solid rgba(255,255,255,0.07);
	display: flex; align-items: center; justify-content: center;
	color: rgba(255,255,255,0.15);
	margin-bottom: 1.25rem;
}
.feed-empty-icon svg { width: 28px; height: 28px; }
.feed-empty-title  { font-size: 1rem; font-weight: 700; color: rgba(255,255,255,0.6); margin-bottom: 0.5rem; }
.feed-empty-sub    { font-size: 0.8rem; color: rgba(255,255,255,0.25); max-width: 300px; }
.feed-empty-cta    { margin-top: 1.25rem; font-size: 0.8rem; font-weight: 600; color: var(--nx-accent); transition: color 0.15s; }
.feed-empty-cta:hover { color: var(--nx-accent-soft); }

.feed-sentinel { padding: 2rem; display: flex; justify-content: center; }
.feed-loader   { display: flex; gap: 0.375rem; }
.feed-loader span {
	width: 6px; height: 6px;
	background: rgb(var(--nx-accent-rgb) / 0.5);
	border-radius: 50%;
	animation: feed-bounce 1.2s ease-in-out infinite;
}
.feed-loader span:nth-child(2) { animation-delay: 0.2s; }
.feed-loader span:nth-child(3) { animation-delay: 0.4s; }
@keyframes feed-bounce {
	0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
	40%           { transform: scale(1);   opacity: 1; }
}
.feed-end { font-size: 0.75rem; color: rgba(255,255,255,0.2); }
:global(.feed-end a) { color: rgb(var(--nx-accent-rgb) / 0.6); transition: color 0.15s; }
:global(.feed-end a:hover) { color: var(--nx-accent-soft); }

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
.sidebar-card {
	border: 1px solid rgba(255,255,255,0.06);
	background: rgba(255,255,255,0.02);
	padding: 1rem;
}
.sidebar-title {
	font-size: 0.65rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 1px;
	color: rgba(255,255,255,0.25);
	margin-bottom: 0.875rem;
}

.sidebar-me {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	transition: opacity 0.15s;
}
.sidebar-me:hover { opacity: 0.8; }
.sidebar-me-avatar {
	width: 40px; height: 40px; border-radius: 50%; overflow: hidden;
	background: rgb(var(--nx-accent-rgb) / 0.15);
	display: flex; align-items: center; justify-content: center;
	font-weight: 700; font-size: 0.875rem; color: var(--nx-accent);
	flex-shrink: 0;
}
.sidebar-me-name   { font-size: 0.875rem; font-weight: 700; color: rgba(255,255,255,0.8); }
.sidebar-me-handle { font-size: 0.75rem; color: rgba(255,255,255,0.3); }

.sidebar-suggest-avatar {
	width: 36px; height: 36px; border-radius: 50%; overflow: hidden;
	background: rgb(var(--nx-accent-rgb) / 0.1);
	display: flex; align-items: center; justify-content: center;
	font-size: 0.8rem; font-weight: 700; color: var(--nx-accent);
	flex-shrink: 0;
}
.sidebar-suggest-name   { display: block; font-size: 0.8rem; font-weight: 600; color: rgba(255,255,255,0.7); }
.sidebar-suggest-handle { font-size: 0.7rem; color: rgba(255,255,255,0.25); }
.sidebar-follow-btn {
	font-size: 0.7rem;
	font-weight: 600;
	color: var(--nx-accent);
	padding: 0.25rem 0.625rem;
	border: 1px solid rgb(var(--nx-accent-rgb) / 0.3);
	transition: all 0.15s;
	white-space: nowrap;
}
.sidebar-follow-btn:hover { background: rgb(var(--nx-accent-rgb) / 0.1); }

.sidebar-card--links {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}
.sidebar-card--links a {
	font-size: 0.7rem;
	color: rgba(255,255,255,0.3);
	transition: color 0.15s;
}
.sidebar-card--links a:hover { color: rgba(255,255,255,0.6); }

/* ── Replies thread ───────────────────────────────────────────────────────── */
.post-replies-btn {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.75rem;
	font-weight: 600;
	color: rgb(var(--nx-accent-rgb) / 0.6);
	transition: color 0.15s;
}
.post-replies-btn:hover        { color: rgb(var(--nx-accent-rgb) / 0.9); }
.post-replies-btn--open        { color: var(--nx-accent-soft); }

.replies-thread {
	border-left: 2px solid rgb(var(--nx-accent-rgb) / 0.2);
	margin-left: 1.25rem;
	background: rgb(var(--nx-accent-rgb) / 0.02);
}

.reply-card {
	position: relative;
	display: flex;
	padding: 0.75rem 1rem 0.75rem 0;
	border-bottom: 1px solid rgba(255,255,255,0.04);
}
.reply-card:last-child { border-bottom: none; }

.reply-line {
	width: 24px;
	flex-shrink: 0;
}

.reply-inner {
	display: flex;
	gap: 0.625rem;
	flex: 1;
	min-width: 0;
}

.reply-avatar-link { flex-shrink: 0; }
.reply-avatar {
	width: 30px;
	height: 30px;
	border-radius: 50%;
	object-fit: cover;
	border: 1px solid rgba(255,255,255,0.08);
}
.reply-avatar--initials {
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgb(var(--nx-accent-rgb) / 0.12);
	color: var(--nx-accent-soft);
	font-weight: 700;
	font-size: 0.75rem;
}

.reply-content { flex: 1; min-width: 0; }
</style>
