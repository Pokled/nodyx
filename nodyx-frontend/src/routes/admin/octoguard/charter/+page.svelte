<script lang="ts">
	// Les chartes (lot 7 ; maquette v3 validée le 19/11/2026, CDC §E4j). Deux chartes :
	// celle des membres (la porte d'entrée) et celle de l'équipe. Tout se voit sans
	// chercher : allumer, prête à allumer, les chiffres, le parcours, l'éditeur, la case,
	// la signature, les pièges, qui a signé, qui attend, les robots, le journal, les versions.
	// « Voir côté membre » et « Aperçu » : la porte des membres (lot 7d), avec le brouillon.
	import { onMount, onDestroy, untrack } from 'svelte'
	import { page } from '$app/state'
	import { t, locale } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import { mayOpenAdmin } from '$lib/adminAccess'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import CharterEditor from '$lib/components/charter/CharterEditor.svelte'
	import CharterDoor from '$lib/components/charter/CharterDoor.svelte'
	import { tokens } from '$lib/charter/blocks'
	import { fmtDuration, ago } from '$lib/charter/format'
	import type { PageData } from './$types'

	type Aud = 'members' | 'team'
	type Tone = 'sober' | 'fun' | 'kids' | 'own'
	type Version = { version: number; important: boolean; published_at: string; published_by_name: string | null; signatures: number }
	type Charter = {
		enabled: boolean; pledge_tone: Tone; pledge_own: string; draw_enabled: boolean; draft_html: string
		current_version: number | null; versions: Version[]
		readiness: { title: boolean; rules: boolean; banner: boolean; pledge: boolean; ready: boolean }
	}
	type Overview = {
		current_version: number | null; signed: number; pending: number; bots_week: number
		funnel: { opened: number; bottom: number; signed: number; bots: number }
		avg_read_ms: number | null; dropoff: { title: string; count: number } | null
	}
	type Person = { user_id: string; username: string; version?: number; way?: 'hand' | 'phrase'; read_ms?: number; signed_at?: string; joined_at?: string; signed_version?: number | null; read_pct?: number | null; trap?: 'decoy' | 'clock'; created_at?: string }
	type Entry = { id: string; action: string; actor_username: string | null; target_label: string | null; metadata: Record<string, any> | null; created_at: string }
	type Tab = 'recent' | 'pending' | 'bots'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const tk = $derived(tokens(tFn))
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const access = $derived((page.data as any).access ?? null)
	const canManage = $derived(access?.role === 'owner' || access?.role === 'admin' || (access?.permissions ?? []).includes('manage_octoguard'))
	const canOpenLog = $derived(mayOpenAdmin('/admin/octoguard/logs', access))
	const headers = () => (token ? { Authorization: `Bearer ${token}` } : {}) as Record<string, string>

	const init = untrack(() => ({ members: data.members as Charter | null, team: data.team as Charter | null }))
	let aud = $state<Aud>('members')
	const charters = $state<Record<Aud, Charter | null>>({ members: init.members, team: init.team })
	const ch = $derived(charters[aud])

	// ── Les chiffres, les listes, le journal : rechargés à chaque onglet ─────
	let overview = $state<Overview | null>(null)
	let lists = $state<Record<Tab, Person[]>>({ recent: [], pending: [], bots: [] })
	let journal = $state<Entry[]>([])
	let tab = $state<Tab>('recent')
	let q = $state('')
	let shown = $state<Person[]>([])
	let qTimer: ReturnType<typeof setTimeout> | null = null

	async function get<T>(path: string): Promise<T | null> {
		try {
			const res = await apiFetch(fetch, path, { headers: headers() })
			return res.ok ? ((await res.json()) as T) : null
		} catch { return null }
	}
	async function loadAll(a: Aud) {
		const [ov, r, p, b, j] = await Promise.all([
			get<Overview>(`/admin/charter/${a}/overview`),
			get<{ people: Person[] }>(`/admin/charter/${a}/people?tab=recent`),
			get<{ people: Person[] }>(`/admin/charter/${a}/people?tab=pending`),
			get<{ people: Person[] }>(`/admin/charter/${a}/people?tab=bots`),
			get<{ entries: Entry[] }>(`/admin/charter/${a}/journal`),
		])
		if (a !== aud) return
		overview = ov
		lists = { recent: r?.people ?? [], pending: p?.people ?? [], bots: b?.people ?? [] }
		journal = j?.entries ?? []
		shown = q.trim() ? shown : lists[tab]
		if (q.trim()) void search()
	}
	async function reloadCharter(a: Aud) {
		const c = await get<Charter>(`/admin/charter/${a}`)
		if (c && charters[a]) {
			// Le brouillon en cours d'écriture n'est pas écrasé
			charters[a] = { ...c, draft_html: charters[a]!.draft_html }
		}
	}
	async function search() {
		const term = q.trim()
		if (!term) { shown = lists[tab]; return }
		const res = await get<{ people: Person[] }>(`/admin/charter/${aud}/people?tab=${tab}&q=${encodeURIComponent(term)}`)
		shown = res?.people ?? []
	}
	function onSearch() { if (qTimer) clearTimeout(qTimer); qTimer = setTimeout(search, 250) }
	function pickTab(x: Tab) { tab = x; if (q.trim()) void search(); else shown = lists[x] }
	onMount(() => { void loadAll(aud) })

	// ── Le brouillon s'enregistre tout seul, une seconde après la dernière frappe ──
	let status = $state<'idle' | 'saving' | 'saved' | 'error' | 'readonly'>('idle')
	let timer: ReturnType<typeof setTimeout> | null = null
	let pending: { aud: Aud; html: string } | null = null
	async function flush() {
		if (timer) { clearTimeout(timer); timer = null }
		if (!pending) return true
		const { aud: a, html } = pending
		pending = null
		status = 'saving'
		try {
			const res = await apiFetch(fetch, `/admin/charter/${a}/draft`, { method: 'PUT', headers: headers(), body: JSON.stringify({ html }) })
			if (res.status === 403) { status = 'readonly'; return false }
			if (!res.ok) { status = 'error'; return false }
			const j = await res.json()
			if (charters[a]) charters[a]!.draft_html = j.draft_html
			status = 'saved'
			void reloadCharter(a)   // « prête à allumer ? » suit le brouillon
			return true
		} catch { status = 'error'; return false }
	}
	function onChange(html: string) {
		if (!canManage) { status = 'readonly'; return }
		// Gardé tout de suite : changer d'onglet et revenir ne perd pas la dernière seconde
		if (charters[aud]) charters[aud]!.draft_html = html
		pending = { aud, html }
		status = 'idle'
		if (timer) clearTimeout(timer)
		timer = setTimeout(flush, 1000)
	}
	function switchTo(a: Aud) {
		if (a === aud) return
		void flush()
		aud = a
		status = 'idle'; pubMsg = null; important = false; q = ''; tab = 'recent'
		overview = null; lists = { recent: [], pending: [], bots: [] }; shown = []; journal = []
		void loadAll(a)
	}
	onDestroy(() => { void flush(); if (qTimer) clearTimeout(qTimer) })

	// ── Les réglages : allumer, la case, la signature ─────────────────────────
	let setErr = $state('')
	let ownTimer: ReturnType<typeof setTimeout> | null = null
	async function saveSettings(patch: Record<string, unknown>) {
		if (!canManage || !charters[aud]) return
		const a = aud
		setErr = ''
		try {
			const res = await apiFetch(fetch, `/admin/charter/${a}/settings`, { method: 'PUT', headers: headers(), body: JSON.stringify(patch) })
			if (!res.ok) throw new Error()
			const c = (await res.json()) as Charter
			if (charters[a]) charters[a] = { ...c, draft_html: charters[a]!.draft_html }
			if ('enabled' in patch) void loadAll(a)
		} catch {
			setErr = tFn('chpage.set_error')
			void reloadCharter(a)
		}
	}
	function setTone(tone: Tone) { if (charters[aud]) charters[aud]!.pledge_tone = tone; void saveSettings({ pledge_tone: tone }) }
	function setOwn(v: string) {
		if (charters[aud]) charters[aud]!.pledge_own = v
		if (ownTimer) clearTimeout(ownTimer)
		ownTimer = setTimeout(() => saveSettings({ pledge_own: v, pledge_tone: 'own' }), 700)
	}

	// ── Publier ───────────────────────────────────────────────────────────────
	let important = $state(false)
	let publishing = $state(false)
	let pubMsg = $state<{ ok: boolean; text: string } | null>(null)
	const nextVersion = $derived((ch?.current_version ?? 0) + 1)
	async function publish() {
		if (!canManage || publishing) return
		publishing = true; pubMsg = null
		const a = aud
		if (!(await flush())) { publishing = false; pubMsg = { ok: false, text: tFn('chpage.pub_error') }; return }
		try {
			const res = await apiFetch(fetch, `/admin/charter/${a}/publish`, { method: 'POST', headers: headers(), body: JSON.stringify({ important }) })
			const j = await res.json().catch(() => ({}))
			if (!res.ok) {
				pubMsg = { ok: false, text: j.code === 'CHARTER_EMPTY' ? tFn('chpage.pub_empty') : tFn('chpage.pub_error') }
			} else {
				const n = String(j.version)
				pubMsg = { ok: true, text: j.version === 1 ? tFn('chpage.pub_done_first') : j.important ? tFn('chpage.pub_done_important', { n }) : tFn('chpage.pub_done_fix', { n }) }
				important = false
				await reloadCharter(a); void loadAll(a)
			}
		} catch { pubMsg = { ok: false, text: tFn('chpage.pub_error') } }
		publishing = false
	}

	// ── Mises en forme ────────────────────────────────────────────────────────
	const published = (c: Charter | null) => {
		const v = c?.versions?.[0]
		if (!v) return tFn('chpage.not_published')
		return tFn('chpage.version_published', { n: String(v.version), date: new Date(v.published_at).toLocaleDateString($locale, { day: 'numeric', month: 'short' }) })
	}
	const COL = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#3b82f6', '#22c55e', '#e5484d']
	const colorOf = (name: string) => COL[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COL.length]
	const since = (iso: string | undefined) => {
		if (!iso) return ''
		const days = (Date.now() - Date.parse(iso)) / 86400000
		return days < 30 ? tFn('chpage.since_new', { when: ago(iso, $locale) }) : tFn('chpage.since_member', { y: String(new Date(iso).getFullYear()) })
	}
	const where = (p: Person) => {
		if (p.signed_version) return { text: tFn('chpage.pend_resign', { v: String(p.signed_version) }), cls: 'old' }
		if (p.read_pct === null || p.read_pct === undefined) return { text: tFn('chpage.pend_never'), cls: 'new' }
		return { text: tFn('chpage.pend_read', { p: String(p.read_pct) }), cls: 'new' }
	}
	const jrColor = (e: Entry) => {
		const a = e.action.replace(/^octoguard\./, '')
		if (a === 'charter_bot_stopped') return 'var(--nx-bad)'
		if (a === 'charter_signed') return e.metadata?.way === 'phrase' ? '#3b82f6' : '#22c55e'
		if (a === 'charter_published') return '#f59e0b'
		return '#8b5cf6'
	}
	const jrText = (e: Entry) => {
		const a = e.action.replace(/^octoguard\./, '')
		const md = e.metadata ?? {}
		const v = String(md.version ?? '')
		if (a === 'charter_signed') return { who: e.target_label ?? e.actor_username ?? '', text: tFn(md.way === 'phrase' ? 'chpage.jr_signed_phrase' : 'chpage.jr_signed_hand', { charter: tFn(`og2.ev_charter_aud_${aud}`), v, read: typeof md.read_ms === 'number' ? fmtDuration(md.read_ms, tFn) : '' }) }
		if (a === 'charter_bot_stopped') return { who: tFn('chpage.jr_bot'), text: tFn(md.trap === 'clock' ? 'chpage.jr_bot_clock' : 'chpage.jr_bot_decoy', { name: e.target_label ?? '' }) }
		if (a === 'charter_published') return { who: e.actor_username ?? '', text: tFn(md.important ? 'chpage.jr_published_important' : 'chpage.jr_published', { v }) }
		return { who: e.actor_username ?? '', text: tFn(a === 'charter_enabled' ? 'chpage.jr_on' : 'chpage.jr_off', { charter: tFn(`og2.ev_charter_aud_${aud}`) }) }
	}
	const jrTime = (iso: string) => {
		const d = new Date(iso), now = new Date()
		return d.toDateString() === now.toDateString() ? d.toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString($locale, { day: 'numeric', month: 'short' })
	}
	const pledgePreview = (tone: Tone) => tFn(`charter.pledge_${tone === 'own' ? 'sober' : tone}`, { community: tk.community })
	const funnelRows = $derived.by(() => {
		const f = overview?.funnel
		if (!f) return []
		const top = f.opened || 0
		const pct = (n: number) => (top ? Math.round((100 * n) / top) : 0)
		return [
			{ k: 'opened', n: f.opened, w: top ? 100 : 0, c: 'var(--nx-text-muted)', pct: null },
			{ k: 'bottom', n: f.bottom, w: pct(f.bottom), c: '#3b82f6', pct: pct(f.bottom) },
			{ k: 'signed', n: f.signed, w: pct(f.signed), c: 'var(--nx-ok)', pct: pct(f.signed) },
			{ k: 'bots', n: f.bots, w: Math.min(100, pct(f.bots) * 4), c: 'var(--nx-bad)', pct: null },
		]
	})

	// L'aperçu : la porte telle qu'un membre la verra, avec le BROUILLON, sans rien envoyer
	let previewOpen = $state(false)
	const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z'
	// « Pas encore » : tant que la charte est éteinte (ou sans version), personne n'attend
	const waiting = $derived(!!ch?.enabled && ch?.current_version !== null)

	const PEN = 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4'
	const USERS = 'M9 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M2.5 20a6.5 6.5 0 0113 0 M16 4.6a3.5 3.5 0 010 6.8 M21.5 20a6.5 6.5 0 00-4-6'
	const SHIELD = 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z'
	const CHECK = 'M5 12l5 5L20 7'
	const CLOCK = 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2'
	const BOT = 'M5 9h14v10H5z M12 5v4 M9 13h.01 M15 13h.01 M9 16h6 M3 13v2 M21 13v2'
	const SEARCH = 'M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4'
	const TECH = ['door', 'journal', 'existing', 'team', 'rich', 'decoy', 'drawing', 'phrase', 'off']
