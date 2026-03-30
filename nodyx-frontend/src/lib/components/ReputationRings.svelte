<script lang="ts">
	let {
		longevity   = 0,   // 0–1 — days active / 365
		quality     = 0,   // 0–1 — XP points / 500
		engagement  = 0,   // 0–1 — thread ratio
		accent      = '#6366f1',
	}: {
		longevity:  number
		quality:    number
		engagement: number
		accent:     string
	} = $props()

	// Ring geometry + tooltip descriptions
	const rings = $derived([
		{
			r: 52,
			label: 'Longévité',
			color: accent,
			value: longevity,
			tooltip: `Ancienneté dans la communauté.\n1 an = 100 % — actuellement ${Math.round(longevity * 365)} jour${Math.round(longevity * 365) > 1 ? 's' : ''} sur 365.`,
		},
		{
			r: 38,
			label: 'Qualité',
			color: '#8b5cf6',
			value: quality,
			tooltip: `Points XP accumulés via vos contributions.\n500 XP = 100 % — mesure la régularité et l'impact de vos posts.`,
		},
		{
			r: 24,
			label: 'Engagement',
			color: '#14b8a6',
			value: engagement,
			tooltip: `Ratio de discussions initiées vs réponses.\nUn engagement de 100 % = vous créez autant que vous participez.`,
		},
	])

	// circumference = 2πr
	function circ(r: number) { return 2 * Math.PI * r }

	let mounted = $state(false)
	$effect(() => {
		const id = setTimeout(() => { mounted = true }, 60)
		return () => clearTimeout(id)
	})

	function offset(r: number, value: number): number {
		const c = circ(r)
		return mounted ? c * (1 - Math.max(0, Math.min(1, value))) : c
	}

	function pct(value: number) {
		return Math.round(Math.max(0, Math.min(1, value)) * 100)
	}
</script>

<div class="flex items-center gap-6 p-5"
     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">

	<!-- SVG rings -->
	<div class="shrink-0" aria-hidden="true">
		<svg width="130" height="130" viewBox="0 0 130 130">
			{#each rings as ring}
				<circle cx="65" cy="65" r={ring.r} fill="none"
					stroke={ring.color} stroke-width="8" stroke-linecap="round" opacity="0.12"/>
			{/each}
			{#each rings as ring}
				<circle cx="65" cy="65" r={ring.r} fill="none"
					stroke={ring.color} stroke-width="8" stroke-linecap="round"
					stroke-dasharray={circ(ring.r)}
					stroke-dashoffset={offset(ring.r, ring.value)}
					transform="rotate(-90 65 65)"
					style="transition: stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)"/>
			{/each}
			<text x="65" y="70" text-anchor="middle" font-size="16" font-weight="800" fill="white" font-family="inherit">
				{pct((longevity + quality + engagement) / 3)}%
			</text>
		</svg>
	</div>

	<!-- Legend -->
	<div class="flex flex-col gap-3 flex-1 min-w-0">

		<!-- Header row -->
		<div class="flex items-center justify-between mb-1">
			<p class="text-xs uppercase tracking-widest font-medium" style="color: var(--p-text-muted)">Réputation</p>
			<a
				href="/reputation"
				class="text-[10px] flex items-center gap-1 transition-opacity opacity-50 hover:opacity-100"
				style="color: var(--p-text-muted)"
				title="Comment ce score est calculé"
			>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"/>
				</svg>
				Comment ça marche ?
			</a>
		</div>

		{#each rings as ring}
			<!-- Tooltip wrapper -->
			<div class="group/tip relative">
				<div class="flex items-center justify-between mb-1">
					<span class="text-xs font-medium" style="color: {ring.color}">{ring.label}</span>
					<span class="text-xs tabular-nums font-bold" style="color: {ring.color}">{pct(ring.value)}%</span>
				</div>
				<div class="h-1 rounded-full overflow-hidden" style="background: color-mix(in srgb, {ring.color} 15%, transparent)">
					<div class="h-full rounded-full"
					     style="width: {pct(ring.value)}%; background: {ring.color}; transition: width 1.2s cubic-bezier(0.4,0,0.2,1)">
					</div>
				</div>

				<!-- Tooltip — appears above on hover -->
				<div class="pointer-events-none absolute bottom-full left-0 mb-2 z-50
				            invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100
				            transition-opacity duration-150
				            w-64 p-3 text-xs leading-relaxed
				            bg-gray-900 border border-gray-700 shadow-xl"
				     style="color: #d1d5db">
					{#each ring.tooltip.split('\n') as line, i}
						<span class={i === 0 ? 'font-semibold block mb-1' : 'text-gray-400 block'}>{line}</span>
					{/each}
					<!-- Arrow -->
					<div class="absolute top-full left-4 border-4 border-transparent"
					     style="border-top-color: #374151"></div>
				</div>
			</div>
		{/each}

	</div>

</div>
