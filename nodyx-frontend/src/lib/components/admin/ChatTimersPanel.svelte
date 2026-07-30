<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import { t as i18n } from '$lib/i18n'
	import Tooltip from '$lib/components/ui/Tooltip.svelte'

	const tFn = $derived($i18n)

	// Bot Chat — chat timers : messages bot récurrents postés dans le chat Twitch.
	// Variables supportées dans le template : {nodyx_url}, {streamer}, {uptime}.

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	type TriggerMode = 'recurring' | 'once_per_live' | 'once'

	interface ChatTimer {
		id:               string
		label:            string
		enabled:          boolean
		messageTemplate:  string
		intervalMinutes:  number
		minChatMessages:  number
		liveOnly:         boolean
		triggerMode:      TriggerMode
		lastSentAt:       string | null
		createdAt:        string
		updatedAt:        string
	}

	const MODE_LABELS: Record<TriggerMode, string> = {
		recurring:      'timer.mode_recurring',
		once_per_live:  'timer.mode_once_per_live',
		once:           'timer.mode_once',
	}

	const MODE_DESCS: Record<TriggerMode, string> = {
		recurring:      'timer.mode_recurring_desc',
		once_per_live:  'timer.mode_once_per_live_desc',
		once:           'timer.mode_once_desc',
	}

	let timers   = $state<ChatTimer[]>([])
	let loading  = $state(true)
	let toast    = $state<{ text: string; ok: boolean } | null>(null)

	// Form state (création + édition inline du timer en cours d'édition)
	let editingId        = $state<string | null>(null)
	let formLabel        = $state('')
	let formTemplate     = $state('')
	let formInterval     = $state(15)
	let formMinMsgs      = $state(5)
	let formLiveOnly     = $state(true)
	let formEnabled      = $state(true)
	let formMode         = $state<TriggerMode>('recurring')
	let formPreview      = $state<string | null>(null)
	let formBusy         = $state(false)
	let sendingNowId     = $state<string | null>(null)
	let templateInputEl  = $state<HTMLTextAreaElement | null>(null)

	const INSERTABLE_VARS = [
		{ token: '{nodyx_url}', labelKey: 'timer.var_nodyx_label', descKey: 'timer.var_nodyx_desc' },
		{ token: '{streamer}',  labelKey: 'timer.var_streamer_label', descKey: 'timer.var_streamer_desc' },
		{ token: '{uptime}',    labelKey: 'timer.var_uptime_label', descKey: 'timer.var_uptime_desc' },
	]

	// ── Presets : "recettes" pré-faites pour démarrer vite ────────────────
	interface TimerPreset {
		key:        string
		labelKey:   string
		emoji:      string
		hintKey:    string
		fill: () => void
	}

	const PRESETS: TimerPreset[] = [
		{
			key:   'welcome',
			labelKey: 'timer.preset_welcome',
			emoji: '👋',
			hintKey:  'timer.preset_welcome_hint',
			fill: () => {
				formLabel    = tFn('timer.preset_welcome')
				formTemplate = tFn('timer.preset_welcome_tpl')
				formMode     = 'once_per_live'
				formInterval = 2
				formMinMsgs  = 0
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'pub_nodyx',
			labelKey: 'timer.preset_pub',
			emoji: '🚀',
			hintKey:  'timer.preset_pub_hint',
			fill: () => {
				formLabel    = tFn('timer.preset_pub')
				formTemplate = tFn('timer.preset_pub_tpl')
				formMode     = 'recurring'
				formInterval = 15
				formMinMsgs  = 5
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'schedule',
			labelKey: 'timer.preset_schedule',
			emoji: '📅',
			hintKey:  'timer.preset_schedule_hint',
			fill: () => {
				formLabel    = tFn('timer.preset_schedule')
				formTemplate = tFn('timer.preset_schedule_tpl')
				formMode     = 'recurring'
				formInterval = 30
				formMinMsgs  = 3
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'social',
			labelKey: 'timer.preset_social',
			emoji: '🔗',
			hintKey:  'timer.preset_social_hint',
			fill: () => {
				formLabel    = tFn('timer.preset_social_label')
				formTemplate = tFn('timer.preset_social_tpl')
				formMode     = 'recurring'
				formInterval = 20
				formMinMsgs  = 5
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'announce_once',
			labelKey: 'timer.preset_announce',
			emoji: '📣',
			hintKey:  'timer.preset_announce_hint',
			fill: () => {
				formLabel    = tFn('timer.preset_announce')
				formTemplate = tFn('timer.preset_announce_tpl')
				formMode     = 'once'
				formInterval = 5
				formMinMsgs  = 0
				formLiveOnly = true
				formEnabled  = true
			},
		},
	]

	function applyPreset(p: TimerPreset): void {
		editingId = null  // toujours créer une nouvelle row depuis un preset
		p.fill()
		flash(tFn('timer.preset_loaded', { label: tFn(p.labelKey) }), true)
	}

	function insertVar(token: string): void {
		const el = templateInputEl
		if (!el) {
			formTemplate = formTemplate + (formTemplate.endsWith(' ') || !formTemplate ? '' : ' ') + token
			return
		}
		const start = el.selectionStart ?? formTemplate.length
		const end   = el.selectionEnd   ?? formTemplate.length
		formTemplate = formTemplate.slice(0, start) + token + formTemplate.slice(end)
		// Replace caret après la variable insérée
		setTimeout(() => {
			el.focus()
			const pos = start + token.length
			el.setSelectionRange(pos, pos)
		}, 0)
	}

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	function resetForm(): void {
		editingId    = null
		formLabel    = ''
		formTemplate = ''
		formInterval = 15
		formMinMsgs  = 5
		formLiveOnly = true
		formEnabled  = true
		formMode     = 'recurring'
		formPreview  = null
	}

	function loadTemplate(t: ChatTimer): void {
		editingId    = t.id
		formLabel    = t.label
		formTemplate = t.messageTemplate
		formInterval = t.intervalMinutes
		formMinMsgs  = t.minChatMessages
		formLiveOnly = t.liveOnly
		formEnabled  = t.enabled
		formMode     = t.triggerMode
		formPreview  = null
	}

	async function loadTimers(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/chat-timers', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { timers: ChatTimer[] }
				timers = data.timers ?? []
			}
		} finally {
			loading = false
		}
	}

	async function doPreview(): Promise<void> {
		if (!formTemplate.trim()) { formPreview = null; return }
		formBusy = true
		try {
			const res = await apiFetch(fetch, '/streamer/chat-timers/preview', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ template: formTemplate }),
			})
			if (res.ok) {
				const data = await res.json() as { rendered: string }
				formPreview = data.rendered
			} else {
				formPreview = null
			}
		} finally {
			formBusy = false
		}
	}

	async function submitForm(): Promise<void> {
		if (!formLabel.trim() || !formTemplate.trim()) {
			flash(tFn('timer.err_required'), false); return
		}
		if (formMode === 'recurring' && formInterval < 5) {
			flash(tFn('timer.err_min_interval'), false); return
		}
		if (formMode !== 'recurring' && formInterval < 1) {
			flash(tFn('timer.err_min_delay'), false); return
		}
		formBusy = true
		try {
			const body = {
				label:            formLabel,
				enabled:          formEnabled,
				messageTemplate:  formTemplate,
				intervalMinutes:  formInterval,
				minChatMessages:  formMinMsgs,
				liveOnly:         formLiveOnly,
				triggerMode:      formMode,
			}
			const url = editingId ? `/streamer/chat-timers/${editingId}` : '/streamer/chat-timers'
			const res = await apiFetch(fetch, url, {
				method:  editingId ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify(body),
			})
			if (res.ok) {
				flash(editingId ? tFn('timer.updated') : tFn('timer.created'), true)
				resetForm()
				await loadTimers()
			} else {
				const data = await res.json().catch(() => ({ error: 'unknown' })) as { error?: string }
				flash(tFn('timer.err_generic', { error: data.error ?? tFn('timer.err_unknown') }), false)
			}
		} finally {
			formBusy = false
		}
	}

	async function toggleEnabled(t: ChatTimer): Promise<void> {
		const res = await apiFetch(fetch, `/streamer/chat-timers/${t.id}`, {
			method:  'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ enabled: !t.enabled }),
		})
		if (res.ok) {
			t.enabled = !t.enabled
			flash(t.enabled ? tFn('timer.toggled_on', { label: t.label }) : tFn('timer.toggled_off', { label: t.label }), true)
		} else {
			flash(tFn('timer.err_toggle'), false)
		}
	}

	async function deleteTimer(t: ChatTimer): Promise<void> {
		if (!confirm(tFn('timer.delete_confirm', { label: t.label }))) return
		const res = await apiFetch(fetch, `/streamer/chat-timers/${t.id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			timers = timers.filter(x => x.id !== t.id)
			if (editingId === t.id) resetForm()
			flash(tFn('timer.deleted', { label: t.label }), true)
		} else {
			flash(tFn('timer.err_delete'), false)
		}
	}

	async function sendNow(t: ChatTimer): Promise<void> {
		if (sendingNowId) return
		sendingNowId = t.id
		try {
			const res = await apiFetch(fetch, `/streamer/chat-timers/${t.id}/send-now`, {
				method:  'POST',
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json().catch(() => ({})) as { ok?: boolean; reason?: string; rendered?: string }
			if (data.ok) flash(tFn('timer.sent', { msg: String(data.rendered ?? '').slice(0, 100) }), true)
			else         flash(tFn('timer.err_send', { reason: data.reason ?? tFn('timer.unknown_short') }), false)
		} finally {
			sendingNowId = null
		}
	}

	function fmtRelative(iso: string | null): string {
		if (!iso) return tFn('timer.never')
		const diff = Date.now() - new Date(iso).getTime()
		const m = Math.floor(diff / 60_000)
		if (m < 1)   return tFn('timer.just_now')
		if (m < 60)  return tFn('timer.mins_ago', { n: m })
		const h = Math.floor(m / 60)
		if (h < 24)  return tFn('timer.hours_ago', { n: h })
		const d = Math.floor(h / 24)
		return tFn('timer.days_ago', { n: d })
	}

	onMount(loadTimers)
</script>

<!-- Tokens locaux :
   page bg      = zinc-950 (hérité du layout admin)
   card         = zinc-900 (vraie surface, plus claire que la page)
   input        = zinc-950 (plus sombre que la card, "creusé")
   border       = zinc-800 (subtile mais nette)
   accent       = purple-500
   text-1       = zinc-100 (label principal)
   text-2       = zinc-400 (texte body)
   text-3       = zinc-500 (meta)
   radius       = pas sur cards/listes/badges, juste 2px sur inputs/boutons
-->
<section class="space-y-6">

	<!-- Header section : titre clair + meta variables disponibles. -->
	<header class="flex items-start justify-between gap-4 flex-wrap">
		<div>
			<div class="flex items-center gap-2">
				<h2 class="text-lg font-semibold text-zinc-100">{tFn('timer.title')}</h2>
				<Tooltip text={tFn('timer.title_tooltip')} position="bottom"/>
			</div>
			<p class="text-sm text-zinc-500 mt-0.5">{tFn('timer.subtitle')}</p>
		</div>
		<div class="text-xs text-zinc-500 flex items-center gap-1.5 flex-wrap">
			<span class="text-zinc-600">{tFn('timer.variables')}</span>
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

	<!-- Modèles : rangée de boutons secondaires francs (vraie surface). -->
	<div class="flex items-center gap-2 flex-wrap">
		<span class="text-[11px] uppercase tracking-wide font-medium text-zinc-500 mr-1">{tFn('timer.templates_label')}</span>
		{#each PRESETS as p (p.key)}
			<button type="button" onclick={() => applyPreset(p)} title={tFn(p.hintKey)}
				class="text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 hover:text-purple-200 text-zinc-200 px-2.5 py-1.5 rounded-sm transition-colors">
				{tFn(p.labelKey)}
			</button>
		{/each}
	</div>

	<!-- Liste des timers : grande card pleine, pas de radius. -->
	<div>
		<div class="flex items-baseline justify-between mb-2">
			<h3 class="text-xs uppercase tracking-wide font-medium text-zinc-500">{tFn('timer.configured_title')}</h3>
			{#if timers.length > 0}<span class="text-xs text-zinc-600">{timers.length}</span>{/if}
		</div>

		{#if loading}
			<div class="border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-500">{tFn('timer.loading')}</div>
		{:else if timers.length === 0}
			<div class="border border-dashed border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-500">
				{tFn('timer.empty')}
			</div>
		{:else}
			<!-- Vraie grille tabulaire : 4 colonnes alignées, header sticky, statuts à gauche. -->
			<div class="border border-zinc-800 bg-zinc-900">
				<!-- Header colonnes -->
				<div class="grid grid-cols-[160px_1fr_180px_auto] gap-4 px-4 py-2 border-b border-zinc-800 bg-zinc-950 text-[11px] uppercase tracking-wide font-medium text-zinc-500">
					<span>{tFn('timer.col_status')}</span>
					<span>Timer</span>
					<span>Planning</span>
					<span class="text-right pr-1">Actions</span>
				</div>
				<!-- Rows -->
				<ul class="divide-y divide-zinc-800">
					{#each timers as t (t.id)}
						<li class="grid grid-cols-[160px_1fr_180px_auto] gap-4 px-4 py-3 items-start {editingId === t.id ? 'bg-purple-500/[0.04] border-l-2 border-l-purple-500' : ''}">
							<!-- Col 1 : Statuts empilés -->
							<div class="flex flex-col gap-1 text-xs">
								<span class="inline-flex items-center gap-1.5">
									<span class="w-1.5 h-1.5 rounded-full {t.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}"></span>
									<span class="{t.enabled ? 'text-emerald-300' : 'text-zinc-500'} font-medium">{t.enabled ? tFn('timer.active') : tFn('timer.inactive')}</span>
								</span>
								<span class="text-zinc-400">{tFn(MODE_LABELS[t.triggerMode])}</span>
								{#if t.liveOnly}
									<span class="inline-flex items-center gap-1.5 text-rose-400">
										<span class="w-1 h-1 rounded-full bg-rose-400"></span>
										Live only
									</span>
								{:else}
									<span class="text-zinc-600">{tFn('timer.all_contexts')}</span>
								{/if}
							</div>

							<!-- Col 2 : Label + template -->
							<div class="min-w-0">
								<div class="text-sm font-medium text-zinc-100 truncate" title={t.label}>{t.label}</div>
								<p class="text-sm text-zinc-400 mt-0.5 line-clamp-2" title={t.messageTemplate}>{t.messageTemplate}</p>
							</div>

							<!-- Col 3 : Planning -->
							<div class="flex flex-col gap-0.5 text-xs text-zinc-500">
								{#if t.triggerMode === 'recurring'}
									<span>{tFn('timer.every')} <span class="text-zinc-200 font-medium">{t.intervalMinutes}</span> {tFn('timer.min_unit')}</span>
									<span>{tFn('timer.min_prefix')} <span class="text-zinc-200 font-medium">{t.minChatMessages}</span> {tFn('timer.msg_chat')}</span>
								{:else if t.triggerMode === 'once_per_live'}
									<span><span class="text-zinc-200 font-medium">{t.intervalMinutes}</span> {tFn('timer.min_after_golive')}</span>
								{:else}
									<span class="text-zinc-400">{tFn('timer.single_send')}</span>
								{/if}
								<span class="text-zinc-600">{tFn('timer.last')} {fmtRelative(t.lastSentAt)}</span>
							</div>

							<!-- Col 4 : Actions -->
							<div class="flex items-center gap-1.5 justify-end">
								<button type="button" onclick={() => sendNow(t)} disabled={sendingNowId === t.id}
									class="text-xs inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 hover:text-purple-200 disabled:opacity-30 text-zinc-100 px-2.5 py-1 rounded-sm transition-colors"
									title={tFn('timer.send_now_title')}>
									<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84a1 1 0 011.04.06l9 6a1 1 0 010 1.66l-9 6A1 1 0 016 16V4a1 1 0 01.3-.84z"/></svg>
									{tFn('timer.send')}
								</button>
								<button type="button" onclick={() => toggleEnabled(t)}
									class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 px-2.5 py-1 rounded-sm transition-colors">
									{t.enabled ? tFn('timer.disable') : tFn('timer.enable')}
								</button>
								<button type="button" onclick={() => loadTemplate(t)}
									class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 hover:text-purple-200 text-zinc-100 px-2.5 py-1 rounded-sm transition-colors">
									{tFn('timer.edit')}
								</button>
								<button type="button" onclick={() => deleteTimer(t)}
									class="text-xs inline-flex items-center border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/60 px-2 py-1 rounded-sm transition-colors"
									title={tFn('timer.delete')}>
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

	<!-- Formulaire create / edit : grande card pleine sans radius. -->
	<div class="border border-zinc-800 bg-zinc-900">
		<header class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
			<h3 class="text-sm font-semibold text-zinc-100">
				{editingId ? tFn('timer.edit_title') : tFn('timer.new_title')}
			</h3>
			{#if editingId}
				<button type="button" onclick={resetForm} class="text-xs text-zinc-500 hover:text-zinc-200 transition-colors">{tFn('timer.reset')}</button>
			{/if}
		</header>

		<div class="p-4 space-y-5">

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<div class="flex items-center gap-1.5">
						<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">{tFn('timer.label_internal')}</label>
						<Tooltip text={tFn('timer.label_tooltip')}/>
					</div>
					<input type="text" bind:value={formLabel} maxlength="100" placeholder={tFn('timer.label_ph')}
						class="mt-1.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors rounded-sm"/>
				</div>
				{#if formMode !== 'once'}
					<div>
						<div class="flex items-center gap-1.5">
							<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">
								{formMode === 'recurring' ? tFn('timer.interval_label') : tFn('timer.delay_label')}
							</label>
							<Tooltip text={formMode === 'recurring' ? tFn('timer.interval_tooltip') : tFn('timer.delay_tooltip')}/>
						</div>
						<input type="number" min={formMode === 'recurring' ? 5 : 1} max="1440" bind:value={formInterval}
							class="mt-1.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors rounded-sm"/>
					</div>
				{:else}
					<div class="text-xs text-zinc-500 self-end pb-2">
						{tFn('timer.once_hint')}
					</div>
				{/if}
			</div>

			<!-- Mode de déclenchement -->
			<div>
				<div class="flex items-center gap-1.5 mb-2">
					<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">{tFn('timer.trigger_mode_label')}</label>
					<Tooltip text={tFn('timer.trigger_mode_tooltip')}/>
				</div>
				<div class="grid grid-cols-1 md:grid-cols-3 gap-2">
					{#each (['recurring', 'once_per_live', 'once'] as TriggerMode[]) as mode (mode)}
						<label class="cursor-pointer border p-3 transition-colors {formMode === mode ? 'border-purple-500/60 bg-purple-500/5' : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950'}">
							<div class="flex items-center gap-2">
								<input type="radio" name="trigger-mode" value={mode} bind:group={formMode}
									class="w-3 h-3 accent-purple-500"/>
								<span class="text-sm font-medium text-zinc-100">{tFn(MODE_LABELS[mode])}</span>
							</div>
							<div class="text-xs text-zinc-500 mt-1 leading-snug">{tFn(MODE_DESCS[mode])}</div>
						</label>
					{/each}
				</div>
			</div>

			<!-- Template -->
			<div>
				<div class="flex items-center justify-between gap-2 flex-wrap mb-1.5">
					<div class="flex items-center gap-1.5">
						<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">{tFn('timer.message_label')}</label>
						<Tooltip text={tFn('timer.message_tooltip')}/>
					</div>
					<div class="flex items-center gap-1 flex-wrap">
						{#each INSERTABLE_VARS as v (v.token)}
							<button type="button" onclick={() => insertVar(v.token)} title={tFn(v.descKey)}
								class="text-xs font-mono text-zinc-300 hover:text-purple-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 px-1.5 py-0.5 rounded-sm transition-colors">
								{v.token}
							</button>
						{/each}
					</div>
				</div>
				<textarea bind:this={templateInputEl} bind:value={formTemplate} maxlength="500" rows="3"
					placeholder={tFn('timer.message_ph')}
					class="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors resize-none rounded-sm"></textarea>
			</div>

			<!-- Options -->
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				{#if formMode === 'recurring'}
					<div>
						<div class="flex items-center gap-1.5">
							<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">{tFn('timer.min_msgs_label')}</label>
							<Tooltip text={tFn('timer.min_msgs_tooltip')}/>
						</div>
						<input type="number" min="0" max="1000" bind:value={formMinMsgs}
							class="mt-1.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors rounded-sm"/>
					</div>
				{:else}
					<p class="text-xs text-zinc-500 self-end pb-1.5">
						{#if formMode === 'once_per_live'}
							{tFn('timer.antispam_off_welcome')}
						{:else}
							{tFn('timer.antispam_off_once')}
						{/if}
					</p>
				{/if}
				<label class="flex items-center gap-2 cursor-pointer self-end pb-1.5">
					<input type="checkbox" bind:checked={formLiveOnly} class="w-4 h-4 accent-purple-500"/>
					<span class="text-sm text-zinc-300">Live only</span>
					<Tooltip text={tFn('timer.liveonly_tooltip')}/>
				</label>
				<label class="flex items-center gap-2 cursor-pointer self-end pb-1.5">
					<input type="checkbox" bind:checked={formEnabled} class="w-4 h-4 accent-purple-500"/>
					<span class="text-sm text-zinc-300">{tFn('timer.enabled_on_create')}</span>
				</label>
			</div>

			<!-- Aperçu -->
			<div class="flex items-center gap-2 flex-wrap">
				<button type="button" onclick={doPreview} disabled={formBusy || !formTemplate.trim()}
					class="text-sm inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 border border-zinc-700 text-zinc-100 px-3 py-1.5 rounded-sm transition-colors">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
						<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
						<circle cx="12" cy="12" r="3"/>
					</svg>
					{tFn('timer.preview_btn')}
				</button>
				{#if formPreview}
					<div class="flex-1 min-w-0 text-sm text-zinc-300 bg-zinc-950 border border-zinc-800 px-3 py-1.5 truncate rounded-sm" title={formPreview}>
						{formPreview}
					</div>
				{/if}
			</div>
		</div>

		<!-- Actions du formulaire dans une barre dédiée -->
		<footer class="px-4 py-3 border-t border-zinc-800 bg-zinc-900/60 flex items-center gap-2">
			<button type="button" onclick={submitForm} disabled={formBusy || !formLabel.trim() || !formTemplate.trim()}
				class="text-sm font-medium bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 shadow-sm shadow-purple-500/30 disabled:shadow-none text-white px-4 py-1.5 rounded-sm transition-colors">
				{editingId ? tFn('timer.save_edit') : tFn('timer.create_btn')}
			</button>
			{#if editingId}
				<button type="button" onclick={resetForm}
					class="text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-sm transition-colors">
					{tFn('timer.cancel')}
				</button>
			{/if}
		</footer>
	</div>
</section>
