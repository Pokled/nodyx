<!--
  État des traductions (translate.nodyx.org).

  Tableau de bord, pas plaquette : la table des langues est l'objet principal,
  triable et filtrable. Tous les chiffres viennent de translationProgress.ts,
  donc des fichiers de locale eux-mêmes : la page ne peut pas mentir.
-->
<script lang="ts">
	import { t, locale }              from '$lib/i18n'
	import { getTranslationProgress } from '$lib/translationProgress'
	import type { LocaleProgress }    from '$lib/translationProgress'

	const tFn = $derived($t)

	const REPO    = 'https://github.com/Pokled/nodyx'
	const LOCALES_DIR = `${REPO}/tree/main/nodyx-frontend/src/lib/locales`

	// Le guide de contribution vit dans docs/<langue>/, il n'y en a pas a la
	// racine du depot. On envoie le visiteur droit sur la section traduction,
	// dans sa langue quand elle existe (fr, en, es), sinon en anglais.
	const GUIDES: Record<string, string> = {
		fr: 'docs/fr/CONTRIBUTING.md#traduire-nodyx',
		en: 'docs/en/CONTRIBUTING.md#translating-nodyx',
		es: 'docs/es/CONTRIBUTING.md#traducir-nodyx',
	}
	const CONTRIB = $derived(`${REPO}/blob/main/${GUIDES[$locale.slice(0, 2)] ?? GUIDES.en}`)

	// Une langue absente de la liste ne peut pas etre ajoutee par le visiteur seul :
	// le cablage est en dur dans i18n.ts (type Locale, LOCALES, imports, messages).
	// Le gabarit d'issue est donc la vraie porte d'entree, pas une pull request.
	const NEW_LANG = `${REPO}/issues/new?template=new_language.yml`
	const editUrl = (code: string) => `${REPO}/edit/main/nodyx-frontend/src/lib/locales/${code}.json`
	const viewUrl = (code: string) => `${REPO}/blob/main/nodyx-frontend/src/lib/locales/${code}.json`

	const progress = getTranslationProgress()

	// Les nombres suivent la langue affichée (séparateurs de milliers).
	const nf  = $derived(new Intl.NumberFormat($locale))
	const num = $derived((n: number) => nf.format(n))

	type SortKey = 'label' | 'pct' | 'translated' | 'missing'
	let sortKey = $state<SortKey>('pct')
	let sortDir = $state<'asc' | 'desc'>('desc')
	let query   = $state('')

	function sortBy(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
		else { sortKey = key; sortDir = key === 'label' ? 'asc' : 'desc' }
	}

	const rows = $derived((() => {
		const q = query.trim().toLowerCase()
		const out = progress.languages.filter(
			(l) => !q || l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q),
		)
		return out.sort((a: LocaleProgress, b: LocaleProgress) => {
			const d = sortKey === 'label'
				? a.label.localeCompare(b.label)
				: (a[sortKey] as number) - (b[sortKey] as number)
			const tie = d === 0 ? a.label.localeCompare(b.label) : d
			return sortDir === 'asc' ? tie : -tie
		})
	})())

	const caret = $derived(sortDir === 'asc' ? '▲' : '▼')
</script>

<svelte:head>
	<title>{tFn('translate.meta.title')}</title>
	<meta name="description" content={tFn('translate.meta.desc')} />
</svelte:head>

<!-- ══ Barre d'application ══════════════════════════════════════════════════ -->
<header class="chrome">
	<a class="logo" href="/">
		<span class="mark"></span>
		Nodyx <span class="sub">{tFn('translate.chrome_sub')}</span>
	</a>
	<nav class="top">
		<a href="#languages">{tFn('translate.nav.languages')}</a>
		<a href={LOCALES_DIR} target="_blank" rel="noopener">{tFn('translate.nav.files')}</a>
	</nav>
	<span class="grow"></span>
	<a class="cta" href={CONTRIB} target="_blank" rel="noopener">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
		{tFn('translate.contribute')}
	</a>
</header>

