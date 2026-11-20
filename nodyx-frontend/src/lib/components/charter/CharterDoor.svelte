<script lang="ts">
	// La porte des membres (lot 7d ; maquette v3 validée le 19/11/2026, CDC §E4j).
	// Une VRAIE porte : ni croix, ni Échap, ni clic à côté ne la ferment (la carte secoue,
	// « Lis et signe la charte pour entrer. »). Lire jusqu'en bas, signer (le tracé ou la
	// phrase, jamais de pénalité), cocher la case, entrer. La fausse case est hors écran,
	// hors clavier, cachée aux lecteurs d'écran : seuls les robots la cochent, et ils
	// reçoivent le même « Signature refusée. » que tout le monde (le piège ne se devine pas).
	//
	// `preview` : l'aperçu de l'admin (« Voir côté membre », « Aperçu ») avec le brouillon,
	// sans rien envoyer au serveur, et qui se ferme.
	import { onMount, onDestroy, tick } from 'svelte'
	import { goto } from '$app/navigation'
	import { t } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import { portal } from '$lib/actions/portal'
	import '$lib/charter/charter.css'
	import { fillVars, readingMinutes, strokeStats, samePhrase, refusalKey, type Point } from '$lib/charter/door'
	import { signaturePath } from '$lib/charter/signature'
	import { thumb } from '$lib/thumb'
	import { locale } from '$lib/i18n'
	import '$lib/charter/pilot.css'

	type Tone = 'sober' | 'fun' | 'kids' | 'own'
	let {
		audience = 'members',
		username = '',
		token = null,
		preview = null,
		onsigned = () => {},
		onclose = () => {},
	}: {
		audience?: 'members' | 'team'
		username?: string
		token?: string | null
		preview?: { html: string; tone: Tone; own: string; drawEnabled: boolean; community: string } | null
		onsigned?: () => void
		onclose?: () => void
	} = $props()

	const tFn = $derived($t)

	// ── La charte à lire ──────────────────────────────────────────────────────
	type Crowd = { count: number; faces: Array<{ username: string; avatar: string | null }> }
	type Loaded = { version: number; body_html: string; tone: Tone; own: string; drawEnabled: boolean; community: string; hello: { id: string; name: string } | null; crowd: Crowd | null; welcome: boolean }
	let charter = $state<Loaded | null>(null)
	let loadFailed = $state(false)

	async function load() {
		loadFailed = false
		if (preview) {
			charter = { version: 0, body_html: preview.html, tone: preview.tone, own: preview.own, drawEnabled: preview.drawEnabled, community: preview.community, hello: null, crowd: null, welcome: false }
			return
		}
		try {
			const res = await apiFetch(fetch, `/charter/${audience}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
			if (!res.ok) throw new Error()
			const j = await res.json()
			if (!j.version || !j.must_sign) { onclose(); return }   // plus rien à signer (éteinte ou signée entre-temps)
			charter = { version: j.version, body_html: j.body_html ?? '', tone: j.pledge?.tone ?? 'sober', own: j.pledge?.own ?? '', drawEnabled: j.draw_enabled !== false, community: j.community ?? '', hello: j.hello_channel ?? null, crowd: j.crowd ?? null, welcome: j.welcome === true }
		} catch { loadFailed = true }
	}

	const doc = $derived(charter ? fillVars(charter.body_html, charter.community, username) : '')
	const minutes = $derived(readingMinutes(doc.replace(/<[^>]*>/g, ' ')))
	const pledgeText = $derived(!charter ? '' : charter.tone === 'own' && charter.own.trim() ? charter.own : tFn(`charter.pledge_${charter.tone === 'own' ? 'sober' : charter.tone}`, { community: charter.community }))

	// ── Lire jusqu'en bas ─────────────────────────────────────────────────────
	let scrollEl = $state<HTMLElement | undefined>(undefined)
	let pct = $state(0)
	let read = $state(false)
	let section = 0
	let lastSent = 0
	let bottomSent = false
	function sendProgress(bottom: boolean) {
		if (preview || !charter) return
		const now = Date.now()
		if (!bottom && now - lastSent < 2000) return
		if (bottom && bottomSent) return
		lastSent = now; if (bottom) bottomSent = true
		void apiFetch(fetch, `/charter/${audience}/progress`, {
			method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: JSON.stringify({ version: charter.version, pct, section, bottom }),
		}).catch(() => {})
	}
	function onScroll() {
		const s = scrollEl
		if (!s) return
		const max = s.scrollHeight - s.clientHeight
		pct = max <= 2 ? 100 : Math.min(100, Math.round((100 * s.scrollTop) / max))
		// La règle atteinte : le dernier titre passé au-dessus du milieu de la fenêtre
		const mid = s.scrollTop + s.clientHeight / 2
		section = [...s.querySelectorAll('h2')].filter(h => (h as HTMLElement).offsetTop < mid).length
		if (pct >= 98 && !read) { read = true; sendProgress(true) }
		else sendProgress(false)
	}

	// ── Signer : le tracé, ou la phrase ──────────────────────────────────────
	let canvas = $state<HTMLCanvasElement | undefined>(undefined)
	let strokes: Point[][] = []
	let drawing = false
	let padW = 0
	let drawn = $state(false)
	let drewSomething = $state(false)
	let usePhrase = $state(false)
	let phrase = $state('')
	let typed = 0
	let phraseIn = $state('')
	const phraseOk = $derived(samePhrase(phraseIn, phrase))
	let pledge = $state(false)
	let decoy = $state(false)
	let err = $state('')
	let sending = $state(false)
	let done = $state(false)

	function ctx() { return canvas?.getContext('2d') ?? null }
	function ink(c: CanvasRenderingContext2D) {
		c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round'
		c.strokeStyle = getComputedStyle(canvas!).getPropertyValue('--nx-text').trim() || '#222'
	}
	function redraw() {
		const c = ctx(); if (!c || !canvas) return
		c.clearRect(0, 0, canvas.width, canvas.height); ink(c)
		for (const st of strokes) { c.beginPath(); st.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke() }
	}
	function sizePad() {
		if (!canvas) return
		const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
		if (!r.width) return
		// Redimensionner (le clavier du téléphone qui s'ouvre) ne doit RIEN effacer
		if (padW && Math.abs(r.width - padW) > 1) { const k = r.width / padW; strokes.forEach(st => st.forEach(p => (p.x *= k))) }
		padW = r.width
		canvas.width = r.width * dpr; canvas.height = r.height * dpr
		ctx()?.setTransform(dpr, 0, 0, dpr, 0, 0)
		redraw()
	}
	function clearPad() { strokes = []; drawn = false; drewSomething = false; redraw() }
	const pos = (e: PointerEvent) => { const r = canvas!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
	function down(e: PointerEvent) {
		if (!read || !canvas) return
		drawing = true; canvas.setPointerCapture(e.pointerId)
		strokes.push([pos(e)])
	}
	function move(e: PointerEvent) {
		if (!drawing) return
		const st = strokes[strokes.length - 1], q = st[st.length - 1], p = pos(e)
		if (Math.hypot(p.x - q.x, p.y - q.y) < 2) return
		st.push(p)
		const c = ctx(); if (!c) return
		ink(c); c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(p.x, p.y); c.stroke()
	}
	function up() {
		if (!drawing) return
		drawing = false
		drewSomething = true
		drawn = strokeStats(strokes).ok   // le dessin reste dans le navigateur, puis jeté (D15)
	}
	function setPhrase(on: boolean) {
		usePhrase = on
		if (!on) tick().then(() => { sizePad() })
	}

	const signed = $derived(usePhrase ? phraseOk : drawn)
	const goLabel = $derived(
		!read ? tFn('charter.go_read')
		: !signed ? (usePhrase ? tFn('charter.go_phrase') : tFn('charter.go_sign'))
		: !pledge ? tFn('charter.go_pledge')
		: audience === 'members' ? tFn('charter.go_enter', { community: charter?.community ?? '' }) : tFn('charter.go_team'))
	const canGo = $derived(read && signed && pledge && !sending)

	async function submit(e: Event) {
		e.preventDefault()
		if (!canGo || !charter) return
		err = ''
		if (preview) { done = true; welcomeStart(); return }
		sending = true
		try {
			const res = await apiFetch(fetch, `/charter/${audience}/sign`, {
				method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
				body: JSON.stringify({ version: charter.version, way: usePhrase ? 'phrase' : 'hand', pledge, human_check: decoy, typed }),
			})
			const j = await res.json().catch(() => ({}))
			if (res.ok && j.ok) { done = true; onsigned(); welcomeStart(); return }
			if (j.code === 'CHARTER_VERSION_CHANGED') { await restart(); err = tFn('charter.err_version'); return }
			err = tFn(refusalKey(j.code))
		} catch { err = tFn('charter.err_refused') }
		finally { sending = false }
	}
	async function restart() {
		read = false; pct = 0; bottomSent = false; pledge = false; phraseIn = ''; typed = 0; clearPad()
		await load(); await tick(); scrollEl?.scrollTo(0, 0); onScroll()
	}

	// ── Une porte qui ne se ferme pas (sauf l'aperçu) ────────────────────────
	let shake = $state(false)
	let toast = $state(false)
	let toastT: ReturnType<typeof setTimeout> | null = null
	function nudge() {
		if (preview) { onclose(); return }
		shake = false; void tick().then(() => (shake = true))
		toast = true
		if (toastT) clearTimeout(toastT)
		toastT = setTimeout(() => (toast = false), 2200)
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); nudge() }
	}
	// Naviguer D'ABORD, fermer ensuite : fermer démonte la porte, et une navigation lancée
	// depuis un composant démonté se perdait (on restait sur la page, porte fermée)
	async function goHello() { stopLeaving(); const id = charter?.hello?.id; if (id && !preview) await goto(`/chat?channel=${id}`); onclose() }

	// ── L'écran Bienvenue (lot 7d-3, maquette v4 validée le 20/11) ────────────
	// Sa propre signature se réécrit (le tracé ne quitte jamais le navigateur, D15), en
	// dessous les membres qu'on rejoint. Si un message de bienvenue l'attend vraiment
	// (OctoGuard + accueil actifs), on l'y emmène au bout de 3 s ; « Rester ici » arrête.
	const LEAVE_MS = 3000
	let sigPath = $state('')
	let signedPhrase = $state('')
	let signedOn = $state('')
	let leaving = $state(false)
	let leaveT: ReturnType<typeof setTimeout> | null = null
	const helloName = $derived(charter?.hello?.name ?? tFn('charter.hello_sample'))
	function welcomeStart() {
		sigPath = usePhrase ? '' : signaturePath(strokes)
		signedPhrase = usePhrase ? phrase : ''
		try { signedOn = new Intl.DateTimeFormat($locale, { day: 'numeric', month: 'long' }).format(new Date()) } catch { signedOn = '' }
		// Le départ n'existe que si quelqu'un attend vraiment dans le salon (l'aperçu le montre)
		if (audience !== 'members' || !(preview || (charter?.welcome && charter?.hello))) return
		leaving = true
		leaveT = setTimeout(() => { leaveT = null; if (preview) { leaving = false; return } void goHello() }, LEAVE_MS)
	}
	function stopLeaving() { if (leaveT) clearTimeout(leaveT); leaveT = null; leaving = false }
	async function goForum() { if (!preview) await goto('/forum'); onclose() }

	let cardEl = $state<HTMLElement | undefined>(undefined)
	let ro: ResizeObserver | null = null
	let prevOverflow = ''
	onMount(async () => {
		prevOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		window.addEventListener('keydown', onKey, true)
		await load()
		const n = Math.floor(Math.random() * 3) + 1
		phrase = tFn(`charter.phrase_${n}`, { community: charter?.community ?? '' })
		usePhrase = charter ? !charter.drawEnabled : false
		await tick()
		// Le focus va à la FENÊTRE (une fenêtre modale l'exige), pas à la zone de lecture :
		// sinon elle s'affiche encadrée dès l'ouverture. Tab y mène pour défiler au clavier.
		sizePad(); onScroll(); cardEl?.focus({ preventScroll: true })
		if (canvas && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => sizePad()); ro.observe(canvas) }
	})
	onDestroy(() => {
		if (typeof document !== 'undefined') document.body.style.overflow = prevOverflow
		if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey, true)
		ro?.disconnect(); if (toastT) clearTimeout(toastT); if (leaveT) clearTimeout(leaveT)
	})

</script>

<div class="door" use:portal role="presentation">
	<div class="door-backdrop" aria-hidden="true" onclick={nudge}></div>
	{#if toast}<p class="door-toast" role="status">{tFn('charter.toast')}</p>{/if}
	<div class="door-wrap" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) nudge() }}>
		<div class="door-card" class:shake role="dialog" aria-modal="true" aria-labelledby="door-title" tabindex="-1" bind:this={cardEl} onanimationend={() => (shake = false)}>
			<div class="door-head">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4"/></svg>
				<span id="door-title">{audience === 'members' ? tFn('charter.door_title_members', { community: charter?.community ?? '' }) : tFn('charter.door_title_team')}</span>
				{#if preview}<span class="door-badge">{tFn('charter.preview_badge')}</span>{/if}
				<span class="door-time">{tFn('charter.door_time', { n: String(minutes) })}</span>
				{#if preview}<button type="button" class="door-close" onclick={onclose}>{tFn('charter.preview_close')}</button>{/if}
			</div>
			<ol class="door-steps" aria-label={tFn('charter.steps_aria')}>
				<li class:on={!read && !done} class:done={read || done}><span>1</span>{tFn('charter.step_read')}</li>
				<li class:on={read && !done} class:done={done}><span>2</span>{tFn('charter.step_commit')}</li>
				<li class:on={done}><span>3</span>{tFn('charter.step_welcome')}</li>
			</ol>

			{#if loadFailed}
				<div class="door-fail"><p>{tFn('charter.load_error')}</p><button type="button" class="door-btn" onclick={load}>{tFn('charter.retry')}</button></div>
			{:else if !charter}
				<p class="door-loading">{tFn('charter.loading')}</p>
			{:else if !done}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (la charte se fait défiler au clavier : flèches, Page suivante) -->
				<div class="door-scroll" bind:this={scrollEl} onscroll={onScroll} tabindex="0" aria-label={tFn('charter.doc_aria')}>
					<div class="charter-doc">{@html doc}</div>
					<div class="door-end" style:visibility={read ? 'visible' : 'hidden'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>{tFn('charter.end_read')}</div>
				</div>
				<div class="door-progress"><span style:width="{pct}%"></span></div>
				<form class="door-sign" class:locked={!read} onsubmit={submit} autocomplete="off">
					<div class="door-sign-head"><b>{tFn('charter.sign_title')}</b><span class="small muted">{usePhrase ? '' : drawn ? tFn('charter.sign_good') : drewSomething ? tFn('charter.sign_retry') : tFn('charter.sign_hint')}</span></div>
					{#if !usePhrase}
						<div class="pad-wrap" class:ok={drawn}>
							<canvas bind:this={canvas} aria-label={tFn('charter.pad_aria')} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
							<span class="pad-line" aria-hidden="true">{username}</span>
							<button type="button" class="door-btn door-btn--sm pad-clear" onclick={clearPad}>{tFn('charter.clear')}</button>
						</div>
					{:else}
						<div class="phrase">
							<span class="small muted">{tFn('charter.phrase_copy')}</span>
							<b class="phrase-src">{phrase}</b>
							<input class="door-input" bind:value={phraseIn} aria-label={tFn('charter.phrase_aria')} onkeydown={() => typed++} />
						</div>
					{/if}
					{#if charter.drawEnabled}
						<button type="button" class="linkish" onclick={() => setPhrase(!usePhrase)}>{usePhrase ? tFn('charter.alt_draw') : tFn('charter.alt_phrase')}</button>
					{/if}
					<!-- Hors écran, hors clavier, caché aux lecteurs d'écran : seuls les robots la voient. -->
					<div class="door-extra" aria-hidden="true">
						<label><input type="checkbox" name="human_check" tabindex="-1" bind:checked={decoy} /> {tFn('charter.decoy_label')}</label>
					</div>
					<label class="pledge"><input type="checkbox" bind:checked={pledge} /><span>{pledgeText}</span></label>
					<div class="door-actions"><button type="submit" class="door-btn door-btn--primary door-go" disabled={!canGo}>{goLabel}</button></div>
					{#if err}<p class="small door-err" role="alert">{err}</p>{/if}
				</form>
			{:else}
				<div class="door-welcome nx-pilot">
					<div class="door-signed">
						{#if sigPath}
							<svg viewBox="0 0 280 92" role="img" aria-label={tFn('charter.signature_aria', { user: username })}><path d={sigPath} pathLength="1" /></svg>
						{:else if signedPhrase}
							<p class="door-signed-phrase">« {signedPhrase} »</p>
						{/if}
						<span class="door-signed-line" aria-hidden="true"></span>
						<span class="door-signed-by">{tFn('charter.signed_by', { user: username, date: signedOn })}</span>
					</div>
					{#if audience === 'members' && charter.crowd && charter.crowd.count > 0}
						<div class="door-crowd">
							<span class="door-faces" aria-hidden="true">
								{#each charter.crowd.faces as f (f.username)}
									{#if f.avatar}<img src={thumb(f.avatar, 48)} alt="" width="24" height="24" />{:else}<span>{f.username.charAt(0).toUpperCase()}</span>{/if}
								{/each}
								<span class="door-me">{username.charAt(0).toUpperCase()}</span>
							</span>
							<span>{tFn(charter.crowd.count === 1 ? 'charter.crowd_one' : 'charter.crowd_other', { count: String(charter.crowd.count), community: charter.community })}</span>
						</div>
					{/if}
					<h2>{audience === 'members' ? tFn('charter.welcome_members', { user: username }) : tFn('charter.welcome_team', { user: username })}</h2>
					<p>{audience === 'members' ? tFn('charter.welcome_text', { community: charter.community }) : tFn('charter.welcome_team_text')}</p>
					{#if leaving}
						<div class="door-leaving">
							<p>{tFn('charter.leaving', { channel: helloName })}</p>
							<span class="door-countdown" role="progressbar" aria-label={tFn('charter.leaving_aria')}><i style="animation-duration:{LEAVE_MS}ms"></i></span>
						</div>
					{/if}
					<div class="door-actions door-actions--center">
						{#if audience === 'members'}
							{#if charter.hello || preview}<button type="button" class="pl-btn pl-btn--primary" onclick={goHello}>{tFn('charter.hello', { channel: helloName })}</button>{/if}
							{#if leaving}
								<button type="button" class="pl-btn pl-btn--quiet" onclick={stopLeaving}>{tFn('charter.stay')}</button>
							{:else}
								<button type="button" class="pl-btn pl-btn--secondary" onclick={goForum}>{tFn('charter.explore')}</button>
							{/if}
						{:else}
							<button type="button" class="pl-btn pl-btn--primary" onclick={onclose}>{tFn('charter.team_go')}</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.door { position: fixed; inset: 0; z-index: 2000; }
	.door-backdrop { position: absolute; inset: 0; background: color-mix(in srgb, var(--nx-bg, #0b0b0f) 62%, transparent); backdrop-filter: blur(10px); }
	.door-wrap { position: absolute; inset: 0; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 28px 16px 48px; }
	.door-card:focus { outline: none; }
	.door-card { width: min(100%, 720px); border-radius: 18px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); box-shadow: 0 30px 80px -30px rgb(0 0 0 / .45); overflow: hidden; }
	.door-card.shake { animation: door-shake .4s; }
	@keyframes door-shake { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
	.door-head { display: flex; align-items: center; gap: 8px; padding: 12px 18px; font-size: 13px; font-weight: 600; background: color-mix(in srgb, var(--nx-header-accent) 9%, var(--nx-surface)); border-bottom: 1px solid var(--nx-border); }
	.door-head svg { width: 16px; height: 16px; color: var(--nx-header-accent); flex: none; }
	.door-time { margin-left: auto; font-weight: 500; color: var(--nx-text-muted); font-size: 12px; white-space: nowrap; }
	.door-badge { padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; background: var(--nx-header-accent); color: var(--nx-on-accent); }
	.door-close { border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); border-radius: 8px; padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; }
	.door-steps { list-style: none; display: flex; justify-content: center; flex-wrap: wrap; gap: 6px 22px; margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--nx-border); font-size: 12px; color: var(--nx-text-muted); }
	.door-steps li { display: inline-flex; align-items: center; gap: 7px; }
	.door-steps span { width: 20px; height: 20px; border-radius: 99px; display: grid; place-items: center; font-size: 11px; font-weight: 700; border: 1px solid var(--nx-border); }
	.door-steps li.on { color: var(--nx-text); font-weight: 600; }
	.door-steps li.on span { background: var(--nx-header-accent); color: var(--nx-on-accent); border-color: transparent; }
	.door-steps li.done span { background: color-mix(in srgb, var(--nx-ok) 18%, transparent); color: var(--nx-ok); border-color: transparent; }
	.door-scroll { max-height: min(52vh, 460px); overflow: auto; outline: none; }
	.door-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--nx-header-accent); }
	.door-end { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 6px 22px 22px; font-size: 13px; color: var(--nx-ok); font-weight: 600; }
	.door-end svg { width: 16px; height: 16px; }
	.door-progress { height: 4px; background: color-mix(in srgb, var(--nx-text) 8%, transparent); }
	.door-progress span { display: block; height: 100%; width: 0; background: var(--nx-header-accent); transition: width .15s; }
	.door-sign { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 16px 22px 20px; }
	.door-sign.locked { opacity: .45; pointer-events: none; filter: grayscale(.4); }
	.door-sign-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; font-size: 14px; }
	.pad-wrap { position: relative; height: 150px; border-radius: 12px; border: 1.5px dashed color-mix(in srgb, var(--nx-text) 25%, transparent); background: color-mix(in srgb, var(--nx-text) 2%, var(--nx-surface)); touch-action: none; }
	.pad-wrap.ok { border-style: solid; border-color: var(--nx-ok); }
	.pad-wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
	.pad-line { position: absolute; left: 18px; right: 18px; bottom: 30px; border-top: 1px solid color-mix(in srgb, var(--nx-text) 22%, transparent); padding-top: 4px; font-size: 11px; color: var(--nx-text-faint); pointer-events: none; }
	.pad-clear { position: absolute; top: 6px; right: 6px; }
	.phrase { display: flex; flex-direction: column; gap: 6px; }
	.phrase-src { font-size: 15px; padding: 8px 12px; border-radius: 8px; background: color-mix(in srgb, var(--nx-header-accent) 8%, var(--nx-surface)); user-select: none; }
	.door-input { min-height: 38px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font: inherit; }
	.linkish { align-self: flex-start; background: none; border: 0; padding: 0; color: var(--nx-header-accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
	/* Hors de l'écran pour les humains (et hors clavier, et caché aux lecteurs d'écran) */
	.door-extra { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
	.pledge { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--nx-border); cursor: pointer; font-size: 14px; font-weight: 550; }
	.pledge input { width: 18px; height: 18px; margin-top: 1px; accent-color: var(--nx-header-accent); flex: none; }
	.pledge:has(input:checked) { border-color: var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 7%, var(--nx-surface)); }
	.door-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 10px; }
	.door-actions--center { justify-content: center; }
	.door-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
	.door-btn--sm { min-height: 28px; padding: 0 10px; font-size: 12px; }
	.door-btn--primary { background: var(--nx-header-accent); border-color: transparent; color: var(--nx-on-accent); }
	.door-btn:disabled { opacity: .55; cursor: not-allowed; }
	.door-go { min-height: 42px; padding: 0 20px; font-size: 14px; font-weight: 650; }
	.door-err { margin: 0; color: var(--nx-bad); }
	.door-loading, .door-fail { padding: 40px 22px; text-align: center; color: var(--nx-text-muted); }
	.door-welcome { position: relative; text-align: center; padding: 34px 26px 30px; display: flex; flex-direction: column; align-items: center; gap: 10px; overflow: hidden; }
	.door-welcome h2 { margin: 6px 0 0; font-size: 24px; }
	.door-welcome p { margin: 0 0 8px; color: var(--nx-text-muted); max-width: 46ch; line-height: 1.55; }
	/* La signature qui se réécrit, puis les membres qu'on rejoint (une seule fête) */
	.door-signed { width: 280px; max-width: 100%; display: flex; flex-direction: column; align-items: center; margin-bottom: 4px; }
	.door-signed svg { display: block; width: 100%; height: 92px; }
	.door-signed path { fill: none; stroke: var(--nx-text); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: door-write 1.6s cubic-bezier(.5, 0, .3, 1) .15s forwards; }
	@keyframes door-write { to { stroke-dashoffset: 0; } }
	.door-signed-phrase { font-size: 19px; font-weight: 700; color: var(--nx-text) !important; margin: 18px 0 10px !important; animation: door-rise .6s ease-out both; }
	@keyframes door-rise { from { opacity: 0; transform: translateY(6px); } }
	.door-signed-line { align-self: stretch; height: 1px; background: var(--nx-border); margin: 0 10px; }
	.door-signed-by { margin-top: 6px; font-size: 13px; color: var(--nx-text-muted); }
	.door-crowd { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: var(--nx-text-muted); margin-bottom: 8px; }
	.door-faces { display: inline-flex; }
	.door-faces > * { width: 24px; height: 24px; margin-left: -6px; border-radius: 50%; border: 2px solid var(--nx-surface); object-fit: cover; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; background: #5b7c99; }
	.door-faces > :first-child { margin-left: 0; }
	.door-faces > .door-me { background: var(--pl-accent); color: var(--pl-on-accent); animation: door-arrive .6s cubic-bezier(.2, 1.3, .4, 1) 1.5s both; }
	@keyframes door-arrive { from { transform: translateX(18px); opacity: 0; } }
	.door-leaving { width: min(360px, 100%); text-align: left; font-size: 14px; }
	.door-leaving p { color: var(--nx-text) !important; margin: 0 0 6px !important; }
	.door-countdown { display: block; height: 4px; border-radius: 99px; background: color-mix(in srgb, var(--nx-text) 6%, transparent); border: 1px solid var(--nx-border); overflow: hidden; }
	.door-countdown i { display: block; height: 100%; background: var(--pl-accent); transform-origin: left; animation: door-empty linear forwards; }
	@keyframes door-empty { from { transform: scaleX(1); } to { transform: scaleX(0); } }
	.door-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2001; margin: 0; padding: 9px 16px; border-radius: 99px; background: #1b1813; color: #fff; font-size: 13px; font-weight: 600; box-shadow: 0 10px 30px -10px rgb(0 0 0 / .5); }
	.small { font-size: 12px; } .muted { color: var(--nx-text-muted); }
	@media (prefers-reduced-motion: reduce) {
		.door-signed path { animation: none; stroke-dashoffset: 0; }
		.door-signed-phrase, .door-faces > .door-me { animation: none; }
		.door-countdown i { animation: none; transform: scaleX(.5); }
		.door-card.shake { animation: none; outline: 2px solid var(--nx-header-accent); }
	}
	@media (max-width: 560px) { .door-wrap { padding: 12px 8px 32px; } .door-sign { padding: 14px 16px 18px; } }
</style>
