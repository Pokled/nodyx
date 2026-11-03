<script lang="ts">
	// Les mots interdits rangés en trois cases (mot entier, début de mot,
	// n'importe où), sans aucune syntaxe à retenir. L'essai en direct utilise la
	// copie fidèle du moteur (lib/octoguard/keywords.ts) : ce qui est surligné ici
	// est exactement ce que le serveur prendra.
	import { untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import Icon from './Icon.svelte'
	import { splitWords, joinWords, scan, overreach, usable, bare, type WordLists, type WordKind } from '$lib/octoguard/keywords'
	import SAMPLE from '$lib/octoguard/word-sample.json'
	import PACKS from '$lib/octoguard/word-packs.json'

	let { words, exceptions, busy = false, demo = false, onsave }: {
		words: string[]
		exceptions: string[]
		busy?: boolean
		/** Guide : on essaie tout, rien ne s'enregistre. */
		demo?: boolean
		onsave: (words: string[], exceptions: string[]) => void | Promise<void>
	} = $props()
	const tFn = $derived($t)

	type Box = WordKind | 'allow'
	const KINDS: Array<{ kind: WordKind; glyph: string }> = [
		{ kind: 'exact', glyph: 'mot' },
		{ kind: 'prefix', glyph: 'mot…' },
		{ kind: 'contains', glyph: '…mot…' },
	]
	const ICON_X = 'M6 6l12 12 M18 6L6 18'
	const ICON_OK = 'M5 13l4 4L19 7'
	const ICON_ALERT = 'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'

	// État local, remis à zéro quand la version enregistrée change.
	let lists = $state<WordLists>({ exact: [], prefix: [], contains: [] })
	let allow = $state<string[]>([])
	// Ne remettre à zéro que si la version ENREGISTRÉE a vraiment changé : basculer
	// l'interrupteur ou le cran de la carte ne doit pas effacer une saisie en cours.
	let lastSaved = ''
	$effect(() => {
		const w = words, e = exceptions
		const key = JSON.stringify([w, e])
		if (key === lastSaved) return
		lastSaved = key
		untrack(() => { lists = splitWords(w); allow = [...e] })
	})
	const dirty = $derived(
		JSON.stringify(joinWords(lists)) !== JSON.stringify(joinWords(splitWords(words))) ||
		JSON.stringify(allow) !== JSON.stringify(exceptions),
	)

	let drafts = $state<Record<Box, string>>({ exact: '', prefix: '', contains: '', allow: '' })
	let tooShort = $state<Box | null>(null)

	function current(box: Box): string[] { return box === 'allow' ? allow : lists[box] }
	function add(box: Box) {
		const items = drafts[box].split(',').map((w) => bare(w)).filter(Boolean)
		const bad = items.filter((w) => !usable(w))
		tooShort = bad.length ? box : null
		const have = new Set(current(box).map((w) => w.toLowerCase()))
		const fresh = items.filter((w) => usable(w) && !have.has(w.toLowerCase()))
		if (box === 'allow') allow = [...allow, ...fresh]
		else lists = { ...lists, [box]: [...lists[box], ...fresh] }
		drafts[box] = ''
	}
	function remove(box: Box, i: number) {
		if (box === 'allow') allow = allow.filter((_, j) => j !== i)
		else lists = { ...lists, [box]: lists[box].filter((_, j) => j !== i) }
	}
	function onKey(e: KeyboardEvent, box: Box) {
		if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(box) }
		else if (e.key === 'Backspace' && !drafts[box] && current(box).length) remove(box, current(box).length - 1)
	}
	function toExact(kind: WordKind, word: string) {
		lists = { ...lists, [kind]: lists[kind].filter((w) => w !== word), exact: lists.exact.includes(word) ? lists.exact : [...lists.exact, word] }
	}
	function allowWord(w: string) { if (!allow.includes(w)) allow = [...allow, w] }

	// Lots prêts à l'emploi, dans la langue de l'interface (fr, sinon en).
	const lang = $derived(String($locale ?? 'fr').startsWith('fr') ? 'fr' : 'en')
	const packs = $derived((PACKS as any)[lang] as Record<string, WordLists>)
	let added = $state<Record<string, boolean>>({})
	function addPack(id: string) {
		const p = packs[id]
		const merge = (a: string[], b: string[]) => [...a, ...b.filter((w) => !a.some((x) => x.toLowerCase() === w.toLowerCase()))]
		lists = { exact: merge(lists.exact, p.exact), prefix: merge(lists.prefix, p.prefix), contains: merge(lists.contains, p.contains) }
		added = { ...added, [id]: true }
	}

	// Essai en direct, et mots innocents qu'une case large prendrait aussi.
	// Phrase d'exemple posée une seule fois : vider le champ doit le laisser vide.
	let tryText = $state(untrack(() => $t('og2.words_try_default')))
	const segments = $derived(scan(tryText, joinWords(lists), allow))
	const caught = $derived(segments.filter((s) => s.state === 'hit'))
	const allowedSeen = $derived(segments.filter((s) => s.state === 'allowed'))
	const warnings = $derived(overreach(lists, allow, SAMPLE.words))
	const total = $derived(lists.exact.length + lists.prefix.length + lists.contains.length)
	// Le moteur ne lit que les 500 premiers mots : au-delà, ils seraient ignorés sans bruit.
	const MAX_WORDS = 500
	const tooMany = $derived(total > MAX_WORDS)

	function reset() { lists = splitWords(words); allow = [...exceptions]; added = {} }
