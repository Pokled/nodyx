<script lang="ts">
	/**
	 * Couche du mode « au stylo » (SPECS/NODYX_APPARENCE_CDC.md, volet B) :
	 * barre de publication, panneau ancré au stylo cliqué, Échap. Montée une
	 * fois dans le layout ; inerte tant que le mode édition est fermé.
	 *
	 * Les panneaux utilisent les MÊMES contrôles et le MÊME moteur que l'écran
	 * Apparence : une retouche ici se retrouve là-bas, et inversement.
	 */
	import { page } from '$app/state'
	import { invalidateAll } from '$app/navigation'
	import { t } from '$lib/i18n'
	import { editMode, editPanel, type EditZone } from '$lib/editMode'
	import { appearance, setAppearanceToken } from '$lib/appearanceEngine'
	import { anchoredPopover } from '$lib/actions/anchoredPopover'
	import AmbianceControls from './AmbianceControls.svelte'
	import IdentityControls from './IdentityControls.svelte'
	import PublishBar from './PublishBar.svelte'

	const tFn = $derived($t)
	const token = $derived((page.data as any).token as string | null)
	const onAppearancePage = $derived(page.url.pathname.startsWith('/admin/appearance'))

	const value = $derived($appearance.hist.present.ambiance)
	const identity = $derived($appearance.hist.present.identity)
	const identityPublished = $derived($appearance.identityPublished)
	const banner = $derived(identity?.banner_url !== undefined ? identity.banner_url ?? null : identityPublished?.banner_url ?? null)

	// Entrer en mode édition : le moteur charge le brouillon et le remontre.
	// En sortir : le site retrouve l'apparence publiée (le brouillon reste).
	let wasOn = false
	$effect(() => {
		const on = $editMode
		if (on && !wasOn) {
			setAppearanceToken(token)
			appearance.load().then(() => appearance.resumePreview())
		}
		if (!on && wasOn) { editPanel.set(null); if (!onAppearancePage) appearance.hidePreview() }
		wasOn = on
	})

	// Zones de gauche (rail, sidebar) : le panneau s'ouvre À CÔTÉ, pour laisser
	// voir la zone qu'on modifie. Les autres : sous le stylo, aligné à droite.
	const sideZones: EditZone[] = ['logo', 'ambiance']

	function exit() { editMode.set(false) }
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !$editMode) return
		if ($editPanel) {
			const anchor = $editPanel.anchor
			editPanel.set(null)
			anchor.focus()                      // le focus revient au stylo
		} else exit()
	}

	const titles: Record<EditZone, string> = $derived({
		logo: tFn('edit.zone_logo'), ambiance: tFn('edit.zone_ambiance'), decor: tFn('edit.zone_decor'), home: tFn('edit.zone_home'),
	})

	// ── Page d'accueil : « Suivre l'ambiance » (thème de la grille) ─────────
	let gridTheme = $state<Record<string, unknown> | null>(null)
	let gridBusy = $state(false)
	const gridApi = (path: string, init: RequestInit = {}) => fetch(`/api/v1/admin/homepage/grid${path}`, {
		...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
	})
	$effect(() => {
		if ($editPanel?.zone !== 'home' || gridTheme) return
		gridApi('').then(r => r.ok ? r.json() : null).then(j => { gridTheme = j?.theme ?? {} }).catch(() => { gridTheme = {} })
	})
	async function toggleFollow() {
		if (!gridTheme) return
		gridBusy = true
		const next = { ...gridTheme, follow_ambiance: !gridTheme.follow_ambiance }
		try {
			const r = await gridApi('/draft', { method: 'PUT', body: JSON.stringify({ theme: next }) })
			if (r.ok) { gridTheme = next; await invalidateAll() }
		} finally { gridBusy = false }
	}
</script>

<svelte:window onkeydown={onKey} />

