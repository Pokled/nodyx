<script lang="ts">
	let { username }: { username: string } = $props()

	// ── Deterministic hash (FNV-1a 32-bit, pure JS, SSR-safe) ──────
	function fnv(str: string, salt = 0): number {
		let h = (2166136261 + salt) >>> 0
		for (let i = 0; i < str.length; i++) {
			h ^= str.charCodeAt(i)
			h = Math.imul(h, 16777619) >>> 0
		}
		return h
	}
	// Normalize to [0, 1)
	function frac(n: number): number { return n / 0x100000000 }

	// ── Seed values from username ────────────────────────────────────
	const s0 = $derived(fnv(username, 0))
	const s1 = $derived(fnv(username, 1))
	const s2 = $derived(fnv(username, 2))
	const s3 = $derived(fnv(username, 3))
	const s4 = $derived(fnv(username, 4))
	const s5 = $derived(fnv(username, 5))
	const s6 = $derived(fnv(username, 6))

	// ── Colors ───────────────────────────────────────────────────────
	// Base hue + two triadic partners
	const hue     = $derived(frac(s0) * 360)
	const sat     = $derived(55 + frac(s1) * 30)                        // 55–85%
	const light   = $derived(45 + frac(s2) * 20)                        // 45–65%
	const hue2    = $derived((hue + 115 + frac(s3) * 50) % 360)
	const hue3    = $derived((hue + 225 + frac(s4) * 50) % 360)

	const col1 = $derived(`hsl(${hue},${sat}%,${light}%)`)
	const col2 = $derived(`hsl(${hue2},${sat - 10}%,${light + 5}%)`)
	const col3 = $derived(`hsl(${hue3},${sat - 5}%,${light - 5}%)`)

	const bgFrom = $derived(`hsl(${hue},${sat - 20}%,12%)`)
	const bgTo   = $derived(`hsl(${hue2},${sat - 25}%,8%)`)

	// ── Lissajous parameters ─────────────────────────────────────────
	// Pairs (a, b) — classic beautiful ratios
	const PAIRS: [number, number][] = [[2,3],[3,4],[3,5],[4,5],[1,3],[2,5],[1,4],[3,7]]

	const pair1 = $derived(PAIRS[fnv(username, 10) % PAIRS.length])
	const pair2 = $derived(PAIRS[fnv(username, 11) % PAIRS.length])
	const pair3 = $derived(PAIRS[fnv(username, 12) % PAIRS.length])

	const delta1 = $derived(frac(s0) * Math.PI)
	const delta2 = $derived(frac(s3) * Math.PI)
	const delta3 = $derived(frac(s5) * Math.PI)

	// ── Path builder ─────────────────────────────────────────────────
	const W = 1200
	const H = 320
	const cx = W / 2
	const cy = H / 2
	const RX = W * 0.45   // horizontal radius
	const RY = H * 0.42   // vertical radius
	const STEPS = 900

	function lissajous(a: number, b: number, delta: number): string {
		let d = ''
		for (let i = 0; i <= STEPS; i++) {
			const t = (i / STEPS) * 2 * Math.PI
			const x = cx + RX * Math.sin(a * t + delta)
			const y = cy + RY * Math.sin(b * t)
			d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '
		}
		return d
	}

	const path1 = $derived(lissajous(pair1[0], pair1[1], delta1))
	const path2 = $derived(lissajous(pair2[0], pair2[1], delta2))
	const path3 = $derived(lissajous(pair3[0], pair3[1], delta3))

	// Subtle rotation per user — so two profiles with same pairs still differ
	const rot1 = $derived(frac(s6) * 30 - 15)          // –15° to +15°
	const rot2 = $derived(frac(fnv(username,7)) * 25)
	const rot3 = $derived(-(frac(fnv(username,8)) * 20))
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 {W} {H}"
	width="100%"
	height="100%"
	preserveAspectRatio="xMidYMid slice"
	aria-hidden="true"
	class="absolute inset-0 w-full h-full"
>
	<defs>
		<!-- Grain texture -->
		<filter id="grain-{username}" x="0%" y="0%" width="100%" height="100%">
			<feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" seed={s1 % 100} stitchTiles="stitch" result="noise"/>
			<feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
			<feBlend in="SourceGraphic" in2="grey" mode="overlay" result="blend"/>
			<feComposite in="blend" in2="SourceGraphic" operator="in"/>
		</filter>

		<!-- Glow for curves -->
		<filter id="glow-{username}" x="-20%" y="-20%" width="140%" height="140%">
			<feGaussianBlur stdDeviation="6" result="blur"/>
			<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
		</filter>

		<linearGradient id="bg-grad-{username}" x1="0%" y1="0%" x2="100%" y2="100%">
			<stop offset="0%"   stop-color={bgFrom}/>
			<stop offset="100%" stop-color={bgTo}/>
		</linearGradient>
	</defs>

	<!-- Background -->
	<rect width={W} height={H} fill="url(#bg-grad-{username})"/>

	<!-- Curves — animateTransform (SVG-native, works everywhere) -->
	<!-- curve 1 — clockwise, 80s -->
	<g filter="url(#glow-{username})" opacity="0.55">
		<animateTransform attributeName="transform" type="rotate"
			from="0 {cx} {cy}" to="360 {cx} {cy}"
			dur="80s" repeatCount="indefinite"/>
		<path d={path1} fill="none" stroke={col1} stroke-width="2.5" stroke-linecap="round"/>
	</g>

	<!-- curve 2 — counter-clockwise, 55s -->
	<g filter="url(#glow-{username})" opacity="0.45">
		<animateTransform attributeName="transform" type="rotate"
			from="0 {cx} {cy}" to="-360 {cx} {cy}"
			dur="55s" repeatCount="indefinite"/>
		<path d={path2} fill="none" stroke={col2} stroke-width="2" stroke-linecap="round"/>
	</g>

	<!-- curve 3 — clockwise, 120s + breathe -->
	<g filter="url(#glow-{username})">
		<animate attributeName="opacity" values="0.35;0.15;0.35" dur="8s" repeatCount="indefinite"/>
		<animateTransform attributeName="transform" type="rotate"
			from="0 {cx} {cy}" to="360 {cx} {cy}"
			dur="120s" repeatCount="indefinite"/>
		<path d={path3} fill="none" stroke={col3} stroke-width="1.5" stroke-linecap="round"/>
	</g>

	<!-- Grain overlay -->
	<rect width={W} height={H} fill="white" opacity="0.025" filter="url(#grain-{username})"/>

	<!-- Vignette — bottom fade toward page bg -->
	<rect width={W} height={H} fill="url(#vignette-{username})"/>
	<defs>
		<linearGradient id="vignette-{username}" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%"   stop-color="black" stop-opacity="0.0"/>
			<stop offset="70%"  stop-color="black" stop-opacity="0.0"/>
			<stop offset="100%" stop-color="black" stop-opacity="0.75"/>
		</linearGradient>
	</defs>
</svg>

