<script lang="ts">
	// Fond d'ambiance généré (pas une image) : quelques masses lumineuses floues,
	// teintées par l'humeur de la catégorie, dérivant lentement. Seed = même
	// disposition à chaque chargement pour une même catégorie. S'arrête hors
	// écran (IntersectionObserver) et respecte prefers-reduced-motion.
	import { seededRandom } from './mood';

	let { seed, wash }: { seed: string; wash: string } = $props();

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let container = $state<HTMLDivElement | null>(null);

	interface Blob { x: number; y: number; r: number; dx: number; dy: number; a: number }

	$effect(() => {
		if (!canvasEl || !container) return;

		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const rand = seededRandom(seed);
		const blobs: Blob[] = Array.from({ length: 6 }, () => ({
			x: rand(),
			y: rand(),
			r: 0.22 + rand() * 0.28,
			dx: (rand() - 0.5) * 0.00012,
			dy: (rand() - 0.5) * 0.00012,
			a: 0.5 + rand() * 0.5,
		}));

		let width = 0, height = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
		const resize = () => {
			if (!container || !canvasEl) return;
			width  = container.clientWidth;
			height = container.clientHeight;
			canvasEl.width  = width * dpr;
			canvasEl.height = height * dpr;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(container);

		let visible = true;
		const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { rootMargin: '200px' });
		io.observe(container);

		function draw(t: number) {
			if (!ctx || width === 0) return;
			ctx.clearRect(0, 0, width, height);
			for (const b of blobs) {
				if (!reduceMotion) {
					b.x += b.dx * t;
					b.y += b.dy * t;
					// rebond doux dans [0.1, 0.9] pour ne jamais coller aux bords
					if (b.x < 0.05 || b.x > 0.95) b.dx *= -1;
					if (b.y < 0.05 || b.y > 0.95) b.dy *= -1;
				}
				const cx = b.x * width, cy = b.y * height, r = b.r * Math.max(width, height);
				const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
				g.addColorStop(0, `${wash}${(0.16 * b.a).toFixed(3)})`);
				g.addColorStop(1, `${wash}0)`);
				ctx.fillStyle = g;
				ctx.fillRect(0, 0, width, height);
			}
		}

		let raf = 0;
		function loop(t: number) {
			if (visible) draw(t);
			raf = requestAnimationFrame(loop);
		}
		if (reduceMotion) {
			draw(0);
		} else {
			raf = requestAnimationFrame(loop);
		}

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			io.disconnect();
		};
	});
</script>

<div bind:this={container} class="mood-canvas-wrap" aria-hidden="true">
	<canvas bind:this={canvasEl}></canvas>
</div>

<style>
	.mood-canvas-wrap {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
