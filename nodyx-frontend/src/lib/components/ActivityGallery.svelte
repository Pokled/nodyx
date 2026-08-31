<script lang="ts">
	// Galerie des jeux (activités d'extension) installés sur l'instance.
	// Ouverte par le bouton « Jeux » d'un canal vocal ; on y choisit le jeu à
	// lancer, qui est ensuite monté par ActivitySurface.
	//
	// Les métadonnées (couverture, icône, accroche, catégorie) viennent de
	// /extensions/public, résolues côté serveur. Cf SPECS/NODYX_ACTIVITIES_CDC.md.

	import { onDestroy } from 'svelte'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	export interface GalleryActivity {
		id:          string
		version:     string
		surfaceId:   string
		appUrl:      string
		label:       string
		tagline:     string | null
		description: string | null
		icon:        string | null
		screenshots: string[]
		family:      string
		author:      { name: string; url?: string } | null
	}

	let { activities = [] as GalleryActivity[], onselect, onclose }: {
		activities?: GalleryActivity[]
		onselect: (a: GalleryActivity) => void
		onclose:  () => void
	} = $props()

	const FAMILIES = ['gaming', 'media', 'community', 'esport', 'social', 'content']
	const familyLabel = (f: string) =>
		tFn(`games.family.${FAMILIES.includes(f) ? f : 'gaming'}`)

	// Défilement des captures : une carte survolée/focus fait tourner ses images.
	let hovered = $state<string | null>(null)
	let shotIndex = $state(0)
	let timer: ReturnType<typeof setInterval> | null = null

	$effect(() => {
		if (timer) { clearInterval(timer); timer = null }
		shotIndex = 0
		const a = activities.find((x) => x.id === hovered)
		if (a && a.screenshots.length > 1) {
			timer = setInterval(() => { shotIndex = (shotIndex + 1) % a.screenshots.length }, 2600)
		}
	})
	onDestroy(() => { if (timer) clearInterval(timer) })

	function cover(a: GalleryActivity): string | null {
		if (a.screenshots.length === 0) return null
		return a.id === hovered ? a.screenshots[shotIndex % a.screenshots.length] : a.screenshots[0]
	}

</script>

