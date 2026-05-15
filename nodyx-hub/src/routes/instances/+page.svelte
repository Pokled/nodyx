<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { instanceStatus, timeAgo } from '$lib/utils.js';
  import { enhance } from '$app/forms';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let search    = $state('');
  let filter    = $state<'all'|'active'|'banned'|'inactive'>('all');
  let blockModal = $state<null | { id: number; name: string }>(null);
  let blockReason = $state('');
  let archiveModal = $state<null | { days: number; preview: number }>(null);
  let showArchived = $state(false);

  // Vue principale : on EXCLUT les archivées par défaut. La section 'archivées'
  // dépliable plus bas les expose pour reverse / inspection.
  const activeInstances  = $derived(data.instances.filter(i => !i.archived_at));
  const archivedInstances = $derived(data.instances.filter(i =>  i.archived_at));

  const filtered = $derived(
    activeInstances.filter(i => {
      if (filter === 'active'   && i.status !== 'active')   return false;
      if (filter === 'banned'   && i.status !== 'banned')   return false;
      if (filter === 'inactive' && i.status === 'active')   return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !i.url.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
  );

  // Combien d'instances seraient archivées par la dernière query (>30j inactives) ?
  // On l'affiche dans le bouton pour donner un preview avant le click.
  function countInactiveSince(days: number): number {
    const cutoff = Date.now() - days * 86400 * 1000;
    return activeInstances.filter(i => {
      if (!i.last_seen) return true; // jamais pingé → considéré inactif
      return new Date(i.last_seen).getTime() < cutoff;
    }).length;
  }
  const archivableCount = $derived(countInactiveSince(30));

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
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;gap:1rem;flex-wrap:wrap;">
    <div>
      <h1 style="font-size:1.1rem;font-weight:800;color:#f1f5f9;margin:0;">Gestion des Instances</h1>
      <p style="font-size:0.75rem;color:#475569;margin:0.25rem 0 0;font-family:monospace;">
        {activeInstances.length} actives · {archivedInstances.length} archivées · {activeInstances.filter(i=>i.status==='banned').length} bannies
      </p>
    </div>
    <button
      type="button"
      onclick={() => { archiveModal = { days: 30, preview: archivableCount } }}
      disabled={archivableCount === 0}
      style="
        padding:0.5rem 0.9rem;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;
        background:{archivableCount > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(15,20,40,0.4)'};
        color:{archivableCount > 0 ? '#fbbf24' : '#475569'};
        border:1px solid {archivableCount > 0 ? 'rgba(245,158,11,0.35)' : 'rgba(56,78,180,0.15)'};
        transition:all 0.15s;
      "
      title="Archive les instances qui n'ont pas pingé depuis 30 jours"
    >
      📦 Archiver les inactives ({archivableCount})
    </button>
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

  <!-- Section Archivées (dépliable) -->
  {#if archivedInstances.length > 0}
    <div style="margin-top:1.5rem;">
      <button
        type="button"
        onclick={() => showArchived = !showArchived}
        style="
          display:flex;align-items:center;gap:0.5rem;width:100%;padding:0.6rem 0.9rem;
          background:rgba(15,20,40,0.5);border:1px solid rgba(56,78,180,0.15);
          border-radius:6px;color:#94a3b8;font-size:0.8rem;font-weight:600;cursor:pointer;
          transition:all 0.15s;
        "
      >
        <span style="font-size:0.7rem;">{showArchived ? '▼' : '▶'}</span>
        Archivées ({archivedInstances.length})
        <span style="margin-left:auto;font-weight:400;color:#475569;font-size:0.7rem;">
          inactives, exclues de la carte et des stats principales
        </span>
      </button>
      {#if showArchived}
        <div class="glass-card" style="margin-top:0.75rem;padding:0;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
            <thead style="background:rgba(15,20,40,0.4);border-bottom:1px solid rgba(56,78,180,0.15);">
              <tr>
                {#each ['Instance','URL','Membres','Dernière activité','Archivée le','Actions'] as col}
                  <th style="padding:0.5rem 0.75rem;text-align:left;color:#64748b;font-weight:600;text-transform:uppercase;font-size:0.65rem;letter-spacing:0.05em;">{col}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each archivedInstances as inst}
                <tr style="border-bottom:1px solid rgba(56,78,180,0.08);opacity:0.7;">
                  <td style="padding:0.55rem 0.75rem;color:#cbd5e1;">{inst.name}</td>
                  <td style="padding:0.55rem 0.75rem;color:#64748b;font-family:monospace;font-size:0.7rem;">{inst.url}</td>
                  <td style="padding:0.55rem 0.75rem;color:#64748b;font-family:monospace;">{inst.members}</td>
                  <td style="padding:0.55rem 0.75rem;color:#64748b;font-family:monospace;">{inst.last_seen ? timeAgo(inst.last_seen) : '—'}</td>
                  <td style="padding:0.55rem 0.75rem;color:#64748b;font-family:monospace;">{inst.archived_at ? timeAgo(inst.archived_at) : '—'}</td>
                  <td style="padding:0.55rem 0.75rem;">
                    <form method="POST" action="?/unarchive" use:enhance class="inline">
                      <input type="hidden" name="id" value={inst.id} />
                      <button type="submit" style="
                        padding:0.25rem 0.55rem;border-radius:4px;font-size:0.7rem;cursor:pointer;
                        background:rgba(16,185,129,0.12);color:#6ee7b7;
                        border:1px solid rgba(16,185,129,0.3);
                      " title="Sortir de l'archive et remettre dans la vue principale">↺ Restaurer</button>
                    </form>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
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

<!-- Archive modal : confirmation + choix du seuil -->
{#if archiveModal}
  <div style="
    position:fixed;inset:0;z-index:1000;
    background:rgba(2,4,8,0.85);backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;padding:1rem;
  " onclick={(e) => { if (e.target === e.currentTarget) archiveModal = null; }}>
    <div class="glass-card" style="width:100%;max-width:460px;padding:2rem;">
      <h2 style="font-size:1rem;font-weight:700;color:#f1f5f9;margin:0 0 0.5rem;">Archiver les inactives</h2>
      <p style="font-size:0.8rem;color:#64748b;margin:0 0 1.5rem;">
        Les instances qui n'ont pas pingé depuis le seuil seront masquées de la carte et de la vue principale. Tu pourras les réactiver depuis la section <em>Archivées</em>.
      </p>

      <form method="POST" action="?/archiveInactive" use:enhance={() => { return async ({ update }) => { archiveModal = null; await update(); }; }}>
        <label for="archive-days" style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:0.5rem;letter-spacing:0.05em;text-transform:uppercase;">
          Seuil d'inactivité (jours, min 7)
        </label>
        <input
          id="archive-days"
          name="days"
          type="number"
          min="7"
          bind:value={archiveModal.days}
          oninput={() => { if (archiveModal) archiveModal.preview = countInactiveSince(archiveModal.days) }}
          class="input-dark"
          style="width:100%;margin-bottom:0.75rem;"
        />
        <div style="padding:0.75rem;border-radius:6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);margin-bottom:1.25rem;font-size:0.75rem;color:#fbbf24;">
          <strong>{archiveModal.preview}</strong> instance{archiveModal.preview > 1 ? 's' : ''} ser{archiveModal.preview > 1 ? 'ont' : 'a'} archivée{archiveModal.preview > 1 ? 's' : ''} avec ce seuil.
        </div>

        <div style="display:flex;gap:0.75rem;">
          <button type="button" onclick={() => archiveModal = null} class="btn-primary" style="flex:1;">Annuler</button>
          <button type="submit" class="btn-danger" style="flex:1;" disabled={!archiveModal || archiveModal.preview === 0}>
            Archiver ({archiveModal.preview})
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
