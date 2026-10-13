<script lang="ts">
  import '../app.css'
  import Header  from '$lib/components/Header.svelte'
  import Sidebar from '$lib/components/Sidebar.svelte'
  import { page } from '$app/stores'
  import { splitLangPath } from '$lib/langs.js'
  import { afterNavigate } from '$app/navigation'

  const { children, data } = $props()

  // L'URL porte desormais la langue en tete (/fr/relay). Sans la retirer ici,
  // aucun element de la barre laterale ne serait jamais marque comme actif.
  const chemin      = $derived(splitLangPath($page.url.pathname))
  const currentSlug = $derived(chemin.slug)
  const langue      = $derived(chemin.lang)

  // Téléphone : la barre latérale restait affichée en pleine largeur (260 px) et
  // écrasait la page dans 130 px (13/10/2026). Repliée sous 900 px, ouverte par
  // ce bouton, refermée à chaque changement de page.
  let menuOuvert = $state(false)
  afterNavigate(() => { menuOuvert = false })
</script>

<div class="app">
  <Header />
  {#if $page.url.pathname === '/'}
    {@render children()}
  {:else}
    <div class="body">
      <button type="button" class="menu-mobile" aria-expanded={menuOuvert} aria-controls="doc-nav"
              onclick={() => (menuOuvert = !menuOuvert)}>
        {menuOuvert ? 'Close menu' : 'Documentation menu'}
      </button>
      <Sidebar {currentSlug} lang={langue} ouvert={menuOuvert} />
      <main class="content" id="main-content">
        {@render children()}
      </main>
    </div>
  {/if}
</div>

<style>
.app   { display: flex; flex-direction: column; min-height: 100vh; }
.body  { display: flex; flex: 1; }
.content {
  flex: 1;
  min-width: 0;
  padding: 3rem 3.5rem 5rem;
}

.menu-mobile { display: none; }

@media (max-width: 900px) {
  .body { flex-direction: column; }
  .content { padding: 2rem 1rem 4rem; }
  .menu-mobile {
    display: block;
    margin: 12px 16px 0;
    padding: 10px 14px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--bg-subtle);
    color: var(--text);
    font-size: 0.9rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
}
</style>
