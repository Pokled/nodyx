<script lang="ts">
	// On ne juge jamais un message seul (maquette, CDC E4h lot 3) : la
	// conversation autour, puis ce que l'auteur a modifié. Tout est affiché en
	// texte (htmlToText), jamais interprété : il vient d'un auteur peut-être
	// malveillant et s'affiche chez un modérateur.
	import { t, locale } from '$lib/i18n'
	import { htmlToText } from '$lib/octoguard/text'
	import { wordDiff } from '$lib/octoguard/diff'

	type Around = { id: string; author_username: string | null; content: string | null; created_at: string; edited: boolean; is_target: boolean }
	type Edit = { old_content: string; edited_at: string; editor_username: string | null; by_author: boolean }
	let { around, current, edits, reportedAt = null, heldAt = null }: {
		around: Around[]; current: string | null; edits: Edit[]; reportedAt?: string | null; heldAt?: string | null
	} = $props()
	const tFn = $derived($t)

	const time = (iso: string) => new Date(iso).toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' })
	const day = (iso: string) => new Date(iso).toLocaleDateString($locale, { day: '2-digit', month: 'short' })
	const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()
	const COLORS = ['#6b7a8f', '#7a6b8f', '#8f6b6b', '#6b8f7a', '#8f866b', '#6b858f']
	const colorOf = (name: string | null) => COLORS[[...(name ?? '?')].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length]

	// Où s'insère le message retenu (il n'est pas publié, il n'a pas de place dans le fil)
	const heldIndex = $derived(heldAt ? around.filter((m) => m.created_at < heldAt).length : -1)

	const original = $derived(edits.length ? htmlToText(edits[0].old_content) : null)
	const now = $derived(current !== null ? htmlToText(current) : null)
	const diff = $derived(original !== null && now !== null ? wordDiff(original, now) : null)
	const lastEdit = $derived(edits.length ? edits[edits.length - 1] : null)
	const afterReport = $derived.by(() => {
		if (!lastEdit || !reportedAt) return null
		const min = Math.round((new Date(lastEdit.edited_at).getTime() - new Date(reportedAt).getTime()) / 60000)
		return min > 0 ? min : null
	})
	const others = $derived(edits.filter((e) => !e.by_author).map((e) => e.editor_username).filter(Boolean))
</script>

{#if around.length || heldAt}
	<div class="og-field">
		<span class="og-lbl">{tFn('og2.cx_around')}</span>
		{#if around.length === 0}
			<p class="og-help">{tFn('og2.cx_none')}</p>
		{:else}
			<div class="og-conv">
				{#each around as m, i (m.id)}
					{#if i === heldIndex}<div class="og-msg og-msg-held"><span class="og-msg-av og-msg-av-held" aria-hidden="true">…</span><div><div class="og-msg-who">{tFn('og2.cx_held_here')}</div></div><span class="og-msg-time"></span></div>{/if}
					<div class="og-msg" class:og-msg-hot={m.is_target}>
						<span class="og-msg-av" style="background:{colorOf(m.author_username)}" aria-hidden="true">{(m.author_username ?? '?').charAt(0).toUpperCase()}</span>
						<div class="og-msg-body">
							<div class="og-msg-who">{m.author_username ?? tFn('areports.deleted_account')}{#if m.is_target}<span class="og-msg-tag">{tFn('og2.cx_this_one')}</span>{/if}{#if m.edited}<span class="og-msg-ed">{tFn('og2.cx_edited')}</span>{/if}</div>
							{#if m.content === null}<em class="og-msg-gone">{tFn('og2.cx_deleted')}</em>{:else}<div class="og-msg-text">{htmlToText(m.content)}</div>{/if}
						</div>
						<span class="og-msg-time">{around[0] && !sameDay(around[0].created_at, m.created_at) ? `${day(m.created_at)} ` : ''}{time(m.created_at)}</span>
					</div>
				{/each}
				{#if heldIndex === around.length}<div class="og-msg og-msg-held"><span class="og-msg-av og-msg-av-held" aria-hidden="true">…</span><div><div class="og-msg-who">{tFn('og2.cx_held_here')}</div></div><span class="og-msg-time"></span></div>{/if}
			</div>
		{/if}
	</div>
{/if}

{#if edits.length && original !== null}
	<div class="og-field">
		<span class="og-lbl">{tFn('og2.cx_edits')}</span>
		{#if diff}
			<p class="og-quote og-diff">{#each diff as p, i (i)}{#if p.kind === 'del'}<del>{p.text}</del>{#if diff[i + 1]?.kind === 'ins'}{' '}{/if}{:else if p.kind === 'ins'}<ins>{p.text}</ins>{:else}{p.text}{/if}{/each}</p>
		{:else}
			<p class="og-help">{tFn('og2.cx_before')}</p><blockquote class="og-quote og-rp-text">{original}</blockquote>
			<p class="og-help">{tFn('og2.cx_now')}</p><blockquote class="og-quote og-rp-text">{now ?? ''}</blockquote>
		{/if}
		<p class="og-help">
			{edits.length > 1 ? tFn('og2.cx_edited_n', { n: edits.length, at: time(lastEdit!.edited_at) }) : tFn('og2.cx_edited_at', { at: time(lastEdit!.edited_at) })}{#if afterReport}{' '}{tFn('og2.cx_after_report', { n: afterReport })}{/if}
			{tFn('og2.cx_kept')}
			{#if others.length}{' '}{tFn('og2.cx_by_other', { names: [...new Set(others)].join(', ') })}{/if}
		</p>
	</div>
{/if}
