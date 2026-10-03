<script lang="ts">
	import { editZone } from '$lib/actions/editZone';
	import { t } from '$lib/i18n';
	import { activeCommunityNameStore } from '$lib/communityStore';

	const tFn = $derived($t);
	const activeCommunityName = $derived($activeCommunityNameStore);

	function instanceOnline(last_seen: string | null | undefined): boolean {
		if (!last_seen) return false;
		return Date.now() - new Date(last_seen).getTime() < 5 * 60 * 1000;
	}

	interface NetworkInstance {
		url: string; name: string; logo_url?: string | null; last_seen?: string | null;
	}

	let {
		isBanned,
		communityName,
		communityLogo,
		panelCollapsed = $bindable(),
		networkInstances,
	}: {
		isBanned: boolean;
		communityName: string;
		communityLogo: string | null;
		panelCollapsed: boolean;
		networkInstances: NetworkInstance[];
	} = $props();

	// Fédération : au survol d'une instance du réseau, le logo de l'instance
	// courante répond par un pouls synchronisé. Pas un effet gratuit — ça
	// visualise le protocole réel (les deux instances se connaissent et
	// échangent leur présence, cf. `instanceOnline`), donc ça ne s'affiche
	// que pour une instance effectivement en ligne.
	let pulsingHome = $state(false);
</script>

