<script lang="ts">
	import { t } from '$lib/i18n';
	const tFn = $derived($t);
</script>

<svelte:head>
	<title>{tFn('reputation.meta.title')}</title>
	<meta name="description" content={tFn('reputation.meta.desc')} />
</svelte:head>

<div class="rep-page max-w-2xl mx-auto px-4 py-12 space-y-10">

	<!-- Header -->
	<div>
		<button type="button" onclick={() => history.back()} class="inline-flex items-center gap-1.5 text-sm text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] transition-colors mb-8">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
			</svg>
			{tFn('reputation.back')}
		</button>

		<h1 class="text-3xl font-black text-[var(--nx-text)] mb-3">{tFn('reputation.h1')}</h1>
		<p class="text-[var(--nx-text-muted)] leading-relaxed">
			{tFn('reputation.intro')}
		</p>
	</div>

	<!-- Philosophy block -->
	<div class="border-l-2 border-indigo-500 pl-5 py-1">
		<p class="text-sm text-[var(--nx-text)] leading-relaxed italic">
			{tFn('reputation.philosophy')}
		</p>
	</div>

	<!-- Score global -->
	<section class="space-y-4">
		<h2 class="text-lg font-bold text-[var(--nx-text)]">{tFn('reputation.global.title')}</h2>
		<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] p-5 space-y-3">
			<p class="text-sm text-[var(--nx-text)]">
				{@html tFn('reputation.global.p1')}
			</p>
			<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] px-4 py-3 font-mono text-sm text-[var(--nx-header-accent)]">
				{tFn('reputation.global.formula')}
			</div>
			<p class="text-xs text-[var(--nx-text-muted)]">
				{tFn('reputation.global.p2')}
			</p>
		</div>
	</section>

	<!-- Metric 1 — Longévité -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-indigo-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-[var(--nx-text)]">{tFn('reputation.longevity.title')}</h2>
			<span class="text-xs text-[var(--nx-text-muted)] ml-auto">{tFn('reputation.ring.outer')}</span>
		</div>

		<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] p-5 space-y-4">
			<p class="text-sm text-[var(--nx-text)]">
				{@html tFn('reputation.longevity.p1')}
			</p>
			<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] px-4 py-3 font-mono text-sm text-[var(--nx-header-accent)]">
				{tFn('reputation.longevity.formula')}
			</div>
			<table class="w-full text-xs text-[var(--nx-text-muted)] border-collapse">
				<thead>
					<tr class="border-b border-[var(--nx-border)]">
						<th class="text-left py-2 font-medium text-[var(--nx-text-muted)]">{tFn('reputation.longevity.th')}</th>
						<th class="text-right py-2 font-medium text-[var(--nx-text-muted)]">{tFn('reputation.th.score')}</th>
					</tr>
				</thead>
				<tbody>
					{#each [['reputation.longevity.row.week','2 %'],['reputation.longevity.row.month','8 %'],['reputation.longevity.row.q','25 %'],['reputation.longevity.row.h','50 %'],['reputation.longevity.row.year','100 %']] as [labelKey, score]}
						<tr class="border-b border-[var(--nx-border)]/50">
							<td class="py-2 text-[var(--nx-text)]">{tFn(labelKey)}</td>
							<td class="py-2 text-right font-mono text-[var(--nx-header-accent)]">{score}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-[var(--nx-text-muted)]">
				{tFn('reputation.longevity.note')}
			</p>
		</div>
	</section>

	<!-- Metric 2 — Qualité -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-violet-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-[var(--nx-text)]">{tFn('reputation.quality.title')}</h2>
			<span class="text-xs text-[var(--nx-text-muted)] ml-auto">{tFn('reputation.ring.middle')}</span>
		</div>

		<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] p-5 space-y-5">
			<p class="text-sm text-[var(--nx-text)]">
				{@html tFn('reputation.quality.p1')}
			</p>

			<!-- Formula display -->
			<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] px-6 py-5 flex items-center justify-center">
				<div class="flex items-center gap-3 text-[var(--nx-header-accent)] select-none" aria-label={tFn('reputation.quality.formula_aria')}>
					<!-- Q = -->
					<span class="text-xl font-bold italic">Q</span>
					<span class="text-lg text-[var(--nx-text-muted)]">=</span>
					<!-- Fraction -->
					<div class="flex flex-col items-center gap-0.5">
						<span class="text-sm font-medium pb-1.5 border-b border-violet-400/60 px-2 whitespace-nowrap">
							∑ {tFn('reputation.quality.f.merci')}<sub class="text-[10px] ml-0.5">{tFn('reputation.quality.f.received')}</sub>
						</span>
						<span class="text-sm font-medium pt-1.5 px-2 whitespace-nowrap text-[var(--nx-header-accent)]/80">
							∑ {tFn('reputation.quality.f.posts')}<sub class="text-[10px] ml-0.5">{tFn('reputation.quality.f.total')}</sub>
						</span>
					</div>
					<!-- × Poids(λ) -->
					<span class="text-lg text-[var(--nx-text-muted)]">×</span>
					<span class="text-sm font-medium whitespace-nowrap">
						{tFn('reputation.quality.f.weight')}(<span class="italic">λ</span>)
					</span>
				</div>
			</div>

			<!-- Lambda explanation -->
			<div class="space-y-3">
				<p class="text-sm font-semibold text-[var(--nx-text)]">{tFn('reputation.lambda.title')}</p>
				<p class="text-sm text-[var(--nx-text-muted)] leading-relaxed">
					{tFn('reputation.lambda.p1')}
				</p>
				<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] px-4 py-3 font-mono text-sm text-[var(--nx-header-accent)] flex items-center gap-3 flex-wrap">
					<span>poids(t)</span>
					<span class="text-[var(--nx-text-muted)]">=</span>
					<span>e<sup class="text-xs">−λt</sup></span>
				</div>
				<ul class="text-xs text-[var(--nx-text-muted)] space-y-1.5 pl-4">
					<li class="list-disc">{@html tFn('reputation.lambda.li_t')}</li>
					<li class="list-disc">{@html tFn('reputation.lambda.li_lambda')}</li>
					<li class="list-disc">{tFn('reputation.lambda.li_high')}</li>
					<li class="list-disc">{tFn('reputation.lambda.li_low')}</li>
				</ul>
			</div>

			<!-- Merci system note -->
			<div class="border-l-2 border-violet-500/40 pl-4 py-1">
				<p class="text-xs text-[var(--nx-text-muted)] leading-relaxed">
					{@html tFn('reputation.merci_note')}
				</p>
			</div>
		</div>
	</section>

	<!-- Metric 3 — Engagement -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-teal-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-[var(--nx-text)]">{tFn('reputation.engagement.title')}</h2>
			<span class="text-xs text-[var(--nx-text-muted)] ml-auto">{tFn('reputation.ring.inner')}</span>
		</div>

		<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] p-5 space-y-4">
			<p class="text-sm text-[var(--nx-text)]">
				{@html tFn('reputation.engagement.p1')}
			</p>
			<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] px-4 py-3 font-mono text-sm text-teal-300">
				{tFn('reputation.engagement.formula')}
			</div>
			<table class="w-full text-xs text-[var(--nx-text-muted)] border-collapse">
				<thead>
					<tr class="border-b border-[var(--nx-border)]">
						<th class="text-left py-2 font-medium text-[var(--nx-text-muted)]">{tFn('reputation.engagement.th')}</th>
						<th class="text-right py-2 font-medium text-[var(--nx-text-muted)]">{tFn('reputation.th.score')}</th>
					</tr>
				</thead>
				<tbody>
					{#each [
						['reputation.engagement.row.none','0 %'],
						['reputation.engagement.row.replies_only','0 %'],
						['reputation.engagement.row.mix1','18 %'],
						['reputation.engagement.row.mix2','100 %'],
						['reputation.engagement.row.threads_only','100 %'],
					] as [labelKey, score]}
						<tr class="border-b border-[var(--nx-border)]/50">
							<td class="py-2 text-[var(--nx-text)]">{tFn(labelKey)}</td>
							<td class="py-2 text-right font-mono text-teal-300">{score}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-[var(--nx-text-muted)]">
				{tFn('reputation.engagement.note')}
			</p>
		</div>
	</section>

	<!-- Anti-gaming block -->
	<section class="space-y-4">
		<h2 class="text-lg font-bold text-[var(--nx-text)]">{tFn('reputation.gaming.title')}</h2>
		<div class="bg-[var(--nx-surface)] border border-[var(--nx-border)] p-5 space-y-3">
			<p class="text-sm text-[var(--nx-text)]">
				{@html tFn('reputation.gaming.p1')}
			</p>
			<p class="text-sm text-[var(--nx-text)]">
				{tFn('reputation.gaming.p2')}
			</p>
		</div>
	</section>

	<!-- Evolution note -->
	<section class="space-y-3">
		<h2 class="text-lg font-bold text-[var(--nx-text)]">{tFn('reputation.evolution.title')}</h2>
		<p class="text-sm text-[var(--nx-text-muted)] leading-relaxed">
			{tFn('reputation.evolution.p1')}
		</p>
	</section>

	<!-- Footer link -->
	<div class="border-t border-[var(--nx-border)] pt-8 text-center">
		<p class="text-xs text-[var(--nx-text-muted)]">
			{@html tFn('reputation.footer')}
		</p>
	</div>

</div>

<style>
	/* Mots mis en avant dans les explications (traductions en HTML) : couleur du texte
	   principal du thème. La classe text-white, autrefois écrite DANS les traductions,
	   disparaissait sur fond clair ; les traducteurs n'ont plus de style à porter. */
	.rep-page :global(strong) { color: var(--nx-text); }
</style>
