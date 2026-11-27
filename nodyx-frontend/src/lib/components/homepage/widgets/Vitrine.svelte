<script lang="ts">
	// La vitrine d'accueil (maquette « Polygone dans l'application », validée le 26/11/2026) :
	// un titre, un texte, deux boutons, et jusqu'à trois images légendées en mosaïque.
	// Couleurs, police et arrondi viennent de la grille (--np, --nt, --nr…) : quand elle suit
	// une ambiance v2, c'est la base de design, en clair comme en sombre.
	import { safeHref, safeImg } from './vitrineUrls'
	import { normalizeVitrine, MAX_TILES, type VitrineTile } from '../plugins/vitrineSchema'

	let { config: raw = {} }: { config?: Record<string, unknown>; instance?: Record<string, unknown>; user?: unknown } = $props()
	// Les anciennes vitrines (images à plat) se lisent comme une liste d'affiches
	const config = $derived(normalizeVitrine(raw))

	const str = (k: string) => (typeof config[k] === 'string' ? (config[k] as string).trim() : '')
	const title = $derived(str('title'))
	const text = $derived(str('text'))
	const cta = $derived({ text: str('cta_text'), href: safeHref(str('cta_url')) })
	const cta2 = $derived({ text: str('cta2_text'), href: safeHref(str('cta2_url')) })
	/** Disposition des affiches : une grande et les autres autour, toutes égales, ou en bande */
	const disp = $derived((['grande', 'egales', 'bande'] as const).find(d => d === config.disp) ?? 'grande')
	const tiles = $derived(((config.tiles as VitrineTile[]) ?? [])
		.slice(0, MAX_TILES)
		.map((x, i) => ({ src: safeImg(x?.img), kicker: (x?.kicker ?? '').trim(), name: (x?.title ?? '').trim(), href: safeHref(x?.link), badge: i === 0 ? str('badge') : '' }))
		.filter(t => t.src))
</script>

<!-- La vitrine s'adapte à SA largeur (R5) : dans une demi-colonne ou un aperçu téléphone,
     elle s'empile comme sur un téléphone. -->
