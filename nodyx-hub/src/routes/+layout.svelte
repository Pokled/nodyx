<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';

  let { children } = $props();

  const navLinks = [
    { href: '/',             label: 'Dashboard',   icon: '⬡' },
    { href: '/instances',    label: 'Instances',   icon: '◎' },
    { href: '/newsletter',   label: 'Newsletter',  icon: '◈' },
    { href: '/logs',         label: 'Logs',        icon: '▸' },
  ];
</script>

{#if !$page.url.pathname.startsWith('/auth')}
  <!-- Top nav -->
  <nav style="
    background: rgba(2,4,8,0.97);
    border-bottom: 1px solid rgba(56,78,180,0.25);
    backdrop-filter: blur(12px);
    position: sticky; top: 0; z-index: 100;
    padding: 0 1.5rem;
    display: flex; align-items: center; gap: 0; height: 52px;
  ">
    <!-- Logo -->
    <a href="/" style="
      display: flex; align-items: center; gap: 0.5rem;
      text-decoration: none; margin-right: 2rem;
    ">
      <span style="color: #3b82f6; font-size: 1.25rem;">◈</span>
      <span style="font-weight: 800; font-size: 0.9rem; letter-spacing: 0.1em; color: #f1f5f9;">OLYMPUS</span>
    </a>

    <!-- Nav links -->
    <div style="display: flex; align-items: center; gap: 0.25rem; flex: 1;">
      {#each navLinks as link}
        {@const active = $page.url.pathname === link.href || ($page.url.pathname.startsWith(link.href) && link.href !== '/')}
        <a href={link.href} style="
          display: flex; align-items: center; gap: 0.4rem;
          padding: 0.375rem 0.875rem;
          border-radius: 6px;
          font-size: 0.8rem; font-weight: 600;
          text-decoration: none;
          transition: all 0.15s;
          color: {active ? '#93c5fd' : '#64748b'};
          background: {active ? 'rgba(59,130,246,0.12)' : 'transparent'};
          border: 1px solid {active ? 'rgba(59,130,246,0.3)' : 'transparent'};
        ">
          <span style="font-size: 0.75rem;">{link.icon}</span>
          {link.label}
        </a>
      {/each}
    </div>

    <!-- Right side -->
    <div style="display: flex; align-items: center; gap: 1rem;">
      <span style="font-size: 0.7rem; color: #334155; font-family: monospace; letter-spacing: 0.05em;">
        NODYX COMMAND CENTER
      </span>
      <form method="POST" action="/auth/logout">
        <button type="submit" style="
          background: none; border: 1px solid rgba(239,68,68,0.25);
          color: #94a3b8; border-radius: 6px;
          padding: 0.25rem 0.75rem; font-size: 0.75rem;
          cursor: pointer; transition: all 0.15s;
        " onmouseenter={(e)=>{ (e.target as HTMLElement).style.color='#fca5a5'; (e.target as HTMLElement).style.borderColor='rgba(239,68,68,0.5)'; }}
           onmouseleave={(e)=>{ (e.target as HTMLElement).style.color='#94a3b8'; (e.target as HTMLElement).style.borderColor='rgba(239,68,68,0.25)'; }}>
          Déconnexion
        </button>
      </form>
    </div>
  </nav>
{/if}

<main style="min-height: calc(100vh - 52px);">
  {@render children()}
</main>
