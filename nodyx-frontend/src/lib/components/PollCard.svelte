<script lang="ts">
	import { t } from '$lib/i18n'

	const tFn = $derived($t)
  import { onMount, onDestroy } from 'svelte'
  import { page } from '$app/stores'
  import { fly, fade } from 'svelte/transition'
  import { flip } from 'svelte/animate'

  // ── Props ────────────────────────────────────────────────────────────────────

  interface PollOption {
    id:          string
    label:       string
    description: string | null
    image_url:   string | null
    date_start:  string | null
    date_end:    string | null
    position:    number
    // choice
    vote_count?: number
    percentage?: number
    voters?:     Array<{ id: string; username: string; avatar: string | null }>
    // schedule
    yes_count?:  number
    maybe_count?: number
    no_count?:   number
    // ranking
    score?:      number
    avg_rank?:   number | null
  }

  interface Poll {
    id:                string
    title:             string
    description:       string | null
    type:              'choice' | 'schedule' | 'ranking'
    multiple:          boolean
    max_choices:       number | null
    anonymous:         boolean
    show_results:      boolean
    is_open:           boolean
    closes_at:         string | null
    closed_at:         string | null
    creator_username:  string
    creator_avatar:    string | null
    participant_count: number
    user_votes:        Array<{ option_id: string; value: number }>
    results:           PollOption[] | null
    created_by?:       string
  }

  let { pollId, inline = true, token, socket }: {
    pollId: string
    inline?: boolean
    token:   string | null
    socket:  any
  } = $props()

  // ── State ────────────────────────────────────────────────────────────────────

  let poll     = $state<Poll | null>(null)
  let loading  = $state(true)
  let error    = $state<string | null>(null)
  let voting   = $state(false)
  let expanded = $state(!inline)  // inline = collapsed by default

  // Sélections locales (avant envoi)
  let selectedIds     = $state<Set<string>>(new Set())
  let scheduleVotes   = $state<Record<string, number>>({})  // optionId → 0/1/2
  let rankingOrder    = $state<string[]>([])  // ordered list of option ids
  let draggingId      = $state<string | null>(null)

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async function loadPoll() {
    loading = true
    error   = null
    try {
      const res  = await fetch(`/api/v1/polls/${pollId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) { error = data.error ?? tFn('common.error'); return }
      poll = data.poll

      // Initialiser les sélections depuis user_votes
      if (poll!.user_votes.length > 0) {
        if (poll!.type === 'choice') {
          selectedIds = new Set(poll!.user_votes.map(v => v.option_id))
        } else if (poll!.type === 'schedule') {
          const m: Record<string, number> = {}
          for (const v of poll!.user_votes) m[v.option_id] = v.value
          scheduleVotes = m
        } else if (poll!.type === 'ranking') {
          // Trier par value (position) croissant
          const sorted = [...poll!.user_votes].sort((a, b) => a.value - b.value)
          rankingOrder = sorted.map(v => v.option_id)
        }
      } else if (poll!.type === 'ranking' && poll!.results) {
        // Ordre initial = position dans les résultats
        rankingOrder = poll!.results.map(o => o.id)
      }
    } finally {
      loading = false
    }
  }

  onMount(() => {
    loadPoll()

    // Socket.IO — mise à jour en temps réel
    if (socket) {
      socket.on('poll:updated', onPollUpdated)
      socket.on('poll:closed',  onPollClosed)
    }
  })

  onDestroy(() => {
    if (socket) {
      socket.off('poll:updated', onPollUpdated)
      socket.off('poll:closed',  onPollClosed)
    }
  })

  function onPollUpdated(data: { poll_id: string; results: PollOption[]; participant_count: number }) {
    if (data.poll_id !== pollId || !poll) return
    poll = { ...poll, results: data.results, participant_count: data.participant_count }
  }

  function onPollClosed(data: { poll_id: string }) {
    if (data.poll_id !== pollId || !poll) return
    poll = { ...poll, is_open: false, closed_at: new Date().toISOString() }
  }

  // ── Vote — choice ────────────────────────────────────────────────────────────

  function toggleChoice(optId: string) {
    if (!poll || !poll.is_open) return
    if (poll.multiple) {
      const next = new Set(selectedIds)
      if (next.has(optId)) { next.delete(optId) } else {
        if (!poll.max_choices || next.size < poll.max_choices) next.add(optId)
      }
      selectedIds = next
    } else {
      selectedIds = new Set([optId])
    }
  }

  // ── Vote — schedule ──────────────────────────────────────────────────────────

  const SCHEDULE_VALS = $derived([
    { value: 2, label: '✓', cls: 'sv-yes',   title: tFn('poll.schedule.yes_title') },
    { value: 1, label: '~', cls: 'sv-maybe', title: tFn('poll.schedule.maybe_title') },
    { value: 0, label: '✗', cls: 'sv-no',    title: tFn('poll.schedule.no_title') },
  ])

  function cycleSchedule(optId: string) {
    if (!poll?.is_open) return
    const cur = scheduleVotes[optId] ?? -1
    scheduleVotes = { ...scheduleVotes, [optId]: cur === 2 ? 0 : cur + 1 }
  }

  // ── Vote — ranking (drag & drop) ─────────────────────────────────────────────

  function onDragStart(e: DragEvent, optId: string) {
    draggingId = optId
    e.dataTransfer!.effectAllowed = 'move'
  }

  function onDragOver(e: DragEvent, targetId: string) {
    e.preventDefault()
    if (!draggingId || draggingId === targetId) return
    const from = rankingOrder.indexOf(draggingId)
    const to   = rankingOrder.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...rankingOrder]
    next.splice(from, 1)
    next.splice(to, 0, draggingId)
    rankingOrder = next
  }

  function onDragEnd() { draggingId = null }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function submitVote() {
    if (!poll || voting) return
    voting = true

    let votes: Array<{ option_id: string; value?: number }> = []

    if (poll.type === 'choice') {
      votes = [...selectedIds].map(id => ({ option_id: id, value: 1 }))
    } else if (poll.type === 'schedule') {
      votes = Object.entries(scheduleVotes).map(([id, val]) => ({ option_id: id, value: val }))
    } else if (poll.type === 'ranking') {
      votes = rankingOrder.map((id, i) => ({ option_id: id, value: i + 1 }))
    }

    if (!votes.length) { voting = false; return }

    try {
      const res  = await fetch(`/api/v1/polls/${pollId}/vote`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ votes }),
      })
      const data = await res.json()
      if (res.ok) {
        poll = {
          ...poll!,
          results:           data.results,
          participant_count: data.participant_count,
          user_votes:        votes as any,
        }
      } else {
        error = data.error ?? tFn('poll.vote_error')
      }
    } finally {
      voting = false
    }
  }

  async function removeVote() {
    if (!poll || voting) return
    voting = true
    try {
      const res = await fetch(`/api/v1/polls/${pollId}/vote`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        selectedIds   = new Set()
        scheduleVotes = {}
        poll = {
          ...poll!,
          user_votes:        [],
          results:           data.results,
          participant_count: data.participant_count,
        }
      }
    } finally {
      voting = false
    }
  }

  async function closePoll() {
    const res = await fetch(`/api/v1/polls/${pollId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok && poll) poll = { ...poll, is_open: false }
  }

  // ── Helpers d'affichage ───────────────────────────────────────────────────────

  const TYPE_LABEL = $derived({
		choice:   tFn('poll.type_choice'),
		schedule: tFn('poll.type_schedule'),
		ranking:  tFn('poll.type_ranking'),
	})

  function formatDate(iso: string | null): string {
    if (!iso) return ''
    return new Intl.DateTimeFormat([], {
      weekday: 'short', day: 'numeric', month: 'short',
      hour:    '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  }

  function timeLeft(iso: string | null): string | null {
    if (!iso) return null
    const diff = new Date(iso).getTime() - Date.now()
    if (diff <= 0) return tFn('common.expired')
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (h > 48) return `${Math.floor(h / 24)}j`
    if (h > 0)  return `${h}h ${m}m`
    return `${m}m`
  }

  const currentUserId = $derived(($page.data as any).user?.id as string | undefined)
  const isCreator     = $derived(poll ? String(poll.created_by ?? '') === String(currentUserId) : false)
  const hasVoted      = $derived((poll?.user_votes ?? []).length > 0)
  const canVote       = $derived(poll?.is_open && !voting)
  const showResults   = $derived(poll?.results !== null)

  // Tri des résultats ranking pour l'affichage
  const rankingResults = $derived(
    poll?.type === 'ranking' && poll.results
      ? [...poll.results].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      : []
  )

  // Meilleur créneau (schedule) = celui avec le plus de YES
  const bestSlot = $derived(
    poll?.type === 'schedule' && poll.results
      ? poll.results.reduce((best, o) =>
          (o.yes_count ?? 0) > (best?.yes_count ?? -1) ? o : best
        , null as PollOption | null)
      : null
  )

  // Canouverture
  const totalChoiceVotes = $derived(
    poll?.type === 'choice' && poll.results
      ? poll.results.reduce((s, o) => s + (o.vote_count ?? 0), 0)
      : 0
  )
</script>

{#if loading}
  <div class="poll-card poll-loading">
    <div class="poll-skeleton"></div>
    <div class="poll-skeleton short"></div>
  </div>
{:else if error}
  <div class="poll-card poll-error">{tFn('poll.unavailable')}</div>
{:else if poll}
  <div class="poll-card" class:poll-closed={!poll.is_open} class:poll-inline={inline}>

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="poll-header">
      <div class="poll-meta">
        <span class="poll-type-badge">{TYPE_LABEL[poll.type]}</span>
        {#if !poll.is_open}
          <span class="poll-status-badge closed">{tFn('poll.closed_badge')}</span>
        {:else if poll.closes_at}
          <span class="poll-status-badge open">⏱ {timeLeft(poll.closes_at)}</span>
        {/if}
        {#if poll.anonymous}
          <span class="poll-status-badge anon">{tFn('poll.anonymous_badge')}</span>
        {/if}
      </div>

      <h3 class="poll-title">{poll.title}</h3>

      {#if poll.description}
        <p class="poll-desc">{poll.description}</p>
      {/if}

      <div class="poll-stats">
        <span>{tFn(poll.participant_count !== 1 ? 'poll.participant_count_plural' : 'poll.participant_count', { n: String(poll.participant_count) })}</span>
        {#if poll.type === 'choice'}
          <span>·</span>
          <span>{tFn(totalChoiceVotes !== 1 ? 'poll.vote_count_plural' : 'poll.vote_count', { n: String(totalChoiceVotes) })}</span>
        {/if}
        <span>·</span>
        <span class="poll-creator">{tFn('poll.by_creator', { username: poll.creator_username })}</span>
      </div>
    </div>

    <!-- ── Corps selon le type ─────────────────────────────────────────────── -->

    {#if poll.type === 'choice'}
      <!-- ═══ CHOICE ═══ -->
      <div class="poll-options">
        {#each poll.results ?? [] as opt (opt.id)}
          <button
            class="poll-option"
            class:selected={selectedIds.has(opt.id)}
            class:has-voted={hasVoted}
            disabled={!canVote || hasVoted}
            onclick={() => toggleChoice(opt.id)}
          >
            {#if opt.image_url}
              <img src={opt.image_url} alt={opt.label} class="opt-img" />
            {/if}
            <div class="opt-text">
              <span class="opt-label">{opt.label}</span>
              {#if opt.description}<span class="opt-desc">{opt.description}</span>{/if}
            </div>

            {#if showResults && hasVoted}
              <div class="opt-bar-wrap">
                <div class="opt-bar" style="width: {opt.percentage ?? 0}%"></div>
              </div>
              <span class="opt-pct">{opt.percentage ?? 0}%</span>
              <span class="opt-count">({opt.vote_count ?? 0})</span>
            {:else if !hasVoted && canVote}
              <span class="opt-radio" class:selected={selectedIds.has(opt.id)}>
                {#if poll.multiple}
                  {selectedIds.has(opt.id) ? '☑' : '☐'}
                {:else}
                  {selectedIds.has(opt.id) ? '◉' : '○'}
                {/if}
              </span>
            {/if}
          </button>
        {/each}
      </div>

    {:else if poll.type === 'schedule'}
      <!-- ═══ SCHEDULE (Doodle) ═══ -->
      {#if bestSlot && hasVoted}
        <div class="schedule-best-slot">
          <span class="best-icon">⭐</span>
          <div>
            <div class="best-label">{tFn('poll.schedule.best_slot_title')}</div>
            <div class="best-date">{formatDate(bestSlot.date_start)}</div>
            <div class="best-count">{tFn('poll.schedule.best_slot_count', { yes: String(bestSlot.yes_count), maybe: String(bestSlot.maybe_count) })}</div>
          </div>
        </div>
      {/if}

      <div class="schedule-grid">
        {#each poll.results ?? [] as opt (opt.id)}
          {@const myVal = scheduleVotes[opt.id] ?? -1}
          {@const sv = SCHEDULE_VALS.find(s => s.value === myVal)}
          <div class="schedule-row" class:best-row={bestSlot?.id === opt.id}>
            <div class="schedule-date">
              <span class="sched-day">{formatDate(opt.date_start)}</span>
              {#if opt.date_end && opt.date_end !== opt.date_start}
                <span class="sched-end">→ {formatDate(opt.date_end)}</span>
              {/if}
              <span class="sched-label">{opt.label}</span>
            </div>

            {#if showResults && hasVoted}
              <!-- Résultats -->
              <div class="schedule-counts">
                <span class="sv-yes-count">✓ {opt.yes_count ?? 0}</span>
                <span class="sv-maybe-count">~ {opt.maybe_count ?? 0}</span>
                <span class="sv-no-count">✗ {opt.no_count ?? 0}</span>
              </div>
            {/if}

            {#if canVote && !hasVoted}
              <!-- Bouton de sélection cycle -->
              <button
                class="schedule-vote-btn {sv?.cls ?? 'sv-unset'}"
                onclick={() => cycleSchedule(opt.id)}
                title={sv?.title ?? tFn('poll.schedule.click_to_vote')}
              >
                {sv?.label ?? '?'}
              </button>
            {:else if hasVoted}
              {@const myVoteHere = scheduleVotes[opt.id] ?? (poll.user_votes.find(v => v.option_id === opt.id)?.value ?? -1)}
              {@const mySv = SCHEDULE_VALS.find(s => s.value === myVoteHere)}
              {#if mySv}
                <span class="schedule-my-vote {mySv.cls}">{mySv.label}</span>
              {/if}
            {/if}
          </div>
        {/each}
      </div>

    {:else if poll.type === 'ranking'}
      <!-- ═══ RANKING ═══ -->
      {#if !hasVoted && canVote}
        <p class="ranking-hint">{tFn('poll.ranking.drag_to_rank')}</p>
        <div class="ranking-list">
          {#each rankingOrder as optId, i (optId)}
            {@const opt = poll.results?.find(o => o.id === optId) ?? { id: optId, label: '?' } as PollOption}
            <div
              class="ranking-item"
              class:dragging={draggingId === optId}
              draggable="true"
              ondragstart={e => onDragStart(e, optId)}
              ondragover={e => onDragOver(e, optId)}
              ondragend={onDragEnd}
              animate:flip={{ duration: 200 }}
            >
              <span class="rank-pos">{i + 1}</span>
              <span class="rank-drag">⠿</span>
              <span class="rank-label">{opt.label}</span>
            </div>
          {/each}
        </div>
      {:else}
        <!-- Résultats ranking -->
        <div class="ranking-results">
          {#each rankingResults as opt, i (opt.id)}
            {@const maxScore = rankingResults[0]?.score ?? 1}
            <div class="ranking-result-row" in:fly={{ y: 10, delay: i * 40 }}>
              <span class="rank-medal">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
              </span>
              <span class="rank-label">{opt.label}</span>
              <div class="rank-score-bar-wrap">
                <div class="rank-score-bar" style="width: {Math.round((opt.score ?? 0) / maxScore * 100)}%"></div>
              </div>
              <span class="rank-score">{opt.score} pts</span>
              {#if opt.avg_rank !== null}
                <span class="rank-avg">{tFn('poll.ranking.avg_rank_label', { n: String(opt.avg_rank) })}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- ── Actions ──────────────────────────────────────────────────────────── -->
    {#if poll.is_open}
      <div class="poll-actions">
        {#if !hasVoted}
          <button
            class="btn-vote"
            onclick={submitVote}
            disabled={voting || (poll.type === 'choice' && selectedIds.size === 0)}
          >
            {voting ? '…' : tFn('poll.vote_button')}
          </button>
        {:else}
          <button class="btn-revote" onclick={removeVote} disabled={voting}>
            {tFn('poll.change_vote_button')}
          </button>
        {/if}

        {#if isCreator}
          <button class="btn-close-poll" onclick={closePoll}>{tFn('poll.close_poll_button')}</button>
        {/if}
      </div>
    {:else}
      <div class="poll-closed-banner">{tFn('poll.closed_banner')}</div>
    {/if}

    {#if error}
      <div class="poll-err-msg" in:fade>{error}</div>
    {/if}
  </div>
{/if}

<style>
  .poll-card {
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border, #333);
    border-radius: 12px;
    padding: 16px;
    max-width: 560px;
    font-size: 0.92rem;
    color: var(--text, #e0e0e0);
  }

  .poll-card.poll-closed { opacity: 0.85; }

  /* ── Skeleton ── */
  .poll-loading { display: flex; flex-direction: column; gap: 10px; min-height: 80px; }
  .poll-skeleton {
    background: var(--border, #333);
    border-radius: 6px;
    height: 14px;
    animation: skel-pulse 1.4s ease-in-out infinite;
  }
  .poll-skeleton.short { width: 40%; }
  @keyframes skel-pulse {
    0%,100% { opacity: 0.4 } 50% { opacity: 0.9 }
  }

  /* ── Header ── */
  .poll-header { margin-bottom: 14px; }
  .poll-meta   { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }

  .poll-type-badge, .poll-status-badge {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 99px;
    font-weight: 600;
  }
  .poll-type-badge { background: #7c3aed22; color: #a78bfa; border: 1px solid #7c3aed44; }
  .poll-status-badge.open   { background: #16a34a22; color: #4ade80; border: 1px solid #16a34a44; }
  .poll-status-badge.closed { background: #64748b22; color: #94a3b8; border: 1px solid #64748b44; }
  .poll-status-badge.anon   { background: #0f172a;   color: #60a5fa; border: 1px solid #1e3a5f44; }

  .poll-title  { font-size: 1rem; font-weight: 700; margin: 0 0 4px; }
  .poll-desc   { font-size: 0.82rem; color: var(--text-muted, #888); margin: 0 0 8px; }
  .poll-stats  { font-size: 0.75rem; color: var(--text-muted, #888); display: flex; gap: 6px; }
  .poll-creator { font-style: italic; }

  /* ── Choice options ── */
  .poll-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }

  .poll-option {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-3, #252535);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color .15s, background .15s;
    color: inherit;
    text-align: left;
    overflow: hidden;
  }
  .poll-option:not(:disabled):hover { border-color: #7c3aed88; background: var(--bg-4, #2a2a3f); }
  .poll-option.selected             { border-color: #7c3aed; background: #7c3aed18; }
  .poll-option:disabled             { cursor: default; }

  .opt-img { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
  .opt-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .opt-label { font-weight: 500; }
  .opt-desc  { font-size: 0.75rem; color: var(--text-muted, #888); }

  .opt-bar-wrap {
    position: absolute;
    inset: 0;
    border-radius: 8px;
    overflow: hidden;
    pointer-events: none;
  }
  .opt-bar {
    position: absolute;
    inset-block: 0;
    left: 0;
    background: #7c3aed1a;
    transition: width .5s cubic-bezier(.4,0,.2,1);
    border-radius: 8px;
  }
  .opt-pct    { font-weight: 700; font-size: 0.82rem; color: #a78bfa; position: relative; z-index: 1; }
  .opt-count  { font-size: 0.75rem; color: var(--text-muted, #888); position: relative; z-index: 1; }
  .opt-radio  { font-size: 1.1rem; color: var(--text-muted, #888); }
  .opt-radio.selected { color: #a78bfa; }

  /* ── Schedule ── */
  .schedule-best-slot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #16a34a1a;
    border: 1px solid #16a34a44;
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .best-icon  { font-size: 1.4rem; }
  .best-label { font-size: 0.72rem; color: #4ade80; text-transform: uppercase; letter-spacing: .05em; }
  .best-date  { font-weight: 600; font-size: 0.9rem; }
  .best-count { font-size: 0.75rem; color: var(--text-muted, #888); }

  .schedule-grid { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }

  .schedule-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--bg-3, #252535);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    transition: border-color .15s;
  }
  .schedule-row.best-row { border-color: #16a34a55; background: #16a34a0d; }

  .schedule-date { flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .sched-day     { font-weight: 500; font-size: 0.85rem; }
  .sched-end, .sched-label { font-size: 0.75rem; color: var(--text-muted, #888); }

  .schedule-counts { display: flex; gap: 8px; font-size: 0.78rem; font-weight: 600; }
  .sv-yes-count   { color: #4ade80; }
  .sv-maybe-count { color: #fbbf24; }
  .sv-no-count    { color: #f87171; }

  .schedule-vote-btn {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: 2px solid var(--border, #333);
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s, border-color .15s;
    background: var(--bg-2, #1e1e2e);
    color: inherit;
  }
  .schedule-vote-btn.sv-yes   { background: #16a34a22; border-color: #4ade80; color: #4ade80; }
  .schedule-vote-btn.sv-maybe { background: #d9770622; border-color: #fbbf24; color: #fbbf24; }
  .schedule-vote-btn.sv-no    { background: #dc262622; border-color: #f87171; color: #f87171; }
  .schedule-vote-btn.sv-unset { color: var(--text-muted, #888); }

  .schedule-my-vote {
    width: 28px; height: 28px;
    display: grid; place-items: center;
    border-radius: 50%;
    font-weight: 700; font-size: 0.8rem;
    flex-shrink: 0;
  }
  .sv-yes   { background: #16a34a22; color: #4ade80; }
  .sv-maybe { background: #d9770622; color: #fbbf24; }
  .sv-no    { background: #dc262622; color: #f87171; }

  /* ── Ranking ── */
  .ranking-hint { font-size: 0.8rem; color: var(--text-muted, #888); margin: 0 0 10px; }
  .ranking-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }

  .ranking-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-3, #252535);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    cursor: grab;
    user-select: none;
    transition: border-color .15s, box-shadow .15s;
  }
  .ranking-item:active { cursor: grabbing; }
  .ranking-item.dragging { opacity: 0.5; border-color: #7c3aed; }

  .rank-pos  { font-weight: 700; color: #a78bfa; min-width: 20px; text-align: center; }
  .rank-drag { color: var(--text-muted, #888); font-size: 1.1rem; cursor: grab; }
  .rank-label { flex: 1; font-weight: 500; }

  .ranking-results { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }

  .ranking-result-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--bg-3, #252535);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
  }
  .rank-medal { font-size: 1.1rem; flex-shrink: 0; min-width: 28px; text-align: center; }
  .rank-score-bar-wrap {
    flex: 1;
    height: 6px;
    background: var(--border, #333);
    border-radius: 99px;
    overflow: hidden;
  }
  .rank-score-bar {
    height: 100%;
    background: linear-gradient(90deg, #7c3aed, #a78bfa);
    border-radius: 99px;
    transition: width .6s cubic-bezier(.4,0,.2,1);
  }
  .rank-score { font-weight: 700; color: #a78bfa; font-size: 0.82rem; }
  .rank-avg   { font-size: 0.72rem; color: var(--text-muted, #888); }

  /* ── Actions ── */
  .poll-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .btn-vote, .btn-revote, .btn-close-poll {
    padding: 7px 18px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: opacity .15s, transform .1s;
    border: none;
  }
  .btn-vote:hover, .btn-revote:hover, .btn-close-poll:hover { opacity: 0.85; }
  .btn-vote:active { transform: scale(.97); }

  .btn-vote        { background: #7c3aed; color: #fff; }
  .btn-vote:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-revote      { background: transparent; color: var(--text-muted, #888); border: 1px solid var(--border, #333) !important; }
  .btn-close-poll  { background: transparent; color: #f87171; border: 1px solid #f8717144 !important; font-size: 0.78rem; }

  .poll-closed-banner {
    margin-top: 8px;
    padding: 6px 12px;
    background: #64748b1a;
    border-radius: 6px;
    font-size: 0.78rem;
    color: var(--text-muted, #888);
    text-align: center;
  }

  .poll-err-msg {
    margin-top: 8px;
    padding: 6px 12px;
    background: #dc262622;
    border: 1px solid #f8717144;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #f87171;
  }
  .poll-error { color: var(--text-muted, #888); font-size: 0.82rem; }
</style>
