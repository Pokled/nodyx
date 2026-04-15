<script lang="ts">
	import { PLUGIN_LIST } from '$lib/components/homepage/plugins';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	// ── Types ────────────────────────────────────────────────────────────────
	interface InstalledWidget {
		id:           string
		manifest:     WidgetManifest
		enabled:      boolean
		installed_at: string
		updated_at:   string
	}
	interface WidgetManifest {
		id:          string
		label:       string
		version:     string
		author?:     string
		icon?:       string
		family?:     string
		description?: string
		entry:       string
		schema?:     unknown[]
	}

	// ── State ────────────────────────────────────────────────────────────────
	let installed    = $state<InstalledWidget[]>([])
	let loadingList  = $state(true)

	// Upload state
	type InstallStep = 'idle' | 'uploading' | 'validating' | 'extracting' | 'registering' | 'done' | 'error'
	let step         = $state<InstallStep>('idle')
	let uploadPct    = $state(0)
	let errorMsg     = $state('')
	let lastInstalled = $state<InstalledWidget | null>(null)
	let dragging     = $state(false)

	// Toasts
	let toasts = $state<{ id: number; text: string; ok: boolean }[]>([])
	let toastId = 0
	function toast(text: string, ok = true) {
		const id = ++toastId
		toasts = [...toasts, { id, text, ok }]
		setTimeout(() => { toasts = toasts.filter(t => t.id !== id) }, 3500)
	}

	// ── Constants ────────────────────────────────────────────────────────────
	const FAMILY_COLORS: Record<string, string> = {
		media: '#a78bfa', gaming: '#06b6d4', community: '#4ade80',
		esport: '#f97316', social: '#3b82f6', content: '#94a3b8',
	}
	const FAMILY_LABELS: Record<string, string> = {
		media: 'Média', gaming: 'Gaming', community: 'Communauté',
		esport: 'Esport', social: 'Social', content: 'Contenu',
	}
	const PHASE_LABELS: Record<number, string> = {
		1: 'Phase 1 — Disponibles',
		2: 'Phase 2 — Prochainement',
		3: 'Phase 3 — En roadmap',
		4: 'Phase 4 — Futur',
		5: 'Phase 5 — Expérimental',
	}
	const byPhase = $derived(() => {
		const m: Record<number, typeof PLUGIN_LIST> = {}
		for (const p of PLUGIN_LIST) { if (!m[p.phase]) m[p.phase] = []; m[p.phase].push(p) }
		return m
	})

	const INSTALL_STEPS: { key: InstallStep; label: string; sub: string }[] = [
		{ key: 'uploading',    label: 'Envoi du fichier',          sub: 'Transfert vers le serveur...' },
		{ key: 'validating',   label: 'Validation du manifest',    sub: 'Vérification id, version, entry...' },
		{ key: 'extracting',   label: 'Extraction des fichiers',   sub: 'Décompression et filtrage sécurisé...' },
		{ key: 'registering',  label: 'Enregistrement',            sub: 'Activation en base de données...' },
	]

	function stepIndex(s: InstallStep): number {
		return INSTALL_STEPS.findIndex(x => x.key === s)
	}

	// ── Fetch installed ──────────────────────────────────────────────────────
	function getToken() { return ($page.data as any).token as string ?? '' }

	async function loadInstalled() {
		loadingList = true
		try {
			const res = await fetch('/api/v1/admin/widget-store', {
				headers: { Authorization: `Bearer ${getToken()}` }
			})
			if (res.ok) {
				const json = await res.json()
				installed = json.widgets ?? []
			}
		} finally {
			loadingList = false
		}
	}

	onMount(() => { loadInstalled() })

	// ── Upload via XHR (pour avoir la progression) ───────────────────────────
	function installWidget(file: File) {
		if (!file.name.endsWith('.zip')) {
			step = 'error'
			errorMsg = 'Le fichier doit être une archive .zip'
			return
		}
		if (file.size > 12 * 1024 * 1024) {
			step = 'error'
			errorMsg = 'Fichier trop lourd (max 12 Mo)'
			return
		}

		step = 'uploading'
		uploadPct = 0
		errorMsg = ''
		lastInstalled = null

		const fd = new FormData()
		fd.append('file', file)

		const xhr = new XMLHttpRequest()

		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable) {
				uploadPct = Math.round((e.loaded / e.total) * 100)
				// Simuler les étapes suivantes au fur et à mesure
				if (uploadPct === 100) {
					setTimeout(() => { if (step === 'uploading') step = 'validating' }, 200)
					setTimeout(() => { if (step === 'validating') step = 'extracting' }, 700)
					setTimeout(() => { if (step === 'extracting') step = 'registering' }, 1200)
				}
			}
		})

		xhr.addEventListener('load', () => {
			if (xhr.status === 201) {
				try {
					const json = JSON.parse(xhr.responseText)
					lastInstalled = {
						id:           json.id,
						manifest:     json.manifest,
						enabled:      true,
						installed_at: new Date().toISOString(),
						updated_at:   new Date().toISOString(),
					}
					// Mettre à jour la liste locale
					const existing = installed.findIndex(w => w.id === json.id)
					if (existing !== -1) installed[existing] = lastInstalled
					else installed = [lastInstalled, ...installed]
					step = 'done'
				} catch {
					step = 'error'
					errorMsg = 'Réponse serveur invalide'
				}
			} else {
				step = 'error'
				try {
					const json = JSON.parse(xhr.responseText)
					errorMsg = json.error ?? `Erreur ${xhr.status}`
				} catch {
					errorMsg = `Erreur serveur (HTTP ${xhr.status})`
				}
			}
		})

		xhr.addEventListener('error', () => {
			step = 'error'
			errorMsg = 'Erreur réseau — vérifiez votre connexion'
		})

		xhr.addEventListener('timeout', () => {
			step = 'error'
			errorMsg = 'Délai d\'attente dépassé'
		})

		xhr.timeout = 30000
		xhr.open('POST', '/api/v1/admin/widget-store/install')
		xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`)
		xhr.send(fd)
	}

	// ── Drag & Drop ──────────────────────────────────────────────────────────
	function onDrop(e: DragEvent) {
		dragging = false
		e.preventDefault()
		const file = e.dataTransfer?.files?.[0]
		if (file) installWidget(file)
	}
	function onFileInput(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (file) installWidget(file)
	}

	// ── Toggle / Delete ──────────────────────────────────────────────────────
	async function toggleWidget(w: InstalledWidget) {
		const res = await fetch(`/api/v1/admin/widget-store/${w.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
			body: JSON.stringify({ enabled: !w.enabled }),
		})
		if (res.ok) {
			installed = installed.map(x => x.id === w.id ? { ...x, enabled: !x.enabled } : x)
			toast(w.enabled ? 'Widget désactivé' : 'Widget activé')
		} else toast('Erreur', false)
	}

	async function deleteWidget(w: InstalledWidget) {
		const res = await fetch(`/api/v1/admin/widget-store/${w.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${getToken()}` },
		})
		if (res.ok) {
			installed = installed.filter(x => x.id !== w.id)
			toast('Widget désinstallé')
		} else toast('Erreur désinstallation', false)
	}

	function resetInstall() {
		step = 'idle'
		uploadPct = 0
		errorMsg = ''
	}

	// ── Démos ────────────────────────────────────────────────────────────────────
	interface DemoSource { manifest: string; js: string; entry: string }
	interface DemoEntry  { id: string; manifest: WidgetManifest }

	// Démos hardcodées — toujours visibles, pas besoin de fetch
	const BUILTIN_DEMOS: DemoEntry[] = [
		{
			id: 'video-player',
			manifest: {
				id:          'video-player',
				label:       'Lecteur Vidéo',
				version:     '1.0.0',
				author:      'Nodyx',
				icon:        '🎬',
				family:      'media',
				description: 'Lecteur universel — YouTube, Vimeo ou MP4 direct. Configurable depuis le builder.',
				entry:       'widget.iife.js',
				schema: [
					{ key: 'url',           type: 'text',     label: 'URL de la vidéo',    placeholder: 'https://youtube.com/watch?v=...' },
					{ key: 'title',         type: 'text',     label: 'Titre affiché',      placeholder: 'Ma vidéo' },
					{ key: 'autoplay',      type: 'checkbox', label: 'Lecture automatique' },
					{ key: 'show_controls', type: 'checkbox', label: 'Afficher les contrôles' },
				] as unknown as WidgetManifest['schema'],
			},
		},
	]

	let demos          = $state<DemoEntry[]>(BUILTIN_DEMOS)
	let demoModal      = $state<DemoEntry | null>(null)
	let demoSource     = $state<DemoSource | null>(null)
	let demoSourceLoad = $state(false)
	let demoTab        = $state<'preview' | 'manifest' | 'js'>('preview')
	let demoInstalling = $state(false)
	let demoInstalled  = $state<Set<string>>(new Set())

	async function loadDemos() {
		// enrichit éventuellement la liste depuis l'API (démos futures)
		try {
			const res = await fetch('/api/v1/admin/widget-store/demos', {
				headers: { Authorization: `Bearer ${getToken()}` }
			})
			if (res.ok) {
				const j = await res.json()
				// Fusionner : garder les démos builtin + ajouter les nouvelles éventuelles
				const ids = new Set(BUILTIN_DEMOS.map(d => d.id))
				const extra = (j.demos ?? []).filter((d: DemoEntry) => !ids.has(d.id))
				if (extra.length > 0) demos = [...BUILTIN_DEMOS, ...extra]
			}
		} catch {}
	}

	async function openDemoModal(demo: DemoEntry) {
		demoModal  = demo
		demoTab    = 'preview'
		demoSource = null
		demoSourceLoad = true

		try {
			const res = await fetch(`/api/v1/admin/widget-store/demo/${demo.id}/source`, {
				headers: { Authorization: `Bearer ${getToken()}` }
			})
			if (res.ok) demoSource = await res.json()
		} finally { demoSourceLoad = false }

		// Inject widget JS into page so preview can render it
		if (demoSource && !customElements.get(`nodyx-widget-${demo.id}`)) {
			const blob = new Blob([demoSource.js], { type: 'application/javascript' })
			const url  = URL.createObjectURL(blob)
			const el   = document.createElement('script')
			el.src = url
			el.onload = () => URL.revokeObjectURL(url)
			document.head.appendChild(el)
		}
	}

	async function installDemo(id: string) {
		demoInstalling = true
		try {
			const res = await fetch(`/api/v1/admin/widget-store/demo/${id}/install`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${getToken()}` }
			})
			if (res.ok) {
				const json = await res.json()
				demoInstalled = new Set([...demoInstalled, id])
				const w: InstalledWidget = {
					id:           json.id,
					manifest:     json.manifest,
					enabled:      true,
					installed_at: new Date().toISOString(),
					updated_at:   new Date().toISOString(),
				}
				const idx = installed.findIndex(x => x.id === id)
				if (idx !== -1) installed[idx] = w
				else installed = [w, ...installed]
				toast(`Widget "${json.manifest.label}" installé !`)
			} else {
				const j = await res.json().catch(() => ({}))
				toast(j.error ?? 'Erreur installation', false)
			}
		} finally { demoInstalling = false }
	}

	// Vérifie si déjà installé (au chargement)
	const installedIds = $derived(new Set(installed.map(w => w.id)))

	async function downloadZip(id: string, filename: string) {
		const res = await fetch(`/api/v1/admin/widget-store/demo/${id}/zip`, {
			headers: { Authorization: `Bearer ${getToken()}` }
		})
		if (!res.ok) { toast('Erreur téléchargement', false); return }
		const blob = await res.blob()
		const url  = URL.createObjectURL(blob)
		const a    = document.createElement('a')
		a.href = url; a.download = filename
		document.body.appendChild(a); a.click()
		document.body.removeChild(a); URL.revokeObjectURL(url)
	}

	onMount(() => { loadDemos() })
</script>

<svelte:head><title>Widgets — Admin</title></svelte:head>

<!-- Toasts -->
<div class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
	{#each toasts as t (t.id)}
		<div class="px-4 py-2.5 text-sm font-medium text-white pointer-events-auto"
		     style="background:{t.ok ? '#166534' : '#7f1d1d'}; border:1px solid {t.ok ? '#16a34a' : '#dc2626'}">
			{t.text}
		</div>
	{/each}
</div>

<div class="min-h-screen p-6" style="background:#05050a; color:#e2e8f0">

	<!-- Header -->
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-2xl font-black" style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#a78bfa,#06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text">
				Widget Store
			</h1>
			<p class="text-sm mt-1" style="color:#6b7280">
				{PLUGIN_LIST.filter(p => p.phase === 1).length} natifs · {installed.length} installés · {PLUGIN_LIST.length} en roadmap
			</p>
		</div>
		<a href="/admin/homepage"
		   class="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-wider transition-all"
		   style="background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(6,182,212,.15)); border:1px solid rgba(124,58,237,.4); color:#a78bfa">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
			</svg>
			Ouvrir le builder
		</a>
	</div>

	<div class="grid grid-cols-1 xl:grid-cols-3 gap-6">

		<!-- ── Col gauche : installer + installés ── -->
		<div class="xl:col-span-1 flex flex-col gap-4">

			<!-- Zone d'installation -->
			<div style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">
				<div class="px-4 py-3 flex items-center gap-2" style="border-bottom:1px solid rgba(255,255,255,.05)">
					<span class="text-base">📦</span>
					<span class="font-bold text-sm text-white">Installer un widget</span>
				</div>

				<div class="p-4">
					{#if step === 'idle'}
						<!-- Drag & drop zone -->
						<div
							role="button"
							tabindex="0"
							class="relative flex flex-col items-center justify-center gap-3 py-8 px-4 transition-all cursor-pointer"
							style="border:2px dashed {dragging ? 'rgba(124,58,237,.6)' : 'rgba(255,255,255,.08)'}; background:{dragging ? 'rgba(124,58,237,.05)' : 'transparent'}"
							ondragover={(e) => { e.preventDefault(); dragging = true }}
							ondragleave={() => dragging = false}
							ondrop={onDrop}
							onclick={() => document.getElementById('widget-file-input')?.click()}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('widget-file-input')?.click() }}
						>
							<div class="w-12 h-12 rounded-full flex items-center justify-center"
							     style="background:rgba(124,58,237,.1); border:1px solid rgba(124,58,237,.2)">
								<svg class="w-6 h-6" fill="none" stroke="#a78bfa" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
								</svg>
							</div>
							<div class="text-center">
								<p class="text-sm font-semibold text-white">Glissez votre .zip ici</p>
								<p class="text-xs mt-1" style="color:#4b5563">ou cliquez pour sélectionner</p>
							</div>
							<div class="flex items-center gap-1.5 px-2.5 py-1 text-xs"
							     style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); color:#4b5563">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
								</svg>
								Fichiers .js .css .png .svg uniquement extraits
							</div>
							<input
								id="widget-file-input"
								type="file"
								accept=".zip"
								class="hidden"
								onchange={onFileInput}
							/>
						</div>

					{:else if step === 'done'}
						<!-- Succès -->
						<div class="flex flex-col gap-4">
							<div class="flex flex-col items-center gap-2 py-4">
								<div class="w-12 h-12 rounded-full flex items-center justify-center"
								     style="background:rgba(74,222,128,.1); border:1px solid rgba(74,222,128,.3)">
									<svg class="w-6 h-6" fill="none" stroke="#4ade80" stroke-width="2" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
									</svg>
								</div>
								<p class="font-bold text-sm" style="color:#4ade80">Installation réussie !</p>
							</div>
							{#if lastInstalled}
								<div class="flex items-center gap-3 px-3 py-2.5"
								     style="background:rgba(74,222,128,.05); border:1px solid rgba(74,222,128,.15)">
									<span class="text-xl">{lastInstalled.manifest.icon ?? '🧩'}</span>
									<div class="min-w-0">
										<p class="font-bold text-sm text-white truncate">{lastInstalled.manifest.label}</p>
										<p class="text-xs" style="color:#4b5563">v{lastInstalled.manifest.version} · {lastInstalled.id}</p>
									</div>
								</div>
							{/if}
							<button
								onclick={resetInstall}
								class="w-full py-2 text-xs font-bold uppercase tracking-wider transition-all"
								style="border:1px solid rgba(255,255,255,.08); color:#6b7280"
							>
								Installer un autre widget
							</button>
						</div>

					{:else if step === 'error'}
						<!-- Erreur -->
						<div class="flex flex-col gap-4">
							<div class="flex flex-col items-center gap-2 py-4">
								<div class="w-12 h-12 rounded-full flex items-center justify-center"
								     style="background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3)">
									<svg class="w-6 h-6" fill="none" stroke="#ef4444" stroke-width="2" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
									</svg>
								</div>
								<p class="font-bold text-sm" style="color:#ef4444">Échec de l'installation</p>
							</div>
							<div class="px-3 py-2.5 text-sm leading-relaxed"
							     style="background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.2); color:#fca5a5">
								{errorMsg}
							</div>
							<button
								onclick={resetInstall}
								class="w-full py-2 text-xs font-bold uppercase tracking-wider transition-all"
								style="background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.2); color:#ef4444"
							>
								Réessayer
							</button>
						</div>

					{:else}
						<!-- En cours — étapes + barre de progression -->
						<div class="flex flex-col gap-4 py-2">

							<!-- Étapes -->
							<div class="flex flex-col gap-1">
								{#each INSTALL_STEPS as s, i}
									{@const current = stepIndex(step)}
									{@const isDone    = i < current}
									{@const isActive  = s.key === step}
									<div class="flex items-center gap-3 px-3 py-2 transition-all"
									     style="background:{isActive ? 'rgba(124,58,237,.08)' : 'transparent'}; border:1px solid {isActive ? 'rgba(124,58,237,.2)' : 'transparent'}">
										<!-- Icône étape -->
										<div class="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
										     style="background:{isDone ? 'rgba(74,222,128,.15)' : isActive ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)'}; border:1px solid {isDone ? 'rgba(74,222,128,.3)' : isActive ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.06)'}">
											{#if isDone}
												<svg class="w-2.5 h-2.5" fill="none" stroke="#4ade80" stroke-width="3" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
												</svg>
											{:else if isActive}
												<div class="w-2 h-2 rounded-full animate-pulse" style="background:#a78bfa"></div>
											{:else}
												<div class="w-1.5 h-1.5 rounded-full" style="background:rgba(255,255,255,.1)"></div>
											{/if}
										</div>
										<div class="min-w-0">
											<p class="text-xs font-semibold" style="color:{isDone ? '#4ade80' : isActive ? '#e2e8f0' : '#374151'}">{s.label}</p>
											{#if isActive}
												<p class="text-[10px] mt-0.5" style="color:#6b7280">{s.sub}</p>
											{/if}
										</div>
									</div>
								{/each}
							</div>

							<!-- Barre de progression (visible pendant upload) -->
							{#if step === 'uploading'}
								<div>
									<div class="flex items-center justify-between mb-1.5">
										<span class="text-xs" style="color:#4b5563">Transfert en cours</span>
										<span class="text-xs font-bold tabular-nums" style="color:#a78bfa">{uploadPct}%</span>
									</div>
									<div class="w-full h-1.5 rounded-full overflow-hidden" style="background:rgba(255,255,255,.06)">
										<div class="h-full rounded-full transition-all duration-300"
										     style="width:{uploadPct}%; background:linear-gradient(90deg,#7c3aed,#06b6d4)">
										</div>
									</div>
								</div>
							{:else}
								<!-- Barre indéterminée pour les étapes serveur -->
								<div class="w-full h-1.5 rounded-full overflow-hidden" style="background:rgba(255,255,255,.06)">
									<div class="h-full rounded-full" style="background:linear-gradient(90deg,#7c3aed,#06b6d4); animation:indeterminate 1.4s ease infinite">
									</div>
								</div>
							{/if}

						</div>
					{/if}
				</div>
			</div>

			<!-- Format attendu -->
			{#if step === 'idle'}
				<div class="p-4 text-xs" style="background:#0d0d12; border:1px solid rgba(255,255,255,.05); color:#374151">
					<p class="font-bold uppercase tracking-wider mb-2" style="color:#4b5563">Format attendu</p>
					<pre class="leading-relaxed" style="color:#4b5563">my-widget-1.0.0.zip
├── manifest.json  ← requis
├── widget.iife.js ← entry point
└── style.css      ← optionnel</pre>
					<div class="mt-3 pt-3" style="border-top:1px solid rgba(255,255,255,.04)">
						<p class="font-bold uppercase tracking-wider mb-1.5" style="color:#4b5563">manifest.json</p>
						<pre class="leading-relaxed" style="color:#374151">&#123;
  "id": "my-widget",
  "label": "Mon Widget",
  "version": "1.0.0",
  "author": "Vous",
  "icon": "🧩",
  "family": "content",
  "entry": "widget.iife.js",
  "schema": []
&#125;</pre>
					</div>
				</div>
			{/if}

			<!-- Widgets installés -->
			<div style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">
				<div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid rgba(255,255,255,.05)">
					<div class="flex items-center gap-2">
						<span class="text-base">🔌</span>
						<span class="font-bold text-sm text-white">Installés</span>
					</div>
					<span class="text-xs" style="color:#4b5563">{installed.length}</span>
				</div>

				{#if loadingList}
					<div class="px-4 py-8 flex items-center justify-center gap-2" style="color:#374151">
						<div class="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style="border-color:rgba(167,139,250,.3); border-top-color:#a78bfa"></div>
						<span class="text-xs">Chargement...</span>
					</div>
				{:else if installed.length === 0}
					<div class="px-4 py-8 text-center text-sm" style="color:#1f2937">
						Aucun widget installé pour l'instant.
					</div>
				{:else}
					<div class="divide-y" style="border-color:rgba(255,255,255,.04)">
						{#each installed as w (w.id)}
							<div class="flex items-center gap-3 px-4 py-3" class:opacity-50={!w.enabled}>
								<span class="text-lg shrink-0">{w.manifest.icon ?? '🧩'}</span>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="text-sm font-bold text-white truncate">{w.manifest.label}</span>
										<span class="text-[10px] font-mono" style="color:#374151">v{w.manifest.version}</span>
										{#if w.manifest.author}
											<span class="text-[10px]" style="color:#374151">· {w.manifest.author}</span>
										{/if}
									</div>
									<code class="text-[10px]" style="color:#374151">{w.id}</code>
								</div>
								<div class="flex items-center gap-1 shrink-0">
									<!-- Toggle -->
									<button
										onclick={() => toggleWidget(w)}
										class="w-7 h-7 flex items-center justify-center transition-colors"
										style="border:1px solid rgba(255,255,255,.08); color:{w.enabled ? '#4ade80' : '#6b7280'}"
										title={w.enabled ? 'Désactiver' : 'Activer'}
									>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
											<circle cx="12" cy="12" r="10"/>
											{#if w.enabled}
												<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/>
											{/if}
										</svg>
									</button>
									<!-- Delete -->
									<button
										onclick={() => deleteWidget(w)}
										class="w-7 h-7 flex items-center justify-center transition-colors"
										style="border:1px solid rgba(255,255,255,.08); color:#6b7280"
										title="Désinstaller"
										onmouseenter={e => (e.currentTarget as HTMLElement).style.color='#ef4444'}
										onmouseleave={e => (e.currentTarget as HTMLElement).style.color='#6b7280'}
									>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
										</svg>
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

		</div>

		<!-- ── Col droite : démos + catalogue natif ── -->
		<div class="xl:col-span-2 flex flex-col gap-6">

			<!-- Widgets de démonstration -->
			{#if demos.length > 0}
			<div style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">
				<div class="px-4 py-3 flex items-center gap-2" style="border-bottom:1px solid rgba(255,255,255,.05)">
					<span class="text-base">🎁</span>
					<span class="font-bold text-sm text-white">Widgets de démonstration</span>
					<span class="ml-1 text-xs px-1.5 py-0.5 font-bold"
					      style="background:rgba(6,182,212,.08); border:1px solid rgba(6,182,212,.18); color:#06b6d4">
						Prêts à installer
					</span>
					<span class="ml-auto text-xs" style="color:#374151">{demos.length} disponible{demos.length > 1 ? 's' : ''}</span>
				</div>

				<div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
					{#each demos as demo}
						{@const alreadyInstalled = installedIds.has(demo.id)}
						{@const color = FAMILY_COLORS[demo.manifest.family ?? ''] ?? '#6b7280'}
						<div class="flex flex-col gap-3 p-4 transition-all"
						     style="background:rgba(6,182,212,.025); border:1px solid rgba(6,182,212,.1)">

							<!-- Header -->
							<div class="flex items-start justify-between gap-2">
								<div class="flex items-center gap-2.5">
									<span class="text-2xl leading-none">{demo.manifest.icon ?? '🧩'}</span>
									<div>
										<p class="text-sm font-bold text-white">{demo.manifest.label}</p>
										<p class="text-[10px] font-mono mt-0.5" style="color:#374151">{demo.id} · v{demo.manifest.version}</p>
									</div>
								</div>
								<div class="flex items-center gap-2 shrink-0">
									<!-- Tooltip "Créer votre widget" -->
									<div class="relative group">
										<a
											href="https://nodyx.dev/create-widget"
											target="_blank"
											rel="noopener"
											class="flex items-center gap-1 px-2 py-1 text-[10px] font-bold transition-all"
											style="background:rgba(251,146,60,.08); border:1px solid rgba(251,146,60,.2); color:#fb923c"
										>
											<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/>
											</svg>
											Tuto
										</a>
										<!-- Tooltip bubble -->
										<div class="absolute right-0 top-full mt-2 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
										     style="width:220px">
											<div class="p-3 text-xs leading-relaxed"
											     style="background:#0d0d12; border:1px solid rgba(251,146,60,.25); box-shadow:0 8px 24px rgba(0,0,0,.4)">
												<p class="font-bold mb-1" style="color:#fb923c">Créez votre propre widget</p>
												<p style="color:#6b7280">Tuto pas à pas sur nodyx.dev — même sans expérience en code.</p>
												<p class="mt-2 font-bold text-[10px]" style="color:#374151">nodyx.dev → Documentation → Widget SDK</p>
											</div>
											<!-- Arrow -->
											<div class="absolute right-3 -top-1.5 w-3 h-3 rotate-45"
											     style="background:#0d0d12; border-left:1px solid rgba(251,146,60,.25); border-top:1px solid rgba(251,146,60,.25)"></div>
										</div>
									</div>
								</div>
								<div class="flex items-center gap-1 shrink-0">
									<span class="w-1.5 h-1.5 rounded-full" style="background:{color}"></span>
									<span class="text-[9px] font-bold uppercase" style="color:{color}">{FAMILY_LABELS[demo.manifest.family ?? ''] ?? demo.manifest.family}</span>
								</div>
							</div>

							<!-- Description -->
							{#if demo.manifest.description}
								<p class="text-xs leading-relaxed" style="color:#4b5563">{demo.manifest.description}</p>
							{/if}

							<!-- Schema fields preview -->
							{#if demo.manifest.schema && demo.manifest.schema.length > 0}
								<div class="flex flex-wrap gap-1">
									{#each (demo.manifest.schema as any[]) as field}
										<span class="text-[9px] px-1.5 py-0.5 font-mono"
										      style="background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); color:#374151">
											{field.key}
										</span>
									{/each}
								</div>
							{/if}

							<!-- Actions -->
							<div class="flex items-center gap-2 pt-1 mt-auto" style="border-top:1px solid rgba(255,255,255,.04)">
								<!-- Aperçu & code -->
								<button
									onclick={() => openDemoModal(demo)}
									class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all"
									style="background:rgba(6,182,212,.08); border:1px solid rgba(6,182,212,.2); color:#06b6d4"
								>
									<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
									</svg>
									Aperçu & code
								</button>

								<!-- Download -->
								<button
									onclick={() => downloadZip(demo.id, `${demo.id}-${demo.manifest.version}.zip`)}
									class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all"
									style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); color:#6b7280"
								>
									<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
									</svg>
									.zip
								</button>

								<!-- Install -->
								{#if alreadyInstalled}
									<span class="ml-auto flex items-center gap-1 text-[10px] font-bold"
									      style="color:#4ade80">
										<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
										</svg>
										Installé
									</span>
								{:else}
									<button
										onclick={() => installDemo(demo.id)}
										disabled={demoInstalling}
										class="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-50"
										style="background:linear-gradient(135deg,rgba(124,58,237,.2),rgba(6,182,212,.15)); border:1px solid rgba(124,58,237,.3); color:#a78bfa"
									>
										{#if demoInstalling}
											<div class="w-3 h-3 rounded-full border-2 animate-spin"
											     style="border-color:rgba(167,139,250,.2); border-top-color:#a78bfa"></div>
										{:else}
											<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m-8-8h16"/>
											</svg>
										{/if}
										Installer
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
			{/if}

			<div style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">
				<div class="px-4 py-3 flex items-center gap-2" style="border-bottom:1px solid rgba(255,255,255,.05)">
					<span class="text-base">📦</span>
					<span class="font-bold text-sm text-white">Catalogue natif Nodyx</span>
					<span class="ml-auto text-xs" style="color:#374151">{PLUGIN_LIST.length} widgets</span>
				</div>
				<div class="p-4 flex flex-col gap-6">
					{#each Object.entries(byPhase()).sort(([a],[b]) => Number(a)-Number(b)) as [phase, plugins]}
						<div>
							<div class="flex items-center gap-3 mb-3">
								<p class="text-[10px] font-bold uppercase tracking-widest" style="color:#374151">
									{PHASE_LABELS[Number(phase)] ?? `Phase ${phase}`}
								</p>
								<div class="flex-1 h-px" style="background:rgba(255,255,255,.04)"></div>
								{#if Number(phase) === 1}
									<span class="text-[10px] font-bold px-1.5 py-0.5" style="background:rgba(74,222,128,.1); border:1px solid rgba(74,222,128,.2); color:#4ade80">Actif</span>
								{:else}
									<span class="text-[10px]" style="color:#1f2937">{plugins.length} à venir</span>
								{/if}
							</div>
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
								{#each plugins as plugin}
									{@const available = plugin.phase === 1}
									{@const color = FAMILY_COLORS[plugin.family] ?? '#6b7280'}
									<div class="flex flex-col gap-2.5 p-3 transition-all"
									     style="background:{available ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.015)'}; border:1px solid {available ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.03)'}; opacity:{available ? 1 : 0.45}">
										<div class="flex items-start justify-between">
											<span class="text-xl leading-none">{plugin.icon}</span>
											<div class="flex items-center gap-1">
												<span class="w-1.5 h-1.5 rounded-full" style="background:{color}"></span>
												<span class="text-[9px] font-bold uppercase" style="color:{color}">{FAMILY_LABELS[plugin.family] ?? plugin.family}</span>
											</div>
										</div>
										<div>
											<p class="text-xs font-bold mb-0.5" style="color:{available ? '#e2e8f0' : '#374151'}">{plugin.label}</p>
											<p class="text-[10px] leading-relaxed" style="color:#374151">{plugin.desc}</p>
										</div>
										<div class="flex items-center justify-between mt-auto pt-2" style="border-top:1px solid rgba(255,255,255,.04)">
											<code class="text-[9px] px-1 py-0.5" style="background:rgba(255,255,255,.04); color:#1f2937">{plugin.id}</code>
											{#if available}
												<span class="text-[9px] font-bold px-1.5 py-0.5" style="background:rgba(74,222,128,.08); border:1px solid rgba(74,222,128,.15); color:#4ade80">Inclus</span>
											{:else}
												<span class="text-[9px] font-bold px-1.5 py-0.5" style="background:rgba(251,146,60,.06); border:1px solid rgba(251,146,60,.12); color:#fb923c">P{plugin.phase}</span>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

	</div>
</div>

<!-- ── Modal démo : Aperçu / manifest.json / widget.iife.js ── -->
{#if demoModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background:rgba(0,0,0,.75); backdrop-filter:blur(4px)"
		role="presentation"
		onclick={(e) => { if (e.target === e.currentTarget) demoModal = null }}
		onkeydown={(e) => { if (e.key === 'Escape') demoModal = null }}
	>
		<div class="w-full max-w-3xl flex flex-col max-h-[90vh]"
			role="dialog" aria-modal="true" tabindex="-1"
		     style="background:#0d0d12; border:1px solid rgba(255,255,255,.1); box-shadow:0 0 60px rgba(124,58,237,.15)">

			<!-- Modal header -->
			<div class="flex items-center gap-3 px-5 py-4 shrink-0" style="border-bottom:1px solid rgba(255,255,255,.06)">
				<span class="text-xl leading-none">{demoModal.manifest.icon ?? '🧩'}</span>
				<div class="flex-1 min-w-0">
					<p class="font-bold text-sm text-white">{demoModal.manifest.label}</p>
					<p class="text-[10px] font-mono mt-0.5" style="color:#374151">
						{demoModal.id} · v{demoModal.manifest.version} · par {demoModal.manifest.author ?? 'Nodyx'}
					</p>
				</div>
				<!-- Download -->
				<button
					onclick={() => demoModal && downloadZip(demoModal.id, `${demoModal.id}-${demoModal.manifest.version}.zip`)}
					class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all"
					style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:#6b7280"
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
					</svg>
					Télécharger .zip
				</button>
				<!-- Close -->
				<button
					onclick={() => demoModal = null}
					aria-label="Fermer"
					class="w-8 h-8 flex items-center justify-center transition-colors"
					style="border:1px solid rgba(255,255,255,.08); color:#6b7280"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
					</svg>
				</button>
			</div>

			<!-- Tabs -->
			<div class="flex items-center gap-1 px-5 py-2.5 shrink-0" style="border-bottom:1px solid rgba(255,255,255,.05)">
				{#each [
					{ key: 'preview',  label: 'Aperçu',          icon: '👁' },
					{ key: 'manifest', label: 'manifest.json',   icon: '📋' },
					{ key: 'js',       label: 'widget.iife.js',  icon: '⚡' },
				] as tab}
					<button
						onclick={() => demoTab = tab.key as typeof demoTab}
						class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all"
						style="border:1px solid {demoTab === tab.key ? 'rgba(124,58,237,.4)' : 'transparent'}; background:{demoTab === tab.key ? 'rgba(124,58,237,.1)' : 'transparent'}; color:{demoTab === tab.key ? '#a78bfa' : '#374151'}"
					>
						<span>{tab.icon}</span>
						<span class="font-mono">{tab.label}</span>
					</button>
				{/each}

				<!-- Spacer + install btn -->
				<div class="ml-auto flex items-center gap-2">
					{#if installedIds.has(demoModal.id)}
						<span class="flex items-center gap-1 text-[10px] font-bold" style="color:#4ade80">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
							</svg>
							Installé
						</span>
					{:else}
						<button
							onclick={() => demoModal && installDemo(demoModal.id)}
							disabled={demoInstalling}
							class="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold transition-all disabled:opacity-50"
							style="background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(6,182,212,.15)); border:1px solid rgba(124,58,237,.4); color:#a78bfa"
						>
							{#if demoInstalling}
								<div class="w-3 h-3 rounded-full border-2 animate-spin"
								     style="border-color:rgba(167,139,250,.2); border-top-color:#a78bfa"></div>
								Installation...
							{:else}
								<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m-8-8h16"/>
								</svg>
								Installer ce widget
							{/if}
						</button>
					{/if}
				</div>
			</div>

			<!-- Tab content -->
			<div class="flex-1 overflow-auto">

				{#if demoTab === 'preview'}
					<div class="p-6">
						{#if demoSourceLoad}
							<div class="flex items-center justify-center py-16 gap-3" style="color:#374151">
								<div class="w-5 h-5 rounded-full border-2 animate-spin"
								     style="border-color:rgba(167,139,250,.2); border-top-color:#a78bfa"></div>
								<span class="text-sm">Chargement du widget...</span>
							</div>
						{:else}
							<!-- Description + schema -->
							{#if demoModal.manifest.description}
								<p class="text-sm leading-relaxed mb-4" style="color:#6b7280">{demoModal.manifest.description}</p>
							{/if}

							<!-- Config fields du schema -->
							{#if demoModal.manifest.schema && (demoModal.manifest.schema as any[]).length > 0}
								<div class="mb-4 p-3" style="background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.05)">
									<p class="text-[10px] font-bold uppercase tracking-wider mb-3" style="color:#374151">Champs configurables</p>
									<div class="grid grid-cols-2 gap-2">
										{#each (demoModal.manifest.schema as any[]) as field}
											<div class="flex flex-col gap-0.5">
												<span class="text-[9px] font-bold uppercase tracking-wider" style="color:#4b5563">{field.label}</span>
												<div class="flex items-center gap-1.5">
													<span class="text-[9px] font-mono px-1.5 py-0.5" style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); color:#374151">{field.type}</span>
													<span class="text-[9px] font-mono" style="color:#1f2937">{field.key}</span>
												</div>
												{#if field.placeholder}
													<span class="text-[9px]" style="color:#1f2937">{field.placeholder}</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<!-- Live preview -->
							<div>
								<p class="text-[10px] font-bold uppercase tracking-wider mb-2" style="color:#374151">Rendu live</p>
								<!-- svelte-ignore svelte_component_dynamic_element_attributes -->
								<svelte:element
									this={`nodyx-widget-${demoModal.id}`}
									data-config={JSON.stringify({ title: 'Démo — ' + demoModal.manifest.label })}
									data-title={demoModal.manifest.label}
									data-instance={JSON.stringify({})}
									data-user=""
									style="display:block"
								></svelte:element>
							</div>
						{/if}
					</div>

				{:else if demoTab === 'manifest'}
					<div class="p-1">
						{#if demoSourceLoad}
							<div class="flex items-center justify-center py-16 gap-3" style="color:#374151">
								<div class="w-5 h-5 rounded-full border-2 animate-spin"
								     style="border-color:rgba(167,139,250,.2); border-top-color:#a78bfa"></div>
							</div>
						{:else if demoSource}
							<div class="relative">
								<div class="flex items-center justify-between px-4 py-2"
								     style="background:rgba(255,255,255,.02); border-bottom:1px solid rgba(255,255,255,.05)">
									<span class="text-[10px] font-mono font-bold" style="color:#4b5563">manifest.json</span>
									<button
										onclick={() => demoSource && navigator.clipboard.writeText(demoSource.manifest).then(() => toast('Copié !'))}
										class="text-[10px] px-2 py-0.5 transition-colors"
										style="border:1px solid rgba(255,255,255,.06); color:#374151"
									>Copier</button>
								</div>
								<pre class="p-4 text-xs leading-relaxed overflow-x-auto" style="color:#a5b4fc; font-family:'Fira Code',monospace; tab-size:2">{demoSource.manifest}</pre>
							</div>
						{/if}
						</div>

				{:else if demoTab === 'js'}
					<div>
						{#if demoSourceLoad}
							<div class="flex items-center justify-center py-16 gap-3" style="color:#374151">
								<div class="w-5 h-5 rounded-full border-2 animate-spin"
								     style="border-color:rgba(167,139,250,.2); border-top-color:#a78bfa"></div>
							</div>
						{:else if demoSource}
							<div class="relative">
								<div class="flex items-center justify-between px-4 py-2"
								     style="background:rgba(255,255,255,.02); border-bottom:1px solid rgba(255,255,255,.05)">
									<span class="text-[10px] font-mono font-bold" style="color:#4b5563">{demoSource.entry}</span>
									<div class="flex items-center gap-2">
										<span class="text-[10px]" style="color:#1f2937">{(demoSource.js.length / 1024).toFixed(1)} Ko</span>
										<button
											onclick={() => demoSource && navigator.clipboard.writeText(demoSource.js).then(() => toast('Copié !'))}
											class="text-[10px] px-2 py-0.5 transition-colors"
											style="border:1px solid rgba(255,255,255,.06); color:#374151"
										>Copier</button>
									</div>
								</div>
								<pre class="p-4 text-xs leading-relaxed overflow-x-auto" style="color:#86efac; font-family:'Fira Code',monospace; tab-size:2">{demoSource.js}</pre>
							</div>
						{/if}
					</div>
				{/if}

			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes indeterminate {
		0%   { transform: translateX(-100%); width: 40%; }
		50%  { width: 60%; }
		100% { transform: translateX(250%); width: 40%; }
	}
</style>
