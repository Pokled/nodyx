<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { instanceStatus, timeAgo } from '$lib/utils.js';
  import { enhance } from '$app/forms';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let search    = $state('');
  let filter    = $state<'all'|'active'|'banned'|'inactive'>('all');
  let blockModal = $state<null | { id: number; name: string }>(null);
  let blockReason = $state('');

  const filtered = $derived(
    data.instances.filter(i => {
      if (filter === 'active'   && i.status !== 'active')   return false;
      if (filter === 'banned'   && i.status !== 'banned')   return false;
      if (filter === 'inactive' && i.status === 'active')   return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !i.url.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
  );

  const statusLabel: Record<string, string> = {
    online:  'EN LIGNE',
    warning: 'INACTIF',
    danger:  'HORS LIGNE',
    banned:  'BANNI',
  };
  const statusColors: Record<string, string> = {
    online:  '#10b981',
    warning: '#f59e0b',
    danger:  '#ef4444',
    banned:  '#475569',
  };
</script>

<svelte:head><title>Olympus — Instances</title></svelte:head>

<div style="padding: 1.5rem; max-width: 1400px; margin: 0 auto;">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
    <div>
      <h1 style="font-size:1.1rem;font-weight:800;color:#f1f5f9;margin:0;">Gestion des Instances</h1>
      <p style="font-size:0.75rem;color:#475569;margin:0.25rem 0 0;font-family:monospace;">
        {data.instances.length} instances enregistrées · {data.instances.filter(i=>i.status==='banned').length} bannies
      </p>
    </div>
  </div>

  {#if form?.error}
    <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:0.75rem 1rem;color:#fca5a5;font-size:0.875rem;margin-bottom:1rem;">
      {form.error}
    </div>
  {/if}
  {#if form?.success}
    <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:0.75rem 1rem;color:#6ee7b7;font-size:0.875rem;margin-bottom:1rem;">
      {form.action === 'block' ? 'Instance bannie avec succès.' : 'Instance restaurée avec succès.'}
    </div>
  {/if}

  <!-- Filters -->
  <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;flex-wrap:wrap;">
    <input
      type="text"
      bind:value={search}
      placeholder="Rechercher..."
      class="input-dark"
      style="width:220px;"
    />
    <div style="display:flex;gap:0.375rem;">
      {#each [['all','Toutes'],['active','Actives'],['banned','Bannies'],['inactive','Inactives']] as [val, label]}
        <button
          onclick={() => filter = val as typeof filter}
          style="
            padding:0.375rem 0.875rem;border-radius:6px;font-size:0.75rem;font-weight:600;cursor:pointer;border:none;
            background:{filter===val ? 'rgba(59,130,246,0.2)' : 'rgba(15,20,40,0.6)'};
            color:{filter===val ? '#93c5fd' : '#64748b'};
            border:1px solid {filter===val ? 'rgba(59,130,246,0.4)' : 'rgba(56,78,180,0.15)'};
            transition:all 0.15s;
          "
        >{label}</button>
      {/each}
    </div>
  </div>

  <!-- Table -->
  <div class="glass-card" style="overflow:hidden;">
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(56,78,180,0.2);">
            {#each ['Statut','Instance','URL','Membres','En ligne','Version','Dernière activité','Email admin','Actions'] as col}
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.65rem;color:#475569;letter-spacing:0.08em;font-family:monospace;white-space:nowrap;">
                {col}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each filtered as inst}
            {@const st = instanceStatus(inst)}
            {@const color = statusColors[st]}
            <tr style="border-bottom:1px solid rgba(56,78,180,0.1);transition:background 0.15s;" onmouseenter={(e)=>(e.currentTarget as HTMLElement).style.background='rgba(59,130,246,0.04)'} onmouseleave={(e)=>(e.currentTarget as HTMLElement).style.background='transparent'}>
              <!-- Status -->
              <td style="padding:0.75rem 1rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <div style="width:8px;height:8px;border-radius:50%;background:{color};box-shadow:0 0 6px {color};flex-shrink:0;"></div>
                  <span style="font-size:0.65rem;font-family:monospace;color:{color};letter-spacing:0.05em;">{statusLabel[st]}</span>
                </div>
              </td>
              <!-- Name -->
              <td style="padding:0.75rem 1rem;">
                <div style="font-weight:600;font-size:0.875rem;color:#f1f5f9;">{inst.name}</div>
                {#if inst.blocked_reason}
                  <div style="font-size:0.7rem;color:#ef4444;margin-top:2px;">⚠ {inst.blocked_reason}</div>
                {/if}
              </td>
              <!-- URL -->
              <td style="padding:0.75rem 1rem;">
                <a href={inst.url} target="_blank" rel="noopener" style="font-size:0.75rem;color:#3b82f6;font-family:monospace;text-decoration:none;">{inst.url}</a>
              </td>
              <!-- Members -->
              <td style="padding:0.75rem 1rem;font-family:monospace;font-size:0.875rem;color:#cbd5e1;">{inst.members}</td>
              <!-- Online -->
              <td style="padding:0.75rem 1rem;font-family:monospace;font-size:0.875rem;color:#10b981;">{inst.online}</td>
              <!-- Version -->
              <td style="padding:0.75rem 1rem;font-family:monospace;font-size:0.75rem;color:#64748b;">{inst.version ?? '—'}</td>
              <!-- Last seen -->
              <td style="padding:0.75rem 1rem;font-family:monospace;font-size:0.75rem;color:#64748b;">{timeAgo(inst.last_seen)}</td>
              <!-- Admin email -->
              <td style="padding:0.75rem 1rem;font-family:monospace;font-size:0.75rem;color:#64748b;">{inst.admin_email ?? '—'}</td>
              <!-- Actions -->
              <td style="padding:0.75rem 1rem;">
                <div style="display:flex;gap:0.375rem;">
                  {#if inst.status !== 'banned'}
                    <button
                      onclick={() => { blockModal = { id: inst.id, name: inst.name }; blockReason = ''; }}
                      class="btn-danger"
                      style="padding:0.25rem 0.625rem;font-size:0.7rem;"
                    >Bannir</button>
                  {:else}
                    <form method="POST" action="?/unblock" use:enhance>
                      <input type="hidden" name="id" value={inst.id} />
                      <button type="submit" class="btn-success" style="padding:0.25rem 0.625rem;font-size:0.7rem;">Restaurer</button>
                    </form>
                  {/if}
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="9" style="padding:2rem;text-align:center;color:#334155;font-family:monospace;font-size:0.8rem;">
                AUCUNE INSTANCE TROUVÉE
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Block modal -->
{#if blockModal}
  <div style="
    position:fixed;inset:0;z-index:1000;
    background:rgba(2,4,8,0.85);backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;padding:1rem;
  " onclick={(e) => { if (e.target === e.currentTarget) blockModal = null; }}>
    <div class="glass-card" style="width:100%;max-width:440px;padding:2rem;">
      <h2 style="font-size:1rem;font-weight:700;color:#f1f5f9;margin:0 0 0.5rem;">Bannir l'instance</h2>
      <p style="font-size:0.8rem;color:#64748b;margin:0 0 1.5rem;">
        <span style="color:#fca5a5;font-weight:600;">{blockModal.name}</span> sera retirée du directory public.
      </p>

      <form method="POST" action="?/block" use:enhance={() => { return async ({ result, update }) => { blockModal = null; await update(); }; }}>
        <input type="hidden" name="id" value={blockModal.id} />

        <label for="block-reason" style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:0.5rem;letter-spacing:0.05em;text-transform:uppercase;">
          Raison du bannissement *
        </label>
        <textarea
          id="block-reason"
          name="reason"
          bind:value={blockReason}
          required
          rows="3"
          class="input-dark"
          style="width:100%;resize:vertical;margin-bottom:1.25rem;"
          placeholder="Contenu non éthique, spam, phishing..."
        ></textarea>

        <div style="display:flex;gap:0.75rem;">
          <button type="button" onclick={() => blockModal = null} class="btn-primary" style="flex:1;">Annuler</button>
          <button type="submit" class="btn-danger" style="flex:1;" disabled={!blockReason.trim()}>
            Confirmer le bannissement
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
