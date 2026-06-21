<script lang="ts">
	import type { PageData, ActionData } from './$types'
	import { enhance } from '$app/forms'
	import { page } from '$app/stores'
	import { onMount, untrack } from 'svelte'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const i = untrack(() => data.instance)

	// Branding state
	let logoUrl   = $state<string>(i.logo_url   ?? '')
	let bannerUrl = $state<string>(i.banner_url ?? '')

	// SMTP state
	let smtp = $state<{ configured: boolean; host: string | null; port: number; from: string | null } | null>(null)
	let smtpTestTo      = $state('')
	let smtpTesting     = $state(false)
	let smtpTestResult  = $state<{ ok: boolean; message: string } | null>(null)

	// ── Config éditable (spec 017 — settings DB, plus besoin de SSH) ───────────
	type CfgField = {
		key: string; group: string; type: string; tier: number; secret: boolean
		labelFr: string; helpFr?: string; enumValues?: string[]; placeholder?: string
		value?: string; isSet?: boolean
	}
	let cfg           = $state<CfgField[] | null>(null)
	let cfgValues     = $state<Record<string, string>>({})
	let cfgErrors     = $state<Record<string, string>>({})
	let cfgSaving     = $state(false)
	let cfgSaved      = $state(false)
	let cfgRestart    = $state(false)
	let secretShown   = $state<Record<string, boolean>>({})   // œil : afficher la saisie en clair
	let secretTouched = $state<Record<string, boolean>>({})   // n'envoyer que les secrets modifiés

	// Test Twitch
	let twitchTesting    = $state(false)
	let twitchTestResult = $state<{ ok: boolean; message: string } | null>(null)

	const cfgByGroup = $derived(
		(cfg ?? []).reduce<Record<string, CfgField[]>>((acc, f) => {
			(acc[f.group] ??= []).push(f); return acc
		}, {})
	)
	const GROUP_LABELS: Record<string, string> = {
		identity:     "Identité de l'instance",
		federation:   'Fédération',
		email:        'Email (SMTP)',
		integrations: 'Intégrations',
		streamer:     'Streamer Hub (Twitch)',
		security:     'Sécurité & modération',
	}
	const GROUP_ORDER = ['identity', 'federation', 'email', 'integrations', 'streamer', 'security']

	// Génère une clé 64 hex côté navigateur pour STREAMER_OAUTH_KEY.
	function generateHexKey(key: string) {
		const bytes = new Uint8Array(32)
		crypto.getRandomValues(bytes)
		cfgValues[key] = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
		secretTouched[key] = true
		secretShown[key] = true   // on l'affiche une fois pour que l'admin voie que c'est rempli
	}
	const orderedGroups = $derived(
		GROUP_ORDER.filter(g => cfgByGroup[g]?.length).map(g => [g, cfgByGroup[g]] as const)
	)

	function markSecretTouched(key: string) { secretTouched[key] = true }
	function clearSecret(key: string) {
		cfgValues[key] = ''
		secretTouched[key] = true   // envoi d'une valeur vide => retrait côté serveur
	}

	onMount(async () => {
		const token = ($page.data as any).token as string | null
		if (!token) return
		try {
			const res = await fetch('/api/v1/admin/smtp/status', {
				headers: { Authorization: `Bearer ${token}` }
			})
			if (res.ok) smtp = await res.json()
		} catch {}
		await loadCfg(token)
	})

	async function loadCfg(token: string) {
		try {
			const res = await fetch('/api/v1/admin/settings', {
				headers: { Authorization: `Bearer ${token}` }
			})
			if (res.ok) {
				const json = await res.json()
				cfg = json.settings as CfgField[]
				const init: Record<string, string> = {}
				// Les secrets ne sont jamais préremplis : champ vide, on affiche juste "défini".
				for (const f of cfg) init[f.key] = f.secret ? '' : (f.value ?? '')
				cfgValues = init
				secretTouched = {}
			}
		} catch {}
	}

	async function saveConfig() {
		const token = ($page.data as any).token as string | null
		if (!token || !cfg) return
		cfgSaving = true
		cfgSaved = false
		cfgErrors = {}
		const updates: Record<string, string> = {}
		for (const f of cfg) {
			if (f.secret) {
				// On n'envoie un secret QUE si l'admin l'a modifié (saisie ou retrait).
				if (secretTouched[f.key]) updates[f.key] = cfgValues[f.key] ?? ''
			} else {
				updates[f.key] = cfgValues[f.key] ?? ''
			}
		}
		try {
			const res = await fetch('/api/v1/admin/settings', {
				method: 'PUT',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ updates }),
			})
			const json = await res.json()
			if (res.ok) {
				cfgSaved = true
				cfgRestart = !!json.restartRequired
				await loadCfg(token)   // rafraîchit l'état "défini" des secrets
				setTimeout(() => { cfgSaved = false }, 3000)
			} else {
				cfgErrors = json.errors ?? {}
			}
		} catch {
			cfgErrors = { _global: 'Impossible de contacter le serveur' }
		} finally {
			cfgSaving = false
		}
	}

	async function testTwitch() {
		const token = ($page.data as any).token as string | null
		if (!token) return
		twitchTesting = true
		twitchTestResult = null
		try {
			const res = await fetch('/api/v1/admin/settings/test/twitch', {
				method: 'POST', headers: { Authorization: `Bearer ${token}` },
			})
			const json = await res.json()
			twitchTestResult = { ok: !!json.ok, message: json.message ?? (json.ok ? 'OK' : 'Échec') }
		} catch {
			twitchTestResult = { ok: false, message: 'Impossible de contacter le serveur' }
		} finally {
			twitchTesting = false
		}
	}

	async function sendSmtpTest() {
		const token = ($page.data as any).token as string | null
		if (!token || !smtpTestTo.trim()) return
		smtpTesting = true
		smtpTestResult = null
		try {
			const res = await fetch('/api/v1/admin/smtp/test', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ to: smtpTestTo.trim() })
			})
			const json = await res.json()
			smtpTestResult = res.ok
				? { ok: true,  message: json.message ?? 'Email envoyé !' }
				: { ok: false, message: json.error   ?? 'Erreur inconnue' }
		} catch {
			smtpTestResult = { ok: false, message: 'Impossible de contacter le serveur' }
		} finally {
			smtpTesting = false
		}
	}

	let logoMode   = $state<'url' | 'file'>('url')
	let bannerMode = $state<'url' | 'file'>('url')
	let uploadingLogo   = $state(false)
	let uploadingBanner = $state(false)

	async function uploadBrandingFile(type: 'logo' | 'banner', file: File) {
		const token = ($page.data as any).token as string | null
		if (!token) return

		const fd = new FormData()
		fd.append('file', file)
		const res = await fetch(`/api/v1/admin/branding/upload?type=${type}`, {
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
		logoMode = 'url'
	}

	async function handleBannerFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		uploadingBanner = true
		await uploadBrandingFile('banner', file)
		uploadingBanner = false
		bannerMode = 'url'
	}
</script>

<svelte:head><title>Paramètres — Admin Nodyx</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-2">Paramètres de l'instance</h1>
	<p class="text-sm text-gray-500 mb-8">
		Configuration et identité visuelle de votre communauté Nodyx.
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
				<span class="block text-sm font-medium text-gray-300 mb-2">Logo de l'instance</span>
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
				<span class="block text-sm font-medium text-gray-300 mb-2">Bannière du forum</span>
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

	<!-- ── Config éditable (identité + fédération) ──────────────────────────── -->
	{#if cfg === null}
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-6 mb-5 text-sm text-gray-600">Chargement de la configuration…</div>
	{:else}
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-6 mb-5">
			{#each orderedGroups as [group, fields]}
				<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1 {group !== 'identity' ? 'mt-8' : ''}">{GROUP_LABELS[group] ?? group}</h2>
				<p class="text-xs text-gray-600 mb-5">Modifiable directement ici, plus besoin d'éditer le .env en SSH.</p>
				<div class="space-y-4">
					{#each fields as f (f.key)}
						<div class="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
							<div class="sm:w-48 sm:shrink-0 sm:pt-2">
								<p class="text-sm font-medium text-gray-300">{f.labelFr}</p>
								<p class="text-xs text-gray-600 font-mono mt-0.5">{f.key}</p>
							</div>
							<div class="flex-1">
								{#if f.type === 'boolean'}
									<label class="inline-flex items-center gap-2 cursor-pointer select-none">
										<input type="checkbox"
											checked={cfgValues[f.key] === 'true'}
											onchange={(e) => cfgValues[f.key] = (e.target as HTMLInputElement).checked ? 'true' : 'false'}
											class="w-4 h-4 rounded accent-indigo-600" />
										<span class="text-sm text-gray-300">{cfgValues[f.key] === 'true' ? 'Activé' : 'Désactivé'}</span>
									</label>
								{:else if f.type === 'enum'}
									<select bind:value={cfgValues[f.key]}
										class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
										{#each f.enumValues ?? [] as opt}<option value={opt}>{opt}</option>{/each}
									</select>
								{:else if f.type === 'multiline'}
									<textarea bind:value={cfgValues[f.key]} rows="2" placeholder={f.placeholder ?? ''}
										class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"></textarea>
								{:else if f.type === 'secret'}
									<div class="flex gap-2 items-center">
										<input
											type={secretShown[f.key] ? 'text' : 'password'}
											bind:value={cfgValues[f.key]}
											oninput={() => markSecretTouched(f.key)}
											autocomplete="off"
											placeholder={f.isSet ? 'Saisir une nouvelle valeur pour remplacer' : 'non défini'}
											class="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
										<!-- L'œil révèle uniquement ce que vous tapez (un secret stocké n'est jamais renvoyé). -->
										<button type="button" onclick={() => secretShown[f.key] = !secretShown[f.key]}
											disabled={!cfgValues[f.key]}
											aria-label={secretShown[f.key] ? 'Masquer' : 'Afficher'} title={cfgValues[f.key] ? (secretShown[f.key] ? 'Masquer la saisie' : 'Afficher la saisie') : 'Rien à afficher'}
											class="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
											{#if secretShown[f.key]}
												<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>
											{:else}
												<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
											{/if}
										</button>
										{#if f.key === 'STREAMER_OAUTH_KEY'}
											<button type="button" onclick={() => generateHexKey(f.key)} title="Générer une clé aléatoire"
												class="px-3 py-2 rounded-lg text-xs bg-indigo-700/40 border border-indigo-600/50 text-indigo-200 hover:bg-indigo-700/60 transition-colors shrink-0">
												Générer
											</button>
										{/if}
										{#if f.isSet}
											<span class="text-[11px] px-2 py-1 rounded bg-green-900/30 border border-green-800/50 text-green-400 shrink-0">défini</span>
											<button type="button" onclick={() => clearSecret(f.key)} title="Retirer ce secret"
												class="px-3 py-2 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors shrink-0">
												Retirer
											</button>
										{/if}
									</div>
									{#if f.isSet}
										<p class="text-[11px] text-amber-500/80 mt-1">Une clé enregistrée n'est jamais réaffichée (sécurité). Laissez vide pour la conserver, saisissez-en une nouvelle pour la remplacer, ou Retirer pour l'effacer.</p>
									{/if}
								{:else}
									<input type={f.type === 'number' ? 'number' : 'text'} bind:value={cfgValues[f.key]} placeholder={f.placeholder ?? ''}
										class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
								{/if}
								{#if f.helpFr}<p class="text-xs text-gray-600 mt-1">{f.helpFr}</p>{/if}
								{#if cfgErrors[f.key]}<p class="text-xs text-red-400 mt-1">{cfgErrors[f.key]}</p>{/if}
							</div>
						</div>
					{/each}
				</div>
			{/each}

			<!-- Test de connexion Twitch (utilise les identifiants enregistrés) -->
			{#if cfg.some(f => f.key === 'TWITCH_CLIENT_ID')}
				<div class="mt-4 flex flex-wrap items-center gap-3">
					<button type="button" onclick={testTwitch} disabled={twitchTesting}
						class="px-4 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-indigo-500 disabled:opacity-50 text-xs font-medium text-gray-200 transition-colors">
						{twitchTesting ? 'Test en cours…' : 'Tester la connexion Twitch'}
					</button>
					<span class="text-[11px] text-gray-600">Enregistrez d'abord, puis testez.</span>
					{#if twitchTestResult}
						<span class="text-sm {twitchTestResult.ok ? 'text-green-400' : 'text-red-400'}">
							{twitchTestResult.ok ? '✓' : '✕'} {twitchTestResult.message}
						</span>
					{/if}
				</div>
			{/if}

			<!-- Slug : géré en .env pour l'instant (lié à la résolution de la communauté en base) -->
			<div class="mt-6 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
				<div class="sm:w-48 sm:shrink-0">
					<p class="text-sm font-medium text-gray-500">Slug</p>
					<p class="text-xs text-gray-600 font-mono mt-0.5">NODYX_COMMUNITY_SLUG</p>
				</div>
				<div class="flex-1">
					<div class="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2 text-sm text-gray-400 font-mono">{i.slug || '—'}</div>
					<p class="text-xs text-gray-600 mt-1">Identifiant URL lié à la communauté en base. Reste géré dans le .env pour éviter toute désynchronisation.</p>
				</div>
			</div>

			{#if cfgErrors._global}
				<p class="mt-5 text-sm text-red-400 bg-red-900/30 border border-red-800/50 rounded-lg px-4 py-2">{cfgErrors._global}</p>
			{/if}
			{#if cfgSaved}
				<p class="mt-5 text-sm text-green-400 bg-green-900/30 border border-green-800/50 rounded-lg px-4 py-2">
					Configuration enregistrée ✓ {cfgRestart ? '— un redémarrage est requis pour certains réglages.' : '— appliqué immédiatement.'}
				</p>
			{/if}

			<button type="button" onclick={saveConfig} disabled={cfgSaving}
				class="mt-6 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors">
				{cfgSaving ? 'Enregistrement…' : 'Enregistrer la configuration'}
			</button>
		</div>
	{/if}

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
				{ label: 'Sous-domaine nodyx.io',    value: 'non implémenté — Phase 2', highlight: false },
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

	<!-- ── Email (SMTP) ─────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-6 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Email (SMTP)</h2>
		<p class="text-xs text-gray-600 mb-5">Utilisé pour les réinitialisations de mot de passe. Optionnel.</p>

		{#if smtp === null}
			<p class="text-xs text-gray-600">Chargement…</p>
		{:else}
			<!-- Statut -->
			<div class="flex items-center gap-3 mb-5">
				<span class="w-2.5 h-2.5 rounded-full shrink-0 {smtp.configured ? 'bg-green-500' : 'bg-gray-600'}"></span>
				<span class="text-sm {smtp.configured ? 'text-green-400' : 'text-gray-500'}">
					{smtp.configured ? 'SMTP configuré' : 'Non configuré — réinitialisation manuelle uniquement'}
				</span>
			</div>

			{#if smtp.configured}
				<!-- Infos -->
				<div class="space-y-2 mb-5 text-sm">
					<div class="flex items-center justify-between">
						<span class="text-gray-400">Serveur</span>
						<span class="font-mono text-xs text-gray-200">{smtp.host}:{smtp.port}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-gray-400">Expéditeur</span>
						<span class="font-mono text-xs text-gray-200">{smtp.from ?? '—'}</span>
					</div>
				</div>

				<!-- Test -->
				<div class="flex gap-2">
					<input
						type="email"
						bind:value={smtpTestTo}
						placeholder="votre@email.com"
						class="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
					/>
					<button
						onclick={sendSmtpTest}
						disabled={smtpTesting || !smtpTestTo.trim()}
						class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors shrink-0"
					>
						{smtpTesting ? 'Envoi…' : 'Tester'}
					</button>
				</div>

				{#if smtpTestResult}
					<p class="mt-3 text-sm rounded-lg px-4 py-2.5 {smtpTestResult.ok
						? 'bg-green-900/30 border border-green-800/50 text-green-400'
						: 'bg-red-900/30 border border-red-800/50 text-red-400'}">
						{smtpTestResult.message}
					</p>
				{/if}
			{:else}
				<!-- Non configuré — aide -->
				<div class="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3 text-xs text-gray-400 space-y-1">
					<p>Sans SMTP, tu peux générer un lien de reset depuis <strong class="text-gray-300">Admin → Membres</strong> et l'envoyer manuellement.</p>
					<p>Pour configurer : ajoute <code class="text-indigo-400">SMTP_HOST</code>, <code class="text-indigo-400">SMTP_USER</code> et <code class="text-indigo-400">SMTP_PASS</code> dans ton fichier <code class="text-indigo-400">.env</code>, puis redémarre Nodyx.</p>
					<p class="mt-2"><a href="https://github.com/Pokled/Nodyx/blob/main/docs/fr/EMAIL.md" target="_blank" rel="noopener" class="text-indigo-400 underline">Voir le guide complet →</a></p>
				</div>
			{/if}
		{/if}
	</div>

	<!-- ── Reste de la config ───────────────────────────────────────────────── -->
	<div class="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-5">
		<h3 class="text-sm font-semibold text-indigo-300 mb-2">Le reste de la configuration</h3>
		<p class="text-xs text-gray-400">
			L'identité et la fédération sont désormais éditables directement ci-dessus, sans toucher au <code class="text-indigo-400">.env</code>.
			Les intégrations avec secrets (SMTP, Twitch, push, etc.) arrivent dans l'interface dans une prochaine étape ;
			pour l'instant elles restent dans le <code class="text-indigo-400">.env</code>. Les variables vitales (base de données, JWT) y restent volontairement.
		</p>
	</div>
</div>
