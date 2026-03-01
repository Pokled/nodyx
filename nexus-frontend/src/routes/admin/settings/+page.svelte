<script lang="ts">
	import type { PageData, ActionData } from './$types'
	import { enhance } from '$app/forms'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { tokenStore } from '$lib/socket'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const i = data.instance

	// Branding state
	let logoUrl   = $state<string>(i.logo_url   ?? '')
	let bannerUrl = $state<string>(i.banner_url ?? '')

	let logoMode   = $state<'url' | 'file'>('url')
	let bannerMode = $state<'url' | 'file'>('url')
	let uploadingLogo   = $state(false)
	let uploadingBanner = $state(false)

	async function uploadBrandingFile(type: 'logo' | 'banner', file: File) {
		const token = $tokenStore
		if (!token) return

		const fd = new FormData()
		fd.append('file', file)
		const res = await fetch(`${PUBLIC_API_URL}/admin/branding/upload?type=${type}`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    fd,
		})
		if (!res.ok) return
		const { url } = await res.json()
		// url est déjà un chemin relatif (/uploads/logos/xxx.jpg)
		// On le stocke tel quel → Vite proxy ou reverse proxy gère la résolution
		if (type === 'logo')   logoUrl   = url
		if (type === 'banner') bannerUrl = url
	}

	async function handleLogoFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		uploadingLogo = true
		await uploadBrandingFile('logo', file)
		uploadingLogo = false
	}

	async function handleBannerFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		uploadingBanner = true
		await uploadBrandingFile('banner', file)
		uploadingBanner = false
	}
</script>

