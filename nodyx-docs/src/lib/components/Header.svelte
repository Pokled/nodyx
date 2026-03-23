<script lang="ts">
  let searchOpen = $state(false)
  let theme      = $state<'light' | 'dark'>('light')
  let results    = $state<Array<{ slug: string; title: string; excerpt: string }>>([])
  let query      = $state('')

  function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }

  function openSearch() { searchOpen = true }
  function closeSearch() { searchOpen = false }

  // Keyboard shortcut Ctrl+K / Cmd+K
  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      searchOpen = !searchOpen
    }
    if (e.key === 'Escape') closeSearch()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<header class="header">
  <div class="header-inner">
    <!-- Logo -->
    <a href="/" class="logo" aria-label="Nodyx Docs home">
      <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)"/>
        <circle cx="16" cy="16" r="5" fill="white" opacity="0.9"/>
        <circle cx="6"  cy="8"  r="2.5" fill="white" opacity="0.6"/>
        <circle cx="26" cy="8"  r="2.5" fill="white" opacity="0.6"/>
        <circle cx="6"  cy="24" r="2.5" fill="white" opacity="0.6"/>
        <circle cx="26" cy="24" r="2.5" fill="white" opacity="0.6"/>
        <line x1="6"  y1="8"  x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
        <line x1="26" y1="8"  x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
        <line x1="6"  y1="24" x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
        <line x1="26" y1="24" x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
      </svg>
      <span class="logo-text">nodyx<span class="logo-accent">.dev</span></span>
    </a>

    <!-- Search trigger -->
    <button class="search-trigger" onclick={openSearch} aria-label="Search documentation">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <span class="search-placeholder">Search documentation…</span>
      <kbd>⌘K</kbd>
    </button>

    <!-- Right actions -->
    <div class="header-actions">
      <a
        href="https://github.com/Pokled/nodyx"
        target="_blank"
        rel="noopener noreferrer"
        class="icon-btn"
        aria-label="GitHub"
        title="GitHub"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
        </svg>
      </a>

      <button class="icon-btn" onclick={toggleTheme} aria-label="Toggle theme" title="Toggle dark mode">
        {#if theme === 'light'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {/if}
      </button>

      <a href="https://nodyx.org" target="_blank" rel="noopener noreferrer" class="btn-launch">
        Launch Nodyx
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M7 17L17 7M17 7H7M17 7v10"/>
        </svg>
      </a>
    </div>
  </div>
</header>

<!-- Search modal -->
{#if searchOpen}
  <div class="search-overlay" onclick={closeSearch} role="dialog" aria-modal="true" aria-label="Search">
    <div class="search-modal" onclick={e => e.stopPropagation()}>
      <div class="search-input-wrap">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          class="search-input"
          placeholder="Search documentation…"
          autocomplete="off"
          spellcheck="false"
          autofocus
          oninput={async (e) => {
            const q = (e.target as HTMLInputElement).value.trim()
            if (q.length < 2) { results = []; return }
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
            results = await res.json()
          }}
        />
        <button class="search-close" onclick={closeSearch} aria-label="Close search">ESC</button>
      </div>
      {#if results.length > 0}
        <ul class="search-results" role="listbox">
          {#each results as r}
            <li role="option">
              <a href="/{r.slug}" class="search-result-item" onclick={closeSearch}>
                <span class="search-result-title">{r.title}</span>
                <span class="search-result-excerpt">{r.excerpt}</span>
              </a>
            </li>
          {/each}
        </ul>
      {:else if query.length >= 2}
        <div class="search-empty">No results for "{query}"</div>
      {/if}
    </div>
  </div>
{/if}


<style>
.header {
  position: sticky;
  top: 0;
  z-index: 50;
  height: var(--header-height);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(8px);
  background: color-mix(in srgb, var(--bg) 90%, transparent);
}

.header-inner {
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 100%;
  padding: 0 1.5rem;
  max-width: 100%;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  text-decoration: none;
  flex-shrink: 0;
}

.logo-text {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}

.logo-accent { color: var(--accent); }

.search-trigger {
  flex: 1;
  max-width: 360px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.45rem 0.75rem;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.82rem;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-trigger:hover {
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.search-placeholder { flex: 1; text-align: left; }

kbd {
  font-size: 0.68rem;
  font-family: var(--font-mono);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.4em;
  color: var(--text-muted);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
  flex-shrink: 0;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.12s, background 0.12s;
}

.icon-btn:hover { color: var(--text); background: var(--bg-hover); }

.btn-launch {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.9rem;
  background: var(--accent);
  color: #fff;
  border-radius: 7px;
  font-size: 0.8rem;
  font-weight: 600;
  text-decoration: none;
  transition: opacity 0.12s, transform 0.12s;
  margin-left: 0.25rem;
}

.btn-launch:hover { opacity: 0.88; transform: translateY(-1px); }

/* Search modal */
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.search-modal {
  width: 100%;
  max-width: 560px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,0.2);
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.95rem;
  color: var(--text);
}

.search-close {
  font-size: 0.65rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.2em 0.5em;
  color: var(--text-muted);
  cursor: pointer;
}

.search-results { list-style: none; margin: 0; padding: 0.5rem; max-height: 360px; overflow-y: auto; }

.search-result-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  text-decoration: none;
  transition: background 0.1s;
}

.search-result-item:hover { background: var(--bg-hover); }

.search-result-title  { font-size: 0.875rem; font-weight: 500; color: var(--text); }
.search-result-excerpt { font-size: 0.78rem; color: var(--text-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

.search-empty { padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
</style>
