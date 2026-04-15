<script lang="ts">
	import type { PageData, ActionData } from './$types'
	import { goto } from '$app/navigation'
	import { page } from '$app/stores'
	import { enhance } from '$app/forms'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { untrack } from 'svelte'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// Local mutable copy of seeds for optimistic updates
	let seeds = $state(untrack(() => data.seeds.map((s: any) => ({ ...s }))))

	const CATEGORIES = [
		{ value: '', label: 'Toutes' },
		{ value: 'feature', label: 'Fonctionnalité' },
		{ value: 'design',  label: 'Design' },
		{ value: 'plugin',  label: 'Plugin' },
		{ value: 'event',   label: 'Événement' },
	]

	const CATEGORY_ICONS: Record<string, string> = {
		'': '◈', feature: '✦', design: '◉', plugin: '◈', event: '◆'
	}

	const STAGE_META: Record<string, { icon: string; label: string; dot: string }> = {
		germe:  { icon: '🌱', label: 'Germe',  dot: '#4ade80' },
		pousse: { icon: '🌿', label: 'Pousse', dot: '#34d399' },
		fleur:  { icon: '🌸', label: 'Fleur',  dot: '#f472b6' },
		fruit:  { icon: '🍎', label: 'Fruit',  dot: '#f87171' },
	}

	let showForm   = $state(false)
	$effect(() => { if (form?.error) showForm = true; })
	let wateringId = $state<string | null>(null)
	let toast      = $state<{ msg: string; emoji: string } | null>(null)
	let toastTimer = $state<ReturnType<typeof setTimeout> | null>(null)

	const PATIENCE_QUOTES = [
		{ msg: 'Tu as déjà arrosé cette graine 💧\n« La patience est une vertu »', emoji: '🌿' },
		{ msg: 'Doucement ! Cette plante a déjà eu sa dose d\'eau 😄\n« Trop d\'eau noie le poisson »', emoji: '🐟' },
		{ msg: 'Tu as voté ici ! Reviens quand une nouvelle graine sera plantée 🌱\n« Chaque chose en son temps »', emoji: '⏳' },
		{ msg: 'Ton arrosoir est vide pour cette graine 🪣\n« La patience est mère de toutes les vertus »', emoji: '❤️' },
	]

	function showToast(msg: string, emoji: string) {
		if (toastTimer) clearTimeout(toastTimer)
		toast = { msg, emoji }
		toastTimer = setTimeout(() => { toast = null }, 4000)
	}

	function applyCategory(cat: string) {
		const u = new URL($page.url)
		if (cat) u.searchParams.set('category', cat)
		else u.searchParams.delete('category')
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	async function waterSeed(seedId: string) {
		if (!data.token) { goto('/auth/login?redirectTo=/garden'); return }
		wateringId = seedId
		const res = await fetch(`${PUBLIC_API_URL}/api/v1/garden/seeds/${seedId}/water`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${data.token}` },
		})
		wateringId = null
		if (res.status === 409) {
			const q = PATIENCE_QUOTES[Math.floor(Math.random() * PATIENCE_QUOTES.length)]
			showToast(q.msg, q.emoji)
			return
		}
		const seed = seeds.find((s: any) => s.id === seedId)
		if (seed) {
			seed.watered_by_me = true
			seed.water_count += 1
		}
	}

	function growthPercent(stage: string, count: number): number {
		if (stage === 'germe')  return Math.min((count / 10)  * 100, 100)
		if (stage === 'pousse') return Math.min(((count - 10)  / 40)  * 100, 100)
		if (stage === 'fleur')  return Math.min(((count - 50)  / 150) * 100, 100)
		return 100
	}
</script>

<svelte:head>
	<title>Le Jardin — Nodyx</title>
</svelte:head>

<!-- Toast -->
{#if toast}
	<div class="garden-toast">
		<span class="toast-emoji">{toast.emoji}</span>
		<p class="toast-msg">{toast.msg}</p>
		<button onclick={() => toast = null} class="toast-close">✕</button>
	</div>
{/if}

<div class="garden-root">

	<!-- ── Sticky Header ─────────────────────────────────────────────────────── -->
	<header class="garden-header">
		<div class="garden-header-inner">
			<div class="garden-header-left">
				<div class="garden-header-icon">🌱</div>
				<div>
					<h1 class="garden-title">Le Jardin</h1>
					<p class="garden-sub">Plante des idées · la communauté les arrose · les meilleures grandissent</p>
				</div>
			</div>
			<button
				onclick={() => showForm = !showForm}
				class="garden-plant-btn"
				class:garden-plant-btn--active={showForm}
			>
				<span class="btn-icon">+</span>
				<span>Planter</span>
			</button>
		</div>

		<!-- Category tabs -->
		<div class="garden-tabs">
			{#each CATEGORIES as cat}
				<button
					onclick={() => applyCategory(cat.value)}
					class="garden-tab"
					class:garden-tab--active={data.category === cat.value}
				>
					<span class="tab-icon">{CATEGORY_ICONS[cat.value]}</span>
					{cat.label}
				</button>
			{/each}
		</div>
	</header>

	<!-- ── Form ──────────────────────────────────────────────────────────────── -->
	{#if showForm}
		<div class="garden-form-wrap">
			<div class="garden-form-card">
				<div class="form-card-header">
					<span class="form-card-dot"></span>
					<h2 class="form-card-title">Nouvelle graine</h2>
					<button onclick={() => showForm = false} class="form-card-close">✕</button>
				</div>

				{#if form?.error}
					<div class="form-error">{form.error}</div>
				{/if}

				<form method="POST" action="?/plant" use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success' && (result.data as { planted?: boolean })?.planted) {
							showForm = false
							await update({ reset: true })
							seeds = data.seeds.map((s: any) => ({ ...s }))
						}
					}
				}} class="form-grid">
					<div class="form-field form-field--full">
						<label for="garden-title" class="form-label">Titre <span class="form-required">*</span></label>
						<input id="garden-title" name="title" required maxlength="200"
							placeholder="Ex : Mode sombre personnalisable"
							class="form-input" />
					</div>
					<div class="form-field form-field--full">
						<label for="garden-desc" class="form-label">Description</label>
						<textarea id="garden-desc" name="description" rows="3"
							placeholder="Décris ton idée en détail…"
							class="form-input form-textarea"></textarea>
					</div>
					<div class="form-field">
						<label for="garden-cat" class="form-label">Catégorie</label>
						<select id="garden-cat" name="category" class="form-input form-select">
							{#each CATEGORIES.slice(1) as cat}
								<option value={cat.value}>{cat.label}</option>
							{/each}
						</select>
					</div>
					<div class="form-actions">
						<button type="submit" class="form-submit">Planter 🌱</button>
						<button type="button" onclick={() => showForm = false} class="form-cancel">Annuler</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<!-- ── Seeds list ─────────────────────────────────────────────────────────── -->
	<div class="garden-body">
		{#if seeds.length === 0}
			<div class="garden-empty">
				<p class="empty-icon">🏜️</p>
				<p class="empty-title">Le jardin est vide</p>
				<p class="empty-sub">Plante la première graine !</p>
			</div>
		{:else}
			<div class="seeds-list">
				{#each seeds as seed}
					{@const stage = STAGE_META[seed.growth_stage] ?? STAGE_META.germe}
					{@const pct   = growthPercent(seed.growth_stage, seed.water_count)}
					<article class="seed-row" class:seed-row--watered={seed.watered_by_me}>
						<div class="seed-stage-col">
							<span class="seed-stage-icon">{stage.icon}</span>
						</div>

						<div class="seed-body">
							<div class="seed-top">
								<h3 class="seed-title">{seed.title}</h3>
								<div class="seed-badges">
									{#if seed.harvest_date}
										<span class="seed-badge seed-badge--done">Implémenté</span>
									{/if}
									<span class="seed-badge" style="color:{stage.dot}; border-color:{stage.dot}33">
										<span class="badge-dot" style="background:{stage.dot}"></span>
										{stage.label}
									</span>
								</div>
							</div>

							{#if seed.description}
								<p class="seed-desc">{seed.description}</p>
							{/if}

							<!-- Growth bar -->
							<div class="seed-bar-wrap">
								<div class="seed-bar-track">
									<div class="seed-bar-fill" style="width:{pct}%; --dot:{stage.dot}"></div>
								</div>
								<span class="seed-bar-pct">{Math.round(pct)}%</span>
							</div>
						</div>

						<div class="seed-actions">
							<span class="seed-count">
								<svg class="seed-count-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/>
								</svg>
								{seed.water_count}
							</span>
							<button
								onclick={() => waterSeed(seed.id)}
								disabled={wateringId === seed.id || seed.watered_by_me}
								class="water-btn"
								class:water-btn--done={seed.watered_by_me}
								class:water-btn--loading={wateringId === seed.id}
								title={seed.watered_by_me ? 'Déjà arrosé' : 'Arroser'}
							>
								{#if wateringId === seed.id}
									<span class="water-spinner"></span>
								{:else if seed.watered_by_me}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="water-icon">
										<polyline points="20 6 9 17 4 12"/>
									</svg>
								{:else}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="water-icon">
										<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10c0-1.7-.4-3.2-1.2-4.6"/>
										<path d="M12 6v6l4 2"/>
									</svg>
								{/if}
							</button>
						</div>
					</article>
				{/each}
			</div>

			{#if seeds.length === 30}
				<div class="garden-pagination">
					<a
						href="?{new URLSearchParams({ category: data.category, offset: String(data.offset + 30) })}"
						class="pagination-btn"
					>
						Voir plus
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="pag-icon">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
						</svg>
					</a>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
/* ── Root ──────────────────────────────────────────────────────────────────── */
.garden-root {
	min-height: 100vh;
	background: #09090f;
	display: flex;
	flex-direction: column;
}

/* ── Toast ─────────────────────────────────────────────────────────────────── */
.garden-toast {
	position: fixed;
	bottom: 1.5rem;
	left: 50%;
	transform: translateX(-50%);
	z-index: 50;
	display: flex;
	align-items: flex-start;
	gap: 0.75rem;
	padding: 0.875rem 1rem;
	background: rgba(9,9,15,0.96);
	border: 1px solid rgba(52,211,153,0.25);
	border-left: 2px solid #34d399;
	box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(52,211,153,0.05);
	max-width: 320px;
	width: calc(100vw - 2rem);
	animation: toast-in 0.25s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes toast-in {
	from { opacity: 0; transform: translateX(-50%) translateY(12px); }
	to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.toast-emoji { font-size: 1.25rem; flex-shrink: 0; margin-top: 1px; line-height: 1; }
.toast-msg {
	font-size: 0.75rem;
	color: rgba(255,255,255,0.75);
	line-height: 1.5;
	white-space: pre-line;
	flex: 1;
}
.toast-close {
	flex-shrink: 0;
	color: rgba(255,255,255,0.25);
	font-size: 0.8rem;
	line-height: 1;
	transition: color 0.1s;
	margin-top: 2px;
}
.toast-close:hover { color: rgba(255,255,255,0.6); }

/* ── Header ────────────────────────────────────────────────────────────────── */
.garden-header {
	position: sticky;
	top: 0;
	z-index: 20;
	background: rgba(9,9,15,0.88);
	backdrop-filter: blur(16px);
	border-bottom: 1px solid rgba(255,255,255,0.06);
}
.garden-header-inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem 1.5rem 0.875rem;
	gap: 1rem;
}
.garden-header-left {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	min-width: 0;
}
.garden-header-icon {
	font-size: 1.375rem;
	line-height: 1;
	flex-shrink: 0;
}
.garden-title {
	font-size: 1rem;
	font-weight: 800;
	color: rgba(255,255,255,0.92);
	letter-spacing: -0.2px;
}
.garden-sub {
	font-size: 0.65rem;
	color: rgba(255,255,255,0.28);
	margin-top: 1px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.garden-plant-btn {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	padding: 0.375rem 0.875rem;
	font-size: 0.75rem;
	font-weight: 700;
	color: rgba(255,255,255,0.7);
	border: 1px solid rgba(52,211,153,0.25);
	background: rgba(52,211,153,0.05);
	transition: all 0.15s;
	flex-shrink: 0;
}
.garden-plant-btn:hover,
.garden-plant-btn--active {
	color: #34d399;
	border-color: rgba(52,211,153,0.5);
	background: rgba(52,211,153,0.1);
}
.btn-icon {
	font-size: 1rem;
	line-height: 1;
	font-weight: 300;
}

/* ── Tabs ───────────────────────────────────────────────────────────────────── */
.garden-tabs {
	display: flex;
	gap: 0;
	padding: 0 1.5rem;
	border-top: 1px solid rgba(255,255,255,0.04);
	overflow-x: auto;
	scrollbar-width: none;
}
.garden-tabs::-webkit-scrollbar { display: none; }

.garden-tab {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	padding: 0.625rem 0.875rem;
	font-size: 0.7rem;
	font-weight: 600;
	color: rgba(255,255,255,0.3);
	border-bottom: 2px solid transparent;
	white-space: nowrap;
	transition: all 0.15s;
}
.garden-tab:hover { color: rgba(255,255,255,0.6); }
.garden-tab--active {
	color: #34d399;
	border-bottom-color: #34d399;
}
.tab-icon {
	font-size: 0.65rem;
	opacity: 0.6;
}
.garden-tab--active .tab-icon { opacity: 1; }

/* ── Form ───────────────────────────────────────────────────────────────────── */
.garden-form-wrap {
	padding: 0 1.5rem;
	border-bottom: 1px solid rgba(255,255,255,0.06);
}
.garden-form-card {
	padding: 1.25rem 0;
}
.form-card-header {
	display: flex;
	align-items: center;
	gap: 0.625rem;
	margin-bottom: 1rem;
}
.form-card-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #34d399;
	box-shadow: 0 0 6px rgba(52,211,153,0.5);
	flex-shrink: 0;
}
.form-card-title {
	font-size: 0.8rem;
	font-weight: 700;
	color: rgba(255,255,255,0.8);
	flex: 1;
	letter-spacing: -0.1px;
}
.form-card-close {
	color: rgba(255,255,255,0.2);
	font-size: 0.8rem;
	transition: color 0.1s;
}
.form-card-close:hover { color: rgba(255,255,255,0.6); }

.form-error {
	font-size: 0.75rem;
	color: #f87171;
	background: rgba(248,113,113,0.08);
	border: 1px solid rgba(248,113,113,0.2);
	padding: 0.5rem 0.75rem;
	margin-bottom: 0.875rem;
}

.form-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.75rem;
}
.form-field { display: flex; flex-direction: column; gap: 0.375rem; }
.form-field--full { grid-column: 1 / -1; }
.form-label {
	font-size: 0.65rem;
	font-weight: 600;
	color: rgba(255,255,255,0.35);
	text-transform: uppercase;
	letter-spacing: 0.05em;
}
.form-required { color: rgba(52,211,153,0.6); }
.form-input {
	width: 100%;
	padding: 0.5rem 0.75rem;
	background: rgba(255,255,255,0.03);
	border: 1px solid rgba(255,255,255,0.08);
	color: rgba(255,255,255,0.85);
	font-size: 0.8rem;
	outline: none;
	transition: border-color 0.15s, background 0.15s;
	font-family: inherit;
}
.form-input::placeholder { color: rgba(255,255,255,0.2); }
.form-input:focus {
	border-color: rgba(52,211,153,0.4);
	background: rgba(52,211,153,0.03);
}
.form-textarea { resize: none; line-height: 1.5; }
.form-select { cursor: pointer; }
.form-select option { background: #0d0d1a; }

.form-actions {
	display: flex;
	align-items: center;
	gap: 0.625rem;
}
.form-submit {
	padding: 0.5rem 1rem;
	font-size: 0.75rem;
	font-weight: 700;
	color: #34d399;
	border: 1px solid rgba(52,211,153,0.4);
	background: rgba(52,211,153,0.08);
	transition: all 0.15s;
}
.form-submit:hover {
	background: rgba(52,211,153,0.15);
	border-color: rgba(52,211,153,0.6);
}
.form-cancel {
	padding: 0.5rem 0.875rem;
	font-size: 0.75rem;
	color: rgba(255,255,255,0.35);
	border: 1px solid rgba(255,255,255,0.07);
	background: transparent;
	transition: all 0.15s;
}
.form-cancel:hover {
	color: rgba(255,255,255,0.6);
	border-color: rgba(255,255,255,0.12);
}

/* ── Body / Seeds list ──────────────────────────────────────────────────────── */
.garden-body {
	padding: 0;
}

/* ── Empty ─────────────────────────────────────────────────────────────────── */
.garden-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 5rem 1.5rem;
	gap: 0.375rem;
}
.empty-icon { font-size: 2.5rem; line-height: 1; }
.empty-title {
	font-size: 0.9rem;
	font-weight: 700;
	color: rgba(255,255,255,0.5);
	margin-top: 0.375rem;
}
.empty-sub { font-size: 0.75rem; color: rgba(255,255,255,0.25); }

/* ── Seed row ───────────────────────────────────────────────────────────────── */
.seeds-list { display: flex; flex-direction: column; }

.seed-row {
	display: flex;
	align-items: flex-start;
	gap: 0.875rem;
	padding: 1rem 1.5rem;
	border-bottom: 1px solid rgba(255,255,255,0.04);
	background: transparent;
	transition: background 0.12s;
}
.seed-row:hover {
	background: rgba(255,255,255,0.015);
}
.seed-row--watered {
	border-left: 2px solid rgba(52,211,153,0.3);
	padding-left: calc(1.5rem - 2px);
}

/* Stage icon column */
.seed-stage-col {
	flex-shrink: 0;
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.125rem;
	line-height: 1;
	margin-top: 1px;
}

/* Body */
.seed-body {
	flex: 1;
	min-width: 0;
}

.seed-top {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.75rem;
	margin-bottom: 0.25rem;
}

.seed-title {
	font-size: 0.85rem;
	font-weight: 700;
	color: rgba(255,255,255,0.88);
	letter-spacing: -0.1px;
	line-height: 1.3;
	flex: 1;
	min-width: 0;
}

.seed-badges {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	flex-shrink: 0;
}

.seed-badge {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	font-size: 0.6rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	padding: 0.1rem 0.45rem;
	border: 1px solid;
	color: rgba(255,255,255,0.4);
	border-color: rgba(255,255,255,0.1);
}
.seed-badge--done {
	color: #a78bfa;
	border-color: rgba(167,139,250,0.3);
}

.badge-dot {
	width: 4px;
	height: 4px;
	border-radius: 50%;
	flex-shrink: 0;
}

.seed-desc {
	font-size: 0.75rem;
	color: rgba(255,255,255,0.38);
	line-height: 1.5;
	margin-bottom: 0.5rem;
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
}

/* Growth bar */
.seed-bar-wrap {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-top: 0.5rem;
}
.seed-bar-track {
	flex: 1;
	height: 2px;
	background: rgba(255,255,255,0.06);
	overflow: hidden;
}
.seed-bar-fill {
	height: 100%;
	background: var(--dot, #34d399);
	transition: width 0.6s cubic-bezier(0.4,0,0.2,1);
	box-shadow: 0 0 4px var(--dot, #34d399);
}
.seed-bar-pct {
	font-size: 0.6rem;
	font-weight: 700;
	color: rgba(255,255,255,0.2);
	font-variant-numeric: tabular-nums;
	flex-shrink: 0;
	min-width: 2.2rem;
	text-align: right;
}

/* Actions column */
.seed-actions {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.375rem;
	flex-shrink: 0;
	padding-top: 2px;
}

.seed-count {
	display: flex;
	align-items: center;
	gap: 0.2rem;
	font-size: 0.65rem;
	font-weight: 700;
	color: rgba(255,255,255,0.2);
	font-variant-numeric: tabular-nums;
}
.seed-count-icon {
	width: 10px;
	height: 10px;
	color: rgba(255,255,255,0.15);
}

/* Water button */
.water-btn {
	width: 30px;
	height: 30px;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 1px solid rgba(255,255,255,0.08);
	background: rgba(255,255,255,0.03);
	color: rgba(255,255,255,0.35);
	transition: all 0.15s;
}
.water-btn:hover:not(:disabled) {
	border-color: rgba(52,211,153,0.45);
	background: rgba(52,211,153,0.08);
	color: #34d399;
}
.water-btn--done {
	border-color: rgba(52,211,153,0.3);
	background: rgba(52,211,153,0.06);
	color: #34d399;
	cursor: default;
}
.water-btn--loading {
	opacity: 0.5;
	cursor: wait;
}
.water-btn:disabled { cursor: default; }

.water-icon {
	width: 13px;
	height: 13px;
}

.water-spinner {
	width: 10px;
	height: 10px;
	border: 1.5px solid rgba(52,211,153,0.2);
	border-top-color: #34d399;
	border-radius: 50%;
	animation: spin 0.7s linear infinite;
}
@keyframes spin {
	to { transform: rotate(360deg); }
}

/* ── Pagination ─────────────────────────────────────────────────────────────── */
.garden-pagination {
	display: flex;
	justify-content: center;
	padding: 2rem 1.5rem;
	border-top: 1px solid rgba(255,255,255,0.04);
}
.pagination-btn {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	font-size: 0.75rem;
	font-weight: 600;
	color: rgba(255,255,255,0.4);
	padding: 0.5rem 1.25rem;
	border: 1px solid rgba(255,255,255,0.07);
	background: transparent;
	transition: all 0.15s;
}
.pagination-btn:hover {
	color: rgba(255,255,255,0.75);
	border-color: rgba(255,255,255,0.14);
	background: rgba(255,255,255,0.03);
}
.pag-icon {
	width: 12px;
	height: 12px;
}

/* ── Responsive ─────────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
	.garden-header-inner { padding: 0.875rem 1rem 0.75rem; }
	.garden-tabs { padding: 0 1rem; }
	.garden-form-wrap { padding: 0 1rem; }
	.seed-row { padding: 0.875rem 1rem; gap: 0.625rem; }
	.seed-row--watered { padding-left: calc(1rem - 2px); }
	.garden-sub { display: none; }
}
</style>