<div aria-label={tFn('games.gallery_title')} class="gal-shell">
	<div class="gal-bar">
		<div class="gal-head">
			<span class="gal-title">{tFn('games.gallery_title')}</span>
			<span class="gal-sub">{tFn('games.gallery_subtitle')}</span>
		</div>
		<button class="gal-x" onclick={onclose} aria-label={tFn('games.close')}>✕</button>
	</div>

	{#if activities.length === 0}
		<div class="gal-empty">
			<p class="gal-empty-t">{tFn('games.none')}</p>
			<p class="gal-empty-h">{tFn('games.none_hint')}</p>
		</div>
	{:else}
		<div class="gal-grid">
			{#each activities as a (a.id + ':' + a.surfaceId)}
				<button
					class="gal-card"
					onclick={() => onselect(a)}
					onmouseenter={() => hovered = a.id}
					onmouseleave={() => { if (hovered === a.id) hovered = null }}
					onfocus={() => hovered = a.id}
					onblur={() => { if (hovered === a.id) hovered = null }}
				>
					<div class="gal-cover" class:gal-cover-empty={!cover(a)}>
						{#if cover(a)}
							<img src={cover(a)} alt="" loading="lazy" />
						{:else if a.icon}
							<img class="gal-cover-icon" src={a.icon} alt="" />
						{/if}
						<span class="gal-badge">{familyLabel(a.family)}</span>
						{#if a.id === hovered && a.screenshots.length > 1}
							<span class="gal-dots" aria-hidden="true">
								{#each a.screenshots as _, i}
									<span class="gal-dot" class:on={i === shotIndex}></span>
								{/each}
							</span>
						{/if}
					</div>

					<div class="gal-body">
						{#if a.icon}
							<img class="gal-icon" src={a.icon} alt="" />
						{/if}
						<div class="gal-txt">
							<span class="gal-name">{a.label}</span>
							<span class="gal-tag">{a.tagline || a.description || ''}</span>
							{#if a.author?.name}
								<span class="gal-by">{tFn('games.by', { name: a.author.name })}</span>
							{/if}
						</div>
						<span class="gal-play">{tFn('games.play')}</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.gal-shell {
		position: relative; width: 100%; height: 100%;
		background: #07070c;
		display: flex; flex-direction: column; overflow: hidden;
	}
	.gal-bar {
		flex-shrink: 0;
		display: flex; align-items: center; justify-content: space-between;
		padding: 12px 18px;
		background: #0d0d14; border-bottom: 1px solid rgba(255,255,255,0.06);
	}
	.gal-head { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
	.gal-title { font-size: 15px; font-weight: 800; color: #e8ecf4; letter-spacing: .01em; }
	.gal-sub { font-size: 11px; color: #6b7280; }
	.gal-x {
		flex: none; width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
		color: #cbd5e1; background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.12); font-size: 13px; line-height: 1;
	}
	.gal-x:hover { background: rgba(255,255,255,0.12); }

	.gal-grid {
		flex: 1; overflow-y: auto; overflow-x: hidden;
		display: grid; gap: 18px;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		padding: 22px;
		align-content: start;
	}

	.gal-card {
		display: flex; flex-direction: column; text-align: left;
		background: #12121b; border: 1px solid rgba(255,255,255,0.07);
		border-radius: 14px; overflow: hidden; cursor: pointer;
		padding: 0; color: inherit; font: inherit;
		transition: border-color .15s, transform .15s, box-shadow .15s;
	}
	.gal-card:hover, .gal-card:focus-visible {
		border-color: rgba(115,204,140,0.5);
		transform: translateY(-2px);
		box-shadow: 0 10px 30px -12px rgba(0,0,0,0.7);
		outline: none;
	}

	.gal-cover {
		position: relative; aspect-ratio: 16 / 9; width: 100%;
		background: #0b0b12; overflow: hidden;
	}
	.gal-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.gal-cover-empty {
		background: radial-gradient(120% 120% at 30% 20%, #1c2740, #0b0b12);
		display: flex; align-items: center; justify-content: center;
	}
	.gal-cover-icon { width: 44% !important; height: auto !important; object-fit: contain !important; opacity: .85; }
	.gal-badge {
		position: absolute; top: 8px; left: 8px;
		font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
		color: #cbd5e1; background: rgba(7,7,12,0.72);
		border: 1px solid rgba(255,255,255,0.14); border-radius: 999px;
		padding: 3px 8px; backdrop-filter: blur(3px);
	}
	.gal-dots { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; }
	.gal-dot { width: 5px; height: 5px; border-radius: 999px; background: rgba(255,255,255,0.3); }
	.gal-dot.on { background: #73cc8c; }

	.gal-body { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
	.gal-icon { width: 38px; height: 38px; border-radius: 9px; flex: none; background: #0b0b12; object-fit: contain; }
	.gal-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
	.gal-name { font-size: 14px; font-weight: 700; color: #e8ecf4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.gal-tag {
		font-size: 11.5px; color: #8b93a3; line-height: 1.35;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
	}
	.gal-by { font-size: 10px; color: #565e6d; margin-top: 1px; }
	.gal-play {
		flex: none; align-self: center;
		font-size: 11px; font-weight: 800; letter-spacing: .03em;
		color: #0b1f13; background: #73cc8c; border-radius: 999px; padding: 6px 14px;
	}
	.gal-card:hover .gal-play, .gal-card:focus-visible .gal-play { background: #8be0a4; }

	.gal-empty {
		flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: 6px; text-align: center; padding: 40px;
	}
	.gal-empty-t { font-size: 15px; font-weight: 700; color: #cbd5e1; }
	.gal-empty-h { font-size: 12px; color: #6b7280; max-width: 340px; }
</style>
