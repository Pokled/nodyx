<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount, tick } from 'svelte'
  import { browser } from '$app/environment'
  import { t } from '$lib/i18n'

  const tFn = $derived($t)

  interface Props {
    open: boolean
    user: any
    token: string | null
    onClose: () => void
  }

  let { open, user, token, onClose }: Props = $props()

  interface Command {
    id: string
    group: string
    label: string
    sub?: string
    paths: string[]
    action: () => void
    keywords?: string[]
  }

  let query       = $state('')
  let activeIndex = $state(0)
  let inputEl: HTMLInputElement | null = $state(null)
  let categories  = $state<{ slug: string; name: string }[]>([])
  let listEl: HTMLElement | null = $state(null)

  // Fetch categories once on mount
  onMount(async () => {
    if (!browser) return
    try {
      const r = await fetch('/api/v1/forums/categories')
      if (r.ok) {
        const d = await r.json()
        categories = (d.categories ?? []).map((c: any) => ({
          slug: c.slug ?? c.id,
          name: c.name,
        }))
      }
    } catch { /* ignore */ }
  })

  // Focus + reset when palette opens
  $effect(() => {
    if (open) {
      tick().then(() => inputEl?.focus())
      query = ''
      activeIndex = 0
    }
  })

  function close() { onClose() }

  function navigate(path: string) {
    close()
    goto(path)
  }

  // ── SVG icon path definitions ─────────────────────────────────────────────
  const ICONS = {
    home:   ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
    forum:  ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    chat:   ['M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'],
    user:   ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    bell:   ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
    plus:   ['M12 5v14', 'M5 12h14'],
    gear:   ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'],
    book:   ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
    users:  ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M16 3.13a4 4 0 0 1 0 7.75'],
    search: ['circle cx="11" cy="11" r="8"', 'M21 21l-4.35-4.35'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    dm:     ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    discover: ['M21 10.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l2.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'],
  } satisfies Record<string, string[]>

  // ── Static commands ───────────────────────────────────────────────────────
  const staticCommands = $derived((() => {
    const cmds: Command[] = [
      { id: 'home',   group: 'GO TO',  label: tFn('nav.home'),        sub: '/',                paths: ICONS.home,    action: () => navigate('/'),               keywords: ['home', 'accueil', 'index'] },
      { id: 'forum',  group: 'GO TO',  label: tFn('nav.forum'),          sub: '/forum',           paths: ICONS.forum,   action: () => navigate('/forum'),          keywords: ['forum', 'discussion', 'threads'] },
      { id: 'chat',   group: 'GO TO',  label: tFn('nav.chat'), sub: '/chat',            paths: ICONS.chat,    action: () => navigate('/chat'),           keywords: ['chat', 'live', 'messages', 'channel'] },
      { id: 'discover', group: 'GO TO', label: tFn('nav.discover'),     sub: '/discover',        paths: ICONS.discover, action: () => navigate('/discover'),      keywords: ['discover', 'instances', 'réseau', 'network'] },
    ]

    if (user) {
      cmds.push(
        { id: 'profile',       group: 'GO TO',    label: tFn('nav.my_profile'),          sub: `/users/${user.username}`, paths: ICONS.user,    action: () => navigate(`/users/${user.username}`), keywords: ['profile', 'profil', 'compte', user.username] },
        { id: 'notifications', group: 'GO TO',    label: tFn('nav.notifications'),       sub: '/notifications',          paths: ICONS.bell,    action: () => navigate('/notifications'),          keywords: ['notif', 'notifications', 'alertes'] },
        { id: 'dm',            group: 'GO TO',    label: tFn('nav.direct_messages'),     sub: '/dm',                     paths: ICONS.dm,      action: () => navigate('/dm'),                    keywords: ['dm', 'message', 'privé', 'direct'] },
        { id: 'new-thread',    group: 'ACTIONS',  label: tFn('nav.new_thread'),       sub: 'Créer une discussion',    paths: ICONS.plus,    action: () => navigate('/forum'),                 keywords: ['new', 'thread', 'sujet', 'créer', 'post', 'nouveau'] },
        { id: 'settings',      group: 'ACTIONS',  label: tFn('nav.account_settings'), sub: '/settings',             paths: ICONS.gear,    action: () => navigate('/settings'),              keywords: ['settings', 'paramètres', 'compte', 'config'] },
      )
    }

    if (user?.role === 'admin' || user?.role === 'owner') {
      cmds.push(
        { id: 'admin', group: 'GO TO', label: tFn('nav.admin'), sub: '/admin', paths: ICONS.shield, action: () => navigate('/admin'), keywords: ['admin', 'administration', 'panel', 'modération'] },
      )
    }

    if (user) {
      cmds.push(
        { id: 'members', group: 'GO TO', label: tFn('nav.members'), sub: '/users', paths: ICONS.users, action: () => navigate('/users'), keywords: ['membres', 'users', 'communauté'] },
      )
    }

    return cmds
  })())

  // ── Category commands ─────────────────────────────────────────────────────
  const categoryCommands = $derived(
    categories.map(c => ({
      id:       `cat-${c.slug}`,
      group:    'FORUM',
      label:    c.name.replace(/^\p{Emoji}\s*/u, ''),
      sub:      `/forum/${c.slug}`,
      paths:    ICONS.book,
      action:   () => navigate(`/forum/${c.slug}`),
      keywords: [c.name.toLowerCase(), c.slug],
    } as Command))
  )

  const allCommands = $derived([...staticCommands, ...categoryCommands])

  // ── Fuzzy scoring ─────────────────────────────────────────────────────────
  function score(cmd: Command, q: string): number {
    if (!q) return 1
    const haystack = [cmd.label, cmd.sub ?? '', ...(cmd.keywords ?? [])].join(' ').toLowerCase()
    const needle   = q.toLowerCase().trim()
    // Exact substring — highest priority
    if (haystack.includes(needle)) return 2 + needle.length / haystack.length
    // Subsequence matching
    let hi = 0, ni = 0, consecutive = 0, score = 0
    while (hi < haystack.length && ni < needle.length) {
      if (haystack[hi] === needle[ni]) {
        consecutive++
        score += consecutive
        ni++
      } else {
        consecutive = 0
      }
      hi++
    }
    if (ni < needle.length) return 0
    return score / (haystack.length * 2)
  }

  type GroupRow   = { type: 'group'; label: string }
  type ItemRow    = { type: 'item';  cmd: Command; index: number }
  type ResultRow  = GroupRow | ItemRow

  const filtered = $derived((() => {
    const q = query.trim()
    const GROUP_ORDER = ['GO TO', 'FORUM', 'ACTIONS'] as const

    // Score & filter
    const scored = allCommands
      .map(cmd => ({ cmd, s: score(cmd, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)

    // Bucket by group (preserving GROUP_ORDER)
    const buckets = new Map<string, Command[]>(GROUP_ORDER.map(g => [g, []]))
    for (const { cmd } of scored) {
      if (!buckets.has(cmd.group)) buckets.set(cmd.group, [])
      buckets.get(cmd.group)!.push(cmd)
    }

    const result: ResultRow[] = []
    let idx = 0
    for (const g of GROUP_ORDER) {
      const items = buckets.get(g) ?? []
      if (items.length === 0) continue
      result.push({ type: 'group', label: g })
      for (const cmd of items) result.push({ type: 'item', cmd, index: idx++ })
    }

    return { result, total: idx }
  })())

  // ── Keyboard handler ──────────────────────────────────────────────────────
  function onKeydown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape')    { e.preventDefault(); close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % Math.max(1, filtered.total); scrollActive(); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); activeIndex = (activeIndex - 1 + Math.max(1, filtered.total)) % Math.max(1, filtered.total); scrollActive(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const active = filtered.result.find((r): r is ItemRow => r.type === 'item' && r.index === activeIndex)
      if (active) active.cmd.action()
    }
  }

  function scrollActive() {
    if (!listEl) return
    const el = listEl.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }

  // Reset active index on query change
  $effect(() => { query; activeIndex = 0 })
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="kp-overlay"
    onclick={(e) => { if (e.target === e.currentTarget) close() }}
  >
    <div
      class="kp-palette"
      role="dialog"
      aria-modal="true"
      aria-label={tFn('command_palette.label')}
    >
      <!-- Search input -->
      <div class="kp-input-row">
        <svg class="kp-search-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          placeholder={tFn('command_palette.search_placeholder')}
          class="kp-input"
          autocomplete="off"
          spellcheck="false"
          aria-autocomplete="list"
        />
        <div class="kp-trigger-hint">
          <kbd>⌘</kbd><kbd>K</kbd>
        </div>
      </div>

      <!-- Results list -->
      <div class="kp-results" bind:this={listEl} role="listbox">
        {#if filtered.total === 0}
          <div class="kp-empty">
            {tFn('command_palette.no_results', { query })}
          </div>
        {:else}
          {#each filtered.result as row (row.type === 'group' ? 'g-' + row.label : row.cmd.id)}
            {#if row.type === 'group'}
              <div class="kp-group">{row.label}</div>
            {:else}
              {@const isActive = row.index === activeIndex}
              <button
                class="kp-item"
                class:kp-item--active={isActive}
                data-active={isActive}
                role="option"
                aria-selected={isActive}
                onclick={() => row.cmd.action()}
                onmouseenter={() => activeIndex = row.index}
              >
                <svg class="kp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                  {#each row.cmd.paths as d}
                    {#if d.startsWith('circle')}
                      {@html `<${d}/>`}
                    {:else}
                      <path d={d} stroke-linecap="round" stroke-linejoin="round"/>
                    {/if}
                  {/each}
                </svg>
                <span class="kp-label">{row.cmd.label}</span>
                {#if row.cmd.sub}
                  <span class="kp-sub">{row.cmd.sub}</span>
                {/if}
              </button>
            {/if}
          {/each}
        {/if}
      </div>

      <!-- Footer hints -->
      <div class="kp-footer">
        <span class="kp-hint"><kbd>↑</kbd><kbd>↓</kbd> {tFn('command_palette.navigate_hint')}</span>
        <span class="kp-hint"><kbd>↩</kbd> {tFn('command_palette.open_hint')}</span>
        <span class="kp-hint"><kbd>Esc</kbd> {tFn('command_palette.close_hint')}</span>
        <span class="kp-hint kp-hint--right">
          {tFn(filtered.total !== 1 ? 'command_palette.results_count_plural' : 'command_palette.results_count', { n: String(filtered.total) })}
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
/* ── Overlay ─────────────────────────────────────────────────────────────── */
.kp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 9998;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
}

/* ── Palette shell ───────────────────────────────────────────────────────── */
.kp-palette {
  width: min(600px, calc(100vw - 2rem));
  background: #0b0b0f;
  border: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow:
    0 0 0 1px rgba(99, 102, 241, 0.05),
    0 24px 60px rgba(0, 0, 0, 0.85),
    0 4px 16px rgba(0, 0, 0, 0.5);
  animation: kp-in 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
  overflow: hidden;
}

@keyframes kp-in {
  from { opacity: 0; transform: scale(0.96) translateY(-12px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}

/* ── Input row ───────────────────────────────────────────────────────────── */
.kp-input-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.055);
}

.kp-search-ico {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.28);
}

.kp-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.9375rem;
  font-family: inherit;
  line-height: 1;
  caret-color: rgb(99, 102, 241);
  min-width: 0;
}

.kp-input::placeholder {
  color: rgba(255, 255, 255, 0.2);
}

/* Trigger hint pill */
.kp-trigger-hint {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.kp-trigger-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 0.3rem;
  font-size: 0.65rem;
  font-family: ui-monospace, 'SF Mono', monospace;
  color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

/* ── Results ─────────────────────────────────────────────────────────────── */
.kp-results {
  max-height: 400px;
  overflow-y: auto;
  padding: 0.375rem 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.07) transparent;
}

.kp-group {
  padding: 0.55rem 1rem 0.2rem;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.18);
  font-family: ui-monospace, 'SF Mono', monospace;
}

/* ── Item ────────────────────────────────────────────────────────────────── */
.kp-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.5rem 1rem;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  text-align: left;
  color: rgba(255, 255, 255, 0.62);
  transition: background 70ms, border-color 70ms, color 70ms;
}

.kp-item--active {
  background: rgba(99, 102, 241, 0.07);
  border-left-color: rgb(99, 102, 241);
  color: rgba(255, 255, 255, 0.92);
}

.kp-icon {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.24);
  transition: color 70ms;
}

.kp-item--active .kp-icon {
  color: rgba(99, 102, 241, 0.9);
}

.kp-label {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 450;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.kp-sub {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.2);
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 70ms;
}

.kp-item--active .kp-sub {
  color: rgba(99, 102, 241, 0.5);
}

/* ── Empty ───────────────────────────────────────────────────────────────── */
.kp-empty {
  padding: 2.5rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.2);
}


/* ── Footer ──────────────────────────────────────────────────────────────── */
.kp-footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.45rem 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.045);
}

.kp-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.18);
  font-family: ui-monospace, 'SF Mono', monospace;
}

.kp-hint--right {
  margin-left: auto;
  font-family: inherit;
  font-size: 0.68rem;
}

.kp-hint kbd {
  font-size: 0.62rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  padding: 0.05rem 0.3rem;
  color: rgba(255, 255, 255, 0.22);
  font-family: ui-monospace, 'SF Mono', monospace;
}
</style>