</script>

<svelte:head><title>{tFn('chpage.title')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page ch-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d={PEN} /></span>
			<div>
				<h1 class="adm-title">{tFn('chpage.title')}</h1>
				<p class="adm-desc">{tFn('chpage.desc')}</p>
			</div>
		</div>
	</header>

	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}

	<div class="ch-tabs" role="tablist" aria-label={tFn('chpage.tabs_aria')}>
		{#each (['members', 'team'] as Aud[]) as a (a)}
			<button type="button" role="tab" class="ch-tab" aria-selected={aud === a} onclick={() => switchTo(a)}>
				<span class="ch-tab-ic" class:team={a === 'team'}><Icon d={a === 'members' ? USERS : SHIELD} /></span>
				<span><b>{tFn(`chpage.tab_${a}`)}</b><small>{tFn(`chpage.tab_${a}_sub`)}</small></span>
				<span class="pill" class:ok={charters[a]?.enabled}>{charters[a]?.enabled ? tFn('chpage.on') : tFn('chpage.off')}</span>
			</button>
		{/each}
	</div>

	{#if ch}
		<!-- État + chiffres -->
		<div class="ch-top">
			<section class="adm-card ch-state">
				<label class="og-switch big">
					<input type="checkbox" checked={ch.enabled} disabled={!canManage} onchange={(e) => saveSettings({ enabled: (e.currentTarget as HTMLInputElement).checked })} />
					<span class="og-track"></span>
					<span><b>{tFn(`chpage.state_${aud}_${ch.enabled ? 'on' : 'off'}`)}</b><small>{tFn(`chpage.sub_${aud}_${ch.enabled ? 'on' : 'off'}`)}</small></span>
				</label>
				<ul class="ready" aria-label={tFn('chpage.ready_aria')}>
					{#each (['title', 'rules', 'banner', 'pledge'] as const) as r (r)}
						<li class:ok={ch.readiness[r]}>{tFn(`chpage.ready_${r}`)}</li>
					{/each}
				</ul>
				{#if ch.enabled && ch.current_version === null}<p class="og-help warn">{tFn('chpage.no_version_hint')}</p>{/if}
				{#if setErr}<p class="og-error" role="alert">{setErr}</p>{/if}
				<button type="button" class="adm-btn adm-btn--sm" onclick={() => (previewOpen = true)}><Icon d={EYE} />{tFn('chpage.see_member')}</button>
			</section>
			<div class="adm-stats ch-stats">
				<div class="adm-stat"><div class="adm-stat-top"><span>{tFn('chpage.st_signed')}</span><Icon d={CHECK} cls="adm-stat-icon" /></div><div class="adm-stat-value">{overview?.signed ?? '·'}</div><div class="adm-stat-sub">{ch.current_version ? tFn('chpage.st_signed_sub', { v: String(ch.current_version) }) : tFn('chpage.not_published')}</div></div>
				<div class="adm-stat"><div class="adm-stat-top"><span>{tFn('chpage.st_pending')}</span><Icon d={CLOCK} cls="adm-stat-icon" /></div><div class="adm-stat-value">{overview?.pending ?? '·'}</div><div class="adm-stat-sub">{waiting ? tFn(`chpage.st_pending_sub_${aud}`) : tFn('chpage.st_pending_sub_off')}</div></div>
				<div class="adm-stat robots"><div class="adm-stat-top"><span>{tFn('chpage.st_bots')}</span><Icon d={BOT} cls="adm-stat-icon" /></div><div class="adm-stat-value">{overview?.bots_week ?? '·'}</div><div class="adm-stat-sub">{tFn('chpage.st_bots_sub')}</div></div>
			</div>
		</div>

		<!-- Le parcours -->
		<section class="adm-card">
			<div class="card-head"><h2>{tFn('chpage.funnel_title')}</h2><span class="small faint">{tFn('chpage.funnel_when')}</span></div>
			<div class="funnel">
				{#each funnelRows as f (f.k)}
					<div class="fn" style="--w:{f.w}%;--c:{f.c}"><b>{f.n}</b><span>{tFn(`chpage.fn_${f.k}`)}</span>{#if f.pct !== null}<small>{f.pct} %</small>{/if}</div>
				{/each}
			</div>
			<p class="small muted fn-note">
				{#if !overview?.funnel?.opened}{tFn('chpage.fn_note_empty')}{:else}
					{#if overview.avg_read_ms !== null}{tFn('chpage.fn_note_read', { t: fmtDuration(overview.avg_read_ms, tFn) })}{/if}
					{#if overview.dropoff} {tFn(overview.dropoff.count === 1 ? 'chpage.fn_note_drop_one' : 'chpage.fn_note_drop_other', { rule: overview.dropoff.title, n: String(overview.dropoff.count) })}{/if}
				{/if}
			</p>
		</section>

		<!-- L'éditeur, la case, la signature, les pièges -->
		<div class="ch-grid">
			<section class="adm-card ch-editor-card">
				<div class="card-head">
					<h2>{tFn('chpage.editor_title')}</h2>
					<span class="small faint">
						{published(ch)}
						{#if status === 'saving'} · {tFn('chpage.saving')}{:else if status === 'saved'} · {tFn('chpage.saved')}{:else if status === 'error'} · <span class="bad">{tFn('chpage.save_error')}</span>{:else if status === 'readonly'} · {tFn('chpage.readonly')}{/if}
					</span>
				</div>
				{#key aud}
					<CharterEditor audience={aud} html={ch.draft_html} onchange={onChange} />
				{/key}
			</section>

			<div class="ch-side">
				<section class="adm-card">
					<div class="card-head"><h2>{tFn('chpage.pledge_title')}</h2></div>
					<p class="og-help pledge-help">{tFn('chpage.pledge_help')}</p>
					<div class="opts" role="radiogroup" aria-label={tFn('chpage.pledge_aria')}>
						{#each (['sober', 'fun', 'kids'] as Tone[]) as tone (tone)}
							<label class="opt"><input type="radio" name="pledge-{aud}" value={tone} checked={ch.pledge_tone === tone} disabled={!canManage} onchange={() => setTone(tone)} /><span><b>{tFn(`chpage.tone_${tone}`)}</b><small>{pledgePreview(tone)}</small></span></label>
						{/each}
						<label class="opt"><input type="radio" name="pledge-{aud}" value="own" checked={ch.pledge_tone === 'own'} disabled={!canManage} onchange={() => setTone('own')} /><span><b>{tFn('chpage.tone_own')}</b><input class="adm-input" value={ch.pledge_own} maxlength="140" placeholder={tFn('chpage.own_ph')} disabled={!canManage} onfocus={() => { if (ch.pledge_tone !== 'own') setTone('own') }} oninput={(e) => setOwn((e.currentTarget as HTMLInputElement).value)} /></span></label>
					</div>
				</section>

				<section class="adm-card">
					<div class="card-head"><h2>{tFn('chpage.sign_title')}</h2></div>
					<label class="og-switch big">
						<input type="checkbox" checked={ch.draw_enabled} disabled={!canManage} onchange={(e) => saveSettings({ draw_enabled: (e.currentTarget as HTMLInputElement).checked })} />
						<span class="og-track"></span>
						<span><b>{tFn('chpage.draw_label')}</b><small>{tFn('chpage.draw_sub')}</small></span>
					</label>
					<p class="og-help draw-help">{tFn('chpage.draw_help')}</p>
				</section>

				<section class="adm-card">
					<div class="card-head"><h2>{tFn('chpage.traps_title')}</h2><span class="pill ok">{tFn('chpage.traps_count')}</span></div>
					<ol class="traps">
						{#each [1, 2, 3, 4] as n (n)}
							<li class:trap-star={n === 3}><span class="tn">{n}</span><span><b>{tFn(`chpage.trap${n}_t`)}</b><small>{tFn(`chpage.trap${n}_d`)}</small></span></li>
						{/each}
					</ol>
					<p class="small faint traps-proof">{tFn('chpage.traps_proof')}</p>
				</section>
			</div>
		</div>

		<!-- Tout voir, sans chercher -->
		<div class="ch-grid">
			<section class="adm-card flush sig-card">
				<div class="sig-head">
					<div class="adm-chips" role="tablist" aria-label={tFn('chpage.sig_aria')}>
						{#each (['recent', 'pending', 'bots'] as Tab[]) as x (x)}
							<button type="button" class="adm-chip" aria-pressed={tab === x} onclick={() => pickTab(x)}>{tFn(`chpage.tab_${x}`)} <span class="adm-chip-count">{lists[x].length}</span></button>
						{/each}
					</div>
					<label class="adm-search"><Icon d={SEARCH} /><input class="adm-input" bind:value={q} oninput={onSearch} placeholder={tFn('chpage.search_ph')} aria-label={tFn('chpage.search_ph')} /></label>
				</div>
				<div class="sig-cols">
					{#if tab === 'recent'}<span>{tFn('chpage.col_member')}</span><span>{tFn('chpage.col_when')}</span><span>{tFn('chpage.col_how')}</span><span>{tFn('chpage.col_read')}</span>
					{:else if tab === 'pending'}<span>{tFn('chpage.col_member')}</span><span>{tFn('chpage.col_since')}</span><span>{tFn('chpage.col_where')}</span><span></span>
					{:else}<span>{tFn('chpage.col_account')}</span><span>{tFn('chpage.col_when')}</span><span>{tFn('chpage.col_trap')}</span><span></span>{/if}
				</div>
				<div class="sig-list">
					{#if !shown.length}
						<p class="sig-empty">{q.trim() ? tFn('chpage.empty_search') : tFn(`chpage.empty_${tab}`)}</p>
					{:else}
						{#each shown as p, i (p.user_id + ':' + (p.signed_at ?? p.created_at ?? i))}
							<div class="sig-row">
								{#if tab === 'recent'}
									<span class="sig-who"><span class="av" style="--c:{colorOf(p.username)}">{p.username.slice(0, 1).toUpperCase()}</span><span><b>{p.username}</b><small>{tFn('chpage.version_n', { n: String(p.version) })}</small></span></span>
									<span class="t">{p.signed_at ? ago(p.signed_at, $locale) : ''}</span>
									<span><span class="tag {p.way}">{tFn(`chpage.way_${p.way}`)}</span></span>
									<span class="t hide-s">{fmtDuration(p.read_ms ?? 0, tFn)}</span>
								{:else if tab === 'pending'}
									{@const w = where(p)}
									<span class="sig-who"><span class="av" style="--c:{colorOf(p.username)}">{p.username.slice(0, 1).toUpperCase()}</span><b>{p.username}</b></span>
									<span class="t">{since(p.joined_at)}</span>
									<span><span class="tag {w.cls}">{w.text}</span></span>
									<span></span>
								{:else}
									<span class="sig-who"><span class="av" style="--c:#71717a">?</span><b>{p.username}</b></span>
									<span class="t">{p.created_at ? ago(p.created_at, $locale) : ''}</span>
									<span><span class="tag bad">{tFn(`chpage.trap_${p.trap}`)}</span></span>
									<span></span>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<div class="ch-side">
				<section class="adm-card">
					<div class="card-head"><h2>{tFn('chpage.jr_title')}</h2>{#if canOpenLog}<a class="small og-linkbtn" href="/admin/octoguard/logs">{tFn('chpage.jr_open')}</a>{/if}</div>
					<p class="og-help jr-help">{tFn('chpage.jr_help')}</p>
					<div class="jr">
						{#each journal as e (e.id)}
							{@const j = jrText(e)}
							<div class="jr-row"><time>{jrTime(e.created_at)}</time><span><span class="dot" style="--c:{jrColor(e)}"></span><b>{j.who}</b> {j.text}</span></div>
						{:else}
							<p class="small muted">{tFn('chpage.jr_empty')}</p>
						{/each}
					</div>
				</section>
				<section class="adm-card">
					<div class="card-head"><h2>{tFn('chpage.vers_title')}</h2></div>
					<div class="vers">
						{#each ch.versions as v, i (v.version)}
							<div class="ver" class:cur={i === 0}>
								<span class="vn">{v.version}</span>
								<span><b>{tFn('chpage.ver_n', { n: String(v.version) })}</b><small>{new Date(v.published_at).toLocaleDateString($locale, { day: 'numeric', month: 'short' })} · {v.version === 1 ? tFn('chpage.ver_first') : v.important ? tFn('chpage.ver_important') : tFn('chpage.ver_fix')}</small></span>
								<span class="small muted">{tFn(v.signatures === 1 ? 'chpage.ver_sigs_one' : 'chpage.ver_sigs_other', { n: String(v.signatures) })}</span>
							</div>
						{:else}
							<p class="small muted">{tFn('chpage.vers_empty')}</p>
						{/each}
					</div>
				</section>
			</div>
		</div>

		<!-- Publier -->
		{#if canManage}
			<section class="adm-card ch-publish">
				<div>
					<h2 class="h">{tFn('chpage.pub_title', { n: String(nextVersion) })}</h2>
					{#if nextVersion > 1}
						<label class="check"><input type="checkbox" bind:checked={important} /><span><b>{tFn('chpage.important_label')}</b><small>{tFn('chpage.important_sub')}</small></span></label>
					{:else}
						<p class="og-help">{tFn('chpage.pub_first_help')}</p>
					{/if}
				</div>
				<div class="adm-actions"><button type="button" class="adm-btn" onclick={() => (previewOpen = true)}><Icon d={EYE} />{tFn('chpage.preview')}</button><button type="button" class="adm-btn adm-btn--primary" disabled={publishing} onclick={publish}><Icon d={CHECK} />{tFn('chpage.publish')}</button></div>
				{#if pubMsg}<p class="small pub-msg" class:bad={!pubMsg.ok} role="status">{pubMsg.text}</p>{/if}
			</section>
		{/if}

		{#if previewOpen}
			<CharterDoor audience={aud} username={(page.data as any).user?.username ?? ''} preview={{ html: ch.draft_html, tone: ch.pledge_tone, own: ch.pledge_own, drawEnabled: ch.draw_enabled, community: (page.data as any).communityName ?? '' }} onclose={() => (previewOpen = false)} />
		{/if}

		<details class="adm-card more">
			<summary>{tFn('chpage.more_title')}</summary>
			<ul class="tech">
				{#each TECH as k (k)}<li><b>{tFn(`chpage.tech_${k}_b`)}</b> {tFn(`chpage.tech_${k}`)}</li>{/each}
			</ul>
		</details>
	{/if}
</div>

<style>
	.ch-page { display: flex; flex-direction: column; gap: 16px; }
	.ch-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 10px; }
	.ch-tab { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; text-align: left; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font: inherit; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
	.ch-tab b { display: block; font-size: 14px; font-weight: 650; }
	.ch-tab small { display: block; font-size: 12px; color: var(--nx-text-muted); margin-top: 2px; }
	.ch-tab[aria-selected="true"] { border-color: var(--nx-header-accent); box-shadow: inset 0 0 0 1px var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 6%, var(--nx-surface)); }
	.ch-tab-ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--nx-ok) 13%, transparent); color: var(--nx-ok); }
	.ch-tab-ic.team { background: color-mix(in srgb, #8b5cf6 14%, transparent); color: #8b5cf6; }
	.ch-tab-ic :global(svg) { width: 19px; height: 19px; }
	.pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: color-mix(in srgb, currentColor 10%, transparent); color: var(--nx-text-muted); white-space: nowrap; }
	.pill.ok { color: var(--nx-ok); }
	.card-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 12px; }
	.card-head h2, .h { margin: 0; font-size: 15px; font-weight: 600; }
	.small { font-size: 12px; } .faint { color: var(--nx-text-faint); } .muted { color: var(--nx-text-muted); } .bad { color: var(--nx-bad); }

	.ch-top { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.4fr); gap: 16px; align-items: stretch; }
	.ch-state { display: flex; flex-direction: column; justify-content: space-between; gap: 14px; align-items: flex-start; }
	.og-switch.big { align-items: flex-start; }
	.og-switch.big b { display: block; font-size: 14px; }
	.og-switch.big small { display: block; font-size: 12px; color: var(--nx-text-muted); margin-top: 2px; line-height: 1.45; font-weight: 400; }
	.og-switch.big :global(.og-track) { margin-top: 2px; }
	.warn { color: var(--nx-warn, #d97706); margin: 0; }
	.ch-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }
	.ch-stats .robots .adm-stat-value { color: var(--nx-bad); }
	/* Comme la maquette : l'intitulé petit et discret, le chiffre en grand */
	.ch-stats .adm-stat-top { font-size: 12.5px; font-weight: 500; color: var(--nx-text-muted); gap: 6px; }
	.ch-stats .adm-stat-top span { min-width: 0; }
	.ch-stats .adm-stat-value { font-size: 26px; line-height: 1.15; margin: 6px 0 2px; }
	.ready { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
	.ready li { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 600; border: 1px solid var(--nx-border); color: var(--nx-text-muted); }
	.ready li::before { content: "○"; }
	.ready li.ok { color: var(--nx-ok); border-color: color-mix(in srgb, var(--nx-ok) 35%, transparent); background: color-mix(in srgb, var(--nx-ok) 7%, transparent); }
	.ready li.ok::before { content: "✓"; }

	.funnel { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
	.fn { position: relative; padding: 12px 14px; border-radius: 10px; background: color-mix(in srgb, var(--nx-text) 3%, var(--nx-surface)); border: 1px solid var(--nx-border); overflow: hidden; }
	.fn::before { content: ""; position: absolute; left: 0; bottom: 0; height: 4px; width: var(--w); background: var(--c, var(--nx-header-accent)); border-radius: 0 4px 0 0; }
	.fn b { display: block; font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
	.fn span { font-size: 12px; color: var(--nx-text-muted); }
	.fn small { display: block; font-size: 11px; color: var(--nx-text-faint); margin-top: 2px; }
	.fn-note { margin: 10px 0 0; }

	.ch-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 16px; align-items: start; }
	.ch-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
	.ch-editor-card { min-width: 0; }
	.pledge-help, .draw-help, .jr-help { margin: 0 0 10px; }
	.draw-help { margin: 10px 0 0; }
	.opts { display: flex; flex-direction: column; gap: 6px; }
	.opt { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--nx-border); cursor: pointer; }
	.opt input[type=radio] { margin-top: 3px; accent-color: var(--nx-header-accent); }
	.opt b { display: block; font-size: 13px; }
	.opt small { display: block; font-size: 12px; color: var(--nx-text-muted); }
	.opt:has(input[type=radio]:checked) { border-color: var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 6%, var(--nx-surface)); }
	.opt .adm-input { margin-top: 6px; width: 100%; }
	.opt > span { flex: 1; min-width: 0; }
	.traps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
	.traps li { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; }
	.traps b { display: block; } .traps small { display: block; font-size: 12px; color: var(--nx-text-muted); line-height: 1.45; }
	.tn { flex: none; width: 22px; height: 22px; border-radius: 99px; display: grid; place-items: center; font-size: 11px; font-weight: 700; background: color-mix(in srgb, var(--nx-text) 8%, transparent); }
	.trap-star .tn { background: var(--nx-bad); color: #fff; }
	.trap-star { padding: 8px 10px; margin: 0 -10px; border-radius: 10px; background: color-mix(in srgb, var(--nx-bad) 7%, transparent); }
	.traps-proof { margin: 10px 0 0; }

	.flush { padding: 0; overflow: hidden; }
	.sig-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--nx-border); }
	.sig-cols, .sig-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, .9fr) minmax(0, .9fr); gap: 10px; align-items: center; padding: 9px 16px; }
	.sig-cols { font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--nx-text-muted); border-bottom: 1px solid var(--nx-border); }
	.sig-list { max-height: 380px; overflow: auto; }
	.sig-row { border-bottom: 1px solid color-mix(in srgb, var(--nx-border) 60%, transparent); font-size: 13px; }
	.sig-row:last-child { border-bottom: 0; }
	.sig-who { display: flex; align-items: center; gap: 9px; min-width: 0; }
	.av { width: 28px; height: 28px; border-radius: 99px; flex: none; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; background: var(--c, #6366f1); }
	.sig-who b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.sig-who small { display: block; font-size: 11px; color: var(--nx-text-muted); }
	.tag { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; border: 1px solid var(--nx-border); color: var(--nx-text-muted); white-space: nowrap; }
	.tag.hand { color: var(--nx-header-accent); border-color: color-mix(in srgb, var(--nx-header-accent) 35%, transparent); }
	.tag.phrase { color: #3b82f6; border-color: color-mix(in srgb, #3b82f6 35%, transparent); }
	.tag.bad { color: var(--nx-bad); border-color: color-mix(in srgb, var(--nx-bad) 35%, transparent); }
	.tag.old { color: var(--nx-warn, #d97706); border-color: color-mix(in srgb, var(--nx-warn, #d97706) 35%, transparent); }
	.t { color: var(--nx-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
	.sig-empty { padding: 26px 16px; text-align: center; font-size: 13px; color: var(--nx-text-muted); margin: 0; }

	.jr { display: flex; flex-direction: column; gap: 10px; }
	.jr-row { display: grid; grid-template-columns: 46px 1fr; gap: 8px; font-size: 12.5px; line-height: 1.45; }
	.jr-row time { font-variant-numeric: tabular-nums; color: var(--nx-text-faint); font-size: 12px; }
	.dot { display: inline-block; width: 7px; height: 7px; border-radius: 99px; background: var(--c); margin-right: 6px; vertical-align: 1px; }
	.vers { display: flex; flex-direction: column; gap: 8px; }
	.ver { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; font-size: 12.5px; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--nx-border); }
	.ver b { font-size: 13px; }
	.ver small { display: block; color: var(--nx-text-muted); font-size: 11.5px; }
	.vn { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-weight: 700; font-size: 12px; background: color-mix(in srgb, var(--nx-text) 7%, transparent); }
	.ver.cur { border-color: color-mix(in srgb, var(--nx-header-accent) 45%, var(--nx-border)); }
	.ver.cur .vn { background: var(--nx-header-accent); color: var(--nx-on-accent); }

	.ch-publish { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; }
	.check { position: relative; display: flex; gap: 10px; align-items: flex-start; margin-top: 8px; cursor: pointer; font-size: 13px; }
	.check input { margin-top: 3px; accent-color: var(--nx-header-accent); }
	.check small { display: block; font-size: 12px; color: var(--nx-text-muted); }
	.pub-msg { flex-basis: 100%; margin: 0; color: var(--nx-ok); }
	.pub-msg.bad { color: var(--nx-bad); }
	.more summary { cursor: pointer; font-weight: 600; font-size: 14px; }
	.tech { margin: 12px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.55; color: var(--nx-text-muted); list-style: disc; }
	.tech b { color: var(--nx-text); }

	@media (max-width: 960px) { .ch-top, .ch-grid { grid-template-columns: 1fr; } }
	@media (max-width: 760px) { .funnel { grid-template-columns: 1fr 1fr; } }
	@media (max-width: 640px) { .sig-cols { display: none; } .sig-row { grid-template-columns: 1fr auto; } .sig-row .hide-s { display: none; } }
	@media (max-width: 560px) { .ch-stats { grid-template-columns: 1fr 1fr; } .ch-stats .robots { grid-column: 1 / -1; } }
</style>
