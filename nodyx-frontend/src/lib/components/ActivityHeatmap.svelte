<script lang="ts">
	import { API_URL } from '$lib/api'

	let { username, accent = '#6366f1' }: { username: string; accent?: string } = $props()

	// ── Build the 53×7 grid (last 365 days, aligned to weeks) ──────
	interface Cell {
		date: string   // YYYY-MM-DD
		count: number
		level: 0 | 1 | 2 | 3 | 4
	}

	function buildGrid(activity: { date: string; count: number }[]): { weeks: Cell[][]; months: { label: string; col: number }[] } {
		const map = new Map(activity.map(a => [a.date, a.count]))

		// Start on the Monday of the week containing (today - 364 days)
		const today = new Date()
		today.setHours(0, 0, 0, 0)

		const start = new Date(today)
		start.setDate(start.getDate() - 364)
		// Align to Monday (ISO week start)
		const dow = (start.getDay() + 6) % 7  // 0=Mon … 6=Sun
		start.setDate(start.getDate() - dow)

		const weeks: Cell[][] = []
		const months: { label: string; col: number }[] = []
		let lastMonth = -1
		let col = 0

		const cursor = new Date(start)
		while (cursor <= today) {
			const week: Cell[] = []
			for (let d = 0; d < 7; d++) {
				const dateStr = cursor.toISOString().slice(0, 10)
				const count = map.get(dateStr) ?? 0
				const inRange = cursor <= today
				const level = !inRange ? 0 : count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4
				week.push({ date: dateStr, count, level: level as 0|1|2|3|4 })

				// Month label on first cell of each new month
				if (inRange && cursor.getMonth() !== lastMonth && d === 0) {
					months.push({
						label: cursor.toLocaleDateString('fr-FR', { month: 'short' }),
						col,
					})
					lastMonth = cursor.getMonth()
				}
				cursor.setDate(cursor.getDate() + 1)
			}
			weeks.push(week)
			col++
		}

		return { weeks, months }
	}

	// ── Fetch ────────────────────────────────────────────────────────
	async function fetchActivity(): Promise<{ weeks: Cell[][]; months: { label: string; col: number }[]; total: number; streak: number; best: number }> {
		const res = await fetch(`${API_URL}/users/${username}/activity`)
		const json = res.ok ? await res.json() : { activity: [] }
		const activity: { date: string; count: number }[] = json.activity ?? []

		const { weeks, months } = buildGrid(activity)

		// Stats
		const total = activity.reduce((s, a) => s + a.count, 0)

		// Current streak — walk backward from today
		const map = new Map(activity.map(a => [a.date, a.count]))
		let streak = 0
		const d = new Date(); d.setHours(0, 0, 0, 0)
		while (true) {
			const k = d.toISOString().slice(0, 10)
			if ((map.get(k) ?? 0) > 0) { streak++; d.setDate(d.getDate() - 1) }
			else break
		}

		// Best single day
		const best = activity.reduce((m, a) => Math.max(m, a.count), 0)

		return { weeks, months, total, streak, best }
	}

	const promise = $derived(fetchActivity())

	// ── Tooltip — fixed positioning (escapes overflow/z-index) ──────
	let tooltip = $state<{ text: string; x: number; y: number } | null>(null)

	function showTip(e: MouseEvent, cell: Cell) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const label = cell.count === 0
			? `Aucune activité — ${fmtDate(cell.date)}`
			: `${cell.count} contribution${cell.count > 1 ? 's' : ''} — ${fmtDate(cell.date)}`
		tooltip = {
			text: label,
			x: rect.left + rect.width / 2,
			y: rect.top,
		}
	}
	function hideTip() { tooltip = null }

	function fmtDate(d: string) {
		return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
	}

	// ── Color scale ──────────────────────────────────────────────────
	// level 0 = empty, 1–4 = intensity ramps from accent
	function cellColor(level: number, acc: string): string {
		if (level === 0) return 'color-mix(in srgb, ' + acc + ' 8%, #0d1117)'
		const alpha = [0, 0.25, 0.45, 0.7, 1][level]
		return `color-mix(in srgb, ${acc} ${Math.round(alpha * 100)}%, #0d1117)`
	}

	const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
</script>

{#await promise}
	<!-- Skeleton -->
	<div class="animate-pulse space-y-2">
		<div class="h-3 w-32 bg-gray-800 rounded"></div>
		<div class="h-24 bg-gray-800/50"></div>
	</div>

{:then data}
	<div>
		<!-- Header stats -->
		<div class="flex items-center justify-between mb-4">
			<p class="text-xs uppercase tracking-widest font-medium" style="color: var(--p-text-muted)">
				Activité — 12 derniers mois
			</p>
			<div class="flex items-center gap-4 text-[11px]" style="color: var(--p-text-muted)">
				<span><strong class="text-white">{data.total}</strong> contributions</span>
				{#if data.streak > 0}
					<span><strong class="text-white">{data.streak}j</strong> de streak</span>
				{/if}
				{#if data.best > 0}
					<span>record <strong class="text-white">{data.best}</strong>/j</span>
				{/if}
			</div>
		</div>

		<!-- Grid -->
		<div class="heatmap-scroll overflow-x-auto">
			<div class="flex gap-1 min-w-max">

				<!-- Day labels column -->
				<div class="flex flex-col gap-[3px] pt-5 pr-1 shrink-0">
					{#each DAY_LABELS as label, i}
						<div class="h-[11px] text-[9px] leading-none flex items-center"
						     style="color: var(--p-text-muted); opacity: {i % 2 === 0 ? 0.8 : 0}">
							{label}
						</div>
					{/each}
				</div>

				<!-- Weeks columns -->
				<div class="relative flex gap-[3px]">
					<!-- Month labels row -->
					<div class="absolute top-0 left-0 right-0 h-5 pointer-events-none">
						{#each data.months as m}
							<span class="absolute text-[10px] font-medium"
							      style="left: {m.col * 14}px; color: var(--p-text-muted)">
								{m.label}
							</span>
						{/each}
					</div>

					<!-- Cells -->
					{#each data.weeks as week}
						<div class="flex flex-col gap-[3px] pt-5">
							{#each week as cell}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="w-[11px] h-[11px] cursor-default transition-opacity hover:opacity-80"
									style="background: {cellColor(cell.level, accent)}"
									onmouseenter={(e) => showTip(e, cell)}
									onmouseleave={hideTip}
								></div>
							{/each}
						</div>
					{/each}
				</div>
			</div>

		</div>

		<!-- Legend -->
		<div class="flex items-center gap-1.5 mt-3 justify-end">
			<span class="text-[10px]" style="color: var(--p-text-muted)">Moins</span>
			{#each [0, 1, 2, 3, 4] as level}
				<div class="w-[11px] h-[11px]" style="background: {cellColor(level, accent)}"></div>
			{/each}
			<span class="text-[10px]" style="color: var(--p-text-muted)">Plus</span>
		</div>
	</div>

{:catch}
	<!-- silent failure -->
{/await}

<!-- Tooltip — fixed, outside all overflow contexts -->
{#if tooltip}
	<div class="pointer-events-none fixed z-[9999] px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap
	            bg-gray-900 border border-gray-700 shadow-xl"
	     style="left: {tooltip.x}px; top: {tooltip.y - 36}px; transform: translateX(-50%)">
		{tooltip.text}
		<div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent"
		     style="border-top-color: #374151"></div>
	</div>
{/if}
