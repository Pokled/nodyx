<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import ProfileCard from '$lib/components/ProfileCard.svelte';
	import NexusEditor from '$lib/components/editor/NexusEditor.svelte';
	import PostReactions from '$lib/components/PostReactions.svelte';
	import PollCard from '$lib/components/PollCard.svelte';
	import PollCreator from '$lib/components/PollCreator.svelte';

	let { data }: { data: PageData } = $props();

	// ── Réactivité ────────────────────────────────────────────────────────
	const thread = $derived(data.thread);
	const posts  = $derived(data.posts);
	const user   = $derived(data.user);
	const isMod  = $derived(user?.role === 'owner' || user?.role === 'admin' || user?.role === 'moderator');

	// ── État local ────────────────────────────────────────────────────────
	let replyKey      = $state(0);
	let editingPostId = $state<string | null>(null);
	let deletingPostId = $state<string | null>(null);
	let confirmDeleteThread = $state(false);
	let editingTitle  = $state(false);
	let titleInput    = $state('');
	let submitting    = $state(false);

	// ── Sondage du thread ─────────────────────────────────────────────────
	let threadPoll     = $state(data.poll ?? null);
	let showPollCreator = $state(false);

	const canAddPoll = $derived(
		user && !threadPoll && (user.id === thread.author_id || isMod)
	);

	function startEditTitle() {
		titleInput   = thread.title;
		editingTitle = true;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			day: '2-digit', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}

	const canEditTitle = $derived(user && (user.id === thread.author_id || isMod));
	function canEdit(post: any)   { return user && (user.id === post.author_id || isMod); }
	function canDelete(post: any) { return user && (user.id === post.author_id || isMod); }
	
	// ── Dernier posteur ───────────────────────────────────────────────────
	const lastPost = $derived(posts.length > 0 ? posts[posts.length - 1] : null);
</script>

<svelte:head>
	<title>{thread.title} — {$page.data.communityName ?? 'Nexus'}</title>
	<meta name="description" content="Discussion : {thread.title} par {thread.author_username}" />
	<link rel="canonical" href={$page.url.href} />
	<meta property="og:title"       content="{thread.title} — {$page.data.communityName ?? 'Nexus'}" />
	<meta property="og:description" content="Discussion par {thread.author_username} · {thread.post_count} réponse(s) · {thread.views} vues" />
	<meta property="og:type"        content="article" />
	<meta property="og:url"         content={$page.url.href} />
	<meta property="og:image"       content={$page.data.communityBannerUrl ?? $page.data.communityLogoUrl ?? `${$page.url.origin}/default-og-image.png`} />
	<meta property="og:site_name"   content={$page.data.communityName ?? 'Nexus'} />
	{@html `<script type="application/ld+json">${JSON.stringify({
		"@context": "https://schema.org",
		"@type": "DiscussionForumPosting",
		"headline": thread.title,
		"url": $page.url.href,
		"author": { "@type": "Person", "name": thread.author_username },
		"datePublished": thread.created_at,
		"dateModified": thread.updated_at ?? thread.created_at,
		"commentCount": thread.post_count,
		"interactionStatistic": {
			"@type": "InteractionCounter",
			"interactionType": "https://schema.org/ViewAction",
			"userInteractionCount": thread.views
		},
		"isPartOf": {
			"@type": "DiscussionForumPosting",
			"name": $page.data.communityName ?? 'Nexus',
			"url": $page.url.origin + '/forum'
		}
	})}</script>`}
</svelte:head>

