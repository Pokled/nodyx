<script lang="ts">
	import { t } from '$lib/i18n';
	const tFn = $derived($t);
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString([], {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
		});
	}
	function formatTime(iso: string) {
		return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
	function formatDateRange(ev: any): string {
		if (ev.is_all_day) return formatDate(ev.starts_at);
		const start = tFn('event.at', { date: formatDate(ev.starts_at), time: formatTime(ev.starts_at) });
		if (!ev.ends_at) return start;
		const sameDay = new Date(ev.starts_at).toDateString() === new Date(ev.ends_at).toDateString();
		return sameDay ? `${start} – ${formatTime(ev.ends_at)}` : `${start} → ${formatDate(ev.ends_at)}`;
	}

	function isToday(ev: any): boolean {
		const now = new Date();
		const d   = new Date(ev.starts_at);
		return d.getDate() === now.getDate() &&
		       d.getMonth() === now.getMonth() &&
		       d.getFullYear() === now.getFullYear();
	}

	const grouped = $derived(() => {
		const map = new Map<string, any[]>();
		for (const ev of data.events) {
			const key = new Date(ev.starts_at).toLocaleDateString([], { month: 'long', year: 'numeric' });
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(ev);
		}
		return [...map.entries()];
	});
</script>

<svelte:head>
	<title>Calendrier — {data.communityName ?? 'Nodyx'}</title>
</svelte:head>

<div class="cal-root">

	<!-- ── Sticky header ─────────────────────────────────────────────────────── -->
	<header class="cal-header">
		<div class="cal-header-inner">
			<div class="cal-header-left">
				<span class="cal-icon">📅</span>
				<div>
					<h1 class="cal-title">{tFn('calendar.title')}</h1>
					<p class="cal-sub">{tFn('calendar.subtitle')}</p>
				</div>
			</div>
			<div class="cal-header-right">
				<div class="cal-toggle">
					<a href="/calendar"
					   class="cal-toggle-btn {!data.past ? 'cal-toggle-btn--active' : ''}">
						{tFn('event.badge_upcoming')}
					</a>
					<a href="/calendar?past=true"
					   class="cal-toggle-btn {data.past ? 'cal-toggle-btn--past' : ''}">
						{tFn('calendar.past')}
					</a>
				</div>
				{#if data.token}
					<a href="/calendar/new" class="cal-new-btn">
						<svg class="cal-new-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
						</svg>
						{tFn('calendar.create')}
					</a>
				{/if}
			</div>
		</div>
	</header>

	<!-- ── Body ──────────────────────────────────────────────────────────────── -->
	<div class="cal-body">
		{#if data.events.length === 0}
			<div class="cal-empty">
				<p class="cal-empty-icon">📅</p>
				<p class="cal-empty-title">{data.past ? tFn('calendar.no_events_past') : tFn('calendar.no_events_upcoming')}</p>
				{#if data.token && !data.past}
					<a href="/calendar/new" class="cal-empty-link">{tFn('calendar.create_first')}</a>
				{/if}
			</div>
		{:else}
			{#each grouped() as [month, events]}
				<section class="cal-month">
					<div class="cal-month-header">
						<span class="cal-month-label">{month}</span>
						<div class="cal-month-line"></div>
					</div>
					{#each events as ev}
						<a href="/calendar/{ev.id}" class="cal-row {ev.is_cancelled ? 'cal-row--cancelled' : ''} {isToday(ev) ? 'cal-row--today' : ''}">
							<!-- Date badge -->
							<div class="cal-date-badge {isToday(ev) ? 'cal-date-badge--today' : ''}">
								<span class="cal-date-month">
									{new Date(ev.starts_at).toLocaleDateString([], { month: 'short' }).toUpperCase()}
								</span>
								<span class="cal-date-day">
									{new Date(ev.starts_at).getDate()}
								</span>
							</div>

							<!-- Content -->
							<div class="cal-row-body">
								<div class="cal-row-top">
									<h3 class="cal-row-title {ev.is_cancelled ? 'cal-row-title--cancelled' : ''}">{ev.title}</h3>
									<div class="cal-row-badges">
										{#if ev.is_cancelled}
											<span class="cal-badge cal-badge--red">{tFn('event.badge_cancelled')}</span>
										{/if}
										{#if isToday(ev)}
											<span class="cal-badge cal-badge--green">Aujourd'hui</span>
										{/if}
									</div>
								</div>
								<p class="cal-row-date">{formatDateRange(ev)}</p>
								{#if ev.location}
									<p class="cal-row-location">
										<svg class="cal-loc-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
											<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
										</svg>
										{ev.location}
									</p>
								{/if}
								{#if ev.rsvp_enabled || ev.tags?.length > 0}
									<div class="cal-row-meta">
										{#if ev.rsvp_enabled}
											<span class="cal-meta-item">
												<svg class="cal-meta-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
													<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/>
												</svg>
												{ev.going_count} participant{ev.going_count !== 1 ? 's' : ''}
											</span>
										{/if}
										{#if ev.tags?.length > 0}
											{#each ev.tags.slice(0, 4) as tag}
												<span class="cal-tag">{tag}</span>
											{/each}
										{/if}
									</div>
								{/if}
							</div>

							<!-- Arrow -->
							<svg class="cal-row-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
							</svg>
						</a>
					{/each}
				</section>
			{/each}
		{/if}
	</div>
</div>

<style>
.cal-root {
	min-height: 100vh;
	background: #09090f;
	display: flex;
	flex-direction: column;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.cal-header {
	position: sticky;
	top: 0;
	z-index: 20;
	background: rgba(9,9,15,0.88);
	backdrop-filter: blur(16px);
	border-bottom: 1px solid rgba(255,255,255,0.06);
}
.cal-header-inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem 1.5rem;
	gap: 1rem;
}
.cal-header-left {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}
.cal-icon { font-size: 1.25rem; line-height: 1; flex-shrink: 0; }
.cal-title {
	font-size: 1rem;
	font-weight: 800;
	color: rgba(255,255,255,0.92);
	letter-spacing: -0.2px;
}
.cal-sub {
	font-size: 0.65rem;
	color: rgba(255,255,255,0.28);
	margin-top: 1px;
}
.cal-header-right {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	flex-shrink: 0;
}
.cal-toggle {
	display: flex;
	border: 1px solid rgba(255,255,255,0.07);
	overflow: hidden;
}
.cal-toggle-btn {
	padding: 0.3rem 0.75rem;
	font-size: 0.7rem;
	font-weight: 600;
	color: rgba(255,255,255,0.35);
	transition: all 0.12s;
}
.cal-toggle-btn:hover { color: rgba(255,255,255,0.65); background: rgba(255,255,255,0.04); }
.cal-toggle-btn--active {
	background: rgba(52,211,153,0.12);
	color: #34d399;
	border-right: 1px solid rgba(255,255,255,0.07);
}
.cal-toggle-btn--past {
	background: rgba(255,255,255,0.05);
	color: rgba(255,255,255,0.6);
}
.cal-new-btn {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	padding: 0.3rem 0.75rem;
	font-size: 0.7rem;
	font-weight: 700;
	color: rgba(255,255,255,0.7);
	border: 1px solid rgba(52,211,153,0.3);
	background: rgba(52,211,153,0.06);
	transition: all 0.12s;
}
.cal-new-btn:hover { color: #34d399; border-color: rgba(52,211,153,0.5); background: rgba(52,211,153,0.1); }
.cal-new-icon { width: 11px; height: 11px; }

/* ── Body ────────────────────────────────────────────────────────────────── */
.cal-body { flex: 1; }

/* ── Empty ───────────────────────────────────────────────────────────────── */
.cal-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 5rem 1.5rem;
	gap: 0.375rem;
	text-align: center;
}
.cal-empty-icon { font-size: 2.5rem; line-height: 1; }
.cal-empty-title { font-size: 0.85rem; font-weight: 700; color: rgba(255,255,255,0.4); margin-top: 0.5rem; }
.cal-empty-link { font-size: 0.75rem; color: rgba(52,211,153,0.7); margin-top: 0.5rem; transition: color 0.12s; }
.cal-empty-link:hover { color: #34d399; }

/* ── Month section ───────────────────────────────────────────────────────── */
.cal-month-header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.875rem 1.5rem 0.5rem;
}
.cal-month-label {
	font-size: 0.65rem;
	font-weight: 800;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: rgba(255,255,255,0.2);
	white-space: nowrap;
}
.cal-month-line {
	flex: 1;
	height: 1px;
	background: rgba(255,255,255,0.04);
}

/* ── Event row ───────────────────────────────────────────────────────────── */
.cal-row {
	display: flex;
	align-items: flex-start;
	gap: 1rem;
	padding: 0.875rem 1.5rem;
	border-bottom: 1px solid rgba(255,255,255,0.03);
	background: transparent;
	transition: background 0.1s;
	text-decoration: none;
}
.cal-row:hover { background: rgba(255,255,255,0.015); }
.cal-row--today { border-left: 2px solid #34d399; padding-left: calc(1.5rem - 2px); }
.cal-row--cancelled { opacity: 0.45; }

/* Date badge */
.cal-date-badge {
	flex-shrink: 0;
	width: 44px;
	height: 44px;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	border: 1px solid rgba(255,255,255,0.07);
	background: rgba(255,255,255,0.02);
}
.cal-date-badge--today {
	border-color: rgba(52,211,153,0.4);
	background: rgba(52,211,153,0.08);
}
.cal-date-month {
	font-size: 0.55rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	color: rgba(255,255,255,0.3);
	line-height: 1;
}
.cal-date-badge--today .cal-date-month { color: rgba(52,211,153,0.7); }
.cal-date-day {
	font-size: 1.125rem;
	font-weight: 800;
	color: rgba(255,255,255,0.85);
	line-height: 1.1;
}
.cal-date-badge--today .cal-date-day { color: #34d399; }

/* Row body */
.cal-row-body { flex: 1; min-width: 0; }
.cal-row-top {
	display: flex;
	align-items: flex-start;
	gap: 0.625rem;
	margin-bottom: 0.2rem;
}
.cal-row-title {
	font-size: 0.85rem;
	font-weight: 700;
	color: rgba(255,255,255,0.88);
	letter-spacing: -0.1px;
	line-height: 1.3;
	flex: 1;
	min-width: 0;
}
.cal-row:hover .cal-row-title { color: #fff; }
.cal-row-title--cancelled { text-decoration: line-through; }
.cal-row-badges { display: flex; align-items: center; gap: 0.375rem; flex-shrink: 0; }
.cal-badge {
	font-size: 0.6rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	padding: 0.1rem 0.45rem;
	border: 1px solid;
}
.cal-badge--red   { color: #f87171; border-color: rgba(248,113,113,0.3); }
.cal-badge--green { color: #34d399; border-color: rgba(52,211,153,0.3); }
.cal-row-date {
	font-size: 0.7rem;
	color: rgba(255,255,255,0.28);
	margin-bottom: 0.25rem;
}
.cal-row-location {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	font-size: 0.7rem;
	color: rgba(255,255,255,0.22);
	margin-bottom: 0.25rem;
}
.cal-loc-icon { width: 10px; height: 10px; flex-shrink: 0; }
.cal-row-meta {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
	margin-top: 0.25rem;
}
.cal-meta-item {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	font-size: 0.65rem;
	color: rgba(255,255,255,0.22);
}
.cal-meta-icon { width: 10px; height: 10px; }
.cal-tag {
	font-size: 0.6rem;
	padding: 0.1rem 0.4rem;
	border: 1px solid rgba(255,255,255,0.07);
	color: rgba(255,255,255,0.3);
}

/* Arrow */
.cal-row-arrow {
	width: 14px;
	height: 14px;
	color: rgba(255,255,255,0.1);
	flex-shrink: 0;
	margin-top: 14px;
	transition: color 0.1s;
}
.cal-row:hover .cal-row-arrow { color: rgba(255,255,255,0.35); }

@media (max-width: 640px) {
	.cal-header-inner { padding: 0.875rem 1rem; }
	.cal-row { padding: 0.75rem 1rem; }
	.cal-row--today { padding-left: calc(1rem - 2px); }
	.cal-month-header { padding: 0.75rem 1rem 0.375rem; }
	.cal-sub { display: none; }
}
</style>
