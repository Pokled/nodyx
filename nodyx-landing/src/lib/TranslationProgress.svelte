<!--
  Etat des traductions, en direct.

  Les chiffres viennent de https://nodyx.org/translate/progress.json, calcule
  depuis les fichiers de locale eux-memes. Rien n'est ecrit en dur ici : cette
  section ne peut donc pas afficher un chiffre perime.

  Si l'appel echoue (instance injoignable, hors ligne), on retombe sur le texte
  et le lien : la section reste utile, elle ne casse jamais la page.
-->
<script lang="ts">
	import { onMount } from 'svelte'
	import { FLAGS } from '$lib/flags'

	const SOURCE = 'https://nodyx.org/translate/progress.json'
	const PAGE   = 'https://nodyx.org/translate'

	interface Lang {
		code: string
		label: string
		pct: number
		missing: number
		isComplete: boolean
		isCoreComplete: boolean
	}

	let langs   = $state<Lang[]>([])
	let overall = $state<number | null>(null)
	let failed  = $state(false)

	onMount(async () => {
		try {
			const res = await fetch(SOURCE)
			if (!res.ok) throw new Error(String(res.status))
			const data = await res.json()
			langs   = data.languages ?? []
			overall = data.overallPct ?? null
		} catch {
			failed = true
		}
	})

	const complete = $derived(langs.filter((l) => l.isComplete).length)
</script>

<section id="translate" class="py-20 md:py-28">
	<div class="text-center mb-14 reveal">
		<div class="t-label-sm uppercase text-secondary mb-4">Your language, your community</div>
		<h2 class="t-headline md:text-[40px] md:leading-[48px] text-on-surface font-semibold">
			Nodyx speaks {langs.length || 7} languages.
		</h2>
		<p class="t-body-lg text-on-surface-variant mt-4 max-w-2xl mx-auto">
			Every string of the interface lives in a plain text file on GitHub. No translation platform in
			the middle, no account to create. Pick a language, fill in what is missing, open a pull request.
		</p>
	</div>

	<div class="max-w-3xl mx-auto card spot p-6 md:p-8 reveal reveal-d1">

		{#if langs.length}
			<!-- Vue d'ensemble -->
			<div class="flex items-baseline justify-between gap-4 mb-2">
				<span class="t-label-sm uppercase text-secondary/80">Overall progress</span>
				<span class="t-label text-on-surface tabular-nums font-semibold">{overall}%</span>
			</div>
			<div class="track mb-8">
				<span class="fill" style="width: {overall}%"></span>
			</div>

			<!-- Une ligne par langue -->
			<ul class="space-y-3">
				{#each langs as l (l.code)}
					<li class="flex items-center gap-3">
						<span class="flag shrink-0">{@html FLAGS[l.code] ?? ''}</span>
						<span class="t-body text-on-surface w-28 shrink-0 truncate">{l.label}</span>
						<span class="track flex-1">
							<span class="fill" class:done={l.isComplete} style="width: {l.pct}%"></span>
						</span>
						<span
							class="t-label-sm tabular-nums w-10 text-right shrink-0"
							class:text-on-surface-variant={!l.isComplete}
							class:done-text={l.isComplete}>{l.pct}%</span>
					</li>
				{/each}
			</ul>

			<p class="t-label-sm text-on-surface-variant/60 mt-6">
				{complete} complete, and the core interface is translated in all of them.
			</p>
		{:else if failed}
			<p class="t-body text-on-surface-variant text-center">
				7 languages shipped, French and English complete. See the full breakdown on the status page.
			</p>
		{:else}
			<p class="t-body text-on-surface-variant/60 text-center">Loading the latest numbers...</p>
		{/if}

		<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
			<a href={PAGE} class="btn-primary inline-flex items-center gap-2 px-6 py-2.5 rounded text-sm">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>
				Translate Nodyx
			</a>
			<a
				href="https://github.com/Pokled/nodyx/blob/main/docs/en/CONTRIBUTING.md#translating-nodyx"
				class="btn-ghost inline-flex items-center gap-2 px-6 py-2.5 rounded text-sm">
				How it works
			</a>
		</div>
	</div>
</section>

<style>
	.track {
		display: block;
		height: 6px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--color-secondary);
		transition: width 0.9s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.fill.done {
		background: var(--color-success);
	}
	.done-text {
		color: var(--color-success);
	}
	.flag {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		overflow: hidden;
		line-height: 0;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
	}
	.flag :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
	@media (prefers-reduced-motion: reduce) {
		.fill { transition: none; }
	}
</style>
