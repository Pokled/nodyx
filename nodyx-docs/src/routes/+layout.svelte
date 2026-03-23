<script lang="ts">
  import '../app.css'
  import Header  from '$lib/components/Header.svelte'
  import Sidebar from '$lib/components/Sidebar.svelte'
  import { page } from '$app/stores'

  const { children, data } = $props()

  const currentSlug = $derived(
    $page.url.pathname.replace(/^\//, '') || 'readme'
  )
</script>

<div class="app">
  <Header />
  {#if $page.url.pathname === '/'}
    {@render children()}
  {:else}
    <div class="body">
      <Sidebar {currentSlug} />
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