<div class="wrap">

	<!-- ══ En-tête ══════════════════════════════════════════════════════════ -->
	<div class="phead">
		<div>
			<h1>
				<span class="cico" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>
				</span>
				{tFn('translate.title')}
			</h1>
			<p class="psub">{tFn('translate.subtitle', { n: progress.languages.length })}</p>
		</div>
		<span class="updated">{tFn('translate.computed_hint')}</span>
	</div>

	<!-- ══ Vue d'ensemble ═══════════════════════════════════════════════════ -->
	<section class="overview">
		<div class="metrics">
			<div class="metric">
				<div class="v">{progress.overallPct}<span class="s">%</span></div>
				<div class="k">{tFn('translate.metric.translated')}</div>
			</div>
			<div class="metric">
				<div class="v">{progress.languages.length}</div>
				<div class="k">{tFn('translate.metric.languages')}</div>
			</div>
			<div class="metric">
				<div class="v em">{progress.completeCount}</div>
				<div class="k">{tFn('translate.metric.complete')}</div>
			</div>
			<div class="metric">
				<div class="v">{num(progress.total)}</div>
				<div class="k">{tFn('translate.metric.strings')}</div>
			</div>
			<div class="metric">
				<div class="v">{progress.languages.filter((l) => l.isCoreComplete).length}<span class="s">/{progress.languages.length}</span></div>
				<div class="k">{tFn('translate.metric.core')}</div>
			</div>
		</div>

		<div class="obar"><i style="width:{progress.overallPct}%"></i></div>
		<div class="obar-cap">
			<span>{tFn('translate.overall', { done: num(progress.translatedAll), total: num(progress.grandTotal) })}</span>
			<span>{progress.overallPct}%</span>
		</div>
	</section>

	<!-- ══ Les langues ══════════════════════════════════════════════════════ -->
	<section class="panel" id="languages">
		<div class="panel-head">
			<span class="ttl">{tFn('translate.nav.languages')}</span>
			<span class="cnt">
				{rows.length > 1
					? tFn('translate.lang_count_many', { n: rows.length })
					: tFn('translate.lang_count_one',  { n: rows.length })}
			</span>
			<span class="grow"></span>
			<div class="search">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
				<input type="text" bind:value={query} placeholder={tFn('translate.filter')} aria-label={tFn('translate.filter')} autocomplete="off" />
			</div>
		</div>

		<div class="tscroll">
			<table>
				<thead>
					<tr>
						<th><button type="button" class="sort" class:sorted={sortKey === 'label'} onclick={() => sortBy('label')}>
							{tFn('translate.col.language')} <span class="car">{caret}</span>
						</button></th>
						<th><button type="button" class="sort" class:sorted={sortKey === 'pct'} onclick={() => sortBy('pct')}>
							{tFn('translate.col.progress')} <span class="car">{caret}</span>
						</button></th>
						<th class="num"><button type="button" class="sort" class:sorted={sortKey === 'translated'} onclick={() => sortBy('translated')}>
							{tFn('translate.col.done')} <span class="car">{caret}</span>
						</button></th>
						<th class="num"><button type="button" class="sort" class:sorted={sortKey === 'missing'} onclick={() => sortBy('missing')}>
							{tFn('translate.col.remaining')} <span class="car">{caret}</span>
						</button></th>
						<th class="mid">{tFn('translate.col.core')}</th>
						<th><span class="sr">{tFn('translate.col.actions')}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as l (l.code)}
						<tr>
							<td>
								<div class="lang">
									<span class="flag">{@html l.flagSvg}</span>
									<span class="id">
										<span class="nm">
											{l.label}
											{#if l.isSource}
												<span class="tag src">{tFn('translate.tag.source')}</span>
											{:else if l.isComplete}
												<span class="tag done">{tFn('translate.tag.complete')}</span>
											{/if}
										</span>
										<span class="cd">{l.code}.json</span>
									</span>
								</div>
							</td>
							<td>
								<div class="prog">
									<span class="pbar"><i class:done={l.isComplete} style="width:{l.pct}%"></i></span>
									<span class="pct" class:done={l.isComplete}>{l.pct}%</span>
								</div>
							</td>
							<td class="num">{num(l.translated)}</td>
							<td class="num" class:zero={l.missing === 0}>{num(l.missing)}</td>
							<td class="mid">
								{#if l.isCoreComplete}
									<span class="core-ok" title={tFn('translate.core_done')}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
										<span class="sr">{tFn('translate.core_done')}</span>
									</span>
								{:else}
									<span class="core-no" aria-hidden="true">·</span>
								{/if}
							</td>
							<td>
								<div class="acts">
									<a class="icat edit" href={editUrl(l.code)} target="_blank" rel="noopener" title={tFn('translate.action.edit')} aria-label={tFn('translate.action.edit')}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
									</a>
									<a class="icat" href={viewUrl(l.code)} target="_blank" rel="noopener" title={tFn('translate.action.view')} aria-label={tFn('translate.action.view')}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
									</a>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ══ La langue absente ════════════════════════════════════════════════
	     La table ne montre que les langues livrees. Sans ce bloc, un visiteur
	     dont la langue manque n'a aucune porte : il en deduit que le projet ne
	     l'accepte pas. Signale dans la discussion #595.                       -->
	<section class="newlang">
		<svg class="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>
		</svg>
		<div class="txt">
			<h2>{tFn('translate.newlang.title')}</h2>
			<p>{tFn('translate.newlang.desc')}</p>
		</div>
		<a class="ask" href={NEW_LANG} target="_blank" rel="noopener">
			{tFn('translate.newlang.cta')}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
		</a>
	</section>

	<!-- ══ Le filet ═════════════════════════════════════════════════════════ -->
	<div class="info">
		<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
		<p>{@html tFn('translate.safety')}</p>
		<span class="grow"></span>
		<a class="more" href={CONTRIB} target="_blank" rel="noopener">{tFn('translate.safety_link')}</a>
	</div>

	<footer>
		<a href={REPO} target="_blank" rel="noopener">github.com/Pokled/nodyx</a>
		<span class="dot">·</span><span>AGPL-3.0</span>
		<span class="dot">·</span><span>{tFn('translate.footer_note')}</span>
	</footer>

</div>

<style>
	/* Registre visuel : outil, pas vitrine. Gris neutres, une seule couleur
	   d'accent (indigo) sur les actions, l'émeraude réservé à « complet ». */
	:global(body) { background: #0b0c11; }

	.wrap { max-width: 1120px; margin: 0 auto; padding: 26px 22px 90px; color: #e7e8ef; font-size: 14px; line-height: 1.45; }
	.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

	/* ── Barre d'application ─────────────────────────────────────────────── */
	.chrome {
		position: sticky; top: 0; z-index: 20;
		height: 54px; display: flex; align-items: center; gap: 26px; padding: 0 22px;
		background: rgb(14 15 21 / 0.88); backdrop-filter: blur(10px);
		border-bottom: 1px solid #1c1e28;
	}
	.logo { display: flex; align-items: center; gap: 9px; font-weight: 650; letter-spacing: -0.01em; color: #e7e8ef; text-decoration: none; }
	.logo .mark { width: 20px; height: 20px; border-radius: 6px; background: linear-gradient(135deg, var(--nx-accent), var(--nx-accent-2)); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1); }
	.logo .sub { color: #61647a; font-weight: 500; font-size: 13px; }
	nav.top { display: flex; gap: 4px; }
	nav.top a { font-size: 13px; color: #9698ab; padding: 6px 10px; border-radius: 7px; text-decoration: none; }
	nav.top a:hover { color: #e7e8ef; background: rgb(255 255 255 / 0.028); }
	.grow { flex: 1; }
	.cta {
		display: inline-flex; align-items: center; gap: 7px;
		font-size: 13px; font-weight: 600; color: #fff; text-decoration: none;
		background: var(--nx-accent); padding: 7px 13px; border-radius: 8px;
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12);
	}
	.cta:hover { filter: brightness(1.07); }
	.cta svg { width: 15px; height: 15px; }

	/* ── En-tête ─────────────────────────────────────────────────────────── */
	.phead { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
	h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; display: flex; align-items: center; gap: 11px; }
	.cico {
		width: 30px; height: 30px; border-radius: 8px; flex: none; display: grid; place-items: center;
		color: #8b93ff; background: rgb(109 118 245 / 0.1); border: 1px solid rgb(109 118 245 / 0.22);
	}
	.cico svg { width: 17px; height: 17px; }
	.psub { margin: 7px 0 0; color: #9698ab; font-size: 13.5px; padding-left: 41px; max-width: 62ch; }
	.updated { color: #61647a; font: 500 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

	/* ── Vue d'ensemble ──────────────────────────────────────────────────── */
	.overview { margin: 26px 0 30px; }
	.metrics { display: flex; flex-wrap: wrap; }
	.metric { padding: 0 20px; border-left: 1px solid #1c1e28; }
	.metric:first-child { padding-left: 0; border-left: 0; }
	.metric .v { font: 700 19px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
	.metric .v .s { color: #61647a; font-weight: 600; font-size: 14px; }
	.metric .v.em { color: #2ece93; }
	.metric .k { color: #61647a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; margin-top: 6px; }
	.obar { margin-top: 20px; height: 6px; border-radius: 999px; background: rgb(255 255 255 / 0.065); overflow: hidden; }
	.obar > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--nx-accent), #8b93ff); }
	.obar-cap { margin-top: 9px; display: flex; justify-content: space-between; gap: 12px; font: 500 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #61647a; }

	/* ── Panneau + table ─────────────────────────────────────────────────── */
	.panel { border: 1px solid #1c1e28; border-radius: 11px; background: #0f1016; overflow: hidden; scroll-margin-top: 70px; }
	.panel-head { display: flex; align-items: center; gap: 14px; padding: 13px 16px; border-bottom: 1px solid #1c1e28; background: #12131b; }
	.panel-head .ttl { font-weight: 650; font-size: 14px; }
	.panel-head .cnt { font: 500 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #61647a; }
	.search { position: relative; }
	.search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: #61647a; pointer-events: none; }
	.search input {
		width: 210px; background: #0b0c11; border: 1px solid #262936; color: #e7e8ef;
		font-family: inherit; font-size: 13px; padding: 7px 11px 7px 30px; border-radius: 8px; outline: none;
	}
	.search input:focus-visible { border-color: var(--nx-accent); box-shadow: 0 0 0 3px rgb(109 118 245 / 0.15); }
	.search input::placeholder { color: #61647a; }

	/* `position: relative` N'EST PAS DECORATIF, il corrige un debordement.
	   La page defilait horizontalement de 337 px sous 727 px de large, sans
	   qu'aucun element visible ne depasse : la zone a droite etait vide.
	   Cause, trouvee au troisieme essai. Les libelles `.sr` reserves aux lecteurs
	   d'ecran sont en `position: absolute`. Sans ancetre positionne, leur bloc
	   conteneur est le bloc conteneur INITIAL, pas ce conteneur defilant : ils
	   lui echappaient et etendaient la zone defilable du document jusqu'a 727 px,
	   la ou se trouve le dernier d'entre eux dans la table de 800 px.
	   Mesure : `body` ne debordait pas (390 pour 390), seul `html` debordait.
	   C'est la signature d'un element positionne par rapport au bloc initial.
	   En rendant ce conteneur positionne, les `.sr` redeviennent les siens, donc
	   contenus et rognes. Ils restent lus par les lecteurs d'ecran. */
	.tscroll { overflow-x: auto; position: relative; }
	table { width: 100%; border-collapse: collapse; min-width: 720px; }
	th { text-align: left; padding: 0; border-bottom: 1px solid #1c1e28; white-space: nowrap; }
	th.mid { padding: 11px 16px; text-align: center; }
	th.mid, th:last-child { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.06em; text-transform: uppercase; color: #61647a; }
	button.sort {
		width: 100%; background: none; border: 0; cursor: pointer; text-align: inherit;
		font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		letter-spacing: 0.06em; text-transform: uppercase; color: #61647a; padding: 11px 16px;
	}
	th.num button.sort { text-align: right; }
	button.sort:hover { color: #9698ab; }
	button.sort .car { opacity: 0; margin-left: 5px; font-size: 9px; }
	button.sort.sorted { color: #9698ab; }
	button.sort.sorted .car { opacity: 1; color: #8b93ff; }

	tbody tr { border-bottom: 1px solid #1c1e28; transition: background 0.12s; }
	tbody tr:last-child { border-bottom: 0; }
	tbody tr:hover { background: rgb(255 255 255 / 0.028); }
	td { padding: 12px 16px; vertical-align: middle; }
	td.num { text-align: right; font: 500 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; color: #9698ab; white-space: nowrap; }
	td.num.zero { color: #61647a; }
	td.mid { text-align: center; }

	.lang { display: flex; align-items: center; gap: 12px; }
	.flag { width: 26px; height: 26px; flex: none; border-radius: 5px; overflow: hidden; line-height: 0; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12); }
	.flag :global(svg) { display: block; width: 100%; height: 100%; }
	.id { display: flex; flex-direction: column; gap: 2px; }
	.nm { font-weight: 600; letter-spacing: -0.01em; }
	.cd { font: 500 11.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #61647a; }
	.tag { font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 6px; border-radius: 5px; margin-left: 4px; }
	.tag.src { color: #9698ab; border: 1px solid #262936; }
	.tag.done { color: #2ece93; border: 1px solid rgb(46 206 147 / 0.3); background: rgb(46 206 147 / 0.08); }

	.prog { display: flex; align-items: center; gap: 12px; min-width: 200px; }
	.pbar { position: relative; flex: 1; height: 7px; border-radius: 999px; background: rgb(255 255 255 / 0.065); overflow: hidden; }
	.pbar > i { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 999px; background: var(--nx-accent); }
	.pbar > i.done { background: #2ece93; }
	.pct { font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; min-width: 3.6ch; text-align: right; }
	.pct.done { color: #2ece93; }

	.core-ok { color: #2ece93; display: inline-flex; }
	.core-ok svg { width: 15px; height: 15px; }
	.core-no { color: #61647a; }

	.acts { display: flex; gap: 4px; justify-content: flex-end; }
	.icat { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 7px; color: #61647a; border: 1px solid transparent; }
	.icat:hover { color: #e7e8ef; background: #0b0c11; border-color: #262936; }
	.icat svg { width: 15px; height: 15px; }
	tr:hover .icat.edit { color: #8b93ff; }

	/* ── Filet + pied ────────────────────────────────────────────────────── */
	/* La porte d'entree d'une langue absente. Meme registre sobre que le reste,
	   mais un contour un peu plus present : c'est la seule action de la page qui
	   ne concerne pas une langue deja listee. */
	.newlang {
		display: flex; align-items: center; gap: 15px; margin-top: 16px; padding: 16px 18px;
		border: 1px solid #24273a; border-radius: 10px; background: #0f1016;
	}
	.newlang .globe { width: 26px; height: 26px; flex: none; color: #8b93ff; opacity: .85; }
	.newlang .txt { flex: 1; min-width: 0; }
	.newlang h2 { margin: 0 0 3px; font-size: 14px; font-weight: 600; color: #e7e8ef; }
	.newlang p  { margin: 0; font-size: 13px; line-height: 1.5; color: #9698ab; }
	/* Classe distincte de `.cta` : celle-ci habille le bouton plein de l'en-tete,
	   et l'heriter apporterait son ombre interne sans qu'on l'ait demande. */
	.newlang .ask {
		flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
		padding: 9px 15px; border-radius: 8px; border: 1px solid #343a5e;
		background: #191c2e; color: #b9beff; font-size: 13px; font-weight: 600;
		text-decoration: none; transition: background .15s, border-color .15s;
	}
	.newlang .ask svg { width: 15px; height: 15px; }
	.newlang .ask:hover { background: #202541; border-color: #4a527f; }
	.newlang .ask:focus-visible { outline: 2px solid #8b93ff; outline-offset: 2px; }

	.info {
		display: flex; align-items: center; gap: 13px; margin-top: 16px; padding: 13px 16px;
		border: 1px solid #1c1e28; border-radius: 10px; background: #0f1016; color: #9698ab; font-size: 13px;
	}
	.info svg.i { width: 17px; height: 17px; flex: none; color: #2ece93; }
	.info p { margin: 0; }
	.info :global(b) { color: #e7e8ef; font-weight: 600; }
	.info :global(code) { font: 500 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #8b93ff; }
	.info .more { color: #8b93ff; font-weight: 600; white-space: nowrap; text-decoration: none; }
	.info .more:hover { text-decoration: underline; }

	footer { margin-top: 30px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; color: #61647a; font: 500 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
	footer a { color: inherit; text-decoration: none; }
	footer a:hover { color: #9698ab; }
	footer .dot { color: #262936; }

	@media (max-width: 640px) {
		.metric { padding: 0 14px; }
		.search input { width: 150px; }

		/* En colonne, `align-items: center` empecherait le bouton de prendre la
		   largeur : on repasse explicitement en `stretch`. */
		.newlang { flex-direction: column; align-items: stretch; text-align: left; gap: 12px; }
		.newlang .globe { width: 22px; height: 22px; }

		/* La barre etait en ligne unique, hauteur fixe et sans repli : a 390px le
		   bouton sortait de 149px hors ecran, mesure. On autorise le repli plutot
		   que de masquer le lien « Fichiers », qui n'a pas d'autre acces ici. */
		.chrome { height: auto; flex-wrap: wrap; gap: 8px 14px; padding: 9px 14px; }
		.chrome .grow { display: none; }
		nav.top { flex: 1; }
	}
</style>