<div class="vt-c">
<section class="vt" class:vt--solo={tiles.length === 0}>
	<div class="vt-text">
		{#if title}<h1 class="vt-title">{title}</h1>{/if}
		{#if text}<p class="vt-lead">{text}</p>{/if}
		{#if (cta.text && cta.href) || (cta2.text && cta2.href)}
			<div class="vt-actions">
				{#if cta.text && cta.href}<a class="vt-btn vt-btn--main" href={cta.href}>{cta.text}</a>{/if}
				{#if cta2.text && cta2.href}<a class="vt-btn vt-btn--second" href={cta2.href}>{cta2.text}</a>{/if}
			</div>
		{/if}
	</div>

	{#if tiles.length}
		<div class="vt-mosaic vt-mosaic--n{tiles.length} vt-mosaic--{disp}" style="--n:{tiles.length}">
			{#each tiles as t, i (i)}
				<!-- data-aff : l'éditeur ouvre les réglages de CETTE affiche au clic (R6) -->
				<svelte:element this={t.href ? 'a' : 'div'} class="vt-tile" href={t.href || undefined} data-aff={i}>
					<img src={t.src} alt={t.name || t.kicker || ''} loading={i === 0 ? 'eager' : 'lazy'} />
					{#if t.badge}<span class="vt-badge">{t.badge}</span>{/if}
					{#if t.kicker || t.name}
						<span class="vt-cap">
							{#if t.kicker}<span class="vt-kicker">{t.kicker}</span>{/if}
							{#if t.name}<span class="vt-name">{t.name}</span>{/if}
						</span>
					{/if}
				</svelte:element>
			{/each}
		</div>
	{/if}
</section>
</div>

<style>
	/* D'après la maquette « Vitrine en affiches » (builder-maquette, 21/11) */
	.vt {
		/* Le coin coupé de la base (--nx-coupe, 0 si l'admin n'en veut pas) */
		--cut: var(--nx-coupe, 0px);
		--clip: polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, 0 100%);
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		gap: 32px;
		align-items: center;
		padding: 40px 32px 32px;
		color: var(--nt);
	}
	.vt--solo { grid-template-columns: minmax(0, 1fr); }
	.vt-title {
		margin: 0 0 14px;
		/* Taille selon la largeur du BLOC (cqi), pas de la fenêtre */
		font-size: clamp(2rem, 5.2cqi, 4rem);
		line-height: 1.02;
		letter-spacing: -0.025em;
		font-weight: 700;
		color: var(--nt);
		text-wrap: balance;
	}
	.vt-lead { margin: 0; max-width: 46ch; font-size: 1rem; line-height: 1.6; color: var(--ntm); }
	.vt-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 22px; }
	.vt-btn {
		display: inline-flex; align-items: center; min-height: 42px; padding: 0 18px;
		font-weight: 600; font-size: 0.9375rem; text-decoration: none;
		border-radius: var(--nx-r-controle, 6px);
		transition: background-color .15s, border-color .15s;
	}
	.vt-btn--main { background: var(--np); color: var(--nx-on-accent, #fff); clip-path: var(--clip); }
	.vt-btn--main:hover { background: var(--nx-header-accent-strong, var(--np)); }
	.vt-btn--second { background: transparent; color: var(--nt); border: var(--nbw, 1px) solid var(--nborder); }
	.vt-btn--second:hover { border-color: var(--ntm); }
	.vt-btn:focus-visible { outline: 2px solid var(--np); outline-offset: 2px; }

	/* La mosaïque : une grande affiche sur deux rangées, les autres autour (2 à 6) */
	.vt-mosaic { display: grid; grid-template-columns: 1.3fr 1fr; grid-auto-rows: 150px; gap: 10px; }
	.vt-mosaic--grande .vt-tile:first-child { grid-row: span 2; }
	.vt-mosaic--n1 { grid-template-columns: 1fr; grid-auto-rows: 300px; }
	.vt-mosaic--n2 { grid-auto-rows: 300px; }
	.vt-mosaic--n2 .vt-tile:first-child { grid-row: auto; }
	.vt-mosaic--grande.vt-mosaic--n4, .vt-mosaic--grande.vt-mosaic--n5 { grid-template-columns: 1.3fr 1fr 1fr; }
	.vt-mosaic--grande.vt-mosaic--n4 .vt-tile:nth-child(4) { grid-column: span 2; }
	.vt-mosaic--grande.vt-mosaic--n6 { grid-template-columns: repeat(3, 1fr); }
	.vt-mosaic--grande.vt-mosaic--n6 .vt-tile:first-child { grid-row: auto; }
	/* Toutes égales : deux colonnes */
	.vt-mosaic--egales { grid-template-columns: repeat(2, 1fr); }
	/* En bande : toutes sur une ligne */
	.vt-mosaic--bande { grid-template-columns: repeat(var(--n), 1fr); grid-auto-rows: 300px; }

	.vt-tile {
		position: relative; display: block; overflow: hidden; min-height: 0;
		background: var(--nc); clip-path: var(--clip); color: #fff; text-decoration: none;
	}
	.vt-tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .4s var(--ease-out-soft, ease); }
	a.vt-tile:hover img { transform: scale(1.03); }
	a.vt-tile:focus-visible { outline: 2px solid var(--np); outline-offset: 2px; }
	/* Légende lisible sur n'importe quelle photo : un voile en bas, pas un décor */
	.vt-cap {
		position: absolute; left: 0; right: 0; bottom: 0; padding: 26px 12px 10px;
		display: flex; flex-direction: column; gap: 1px;
		background: linear-gradient(transparent, rgb(10 12 16 / .82));
	}
	.vt-kicker { font-size: 12px; color: #d4d9e2; }
	.vt-name { font-size: 17px; font-weight: 700; line-height: 1.2; }
	.vt-tile:first-child .vt-name { font-size: 22px; }
	.vt-badge {
		position: absolute; top: 10px; left: 10px; padding: 3px 8px;
		background: var(--nx-surface, #fff); color: var(--nx-text, #111);
		font-size: .75rem; font-weight: 600; border-radius: var(--nx-r-etiquette, 4px);
	}

	.vt-c { container-type: inline-size; }
	/* En dessous de 560 px de bloc (téléphone, colonne étroite), texte puis images. Au-dessus,
	   côte à côte : un portable en 1280 donne environ 670 px de vitrine (mesuré le 27/11). */
	@container (max-width: 560px) {
		.vt { grid-template-columns: minmax(0, 1fr); gap: 24px; padding: 28px 16px 24px; }
		.vt-title { font-size: clamp(2rem, 11cqi, 3rem); }
		.vt-mosaic, .vt-mosaic--bande, .vt-mosaic--grande.vt-mosaic--n4, .vt-mosaic--grande.vt-mosaic--n5, .vt-mosaic--grande.vt-mosaic--n6 { grid-template-columns: repeat(2, 1fr); grid-auto-rows: 120px; }
		.vt-mosaic--n1 { grid-template-columns: 1fr; grid-auto-rows: 200px; }
		.vt-mosaic .vt-tile { grid-column: auto !important; }
		.vt-mosaic--n4 .vt-tile:first-child, .vt-mosaic--n6 .vt-tile:first-child { grid-row: auto; }
	}
	@media (prefers-reduced-motion: reduce) {
		.vt-tile img { transition: none; }
		a.vt-tile:hover img { transform: none; }
	}
	/* Grille de la base de design : c'est la ligne qui porte la marge latérale */
	:global(.gr-design) .vt { padding-left: 0; padding-right: 0; }
</style>
