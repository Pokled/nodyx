<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let lines = $state<{ text: string; level: 'info'|'warn'|'error'; ts: string }[]>([]);
  let source: EventSource | null = null;
  let autoScroll = $state(true);
  let logEl: HTMLDivElement;
  let selectedProcess = $state('nodyx-core');

  function connect() {
    if (source) source.close();
    lines = [];
    source = new EventSource(`/api/logs?process=${selectedProcess}`);
    source.onmessage = (e) => {
      const data = JSON.parse(e.data);
      lines = [...lines.slice(-500), data]; // keep last 500
      if (autoScroll && logEl) {
        setTimeout(() => logEl.scrollTop = logEl.scrollHeight, 10);
      }
    };
    source.onerror = () => {
      lines = [...lines, { text: '— Connexion perdue. Reconnexion...', level: 'warn', ts: new Date().toISOString() }];
    };
  }

  onMount(connect);
  onDestroy(() => source?.close());

  function levelClass(level: string) {
    if (level === 'error') return 'log-error';
    if (level === 'warn')  return 'log-warn';
    return 'log-info';
  }

  function formatTs(ts: string) {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
</script>

<svelte:head><title>Olympus — Logs</title></svelte:head>

<div style="padding:1.5rem;max-width:1400px;margin:0 auto;height:calc(100vh - 52px - 3rem);display:flex;flex-direction:column;">
  <!-- Header -->
  <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-shrink:0;">
    <h1 style="font-size:1rem;font-weight:800;color:#f1f5f9;margin:0;">Logs en direct</h1>
    <div style="display:flex;gap:0.375rem;">
      {#each ['nodyx-core','nodyx-frontend'] as p}
        <button
          onclick={() => { selectedProcess = p; connect(); }}
          style="
            padding:0.3rem 0.75rem;border-radius:6px;font-size:0.75rem;font-weight:600;cursor:pointer;
            background:{selectedProcess===p ? 'rgba(16,185,129,0.15)' : 'rgba(15,20,40,0.6)'};
            color:{selectedProcess===p ? '#6ee7b7' : '#64748b'};
            border:1px solid {selectedProcess===p ? 'rgba(16,185,129,0.4)' : 'rgba(56,78,180,0.15)'};
            transition:all 0.15s;
          "
        >{p}</button>
      {/each}
    </div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-left:auto;">
      <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.75rem;color:#64748b;cursor:pointer;">
        <input type="checkbox" bind:checked={autoScroll} style="accent-color:#3b82f6;" />
        Auto-scroll
      </label>
      <button onclick={() => lines = []} style="
        padding:0.3rem 0.75rem;border-radius:6px;font-size:0.75rem;cursor:pointer;
        background:rgba(15,20,40,0.6);color:#64748b;
        border:1px solid rgba(56,78,180,0.15);
        transition:all 0.15s;
      ">Effacer</button>
    </div>
  </div>

  <!-- Log viewer -->
  <div
    bind:this={logEl}
    class="glass-card"
    style="flex:1;overflow-y:auto;padding:1rem;font-family:monospace;font-size:0.75rem;line-height:1.6;"
  >
    {#if lines.length === 0}
      <div style="color:#334155;text-align:center;padding:2rem;">
        En attente de logs...
      </div>
    {/if}
    {#each lines as line}
      <div class={levelClass(line.level)} style="display:flex;gap:1rem;border-bottom:1px solid rgba(56,78,180,0.05);padding:1px 0;">
        <span style="color:#334155;flex-shrink:0;">{formatTs(line.ts)}</span>
        <span style="word-break:break-all;">{line.text}</span>
      </div>
    {/each}
  </div>
</div>
