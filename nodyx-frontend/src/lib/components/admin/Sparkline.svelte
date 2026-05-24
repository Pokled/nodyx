<script lang="ts">
	interface Props {
		series:  number[]   // data points, chronological (oldest → newest)
		color?:  string     // stroke + fill base color
		width?:  number
		height?: number
		labels?: string[]   // optional, same length as series → tooltip per point
	}

	let {
		series,
		color  = '#06b6d4',
		width  = 120,
		height = 36,
		labels,
	}: Props = $props()

	const max = $derived(Math.max(1, ...series))
	const len = $derived(series.length)

	const path = $derived(buildPath(series, max, width, height))
	const area = $derived(buildArea(series, max, width, height))

	function buildPath(data: number[], peak: number, w: number, h: number): string {
		if (data.length === 0) return ''
		if (data.length === 1) {
			const y = h - (data[0] / peak) * (h - 4) - 2
			return `M 0 ${y} L ${w} ${y}`
		}
		const stepX = w / (data.length - 1)
		const points = data.map((v, i) => {
			const x = i * stepX
			const y = h - (v / peak) * (h - 4) - 2
			return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
		})
		return points.join(' ')
	}

	function buildArea(data: number[], peak: number, w: number, h: number): string {
		const line = buildPath(data, peak, w, h)
		if (!line) return ''
		return `${line} L ${w} ${h} L 0 ${h} Z`
	}

	const gradId = $derived(`sparkline-grad-${color.replace('#', '')}`)
</script>

<svg
	{width}
	{height}
	viewBox="0 0 {width} {height}"
	preserveAspectRatio="none"
	role="img"
	aria-label="Tendance sur {len} jour{len > 1 ? 's' : ''}"
	class="block"
>
	<defs>
		<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%"  stop-color={color} stop-opacity="0.35" />
			<stop offset="100%" stop-color={color} stop-opacity="0" />
		</linearGradient>
	</defs>
	<path d={area} fill="url(#{gradId})" stroke="none" />
	<path d={path} fill="none" stroke={color} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
	{#each series as v, i}
		{@const stepX = len > 1 ? width / (len - 1) : 0}
		{@const x = i * stepX}
		{@const y = height - (v / max) * (height - 4) - 2}
		<circle
			cx={x}
			cy={y}
			r={i === len - 1 ? 2.5 : 0}
			fill={color}
		>
			{#if labels?.[i]}
				<title>{labels[i]} : {v}</title>
			{/if}
		</circle>
	{/each}
</svg>
