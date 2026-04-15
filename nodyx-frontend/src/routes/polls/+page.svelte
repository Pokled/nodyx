<script lang="ts">
  import { page } from '$app/stores'
  import { goto } from '$app/navigation'
  import { fly, fade } from 'svelte/transition'
  import PollCard     from '$lib/components/PollCard.svelte'
  import PollCreator  from '$lib/components/PollCreator.svelte'

  let { data } = $props()

  let polls       = $state(untrack(() => data.polls ?? []))
  let status      = $state(untrack(() => data.status ?? 'active'))
  let showCreator = $state(false)
  let socket      = $state<any>(null)

  // Connect socket for real-time updates
  import { onMount, untrack } from 'svelte'
  import { tokenStore } from '$lib/socket'

  onMount(async () => {
    const { getSocket } = await import('$lib/socket')
    socket = await getSocket()
  })

  async function reload() {
    const params = new URLSearchParams({ status, offset: '0' })
    const res    = await fetch(`/api/v1/polls?${params}`, {
      headers: { Authorization: `Bearer ${data.token}` },
    })
    if (res.ok) {
      const json = await res.json()
      polls = json.polls
    }
  }

  function changeStatus(s: string) {
    status = s
    goto(`/polls?status=${s}`, { replaceState: true })
    reload()
  }

  const TYPE_ICON: Record<string, string> = {
    choice: '📊', schedule: '📅', ranking: '🏆',
  }

  function formatDate(iso: string) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  }

  function timeLeft(iso: string | null): string | null {
    if (!iso) return null
    const diff = new Date(iso).getTime() - Date.now()
    if (diff <= 0) return 'Expiré'
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (h > 48) return `${Math.floor(h / 24)}j`
    if (h > 0)  return `${h}h ${m}m`
    return `${m}m`
  }
</script>

<svelte:head>
  <title>Sondages — Nodyx</title>
</svelte:head>