<svelte:head><title>Paramètres — Admin Nexus</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-2">Paramètres de l'instance</h1>
	<p class="text-sm text-gray-500 mb-8">
		Configuration et identité visuelle de votre communauté Nexus.
	</p>

	<!-- ── Branding ────────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-6 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Identité visuelle</h2>
		<p class="text-xs text-gray-600 mb-6">Logo affiché dans la Galaxy Bar · Bannière affichée en haut du forum</p>

		{#if form?.error}
			<p class="mb-4 text-sm text-red-400 bg-red-900/30 border border-red-800/50 rounded-lg px-4 py-2">{form.error}</p>
		{/if}
		{#if form?.ok}
			<p class="mb-4 text-sm text-green-400 bg-green-900/30 border border-green-800/50 rounded-lg px-4 py-2">Branding mis à jour ✓</p>
		{/if}

		<form method="POST" action="?/saveBranding" use:enhance>
			<!-- Logo -->
			<div class="mb-6">
				<label class="block text-sm font-medium text-gray-300 mb-2">Logo de l'instance</label>
				<div class="flex items-start gap-4">
					<!-- Preview -->
					<div class="w-16 h-16 rounded-2xl shrink-0 overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center" style="border-radius: 30%">
						{#if logoUrl}
							<img src={logoUrl} alt="Logo" class="w-full h-full object-cover" />
						{:else}
							<span class="text-2xl font-bold text-indigo-400">{(i.name ?? 'N').charAt(0).toUpperCase()}</span>
						{/if}
					</div>
					<div class="flex-1 space-y-2">
						<!-- Toggle -->
						<div class="flex gap-2 mb-2">
							<button type="button" onclick={() => logoMode = 'url'}
								class="px-3 py-1 rounded text-xs font-medium transition-colors {logoMode === 'url' ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}">
								URL
							</button>
							<button type="button" onclick={() => logoMode = 'file'}
								class="px-3 py-1 rounded text-xs font-medium transition-colors {logoMode === 'file' ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}">
								Fichier PC
							</button>
						</div>
						{#if logoMode === 'url'}
							<input type="url" bind:value={logoUrl} placeholder="https://..." class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
						{:else}
							<label class="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border border-dashed border-gray-600 hover:border-indigo-500 transition-colors text-sm text-gray-400 hover:text-white">
								{#if uploadingLogo}
									<span>Envoi en cours…</span>
								{:else}
									<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
									<span>Choisir une image</span>
								{/if}
								<input type="file" accept="image/*" class="hidden" onchange={handleLogoFile} disabled={uploadingLogo} />
							</label>
						{/if}
						<input type="hidden" name="logo_url" value={logoUrl} />
					</div>
				</div>
			</div>

			<!-- Banner -->
			<div class="mb-6">
				<label class="block text-sm font-medium text-gray-300 mb-2">Bannière du forum</label>
				<div class="space-y-2">
					<!-- Preview -->
					{#if bannerUrl}
						<div class="w-full h-24 rounded-xl overflow-hidden border border-gray-700 relative">
							<img src={bannerUrl} alt="Bannière" class="w-full h-full object-cover" />
							<div class="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent flex items-center px-4">
								<span class="text-white font-bold text-sm">{i.name}</span>
							</div>
						</div>
					{:else}
						<div class="w-full h-24 rounded-xl border border-dashed border-gray-700 bg-gray-800/40 flex items-center justify-center text-gray-600 text-sm">
							Aucune bannière définie
						</div>
					{/if}
					<!-- Toggle -->
					<div class="flex gap-2">
						<button type="button" onclick={() => bannerMode = 'url'}
							class="px-3 py-1 rounded text-xs font-medium transition-colors {bannerMode === 'url' ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}">
							URL
						</button>
						<button type="button" onclick={() => bannerMode = 'file'}
							class="px-3 py-1 rounded text-xs font-medium transition-colors {bannerMode === 'file' ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}">
							Fichier PC
						</button>
						{#if bannerUrl}
							<button type="button" onclick={() => bannerUrl = ''} class="ml-auto px-3 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors">
								Supprimer
							</button>
						{/if}
					</div>
					{#if bannerMode === 'url'}
						<input type="url" bind:value={bannerUrl} placeholder="https://..." class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
					{:else}
						<label class="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border border-dashed border-gray-600 hover:border-indigo-500 transition-colors text-sm text-gray-400 hover:text-white">
							{#if uploadingBanner}
								<span>Envoi en cours…</span>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
								<span>Choisir une image</span>
							{/if}
							<input type="file" accept="image/*" class="hidden" onchange={handleBannerFile} disabled={uploadingBanner} />
						</label>
					{/if}
					<input type="hidden" name="banner_url" value={bannerUrl} />
				</div>
			</div>

			<button type="submit" class="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">
				Sauvegarder le branding
			</button>
		</form>
	</div>

	<!-- ── Identity ─────────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-6 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5">Identité de la communauté</h2>
		<div class="space-y-4">
			{#each [
				{ key: 'NEXUS_COMMUNITY_NAME',        label: 'Nom',        value: i.name,        desc: 'Affiché dans la navbar et la Galaxy Bar' },
				{ key: 'NEXUS_COMMUNITY_DESCRIPTION', label: 'Description', value: i.description, desc: 'Sous-titre de la homepage et méta SEO' },
				{ key: 'NEXUS_COMMUNITY_SLUG',        label: 'Slug',       value: i.slug,        desc: 'Identifiant URL, correspond à la communauté en base' },
				{ key: 'NEXUS_COMMUNITY_LANGUAGE',    label: 'Langue',     value: i.language,    desc: 'Code ISO 639-1 (ex: fr, en, de)' },
				{ key: 'NEXUS_COMMUNITY_COUNTRY',     label: 'Pays',       value: i.country,     desc: 'Code ISO 3166-1 alpha-2 (ex: FR, US, DE)' },
			] as field}
				<div class="flex items-start gap-4">
					<div class="w-44 shrink-0">
						<p class="text-sm font-medium text-gray-300">{field.label}</p>
						<p class="text-xs text-gray-600 font-mono mt-0.5">{field.key}</p>
					</div>
					<div class="flex-1">
						<div class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 font-mono">
							{#if field.value}
								{field.value}
							{:else}
								<span class="text-gray-600 font-sans italic">non défini</span>
							{/if}
						</div>
						<p class="text-xs text-gray-600 mt-1">{field.desc}</p>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- ── Live stats ───────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-6 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5">Statistiques en direct</h2>
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
			{#each [
				{ label: 'Membres',  value: i.member_count },
				{ label: 'En ligne', value: i.online_count },
				{ label: 'Fils',     value: i.thread_count },
				{ label: 'Messages', value: i.post_count },
			] as stat}
				<div class="text-center p-3 rounded-lg bg-gray-800/60 border border-gray-700">
					<div class="text-2xl font-bold text-white">{stat.value}</div>
					<div class="text-xs text-gray-500 mt-0.5">{stat.label}</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- ── Network ──────────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-6 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5">Réseau P2P</h2>
		<div class="space-y-3 text-sm">
			{#each [
				{ label: 'Phase réseau actuelle',    value: 'Phase 1 — Serveur officiel', highlight: true },
				{ label: 'Enregistrement annuaire',  value: 'non implémenté — Phase 2', highlight: false },
				{ label: 'WireGuard mesh',           value: 'non implémenté — Phase 3', highlight: false },
				{ label: 'Sous-domaine nexus.io',    value: 'non implémenté — Phase 2', highlight: false },
			] as row}
				<div class="flex items-center justify-between">
					<span class="text-gray-400">{row.label}</span>
					<span class="text-xs px-2.5 py-1 rounded {row.highlight ? 'bg-indigo-900/60 text-indigo-300 border border-indigo-800/60' : 'text-gray-600 bg-gray-800 border border-gray-700'}">
						{row.value}
					</span>
				</div>
			{/each}
		</div>
	</div>

	<!-- ── How to edit ──────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-5">
		<h3 class="text-sm font-semibold text-indigo-300 mb-2">Modifier la configuration</h3>
		<p class="text-xs text-gray-400 mb-3">
			Éditez le fichier <code class="text-indigo-400">.env</code> à la racine du projet, puis redémarrez le serveur :
		</p>
		<pre class="text-xs text-gray-300 bg-gray-900 rounded-lg p-4 overflow-x-auto border border-gray-800">NEXUS_COMMUNITY_NAME=Ma Communauté
NEXUS_COMMUNITY_DESCRIPTION=Description...
NEXUS_COMMUNITY_LANGUAGE=fr
NEXUS_COMMUNITY_COUNTRY=FR
NEXUS_COMMUNITY_SLUG=ma-communaute</pre>
	</div>
</div>
