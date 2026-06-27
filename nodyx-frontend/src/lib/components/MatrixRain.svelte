<!--
  MatrixRain — pluie de caractères façon console, en fond.
  Pensée pour être SUBTILE (pas agressive) : têtes de colonne claires (halo
  vert->blanc), traîne verte qui s'efface, cadence réduite, et désactivée si
  l'utilisateur a demandé "moins d'animations" (prefers-reduced-motion).
  Montée uniquement quand l'instance a theme_effect === 'matrix'.
  Le canvas est fixe, derrière le contenu (z-index -1), et n'intercepte rien.
-->
<script lang="ts">
	import { onMount } from 'svelte'

	// Glyphes : katakana demi-chasse + chiffres + hexa (l'alphabet "Matrix")
	const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789ABCDEF'
	const FONT = 16        // taille de glyphe (px)
	const STEP_MS = 70     // cadence : ~14 fps, défilement lent et calme
	const HEAD = 'rgba(220,255,235,0.95)'  // tête claire = halo vert->blanc
	const TAIL = 'rgba(46,230,115,'        // traîne verte (+ alpha)

	let canvas: HTMLCanvasElement

	onMount(() => {
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		let drops: number[] = []
		let raf = 0
		let last = 0
		let running = true

		function resize() {
			const dpr = Math.min(window.devicePixelRatio || 1, 2)
			canvas.width = Math.floor(innerWidth * dpr)
			canvas.height = Math.floor(innerHeight * dpr)
			canvas.style.width = innerWidth + 'px'
			canvas.style.height = innerHeight + 'px'
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
			ctx!.font = `${FONT}px monospace`
			ctx!.textBaseline = 'top'
			const cols = Math.ceil(innerWidth / FONT)
			drops = Array.from({ length: cols }, () => Math.floor((Math.random() * -innerHeight) / FONT))
		}

		function frame(now: number) {
			if (!running) return
			raf = requestAnimationFrame(frame)
			if (now - last < STEP_MS) return
			last = now

			// Voile sombre semi-transparent : efface progressivement (la traîne)
			ctx!.fillStyle = 'rgba(8,13,9,0.10)'
			ctx!.fillRect(0, 0, innerWidth, innerHeight)

			for (let i = 0; i < drops.length; i++) {
				const x = i * FONT
				const y = drops[i] * FONT
				const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0]
				if (y > 0) {
					// glyphe juste derrière la tête, vert plus doux
					ctx!.fillStyle = TAIL + '0.35)'
					ctx!.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y - FONT)
				}
				// tête de colonne, claire
				ctx!.fillStyle = HEAD
				ctx!.fillText(ch, x, y)

				if (y > innerHeight && Math.random() > 0.975) drops[i] = 0
				else drops[i]++
			}
		}

		resize()
		window.addEventListener('resize', resize)

		if (reduce) {
			// Mouvement coupé : un rendu statique très léger, une seule passe
			ctx.fillStyle = TAIL + '0.18)'
			for (let i = 0; i < drops.length; i++) {
				ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * FONT, (Math.random() * innerHeight))
			}
		} else {
			raf = requestAnimationFrame(frame)
		}

		return () => {
			running = false
			cancelAnimationFrame(raf)
			window.removeEventListener('resize', resize)
		}
	})
</script>

<canvas bind:this={canvas} class="matrix-rain" aria-hidden="true"></canvas>

<style>
	.matrix-rain {
		position: fixed;
		inset: 0;
		z-index: -1;          /* derrière le contenu (root transparent) */
		pointer-events: none; /* n'intercepte aucun clic */
		opacity: 0.5;         /* subtil, pas agressif */
	}
</style>
