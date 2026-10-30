<script lang="ts">
	// Les scrapers OG (Discord, Twitter, Facebook) exigent des URLs absolues
	// et lisent le HTML SSR : l'origin vient de page.url, jamais de window.
	// Les bannières/logos sont stockés en chemins relatifs (/uploads/...).
	function absolutize(url: string | null | undefined, origin: string): string | null {
		if (!url) return null
		if (/^https?:\/\//.test(url)) return url
		return origin + url
	}

	// JSON.stringify() n'échappe pas < > & : une valeur comme le titre du fil
	// contenant la séquence de fermeture d'un tag script romprait le JSON-LD
	// injecté plus bas et ferait exécuter ce qui suit comme du HTML/JS. On
	// échappe ces trois caractères en séquences unicode après coup, seule
	// façon fiable d'embarquer du JSON dans un tag script sans risque (voir
	// aussi le nettoyage posé côté API sur POST/PATCH /forums/threads).
	// Note : le "<\/script>" ci-dessous a son slash échappé exprès, sinon le
	// parseur Svelte lirait ce fichier .svelte comme fermant CE bloc script.
	function jsonLdScript(data: unknown): string {
		const json = JSON.stringify(data)
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e')
			.replace(/&/g, '\\u0026')
		return `<script type="application/ld+json">${json}<\/script>`
	}

	import { enhance, applyAction } from '$app/forms';
	import { untrack } from 'svelte';
	import { invalidateAll, goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import ProfileCard from '$lib/components/ProfileCard.svelte';
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte';
	import PostReactions from '$lib/components/PostReactions.svelte';
	import PollCard from '$lib/components/PollCard.svelte';
	import PollCreator from '$lib/components/PollCreator.svelte';
	import { t } from '$lib/i18n';
	import { replyCount } from '$lib/forumCounts';

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props();

	// ── Réactivité ────────────────────────────────────────────────────────
	const thread = $derived(data.thread);
	const posts  = $derived(data.posts);
	// Image de partage : bannière de l'article (1re image du post) → bannière de
	// communauté → logo → og-image par défaut. Toujours une seule og:image.
	const shareImage = $derived(
		absolutize(
			data.ogImagePath ?? page.data.communityBannerUrl ?? page.data.communityLogoUrl,
			page.url.origin,
		) ?? `${page.url.origin}/og-image.jpg`,
	);
	// post_count compte le message d'ouverture : ce n'est PAS un nombre de
	// réponses. Voir $lib/forumCounts.
	const replies = $derived(replyCount(thread.post_count));
	const user   = $derived(data.user);
	const isMod   = $derived(user?.role === 'owner' || user?.role === 'admin' || user?.role === 'moderator');
	// Épingler / verrouiller / mettre en avant : réservé owner + admin côté back
	// (routes/forums.ts). Les modérateurs voient le reste du panneau, pas ça.
	const canAdmin = $derived(user?.role === 'owner' || user?.role === 'admin');

	// ── État local ────────────────────────────────────────────────────────
	let replyKey      = $state(0);
	let editingPostId = $state<string | null>(null);
	let deletingPostId = $state<string | null>(null);
	let confirmDeleteThread = $state(false);
	let editingTitle  = $state(false);
	let titleInput    = $state('');
	let submitting    = $state(false);

	// ── Sondage du thread ─────────────────────────────────────────────────
	let threadPoll     = $state(untrack(() => data.poll ?? null));
	let showPollCreator = $state(false);

	const canAddPoll = $derived(
		user && !threadPoll && (user.id === thread.author_id || isMod)
	);

	// ── Partage du sujet ──────────────────────────────────────────────────
	// Le bouton existait depuis toujours SANS aucun gestionnaire : une pure
	// décoration. `navigator.share` ouvre la feuille de partage du système,
	// le seul geste qui ait du sens sur un téléphone ; ailleurs elle n'existe
	// pas et on retombe sur le presse-papier.
	let shareState = $state<'idle' | 'copied' | 'failed'>('idle');
	let shareTimer: ReturnType<typeof setTimeout> | null = null;

	function flashShare(next: 'copied' | 'failed') {
		shareState = next;
		if (shareTimer) clearTimeout(shareTimer);
		shareTimer = setTimeout(() => { shareState = 'idle' }, 2500);
	}

	async function shareThread() {
		const url = page.url.href;

		if (typeof navigator !== 'undefined' && navigator.share) {
			try {
				await navigator.share({ title: thread.title, url });
				return;
			} catch (err) {
				// Fermer la feuille de partage n'est pas un échec : on ne
				// bascule PAS sur le presse-papier dans ce cas, sinon annuler
				// un partage copierait quand même le lien dans le dos de
				// l'utilisateur.
				if ((err as Error)?.name === 'AbortError') return;
			}
		}

		try {
			await navigator.clipboard.writeText(url);
			flashShare('copied');
		} catch {
			// Presse-papier refusé (contexte non sécurisé, permission). On le
			// dit plutôt que de laisser le bouton muet, ce qui était justement
			// le défaut d'origine.
			flashShare('failed');
		}
	}

	// Repli des actions de modération sur mobile : quatre boutons de plus sur
	// une ligne de 375 px reproduiraient l'encombrement qu'on vient d'enlever.
	let showModActions = $state(false);

	function startEditTitle() {
		titleInput   = thread.title;
		editingTitle = true;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString([], {
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
	<title>{thread.title} · {page.data.communityName ?? 'Nodyx'}</title>
	<meta name="description" content="Discussion : {thread.title} par {thread.author_username}" />
	<link rel="canonical" href={page.url.href} />
	<meta property="og:title"       content="{thread.title} · {page.data.communityName ?? 'Nodyx'}" />
	<meta property="og:description" content="Discussion par {thread.author_username} · {replies} {tFn('forum.replies_label')} · {thread.views} {tFn('forum.views')}" />
	<meta property="og:type"        content="article" />
	<meta property="og:url"         content={page.url.href} />
	<!-- Pas de og:image:width/height ici : l'image de tête d'un article a des
	     dimensions variables (le pipeline d'upload re-encode/redimensionne).
	     Déclarer une taille fixe fausserait l'aperçu. Les scrapers lisent la
	     vraie taille de l'image. -->
	<meta property="og:image"        content={shareImage} />
	<meta name="twitter:image"       content={shareImage} />
	<meta property="og:site_name"   content={page.data.communityName ?? 'Nodyx'} />
	{@html jsonLdScript({
		"@context": "https://schema.org",
		"@type": "DiscussionForumPosting",
		"headline": thread.title,
		"url": page.url.href,
		"author": { "@type": "Person", "name": thread.author_username },
		"datePublished": thread.created_at,
		"dateModified": thread.updated_at ?? thread.created_at,
		"commentCount": replies,
		"interactionStatistic": {
			"@type": "InteractionCounter",
			"interactionType": "https://schema.org/ViewAction",
			"userInteractionCount": thread.views
		},
		"isPartOf": {
			"@type": "DiscussionForumPosting",
			"name": page.data.communityName ?? 'Nodyx',
			"url": page.url.origin + '/forum'
		}
	})}
</svelte:head>

<!-- ── En-tête du thread avec avatar créateur ─────────────────────────────── -->
<div class="mb-8">
	<!-- Fil d'Ariane -->
	<!-- Les boutons Partager et Suivre vivaient ici. Partager descend dans la
	     barre d'actions sous la carte, où il est enfin câblé. Suivre est retiré :
	     la fonctionnalité n'existe pas côté nodyx-core (aucune route, aucune
	     table), et un bouton qui ne fait rien ment à l'utilisateur. -->
	<div class="mb-4">
		<a href="/forum/{thread.category_slug ?? thread.category_id}" class="text-sm text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] transition-colors inline-flex items-center gap-1">
			<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
			</svg>
			{tFn('forum.back_to_forum')}
		</a>
	</div>

	<!-- Carte d'identité du thread avec avatar du créateur -->
	<div class="relative overflow-hidden border border-[color-mix(in_srgb,var(--nx-text)_6%,transparent)] bg-[var(--nx-surface)] p-6">
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
			</div>

			<!-- Infos principales -->
			<div class="flex-1 min-w-0">
				<!-- Badges du thread -->
				<div class="flex flex-wrap items-center gap-2 mb-2">
					{#if thread.is_pinned}
						<span class="inline-flex items-center gap-1 text-xs font-medium text-[var(--nx-header-accent)] bg-[rgb(var(--nx-accent-rgb)/0.1)] border border-indigo-800/50 px-2 py-0.5">
							📌 {tFn('common.pinned')}
						</span>
					{/if}
					{#if thread.is_locked}
						<span class="inline-flex items-center gap-1 text-xs font-medium text-[var(--nx-text-muted)] bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-2 py-0.5">
							🔒 {tFn('common.locked')}
						</span>
					{/if}
					{#if thread.is_featured}
						<span class="inline-flex items-center gap-1 text-xs font-medium text-[var(--nx-warn)] bg-[color-mix(in_srgb,var(--nx-warn)_12%,transparent)] border border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)] px-2 py-0.5">
							⭐ {tFn('common.featured')}
						</span>
					{/if}
					{#each (thread.tags ?? []) as tag}
						<span class="inline-flex items-center px-2 py-0.5 text-xs font-medium"
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
							class="flex-1 bg-[var(--nx-surface-raised)] border border-indigo-600 px-3 py-2 text-[var(--nx-text)] text-xl font-bold focus:outline-none focus:border-indigo-400"
						/>
						<button type="submit"
							class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">
							{tFn('common.save')}
						</button>
						<button type="button" onclick={() => editingTitle = false}
							class="px-4 py-2 bg-[var(--nx-border)] hover:bg-[var(--nx-border)] text-sm text-[var(--nx-text)] transition-colors">
							{tFn('common.cancel')}
						</button>
					</form>
				{:else}
					<div class="flex items-start gap-2 group/title">
						<h1 class="text-xl sm:text-3xl font-bold text-[var(--nx-text)] leading-tight">{thread.title}</h1>
						{#if canEditTitle}
							<button
								type="button"
								onclick={startEditTitle}
								class="opacity-0 group-hover/title:opacity-100 transition-opacity mt-1 p-1.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] hover:bg-[var(--nx-surface-raised)]"
								title={tFn('forum.edit_title')}
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
					<div class="flex items-center gap-1.5 text-[var(--nx-text-muted)]">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
						</svg>
						<span class="font-medium text-[var(--nx-text)]">{thread.author_username}</span>
						<span class="text-[var(--nx-text-muted)]">·</span>
						<span>{formatDate(thread.created_at)}</span>
					</div>

					<!-- Statistiques -->
					<!-- `flex-wrap` : sans lui les trois encarts (vues, reponses,
					     dernier posteur) tiennent sur une seule ligne quoi qu'il arrive,
					     et le troisieme se fait couper au bord de l'ecran sur un
					     telephone. Le conteneur PARENT en avait un, pas celui-ci. -->
					<div class="flex flex-wrap items-center gap-3">
						<!-- Vues -->
						<div class="flex items-center gap-1.5 text-[var(--nx-text-muted)] bg-[var(--nx-surface-raised)]/60 px-3 py-1 border border-[var(--nx-border)]">
							<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
							</svg>
							<span class="font-medium text-[var(--nx-text)]">{thread.views}</span>
							<span class="text-[var(--nx-text-muted)] text-xs">{tFn('forum.views')}</span>
						</div>

						<!-- Réponses -->
						<div class="flex items-center gap-1.5 text-[var(--nx-text-muted)] bg-[var(--nx-surface-raised)]/60 px-3 py-1 border border-[var(--nx-border)]">
							<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
							</svg>
							<span class="font-medium text-[var(--nx-text)]">{replies}</span>
							<span class="text-[var(--nx-text-muted)] text-xs">{tFn('forum.replies_label')}</span>
						</div>

						<!-- Dernier posteur (si existe) -->
						{#if lastPost && lastPost.author_username !== thread.author_username}
							<div class="flex items-center gap-1.5 text-[var(--nx-text-muted)] bg-[var(--nx-surface-raised)]/60 px-3 py-1 border border-[var(--nx-border)]">
								<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
								</svg>
								<span class="text-xs text-[var(--nx-text-muted)]">{tFn('forum.last_poster')}</span>
								<div class="flex items-center gap-1">
									{#if lastPost.author_avatar}
										<img src={lastPost.author_avatar} alt="" class="w-5 h-5 rounded-full object-cover ring-1 ring-indigo-500/30" />
									{:else}
										<div class="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center text-[8px] font-bold text-white">
											{lastPost.author_username.charAt(0).toUpperCase()}
										</div>
									{/if}
									<span class="font-medium text-[var(--nx-text)] text-xs">{lastPost.author_username}</span>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- ── Barre d'actions du sujet ──────────────────────────────────────────── -->
	<!-- Ces boutons formaient une TROISIÈME colonne dans la ligne du titre, en
	     `flex-shrink-0` et sans `flex-wrap` : sur un écran de 375 px, l'avatar
	     et cette colonne ne laissaient qu'environ 215 px au titre. Descendus ici,
	     ils ont leur propre ligne et le titre reprend toute la largeur.
	     Les deux zones restent séparées à dessein : coller « Supprimer » contre
	     « Ajouter un sondage » fabrique le mauvais clic sur l'action la moins
	     réversible de la page. -->
	<div class="mt-3 flex flex-wrap items-center justify-between gap-2">

		<!-- Ce que le lecteur et l'auteur peuvent faire -->
		<div class="flex flex-wrap items-center gap-2">
			<button type="button" onclick={shareThread}
				class="inline-flex items-center gap-2 px-3 py-1.5 border border-[var(--nx-border)] text-xs font-medium text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] hover:border-indigo-700 transition-colors">
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
				</svg>
				{tFn('forum.action_share')}
			</button>

			{#if shareState !== 'idle'}
				<span role="status" class="text-xs {shareState === 'copied' ? 'text-[var(--nx-header-accent)]' : 'text-[var(--nx-warn)]'}">
					{shareState === 'copied' ? tFn('forum.share_copied') : tFn('forum.share_failed')}
				</span>
			{/if}

			{#if canAddPoll}
				<button type="button" onclick={() => showPollCreator = true}
					class="inline-flex items-center gap-2 px-3 py-1.5 border border-dashed border-[var(--nx-border)] text-xs font-medium text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] hover:border-indigo-700 transition-colors">
					<span>📊</span>
					{tFn('forum.add_poll_thread')}
				</button>
			{/if}
		</div>

		<!-- Ce que seule la modération peut faire -->
		{#if isMod}
			<div class="w-full sm:w-auto">
				<!-- Sur mobile les quatre actions sont repliées : les remettre en
				     ligne sur 375 px reproduirait l'encombrement qu'on vient d'ôter. -->
				<button type="button" onclick={() => showModActions = !showModActions}
					aria-expanded={showModActions}
					class="sm:hidden inline-flex items-center gap-2 px-3 py-1.5 border border-[var(--nx-border)] text-xs font-medium text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] transition-colors">
					<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 4v5c0 4.418-2.867 7.75-7 9-4.133-1.25-7-4.582-7-9V7l7-4z" />
					</svg>
					{tFn('forum.moderate')}
				</button>

				<div class="{showModActions ? 'flex' : 'hidden'} sm:flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
					{#if canAdmin}
					<!-- Épingler/Désépingler -->
					<form method="POST" action="?/pinThread" use:enhance={() => {
						return async ({ update }) => { await update({ reset: false }) }
					}}>
						<input type="hidden" name="is_pinned" value={!thread.is_pinned} />
						<button type="submit"
							class="px-3 py-1.5 border text-xs font-medium transition-colors
							{thread.is_pinned
								? 'border-indigo-700 text-[var(--nx-header-accent)] bg-[rgb(var(--nx-accent-rgb)/0.08)] hover:bg-[rgb(var(--nx-accent-rgb)/0.14)]'
								: 'border-[var(--nx-border)] text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] hover:border-indigo-700'}">
							{thread.is_pinned ? tFn('forum.unpin') : tFn('forum.pin')}
						</button>
					</form>

					<!-- Verrouiller/Déverrouiller -->
					<form method="POST" action="?/lockThread" use:enhance={() => {
						return async ({ update }) => { await update({ reset: false }) }
					}}>
						<input type="hidden" name="is_locked" value={!thread.is_locked} />
						<button type="submit"
							class="px-3 py-1.5 border text-xs font-medium transition-colors
							{thread.is_locked
								? 'border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)] text-[var(--nx-warn)] bg-[color-mix(in_srgb,var(--nx-warn)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--nx-warn)_15%,transparent)]'
								: 'border-[var(--nx-border)] text-[var(--nx-text-muted)] hover:text-[var(--nx-warn)] hover:border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)]'}">
							{thread.is_locked ? tFn('forum.unlock') : tFn('forum.lock')}
						</button>
					</form>

					<!-- Promouvoir / rétrograder -->
					<form method="POST" action="?/featureThread" use:enhance={() => {
						return async ({ update }) => { await update({ reset: false }) }
					}}>
						<input type="hidden" name="is_featured" value={!thread.is_featured} />
						<button type="submit"
							class="px-3 py-1.5 border text-xs font-medium transition-colors
							{thread.is_featured
								? 'border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)] text-[var(--nx-warn)] bg-[color-mix(in_srgb,var(--nx-warn)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--nx-warn)_15%,transparent)]'
								: 'border-[var(--nx-border)] text-[var(--nx-text-muted)] hover:text-[var(--nx-warn)] hover:border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)]'}">
							{thread.is_featured ? tFn('forum.unfeature') : tFn('forum.feature')}
						</button>
					</form>
					{/if}

					<!-- Supprimer le thread -->
					{#if !confirmDeleteThread}
						<button type="button"
							onclick={() => confirmDeleteThread = true}
							class="px-3 py-1.5 border border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] text-xs font-medium text-[var(--nx-bad)] hover:bg-[color-mix(in_srgb,var(--nx-bad)_10%,transparent)] transition-colors">
							🗑 {tFn('common.delete')}
						</button>
					{:else}
						<div class="inline-flex items-center gap-2">
							<span class="text-xs text-[var(--nx-bad)]">{tFn('forum.confirm')}</span>
							<form method="POST" action="?/deleteThread"
								use:enhance={() => async ({ result }) => {
									// Invalide TOUS les caches de chargement (home, catégorie...)
									// pour que le thread supprimé disparaisse sans refresh manuel.
									if (result.type === 'redirect') await goto(result.location, { invalidateAll: true });
									else { await applyAction(result); await invalidateAll(); }
								}}>
								<button type="submit" class="px-2 py-1 bg-red-700 hover:bg-red-600 text-xs text-white font-medium">
									{tFn('forum.delete_confirm_yes')}
								</button>
							</form>
							<button type="button" onclick={() => confirmDeleteThread = false}
								class="px-2 py-1 bg-[var(--nx-border)] text-xs text-[var(--nx-text)] hover:bg-[var(--nx-border)]">
								{tFn('common.cancel')}
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}
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
{/if}
<!-- Le bouton « Ajouter un sondage » vivait ici ; il a rejoint la barre
     d'actions sous l'en-tête, avec les autres gestes de l'auteur. -->

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
					<div class="w-full border-t border-[var(--nx-border)]"></div>
				</div>
				<div class="relative bg-[var(--nx-surface)] px-4 text-xs text-[var(--nx-text-muted)]">
					{tFn('forum.reply_number', { n: String(index + 1) })}
				</div>
			</div>
		{/if}

		<article class="flex flex-col sm:flex-row gap-4 border border-[color-mix(in_srgb,var(--nx-text)_6%,transparent)] bg-[var(--nx-surface)]/60 p-4 hover:border-indigo-900/50 transition-colors duration-200">
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
						<span class="text-xs text-[var(--nx-text-muted)]">{formatDate(post.created_at)}</span>
						{#if post.is_edited}
							<span class="text-xs text-[var(--nx-text-muted)] italic">{tFn('forum.edited')}</span>
						{/if}
						
						<!-- Numéro de post pour référence -->
						<span class="text-xs text-[var(--nx-text-muted)] ml-2">#{index + 1}</span>
					</div>

					<!-- Boutons Edit / Delete (auteur ou mod) -->
					{#if canEdit(post) || canDelete(post)}
						<div class="flex items-center gap-1">
							{#if canEdit(post) && editingPostId !== post.id}
								<button type="button"
									onclick={() => { editingPostId = post.id; deletingPostId = null }}
									class="px-2 py-1 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] hover:bg-[rgb(var(--nx-accent-rgb)/0.08)] transition-colors"
									title={tFn('forum.edit_message_title')}>
									✏️ {tFn('common.edit')}
								</button>
							{/if}
							{#if canDelete(post)}
								{#if deletingPostId !== post.id}
									<button type="button"
										onclick={() => { deletingPostId = post.id; editingPostId = null }}
										class="px-2 py-1 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-bad)] hover:bg-[color-mix(in_srgb,var(--nx-bad)_10%,transparent)] transition-colors"
										title={tFn('forum.delete_message_title')}>
										🗑 {tFn('common.delete')}
									</button>
								{:else}
									<!-- Confirmation suppression -->
									<span class="text-xs text-[var(--nx-bad)]">{tFn('forum.confirm')}</span>
									<form method="POST" action="?/deletePost" use:enhance={() => {
										return async ({ update }) => {
											deletingPostId = null
											await update()
										}
									}} class="inline-flex items-center gap-1 ml-1">
										<input type="hidden" name="post_id" value={post.id} />
										<button type="submit"
											class="px-2 py-1 bg-red-700 hover:bg-red-600 text-xs text-white font-medium">
											Oui
										</button>
										<button type="button" onclick={() => deletingPostId = null}
											class="px-2 py-1 bg-[var(--nx-border)] text-xs text-[var(--nx-text)] hover:bg-[var(--nx-border)]">
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
						<NodyxEditor
							name="content"
							initialContent={post.content}
							compact={true}
						/>
						<div class="flex gap-2">
							<button type="submit"
								class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors">
								{tFn('common.save')}
							</button>
							<button type="button"
								onclick={() => editingPostId = null}
								class="px-3 py-1.5 bg-[var(--nx-border)] hover:bg-[var(--nx-border)] text-xs text-[var(--nx-text)] transition-colors">
								{tFn('common.cancel')}
							</button>
						</div>
					</form>
				{:else}
					<!-- Contenu HTML rendu -->
					<div class="nodyx-prose">
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
						token={data.token}
					/>
				{/if}
			</div>
		</article>
	{/each}
</div>

<!-- ── Formulaire de réponse (inchangé) ───────────────────────────────────── -->
{#if !thread.is_locked}
	{#if user}
		<div class="mt-8 border-t border-[var(--nx-border)] pt-6">
			<h2 class="text-sm font-semibold text-[var(--nx-text-muted)] mb-3 flex items-center gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
				</svg>
				{tFn('forum.reply_to')}
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
					<NodyxEditor
						name="content"
						placeholder={tFn('forum.reply_placeholder')}
						compact={true}
					/>
				{/key}
				<button
					type="submit"
					disabled={submitting}
					class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors"
				>
					{submitting ? tFn('common.publishing') : tFn('forum.publish_reply')}
				</button>
			</form>
		</div>
	{:else}
		<div class="mt-8 border-t border-[var(--nx-border)] pt-6 text-center">
			<p class="text-sm text-[var(--nx-text-muted)] mb-3">{tFn('forum.must_login_reply')}</p>
			<a href="/auth/login" class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">
				{tFn('common.login')}
			</a>
		</div>
	{/if}
{:else}
	<p class="mt-6 text-sm text-[var(--nx-text-muted)] border-t border-[var(--nx-border)] pt-4 flex items-center gap-2">
		<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
		</svg>
		{tFn('forum.thread_locked')}
	</p>
{/if}