<script lang="ts">
	// Webhooks de la communauté (D38-D39, maquette validée le 12/11/2026).
	// Deux sortes de destinations, séparées dès la liste : annonces publiques et
	// alertes de modération. Le serveur tient la règle (une destination publique ne
	// reçoit jamais la modération) ; l'écran ne fait que la rendre évidente.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	type Kind = 'public' | 'team'
	type Format = 'ntfy' | 'matrix' | 'discord' | 'slack' | 'json'
	type Dest = {
		id: string; name: string; kind: Kind; format: Format; url: string; has_secret: boolean; events: string[]
		include_text: boolean; options: { forum_categories?: string[] | null }; enabled: boolean
		consecutive_failures: number; paused_at: string | null; pause_reason: string | null
		last_ok_at: string | null; sent_7d: number; ok_7d: number
	}
	type Delivery = { id: string; event: string; label: string | null; attempt: number; status: string; http_status: number | null; duration_ms: number | null; error_code: string | null; request_body: string | null; response_body: string | null; created_at: string }
	type Draft = { id: string | null; name: string; kind: Kind; format: Format; url: string; secret: string; hasSecret: boolean; events: string[]; include_text: boolean; cats: string[]; enabled: boolean }

	const init = untrack(() => (data.data ?? {}) as Record<string, any>)
	const PUBLIC: string[] = init.families?.public ?? []
	const TEAM: string[] = init.families?.team ?? []
	const DEFAULTS: Record<Kind, string[]> = init.defaults ?? { public: [], team: [] }
	const ESTIMATES: Record<string, number> = init.estimates ?? {}
	const CATS: Array<{ id: string; name: string }> = init.forum_categories ?? []
	const FORMATS: Format[] = ['ntfy', 'matrix', 'discord', 'slack', 'json']
	const TAG: Record<Format, string> = { ntfy: 'ntfy', matrix: '[m]', discord: 'D', slack: '#', json: '{ }' }
	const HINT_URL: Record<Format, string> = { ntfy: 'https://ntfy.sh/…', matrix: 'https://hookshot…/webhook/…', discord: 'https://discord.com/api/webhooks/…', slack: 'https://hooks.slack.com/services/…', json: 'https://…' }

	let list = $state<Dest[]>(untrack(() => (init.destinations ?? []) as Dest[]))
	let draft = $state<Draft | null>(null)
	let picking = $state(false)
	let busy = $state(false)
	let msg = $state<{ ok: boolean; text: string } | null>(null)
	let test = $state<{ state: 'wait' | 'ok' | 'ko'; title: string; sub: string } | null>(null)
	let newSecret = $state('')
	let deliveries = $state<Delivery[]>([])
	let onlyFailed = $state(false)
	let openRow = $state<string | null>(null)
	let example = $state('')
	let codeLang = $state<'node' | 'py' | 'php'>('node')
	let catsOpen = $state(false)

	const current = $derived(draft?.id ? list.find((d) => d.id === draft!.id) ?? null : null)
	const teamChecked = $derived(draft ? draft.events.filter((e) => TEAM.includes(e)).length : 0)
	const total = $derived(draft ? draft.events.filter((e) => draft!.kind === 'team' || PUBLIC.includes(e)).reduce((n, e) => n + (ESTIMATES[e] ?? 0), 0) : 0)
	const examples = $derived(draft?.kind === 'team' ? ['mute', 'report', 'appeal', 'article'] : ['article', 'music', 'event', 'live'])
	$effect(() => { if (draft && !examples.includes(example)) example = examples[0] })

	function toDraft(d: Dest): Draft {
		return { id: d.id, name: d.name, kind: d.kind, format: d.format, url: d.url, secret: '', hasSecret: d.has_secret, events: [...d.events], include_text: d.include_text, cats: [...(d.options?.forum_categories ?? [])], enabled: d.enabled }
	}
	async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<{ ok: boolean; status: number; json: T & { code?: string } }> {
		const res = await apiFetch(fetch, `/admin/webhooks${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
		return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) }
	}
	// Le réglage est sous la liste, souvent hors de l'écran : choisir une
	// destination y descend et y pose le focus, sinon le clic semble ne rien faire.
	function revealEditor() {
		queueMicrotask(() => {
			const el = document.getElementById('wh-editing')
			el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
			el?.focus({ preventScroll: true })
		})
	}
	async function openDest(d: Dest) {
		if (draft?.id !== d.id) await select(d)
		revealEditor()
	}
	async function select(d: Dest) {
		draft = toDraft(d); picking = false; msg = null; test = null; newSecret = ''; openRow = null; catsOpen = false
		example = d.kind === 'team' ? 'mute' : 'article'
		const r = await api<{ deliveries: Delivery[] }>(`/${d.id}/deliveries`)
		deliveries = r.ok ? r.json.deliveries : []
	}
	function create(kind: Kind) {
		draft = { id: null, name: tFn(kind === 'public' ? 'wh.new_name_public' : 'wh.new_name_team'), kind, format: kind === 'public' ? 'discord' : 'ntfy', url: '', secret: '', hasSecret: false, events: [...DEFAULTS[kind]], include_text: false, cats: [], enabled: true }
		picking = false; msg = null; test = null; deliveries = []; newSecret = ''
		example = kind === 'team' ? 'mute' : 'article'
		revealEditor()
	}
	$effect(() => { if (!draft && list.length) untrack(() => select(list[0])) })

	// D39 : passer une destination d'équipe en publique retire la modération, après confirmation
	function setKind(k: Kind) {
		if (!draft || draft.kind === k) return
		if (k === 'public' && teamChecked > 0 && !confirm(tFn('wh.confirm_public', { name: draft.name, n: teamChecked }))) return
		draft.kind = k
		example = k === 'team' ? 'mute' : 'article'
		if (k === 'public') { draft.events = draft.events.filter((e) => PUBLIC.includes(e)); draft.include_text = false }
	}
	function toggle(f: string) {
		if (!draft) return
		draft.events = draft.events.includes(f) ? draft.events.filter((e) => e !== f) : [...draft.events, f]
	}
	function toggleCat(id: string) {
		if (!draft) return
		draft.cats = draft.cats.includes(id) ? draft.cats.filter((c) => c !== id) : [...draft.cats, id]
	}
	function genSecret() {
		const a = new Uint8Array(24); crypto.getRandomValues(a)
		newSecret = 'whsec_' + btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
		if (draft) draft.secret = newSecret
	}
	async function copy(text: string) { try { await navigator.clipboard.writeText(text) } catch { /* copie manuelle */ } }

	const ERR: Record<string, string> = {
		WEBHOOK_URL_FORBIDDEN: 'wh.err_forbidden', WEBHOOK_URL_UNRESOLVED: 'wh.err_unresolved', WEBHOOK_URL_INVALID: 'wh.err_invalid',
		WEBHOOK_TEAM_EVENTS_ON_PUBLIC: 'wh.err_team_on_public', WEBHOOK_TEXT_ON_PUBLIC: 'wh.err_team_on_public',
		WEBHOOK_TEST_RATE: 'wh.err_test_rate', VALIDATION_ERROR: 'wh.err_validation',
	}
	function body() {
		const d = draft!
		return {
			name: d.name.trim() || tFn('wh.unnamed'), kind: d.kind, format: d.format, url: d.url.trim(),
			...(d.format === 'json' && d.secret ? { secret: d.secret } : {}),
			events: d.events.filter((e) => d.kind === 'team' || PUBLIC.includes(e)),
			include_text: d.kind === 'team' && d.include_text, options: { forum_categories: d.cats.length ? d.cats : null }, enabled: d.enabled,
		}
	}
	async function save() {
		if (!draft || busy) return
		if (!draft.url.trim()) { msg = { ok: false, text: tFn('wh.err_need_url') }; return }
		busy = true; msg = null
		const r = draft.id ? await api<{ destination: Dest }>(`/${draft.id}`, 'PUT', body()) : await api<{ destination: Dest }>('', 'POST', body())
		busy = false
		if (!r.ok) { msg = { ok: false, text: tFn(ERR[r.json.code ?? ''] ?? 'wh.err_save') }; return }
		const d = r.json.destination
		list = draft.id ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d]
		newSecret = ''
		await select(d)
		msg = { ok: true, text: tFn('wh.saved') }
	}
	async function remove() {
		if (!draft?.id || !confirm(tFn('wh.confirm_delete', { name: draft.name }))) return
		const r = await api(`/${draft.id}`, 'DELETE')
		if (!r.ok) { msg = { ok: false, text: tFn('wh.err_save') }; return }
		list = list.filter((x) => x.id !== draft!.id); draft = null
		if (list.length) await select(list[0])
	}
	function explain(code: string | null, status: number | null): { title: string; sub: string } {
		if (code === 'WEBHOOK_URL_FORBIDDEN' || code === 'URL_FORBIDDEN') return { title: tFn('wh.t_forbidden'), sub: tFn('wh.t_forbidden_sub') }
		if (code === 'WEBHOOK_URL_UNRESOLVED' || code === 'URL_UNRESOLVED') return { title: tFn('wh.t_unresolved'), sub: tFn('wh.t_unresolved_sub') }
		if (code === 'WEBHOOK_URL_INVALID' || code === 'URL_INVALID') return { title: tFn('wh.t_invalid'), sub: tFn('wh.t_invalid_sub') }
		if (code === 'TIMEOUT') return { title: tFn('wh.t_timeout'), sub: tFn('wh.t_timeout_sub') }
		if (code === 'WEBHOOK_TEST_RATE') return { title: tFn('wh.err_test_rate'), sub: '' }
		if (status === 404) return { title: tFn('wh.t_404'), sub: tFn('wh.t_404_sub') }
		if (status === 401 || status === 403) return { title: tFn('wh.t_401', { s: status }), sub: tFn('wh.t_401_sub') }
		if (status === 429) return { title: tFn('wh.t_429'), sub: tFn('wh.t_429_sub') }
		if (status && status >= 500) return { title: tFn('wh.t_5xx', { s: status }), sub: tFn('wh.t_5xx_sub') }
		if (status && status >= 400) return { title: tFn('wh.t_4xx', { s: status }), sub: tFn('wh.t_4xx_sub') }
		return { title: tFn('wh.t_network'), sub: tFn('wh.t_network_sub') }
	}
	async function runTest(): Promise<boolean> {
		if (!draft) return false
		if (!draft.url.trim()) { test = { state: 'ko', title: tFn('wh.err_need_url'), sub: '' }; return false }
		test = { state: 'wait', title: tFn('wh.t_wait'), sub: tFn('wh.t_wait_sub') }
		const b: Record<string, unknown> = draft.id ? { destination_id: draft.id, url: draft.url.trim(), format: draft.format } : { kind: draft.kind, format: draft.format, url: draft.url.trim() }
		if (draft.format === 'json' && draft.secret) b.secret = draft.secret
		const r = await api<{ ok: boolean; http_status: number | null; duration_ms: number; error_code: string | null }>('/test', 'POST', b)
		if (r.ok && r.json.ok) {
			test = { state: 'ok', title: tFn('wh.t_ok', { ms: r.json.duration_ms, s: r.json.http_status ?? 200 }), sub: tFn(`wh.t_ok_${draft.format}`) }
			if (draft.id) { const d = await api<{ deliveries: Delivery[] }>(`/${draft.id}/deliveries`); if (d.ok) deliveries = d.json.deliveries }
			return true
		}
		test = { state: 'ko', ...explain(r.json.error_code ?? r.json.code ?? null, r.json.http_status ?? null) }
		return false
	}
	async function resume() {
		if (!draft?.id) return
		if (!(await runTest())) return
		const r = await api(`/${draft.id}/resume`, 'POST')
		if (r.ok) list = list.map((x) => (x.id === draft!.id ? { ...x, paused_at: null, consecutive_failures: 0 } : x))
	}

	const fmtTime = (iso: string) => new Date(iso).toLocaleString($locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
	const shown = $derived(onlyFailed ? deliveries.filter((d) => d.status !== 'ok' && d.status !== 'test_ok') : deliveries)
	const failedCount = $derived(deliveries.filter((d) => d.status !== 'ok' && d.status !== 'test_ok').length)
	const okRate = $derived(current && current.sent_7d ? Math.round((current.ok_7d / current.sent_7d) * 100) : null)
	function pretty(raw: string | null): string { if (!raw) return ''; try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw } }

	// L'aperçu : la forme de chaque outil, des exemples traduits (le serveur rend les vrais textes)
	const pv = $derived.by(() => {
		const e = example
		const fields = (k: string[]) => k.map((x) => [tFn(`wh.pv_${e}_f_${x}`), tFn(`wh.pv_${e}_v_${x}`)] as [string, string])
		const map: Record<string, { title: string; text: string; fields: Array<[string, string]>; color: string; team: boolean }> = {
			article: { title: tFn('wh.pv_article_title'), text: tFn('wh.pv_article_text'), fields: fields(['cat', 'by']), color: '#3b82f6', team: false },
			music: { title: tFn('wh.pv_music_title'), text: tFn('wh.pv_music_text'), fields: fields(['artist', 'dur']), color: '#8b5cf6', team: false },
			event: { title: tFn('wh.pv_event_title'), text: tFn('wh.pv_event_text'), fields: fields(['when', 'where']), color: '#f59e0b', team: false },
			live: { title: tFn('wh.pv_live_title'), text: tFn('wh.pv_live_text'), fields: fields(['game']), color: '#e5484d', team: false },
			mute: { title: tFn('wh.pv_mute_title'), text: tFn('wh.pv_mute_text'), fields: fields(['rule', 'where']), color: '#e5484d', team: true },
			report: { title: tFn('wh.pv_report_title'), text: tFn('wh.pv_report_text'), fields: fields(['where']), color: '#3b82f6', team: true },
			appeal: { title: tFn('wh.pv_appeal_title'), text: tFn('wh.pv_appeal_text'), fields: fields(['by']), color: '#a1a1aa', team: true },
		}
		return map[e] ?? map.article
	})
	// Les noms d'événements reconstruits par morceaux : écrits en toutes lettres, le
	// vérificateur i18n les prendrait pour des clés de traduction
	const pvJson = $derived(JSON.stringify({ version: 2, event: ({ article: ['forum', 'article'], music: ['music', 'track'], event: ['calendar', 'event'], live: ['live', 'started'], mute: ['sanction', 'mute'], report: ['report', 'created'], appeal: ['appeal', 'filed'] } as Record<string, string[]>)[example]?.join('.'), family: '…', delivery: 'd1c9e2f0-…', at: '2026-11-12T03:04:51Z', test: false, title: pv.title, text: pv.text, url: 'https://…' }, null, 2))

	const CODE = {
		node: `// Express: check that a delivery really comes from your community
import crypto from 'node:crypto'
const SECRET = process.env.NODYX_WEBHOOK_SECRET

app.post('/nodyx', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-Nodyx-Timestamp')
  const sig = req.get('X-Nodyx-Signature') ?? ''
  // Older than 5 minutes: refused (nobody can replay an old message)
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.sendStatus(401)
  const want = 'sha256=' + crypto.createHmac('sha256', SECRET).update(\`\${ts}.\${req.body}\`).digest('hex')
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)))
    return res.sendStatus(401)
  const event = JSON.parse(req.body)
  console.log(event.event, event.text)
  res.sendStatus(204)
})`,
		py: `# Flask: check that a delivery really comes from your community
import hmac, hashlib, os, time
from flask import Flask, request, abort

SECRET = os.environ['NODYX_WEBHOOK_SECRET'].encode()
app = Flask(__name__)

@app.post('/nodyx')
def nodyx():
    ts = request.headers.get('X-Nodyx-Timestamp', '0')
    sig = request.headers.get('X-Nodyx-Signature', '')
    if abs(time.time() - int(ts)) > 300:
        abort(401)
    want = 'sha256=' + hmac.new(SECRET, ts.encode() + b'.' + request.get_data(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, want):
        abort(401)
    event = request.get_json()
    print(event['event'], event['text'])
    return '', 204`,
		php: `<?php // Check that a delivery really comes from your community
$secret = getenv('NODYX_WEBHOOK_SECRET');
$body   = file_get_contents('php://input');
$ts     = $_SERVER['HTTP_X_NODYX_TIMESTAMP'] ?? '0';
$sig    = $_SERVER['HTTP_X_NODYX_SIGNATURE'] ?? '';

if (abs(time() - (int) $ts) > 300) { http_response_code(401); exit; }
$want = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, $secret);
if (!hash_equals($want, $sig)) { http_response_code(401); exit; }

$event = json_decode($body, true);
error_log($event['event'] . ' ' . $event['text']);
http_response_code(204);`,
	}
</script>

<svelte:head><title>{tFn('wh.title')}</title></svelte:head>

<div class="adm-page wh">
	<header class="adm-head">
		<div class="wh-head">
			<span class="wh-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></svg></span>
			<div>
				<h1 class="adm-title">{tFn('wh.title')}</h1>
				<p class="adm-desc">{tFn('wh.desc')}</p>
			</div>
		</div>
	</header>

	{#if data.failed}<p class="wh-err" role="alert">{tFn('wh.err_load')}</p>{/if}

	<div class="wh-uses">
		{#each ['announce', 'phone', 'team', 'auto'] as u (u)}
			<div class="wh-use"><b>{tFn(`wh.use_${u}`)}</b><span>{tFn(`wh.use_${u}_sub`)}</span></div>
		{/each}
	</div>

	<!-- Les destinations, en deux groupes -->
	<section class="adm-card wh-flush" aria-labelledby="wh-dests">
		<div class="wh-bar"><h2 id="wh-dests" class="wh-h2">{tFn('wh.dests')}</h2><button type="button" class="adm-btn adm-btn--sm adm-btn--primary" onclick={() => (picking = !picking)}>{tFn('wh.add')}</button></div>
		{#if picking}
			<div class="wh-pick">
				<p class="wh-pick-q"><b>{tFn('wh.pick_q')}</b> {tFn('wh.pick_sub')}</p>
				<div class="wh-aud">
					<button type="button" class="wh-audc wh-audc--public" onclick={() => create('public')}><b>{tFn('wh.kind_public_new')}</b><span>{tFn('wh.kind_public_new_sub')}</span></button>
					<button type="button" class="wh-audc wh-audc--team" onclick={() => create('team')}><b>{tFn('wh.kind_team_new')}</b><span>{tFn('wh.kind_team_new_sub')}</span></button>
				</div>
			</div>
		{/if}
		{#each (['public', 'team'] as Kind[]) as k (k)}
			<div class="wh-group wh-group--{k}">{tFn(`wh.group_${k}`)}</div>
			{#each list.filter((d) => d.kind === k) as d (d.id)}
				<button type="button" class="wh-row" aria-current={draft?.id === d.id} onclick={() => openDest(d)}>
					<span class="wh-tool">{TAG[d.format]}</span>
					<span class="wh-nm"><b>{d.name}</b><span>{tFn(`wh.fmt_${d.format}`)} · {tFn('wh.row_sub', { n: d.sent_7d })}{d.last_ok_at ? ` · ${tFn('wh.row_last', { at: fmtTime(d.last_ok_at) })}` : ''}</span></span>
					<span class="wh-badge wh-badge--{d.kind}">{tFn(`wh.badge_${d.kind}`)}</span>
					{#if d.paused_at}<span class="wh-pill wh-pill--warn">{tFn('wh.st_paused')}</span>
					{:else if !d.enabled}<span class="wh-pill">{tFn('wh.st_off')}</span>
					{:else}<span class="wh-pill wh-pill--ok">{tFn('wh.st_on')}</span>{/if}
					<span class="wh-edit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>{tFn('common.edit')}</span>
				</button>
			{:else}
				<p class="wh-empty">{tFn(`wh.group_empty_${k}`)}</p>
			{/each}
		{/each}
	</section>

	{#if draft}
		{#if current?.paused_at}
			<div class="wh-pause" role="status">
				<b>{tFn('wh.paused_title', { at: fmtTime(current.paused_at) })}</b>
				<p>{tFn('wh.paused_sub', { reason: current.pause_reason ?? '' })}</p>
				<button type="button" class="adm-btn adm-btn--sm adm-btn--primary" disabled={test?.state === 'wait'} onclick={resume}>{tFn('wh.resume')}</button>
			</div>
		{/if}

		<div class="wh-editing" id="wh-editing" tabindex="-1"><span>{tFn('wh.editing')}</span> <b>{draft.name || tFn('wh.unnamed')}</b> <span class="wh-badge wh-badge--{draft.kind}">{tFn(`wh.badge_${draft.kind}`)}</span></div>

		<!-- 1. L'outil -->
		<div class="wh-step"><span class="wh-n">1</span><div><h2>{tFn('wh.s1')}</h2><p>{tFn('wh.s1_sub')}</p></div></div>
		<div class="wh-dests" role="radiogroup" aria-label={tFn('wh.s1')}>
			{#each FORMATS as f (f)}
				<button type="button" role="radio" aria-checked={draft.format === f} class="wh-dest" onclick={() => { draft!.format = f; test = null }}>
					<span class="wh-dest-ic">{TAG[f]}</span><b>{tFn(`wh.fmt_${f}`)}</b><span>{tFn(`wh.fmt_${f}_sub`)}</span>
				</button>
			{/each}
		</div>

		<div class="wh-grid">
			<div class="adm-card wh-col">
				<div class="wh-bar wh-bar--tight"><h2 class="wh-h2">{tFn(`wh.setup_${draft.format}`)}</h2><span class="wh-pill wh-pill--acc">{tFn(`wh.time_${draft.format}`)}</span></div>
				<ol class="wh-howto">
					{#each [1, 2, 3] as i (i)}<li>{tFn(`wh.how_${draft.format}_${i}`)}</li>{/each}
				</ol>
				<label class="wh-field"><span class="wh-lbl">{tFn('wh.name')}</span><input class="adm-input" maxlength="60" bind:value={draft.name} /><span class="wh-help">{tFn('wh.name_help')}</span></label>
				<label class="wh-field">
					<span class="wh-lbl">{tFn('wh.url')}
						<span class="wh-tip" tabindex="0" role="button" aria-label={tFn('wh.help')}>?<span class="wh-tipbox" role="tooltip">{tFn('wh.url_tip')}</span></span>
					</span>
					<input class="adm-input wh-mono" type="url" spellcheck="false" autocomplete="off" placeholder={HINT_URL[draft.format]} bind:value={draft.url} />
					<span class="wh-help">{tFn(`wh.url_help_${draft.format}`)}</span>
				</label>
				{#if draft.format === 'json'}
					<div class="wh-field">
						<span class="wh-lbl">{tFn('wh.secret')}<span class="wh-tip" tabindex="0" role="button" aria-label={tFn('wh.help')}>?<span class="wh-tipbox" role="tooltip">{tFn('wh.secret_tip')}</span></span></span>
						<div class="wh-secret">
							<input class="adm-input wh-mono" readonly value={newSecret} placeholder={tFn(draft.hasSecret ? 'wh.secret_set' : 'wh.secret_none')} />
							<button type="button" class="adm-btn adm-btn--sm" onclick={genSecret}>{tFn('wh.secret_gen')}</button>
							<button type="button" class="adm-btn adm-btn--sm" disabled={!newSecret} onclick={() => copy(newSecret)}>{tFn('wh.copy')}</button>
						</div>
						<span class="wh-help">{newSecret ? tFn('wh.secret_now') : tFn('wh.secret_help')}</span>
					</div>
				{/if}
				<div class="wh-actions">
					<button type="button" class="adm-btn" disabled={test?.state === 'wait'} onclick={runTest}>{tFn('wh.test')}</button>
					<span class="wh-actions-r">
						<label class="wh-switch"><input type="checkbox" bind:checked={draft.enabled} /><span class="wh-tr"></span>{tFn('wh.enabled')}</label>
						<button type="button" class="adm-btn adm-btn--primary" disabled={busy} onclick={save}>{tFn('wh.save')}</button>
					</span>
				</div>
				{#if test}
					<div class="wh-test wh-test--{test.state}" role="status"><b>{test.title}</b>{#if test.sub}<span>{test.sub}</span>{/if}</div>
				{/if}
				{#if msg}<p class={msg.ok ? 'wh-ok' : 'wh-err'} role="status">{msg.text}</p>{/if}
				{#if draft.id}<button type="button" class="wh-del" onclick={remove}>{tFn('wh.delete')}</button>{/if}
			</div>

			<div class="adm-card wh-col">
				<div class="wh-bar wh-bar--tight wh-wrap">
					<h2 class="wh-h2">{tFn('wh.preview')}</h2>
					<select class="adm-input wh-sel" bind:value={example} aria-label={tFn('wh.preview_ex')}>
						{#each examples as e (e)}<option value={e}>{tFn(`wh.ex_${e}`)}</option>{/each}
					</select>
				</div>
				{#if draft.format === 'ntfy'}
					<div class="pv-phone"><div class="pv-clock">03:04</div><div class="pv-notif"><span class="pv-app">N</span><b>{pv.title}</b><span class="pv-m">{pv.text} · {pv.fields.map((f) => f[1]).join(' · ')}</span></div></div>
				{:else if draft.format === 'json'}
					<pre class="wh-code">{pvJson}</pre>
				{:else}
					<div class="pv-chat pv-chat--{draft.format}">
						<span class="pv-av">{pv.team ? 'O' : 'N'}</span>
						<div class="pv-body">
							<div class="pv-who">{pv.team ? 'OctoGuard' : tFn('wh.pv_community')} <span class="pv-bot">{tFn('wh.pv_app')}</span></div>
							<div class="pv-embed" style="--c:{pv.color}"><b>{pv.title}</b><span>{pv.text}</span><span class="pv-f">{#each pv.fields as [k, v] (k)}<span><b>{k}</b> {v}</span>{/each}</span><span class="pv-link">{tFn('wh.pv_link')} →</span></div>
						</div>
					</div>
				{/if}
				<p class="wh-help">{tFn(`wh.pv_help_${draft.format}`)}</p>
			</div>
		</div>

		<!-- 2. Qui lit (D39) -->
		<div class="wh-step"><span class="wh-n">2</span><div><h2>{tFn('wh.s2')}</h2><p>{tFn('wh.s2_sub')}</p></div></div>
		<div class="wh-aud" role="radiogroup" aria-label={tFn('wh.s2')}>
			<button type="button" role="radio" aria-checked={draft.kind === 'public'} class="wh-audc wh-audc--public" onclick={() => setKind('public')}><b>{tFn('wh.kind_public')}</b><span>{tFn('wh.kind_public_sub')}</span></button>
			<button type="button" role="radio" aria-checked={draft.kind === 'team'} class="wh-audc wh-audc--team" onclick={() => setKind('team')}><b>{tFn('wh.kind_team')}</b><span>{tFn('wh.kind_team_sub')}</span></button>
		</div>

		<!-- 3. Quoi envoyer -->
		<div class="wh-step"><span class="wh-n">3</span><div><h2>{tFn('wh.s3')}</h2><p>{tFn('wh.s3_sub')}</p></div></div>
		<section class="adm-card wh-flush">
			<div class="wh-evgroup"><b>{tFn('wh.fam_public')}</b><span>{tFn('wh.fam_public_sub')}</span></div>
			{#each PUBLIC as f (f)}
				<div class="wh-ev" class:wh-ev--off={!draft.events.includes(f)}>
					<span class="wh-ev-t"><b>{tFn(`wh.f_${f}`)}</b><span>{tFn(`wh.f_${f}_sub`)}</span>
						{#if f === 'forum_article' && CATS.length}
							<button type="button" class="wh-link" onclick={() => (catsOpen = !catsOpen)}>{draft.cats.length ? tFn('wh.cats_n', { n: draft.cats.length }) : tFn('wh.cats_all')}</button>
							{#if catsOpen}<span class="wh-cats">{#each CATS as c (c.id)}<button type="button" class="adm-chip" aria-pressed={draft.cats.includes(c.id)} onclick={() => toggleCat(c.id)}>{c.name}</button>{/each}</span>{/if}
						{/if}
					</span>
					<span class="wh-ev-n">{tFn('wh.per_week', { n: ESTIMATES[f] ?? 0 })}</span>
					<label class="wh-switch"><input type="checkbox" checked={draft.events.includes(f)} onchange={() => toggle(f)} aria-label={tFn(`wh.f_${f}`)} /><span class="wh-tr"></span></label>
				</div>
			{/each}
			<div class="wh-evgroup wh-evgroup--team"><b>{tFn('wh.fam_team')}</b><span>{tFn(draft.kind === 'public' ? 'wh.fam_team_never' : 'wh.fam_team_ok')}</span></div>
			{#if draft.kind === 'public'}
				<p class="wh-lock">{tFn('wh.lock')} <button type="button" class="wh-link" onclick={() => { picking = true; window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{tFn('wh.lock_add')}</button></p>
			{:else}
				{#each TEAM as f (f)}
					<div class="wh-ev" class:wh-ev--off={!draft.events.includes(f)}>
						<span class="wh-ev-t"><b>{tFn(`wh.f_${f}`)}</b><span>{tFn(`wh.f_${f}_sub`)}</span></span>
						<span class="wh-ev-n">{tFn('wh.per_week', { n: ESTIMATES[f] ?? 0 })}</span>
						<label class="wh-switch"><input type="checkbox" checked={draft.events.includes(f)} onchange={() => toggle(f)} aria-label={tFn(`wh.f_${f}`)} /><span class="wh-tr"></span></label>
					</div>
				{/each}
			{/if}
			<div class="wh-evfoot">
				<span>{tFn('wh.total', { n: total })}</span>
				{#if draft.kind === 'team'}
					<label class="wh-switch wh-ml"><input type="checkbox" bind:checked={draft.include_text} /><span class="wh-tr"></span>{tFn('wh.with_text')}</label>
					<span class="wh-tip" tabindex="0" role="button" aria-label={tFn('wh.help')}>?<span class="wh-tipbox wh-tipbox--r" role="tooltip">{tFn('wh.with_text_tip')}</span></span>
				{/if}
			</div>
		</section>
		<p class="wh-help">{tFn('wh.never')}</p>

		<!-- 4. Les envois -->
		{#if draft.id}
			<div class="wh-step"><span class="wh-n">4</span><div><h2>{tFn('wh.s4')}</h2><p>{tFn('wh.s4_sub')}</p></div></div>
			<section class="adm-card wh-flush">
				<div class="wh-bar">
					<span class="adm-chips"><button type="button" class="adm-chip" aria-pressed={!onlyFailed} onclick={() => (onlyFailed = false)}>{tFn('wh.all')} {deliveries.length}</button><button type="button" class="adm-chip" aria-pressed={onlyFailed} onclick={() => (onlyFailed = true)}>{tFn('wh.failed')} {failedCount}</button></span>
					{#if okRate !== null}<span class="wh-help">{tFn('wh.rate', { p: okRate })}</span>{/if}
				</div>
				{#if shown.length === 0}
					<p class="wh-empty wh-center">{tFn(onlyFailed ? 'wh.none_failed' : 'wh.none_yet')}</p>
				{:else}
					<div class="wh-tblwrap"><table class="wh-tbl">
						<thead><tr><th>{tFn('wh.c_when')}</th><th>{tFn('wh.c_event')}</th><th>{tFn('wh.c_result')}</th><th class="wh-hide-s">{tFn('wh.c_time')}</th></tr></thead>
						<tbody>
							{#each shown as d (d.id)}
								<tr class="wh-tr-row" onclick={() => (openRow = openRow === d.id ? null : d.id)}>
									<td class="wh-mono wh-faint">{fmtTime(d.created_at)}</td>
									<td>{d.status.startsWith('test') ? tFn('wh.test_row') : (d.label ?? d.event)}</td>
									<td><span class="wh-pill {d.status === 'ok' || d.status === 'test_ok' ? 'wh-pill--ok' : d.status === 'retry' ? 'wh-pill--warn' : 'wh-pill--bad'}">{tFn(`wh.d_${d.status}`)}{d.http_status ? ` · ${d.http_status}` : d.error_code ? ` · ${d.error_code}` : ''}</span></td>
									<td class="wh-hide-s wh-faint">{d.duration_ms ?? '·'} ms</td>
								</tr>
								{#if openRow === d.id}
									<tr><td colspan="4" class="wh-detail">
										<div class="wh-dgrid"><div><h4>{tFn('wh.sent')}</h4><pre class="wh-code">{pretty(d.request_body)}</pre></div><div><h4>{tFn('wh.answered')}</h4><pre class="wh-code">{d.http_status ? `HTTP ${d.http_status}\n\n` : ''}{d.response_body ?? d.error_code ?? ''}</pre></div></div>
									</td></tr>
								{/if}
							{/each}
						</tbody>
					</table></div>
				{/if}
			</section>
		{/if}

		<!-- 5. Développeurs -->
		{#if draft.format === 'json'}
			<div class="wh-step"><span class="wh-n">5</span><div><h2>{tFn('wh.s5')}</h2><p>{tFn('wh.s5_sub')}</p></div></div>
			<div class="wh-grid">
				<div class="adm-card wh-col">
					<h2 class="wh-h2">{tFn('wh.headers')}</h2>
					<dl class="wh-hdrs">
						{#each ['event', 'delivery', 'timestamp', 'signature'] as h (h)}<dt class="wh-mono">X-Nodyx-{h[0].toUpperCase() + h.slice(1)}</dt><dd>{tFn(`wh.h_${h}`)}</dd>{/each}
					</dl>
					<p class="wh-help">{tFn('wh.version_help')}</p>
				</div>
				<div class="adm-card wh-col">
					<div class="wh-bar wh-bar--tight"><span class="adm-chips">{#each (['node', 'py', 'php'] as const) as l (l)}<button type="button" class="adm-chip" aria-pressed={codeLang === l} onclick={() => (codeLang = l)}>{{ node: 'Node.js', py: 'Python', php: 'PHP' }[l]}</button>{/each}</span><button type="button" class="adm-btn adm-btn--sm" onclick={() => copy(CODE[codeLang])}>{tFn('wh.copy')}</button></div>
					<pre class="wh-code">{CODE[codeLang]}</pre>
				</div>
			</div>
		{/if}

		<section class="adm-card">
			<h2 class="wh-h2">{tFn('wh.know')}</h2>
			<ul class="wh-know">{#each ['queue', 'retry', 'ssrf', 'og', 'journal'] as k (k)}<li><b>{tFn(`wh.know_${k}`)}</b><span>{tFn(`wh.know_${k}_sub`)}</span></li>{/each}</ul>
		</section>
	{/if}
</div>

<style>
	.wh { display: flex; flex-direction: column; gap: 1.25rem; }
	.wh-head { display: flex; gap: 0.875rem; align-items: flex-start; }
	.wh-mark { width: 2.5rem; height: 2.5rem; border-radius: 10px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--nx-header-accent) 13%, transparent); color: var(--nx-header-accent); }
	.wh-mark svg { width: 1.25rem; height: 1.25rem; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
	.wh-uses { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 0.625rem; }
	.wh-use { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.875rem; border-radius: 12px; border: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-text) 2%, var(--nx-surface)); font-size: 0.78rem; color: var(--nx-text-muted); }
	.wh-use b { color: var(--nx-text); font-size: 0.85rem; font-weight: 600; }
	.wh-flush { padding: 0 !important; overflow: hidden; }
	.wh-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem 1rem; padding: 0.75rem 0.875rem; border-bottom: 1px solid var(--nx-border); }
	.wh-bar--tight { padding: 0; border: 0; }
	.wh-h2 { margin: 0; font-size: 0.95rem; font-weight: 600; }
	.wh-pick { padding: 0.875rem; border-bottom: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-header-accent) 5%, var(--nx-surface)); }
	.wh-pick-q { margin: 0 0 0.625rem; font-size: 0.85rem; }
	.wh-group { padding: 0.625rem 0.875rem 0.375rem; font-size: 0.7rem; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--nx-ok); }
	.wh-group--team { color: #8b5cf6; border-top: 1px solid var(--nx-border); }
	.wh-row { display: grid; grid-template-columns: 2.125rem minmax(0, 1fr) auto auto auto; gap: 0.75rem; align-items: center; width: 100%; padding: 0.7rem 0.875rem; text-align: left; background: none; border: 0; border-left: 3px solid transparent; border-bottom: 1px solid color-mix(in srgb, var(--nx-border) 60%, transparent); color: inherit; font: inherit; cursor: pointer; }
	.wh-row:hover { background: color-mix(in srgb, var(--nx-text) 2.5%, transparent); }
	.wh-row[aria-current='true'] { background: color-mix(in srgb, var(--nx-header-accent) 7%, transparent); border-left-color: var(--nx-header-accent); }
	.wh-edit { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.55rem; border-radius: 8px; border: 1px solid var(--nx-border); font-size: 0.75rem; font-weight: 600; color: var(--nx-text-muted); white-space: nowrap; transition: color 0.15s, border-color 0.15s, background 0.15s; }
	.wh-edit svg { width: 0.85rem; height: 0.85rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.wh-row:hover .wh-edit, .wh-row:focus-visible .wh-edit, .wh-row[aria-current='true'] .wh-edit { color: var(--nx-header-accent); border-color: color-mix(in srgb, var(--nx-header-accent) 45%, var(--nx-border)); background: color-mix(in srgb, var(--nx-header-accent) 8%, transparent); }
	.wh-editing { scroll-margin-top: 1rem; outline: none; }
	.wh-tool { width: 2.125rem; height: 2.125rem; border-radius: 9px; display: grid; place-items: center; font: 700 0.7rem ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--nx-text) 6%, transparent); }
	.wh-nm { display: flex; flex-direction: column; min-width: 0; }
	.wh-nm b { font-size: 0.85rem; font-weight: 600; }
	.wh-nm span { font-size: 0.75rem; color: var(--nx-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.wh-empty { margin: 0; padding: 0.75rem 0.875rem; font-size: 0.8rem; color: var(--nx-text-muted); }
	.wh-center { text-align: center; padding: 1.5rem; }
	.wh-badge { display: inline-flex; padding: 0.05rem 0.5rem; border-radius: 99px; font-size: 0.7rem; font-weight: 650; white-space: nowrap; }
	.wh-badge--public { color: var(--nx-ok); background: color-mix(in srgb, var(--nx-ok) 12%, transparent); }
	.wh-badge--team { color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 13%, transparent); }
	.wh-pill { display: inline-flex; padding: 0.05rem 0.5rem; border-radius: 99px; font-size: 0.7rem; font-weight: 600; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); color: var(--nx-text-muted); white-space: nowrap; }
	.wh-pill--ok { color: var(--nx-ok); } .wh-pill--warn { color: var(--nx-warn); } .wh-pill--bad { color: var(--nx-bad); } .wh-pill--acc { color: var(--nx-header-accent); }
	.wh-pause { padding: 0.875rem 1rem; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--nx-warn) 45%, transparent); background: color-mix(in srgb, var(--nx-warn) 9%, var(--nx-surface)); display: flex; flex-direction: column; gap: 0.375rem; align-items: flex-start; }
	.wh-pause p { margin: 0; font-size: 0.82rem; color: var(--nx-text-muted); }
	.wh-editing { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.95rem; }
	.wh-editing > span:first-child { font-size: 0.78rem; color: var(--nx-text-muted); }
	.wh-step { display: flex; gap: 0.75rem; align-items: flex-start; margin-top: 0.25rem; }
	.wh-n { width: 1.75rem; height: 1.75rem; border-radius: 99px; display: grid; place-items: center; flex: none; font-weight: 700; font-size: 0.8rem; background: var(--nx-header-accent); color: #16120c; }
	.wh-step h2 { margin: 0; font-size: 1.05rem; font-weight: 650; }
	.wh-step p { margin: 0.125rem 0 0; font-size: 0.82rem; color: var(--nx-text-muted); }
	.wh-dests { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10.5rem), 1fr)); gap: 0.625rem; }
	.wh-dest { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; padding: 0.875rem; text-align: left; border-radius: 12px; border: 1px solid var(--nx-border); background: var(--nx-surface); cursor: pointer; font: inherit; font-size: 0.75rem; color: var(--nx-text-muted); }
	.wh-dest b { color: var(--nx-text); font-size: 0.875rem; }
	.wh-dest[aria-checked='true'] { border-color: var(--nx-header-accent); box-shadow: inset 0 0 0 1px var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 6%, var(--nx-surface)); }
	.wh-dest-ic { min-width: 2.125rem; height: 2.125rem; padding: 0 0.375rem; border-radius: 9px; display: grid; place-items: center; font: 700 0.75rem ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--nx-text) 6%, transparent); color: var(--nx-text); margin-bottom: 0.25rem; }
	.wh-dest[aria-checked='true'] .wh-dest-ic { background: var(--nx-header-accent); color: #16120c; }
	.wh-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; }
	.wh-col { display: flex; flex-direction: column; gap: 0.875rem; min-width: 0; }
	.wh-wrap { flex-wrap: wrap; }
	.wh-sel { width: auto; max-width: 100%; }
	.wh-howto { margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.82rem; line-height: 1.5; }
	.wh-field { display: flex; flex-direction: column; gap: 0.375rem; }
	.wh-lbl { font-size: 0.78rem; font-weight: 600; display: flex; align-items: center; gap: 0.375rem; }
	.wh-help { margin: 0; font-size: 0.75rem; color: var(--nx-text-muted); }
	.wh-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; }
	.wh-faint { color: var(--nx-text-muted); white-space: nowrap; }
	.wh-secret { display: flex; gap: 0.375rem; flex-wrap: wrap; }
	.wh-secret .adm-input { flex: 1 1 14rem; }
	.wh-actions { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; }
	.wh-actions-r { display: flex; align-items: center; gap: 0.75rem; }
	.wh-test { display: flex; flex-direction: column; gap: 0.125rem; padding: 0.7rem 0.8rem; border-radius: 10px; font-size: 0.82rem; border: 1px solid var(--nx-border); }
	.wh-test span { color: var(--nx-text-muted); font-size: 0.78rem; }
	.wh-test--ok { border-color: color-mix(in srgb, var(--nx-ok) 40%, transparent); background: color-mix(in srgb, var(--nx-ok) 8%, transparent); }
	.wh-test--ko { border-color: color-mix(in srgb, var(--nx-bad) 40%, transparent); background: color-mix(in srgb, var(--nx-bad) 7%, transparent); }
	.wh-ok { margin: 0; font-size: 0.8rem; color: var(--nx-ok); }
	.wh-err { margin: 0; font-size: 0.8rem; color: var(--nx-bad); }
	.wh-del { align-self: flex-start; background: none; border: 0; padding: 0; color: var(--nx-bad); font: inherit; font-size: 0.78rem; cursor: pointer; }
	.wh-link { background: none; border: 0; padding: 0; color: var(--nx-header-accent); font: inherit; font-size: 0.75rem; font-weight: 600; cursor: pointer; text-align: left; }
	.wh-aud { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: 0.625rem; }
	.wh-audc { --a: var(--nx-ok); display: flex; flex-direction: column; gap: 0.125rem; text-align: left; padding: 0.875rem; border-radius: 12px; border: 1px solid var(--nx-border); background: var(--nx-surface); cursor: pointer; font: inherit; font-size: 0.78rem; color: var(--nx-text-muted); }
	.wh-audc--team { --a: #8b5cf6; }
	.wh-audc b { color: var(--nx-text); font-size: 0.875rem; }
	.wh-audc:hover { border-color: color-mix(in srgb, var(--a) 50%, var(--nx-border)); }
	.wh-audc[aria-checked='true'] { border-color: var(--a); box-shadow: inset 0 0 0 1px var(--a); background: color-mix(in srgb, var(--a) 6%, var(--nx-surface)); }
	.wh-evgroup { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.625rem; padding: 0.75rem 1.125rem; border-bottom: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-text) 2%, var(--nx-surface)); font-size: 0.75rem; color: var(--nx-text-muted); }
	.wh-evgroup b { font-size: 0.875rem; color: var(--nx-ok); }
	.wh-evgroup--team { border-top: 1px solid var(--nx-border); }
	.wh-evgroup--team b { color: #8b5cf6; }
	.wh-ev { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.75rem; align-items: center; padding: 0.75rem 1.125rem; border-bottom: 1px solid color-mix(in srgb, var(--nx-border) 60%, transparent); }
	.wh-ev--off .wh-ev-t { opacity: 0.6; }
	.wh-ev-t { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
	.wh-ev-t b { font-size: 0.85rem; font-weight: 600; }
	.wh-ev-t > span { font-size: 0.75rem; color: var(--nx-text-muted); }
	.wh-ev-n { font-size: 0.75rem; color: var(--nx-text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
	.wh-cats { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.25rem; }
	.wh-lock { margin: 0; padding: 0.875rem 1.125rem; font-size: 0.82rem; color: var(--nx-text-muted); border-bottom: 1px solid color-mix(in srgb, var(--nx-border) 60%, transparent); }
	.wh-evfoot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.875rem; padding: 0.75rem 1.125rem; font-size: 0.82rem; background: color-mix(in srgb, var(--nx-text) 2%, var(--nx-surface)); }
	.wh-ml { margin-left: auto; }
	/* Interrupteur : la case est DANS son libellé positionné (cf. #968, la page ne remonte pas) */
	.wh-switch { position: relative; display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.82rem; }
	.wh-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; inset: 0; }
	.wh-tr { position: relative; width: 2rem; height: 1.125rem; border-radius: 99px; background: color-mix(in srgb, var(--nx-text) 18%, transparent); flex: none; transition: background 0.15s; }
	.wh-tr::after { content: ''; position: absolute; top: 2px; left: 2px; width: 0.875rem; height: 0.875rem; border-radius: 99px; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 0.3); transition: transform 0.15s; }
	.wh-switch input:checked + .wh-tr { background: var(--nx-ok); }
	.wh-switch input:checked + .wh-tr::after { transform: translateX(0.875rem); }
	.wh-switch input:focus-visible + .wh-tr { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.wh-tip { position: relative; display: inline-grid; place-items: center; width: 1rem; height: 1rem; border-radius: 99px; border: 1px solid var(--nx-text-muted); color: var(--nx-text-muted); font-size: 0.65rem; font-weight: 700; cursor: help; }
	.wh-tipbox { position: absolute; z-index: 30; top: calc(100% + 6px); left: -0.5rem; width: min(18rem, 70vw); padding: 0.625rem 0.75rem; border-radius: 8px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font-size: 0.75rem; font-weight: 400; line-height: 1.5; box-shadow: 0 8px 24px -10px rgb(0 0 0 / 0.25); display: none; text-align: left; }
	.wh-tipbox--r { left: auto; right: -0.5rem; }
	.wh-tip:hover .wh-tipbox, .wh-tip:focus .wh-tipbox { display: block; }
	@media (max-width: 640px) { .wh-tipbox { position: fixed; left: 1rem; right: 1rem; top: auto; bottom: 1rem; width: auto; z-index: 60; } }
	.wh-tblwrap { overflow-x: auto; }
	.wh-tbl { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
	.wh-tbl th { text-align: left; font-size: 0.7rem; font-weight: 600; color: var(--nx-text-muted); padding: 0.5rem 0.875rem; border-bottom: 1px solid var(--nx-border); }
	.wh-tbl td { padding: 0.625rem 0.875rem; border-bottom: 1px solid color-mix(in srgb, var(--nx-border) 60%, transparent); }
	.wh-tr-row { cursor: pointer; }
	.wh-tr-row:hover td { background: color-mix(in srgb, var(--nx-text) 2.5%, transparent); }
	.wh-detail { background: color-mix(in srgb, var(--nx-text) 2.5%, var(--nx-surface)); }
	.wh-dgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 0.75rem; }
	.wh-dgrid h4 { margin: 0 0 0.375rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--nx-text-muted); }
	.wh-code { margin: 0; padding: 0.75rem 0.875rem; border-radius: 10px; background: #15130f; color: #e9e4da; font: 0.75rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: auto; max-height: 22rem; white-space: pre; }
	.wh-hdrs { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 0.875rem; margin: 0; font-size: 0.78rem; }
	.wh-hdrs dd { margin: 0; color: var(--nx-text-muted); }
	.wh-know { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
	.wh-know li { display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.78rem; color: var(--nx-text-muted); }
	.wh-know b { color: var(--nx-text); font-size: 0.85rem; }
	/* Aperçus : la forme de chaque outil, sans ses logos */
	.pv-phone { border-radius: 18px; padding: 0.875rem; background: linear-gradient(160deg, #2b3a55, #1d2536); color: #fff; }
	.pv-clock { text-align: center; font-size: 1.875rem; font-weight: 300; margin: 0.125rem 0 0.75rem; opacity: 0.92; }
	.pv-notif { border-radius: 14px; padding: 0.7rem 0.75rem; background: rgb(255 255 255 / 0.16); display: grid; grid-template-columns: 1.875rem 1fr; gap: 0.125rem 0.625rem; font-size: 0.78rem; }
	.pv-app { width: 1.875rem; height: 1.875rem; border-radius: 8px; background: #ffb020; color: #16120c; display: grid; place-items: center; font-weight: 800; grid-row: span 2; }
	.pv-m { opacity: 0.92; }
	.pv-chat { border-radius: 10px; padding: 0.75rem 0.875rem; display: grid; grid-template-columns: 2.25rem 1fr; gap: 0.625rem; font-size: 0.82rem; }
	.pv-chat--discord { background: #2b2d31; color: #dbdee1; }
	.pv-chat--slack { background: #fff; color: #1d1c1d; border: 1px solid #ddd; }
	.pv-chat--matrix { background: var(--nx-surface); color: var(--nx-text); border: 1px solid var(--nx-border); }
	.pv-av { width: 2.25rem; height: 2.25rem; border-radius: 99px; background: #ffb020; color: #16120c; display: grid; place-items: center; font-weight: 800; }
	.pv-body { min-width: 0; }
	.pv-who { font-weight: 650; display: flex; gap: 0.375rem; align-items: center; }
	.pv-bot { font-size: 0.6rem; font-weight: 700; padding: 0 0.3rem; border-radius: 4px; background: #5865f2; color: #fff; }
	.pv-chat--slack .pv-bot { background: #e8e8e8; color: #555; }
	.pv-embed { margin-top: 0.375rem; border-left: 4px solid var(--c); border-radius: 4px; padding: 0.55rem 0.75rem; background: rgb(0 0 0 / 0.18); display: flex; flex-direction: column; gap: 0.25rem; }
	.pv-chat--slack .pv-embed { background: #f8f8f8; }
	.pv-chat--matrix .pv-embed { background: color-mix(in srgb, var(--nx-text) 4%, transparent); }
	.pv-f { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.75rem; opacity: 0.85; }
	.pv-link { color: #4ea4ff; font-size: 0.78rem; }
	@media (max-width: 640px) { .wh-row { grid-template-columns: 2.125rem minmax(0, 1fr) auto auto; } .wh-row .wh-badge { display: none; } .wh-hide-s { display: none; } .wh-ev { grid-template-columns: minmax(0, 1fr) auto; } .wh-ev-n { grid-column: 1; grid-row: 2; } .wh-ev .wh-switch { grid-row: 1 / span 2; grid-column: 2; } }
</style>