{#if !isBanned}
<div class="nodyx-sb">
<aside class="rail nx-plate" data-nx-zone="rail" use:editZone={{ zone: 'logo', label: tFn('edit.zone_logo') }}>
	<div class="nx-zone-img" aria-hidden="true"></div>
	<div class="scroll">
		<!-- Current instance (logo) — click toggles panel open -->
		<button type="button" class="icon logo {!activeCommunityName ? 'active' : ''} {pulsingHome ? 'pulse' : ''}" data-tip={communityName} title={communityName} onclick={() => {
			if (activeCommunityName) {
				activeCommunityNameStore.set(null);
				panelCollapsed = false;
			} else {
				panelCollapsed = !panelCollapsed;
			}
		}}>
			{#if communityLogo}
				<img src={communityLogo} alt={tFn('common.logo_alt')} class="w-full h-full object-cover" />
			{:else}
				{communityName.charAt(0).toUpperCase()}
			{/if}
		</button>

		{#if networkInstances.length > 0}
		<div class="rail-sep"></div>
		{/if}

		<!-- Network instances -->
		{#each networkInstances as inst}
			<!-- Decentralized: each instance is its own deployment (own design + data). -->
			<!-- Clicking simply opens that instance's site; we never render a remote instance in place. -->
			<a href={inst.url} target="_blank" rel="noopener noreferrer" class="icon net {instanceOnline(inst.last_seen) ? 'linked' : ''}" data-tip={inst.name} title={inst.name}
			   onmouseenter={() => { if (instanceOnline(inst.last_seen)) pulsingHome = true; }}
			   onmouseleave={() => pulsingHome = false}
			   onfocus={() => { if (instanceOnline(inst.last_seen)) pulsingHome = true; }}
			   onblur={() => pulsingHome = false}>
				{#if inst.logo_url}
					<img src={inst.logo_url.startsWith('http') ? inst.logo_url : inst.url.replace(/\/$/, '') + inst.logo_url}
					     alt={inst.name} class="w-full h-full object-cover" />
				{:else}
					{inst.name.charAt(0).toUpperCase()}
				{/if}
				<span class="dot {!instanceOnline(inst.last_seen) ? 'off' : 'on'}"></span>
			</a>
		{/each}

		<!-- Add / discover -->
		<a href="/communities" class="icon add" data-tip={tFn('nav.discover_title')} title={tFn('nav.discover_title')}>+</a>
	</div>

	<!-- Docs: pinned at bottom -->
	<a href="https://nodyx.dev" target="_blank" rel="noopener" class="icon docs" data-tip={tFn('nav.docs')} title={tFn('nav.documentation')}>
		<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
		</svg>
	</a>
</aside>
</div>
{/if}

<style>
	/* ── Sketch 001: Discord two-tier sidebar — exact sketch CSS, scoped ────── */
	/* Sur mobile le rail et le panneau forment un TIROIR qui recouvre la page.
	   Les 48px reserves a la barre du haut y sont une bande morte : le tiroir a
	   sa propre croix de fermeture, il n'a pas besoin de laisser voir la barre.
	   Au-dessus de lg ils redeviennent des colonnes, sous la barre. */
	/* 28/09 : capsule flottante en verre (.nx-plate, app.css), décollée des
	   bords par --shell-gap. Les icônes deviennent des squircles de 40px qui
	   se creusent au survol, et le logo de l'instance courante porte un anneau
	   lumineux : c'est « là où on est », visible sans rien lire. */
	.nodyx-sb .rail {
	  position: fixed; top: var(--shell-gap); bottom: var(--shell-gap); left: var(--shell-gap);
	  width: var(--shell-rail-w);
	  display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 6px; z-index: 40;
	}
	@media (max-width: 1023px) {
	  .nodyx-sb .rail { background: var(--nx-bg); border-right: 1px solid var(--nx-border); }
	}
	.nodyx-sb .rail .scroll {
	  flex: 1; overflow-y: auto; width: 100%; display: flex; flex-direction: column;
	  align-items: center; gap: 4px; padding: 4px 0; scrollbar-width: none;
	}
	.nodyx-sb .rail .scroll::-webkit-scrollbar { display: none; }
	.nodyx-sb .rail .rail-sep { width: 24px; height: 2px; border-radius: 2px; background: var(--nx-border); margin: 6px 0; }
	.nodyx-sb .rail .icon {
	  width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0; cursor: pointer;
	  display: flex; align-items: center; justify-content: center; position: relative;
	  transition: transform .35s var(--ease-spring), border-radius .25s var(--ease-out-soft),
	              background-color .15s, border-color .15s, color .15s, box-shadow .25s var(--ease-out-soft);
	  font-weight: 700; font-size: 13px; font-family: var(--font-shell-rounded);
	  text-decoration: none;
	}
	@supports (corner-shape: squircle) {
	  .nodyx-sb .rail .icon { corner-shape: squircle; border-radius: 20px; }
	}
	.nodyx-sb .rail .icon img { border-radius: inherit; }
	@supports (corner-shape: squircle) {
	  .nodyx-sb .rail .icon img { corner-shape: squircle; }
	}
	.nodyx-sb .rail .icon:hover { transform: translateY(-1px) scale(1.06); }
	.nodyx-sb .rail .icon:active { transform: scale(0.94); transition-duration: .1s; }
	.nodyx-sb .rail .icon.logo {
	  background: var(--nx-header-accent); color: var(--nx-on-accent);
	  box-shadow: 0 0 0 2px var(--nx-glass), 0 0 0 4px var(--nx-header-accent), 0 6px 18px -4px color-mix(in srgb, var(--nx-header-accent) 60%, transparent);
	}
	.nodyx-sb .rail .icon.net { background: var(--nx-surface-raised); color: var(--nx-text-muted); border: 1px solid var(--nx-border); }
	.nodyx-sb .rail .icon.net:hover { background: var(--nx-surface); }
	.nodyx-sb .rail .icon.net.active { background: var(--nx-surface); color: var(--nx-text); border-color: var(--nx-border-soft); }
	.nodyx-sb .rail .icon.net.linked:hover { border-color: var(--nx-header-accent); }
	.nodyx-sb .rail .icon .dot {
	  position: absolute; bottom: 2px; right: 2px; width: 8px; height: 8px;
	  border-radius: 999px; border: 2px solid var(--nx-surface);
	}
	.nodyx-sb .rail .icon .dot.on { background: #22c55e; }
	.nodyx-sb .rail .icon .dot.off { background: var(--nx-text-faint); }
	.nodyx-sb .rail .icon.add { background: transparent; border: 1px dashed var(--nx-border); color: var(--nx-text-faint); font-size: 15px; font-weight: 300; }
	.nodyx-sb .rail .icon.add:hover { border-color: var(--nx-header-accent); color: var(--nx-header-accent); }
	.nodyx-sb .rail .icon.docs { background: transparent; color: var(--nx-text-faint); border: none; margin-top: auto; }
	.nodyx-sb .rail .icon.docs:hover { background: var(--nx-surface-raised); color: var(--nx-header-accent); }

	/* ── Pouls de fédération ──────────────────────────────────────────────────
	   Au survol d'une instance du réseau EN LIGNE, un anneau part du logo de
	   l'instance courante — ça visualise la connexion réelle entre les deux
	   (présence échangée via `last_seen`), pas une animation décorative.
	   transform + opacity uniquement (compositing GPU), jamais en boucle sans
	   déclencheur, et coupé net si l'utilisateur a demandé moins de mouvement. */
	.nodyx-sb .rail .icon.logo { position: relative; }
	.nodyx-sb .rail .icon.logo::after {
	  content: ''; position: absolute; inset: -3px; border-radius: inherit;
	  border: 2px solid var(--nx-header-accent);
	  opacity: 0; transform: scale(0.85); pointer-events: none;
	}
	.nodyx-sb .rail .icon.logo.pulse::after {
	  animation: nx-federation-pulse 900ms cubic-bezier(0.32, 0.72, 0, 1) infinite;
	}
	@keyframes nx-federation-pulse {
	  0%   { opacity: 0.65; transform: scale(0.85); }
	  70%  { opacity: 0;    transform: scale(1.35); }
	  100% { opacity: 0;    transform: scale(1.35); }
	}
	@media (prefers-reduced-motion: reduce) {
	  .nodyx-sb .rail .icon.logo.pulse::after { animation: none; opacity: 0.7; transform: scale(1.1); }
	}

	/* Mobile drawer overrides — copié de +layout.svelte : sous lg le rail
	   disparaît complètement, le panneau de canaux devient LE tiroir plein
	   écran (cf ChannelSidebar.svelte). Manquait depuis l'extraction de ce
	   composant : sans cette règle le rail restait visible ET superposé au
	   tiroir mobile — régression retrouvée le 20/09 en vérifiant la vraie
	   règle d'origine avant l'extraction du panneau de canaux. */
	@media (max-width: 1023px) {
	  .nodyx-sb .rail { display: none; }
	}
</style>