<!-- ── En-tête du thread avec avatar créateur ─────────────────────────────── -->
<div class="mb-8">
	<!-- Fil d'Ariane -->
	<div class="flex items-center justify-between mb-4">
		<a href="/forum/{thread.category_id}" class="text-sm text-gray-500 hover:text-indigo-400 transition-colors flex items-center gap-1">
			<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
			</svg>
			<span>Retour au forum</span>
		</a>
		
		<!-- Partage / Actions rapides -->
		<div class="flex items-center gap-2">
			<button class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-indigo-400 transition-colors" title="Partager">
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
				</svg>
			</button>
			<button class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-yellow-400 transition-colors" title="Suivre">
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
				</svg>
			</button>
		</div>
	</div>

	<!-- Carte d'identité du thread avec avatar du créateur -->
	<div class="relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-6 shadow-xl">
		<!-- Effet de glow subtil -->
		<div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
		
		<div class="flex items-start gap-3 sm:gap-6">
			<!-- Avatar du créateur (grand cercle) -->
			<div class="relative flex-shrink-0">
				{#if thread.author_avatar}
					<img 
						src={thread.author_avatar} 
						alt={thread.author_username}
						class="w-12 h-12 sm:w-20 sm:h-20 rounded-full object-cover ring-4 ring-indigo-500/20 shadow-2xl"
					/>
				{:else}
					<div class="w-12 h-12 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 
								flex items-center justify-center text-3xl font-bold text-white
								ring-4 ring-indigo-500/20 shadow-2xl">
						{thread.author_username.charAt(0).toUpperCase()}
					</div>
				{/if}
				<!-- Badge créateur -->
				<div class="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 
							flex items-center justify-center text-xs border-2 border-gray-900 shadow-lg"
					 title="Créateur du sujet">
					👑
				</div>
			</div>

			<!-- Infos principales -->
			<div class="flex-1 min-w-0">
				<!-- Badges du thread -->
				<div class="flex flex-wrap items-center gap-2 mb-2">
					{#if thread.is_pinned}
						<span class="inline-flex items-center gap-1 text-xs font-medium text-indigo-400 bg-indigo-900/30 border border-indigo-800/50 px-2 py-0.5 rounded-full">
							📌 Épinglé
						</span>
					{/if}
					{#if thread.is_locked}
						<span class="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">
							🔒 Verrouillé
						</span>
					{/if}
					{#if thread.is_featured}
						<span class="inline-flex items-center gap-1 text-xs font-medium text-yellow-400 bg-yellow-900/30 border border-yellow-800/50 px-2 py-0.5 rounded-full">
							⭐ À la une
						</span>
					{/if}
					{#each (thread.tags ?? []) as tag}
						<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
							style="background-color: {tag.color}22; color: {tag.color}; border: 1px solid {tag.color}55">
							{tag.name}
						</span>
					{/each}
				</div>

				<!-- Titre avec édition -->
				{#if editingTitle}
					<form method="POST" action="?/editTitle"
						use:enhance={() => {
							return async ({ update }) => {
								editingTitle = false;
								await update({ reset: false });
							}
						}}
						class="flex items-center gap-2 mt-1"
					>
						<input
							type="text"
							name="title"
							bind:value={titleInput}
							maxlength="300"
							required
							autofocus
							class="flex-1 rounded-lg bg-gray-800 border border-indigo-600 px-3 py-2 text-white text-xl font-bold focus:outline-none focus:border-indigo-400"
						/>
						<button type="submit"
							class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">
							Enregistrer
						</button>
						<button type="button" onclick={() => editingTitle = false}
							class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors">
							Annuler
						</button>
					</form>
				{:else}
					<div class="flex items-start gap-2 group/title">
						<h1 class="text-xl sm:text-3xl font-bold text-white leading-tight">{thread.title}</h1>
						{#if canEditTitle}
							<button
								type="button"
								onclick={startEditTitle}
								class="opacity-0 group-hover/title:opacity-100 transition-opacity mt-1 p-1.5 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800"
								title="Modifier le titre"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
								</svg>
							</button>
						{/if}
					</div>
				{/if}

				<!-- Métadonnées enrichies -->
				<div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
					<!-- Auteur et date -->
					<div class="flex items-center gap-1.5 text-gray-400">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
						</svg>
						<span class="font-medium text-gray-300">{thread.author_username}</span>
						<span class="text-gray-600">·</span>
						<span>{formatDate(thread.created_at)}</span>
					</div>

					<!-- Statistiques -->
					<div class="flex items-center gap-3">
						<!-- Vues -->
						<div class="flex items-center gap-1.5 text-gray-400 bg-gray-800/60 px-3 py-1 rounded-full border border-gray-700">
							<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
							</svg>
							<span class="font-medium text-gray-300">{thread.views}</span>
							<span class="text-gray-600 text-xs">vues</span>
						</div>

						<!-- Réponses -->
						<div class="flex items-center gap-1.5 text-gray-400 bg-gray-800/60 px-3 py-1 rounded-full border border-gray-700">
							<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
							</svg>
							<span class="font-medium text-gray-300">{thread.post_count}</span>
							<span class="text-gray-600 text-xs">réponses</span>
						</div>

						<!-- Dernier posteur (si existe) -->
						{#if lastPost && lastPost.author_username !== thread.author_username}
							<div class="flex items-center gap-1.5 text-gray-400 bg-gray-800/60 px-3 py-1 rounded-full border border-gray-700">
								<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
								</svg>
								<span class="text-xs text-gray-500">Dernier:</span>
								<div class="flex items-center gap-1">
									{#if lastPost.author_avatar}
										<img src={lastPost.author_avatar} alt="" class="w-5 h-5 rounded-full object-cover ring-1 ring-indigo-500/30" />
									{:else}
										<div class="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center text-[8px] font-bold text-white">
											{lastPost.author_username.charAt(0).toUpperCase()}
										</div>
									{/if}
									<span class="font-medium text-gray-300 text-xs">{lastPost.author_username}</span>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<!-- Boutons de modération (à droite) -->
			{#if isMod}
				<div class="flex flex-col gap-2 flex-shrink-0">
					<!-- Épingler/Désépingler -->
					<form method="POST" action="?/pinThread" use:enhance={() => {
						return async ({ update }) => { await update({ reset: false }) }
					}}>
						<input type="hidden" name="is_pinned" value={!thread.is_pinned} />
						<button type="submit"
							class="w-full px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
							{thread.is_pinned
								? 'border-indigo-700 text-indigo-400 bg-indigo-900/20 hover:bg-indigo-900/40'
								: 'border-gray-700 text-gray-400 hover:text-indigo-400 hover:border-indigo-700'}">
							📌 {thread.is_pinned ? 'Désépingler' : 'Épingler'}
						</button>
					</form>

					<!-- Verrouiller/Déverrouiller -->
					<form method="POST" action="?/lockThread" use:enhance={() => {
						return async ({ update }) => { await update({ reset: false }) }
					}}>
						<input type="hidden" name="is_locked" value={!thread.is_locked} />
						<button type="submit"
							class="w-full px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
							{thread.is_locked
								? 'border-amber-700 text-amber-400 bg-amber-900/20 hover:bg-amber-900/40'
								: 'border-gray-700 text-gray-400 hover:text-amber-400 hover:border-amber-700'}">
							🔒 {thread.is_locked ? 'Déverrouiller' : 'Verrouiller'}
						</button>
					</form>

					<!-- Promouvoir / rétrograder -->
					<form method="POST" action="?/featureThread" use:enhance={() => {
						return async ({ update }) => { await update({ reset: false }) }
					}}>
						<input type="hidden" name="is_featured" value={!thread.is_featured} />
						<button type="submit"
							class="w-full px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
							{thread.is_featured
								? 'border-yellow-700 text-yellow-400 bg-yellow-900/20 hover:bg-yellow-900/40'
								: 'border-gray-700 text-gray-400 hover:text-yellow-400 hover:border-yellow-700'}">
							⭐ {thread.is_featured ? 'Rétrograder' : 'Promouvoir'}
						</button>
					</form>

					<!-- Supprimer le thread -->
					{#if !confirmDeleteThread}
						<button type="button"
							onclick={() => confirmDeleteThread = true}
							class="w-full px-3 py-1.5 rounded-lg border border-red-800 text-xs font-medium text-red-400 hover:bg-red-900/20 transition-colors">
							🗑 Supprimer
						</button>
					{:else}
						<div class="flex flex-col gap-1">
							<span class="text-xs text-red-400 text-center">Confirmer ?</span>
							<form method="POST" action="?/deleteThread" use:enhance>
								<button type="submit" class="w-full px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-xs text-white font-medium">
									Oui, supprimer
								</button>
							</form>
							<button type="button" onclick={() => confirmDeleteThread = false}
								class="w-full px-2 py-1 rounded bg-gray-700 text-xs text-gray-300 hover:bg-gray-600">
								Annuler
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- ── Sondage du thread ────────────────────────────────────────────────────── -->
{#if threadPoll}
	<div class="mb-6">
		<PollCard
			pollId={threadPoll.id}
			inline={false}
			token={data.token}
			socket={null}
		/>
	</div>
{:else if canAddPoll}
	<div class="mb-6">
		<button
			type="button"
			onclick={() => showPollCreator = true}
			class="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-gray-700 text-sm text-gray-500 hover:text-indigo-400 hover:border-indigo-700 transition-colors"
		>
			<span>📊</span>
			<span>Ajouter un sondage à ce sujet</span>
		</button>
	</div>
{/if}

{#if showPollCreator}
	<PollCreator
		token={data.token}
		channelId={null}
		threadId={thread.id}
		onCreated={(poll) => { threadPoll = poll; showPollCreator = false; }}
		onClose={() => showPollCreator = false}
	/>
{/if}

<!-- ── Liste des posts (inchangée, mais on peut ajouter des séparateurs visuels) ── -->
<div class="space-y-4 mt-6">
	{#each posts as post, index (post.id)}
		<!-- Séparateur visuel pour les réponses -->
		{#if index > 0}
			<div class="relative flex justify-center my-2">
				<div class="absolute inset-0 flex items-center">
					<div class="w-full border-t border-gray-800"></div>
				</div>
				<div class="relative bg-gray-950 px-4 text-xs text-gray-700">
					Réponse #{index + 1}
				</div>
			</div>
		{/if}

		<article class="flex flex-wrap sm:flex-nowrap gap-4 rounded-lg border border-gray-800 bg-gradient-to-r from-gray-900 to-gray-900/80 p-4 hover:border-indigo-900/50 transition-colors duration-300">
			<!-- Profil auteur -->
			<ProfileCard
				username={post.author_username}
				avatarUrl={post.author_avatar ?? undefined}
				nameColor={post.author_name_color ?? null}
				nameGlow={post.author_name_glow ?? null}
				nameGlowIntensity={post.author_name_glow_intensity ?? null}
				nameAnimation={post.author_name_animation ?? null}
				nameFontFamily={post.author_name_font_family ?? null}
				nameFontUrl={post.author_name_font_url ?? null}
				points={post.author_points}
				tags={post.author_tags ?? []}
				memberSince={post.author_member_since}
				grade={post.author_grade_name ? { name: post.author_grade_name, color: post.author_grade_color ?? '#99AAB5' } : null}
				variant="forum"
			/>

			<!-- Contenu du post -->
			<div class="flex-1 min-w-0">
				<!-- Méta + actions -->
				<div class="flex items-center justify-between mb-3 gap-2">
					<div class="flex items-center gap-2">
						<span class="text-xs text-gray-500">{formatDate(post.created_at)}</span>
						{#if post.is_edited}
							<span class="text-xs text-gray-600 italic">(modifié)</span>
						{/if}
						
						<!-- Numéro de post pour référence -->
						<span class="text-xs text-gray-700 ml-2">#{index + 1}</span>
					</div>

					<!-- Boutons Edit / Delete (auteur ou mod) -->
					{#if canEdit(post) || canDelete(post)}
						<div class="flex items-center gap-1">
							{#if canEdit(post) && editingPostId !== post.id}
								<button type="button"
									onclick={() => { editingPostId = post.id; deletingPostId = null }}
									class="px-2 py-1 rounded text-xs text-gray-500 hover:text-indigo-400 hover:bg-indigo-900/20 transition-colors"
									title="Modifier ce message">
									✏️ Éditer
								</button>
							{/if}
							{#if canDelete(post)}
								{#if deletingPostId !== post.id}
									<button type="button"
										onclick={() => { deletingPostId = post.id; editingPostId = null }}
										class="px-2 py-1 rounded text-xs text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
										title="Supprimer ce message">
										🗑 Supprimer
									</button>
								{:else}
									<!-- Confirmation suppression -->
									<span class="text-xs text-red-400">Confirmer ?</span>
									<form method="POST" action="?/deletePost" use:enhance={() => {
										return async ({ update }) => {
											deletingPostId = null
											await update()
										}
									}} class="inline-flex items-center gap-1 ml-1">
										<input type="hidden" name="post_id" value={post.id} />
										<button type="submit"
											class="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-xs text-white font-medium">
											Oui
										</button>
										<button type="button" onclick={() => deletingPostId = null}
											class="px-2 py-1 rounded bg-gray-700 text-xs text-gray-300 hover:bg-gray-600">
											Non
										</button>
									</form>
								{/if}
							{/if}
						</div>
					{/if}
				</div>

				<!-- Mode édition inline -->
				{#if editingPostId === post.id}
					<form method="POST" action="?/editPost"
						use:enhance={() => {
							return async ({ update }) => {
								editingPostId = null
								await update()
							}
						}}
						class="space-y-2"
					>
						<input type="hidden" name="post_id" value={post.id} />
						<NexusEditor
							name="content"
							initialContent={post.content}
							compact={true}
						/>
						<div class="flex gap-2">
							<button type="submit"
								class="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors">
								Enregistrer
							</button>
							<button type="button"
								onclick={() => editingPostId = null}
								class="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 transition-colors">
								Annuler
							</button>
						</div>
					</form>
				{:else}
					<!-- Contenu HTML rendu -->
					<div class="nexus-prose">
						{@html post.content}
					</div>
					<!-- Réactions + Merci -->
					<PostReactions
						postId={post.id}
						reactions={post.reactions ?? []}
						thanksCount={post.thanks_count ?? 0}
						userThanked={post.user_thanked ?? false}
						isOwnPost={user?.id === post.author_id}
						isLoggedIn={!!user}
					/>
				{/if}
			</div>
		</article>
	{/each}
</div>

<!-- ── Formulaire de réponse (inchangé) ───────────────────────────────────── -->
{#if !thread.is_locked}
	{#if user}
		<div class="mt-8 border-t border-gray-800 pt-6">
			<h2 class="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
				</svg>
				Répondre à la discussion
			</h2>
			<form method="POST" action="?/reply"
				use:enhance={() => {
					submitting = true
					return async ({ update }) => {
						submitting = false
						replyKey++    // Vide l'éditeur en le remontant
						await update()
					}
				}}
				class="space-y-3"
			>
				{#key replyKey}
					<NexusEditor
						name="content"
						placeholder="Votre réponse..."
						compact={true}
					/>
				{/key}
				<button
					type="submit"
					disabled={submitting}
					class="rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors"
				>
					{submitting ? 'Publication...' : 'Publier la réponse'}
				</button>
			</form>
		</div>
	{:else}
		<div class="mt-8 border-t border-gray-800 pt-6 text-center">
			<p class="text-sm text-gray-500 mb-3">Vous devez être connecté pour répondre.</p>
			<a href="/auth/login" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">
				Se connecter
			</a>
		</div>
	{/if}
{:else}
	<p class="mt-6 text-sm text-gray-500 border-t border-gray-800 pt-4 flex items-center gap-2">
		<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
		</svg>
		Ce sujet est verrouillé.
	</p>
{/if}