<script lang="ts">
  import { browser } from '$app/environment'
  import {
    sfuJoin, sfuLeave, sfuSetMuted,
    sfuPhaseStore, sfuErrorStore, sfuLogStore, sfuConsumersStore, sfuMutedStore,
  } from '$lib/voiceSfu'

  // Laboratoire SFU (P1) : prouve le chemin complet device → transports →
  // produce(micro) → consume, en isolation TOTALE du vocal mesh existant.
  // Prérequis côté serveur : nodyx-sfud lancé + VOICE_SFU_URL/VOICE_SFU_TOKEN
  // dans le .env du core (sinon toute action répond sfu_disabled).

  let channelId = $state(browser ? (localStorage.getItem('nodyx:sfu-lab:channel') ?? '') : '')
  let logEl: HTMLElement | null = $state(null)

  const phase = $derived($sfuPhaseStore)
  const busy  = $derived(phase === 'joining' || phase === 'connecting')

  function join() {
    if (browser) localStorage.setItem('nodyx:sfu-lab:channel', channelId.trim())
    void sfuJoin(channelId.trim())
  }

  // Console : suit le bas automatiquement.
  $effect(() => {
    $sfuLogStore
    if (logEl) logEl.scrollTop = logEl.scrollHeight
  })

  const PHASE_LABEL: Record<string, string> = {
    idle: 'Inactif', joining: 'Connexion…', mesh: 'Salon en mesh',
    connecting: 'Établissement…', active: 'SESSION ACTIVE', error: 'Erreur',
  }
  const PHASE_CLASS: Record<string, string> = {
    idle: 'bg-zinc-800 text-zinc-400',
    joining: 'bg-amber-500/15 text-amber-400',
    mesh: 'bg-sky-500/15 text-sky-400',
    connecting: 'bg-amber-500/15 text-amber-400',
    active: 'bg-emerald-500/15 text-emerald-400',
    error: 'bg-red-500/15 text-red-400',
  }
</script>

<svelte:head><title>Labo SFU — Admin Nodyx</title></svelte:head>

<div class="space-y-6 max-w-3xl">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-white">Labo SFU</h1>
      <p class="text-sm text-zinc-500 mt-1">
        Session vocale via le SFU (mediasoup), isolée du vocal mesh. Expérimental.
      </p>
    </div>
    <span class="rounded-full px-3 py-1 text-xs font-semibold tracking-wide {PHASE_CLASS[phase]}">
      {PHASE_LABEL[phase]}
    </span>
  </div>

  {#if $sfuErrorStore}
    <div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {$sfuErrorStore}
    </div>
  {/if}

  <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
    <label class="block">
      <span class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Channel vocal (UUID)</span>
      <input
        type="text"
        bind:value={channelId}
        placeholder="00000000-0000-0000-0000-000000000000"
        disabled={phase === 'active' || busy}
        class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      />
    </label>

    <div class="flex gap-3">
      {#if phase === 'active'}
        <button
          onclick={() => sfuSetMuted(!$sfuMutedStore)}
          class="rounded-lg px-4 py-2 text-sm font-semibold {$sfuMutedStore ? 'bg-amber-600 hover:bg-amber-500' : 'bg-zinc-700 hover:bg-zinc-600'} text-white"
        >
          {$sfuMutedStore ? 'Micro coupé' : 'Couper le micro'}
        </button>
        <button
          onclick={() => void sfuLeave()}
          class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
        >
          Quitter
        </button>
      {:else}
        <button
          onclick={join}
          disabled={busy || channelId.trim().length < 36}
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {busy ? 'Connexion…' : 'Rejoindre via SFU'}
        </button>
        {#if phase === 'error' || phase === 'mesh'}
          <button
            onclick={() => void sfuLeave()}
            class="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-600"
          >
            Réinitialiser
          </button>
        {/if}
      {/if}
    </div>
  </div>

  <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
    <h2 class="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">
      Flux reçus ({$sfuConsumersStore.length})
    </h2>
    {#if $sfuConsumersStore.length === 0}
      <p class="text-sm text-zinc-600">Aucun flux consommé. Ouvre ce labo sur un second compte pour vous entendre.</p>
    {:else}
      <ul class="space-y-2">
        {#each $sfuConsumersStore as c (c.consumerId)}
          <li class="flex items-center gap-3 rounded-lg bg-zinc-950 px-3 py-2 text-sm">
            <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span class="text-zinc-200 font-medium">{c.userId}</span>
            <span class="text-zinc-600 font-mono text-xs">{c.kind} · {c.producerId.slice(0, 8)}…</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
    <h2 class="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Journal</h2>
    <div bind:this={logEl} class="h-64 overflow-y-auto font-mono text-xs leading-relaxed text-zinc-400">
      {#if $sfuLogStore.length === 0}
        <p class="text-zinc-700">En attente d'une session…</p>
      {/if}
      {#each $sfuLogStore as line}
        <div class:text-red-400={line.includes('✘')} class:text-emerald-400={line.includes('✓')}>{line}</div>
      {/each}
    </div>
  </div>

  <p class="text-xs text-zinc-600">
    Prérequis serveur : daemon <code class="text-zinc-500">nodyx-sfud</code> actif,
    <code class="text-zinc-500">VOICE_SFU_URL</code> + <code class="text-zinc-500">VOICE_SFU_TOKEN</code>
    dans le .env du core. Pour forcer le mode SFU à 2 participants :
    <code class="text-zinc-500">SFU_MESH_THRESHOLD=0</code> côté daemon.
  </p>
</div>
