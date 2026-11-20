<script module lang="ts">
	export type HeldItem = {
		id: string; kind: 'chat' | 'post' | 'thread' | 'post_edit'; author_id: string; author_username: string; author_created_at: string
		channel_id: string | null; thread_id: string | null; channel_name: string | null; thread_title: string | null
		place_category_id: string | null; category_name: string | null
		payload: { content: string; title?: string }; rule_name: string; also_matched: string[] | null; created_at: string
	}
</script>

<script lang="ts">
	// « À relire » (maquette validée le 20/11/2026, nodyx.org/relire-retenus-maquette.html) :
	// à gauche une carte par auteur ; à droite le dossier, avec LA CONVERSATION telle qu'elle
	// était, le message retenu à sa place et la décision collée dessous. Sur téléphone : la
	// file, ou un dossier en plein écran (comme une boîte mail). Pas de raccourcis clavier tant
	// qu'on ne peut pas revenir sur une décision (une touche par erreur publierait une insulte).
	import '$lib/charter/pilot.css'
	import { t, locale } from '$lib/i18n'
	import { og, OgError } from '$lib/octoguard/api'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { htmlToText } from '$lib/octoguard/text'

	type Around = { id: string; author_id: string | null; author_username: string | null; content: string | null; created_at: string; is_target: boolean }
	type Nearby = { id: string; author_id: string; author_username: string | null; content: string | null; created_at: string }
	type Brief = { id: string; username: string; created_at: string; warns_active: number; muted: boolean; muted_until: string | null }
	type Ctx = { around: Around[]; current: string | null; edits: { old_content: string; edited_at: string }[]; author: Brief | null; more_before?: boolean; more_after?: boolean; held_nearby?: Nearby[] }

	let { held, token, expiryHours, onDecided }: { held: HeldItem[]; token: string | null; expiryHours: number; onDecided: () => Promise<void> } = $props()
	const tFn = $derived($t)
	const ruleLabel = (name: string) => (name === 'shield' ? tFn('og2.shield_rule_name') : name)

	// ─── La file : une carte par auteur, l'auteur qui attend depuis le plus longtemps en haut ───
	const groups = $derived.by(() => {
		const m = new Map<string, HeldItem[]>()
		for (const h of held) { const l = m.get(h.author_id); if (l) l.push(h); else m.set(h.author_id, [h]) }
		return [...m.values()]
	})
	const order = $derived(groups.flat())
	// La file, OU un dossier en pleine largeur, partout (Jonathan, 20/11 : plus d'écran partagé,
	// le dossier se suffit). Le dossier ouvert est dans l'adresse (#id) : « précédent » ramène
	// à la file, et le lien d'un dossier peut s'envoyer à un collègue.
	// Le # se lit dans l'adresse elle-même, remise à jour à chaque retour arrière : page.url.hash ne
	// suit pas toujours un # changé par le navigateur (trouvé au banc d'essai le 20/11).
	let hash = $state('')
	const syncHash = () => { hash = location.hash }
	$effect(() => {
		syncHash()
		addEventListener('hashchange', syncHash); addEventListener('popstate', syncHash)
		return () => { removeEventListener('hashchange', syncHash); removeEventListener('popstate', syncHash) }
	})
	const sel = $derived.by(() => { const id = hash.slice(1); return order.some((x) => x.id === id) ? id : null })
	const h = $derived(order.find((x) => x.id === sel) ?? null)
	let lastOpened = $state<string | null>(null)
	const queueUrl = () => page.url.pathname + page.url.search
	function open(id: string) {
		win = { before: 5, after: 3 }; error = null; lastOpened = id
		// La marque « ouvert depuis la file » vit dans l'historique : le navigateur la restaure lui-même
		goto(`#${id}`, { reset: false, state: { rvQueue: true } }).then(() => { syncHash(); window.scrollTo(0, 0) })
	}
	function backToQueue() {
		// Ouvert depuis la file : on y revient d'un pas en arrière. Ouvert par un lien : on remplace l'adresse.
		if (page.state.rvQueue) history.back()
		else goto(queueUrl(), { replace: true, reset: false }).then(syncHash)
		window.scrollTo(0, 0)
	}

	// ─── Le fil du dossier : chargé à l'ouverture, « afficher plus » élargit la fenêtre ───
	let win = $state({ before: 5, after: 3 })
	let ctxCache = $state<Record<string, Ctx | 'error'>>({})
	const ctxKey = $derived(h ? `${h.id}:${win.before}:${win.after}` : null)
	const ctx = $derived(ctxKey ? ctxCache[ctxKey] : undefined)
	$effect(() => {
		const key = ctxKey, item = h
		if (!key || !item || ctxCache[key]) return
		og<{ context: Ctx }>(token, `/held/${item.id}/context?before=${win.before}&after=${win.after}`)
			.then((r) => { ctxCache[key] = r.context })
			.catch(() => { ctxCache[key] = 'error' })
	})
	const ctxOk = $derived(ctx && ctx !== 'error' ? ctx : null)

	type Line = { key: string; who: string; authorId: string | null; at: string; text: string | null; mark: 'this' | 'also' | 'author' | null }
	const lines = $derived.by((): Line[] => {
		if (!h) return []
		const self: Line = { key: `held-${h.id}`, who: h.author_username, authorId: h.author_id, at: h.created_at, text: htmlToText(h.payload.content), mark: 'this' }
		if (!ctxOk) return [self]
		const out: Line[] = []
		for (const a of ctxOk.around) {
			// Une modification retenue : le message publié prend la place du dossier
			if (a.is_target) { out.push({ ...self, at: a.created_at }); continue }
			out.push({ key: a.id, who: a.author_username ?? tFn('areports.deleted_account'), authorId: a.author_id, at: a.created_at,
				text: a.content === null ? null : htmlToText(a.content), mark: a.author_id === h.author_id ? 'author' : null })
		}
		for (const n of ctxOk.held_nearby ?? []) {
			out.push({ key: `held-${n.id}`, who: n.author_username ?? tFn('areports.deleted_account'), authorId: n.author_id, at: n.created_at, text: n.content === null ? null : htmlToText(n.content), mark: 'also' })
		}
		if (h.kind !== 'post_edit') out.push(self)
		return out.sort((a, b) => a.at.localeCompare(b.at))
	})
	const marks = $derived(lines.filter((l) => l.mark))

	// L'ancre : le fil s'ouvre centré sur le message du dossier ; ↑ ↓ sautent d'un surligné à l'autre
	let fil = $state<HTMLElement | null>(null)
	let at = $state(0)
	function goTo(i: number, pulse: boolean) {
		if (!fil || marks.length === 0) return
		at = (i + marks.length) % marks.length
		const el = fil.querySelector<HTMLElement>(`[data-line="${marks[at].key}"]`)
		if (!el) return
		if (getComputedStyle(fil).maxHeight === 'none') { if (pulse) el.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
		else fil.scrollTop = el.offsetTop - fil.clientHeight / 2 + el.offsetHeight / 2
		if (pulse && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.remove('rv-pulse'); void el.offsetWidth; el.classList.add('rv-pulse') }
	}
	$effect(() => {
		// à chaque nouveau fil chargé : centré sur le dossier
		void lines; const el = fil
		if (!el || !ctxOk) return
		queueMicrotask(() => goTo(marks.findIndex((m) => m.mark === 'this'), false))
	})

	// ─── Décider ───
	let busy = $state(false)
	let error = $state<string | null>(null)
	let done = $state<string | null>(null)
	let doneTimer: ReturnType<typeof setTimeout> | undefined
	$effect(() => { if (!done) return; clearTimeout(doneTimer); doneTimer = setTimeout(() => (done = null), 4000); return () => clearTimeout(doneTimer) })
	const ERR: Record<string, string> = {
		CANNOT_REVIEW_SELF: 'og2.rp_err_self', RANK_TOO_LOW: 'areports.err_rank', ALREADY_DECIDED: 'og2.rp_err_decided',
		PUBLISH_FAILED: 'og2.rp_err_gone', FORBIDDEN: 'areports.err_forbidden', AUTHOR_BANNED: 'og2.rp_err_banned', THREAD_LOCKED: 'og2.rp_err_locked',
	}
	async function decide(d: 'approve' | 'refuse') {
		if (!h || busy) return   // une décision à la fois : un double clic ne vise jamais un autre message
		busy = true; error = null; done = null
		const i = order.findIndex((x) => x.id === h.id)
		const next = order[i + 1]?.id ?? order[i - 1]?.id ?? null
		try {
			await og(token, `/held/${h.id}/${d}`, 'POST')
			done = tFn(d === 'approve' ? 'og2.rp_ok_approved' : 'og2.rp_ok_refused')
			win = { before: 5, after: 3 }
			// Le dossier suivant remplace celui-ci dans l'historique ; plus rien : retour à la file
			if (next) { lastOpened = next; await goto(`#${next}`, { replace: true, reset: false, state: page.state }) }
			else if (page.state.rvQueue) history.back()
			else await goto(queueUrl(), { replace: true, reset: false })
			syncHash()
			await onDecided()
		} catch (e) {
			error = tFn((e instanceof OgError && e.code && ERR[e.code]) || 'areports.err_generic')
			if (e instanceof OgError && e.code === 'ALREADY_DECIDED') await onDecided()
		} finally { busy = false }
	}

	// ─── Mots et dates ───
	const cap = (s: string) => s.charAt(0).toLocaleUpperCase($locale) + s.slice(1)
	function accountAge(iso: string) {
		const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
		if (hrs < 1) return tFn('og2.rp_age_new')
		if (hrs < 48) return tFn('og2.rp_age_h', { n: hrs })
		const d = Math.floor(hrs / 24)
		return d < 60 ? tFn('og2.rp_age_d', { n: d }) : tFn('og2.rp_age_m', { n: Math.floor(d / 30) })
	}
	function span(fromIso: string, toIso: string) {
		const m = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000)
		if (m < 1) return tFn('og2.rv_span_lt1')
		return m < 120 ? tFn('og2.rp_min', { n: m }) : tFn('og2.rp_h', { n: Math.round(m / 60) })
	}
	function ago(iso: string) {
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
		if (m < 1) return tFn('areports.just_now')
		return tFn('og2.rv_ago', { t: m < 120 ? tFn('og2.rp_min', { n: m }) : tFn('og2.rp_h', { n: Math.floor(m / 60) }) })
	}
	const time = (iso: string) => new Date(iso).toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' })
	const fullDate = (iso: string) => tFn('og2.rv_when_at', {
		date: new Date(iso).toLocaleDateString($locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), time: time(iso),
	})
	function expiresIn(iso: string) {
		const left = new Date(iso).getTime() + expiryHours * 3_600_000 - Date.now()
		const hrs = Math.max(0, Math.floor(left / 3_600_000))
		return hrs >= 24 ? tFn('og2.rp_left_d', { d: Math.floor(hrs / 24), h: hrs % 24 }) : tFn('og2.rp_left_h', { h: Math.max(1, hrs) })
	}
	const placeShort = (x: HeldItem) =>
		x.kind === 'chat' ? (x.channel_name ? `#${x.channel_name}` : tFn('og2.rp_place_chat'))
		: x.kind === 'thread' ? [x.category_name, tFn('og2.rv_new_thread')].filter(Boolean).join(', ')
		: [x.category_name, x.thread_title].filter(Boolean).join(', ') || tFn('og2.rp_place_forum')
	/** Le chemin « Où », chaque étape cliquable quand elle mène quelque part. */
	function path(x: HeldItem): { label: string; href: string | null }[] {
		if (x.kind === 'chat') return [{ label: tFn('og2.rv_place_chat'), href: '/chat' }, { label: x.channel_name ? `#${x.channel_name}` : tFn('og2.rp_place_chat'), href: x.channel_id ? `/chat?channel=${x.channel_id}` : null }]
		const p: { label: string; href: string | null }[] = [{ label: tFn('og2.rv_place_forum'), href: '/forum' }]
		if (x.category_name) p.push({ label: x.category_name, href: x.place_category_id ? `/forum/${x.place_category_id}` : null })
		if (x.kind === 'thread') p.push({ label: tFn('og2.rv_new_thread_titled', { title: x.payload.title ?? '' }), href: null })
		else if (x.thread_title) p.push({ label: tFn('og2.rv_thread_titled', { title: x.thread_title }), href: x.place_category_id && x.thread_id ? `/forum/${x.place_category_id}/${x.thread_id}` : null })
		return p
	}
	function summary(l: HeldItem[]) {
		const age = accountAge(l[0].author_created_at)
		if (l.length < 2) return cap(age)
		const places = new Set(l.map(placeShort)).size
		return cap(tFn('og2.rv_summary', { age, n: l.length, span: span(l[0].created_at, l[l.length - 1].created_at),
			places: places > 1 ? tFn('og2.rv_places_n', { n: places }) : tFn('og2.rv_places_same') }))
	}
	/** Une teinte par auteur, stable : distingue la personne de ce qu'elle a écrit, et les auteurs entre eux. */
	function hue(name: string) { let n = 0; for (const c of name) n = (n * 31 + c.charCodeAt(0)) % 360; return n }
	const tint = (name: string) => `hsl(${hue(name)} 32% 46%)`
	const initial = (name: string) => (name.trim()[0] ?? '?').toLocaleUpperCase($locale)
	const authorCount = $derived(groups.length)
