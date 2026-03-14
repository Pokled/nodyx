<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import { PUBLIC_API_URL } from '$env/static/public';

	interface NexusInstance {
		id:           number
		name:         string
		slug:         string
		url:          string
		description:  string | null
		language:     string
		country:      string | null
		theme:        string | null
		members:      number
		online:       number
		version:      string | null
		status:       string
		last_seen:    string | null
		registered_at: string
		logo_url:     string | null
		banner_url:   string | null
	}

	let { data }: { data: PageData } = $props()

	const instances = $derived<NexusInstance[]>(data.instances ?? [])
	const user      = $derived($page.data.user)

	// Slugs liés — initialisé depuis le serveur, puis géré localement (optimistic updates)
	let linkedSlugs = $state<string[]>(($page.data.user as any)?.linked_instances ?? [])

	let linkLoading = $state<string | null>(null) // slug en cours

	async function toggleLink(slug: string) {
		if (!user || linkLoading) return
		const action = linkedSlugs.includes(slug) ? 'remove' : 'add'
		linkLoading = slug
		// Mise à jour optimiste immédiate
		linkedSlugs = action === 'add'
			? [...linkedSlugs, slug]
			: linkedSlugs.filter(s => s !== slug)
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/me/linked-instances`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${$page.data.token}` },
				body: JSON.stringify({ action, slug }),
			})
			const json = await res.json()
			if (res.ok) {
				linkedSlugs = json.linked_instances ?? []
			} else {
				// Rollback en cas d'erreur
				linkedSlugs = action === 'add'
					? linkedSlugs.filter(s => s !== slug)
					: [...linkedSlugs, slug]
			}
		} catch {
			// Rollback réseau
			linkedSlugs = action === 'add'
				? linkedSlugs.filter(s => s !== slug)
				: [...linkedSlugs, slug]
		} finally {
			linkLoading = null
		}
	}

	const LANGUAGES = [
		{ key: 'all', label: 'Toutes' },
		{ key: 'fr',  label: '🇫🇷 Français' },
		{ key: 'en',  label: '🇬🇧 English' },
		{ key: 'de',  label: '🇩🇪 Deutsch' },
	]

	let langFilter  = $state('all')
	let searchQuery = $state('')

	const filtered = $derived(
		instances.filter(i => {
			if (langFilter !== 'all' && i.language !== langFilter) return false
			if (searchQuery) {
				const q = searchQuery.toLowerCase()
				return i.name.toLowerCase().includes(q)
				    || (i.description?.toLowerCase().includes(q) ?? false)
				    || i.slug.toLowerCase().includes(q)
			}
			return true
		})
	)

	const totalMembers = $derived(filtered.reduce((s, i) => s + (i.members ?? 0), 0))

	function instanceUrl(i: NexusInstance): string {
		return i.url
	}

	function isOnline(i: NexusInstance): boolean {
		if (!i.last_seen) return false
		// Ping interval is 5 min — allow 10 min buffer before marking offline
		return Date.now() - new Date(i.last_seen).getTime() < 10 * 60 * 1000
	}
</script>

<svelte:head>
	<title>Annuaire des instances — Réseau Nexus</title>
	<meta name="description" content="Découvrez toutes les communautés du réseau Nexus. Chaque instance est une communauté indépendante et auto-hébergée." />
</svelte:head>

<!-- ── Header ─────────────────────────────────────────────────────────────── -->
<div class="mb-8">
	<div class="flex items-start justify-between gap-4 flex-wrap">
		<div>
			<div class="flex items-center gap-2 mb-2">
				<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
				             bg-indigo-900/60 text-indigo-300 border border-indigo-800/60">
					<span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
					Réseau Nexus — Phase 1
				</span>
			</div>
			<h1 class="text-3xl font-bold text-white">Annuaire des instances</h1>
			<p class="text-gray-400 mt-1 max-w-xl">
				Chaque instance est une communauté indépendante. Hébergée par ses membres.
				Accessible à tous. Plus il y en a, plus le réseau est fort.
			</p>
		</div>

		<!-- Network stats -->
		<div class="flex gap-4 text-center shrink-0">
			<div class="px-4 py-3 rounded-lg bg-gray-900 border border-gray-800">
				<div class="text-xl font-bold text-white">{instances.length}</div>
				<div class="text-xs text-gray-500">instances</div>
			</div>
			<div class="px-4 py-3 rounded-lg bg-gray-900 border border-gray-800">
				<div class="text-xl font-bold text-white">{instances.reduce((s,i)=>s+(i.members??0),0).toLocaleString('fr-FR')}</div>
				<div class="text-xs text-gray-500">membres</div>
			</div>
		</div>
	</div>
