<script lang="ts">
  import '../app.css'
  import Header  from '$lib/components/Header.svelte'
  import Sidebar from '$lib/components/Sidebar.svelte'
  import { page } from '$app/stores'
  import { splitLangPath } from '$lib/langs.js'

  const { children, data } = $props()

  // L'URL porte desormais la langue en tete (/fr/relay). Sans la retirer ici,
  // aucun element de la barre laterale ne serait jamais marque comme actif.
  const chemin      = $derived(splitLangPath($page.url.pathname))
  const currentSlug = $derived(chemin.slug)
  const langue      = $derived(chemin.lang)
</script>

<div class="app">
  <Header />
  {#if $page.url.pathname === '/'}
    {@render children()}
  {:else}
    <div class="body">
      <Sidebar {currentSlug} lang={langue} />
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

@media (max-width: 900px) {
  .content { padding: 2rem 1.5rem 4rem; }
}
</style>