<div class="polls-page">

  <!-- ── Header ──────────────────────────────────────────────────────────────── -->
  <div class="page-header">
    <div class="page-title-row">
      <h1>📊 Sondages</h1>
      {#if data.token}
        <button class="btn-new" onclick={() => showCreator = true}>
          + Nouveau sondage
        </button>
      {/if}
    </div>

    <!-- Filtres -->
    <div class="filter-tabs">
      {#each [['active', 'En cours'], ['closed', 'Terminés'], ['', 'Tous']] as [val, label]}
        <button
          class="filter-tab"
          class:active={status === val}
          onclick={() => changeStatus(val as string)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  <!-- ── Liste des sondages ──────────────────────────────────────────────────── -->
  {#if polls.length === 0}
    <div class="empty-state" in:fade>
      <span class="empty-icon">📭</span>
      <p>Aucun sondage {status === 'active' ? 'en cours' : status === 'closed' ? 'terminé' : ''}.</p>
      {#if data.token && status !== 'closed'}
        <button class="btn-new-empty" onclick={() => showCreator = true}>
          Créer le premier sondage
        </button>
      {/if}
    </div>

  {:else}
    <div class="polls-grid">
      {#each polls as poll (poll.id)}
        <div class="poll-list-item" in:fly={{ y: 12, duration: 200 }}>
          <!-- Carte résumé -->
          <div class="poll-summary">
            <div class="poll-summary-header">
              <span class="ptype-badge">{TYPE_ICON[poll.type]} {poll.type}</span>
              {#if poll.is_open}
                <span class="status-dot open"></span>
                {#if poll.closes_at}
                  <span class="closes-in">⏱ {timeLeft(poll.closes_at)}</span>
                {/if}
              {:else}
                <span class="status-dot closed"></span>
                <span class="closed-label">Terminé</span>
              {/if}
              {#if poll.has_voted}
                <span class="voted-badge">✓ Voté</span>
              {/if}
            </div>

            <h3 class="poll-summary-title">{poll.title}</h3>

            <div class="poll-summary-meta">
              <span>{poll.participant_count} participant{poll.participant_count !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>{poll.option_count} option{poll.option_count !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>{formatDate(poll.created_at)}</span>
            </div>

            {#if poll.channel_name}
              <span class="channel-badge"># {poll.channel_name}</span>
            {/if}
          </div>

          <!-- PollCard inline expandable -->
          {#if poll.is_open || poll.has_voted}
            <div class="poll-expand-area">
              <PollCard pollId={poll.id} inline={true} token={data.token} {socket} />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ── Créateur ── -->
{#if showCreator}
  <PollCreator
    token={data.token}
    channelId={null}
    onCreated={poll => { polls = [{ ...poll, is_open: true, has_voted: false, option_count: 0, participant_count: 0 }, ...polls]; showCreator = false }}
    onClose={() => showCreator = false}
  />
{/if}

<style>
  .polls-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* ── Header ── */
  .page-header { display: flex; flex-direction: column; gap: 14px; }
  .page-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h1 { margin: 0; font-size: 1.4rem; font-weight: 800; }

  .btn-new {
    padding: 8px 18px;
    background: #7c3aed;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
    transition: opacity .15s;
    white-space: nowrap;
  }
  .btn-new:hover { opacity: 0.85; }

  /* ── Tabs ── */
  .filter-tabs { display: flex; gap: 4px; }
  .filter-tab {
    padding: 6px 16px;
    background: transparent;
    border: 1px solid var(--border, #333);
    border-radius: 99px;
    color: var(--text-muted, #888);
    font-size: 0.82rem;
    cursor: pointer;
    transition: border-color .15s, color .15s, background .15s;
  }
  .filter-tab:hover { border-color: #7c3aed88; color: var(--text, #e0e0e0); }
  .filter-tab.active { border-color: #7c3aed; color: #a78bfa; background: #7c3aed18; }

  /* ── Empty ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px 24px;
    text-align: center;
    color: var(--text-muted, #888);
  }
  .empty-icon { font-size: 2.4rem; }
  .btn-new-empty {
    padding: 8px 20px;
    background: #7c3aed22;
    border: 1px solid #7c3aed44;
    border-radius: 8px;
    color: #a78bfa;
    cursor: pointer;
    font-weight: 600;
    transition: background .15s;
  }
  .btn-new-empty:hover { background: #7c3aed33; }

  /* ── Grid ── */
  .polls-grid { display: flex; flex-direction: column; gap: 16px; }

  .poll-list-item {
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border, #333);
    border-radius: 12px;
    overflow: hidden;
    transition: border-color .15s;
  }
  .poll-list-item:hover { border-color: #7c3aed44; }

  .poll-summary {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .poll-summary-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ptype-badge {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 99px;
    background: #7c3aed22;
    color: #a78bfa;
    border: 1px solid #7c3aed44;
    font-weight: 600;
    text-transform: capitalize;
  }
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.open   { background: #4ade80; box-shadow: 0 0 6px #4ade8088; }
  .status-dot.closed { background: #64748b; }
  .closes-in  { font-size: 0.72rem; color: #fbbf24; }
  .closed-label { font-size: 0.72rem; color: var(--text-muted, #888); }
  .voted-badge {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 99px;
    background: #16a34a22;
    color: #4ade80;
    border: 1px solid #16a34a44;
    font-weight: 600;
    margin-left: auto;
  }
  .poll-summary-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }
  .poll-summary-meta {
    display: flex;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--text-muted, #888);
  }
  .channel-badge {
    display: inline-block;
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--bg-3, #252535);
    color: var(--text-muted, #888);
    border: 1px solid var(--border, #333);
  }

  .poll-expand-area {
    border-top: 1px solid var(--border, #333);
    padding: 16px;
    background: var(--bg-1, #16161e);
  }

  @media (max-width: 480px) {
    .page-title-row { flex-direction: column; align-items: flex-start; }
    .btn-new { width: 100%; text-align: center; }
  }
</style>