</div>

<!-- ── Filters ────────────────────────────────────────────────────────────── -->
<div class="flex flex-wrap gap-4 mb-6">
	<div class="relative flex-1 min-w-[200px]">
		<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
		     fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
			      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
		</svg>
		<input
			type="text"
			placeholder="Rechercher une instance..."
			bind:value={searchQuery}
			class="w-full pl-9 pr-4 py-2 rounded-lg bg-gray-900 border border-gray-800
			       text-sm text-gray-200 placeholder-gray-600
			       focus:outline-none focus:border-indigo-700 transition-colors"
		/>
	</div>

	<div class="flex gap-1 flex-wrap">
		{#each LANGUAGES as l}
			<button
				onclick={() => langFilter = l.key}
				class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
				       {langFilter === l.key
				         ? 'bg-gray-700 text-white'
				         : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800'}"
			>
				{l.label}
			</button>
		{/each}
	</div>
</div>

<!-- ── Results count ──────────────────────────────────────────────────────── -->
<div class="flex items-center justify-between mb-4 text-xs text-gray-600">
	<span>{filtered.length} instance{filtered.length > 1 ? 's' : ''} trouvée{filtered.length > 1 ? 's' : ''}</span>
	{#if langFilter !== 'all' || searchQuery}
		<span class="text-gray-500">{totalMembers.toLocaleString('fr-FR')} membres</span>
	{/if}
</div>

<!-- ── Grid ───────────────────────────────────────────────────────────────── -->
{#if instances.length === 0}
	<div class="text-center py-16 border border-dashed border-gray-800 rounded-xl">
		<p class="text-gray-500 mb-2">Aucune instance enregistrée pour l'instant.</p>
		<p class="text-xs text-gray-600">Soyez la première communauté du réseau Nexus !</p>
	</div>
{:else if filtered.length === 0}
	<div class="text-center py-16 border border-dashed border-gray-800 rounded-xl">
		<p class="text-gray-500">Aucune instance ne correspond à ces filtres.</p>
	</div>
{:else}
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each filtered as instance}
			<div class="flex flex-col rounded-xl border border-gray-800 bg-gray-900/50
			            hover:border-indigo-800/60 hover:bg-gray-900/80 transition-all group overflow-hidden">

				<!-- Bannière -->
				<div class="relative h-24 shrink-0 bg-gradient-to-br from-indigo-950 to-gray-900">
					{#if instance.banner_url}
						<img src={instance.banner_url.startsWith('http') ? instance.banner_url : instance.url.replace(/\/$/, '') + instance.banner_url} alt="" class="absolute inset-0 w-full h-full object-cover opacity-70" />
					{/if}
					<!-- Badge online flottant -->
					<div class="absolute top-2 right-2 flex items-center gap-1.5
					            bg-black/50 backdrop-blur-sm rounded-full px-2 py-0.5">
						<span class="w-1.5 h-1.5 rounded-full {isOnline(instance) ? 'bg-green-400' : 'bg-gray-500'}"></span>
						<span class="text-xs text-gray-300">{isOnline(instance) ? 'en ligne' : 'hors ligne'}</span>
					</div>
				</div>

				<div class="relative z-10 px-5 pb-5 flex flex-col flex-1">
					<!-- Logo + nom (logo chevauche la bannière) -->
					<div class="flex items-end gap-3 -mt-6 mb-3">
						<div class="w-12 h-12 rounded-xl border-2 border-gray-800 bg-indigo-900
						            flex items-center justify-center shrink-0 overflow-hidden shadow-lg">
							{#if instance.logo_url}
								<img src={instance.logo_url.startsWith('http') ? instance.logo_url : instance.url.replace(/\/$/, '') + instance.logo_url} alt={instance.name} class="w-full h-full object-cover" />
							{:else}
								<span class="text-lg font-bold text-indigo-200 select-none">
									{instance.name.charAt(0).toUpperCase()}
								</span>
							{/if}
						</div>
						<div class="pb-0.5">
							<h2 class="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors leading-tight">
								{instance.name}
							</h2>
							<span class="text-xs text-gray-600 font-mono">{instance.slug}.nexusnode.app</span>
						</div>
					</div>

					<p class="text-xs text-gray-400 leading-relaxed line-clamp-2 flex-1 mb-4">
						{instance.description ?? 'Aucune description.'}
					</p>

					<div class="flex flex-wrap items-center gap-1.5 mb-4">
						{#if instance.language}
							<span class="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400 border border-gray-700">
								{instance.language.toUpperCase()}
							</span>
						{/if}
						{#if instance.theme}
							<span class="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400 border border-gray-700">
								{instance.theme}
							</span>
						{/if}
						<span class="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-500 border border-gray-700">
							{instance.members ?? 0} membres
						</span>
					</div>

					<div class="flex items-center justify-between pt-3 border-t border-gray-800/60 gap-2">
						<div class="text-xs text-gray-600 shrink-0">
							Depuis {new Date(instance.registered_at).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}
						</div>
						<div class="flex items-center gap-2">
							{#if user}
								{@const linked = linkedSlugs.includes(instance.slug)}
								<button
									onclick={() => toggleLink(instance.slug)}
									disabled={linkLoading === instance.slug}
									title={linked ? 'Retirer de ma Galaxy Bar' : "J'ai un compte ici"}
									class="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors
									       {linked
									         ? 'bg-indigo-900/60 text-indigo-300 hover:bg-red-900/40 hover:text-red-400 border border-indigo-800/60'
									         : 'bg-gray-800 text-gray-400 hover:bg-indigo-900/40 hover:text-indigo-300 border border-gray-700'}"
								>
									{#if linkLoading === instance.slug}
										<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
									{:else if linked}
										<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
										Lié
									{:else}
										<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
										J'ai un compte
									{/if}
								</button>
							{/if}
							<a
								href={instanceUrl(instance)}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors
								       flex items-center gap-1"
							>
								Visiter
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
									      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
								</svg>
							</a>
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

<!-- ── Register CTA ───────────────────────────────────────────────────────── -->
<div class="mt-10 rounded-xl border border-dashed border-indigo-900/60 bg-indigo-950/20 p-8 text-center">
	<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-900/60
	            border border-indigo-800 mb-4">
		<svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
		</svg>
	</div>
	<h3 class="text-lg font-semibold text-white mb-2">Vous avez une instance Nexus ?</h3>
	<p class="text-sm text-gray-400 max-w-md mx-auto mb-5">
		Enregistrez-la dans l'annuaire et recevez un sous-domaine gratuit
		<code class="text-indigo-400">votre-nom.nexusnode.app</code>.
		Votre communauté devient visible dans le réseau.
	</p>
	<div class="flex flex-wrap gap-3 justify-center">
		<a
			href="https://github.com/Pokled/Nexus"
			target="_blank" rel="noopener"
			class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-700 hover:bg-indigo-600
			       text-sm font-semibold text-white transition-colors"
		>
			Enregistrer mon instance
		</a>
		<a
			href="https://github.com/Pokled/Nexus"
			target="_blank" rel="noopener"
			class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700
			       border border-gray-700 text-sm font-semibold text-gray-200 transition-colors"
		>
			Installer Nexus
		</a>
	</div>
	<p class="text-xs text-gray-600 mt-4">Sous-domaine gratuit · SSL automatique · AGPL-3.0</p>
</div>
