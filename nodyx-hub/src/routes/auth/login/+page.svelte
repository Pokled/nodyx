<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let submitting = $state(false);
</script>

<svelte:head><title>Olympus — Connexion</title></svelte:head>

<div style="
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: #020408;
  background-image:
    radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.06) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 20%, rgba(16,185,129,0.04) 0%, transparent 50%);
">
  <div style="width: 100%; max-width: 380px; padding: 1.5rem;">

    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 2.5rem;">
      <div style="
        width: 64px; height: 64px;
        background: rgba(59,130,246,0.1);
        border: 1px solid rgba(59,130,246,0.3);
        border-radius: 16px;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 2rem; color: #3b82f6;
        box-shadow: 0 0 30px rgba(59,130,246,0.2);
        margin-bottom: 1.25rem;
      ">◈</div>
      <h1 style="font-size: 1.5rem; font-weight: 800; color: #f1f5f9; margin: 0; letter-spacing: 0.05em;">OLYMPUS</h1>
      <p style="color: #475569; font-size: 0.75rem; margin: 0.25rem 0 0; letter-spacing: 0.15em; text-transform: uppercase; font-family: monospace;">
        Nodyx Command Center
      </p>
    </div>

    <!-- Card -->
    <div class="glass-card" style="padding: 2rem;">
      {#if form?.error}
        <div style="
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: 8px;
          padding: 0.75rem 1rem;
          color: #fca5a5;
          font-size: 0.875rem;
          margin-bottom: 1.25rem;
        ">{form.error}</div>
      {/if}

      <form method="POST" onsubmit={() => submitting = true}>
        <input type="hidden" name="redirectTo" value={data.redirectTo} />

        <div style="margin-bottom: 1.25rem;">
          <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.5rem; letter-spacing: 0.05em; text-transform: uppercase;">
            Mot de passe maître
          </label>
          <input
            type="password"
            name="password"
            autofocus
            required
            class="input-dark"
            style="width: 100%;"
            placeholder="••••••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          class="btn-primary"
          style="width: 100%; padding: 0.75rem; font-size: 0.9rem; letter-spacing: 0.05em;"
        >
          {submitting ? 'Authentification...' : 'Accéder à Olympus →'}
        </button>
      </form>
    </div>

    <p style="text-align: center; color: #1e293b; font-size: 0.7rem; margin-top: 1.5rem; font-family: monospace;">
      ACCÈS RESTREINT · NODYX CORE TEAM
    </p>
  </div>
</div>
