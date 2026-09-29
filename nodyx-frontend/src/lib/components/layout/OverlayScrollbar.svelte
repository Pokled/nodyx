<script lang="ts">
	/**
	 * Barre de défilement flottante de la feuille de contenu (contenant
	 * flottant, SPECS/NODYX_CONTENANT_DESIGN_CDC.md).
	 *
	 * La barre native est un rectangle collé au bord : elle ignore les coins
	 * arrondis de la feuille et reste affichée en permanence. Celle-ci suit la
	 * logique macOS/iOS : invisible au repos, elle apparaît quand on défile ou
	 * qu'on approche du bord, s'arrête avant les arrondis, et s'efface.
	 *
	 * Elle ne remplace QUE le dessin. Molette, pavé tactile, clavier et lecteurs
	 * d'écran continuent de faire défiler l'élément natif : le pouce est
	 * décoratif pour l'accessibilité (aria-hidden), mais saisissable à la souris.
	 *
	 * Active à partir de 1024px seulement : en dessous, c'est le document qui
	 * défile et la barre native du système reste la bonne réponse.
	 */
	import { untrack } from 'svelte';

	let { target }: { target: HTMLElement | undefined } = $props();

	const INSET = 14;      // marge haut/bas : la barre s'arrête avant les arrondis
	const MIN_THUMB = 36;
	const IDLE_MS = 900;

	let enabled = $state(false);
	let box = $state({ top: 0, left: 0, height: 0 });
	let thumb = $state({ y: 0, h: 0 });
	let scrollable = $state(false);
	let visible = $state(false);
	let hovering = $state(false);
	let dragging = $state(false);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let raf = 0;

	// Calcul sur des locales, jamais en relisant l'état qu'on vient d'écrire :
	// appelé depuis un $effect, relire `box` en ferait une dépendance et
	// l'effet se relancerait sans fin (effect_update_depth_exceeded, vécu).
	function measure() {
		const el = target;
		if (!el) return;
		const railH = Math.max(0, el.clientHeight - INSET * 2);
		const max = el.scrollHeight - el.clientHeight;
		const can = max > 2;
		const h = can ? Math.max(MIN_THUMB, (el.clientHeight / el.scrollHeight) * railH) : 0;
		box = { top: el.offsetTop + INSET, left: el.offsetLeft + el.offsetWidth - 12, height: railH };
		scrollable = can;
		thumb = { y: can ? (el.scrollTop / max) * (railH - h) : 0, h };
	}

	function wake() {
		visible = true;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => { if (!hovering && !dragging) visible = false; }, IDLE_MS);
	}

	function onScroll() {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(measure);
		wake();
	}

	// Approcher la souris du bord droit de la feuille révèle la barre, comme
	// sur macOS : on la trouve quand on la cherche, jamais avant.
	function onMove(e: PointerEvent) {
		const el = target;
		if (!el || !scrollable) return;
		const r = el.getBoundingClientRect();
		const near = e.clientX > r.right - 28 && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
		if (near) wake();
	}

	$effect(() => {
		const el = target;
		if (!el) return;
		const mq = window.matchMedia('(min-width: 1024px)');
		const sync = () => {
			enabled = mq.matches;
			el.classList.toggle('nx-overlay-scroll', mq.matches);
			measure();
		};
		untrack(sync);
		mq.addEventListener('change', sync);
		el.addEventListener('scroll', onScroll, { passive: true });
		el.addEventListener('pointermove', onMove, { passive: true });
		// Taille de la feuille (repli d'un panneau) ET de son contenu (page qui
		// charge, image qui arrive) : les deux changent la taille du pouce.
		// Observer la TAILLE des blocs directs suffit, et coûte bien moins
		// qu'observer tout le DOM de la page (le chat mute sans arrêt).
		const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); });
		const watch = () => { ro.disconnect(); ro.observe(el); for (const c of Array.from(el.children)) ro.observe(c); };
		watch();
		const mo = new MutationObserver(watch);
		mo.observe(el, { childList: true });
		return () => {
			mq.removeEventListener('change', sync);
			el.removeEventListener('scroll', onScroll);
			el.removeEventListener('pointermove', onMove);
			el.classList.remove('nx-overlay-scroll');
			ro.disconnect();
			mo.disconnect();
			clearTimeout(idleTimer);
			cancelAnimationFrame(raf);
		};
	});

	// ── Saisie du pouce ─────────────────────────────────────────────────────
	let dragStartY = 0;
	let dragStartScroll = 0;
	function onThumbDown(e: PointerEvent) {
		if (e.button !== 0 || !target) return;
		e.preventDefault();
		e.stopPropagation();
		dragging = true;
		dragStartY = e.clientY;
		dragStartScroll = target.scrollTop;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onThumbMove(e: PointerEvent) {
		if (!dragging || !target) return;
		const max = target.scrollHeight - target.clientHeight;
		const room = box.height - thumb.h;
		if (room <= 0) return;
		target.scrollTop = dragStartScroll + (e.clientY - dragStartY) * (max / room);
	}
	function onThumbUp() {
		dragging = false;
		wake();
	}
	// Clic dans le rail, hors du pouce : saut d'une page vers le clic.
	function onTrackDown(e: PointerEvent) {
		if (e.button !== 0 || !target) return;
		const rail = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const dir = e.clientY - rail.top < thumb.y ? -1 : 1;
		target.scrollBy({ top: dir * target.clientHeight * 0.9, behavior: 'smooth' });
	}
</script>

{#if enabled && scrollable}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="nx-oscroll" class:visible={visible || dragging} class:hot={hovering || dragging}
	     aria-hidden="true"
	     style="top: {box.top}px; left: {box.left}px; height: {box.height}px;"
	     onpointerenter={() => { hovering = true; wake(); }}
	     onpointerleave={() => { hovering = false; wake(); }}
	     onpointerdown={onTrackDown}>
		<div class="nx-oscroll-thumb" class:dragging
		     style="height: {thumb.h}px; transform: translateY({thumb.y}px);"
		     onpointerdown={onThumbDown}
		     onpointermove={onThumbMove}
		     onpointerup={onThumbUp}
		     onpointercancel={onThumbUp}></div>
	</div>
{/if}

<style>
	/* Rail : zone de saisie de 12px (confortable à la souris), invisible.
	   Le pouce visible est bien plus fin : geste possible > geste visible
	   (même principe que la poignée de Vaul, citée dans le CDC). */
	.nx-oscroll {
		position: absolute; z-index: 20; width: 12px;
		opacity: 0; pointer-events: none;
		transition: opacity .35s var(--ease-out-soft);
	}
	.nx-oscroll.visible { opacity: 1; pointer-events: auto; }

	.nx-oscroll-thumb {
		position: absolute; top: 0; right: 3px; width: 5px;
		border-radius: 999px; cursor: grab;
		background: color-mix(in srgb, var(--nx-text) 38%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--nx-bg) 55%, transparent);
		transition: width .3s var(--ease-spring), right .3s var(--ease-spring),
		            background-color .2s, box-shadow .3s var(--ease-out-soft);
		will-change: transform;
	}
	/* Survol ou saisie : la pilule s'épaissit avec un ressort et prend la
	   couleur de l'instance, avec un halo doux de la même teinte. */
	.hot .nx-oscroll-thumb {
		width: 8px; right: 2px;
		background: var(--nx-header-accent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--nx-bg) 40%, transparent),
		            0 0 14px 1px color-mix(in srgb, var(--nx-header-accent) 45%, transparent);
	}
	.nx-oscroll-thumb.dragging { cursor: grabbing; }

	@media (prefers-reduced-motion: reduce) {
		.nx-oscroll, .nx-oscroll-thumb { transition: none; }
	}
</style>
