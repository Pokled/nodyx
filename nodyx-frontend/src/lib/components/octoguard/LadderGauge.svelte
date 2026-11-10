<script lang="ts">
	// La jauge du barème (maquette validée : 5 cases, « Prochaine étape du barème : … »).
	// Les cases déjà franchies sont pleines, celle de la prochaine étape est marquée,
	// la cinquième est « au-delà » : la décision d'un admin.
	import { t } from '$lib/i18n'
	import { phraseKey, optionKey, type MemberLadder } from '$lib/octoguard/ladder'

	let { ladder }: { ladder: MemberLadder | null } = $props()
	const tFn = $derived($t)

	// Prochaine case : l'étape suivante, ou la 5e (« au-delà ») une fois la 4e franchie
	const here = $derived(ladder ? (ladder.next?.step ?? 5) : 0)
	const MARK = '\u0000'
	// Une seule phrase à traduire ; le mot « barème » y devient un lien
	const parts = $derived(ladder?.next ? tFn('og2.lad_next', { what: tFn(phraseKey(ladder.next.sanction)), ladder: MARK }).split(MARK) : [])
</script>

{#if ladder}
	<div class="lad-gauge" role="img" aria-label={tFn('og2.lad_gauge_aria', { n: here })}>
		{#each [1, 2, 3, 4, 5] as i (i)}<span class:on={i < here} class:here={i === here}></span>{/each}
	</div>
	{#if ladder.pending}
		<p class="lad-line lad-line--wait">{tFn('og2.lad_pending_line', { what: tFn(optionKey(ladder.pending.sanction)), who: ladder.pending.actor ?? '' })}</p>
	{:else if ladder.next}
		<p class="lad-line">{parts[0]}<a href="/admin/octoguard/ladder" class="lad-lnk">{tFn('og2.lad_word')}</a>{parts[1] ?? ''}</p>
	{:else}
		<p class="lad-line">{tFn('og2.lad_beyond')}</p>
	{/if}
{/if}

<style>
	.lad-gauge { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
	.lad-gauge span { height: 6px; border-radius: 99px; background: var(--nx-border); }
	.lad-gauge span.on { background: var(--nx-warn); }
	.lad-gauge span.here { background: var(--nx-bad); }
	.lad-line { margin: 8px 0 0; font-size: 0.8125rem; color: var(--nx-text-muted); }
	.lad-line--wait { color: var(--nx-warn); }
	.lad-lnk { color: var(--nx-header-accent, var(--nx-accent)); text-decoration: underline; text-underline-offset: 2px; }
</style>