</script>

<div class="og-words">
	<div class="og-words-head">
		<div><b>{tFn('og2.words_title')}</b> <span class="og-help" style="display:inline">· {tFn('og2.words_count', { n: total, a: allow.length })}</span></div>
		<span class="og-help">{tFn('og2.words_hint')}</span>
	</div>

	<div class="og-wf-grid">
		{#each KINDS as k (k.kind)}
			<div class="og-wf">
				<div class="og-wf-t"><span class="og-glyph">{k.glyph}</span>{tFn(`og2.wf_${k.kind}_title`)}<span class="og-count">{lists[k.kind].length}</span></div>
				<p>{tFn(`og2.wf_${k.kind}_desc`)}</p>
				<div class="og-tagbox">
					{#each lists[k.kind] as w, i (i)}
						<span class="og-tag">{w}<button type="button" onclick={() => remove(k.kind, i)} aria-label={tFn('og2.words_remove', { w })}>×</button></span>
					{/each}
					<input bind:value={drafts[k.kind]} onkeydown={(e) => onKey(e, k.kind)} onblur={() => drafts[k.kind] && add(k.kind)}
						placeholder={tFn(`og2.wf_${k.kind}_ph`)} aria-label={tFn(`og2.wf_${k.kind}_title`)} />
				</div>
				{#if tooShort === k.kind}<span class="og-error">{tFn('og2.words_too_short')}</span>{/if}
				<div class="og-wf-ex">
					<span class="og-help">{tFn('og2.wf_example', { w: tFn(`og2.wf_${k.kind}_ex`) })}</span>
					<span class="og-y"><Icon d={ICON_X} />{tFn('og2.wf_caught', { list: tFn(`og2.wf_${k.kind}_yes`) })}</span>
					{#if k.kind === 'contains'}
						<span class="og-w"><Icon d={ICON_ALERT} />{tFn('og2.wf_contains_warn')}</span>
					{:else}
						<span class="og-n"><Icon d={ICON_OK} />{tFn('og2.wf_passes', { list: tFn(`og2.wf_${k.kind}_no`) })}</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<div class="og-wf">
		<div class="og-wf-t"><span class="og-glyph og-ok">ok</span>{tFn('og2.wf_allow_title')}<span class="og-count">{allow.length}</span></div>
		<p>{tFn('og2.wf_allow_desc')}</p>
		<div class="og-tagbox">
			{#each allow as w, i (i)}
				<span class="og-tag">{w}<button type="button" onclick={() => remove('allow', i)} aria-label={tFn('og2.words_remove', { w })}>×</button></span>
			{/each}
			<input bind:value={drafts.allow} onkeydown={(e) => onKey(e, 'allow')} onblur={() => drafts.allow && add('allow')}
				placeholder={tFn('og2.wf_allow_ph')} aria-label={tFn('og2.wf_allow_title')} />
		</div>
		{#if tooShort === 'allow'}<span class="og-error">{tFn('og2.words_too_short')}</span>{/if}
	</div>

	{#each warnings as w, wi (wi)}
		<div class="og-warnbox" role="status">
			<Icon d={ICON_ALERT} />
			<div>
				{tFn('og2.words_overreach', { w: w.word, kind: tFn(`og2.wf_${w.kind}_title`), list: w.caught.join(', ') })}
				<div class="adm-actions" style="margin-top:0.5rem">
					<button type="button" class="adm-btn adm-btn--sm" onclick={() => toExact(w.kind, w.word)}>{tFn('og2.words_to_exact', { w: w.word })}</button>
					{#each w.caught as c, ci (ci)}
						<button type="button" class="adm-btn adm-btn--sm" style="border-color:transparent;background:transparent" onclick={() => allowWord(c)}>{tFn('og2.words_allow_one', { w: c })}</button>
					{/each}
				</div>
			</div>
		</div>
	{/each}

	<div class="og-wf">
		<div class="og-wf-t"><Icon d="M9 3h6 M10 3v6L4.5 19A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-2L14 9V3 M7 15h10" />{tFn('og2.words_try_title')}</div>
		<input class="adm-input" bind:value={tryText} aria-label={tFn('og2.words_try_title')} />
		<div class="og-try-out">{#each segments as s, i (i)}{#if s.state === 'hit'}<mark class="og-hit" title={tFn(`og2.wf_${s.pattern.kind}_title`)}>{s.text}</mark>{:else if s.state === 'allowed'}<mark class="og-allowed">{s.text}</mark>{:else}{s.text}{/if}{/each}</div>
		<div class="og-try-sum">
			{#each caught as s, i (i)}
				{#if s.state === 'hit'}<span class="adm-pill" style="color:var(--og-delete)">{tFn('og2.words_hit_pill', { tok: s.text, kind: tFn(`og2.wf_${s.pattern.kind}_title`), w: s.pattern.raw.replace(/^\*|\*$/g, '') })}</span>{/if}
			{/each}
			{#if caught.length === 0}<span class="adm-pill adm-pill--ok">{tFn('og2.words_nothing')}</span>{/if}
			{#each allowedSeen as s, i (i)}<span class="adm-pill adm-pill--ok">{tFn('og2.words_allowed_pill', { tok: s.text })}</span>{/each}
		</div>
	</div>

	<div class="og-packs">
		<span class="og-help">{tFn('og2.packs_label')}</span>
		{#each Object.keys(packs) as id (id)}
			<button type="button" class="adm-chip" aria-pressed={!!added[id]} disabled={!!added[id]} onclick={() => addPack(id)}>
				<Icon d={added[id] ? ICON_OK : 'M12 5v14 M5 12h14'} />{tFn(`og2.pack_${id}`)}
			</button>
		{/each}
		<span class="og-help">{tFn('og2.packs_hint')}</span>
	</div>

	{#if demo}
		<p class="og-note"><svg class="og-ico" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" /></svg>{tFn('og2.guide_demo_note')}</p>
	{:else if dirty}
		<div class="og-savebar">
			<span class="og-help">{tFn('og2.words_unsaved')}</span>
			<button type="button" class="adm-btn adm-btn--sm" onclick={reset} disabled={busy}>{tFn('og2.cancel')}</button>
			{#if tooMany}<span class="og-error">{tFn('og2.words_too_many', { max: MAX_WORDS })}</span>{/if}
			<button type="button" class="adm-btn adm-btn--primary adm-btn--sm" disabled={busy || tooMany} onclick={() => onsave(joinWords(lists), allow)}>{tFn('og2.words_save')}</button>
		</div>
	{/if}
</div>
