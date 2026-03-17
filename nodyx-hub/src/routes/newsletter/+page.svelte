<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { enhance } from '$app/forms';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let sending = $state(false);
  let subject = $state('');
  let body    = $state('');

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
</script>

<svelte:head><title>Olympus — Newsletter</title></svelte:head>

<div style="padding:1.5rem;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 340px;gap:1.5rem;align-items:start;">

  <!-- Compose -->
  <div>
    <div style="margin-bottom:1.5rem;">
      <h1 style="font-size:1.1rem;font-weight:800;color:#f1f5f9;margin:0;">Newsletter Admins</h1>
      <p style="font-size:0.75rem;color:#475569;margin:0.25rem 0 0;font-family:monospace;">
        {data.recipients.length} destinataire{data.recipients.length !== 1 ? 's' : ''} disponible{data.recipients.length !== 1 ? 's' : ''}
      </p>
    </div>

    {#if form?.error}
      <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:0.75rem 1rem;color:#fca5a5;font-size:0.875rem;margin-bottom:1rem;">
        {form.error}
      </div>
    {/if}
    {#if form?.success}
      <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:0.75rem 1rem;color:#6ee7b7;font-size:0.875rem;margin-bottom:1rem;">
        ✓ Envoyé à {form.sent} destinataire{form.sent !== 1 ? 's' : ''}.
        {#if form.errors?.length}
          <br><span style="color:#f59e0b;">{form.errors.length} erreur(s): {form.errors.slice(0,3).join(', ')}</span>
        {/if}
      </div>
    {/if}

    <form method="POST" action="?/send" use:enhance={() => { sending = true; return async ({ update }) => { sending = false; await update(); }; }}>
      <div class="glass-card" style="padding:1.5rem;display:flex;flex-direction:column;gap:1.25rem;">
        <div>
          <label for="nl-subject" style="display:block;font-size:0.7rem;color:#64748b;margin-bottom:0.5rem;letter-spacing:0.08em;text-transform:uppercase;">Objet</label>
          <input id="nl-subject" type="text" name="subject" bind:value={subject} required class="input-dark" style="width:100%;" placeholder="[Nodyx] v1.9.0 — Nouvelles fonctionnalités" />
        </div>
        <div>
          <label for="nl-body" style="display:block;font-size:0.7rem;color:#64748b;margin-bottom:0.5rem;letter-spacing:0.08em;text-transform:uppercase;">Contenu</label>
          <textarea id="nl-body" name="body" bind:value={body} required rows="12" class="input-dark" style="width:100%;resize:vertical;" placeholder="Bonjour,&#10;&#10;Voici les dernières nouvelles du projet Nodyx..."></textarea>
          <p style="font-size:0.7rem;color:#334155;margin:0.375rem 0 0;">Le texte sera automatiquement mis en forme (sauts de ligne → &lt;br&gt;).</p>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:0.75rem;color:#334155;font-family:monospace;">
            → {data.recipients.length} instance admin{data.recipients.length !== 1 ? 's' : ''}
          </span>
          <button type="submit" class="btn-primary" disabled={sending || !subject.trim() || !body.trim()} style="padding:0.625rem 1.5rem;">
            {sending ? 'Envoi en cours...' : 'Envoyer la newsletter →'}
          </button>
        </div>
      </div>
    </form>
  </div>

  <!-- Sidebar: recipients + history -->
  <div style="display:flex;flex-direction:column;gap:1.25rem;">
    <!-- Recipients list -->
    <div class="glass-card" style="padding:1.25rem;">
      <h3 style="font-size:0.7rem;color:#475569;letter-spacing:0.1em;font-family:monospace;margin:0 0 1rem;text-transform:uppercase;">Destinataires</h3>
      {#if data.recipients.length === 0}
        <p style="font-size:0.8rem;color:#334155;text-align:center;padding:1rem 0;">Aucun admin avec email enregistré.</p>
      {:else}
        <div style="display:flex;flex-direction:column;gap:0.5rem;max-height:300px;overflow-y:auto;">
          {#each data.recipients as r}
            <div style="background:rgba(15,20,40,0.5);border-radius:6px;padding:0.5rem 0.75rem;">
              <div style="font-size:0.75rem;font-weight:600;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{r.name}</div>
              <div style="font-size:0.65rem;color:#3b82f6;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{r.admin_email}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- History -->
    <div class="glass-card" style="padding:1.25rem;">
      <h3 style="font-size:0.7rem;color:#475569;letter-spacing:0.1em;font-family:monospace;margin:0 0 1rem;text-transform:uppercase;">Historique</h3>
      {#if data.history.length === 0}
        <p style="font-size:0.8rem;color:#334155;text-align:center;padding:1rem 0;">Aucune newsletter envoyée.</p>
      {:else}
        <div style="display:flex;flex-direction:column;gap:0.625rem;max-height:300px;overflow-y:auto;">
          {#each data.history as item}
            <div style="background:rgba(15,20,40,0.5);border-radius:6px;padding:0.625rem 0.75rem;">
              <div style="font-size:0.8rem;font-weight:600;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{item.subject}</div>
              <div style="display:flex;justify-content:space-between;margin-top:3px;">
                <span style="font-size:0.65rem;color:#64748b;font-family:monospace;">{item.recipients} envois</span>
                <span style="font-size:0.65rem;color:#334155;font-family:monospace;">{formatDate(item.sent_at)}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
