<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import Tooltip from '$lib/components/ui/Tooltip.svelte'

	// Bot Chat — commandes custom : commandes éditables côté admin avec
	// template de réponse. Les commandes hardcoded (renvoyées par le backend)
	// sont affichées en lecture seule pour info.

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	interface CustomCommand {
		id:                string
		name:              string
		enabled:           boolean
		responseTemplate:  string
		modOnly:           boolean
		cooldownSeconds:   number
		createdAt:         string
		updatedAt:         string
	}

	let commands           = $state<CustomCommand[]>([])
	let hardcoded          = $state<string[]>([])
	let loading            = $state(true)
	let toast              = $state<{ text: string; ok: boolean } | null>(null)

	// Form state
	let editingId          = $state<string | null>(null)
	let formName           = $state('')
	let formTemplate       = $state('')
	let formModOnly        = $state(false)
	let formCooldown       = $state(30)
	let formEnabled        = $state(true)
	let formBusy           = $state(false)
	let templateInputEl    = $state<HTMLTextAreaElement | null>(null)

	const INSERTABLE_VARS = [
		{ token: '{nodyx_url}', label: 'Lien Nodyx' },
		{ token: '{streamer}',  label: 'Streamer'   },
		{ token: '{uptime}',    label: 'Uptime'     },
	]

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	function resetForm(): void {
		editingId    = null
		formName     = ''
		formTemplate = ''
		formModOnly  = false
		formCooldown = 30
		formEnabled  = true
	}

	function loadCmd(c: CustomCommand): void {
		editingId    = c.id
		formName     = c.name
		formTemplate = c.responseTemplate
		formModOnly  = c.modOnly
		formCooldown = c.cooldownSeconds
		formEnabled  = c.enabled
	}

	// ── Presets : commandes prêtes à l'emploi ──────────────────────────────
	interface CmdPreset {
		key:    string
		name:   string
		emoji:  string
		hint:   string
		fill: () => void
	}

	const PRESETS: CmdPreset[] = [
		{
			key: 'discord', name: '!discord', emoji: '💬',
			hint: 'Réponse cheeky pour les viewers qui demandent ton Discord',
			fill: () => {
				formName     = '!discord'
				formTemplate = "Pas de Discord chez nous, on a mieux : Nodyx ! Rejoins-nous : {nodyx_url}"
				formModOnly  = false
				formCooldown = 30
				formEnabled  = true
			},
		},
		{
			key: 'schedule', name: '!schedule', emoji: '📅',
			hint: "Horaires de stream",
			fill: () => {
				formName     = '!schedule'
				formTemplate = "Stream tous les soirs à 21h (heure de Paris). Pense à follow pour ne rien rater !"
				formModOnly  = false
				formCooldown = 30
				formEnabled  = true
			},
		},
		{
			key: 'social', name: '!social', emoji: '🔗',
			hint: 'Tous tes réseaux en un message',
			fill: () => {
				formName     = '!social'
				formTemplate = "Retrouve-moi sur Nodyx ({nodyx_url}) et sur mes autres réseaux. Tape !nodyx pour la commu directement."
				formModOnly  = false
				formCooldown = 60
				formEnabled  = true
			},
		},
		{
			key: 'lurk', name: '!lurk', emoji: '👀',
			hint: 'Pour les viewers qui passent en arrière-plan',
			fill: () => {
				formName     = '!lurk'
				formTemplate = "Merci d'être là en mode lurk, ça booste le stream. Bonne journée !"
				formModOnly  = false
				formCooldown = 15
				formEnabled  = true
			},
		},
		{
			key: 'tipeee', name: '!soutien', emoji: '💛',
			hint: 'Lien de soutien (Tipeee, Patreon, etc.) à personnaliser',
			fill: () => {
				formName     = '!soutien'
				formTemplate = "Merci de soutenir le stream ! Plus d'infos sur {nodyx_url} (et remplace ce template par ton lien Tipeee/Patreon)"
				formModOnly  = false
				formCooldown = 60
				formEnabled  = true
			},
		},
		{
			key: 'projet', name: '!projet', emoji: '🛠️',
			hint: 'Présentation de ton projet en cours',
			fill: () => {
				formName     = '!projet'
				formTemplate = "Sur quoi je bosse : (édite ce message dans l'admin Nodyx). Tape !nodyx pour rejoindre la commu."
				formModOnly  = false
				formCooldown = 60
				formEnabled  = true
			},
		},
	]

	function applyPreset(p: CmdPreset): void {
		editingId = null
		p.fill()
		flash(`Preset "${p.name}" chargé. Personnalise puis enregistre.`, true)
	}

	function insertVar(tok: string): void {
		const el = templateInputEl
		if (!el) {
			formTemplate = formTemplate + (formTemplate && !formTemplate.endsWith(' ') ? ' ' : '') + tok
			return
		}
		const s = el.selectionStart ?? formTemplate.length
		const e = el.selectionEnd   ?? formTemplate.length
		formTemplate = formTemplate.slice(0, s) + tok + formTemplate.slice(e)
		setTimeout(() => { el.focus(); const p = s + tok.length; el.setSelectionRange(p, p) }, 0)
	}

	async function loadAll(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/chat-commands', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { commands: CustomCommand[]; hardcoded: string[] }
				commands  = data.commands  ?? []
				hardcoded = data.hardcoded ?? []
			}
		} finally {
			loading = false
		}
	}

	async function submitForm(): Promise<void> {
		const normalized = formName.trim().toLowerCase()
		if (!/^![a-z0-9_-]{1,30}$/.test(normalized)) {
			flash("Nom invalide. Format : !nom (lettres ASCII, chiffres, _, -, 1-30 chars).", false); return
		}
		if (!formTemplate.trim()) { flash('Template requis.', false); return }
		if (hardcoded.includes(normalized) && (!editingId || commands.find(c => c.id === editingId)?.name !== normalized)) {
			flash(`"${normalized}" est une commande native, choisis un autre nom.`, false); return
		}
		formBusy = true
		try {
			const body = {
				name:              normalized,
				enabled:           formEnabled,
				responseTemplate:  formTemplate,
				modOnly:           formModOnly,
				cooldownSeconds:   formCooldown,
			}
			const url    = editingId ? `/streamer/chat-commands/${editingId}` : '/streamer/chat-commands'
			const method = editingId ? 'PATCH' : 'POST'
			const res = await apiFetch(fetch, url, {
				method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify(body),
			})
			if (res.ok) {
				flash(editingId ? 'Commande mise à jour.' : 'Commande créée.', true)
				resetForm()
				await loadAll()
			} else {
				const data = await res.json().catch(() => ({})) as { error?: string }
				const msg =
					data.error === 'name_reserved_hardcoded' ? 'Ce nom est réservé à une commande native.' :
					data.error === 'name_already_used'       ? 'Ce nom est déjà utilisé.' :
					data.error === 'invalid_name'            ? 'Nom invalide.' :
					data.error ?? 'Erreur inconnue'
				flash(`Échec : ${msg}`, false)
			}
		} finally {
			formBusy = false
		}
	}

	async function toggleEnabled(c: CustomCommand): Promise<void> {
		const res = await apiFetch(fetch, `/streamer/chat-commands/${c.id}`, {
			method:  'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ enabled: !c.enabled }),
		})
		if (res.ok) { c.enabled = !c.enabled; flash(c.enabled ? `${c.name} activée` : `${c.name} désactivée`, true) }
		else flash('Échec toggle.', false)
	}

	async function removeCmd(c: CustomCommand): Promise<void> {
		if (!confirm(`Supprimer la commande "${c.name}" ?`)) return
		const res = await apiFetch(fetch, `/streamer/chat-commands/${c.id}`, {
			method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			commands = commands.filter(x => x.id !== c.id)
			if (editingId === c.id) resetForm()
			flash(`Commande "${c.name}" supprimée.`, true)
		} else flash('Échec suppression.', false)
	}

	onMount(loadAll)
</script>

<section class="space-y-6">
	<!-- Header section -->
	<header class="flex items-start justify-between gap-4 flex-wrap">
		<div>
			<div class="flex items-center gap-2">
				<h2 class="text-lg font-semibold text-zinc-100">Commandes custom</h2>
				<Tooltip text="Crée tes commandes !xxx avec une réponse personnalisée. Le bot répond automatiquement quand un viewer la tape." position="bottom"/>
			</div>
			<p class="text-sm text-zinc-500 mt-0.5">!discord, !schedule, !social, !merch, etc.</p>
		</div>
		<div class="text-xs text-zinc-500 flex items-center gap-1.5 flex-wrap">
			<span class="text-zinc-600">Variables</span>
			<code class="text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">{`{nodyx_url}`}</code>
			<code class="text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">{`{streamer}`}</code>
			<code class="text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">{`{uptime}`}</code>
		</div>
	</header>

	{#if toast}
		<div class="border-l-2 px-3 py-2 text-sm flex items-center gap-2 {toast.ok ? 'border-emerald-500 bg-emerald-500/5 text-emerald-200' : 'border-rose-500 bg-rose-500/5 text-rose-200'}">
			{toast.text}
		</div>
	{/if}

	<!-- Modèles : boutons secondaires francs (vraie surface) -->
	<div class="flex items-center gap-2 flex-wrap">
		<span class="text-[11px] uppercase tracking-wide font-medium text-zinc-500 mr-1">Modèles</span>
		{#each PRESETS as p (p.key)}
			<button type="button" onclick={() => applyPreset(p)} title={p.hint}
				class="text-xs font-mono bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 hover:text-purple-200 text-zinc-200 px-2.5 py-1.5 rounded-sm transition-colors">
				{p.name}
			</button>
		{/each}
	</div>

	<!-- Commandes natives -->
	{#if hardcoded.length > 0}
		<div>
			<div class="flex items-baseline justify-between mb-2">
				<div class="flex items-center gap-1.5">
					<h3 class="text-xs uppercase tracking-wide font-medium text-zinc-500">Commandes natives</h3>
					<Tooltip text="Intégrées au cœur de Nodyx (lookup Twitch, query DB, etc.). Leurs noms sont réservés."/>
				</div>
				<span class="text-xs text-zinc-600">{hardcoded.length}</span>
			</div>
			<div class="border border-zinc-800 bg-zinc-900 px-4 py-3 flex flex-wrap gap-2">
				{#each hardcoded as n (n)}
					<code class="text-xs font-mono text-zinc-200 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded-sm">{n}</code>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Liste commandes custom -->
	<div>
		<div class="flex items-baseline justify-between mb-2">
			<h3 class="text-xs uppercase tracking-wide font-medium text-zinc-500">Commandes configurées</h3>
			{#if commands.length > 0}<span class="text-xs text-zinc-600">{commands.length}</span>{/if}
		</div>

		{#if loading}
			<div class="border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-500">Chargement…</div>
		{:else if commands.length === 0}
			<div class="border border-dashed border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-500">
				Aucune commande custom. Choisis un modèle ci-dessus ou crée-en une dans le formulaire en bas.
			</div>
		{:else}
			<!-- Vraie grille tabulaire : statuts à gauche, alignement strict. -->
			<div class="border border-zinc-800 bg-zinc-900">
				<div class="grid grid-cols-[160px_180px_1fr_auto] gap-4 px-4 py-2 border-b border-zinc-800 bg-zinc-950 text-[11px] uppercase tracking-wide font-medium text-zinc-500">
					<span>Statut</span>
					<span>Commande</span>
					<span>Réponse</span>
					<span class="text-right pr-1">Actions</span>
				</div>
				<ul class="divide-y divide-zinc-800">
					{#each commands as c (c.id)}
						<li class="grid grid-cols-[160px_180px_1fr_auto] gap-4 px-4 py-3 items-start {editingId === c.id ? 'bg-purple-500/[0.04] border-l-2 border-l-purple-500' : ''}">
							<!-- Col 1 : Statuts empilés -->
							<div class="flex flex-col gap-1 text-xs">
								<span class="inline-flex items-center gap-1.5">
									<span class="w-1.5 h-1.5 rounded-full {c.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}"></span>
									<span class="{c.enabled ? 'text-emerald-300' : 'text-zinc-500'} font-medium">{c.enabled ? 'Actif' : 'Inactif'}</span>
								</span>
								{#if c.modOnly}
									<span class="inline-flex items-center gap-1.5 text-rose-400">
										<span class="w-1 h-1 rounded-full bg-rose-400"></span>
										Mod only
									</span>
								{:else}
									<span class="text-zinc-500">Public</span>
								{/if}
								<span class="text-zinc-500">cooldown <span class="text-zinc-200 font-medium">{c.cooldownSeconds}</span>s</span>
							</div>

							<!-- Col 2 : Nom de la commande -->
							<div class="min-w-0">
								<code class="text-sm font-mono font-medium text-zinc-100">{c.name}</code>
							</div>

							<!-- Col 3 : Réponse -->
							<div class="min-w-0">
								<p class="text-sm text-zinc-300 line-clamp-2" title={c.responseTemplate}>{c.responseTemplate}</p>
							</div>

							<!-- Col 4 : Actions -->
							<div class="flex items-center gap-1.5 justify-end">
								<button type="button" onclick={() => toggleEnabled(c)}
									class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 px-2.5 py-1 rounded-sm transition-colors">
									{c.enabled ? 'Désactiver' : 'Activer'}
								</button>
								<button type="button" onclick={() => loadCmd(c)}
									class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 hover:text-purple-200 text-zinc-100 px-2.5 py-1 rounded-sm transition-colors">
									Éditer
								</button>
								<button type="button" onclick={() => removeCmd(c)}
									class="text-xs inline-flex items-center border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/60 px-2 py-1 rounded-sm transition-colors"
									title="Supprimer">
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<polyline points="3 6 5 6 21 6"/>
										<path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
										<path d="M10 11v6M14 11v6"/>
										<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
									</svg>
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	<!-- Formulaire create / edit -->
	<div class="border border-zinc-800 bg-zinc-900">
		<header class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
			<h3 class="text-sm font-semibold text-zinc-100">
				{editingId ? 'Modifier la commande' : 'Nouvelle commande'}
			</h3>
			{#if editingId}
				<button type="button" onclick={resetForm} class="text-xs text-zinc-500 hover:text-zinc-200 transition-colors">Réinitialiser</button>
			{/if}
		</header>

		<div class="p-4 space-y-5">

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<div class="flex items-center gap-1.5">
						<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Nom</label>
						<Tooltip text="Doit commencer par !, suivi de lettres ASCII, chiffres, _ ou -. Pas d'espace."/>
					</div>
					<input type="text" bind:value={formName} maxlength="31" placeholder="!discord"
						class="mt-1.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 outline-none transition-colors rounded-sm"/>
				</div>
				<div>
					<div class="flex items-center gap-1.5">
						<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Cooldown (secondes)</label>
						<Tooltip text="Délai minimum entre 2 réponses du bot pour cette commande. 30s est un bon défaut."/>
					</div>
					<input type="number" min="5" max="3600" bind:value={formCooldown}
						class="mt-1.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors rounded-sm"/>
				</div>
			</div>

			<div>
				<div class="flex items-center justify-between gap-2 flex-wrap mb-1.5">
					<div class="flex items-center gap-1.5">
						<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Réponse du bot</label>
						<Tooltip text="500 caractères max. Les variables seront remplacées au moment de l'envoi."/>
					</div>
					<div class="flex items-center gap-1 flex-wrap">
						{#each INSERTABLE_VARS as v (v.token)}
							<button type="button" onclick={() => insertVar(v.token)}
								class="text-xs font-mono text-zinc-300 hover:text-purple-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 px-1.5 py-0.5 rounded-sm transition-colors">
								{v.token}
							</button>
						{/each}
					</div>
				</div>
				<textarea bind:this={templateInputEl} bind:value={formTemplate} maxlength="500" rows="3"
					placeholder="Rejoins notre Discord : https://..."
					class="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors resize-none rounded-sm"></textarea>
			</div>

			<div class="flex items-center gap-6 flex-wrap">
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={formModOnly} class="w-4 h-4 accent-purple-500"/>
					<span class="text-sm text-zinc-300">Mod / Streamer only</span>
					<Tooltip text="Seuls toi et tes modérateurs peuvent déclencher cette commande."/>
				</label>
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={formEnabled} class="w-4 h-4 accent-purple-500"/>
					<span class="text-sm text-zinc-300">Activée à la création</span>
				</label>
			</div>
		</div>

		<footer class="px-4 py-3 border-t border-zinc-800 bg-zinc-900/60 flex items-center gap-2">
			<button type="button" onclick={submitForm} disabled={formBusy || !formName.trim() || !formTemplate.trim()}
				class="text-sm font-medium bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 shadow-sm shadow-purple-500/30 disabled:shadow-none text-white px-4 py-1.5 rounded-sm transition-colors">
				{editingId ? 'Enregistrer les modifications' : 'Créer la commande'}
			</button>
			{#if editingId}
				<button type="button" onclick={resetForm}
					class="text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-sm transition-colors">
					Annuler
				</button>
			{/if}
		</footer>
	</div>
</section>
