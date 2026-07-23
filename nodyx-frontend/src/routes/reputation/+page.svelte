<script lang="ts">
	import { t } from '$lib/i18n';
	const tFn = $derived($t);
</script>

<svelte:head>
	<title>{tFn('reputation.meta.title')}</title>
	<meta name="description" content={tFn('reputation.meta.desc')} />
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-12 space-y-10">

	<!-- Header -->
	<div>
		<button type="button" onclick={() => history.back()} class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-8">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
			</svg>
			{tFn('reputation.back')}
		</button>

		<h1 class="text-3xl font-black text-white mb-3">{tFn('reputation.h1')}</h1>
		<p class="text-gray-400 leading-relaxed">
			{tFn('reputation.intro')}
		</p>
	</div>

	<!-- Philosophy block -->
	<div class="border-l-2 border-indigo-500 pl-5 py-1">
		<p class="text-sm text-gray-300 leading-relaxed italic">
			{tFn('reputation.philosophy')}
		</p>
	</div>

	<!-- Score global -->
	<section class="space-y-4">
		<h2 class="text-lg font-bold text-white">{tFn('reputation.global.title')}</h2>
		<div class="bg-gray-900 border border-gray-800 p-5 space-y-3">
			<p class="text-sm text-gray-300">
				{@html tFn('reputation.global.p1')}
			</p>
			<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-indigo-300">
				{tFn('reputation.global.formula')}
			</div>
			<p class="text-xs text-gray-500">
				{tFn('reputation.global.p2')}
			</p>
		</div>
	</section>

	<!-- Metric 1 — Longévité -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-indigo-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-white">{tFn('reputation.longevity.title')}</h2>
			<span class="text-xs text-gray-500 ml-auto">{tFn('reputation.ring.outer')}</span>
		</div>

		<div class="bg-gray-900 border border-gray-800 p-5 space-y-4">
			<p class="text-sm text-gray-300">
				{@html tFn('reputation.longevity.p1')}
			</p>
			<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-indigo-300">
				{tFn('reputation.longevity.formula')}
			</div>
			<table class="w-full text-xs text-gray-400 border-collapse">
				<thead>
					<tr class="border-b border-gray-800">
						<th class="text-left py-2 font-medium text-gray-500">{tFn('reputation.longevity.th')}</th>
						<th class="text-right py-2 font-medium text-gray-500">{tFn('reputation.th.score')}</th>
					</tr>
				</thead>
				<tbody>
					{#each [['reputation.longevity.row.week','2 %'],['reputation.longevity.row.month','8 %'],['reputation.longevity.row.q','25 %'],['reputation.longevity.row.h','50 %'],['reputation.longevity.row.year','100 %']] as [labelKey, score]}
						<tr class="border-b border-gray-800/50">
							<td class="py-2 text-gray-300">{tFn(labelKey)}</td>
							<td class="py-2 text-right font-mono text-indigo-300">{score}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-gray-600">
				{tFn('reputation.longevity.note')}
			</p>
		</div>
	</section>

	<!-- Metric 2 — Qualité -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-violet-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-white">{tFn('reputation.quality.title')}</h2>
			<span class="text-xs text-gray-500 ml-auto">{tFn('reputation.ring.middle')}</span>
		</div>

		<div class="bg-gray-900 border border-gray-800 p-5 space-y-5">
			<p class="text-sm text-gray-300">
				{@html tFn('reputation.quality.p1')}
			</p>

			<!-- Formula display -->
			<div class="bg-gray-950 border border-gray-800 px-6 py-5 flex items-center justify-center">
				<div class="flex items-center gap-3 text-violet-300 select-none" aria-label={tFn('reputation.quality.formula_aria')}>
					<!-- Q = -->
					<span class="text-xl font-bold italic">Q</span>
					<span class="text-lg text-gray-500">=</span>
					<!-- Fraction -->
					<div class="flex flex-col items-center gap-0.5">
						<span class="text-sm font-medium pb-1.5 border-b border-violet-400/60 px-2 whitespace-nowrap">
							∑ {tFn('reputation.quality.f.merci')}<sub class="text-[10px] ml-0.5">{tFn('reputation.quality.f.received')}</sub>
						</span>
						<span class="text-sm font-medium pt-1.5 px-2 whitespace-nowrap text-violet-400/80">
							∑ {tFn('reputation.quality.f.posts')}<sub class="text-[10px] ml-0.5">{tFn('reputation.quality.f.total')}</sub>
						</span>
					</div>
					<!-- × Poids(λ) -->
					<span class="text-lg text-gray-500">×</span>
					<span class="text-sm font-medium whitespace-nowrap">
						{tFn('reputation.quality.f.weight')}(<span class="italic">λ</span>)
					</span>
				</div>
			</div>

			<!-- Lambda explanation -->
			<div class="space-y-3">
				<p class="text-sm font-semibold text-white">{tFn('reputation.lambda.title')}</p>
				<p class="text-sm text-gray-400 leading-relaxed">
					{tFn('reputation.lambda.p1')}
				</p>
				<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-violet-300 flex items-center gap-3 flex-wrap">
					<span>poids(t)</span>
					<span class="text-gray-600">=</span>
					<span>e<sup class="text-xs">−λt</sup></span>
				</div>
				<ul class="text-xs text-gray-500 space-y-1.5 pl-4">
					<li class="list-disc">{@html tFn('reputation.lambda.li_t')}</li>
					<li class="list-disc">{@html tFn('reputation.lambda.li_lambda')}</li>
					<li class="list-disc">{tFn('reputation.lambda.li_high')}</li>
					<li class="list-disc">{tFn('reputation.lambda.li_low')}</li>
				</ul>
			</div>

			<!-- Merci system note -->
			<div class="border-l-2 border-violet-500/40 pl-4 py-1">
				<p class="text-xs text-gray-500 leading-relaxed">
					{@html tFn('reputation.merci_note')}
				</p>
			</div>
		</div>
	</section>

	<!-- Metric 3 — Engagement -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-teal-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-white">{tFn('reputation.engagement.title')}</h2>
			<span class="text-xs text-gray-500 ml-auto">{tFn('reputation.ring.inner')}</span>
		</div>

		<div class="bg-gray-900 border border-gray-800 p-5 space-y-4">
			<p class="text-sm text-gray-300">
				{@html tFn('reputation.engagement.p1')}
			</p>
			<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-teal-300">
				{tFn('reputation.engagement.formula')}
			</div>
			<table class="w-full text-xs text-gray-400 border-collapse">
				<thead>
					<tr class="border-b border-gray-800">
						<th class="text-left py-2 font-medium text-gray-500">{tFn('reputation.engagement.th')}</th>
						<th class="text-right py-2 font-medium text-gray-500">{tFn('reputation.th.score')}</th>
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
						<tr class="border-b border-gray-800/50">
							<td class="py-2 text-gray-300">{tFn(labelKey)}</td>
							<td class="py-2 text-right font-mono text-teal-300">{score}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-gray-600">
				{tFn('reputation.engagement.note')}
			</p>
		</div>
	</section>

	<!-- Anti-gaming block -->
	<section class="space-y-4">
		<h2 class="text-lg font-bold text-white">{tFn('reputation.gaming.title')}</h2>
		<div class="bg-gray-900 border border-gray-800 p-5 space-y-3">
			<p class="text-sm text-gray-300">
				{@html tFn('reputation.gaming.p1')}
			</p>
			<p class="text-sm text-gray-300">
				{tFn('reputation.gaming.p2')}
			</p>
		</div>
	</section>

	<!-- Evolution note -->
	<section class="space-y-3">
		<h2 class="text-lg font-bold text-white">{tFn('reputation.evolution.title')}</h2>
		<p class="text-sm text-gray-400 leading-relaxed">
			{tFn('reputation.evolution.p1')}
		</p>
	</section>

	<!-- Footer link -->
	<div class="border-t border-gray-800 pt-8 text-center">
		<p class="text-xs text-gray-600">
			{@html tFn('reputation.footer')}
		</p>
	</div>

</div>
