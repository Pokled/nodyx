<script lang="ts">
	// D51 (SPECS/NODYX_MENTIONS_CDC.md ; maquette https://nodyx.org/mentions-maquette.html,
	// section 2) : avant l'envoi, ce que les mentions vont faire. Avertir sans bloquer ;
	// seul un groupe au-delà du seuil de l'instance demande une confirmation.
	// Le cœur refait ses propres contrôles à l'envoi : ce panneau ne décide de rien.
	import { t } from '$lib/i18n'
	import { previewMentions, personFor, labelOf, GROUP_LABEL_KEYS, type MentionPreview } from '$lib/mentions'

	let { refs, token = null, onremove, onreplace, onconfirm, ongate }: {
		/** Références présentes dans le texte : « u:<id> » ou « g:<clé> » */
		refs: string[]
		token?: string | null
		onremove?: (ref: string) => void
		onreplace?: (from: string, to: string, toLabel: string) => void
		onconfirm: () => void
		/** L'envoi doit-il attendre une confirmation ? */
		ongate?: (blocked: boolean) => void
	} = $props()

	let preview = $state<MentionPreview | null>(null)
	let names = $state<Record<string, string>>({})
	let seq = 0
	let timer: ReturnType<typeof setTimeout> | null = null
	const key = $derived(refs.join('|'))

	$effect(() => {
		const current = refs.slice()
		void key
		if (timer) clearTimeout(timer)
		if (!current.length) { preview = null; return }
		const mine = ++seq
		// L'équipe est toujours demandée en plus quand un groupe est là : pour proposer
		// « Seulement l'équipe » à côté d'un grand groupe
		const ask = current.some(r => r.startsWith('g:')) && !current.includes('g:equipe') ? [...current, 'g:equipe'] : current
		timer = setTimeout(async () => {
			const p = await previewMentions(ask, token)
			if (mine !== seq) return
			preview = p
			for (const x of p?.people ?? []) {
				if (x.state !== 'ok' && !names[x.id]) {
					personFor(x.id, token).then(pp => { names = { ...names, [x.id]: pp.username ? labelOf(pp) : '' } })
				}
			}
		}, 300)
		return () => { if (timer) clearTimeout(timer) }
	})

	const mentioned = $derived(new Set(refs))
	const outsiders = $derived((preview?.people ?? []).filter(p => p.state === 'not_member' && mentioned.has('u:' + p.id)))
	const groups = $derived((preview?.groups ?? []).filter(g => mentioned.has('g:' + g.key)))
	const forbidden = $derived(groups.filter(g => g.forbidden))
	const big = $derived(groups.filter(g => g.needs_confirm))
	const team = $derived((preview?.groups ?? []).find(g => g.key === 'equipe'))

	$effect(() => { ongate?.(big.length > 0) })

	const groupName = (g: { key: string; label: string | null }) =>
		'@' + (GROUP_LABEL_KEYS[g.key] ? $t(GROUP_LABEL_KEYS[g.key]) : g.label ?? g.key)
</script>

{#if outsiders.length || forbidden.length || big.length}
	<div class="mw" role="status" aria-live="polite" aria-label={$t('mention.warn_aria')}>
		{#each outsiders as p (p.id)}
			<div class="mw-row mw-info">
				<span class="mw-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span>
				<p>{$t('mention.warn_not_member', { name: names[p.id] || $t('mention.warn_someone') })}
					{#if onremove}<span class="mw-acts"><button type="button" class="mw-btn" onclick={() => onremove?.('u:' + p.id)}>{$t('mention.warn_remove')}</button></span>{/if}
				</p>
			</div>
		{/each}
		{#each forbidden as g (g.key)}
			<div class="mw-row mw-info">
				<span class="mw-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
				<p>{$t('mention.warn_forbidden', { group: groupName(g) })}
					{#if onremove}<span class="mw-acts"><button type="button" class="mw-btn" onclick={() => onremove?.('g:' + g.key)}>{$t('mention.warn_remove')}</button></span>{/if}
				</p>
			</div>
		{/each}
		{#each big as g (g.key)}
			<div class="mw-row mw-big">
				<span class="mw-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
				<p><b>{$t('mention.warn_big', { group: groupName(g), count: g.count })}</b> {$t('mention.warn_big_q')}
					<span class="mw-acts">
						<button type="button" class="mw-btn mw-primary" onclick={onconfirm}>{$t('mention.warn_send_anyway')}</button>
						{#if onreplace && team && g.key !== 'equipe' && team.count > 0}
							<button type="button" class="mw-btn" onclick={() => onreplace?.('g:' + g.key, 'g:equipe', $t('mention.g_equipe'))}>{$t('mention.warn_only_team', { count: team.count })}</button>
						{/if}
						{#if onremove}<button type="button" class="mw-btn mw-ghost" onclick={() => onremove?.('g:' + g.key)}>{$t('mention.warn_remove')}</button>{/if}
					</span>
				</p>
			</div>
		{/each}
	</div>
{/if}

<style>
	.mw { display: flex; flex-direction: column; gap: 6px; margin: 0 0 8px; }
	.mw-row { display: flex; align-items: flex-start; gap: 10px; border-radius: 10px; padding: 8px 10px; font-size: 13px; line-height: 1.45; border: 1px solid; color: var(--nx-text); }
	.mw-row p { margin: 0; flex: 1; min-width: 0; }
	.mw-ico { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex: none; }
	.mw-ico svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.mw-info { background: color-mix(in srgb, var(--nx-info, #3b82f6) 7%, var(--nx-surface)); border-color: color-mix(in srgb, var(--nx-info, #3b82f6) 25%, transparent); }
	.mw-info .mw-ico { background: color-mix(in srgb, var(--nx-info, #3b82f6) 15%, transparent); color: var(--nx-info, #3b82f6); }
	.mw-big { background: color-mix(in srgb, var(--nx-warn, #b45309) 8%, var(--nx-surface)); border-color: color-mix(in srgb, var(--nx-warn, #b45309) 35%, transparent); }
	.mw-big .mw-ico { background: color-mix(in srgb, var(--nx-warn, #b45309) 16%, transparent); color: var(--nx-warn, #b45309); }
	.mw-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
	.mw-btn { border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); background: var(--nx-surface); color: var(--nx-text); border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
	.mw-btn:hover { background: color-mix(in srgb, var(--nx-text) 6%, var(--nx-surface)); }
	.mw-primary { background: var(--nx-header-accent); color: var(--nx-on-accent, #16120c); border-color: transparent; }
	.mw-primary:hover { background: var(--nx-header-accent); filter: brightness(1.05); }
	.mw-ghost { border-color: transparent; background: transparent; color: var(--nx-text-muted); font-weight: 500; }
</style>