{#if $editMode}
	{#if !onAppearancePage}
		<PublishBar>
			{#snippet extra()}
				<a class="appr-extra" href="/admin/appearance">{tFn('edit.open_appearance')}</a>
				<button type="button" class="appr-extra" onclick={exit}>{tFn('edit.exit')}</button>
			{/snippet}
		</PublishBar>
	{/if}

	{#if $editPanel}
		{#key $editPanel}
			<div class="edp" role="dialog" aria-label={titles[$editPanel.zone]}
			     use:anchoredPopover={{ anchor: $editPanel.anchor, gap: 12, ...(sideZones.includes($editPanel.zone) ? { placement: 'right' as const } : { align: 'end' as const }) }}>
				<header>
					<h2>{titles[$editPanel.zone]}</h2>
					<button type="button" class="edp-close" aria-label={tFn('common.close')} onclick={() => editPanel.set(null)}>×</button>
				</header>
				<div class="edp-body">
					{#if $editPanel.zone === 'logo'}
						<IdentityControls only="logo" published={identityPublished} draft={identity} {token} onchange={(n) => appearance.setIdentity(n)} />
					{:else if $editPanel.zone === 'ambiance'}
						<AmbianceControls sections={['presets', 'accent', 'neutrals']} {value} {banner} {token} onchange={(v, o) => appearance.setAmbiance(v, o)} />
					{:else if $editPanel.zone === 'decor'}
						<AmbianceControls sections={['backdrop', 'intensity', 'mode']} {value} {banner} {token} onchange={(v, o) => appearance.setAmbiance(v, o)} />
					{:else}
						<IdentityControls only="banner" published={identityPublished} draft={identity} {token} onchange={(n) => appearance.setIdentity(n)} />
						<div class="edp-follow">
							<label class="edp-switch" class:on={!!gridTheme?.follow_ambiance}>
								<input type="checkbox" checked={!!gridTheme?.follow_ambiance} disabled={!gridTheme || gridBusy} onchange={toggleFollow} />
								<span class="edp-knob" aria-hidden="true"></span>
								<span>
									<strong>{tFn('hpb.follow_ambiance')}</strong>
									<small>{gridTheme?.follow_ambiance ? tFn('hpb.follow_ambiance_on') : tFn('hpb.follow_ambiance_off')}</small>
									<small class="edp-live">{tFn('edit.follow_live')}</small>
								</span>
							</label>
							<a class="edp-link" href="/admin/homepage/builder">{tFn('edit.open_builder')}</a>
						</div>
					{/if}
				</div>
			</div>
		{/key}
	{/if}
{/if}

<style>
	/* Panneau ancré au stylo : même matière que les plaques du contenant,
	   contenu aux couleurs de l'admin (les contrôles viennent de l'Apparence). */
	.edp {
		/* fixed : anchoredPopover ne pose que left/top, la position vient d'ici. */
		position: fixed; z-index: 80; width: min(460px, calc(100vw - 24px)); max-height: min(72vh, 720px); overflow: auto;
		border-radius: 16px; background: rgb(15 18 24 / .96); backdrop-filter: blur(20px) saturate(1.5);
		box-shadow: 0 0 0 1px rgb(255 255 255 / .09), 0 24px 60px -16px rgb(0 0 0 / .85);
		font-family: var(--font-shell); color: #e5e7eb;
		animation: edp-in .28s var(--ease-spring);
	}
	@keyframes edp-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } to { opacity: 1; transform: none; } }
	@media (prefers-reduced-motion: reduce) { .edp { animation: none; } }
	.edp header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; background: inherit; }
	.edp h2 { font: 700 15px var(--font-shell-rounded); color: #f9fafb; }
	.edp-close { width: 28px; height: 28px; border-radius: 8px; border: none; background: transparent; color: #9ca3af; font-size: 18px; cursor: pointer; }
	.edp-close:hover { background: rgb(255 255 255 / .06); color: #fff; }
	.edp-close:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.edp-body { padding: 4px 16px 18px; }
	.edp-follow { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
	.edp-switch { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: #111827; border: 1px solid #1f2937; cursor: pointer; }
	.edp-switch.on { border-color: var(--nx-header-accent); }
	.edp-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
	.edp-knob { flex-shrink: 0; position: relative; width: 32px; height: 18px; margin-top: 2px; border-radius: 999px; background: #374151; transition: background-color .2s; }
	.edp-knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 999px; background: #fff; transition: transform .3s var(--ease-spring); }
	.edp-switch.on .edp-knob { background: var(--nx-header-accent); }
	.edp-switch.on .edp-knob::after { transform: translateX(14px); }
	.edp-switch input:focus-visible + .edp-knob { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.edp-switch strong { display: block; font-size: 13px; color: #f3f4f6; }
	.edp-switch small { display: block; font-size: 11.5px; color: #9ca3af; line-height: 1.35; margin-top: 2px; }
	.edp-switch .edp-live { color: #6b7280; font-style: italic; }
	.edp-link { font-size: 12.5px; color: var(--nx-header-accent); align-self: flex-start; }
</style>
