<script lang="ts">
  import { nav, type NavSection, type NavItem } from '../nav.js'
  import { page } from '$app/stores'

  const { currentSlug }: { currentSlug: string } = $props()

  function isActive(item: NavItem) {
    return item.slug === currentSlug
  }
</script>

<nav class="sidebar" aria-label="Documentation">
  <div class="sidebar-inner">
    {#each nav as section}
      <div class="nav-section">
        <div class="nav-section-title">
          {section.title}
        </div>
        <ul class="nav-list">
          {#each section.items as item}
            <li>
              <a
                href="/{item.slug}"
                class="nav-item"
                class:active={isActive(item)}
                aria-current={isActive(item) ? 'page' : undefined}
              >
                {item.title}
                {#if item.badge}
                  <span class="badge">{item.badge}</span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</nav>

<style>
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-subtle);
  position: sticky;
  top: var(--header-height);
  height: calc(100vh - var(--header-height));
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-inner {
  padding: 1.5rem 0 3rem;
}

.nav-section {
  margin-bottom: 1.5rem;
}

.nav-section-title {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 0 1.25rem;
  margin-bottom: 0.35rem;
}

.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 1.25rem;
  font-size: 0.825rem;
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: 0;
  transition: color 0.12s, background 0.12s;
  line-height: 1.5;
  border-left: 2px solid transparent;
  margin-left: -1px;
}

.nav-item:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.nav-item.active {
  color: var(--accent);
  font-weight: 500;
  border-left-color: var(--accent);
  background: var(--accent-subtle);
}

.badge {
  font-size: 0.6rem;
  font-weight: 600;
  padding: 0.1em 0.45em;
  border-radius: 999px;
  background: var(--accent-subtle);
  color: var(--accent);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Scrollbar */
.sidebar::-webkit-scrollbar       { width: 4px }
.sidebar::-webkit-scrollbar-track  { background: transparent }
.sidebar::-webkit-scrollbar-thumb  { background: var(--border); border-radius: 2px }
</style>