</script>

<div class="nx-pilot rv">
	<!-- La file -->
	{#if !h}
	<div class="rv-file">
		<div class="rv-file-head">
			<div class="rv-l1">
				<h2 id="rv-file-title">{tFn('og2.rv_queue_title')}</h2>
				<span class="rv-count">{tFn(held.length > 1 ? 'og2.rv_count_n' : 'og2.rv_count_1', { n: held.length })}, {tFn(authorCount > 1 ? 'og2.rv_authors_n' : 'og2.rv_authors_1', { n: authorCount })}</span>
			</div>
			<p><span class="rv-pc">{tFn('og2.rv_hint_click')}</span><span class="rv-touch">{tFn('og2.rv_hint_touch')}</span></p>
		</div>
		<div class="rv-cards" role="listbox" aria-labelledby="rv-file-title">
			{#each groups as l (l[0].author_id)}
				<div class="rv-card" role="group" aria-label={tFn('og2.rv_card_aria', { name: l[0].author_username })} style="--rv-c: {tint(l[0].author_username)}">
					<div class="rv-card-head">
						<span class="rv-ava" style="background: {tint(l[0].author_username)}">{initial(l[0].author_username)}</span>
						<span class="rv-name">{l[0].author_username}</span>
						<span class="rv-nb" title={tFn(l.length > 1 ? 'og2.rv_count_n' : 'og2.rv_count_1', { n: l.length })}>{l.length}</span>
						<span class="rv-summary">{summary(l)}</span>
					</div>
					{#each l as x (x.id)}
						<button type="button" class="rv-row" role="option" aria-selected={x.id === lastOpened} onclick={() => open(x.id)}>
							<span class="rv-time">{time(x.created_at)}</span>
							<span class="rv-body"><span class="rv-place">{placeShort(x)}</span><span class="rv-excerpt">{x.payload.title ? `${x.payload.title} : ` : ''}{htmlToText(x.payload.content)}</span></span>
							<svg class="rv-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
						</button>
					{/each}
				</div>
			{/each}
		</div>
	</div>

	{/if}

	<!-- Le dossier -->
	{#if h}
		{@const mine = order.filter((x) => x.author_id === h.author_id)}
		<section class="rv-dossier" aria-live="polite">
			<div class="rv-d-head">
				<button type="button" class="rv-back" onclick={backToQueue}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>{tFn('og2.rv_back', { n: held.length })}
				</button>
				<div class="rv-l1"><h2>{tFn('og2.rv_dossier')}</h2><span class="rv-count">{mine.length > 1 ? tFn('og2.rv_rank_n', { i: mine.findIndex((x) => x.id === h.id) + 1, n: mine.length }) : tFn('og2.rv_rank_1')}</span></div>
				<div class="rv-l2">
					<span class="rv-by">{tFn('og2.rv_written_by')}</span>
					<span class="rv-ava rv-ava-s" style="background: {tint(h.author_username)}">{initial(h.author_username)}</span>
					<span class="rv-name">{h.author_username}</span>
					<span class="rv-pill rv-pill-ochre">{accountAge(h.author_created_at)}</span>
					{#if ctxOk?.author && ctxOk.author.warns_active > 0}<span class="rv-pill rv-pill-ochre">{tFn(ctxOk.author.warns_active > 1 ? 'og2.cx_warns_n' : 'og2.cx_warns_1', { n: ctxOk.author.warns_active })}</span>{/if}
					{#if ctxOk?.author?.muted}<span class="rv-pill rv-pill-red">{ctxOk.author.muted_until ? tFn('og2.cx_muted_until', { at: new Date(ctxOk.author.muted_until).toLocaleString($locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : tFn('og2.cx_muted')}</span>{/if}
					<a class="rv-file-link" href="/admin/members/{h.author_id}">{tFn('amem.open_file')}</a>
				</div>
			</div>

			<div class="rv-d-body">
				<div class="rv-title"><h3>{tFn(`og2.rv_kind_${h.kind}`)}</h3><span class="rv-pill rv-pill-grey">{tFn('og2.rp_pending')}</span></div>
				<dl class="rv-facts">
					<dt>{tFn('og2.rv_where')}</dt>
					<dd class="rv-path">
						{#each path(h) as step, i (i)}
							{#if i > 0}<span class="rv-sep" aria-hidden="true">›</span>{/if}
							{#if step.href}<a href={step.href}>{step.label}</a>{:else}<span>{step.label}</span>{/if}
						{/each}
					</dd>
					<dt>{tFn('og2.rv_when')}</dt>
					<dd>{fullDate(h.created_at)} <span class="rv-faint">({ago(h.created_at)})</span></dd>
					<dt>{tFn('og2.rv_held_by')}</dt>
					<dd>{tFn('og2.rv_rule', { rule: ruleLabel(h.rule_name) })}</dd>
					{#if h.also_matched?.length}
						<dt>{tFn('og2.rv_also')}</dt>
						<dd>
							<span>{h.also_matched.join(', ')}</span>
							<button type="button" class="rv-tip" aria-label={tFn('og2.rv_also_aria')}>?<span class="rv-tip-txt" role="tooltip">{tFn('og2.rv_also_tip')}</span></button>
						</dd>
					{/if}
				</dl>

				<div class="rv-conv-head">
					<span class="rv-lbl">{h.kind === 'chat' ? tFn('og2.rv_conv_chat', { place: h.channel_name ? `#${h.channel_name}` : tFn('og2.rp_place_chat') }) : h.kind === 'thread' ? tFn('og2.rv_conv_new') : tFn('og2.rv_conv_forum')}</span>
					<span class="rv-legend">
						<span><i class="rv-k-this"></i>{tFn('og2.rv_legend_this')}</span>
						{#if lines.some((l) => l.mark === 'also')}<span><i class="rv-k-also"></i>{tFn('og2.rv_legend_also')}</span>{/if}
						{#if lines.some((l) => l.mark === 'author')}<span><i class="rv-k-author"></i>{tFn('og2.rv_legend_author', { name: h.author_username })}</span>{/if}
					</span>
				</div>
				<div class="rv-fil-frame">
					<div class="rv-fil" bind:this={fil}>
						{#if ctxOk?.more_before}
							<button type="button" class="rv-more" onclick={() => (win = { ...win, before: Math.min(30, win.before + 10) })}>{tFn('og2.rv_more_before')}</button>
						{:else if ctxOk}
							<div class="rv-start">{tFn('og2.rv_start')}</div>
						{/if}
						{#if ctx === undefined}<p class="rv-faint rv-pad">{tFn('og2.cx_loading')}</p>{/if}
						{#if ctx === 'error'}<p class="rv-faint rv-pad">{tFn('areports.err_generic')}</p>{/if}
						{#each lines as l (l.key)}
							<div class="rv-msg" class:rv-this={l.mark === 'this'} class:rv-also={l.mark === 'also'} class:rv-author={l.mark === 'author'} data-line={l.key}>
								<span class="rv-ava" style="background: {tint(l.who)}">{initial(l.who)}</span>
								<span class="rv-msg-h">
									<b>{l.who}</b><time datetime={l.at}>{time(l.at)}</time>
									{#if l.mark === 'this'}<span class="rv-tag">{tFn(h.kind === 'post_edit' ? 'og2.rv_tag_edit' : 'og2.rv_tag_this')}</span>{/if}
									{#if l.mark === 'also'}<span class="rv-tag">{tFn('og2.rv_tag_also')}</span>{/if}
								</span>
								{#if l.mark === 'this' && h.payload.title}<p class="rv-subject">{h.payload.title}</p>{/if}
								{#if l.text === null}<p class="rv-faint">{tFn('og2.rv_deleted')}</p>{:else}<p>{l.text}</p>{/if}
								{#if l.mark === 'this'}
									{#if h.kind === 'post_edit' && ctxOk?.current}
										<details class="rv-current"><summary>{tFn('og2.rv_current_text')}</summary><p>{htmlToText(ctxOk.current)}</p></details>
									{/if}
									<div class="rv-decide">
										<span class="rv-q">{tFn(h.kind === 'post_edit' ? 'og2.rv_question_edit' : 'og2.rv_question')}</span>
										<button type="button" class="rv-btn rv-btn-refuse" disabled={busy} onclick={() => decide('refuse')}>
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>{tFn('og2.rp_refuse')}
										</button>
										<button type="button" class="rv-btn rv-btn-publish" disabled={busy} onclick={() => decide('approve')}>
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>{tFn(h.kind === 'post_edit' ? 'og2.rp_approve_edit' : 'og2.rp_approve')}
										</button>
									</div>
									{#if error}<p class="rv-error" role="alert">{error}</p>{/if}
								{/if}
							</div>
						{/each}
						{#if ctxOk?.more_after}
							<button type="button" class="rv-more" onclick={() => (win = { ...win, after: Math.min(30, win.after + 10) })}>{tFn('og2.rv_more_after')}</button>
						{/if}
					</div>
					{#if marks.length > 1}
						<div class="rv-anchor" role="group" aria-label={tFn('og2.rv_anchor_group')}>
							<button type="button" aria-label={tFn('og2.rv_anchor_prev')} onclick={() => goTo(at - 1, true)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg></button>
							<span>{tFn('og2.rv_anchor_pos', { i: at + 1, n: marks.length })}</span>
							<button type="button" aria-label={tFn('og2.rv_anchor_next')} onclick={() => goTo(at + 1, true)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button>
						</div>
					{/if}
				</div>
				<p class="rv-notes">{tFn('og2.rv_notes', { name: h.author_username, left: expiresIn(h.created_at) })}</p>
			</div>
		</section>
	{/if}
</div>
{#if done}<p class="nx-pilot rv-toast" role="status">{done}</p>{/if}

<style>
	/* Jetons : ceux du thème (--nx-*) pour fond, texte, bordure ; ceux du pilote (--pl-*) pour l'accent et l'ocre. */
	.rv { --rv-surface: var(--nx-surface); --rv-text: var(--nx-text); --rv-muted: var(--nx-text-muted); --rv-faint: var(--nx-text-faint);
		--rv-line: var(--nx-border); --rv-canvas: color-mix(in srgb, var(--nx-text) 4%, var(--nx-surface));
		--rv-head: color-mix(in srgb, var(--pl-accent) 7%, var(--nx-surface)); --rv-red: var(--nx-bad, #c0362c);
		display: block; color: var(--rv-text); font-size: 15px; line-height: 1.55; }
	h2, h3 { margin: 0; }

	/* La file */
	.rv-file { display: grid; gap: 12px; }
	.rv-file-head { padding: 12px 16px 10px; border: 1px solid var(--rv-line); border-radius: var(--pl-r-panel); background: var(--rv-head); }
	.rv-l1 { display: flex; align-items: baseline; gap: 10px; }
	.rv-l1 h2 { font-size: 15px; font-weight: 700; }
	.rv-count { margin-left: auto; font-size: 13px; color: var(--rv-muted); white-space: nowrap; }
	.rv-file-head p { margin: 2px 0 0; font-size: 13px; color: var(--rv-faint); }
	.rv-touch { display: none; }
	.rv-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 12px; align-items: start; }
	.rv-card { background: var(--rv-surface); border: 1px solid var(--rv-line); border-radius: var(--pl-r-panel); overflow: hidden; }
	.rv-card-head { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 0 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--rv-line);
		background: color-mix(in srgb, var(--rv-c) 10%, var(--rv-surface)); }
	.rv-card-head .rv-ava { width: 34px; height: 34px; font-size: 14px; grid-row: span 2; }
	.rv-name { font-weight: 700; overflow-wrap: anywhere; }
	.rv-summary { font-size: 13px; color: var(--rv-muted); line-height: 1.4; }
	.rv-nb { grid-row: span 2; min-width: 26px; height: 26px; padding: 0 7px; border-radius: 999px; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: var(--rv-muted); background: var(--rv-canvas); border: 1px solid var(--rv-line); }
	.rv-ava { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 13px; flex: none; }
	.rv-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) 16px; align-items: center; gap: 0 10px; width: 100%; text-align: left; font: inherit; color: inherit;
		background: none; border: 0; border-bottom: 1px solid var(--rv-line); padding: 10px 14px; cursor: pointer; transition: background .12s; }
	.rv-row:last-child { border-bottom: 0; }
	.rv-row:hover { background: var(--rv-canvas); }
	.rv-row[aria-selected='true'] { background: var(--pl-accent-soft); box-shadow: inset 0 0 0 1.5px var(--pl-accent); }
	.rv-row:last-child[aria-selected='true'] { border-radius: 0 0 var(--pl-r-panel) var(--pl-r-panel); }
	.rv-time { align-self: start; padding-top: 1px; font-size: 13px; color: var(--rv-faint); font-variant-numeric: tabular-nums; }
	.rv-body { min-width: 0; }
	.rv-place { display: block; font-size: 13px; color: var(--rv-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.rv-excerpt { display: block; margin-top: 1px; font-size: 14px; color: var(--rv-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.rv-row[aria-selected='true'] .rv-excerpt { color: var(--rv-text); font-weight: 600; }
	.rv-chev { color: var(--rv-faint); transition: transform .15s, color .15s; }
	.rv-row:hover .rv-chev { color: var(--rv-text); transform: translateX(2px); }
	.rv-row[aria-selected='true'] .rv-chev { color: var(--pl-accent); }

	/* Le dossier */
	.rv-dossier { background: var(--rv-surface); border: 1px solid var(--rv-line); border-radius: var(--pl-r-panel); min-width: 0; }
	.rv-d-head { padding: 14px 20px; border-bottom: 1px solid var(--rv-line); background: var(--rv-head); border-radius: var(--pl-r-panel) var(--pl-r-panel) 0 0; }
	.rv-back { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 10px; padding: 0; background: none; border: 0; color: var(--pl-accent); font: inherit; font-weight: 700; cursor: pointer; }
	.rv-l2 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 8px; font-size: 14.5px; }
	.rv-by { color: var(--rv-muted); }
	.rv-ava-s { width: 26px; height: 26px; font-size: 12px; }
	.rv-file-link { margin-left: auto; font-size: 14px; font-weight: 700; color: var(--pl-accent); text-decoration: none; }
	.rv-file-link:hover { text-decoration: underline; }
	.rv-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; padding: 3px 10px 3px 8px; border-radius: 999px; white-space: nowrap; }
	.rv-pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
	.rv-pill-ochre { color: var(--pl-changed); background: var(--pl-changed-soft); }
	.rv-pill-grey { color: var(--rv-muted); background: var(--rv-canvas); border: 1px solid var(--rv-line); }
	.rv-pill-red { color: var(--rv-red); background: color-mix(in srgb, var(--rv-red) 12%, var(--rv-surface)); }
	.rv-d-body { padding: 18px 20px 14px; }
	.rv-title { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; }
	.rv-title h3 { font-size: 19px; line-height: 1.3; }
	.rv-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 7px 16px; margin: 14px 0 0; font-size: 14.5px; }
	.rv-facts dt { color: var(--rv-muted); }
	.rv-facts dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
	.rv-path a { color: var(--rv-text); text-decoration: none; border-bottom: 1px solid var(--rv-line); }
	.rv-path a:hover { color: var(--pl-accent); border-color: var(--pl-accent); }
	.rv-sep, .rv-faint { color: var(--rv-faint); }
	.rv-tip { position: relative; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--rv-line); background: var(--rv-surface); color: var(--rv-muted); font: inherit; font-size: 12px; font-weight: 800; cursor: help; padding: 0; }
	.rv-tip:hover, .rv-tip:focus-visible { color: var(--pl-accent); border-color: var(--pl-accent); }
	.rv-tip-txt { position: absolute; left: 50%; top: calc(100% + 8px); transform: translateX(-50%); width: 280px; padding: 10px 12px; border-radius: var(--pl-r-panel); background: var(--rv-surface); border: 1px solid var(--rv-line);
		box-shadow: 0 12px 32px rgba(0, 0, 0, .25); color: var(--rv-text); font-size: 13.5px; font-weight: 400; line-height: 1.45; text-align: left; opacity: 0; pointer-events: none; transition: opacity .12s; z-index: 5; }
	.rv-tip:hover .rv-tip-txt, .rv-tip:focus-visible .rv-tip-txt { opacity: 1; }

	/* La conversation, avec le dossier à sa place */
	.rv-conv-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 14px; margin-top: 18px; }
	.rv-lbl { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
	.rv-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 8px; font-size: 13px; color: var(--rv-muted); }
	.rv-legend span { display: inline-flex; align-items: center; gap: 6px; }
	.rv-legend i { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--rv-line); }
	.rv-k-this { background: var(--pl-changed-soft); border-color: var(--pl-changed) !important; }
	.rv-k-also { background: color-mix(in srgb, var(--pl-changed-soft) 55%, var(--rv-surface)); }
	.rv-k-author { background: var(--pl-accent-soft); }
	.rv-fil-frame { position: relative; border: 1px solid var(--rv-line); border-radius: var(--pl-r-panel); overflow: hidden; }
	.rv-fil { max-height: 560px; overflow-y: auto; }
	.rv-start { text-align: center; font-size: 12.5px; color: var(--rv-faint); padding: 10px 0 4px; }
	.rv-more { display: block; width: 100%; padding: 9px; background: var(--rv-canvas); border: 0; border-bottom: 1px solid var(--rv-line); color: var(--pl-accent); font: inherit; font-weight: 700; font-size: 13.5px; cursor: pointer; }
	.rv-more:last-child { border-bottom: 0; border-top: 1px solid var(--rv-line); }
	.rv-more:hover { background: var(--pl-accent-soft); }
	.rv-pad { padding: 10px 14px; margin: 0; }
	.rv-msg { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 2px 10px; padding: 8px 14px; font-size: 14.5px; }
	.rv-msg .rv-ava { width: 32px; height: 32px; grid-row: span 2; }
	.rv-msg-h { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
	.rv-msg-h time { font-size: 12.5px; color: var(--rv-faint); }
	.rv-msg p { margin: 0; overflow-wrap: anywhere; white-space: pre-line; }
	.rv-msg > p, .rv-msg > details, .rv-msg > .rv-decide, .rv-msg > .rv-error { grid-column: 2; }
	.rv-subject { font-weight: 800; }
	.rv-tag { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 1px 8px; color: var(--pl-changed); }
	.rv-this { background: var(--pl-changed-soft); box-shadow: inset 0 0 0 1.5px var(--pl-changed); }
	.rv-this .rv-tag { background: var(--rv-surface); }
	.rv-also { background: color-mix(in srgb, var(--pl-changed-soft) 55%, var(--rv-surface)); }
	.rv-author { background: var(--pl-accent-soft); }
	:global(.rv-pulse) { animation: rv-pulse 1.1s ease-out 1; }
	@keyframes rv-pulse { 0% { box-shadow: inset 0 0 0 1.5px var(--pl-changed), 0 0 0 0 color-mix(in srgb, var(--pl-changed) 55%, transparent); } 100% { box-shadow: inset 0 0 0 1.5px var(--pl-changed), 0 0 0 12px transparent; } }
	.rv-current { margin-top: 6px; font-size: 13.5px; color: var(--rv-muted); }
	.rv-current summary { cursor: pointer; font-weight: 700; }
	.rv-decide { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 10px 0 2px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--pl-changed) 35%, transparent); }
	.rv-q { width: 100%; font-weight: 700; font-size: 14px; }
	.rv-btn { font: inherit; font-weight: 700; font-size: 14px; line-height: 1; border-radius: var(--pl-r-control); padding: 8px 13px; min-height: 38px; border: 1px solid var(--rv-line); background: var(--rv-surface); cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
	.rv-btn:disabled { opacity: .55; cursor: progress; }
	.rv-btn-refuse { color: var(--rv-red); }
	.rv-btn-refuse:hover:not(:disabled) { border-color: var(--rv-red); background: color-mix(in srgb, var(--rv-red) 10%, var(--rv-surface)); }
	.rv-btn-publish { color: var(--pl-ok); }
	.rv-btn-publish:hover:not(:disabled) { border-color: var(--pl-ok); background: var(--pl-ok-soft); }
	.rv-error { margin: 8px 0 0; font-size: 13.5px; font-weight: 700; color: var(--rv-red); }
	.rv-anchor { position: absolute; right: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: var(--rv-surface); border: 1px solid var(--rv-line); box-shadow: 0 12px 32px rgba(0, 0, 0, .2); font-size: 13px; }
	.rv-anchor span { padding: 0 8px; color: var(--rv-muted); font-variant-numeric: tabular-nums; }
	.rv-anchor button { width: 30px; height: 30px; border-radius: 50%; border: 0; background: none; color: var(--rv-text); cursor: pointer; display: grid; place-items: center; }
	.rv-anchor button:hover { background: var(--rv-canvas); }
	.rv-notes { margin: 10px 0 4px; font-size: 13.5px; color: var(--rv-muted); }
	.rv-toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); margin: 0; padding: 11px 16px; border-radius: var(--pl-r-panel); background: var(--nx-surface); color: var(--nx-text); border: 1px solid var(--nx-border); box-shadow: 0 12px 32px rgba(0, 0, 0, .25); font-size: 14.5px; z-index: 60; max-width: calc(100% - 32px); }

	/* Téléphone : la file, ou un dossier en plein écran */
	@media (max-width: 700px) {
		.rv-pc { display: none; } .rv-touch { display: inline; }
		.rv-d-head, .rv-d-body { padding-left: 14px; padding-right: 14px; }
		.rv-facts { grid-template-columns: 1fr; gap: 2px; }
		.rv-facts dd { margin-bottom: 8px; }
		.rv-fil { max-height: none; }
		.rv-fil-frame { overflow: visible; border: 0; }
		.rv-fil { border: 1px solid var(--rv-line); border-radius: var(--pl-r-panel); overflow: hidden; }
		.rv-anchor { position: static; margin: 8px 0 0 auto; display: flex; width: max-content; box-shadow: none; }
		.rv-decide .rv-btn { flex: 1; justify-content: center; }
		.rv-tip-txt { left: auto; right: -40px; transform: none; width: 240px; }
	}
	@media (prefers-reduced-motion: reduce) { .rv-row, .rv-chev { transition: none; } }
</style>
