<script lang="ts">
	import { thumb } from '$lib/thumb'
	// Le papier peint du contenant (app.css, .nx-wallpaper) : la bannière, très floutée.
	// Dessinée UNE fois dans un canvas, petit, et le flou (--nx-wallpaper-filter : flou,
	// saturation, luminosité) est appliqué UNE fois dans ses pixels : le navigateur n'a
	// plus rien à recalculer, ni au défilement, ni à chaque image, ni à l'assemblage.
	// Avant le 19/11/2026 : un <img> sous un filtre CSS ; la bannière de nodyx.org étant
	// un GIF animé de 1,9 Mo, chaque image du GIF refaisait le flou en plein écran et tous
	// les panneaux au-dessus, en continu. Un GIF ou un WebP animé ne montre que sa
	// première image. Navigateur sans filtre de canvas : le filtre CSS reprend la main.
	import { onMount } from 'svelte'

	let { src }: { src: string } = $props()

	let canvas = $state<HTMLCanvasElement | null>(null)
	let shown = $state(false)
	let baked = $state(false)
	let img: HTMLImageElement | null = null
	let lastFilter = ''
	const MAX = 640

	/** Le filtre de l'ambiance, flou ramené à l'échelle du petit canvas. */
	function scaledFilter(c: HTMLCanvasElement): string {
		const f = getComputedStyle(c).getPropertyValue('--nx-wallpaper-filter').trim()
		const shownW = c.getBoundingClientRect().width || window.innerWidth * 1.24
		const k = c.width / shownW
		return f.replace(/blur\(\s*([\d.]+)px\s*\)/, (_m, px) => `blur(${(Number(px) * k).toFixed(2)}px)`)
	}

	function draw() {
		const c = canvas
		if (!c || !img || !img.naturalWidth) return
		const ctx = c.getContext('2d')
		if (!ctx) return
		const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
		c.width = Math.max(1, Math.round(img.naturalWidth * k))
		c.height = Math.max(1, Math.round(img.naturalHeight * k))
		const canBake = 'filter' in ctx
		const filter = canBake ? scaledFilter(c) : ''
		lastFilter = filter
		if (canBake && filter) {
			// Le flou mange les bords : on dessine un peu plus grand, centré
			const m = Math.ceil((Number(/blur\(([\d.]+)px\)/.exec(filter)?.[1] ?? 0)) * 2)
			ctx.filter = filter
			ctx.drawImage(img, -m, -m, c.width + 2 * m, c.height + 2 * m)
			ctx.filter = 'none'
		} else {
			ctx.drawImage(img, 0, 0, c.width, c.height)
		}
		baked = canBake && !!filter
		shown = true
	}

	$effect(() => {
		const url = src
		if (!url) return
		let alive = true
		shown = false
		const im = new Image()
		im.decoding = 'async'
		im.onload = () => { if (alive) { img = im; draw() } }
		// Une vignette FIXE suffit : elle est floutée et réduite à 640 px de toute façon.
		// Sur nodyx.org : 1,9 Mo de GIF animé → quelques dizaines de Ko.
		im.src = thumb(url, 640, { still: true })
		return () => { alive = false; im.onload = null }
	})

	// Le thème change (clair/sombre, ambiance) : le filtre aussi, on redessine une fois
	onMount(() => {
		const obs = new MutationObserver(() => {
			if (!canvas || !img) return
			if (('filter' in (canvas.getContext('2d') ?? {})) && scaledFilter(canvas) === lastFilter) return
			draw()
		})
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
		const nxShell = canvas?.closest('.nx-shell')
		if (nxShell) obs.observe(nxShell, { attributes: true, attributeFilter: ['style', 'class'] })
		return () => obs.disconnect()
	})
</script>

<canvas bind:this={canvas} class:shown class:baked aria-hidden="true"></canvas>

<style>
	canvas { opacity: 0; transition: opacity .4s ease; }
	canvas.shown { opacity: 1; }
	/* Le flou est déjà dans les pixels : plus de filtre à l'affichage */
	:global(.nx-wallpaper) canvas.baked { filter: none; }
	@media (prefers-reduced-motion: reduce) { canvas { transition: none; } }
</style>
