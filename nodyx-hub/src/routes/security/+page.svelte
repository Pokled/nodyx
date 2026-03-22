<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';

  let { data } = $props();

  // Auto-refresh every 60s
  onMount(() => {
    const t = setInterval(() => invalidateAll(), 60_000);
    return () => clearInterval(t);
  });

  // Actualiser button with visual feedback
  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    await invalidateAll();
    refreshing = false;
  }

  // Expanded rows in the attack log
  let expanded = $state(new Set<string>());
  function toggleRow(id: string) {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id); else s.add(id);
    expanded = s;
  }

  const BAR_MAX_H = 56; // px

  // All derived from data so they update after invalidateAll()
  const maxHits  = $derived(Math.max(...data.timeline.map((t: any) => t.hits), 1));
  const maxPath  = $derived(Math.max(...data.topPaths.map((p: any) => parseInt(p.hits, 10)), 1));
  const maxTool  = $derived(Math.max(...data.toolBreakdown.map(([,n]: any) => n as number), 1));
  const maxIp    = $derived(Math.max(...data.topIps.map((ip: any) => parseInt(ip.hits, 10)), 1));

  function barH(hits: number, max: number) { return Math.max(2, Math.round((hits / max) * BAR_MAX_H)); }

  // Formatting
  function fmt(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) +
           ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtFull(iso: string): string {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  // Tool appearance
  function toolColor(tool: string): string {
    const t = tool.toLowerCase();
    if (['sqlmap','nikto','metasploit','hydra','acunetix','burp'].some(v => t.includes(v))) return '#ef4444';
    if (['nuclei','gobuster','dirbuster','nmap','masscan','nessus','openvas'].some(v => t.includes(v))) return '#f59e0b';
    if (['python','curl','wget','go http','zgrab'].some(v => t.includes(v))) return '#94a3b8';
    if (t === 'browser') return '#3b82f6';
    if (t === 'seo bot') return '#6366f1';
    return '#64748b';
  }
  function toolBadge(tool: string): string {
    const t = tool.toLowerCase();
    if (['sqlmap','nikto','metasploit','hydra','acunetix','burp'].some(v => t.includes(v))) return 'background:rgba(239,68,68,0.15);border-color:rgba(239,68,68,0.4);color:#fca5a5';
    if (['nuclei','gobuster','dirbuster','nmap','masscan','nessus','openvas'].some(v => t.includes(v))) return 'background:rgba(245,158,11,0.12);border-color:rgba(245,158,11,0.4);color:#fcd34d';
    if (['python','curl','wget','go http','zgrab'].some(v => t.includes(v))) return 'background:rgba(148,163,184,0.08);border-color:rgba(148,163,184,0.25);color:#94a3b8';
    if (t === 'browser') return 'background:rgba(59,130,246,0.12);border-color:rgba(59,130,246,0.3);color:#93c5fd';
    return 'background:rgba(100,116,139,0.1);border-color:rgba(100,116,139,0.3);color:#64748b';
  }

  // Method badge
  function methodStyle(m: string): string {
    if (m === 'GET')    return 'color:#6ee7b7';
    if (m === 'POST')   return 'color:#93c5fd';
    if (m === 'PUT')    return 'color:#fcd34d';
    if (m === 'DELETE') return 'color:#fca5a5';
    return 'color:#94a3b8';
  }

  // Filters for attack log
  let filterTool    = $state('');
  let filterCountry = $state('');
  let filterSearch  = $state('');
  let logLimit      = $state(50);

  // Expanded rows for credential harvest
  let expandedCreds = $state(new Set<number>());
  function toggleCred(i: number) {
    const s = new Set(expandedCreds);
    if (s.has(i)) s.delete(i); else s.add(i);
    expandedCreds = s;
  }

  const filteredHits = $derived(data.recentHits.filter((h: any) => {
    if (filterTool    && h.tool !== filterTool)                           return false;
    if (filterCountry && (h.country ?? '') !== filterCountry)             return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      if (!h.ip?.includes(q) && !h.path?.toLowerCase().includes(q) &&
          !h.isp?.toLowerCase().includes(q) && !h.incident_id?.toLowerCase().includes(q)) return false;
    }
    return true;
  }).slice(0, logLimit));

  const allTools     = $derived([...new Set(data.recentHits.map((h: any) => h.tool))].sort());
  const allCountries = $derived([...new Set(data.recentHits.map((h: any) => h.country).filter(Boolean))].sort());

  // CERT-FR reporting
  let certStatus = $state<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({});
  async function sendToCERT(incidentId: string) {
    certStatus = { ...certStatus, [incidentId]: 'sending' };
    try {
      const res = await fetch('/api/send-cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId }),
      });
      const json = await res.json();
      certStatus = { ...certStatus, [incidentId]: res.ok ? 'sent' : 'error' };
    } catch {
      certStatus = { ...certStatus, [incidentId]: 'error' };
    }
  }
</script>

<div style="padding: 1.5rem; max-width: 1600px; margin: 0 auto;">

  <!-- ══ Header ═══════════════════════════════════════════════════════════════ -->
  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem;">
    <div>
      <div style="display:flex; align-items:center; gap:0.75rem;">
        <span style="color:#ef4444; font-size:1.1rem;">⬡</span>
        <h1 style="font-family:monospace; font-size:1.1rem; font-weight:800; letter-spacing:0.12em; color:#f1f5f9; margin:0;">
          THREAT INTELLIGENCE CENTER
        </h1>
        <span style="
          display:inline-flex; align-items:center; gap:0.3rem;
          background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35);
          border-radius:4px; padding:0.15rem 0.5rem;
          font-size:0.65rem; font-family:monospace; color:#fca5a5; letter-spacing:0.08em;
        ">
          <span style="
            display:inline-block; width:5px; height:5px; border-radius:50%;
            background:#ef4444; box-shadow:0 0 6px #ef4444;
            animation: orb-pulse 1.5s ease-in-out infinite;
          "></span>
          LIVE
        </span>
      </div>
      <div style="font-size:0.72rem; color:#334155; font-family:monospace; margin-top:0.25rem;">
        Mis à jour — {fmt(data.updatedAt)} · Actualisation auto 60s
      </div>
    </div>
    <button onclick={refresh} disabled={refreshing} style="
      background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.25);
      color:{refreshing ? '#3b82f6' : '#64748b'}; border-radius:6px; padding:0.35rem 0.85rem;
      font-size:0.75rem; font-family:monospace; cursor:{refreshing ? 'wait' : 'pointer'};
      transition: color 0.2s;
    ">{refreshing ? '⟳ …' : '⟳ Actualiser'}</button>
  </div>

  <!-- ══ Stats row ════════════════════════════════════════════════════════════ -->
  <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:0.75rem; margin-bottom:1.25rem;">
    {#each [
      { label:'TOTAL HITS',      value: data.stats.total.toLocaleString('fr'),                color:'#94a3b8', glow:'',   sub:'' },
      { label:'DERNIÈRE HEURE',  value: data.stats.lastHour.toLocaleString('fr'),             color: data.stats.lastHour > 0 ? '#ef4444' : '#10b981', glow: data.stats.lastHour > 0 ? '0 0 12px rgba(239,68,68,0.3)' : '', sub:'' },
      { label:'AUJOURD\'HUI',    value: data.stats.today.toLocaleString('fr'),                color:'#f59e0b', glow:'',   sub:'' },
      { label:'7 JOURS',         value: data.stats.week7.toLocaleString('fr'),                color:'#f59e0b', glow:'',   sub:'' },
      { label:'IPs UNIQUES 30J', value: data.stats.uniqueIps30d.toLocaleString('fr'),         color:'#94a3b8', glow:'',   sub:'' },
      { label:'IPs VUES (LOCAL)',value: data.stats.blocked.toLocaleString('fr'),              color: data.stats.blocked > 0 ? '#ef4444' : '#10b981', glow: data.stats.blocked > 0 ? '0 0 12px rgba(239,68,68,0.3)' : '', sub:'toutes instances' },
      { label:'BLOQUÉES RÉSEAU', value: data.stats.networkBlocked.toLocaleString('fr'),       color: data.stats.networkBlocked > 0 ? '#ef4444' : '#475569', glow: data.stats.networkBlocked > 0 ? '0 0 12px rgba(239,68,68,0.3)' : '', sub:'≥2 instances' },
      { label:'INSTANCES',       value: data.stats.instances.toLocaleString('fr'),            color:'#3b82f6', glow:'',   sub:'' },
      { label:'PIXELS VUES',     value: data.pixelStats.total.toLocaleString('fr'),           color: data.pixelStats.today > 0 ? '#f59e0b' : '#475569', glow:'', sub:`${data.pixelStats.today} auj.` },
      { label:'CREDENTIALS',     value: data.credentialStats.total.toLocaleString('fr'),      color: data.credentialStats.today > 0 ? '#f472b6' : '#475569', glow: data.credentialStats.today > 0 ? '0 0 12px rgba(244,114,182,0.3)' : '', sub:`${data.credentialStats.today} auj.` },
    ] as stat}
      <div class="glass-card" style="padding:0.875rem 1rem; box-shadow:{stat.glow};">
        <div style="font-size:0.6rem; color:#334155; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.4rem;">
          {stat.label}
        </div>
        <div style="font-family:monospace; font-size:1.5rem; font-weight:700; color:{stat.color}; line-height:1;">
          {stat.value}
        </div>
        {#if stat.sub}
          <div style="font-size:0.58rem; color:#334155; font-family:monospace; margin-top:0.3rem;">{stat.sub}</div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- ══ Sparkline + Top paths + Tool breakdown ════════════════════════════ -->
  <div style="display:grid; grid-template-columns:1.6fr 1fr 1fr; gap:0.75rem; margin-bottom:1.25rem;">

    <!-- Sparkline 48h -->
    <div class="glass-card" style="padding:1rem;">
      <div style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.75rem;">
        // ACTIVITÉ — DERNIÈRES 48H
      </div>
      <div style="display:flex; align-items:flex-end; gap:2px; height:60px; overflow:hidden;">
        {#each data.timeline as bar, i}
          {@const isLast8 = i >= data.timeline.length - 8}
          <div
            title="{bar.label} — {bar.hits} hit{bar.hits !== 1 ? 's' : ''}"
            style="
              flex:1; height:{barH(bar.hits, maxHits)}px;
              background: {bar.hits > 0
                ? (isLast8 ? 'rgba(239,68,68,0.7)' : 'rgba(245,158,11,0.5)')
                : 'rgba(56,78,180,0.15)'};
              border-radius:2px 2px 0 0;
              transition: height 0.3s;
              min-width:2px;
              cursor:default;
            "
          ></div>
        {/each}
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:0.35rem;">
        <span style="font-size:0.6rem; color:#334155; font-family:monospace;">{data.timeline[0]?.label}</span>
        <span style="font-size:0.6rem; color:#ef4444; font-family:monospace;">now</span>
      </div>
    </div>

    <!-- Top targeted paths -->
    <div class="glass-card" style="padding:1rem; overflow:hidden;">
      <div style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.75rem;">
        // TOP PATHS CIBLÉS (30j)
      </div>
      <div style="display:flex; flex-direction:column; gap:0.3rem;">
        {#each data.topPaths as p}
          {@const hits = parseInt(p.hits, 10)}
          {@const pct  = Math.round((hits / maxPath) * 100)}
          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom:0.15rem;">
              <span style="font-size:0.68rem; font-family:monospace; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80%;"
                title={p.path}>{p.path}</span>
              <span style="font-size:0.68rem; font-family:monospace; color:#ef4444;">{hits}</span>
            </div>
            <div style="height:2px; background:rgba(56,78,180,0.15); border-radius:1px;">
              <div style="height:2px; width:{pct}%; background:rgba(239,68,68,0.6); border-radius:1px;"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Tool breakdown -->
    <div class="glass-card" style="padding:1rem; overflow:hidden;">
      <div style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.75rem;">
        // OUTILS DÉTECTÉS (100 derniers)
      </div>
      <div style="display:flex; flex-direction:column; gap:0.35rem;">
        {#each data.toolBreakdown as [tool, count]}
          {@const pct = Math.round((count / maxTool) * 100)}
          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom:0.15rem; align-items:center;">
              <span style="font-size:0.7rem; font-family:monospace; padding:0 0.35rem; border-radius:3px; border:1px solid; {toolBadge(tool)}">{tool}</span>
              <span style="font-size:0.68rem; font-family:monospace; color:{toolColor(tool)};">{count}</span>
            </div>
            <div style="height:2px; background:rgba(56,78,180,0.15); border-radius:1px;">
              <div style="height:2px; width:{pct}%; background:{toolColor(tool)}80; border-radius:1px;"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- ══ Top IPs offensives ══════════════════════════════════════════════════ -->
  <div class="glass-card" style="margin-bottom:1.25rem; overflow:hidden;">
    <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15); display:flex; align-items:center; justify-content:space-between;">
      <span style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em;">
        // TOP IPs OFFENSIVES — 30 derniers jours (instance locale)
      </span>
      <span style="font-size:0.65rem; color:#334155; font-family:monospace;">{data.topIps.length} IPs</span>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
            {#each ['IP','Hits','Pays','Ville','ISP / Org','Première vue','Dernière vue','Paths ciblés'] as col}
              <th style="padding:0.5rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each data.topIps as ip, i}
            {@const hits = parseInt(ip.hits, 10)}
            {@const pct  = Math.round((hits / maxIp) * 100)}
            <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.03)'}">
              <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.78rem; color:#ef4444; white-space:nowrap;">
                {ip.ip}
              </td>
              <td style="padding:0.5rem 0.875rem; min-width:80px;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <span style="font-family:monospace; font-size:0.78rem; color:#f59e0b; min-width:24px;">{hits}</span>
                  <div style="flex:1; height:3px; background:rgba(56,78,180,0.15); border-radius:2px; min-width:40px;">
                    <div style="height:3px; width:{pct}%; background:rgba(239,68,68,0.6); border-radius:2px;"></div>
                  </div>
                </div>
              </td>
              <td style="padding:0.5rem 0.875rem; font-size:0.75rem; color:#94a3b8;">{ip.country ?? '—'}</td>
              <td style="padding:0.5rem 0.875rem; font-size:0.75rem; color:#64748b;">{ip.city ?? '—'}</td>
              <td style="padding:0.5rem 0.875rem; font-size:0.72rem; color:#64748b; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="{ip.isp ?? ''} / {ip.org ?? ''}">
                {ip.isp ?? '—'}{ip.org && ip.org !== ip.isp ? ` / ${ip.org}` : ''}
              </td>
              <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">{fmt(ip.first_seen)}</td>
              <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#94a3b8; white-space:nowrap;">{fmt(ip.last_seen)}</td>
              <td style="padding:0.5rem 0.875rem; max-width:220px;">
                <div style="display:flex; flex-wrap:wrap; gap:0.25rem;">
                  {#each (ip.paths ?? []).slice(0, 4) as path}
                    <span style="
                      font-family:monospace; font-size:0.62rem; color:#64748b;
                      background:rgba(56,78,180,0.08); border:1px solid rgba(56,78,180,0.15);
                      border-radius:3px; padding:0.1rem 0.35rem;
                      overflow:hidden; text-overflow:ellipsis; max-width:120px; white-space:nowrap;
                    " title={path}>{path}</span>
                  {/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ══ Per-instance + Methods ═════════════════════════════════════════════ -->
  <div style="display:grid; grid-template-columns:2fr 1fr; gap:0.75rem; margin-bottom:1.25rem;">

    <!-- Per-instance -->
    <div class="glass-card" style="overflow:hidden;">
      <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15);">
        <span style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em;">
          // PAR INSTANCE — RÉSEAU NODYX (30j, depuis reported_ips)
        </span>
      </div>
      {#if data.byInstance.length === 0}
        <div style="padding:2rem; text-align:center; font-size:0.75rem; color:#334155; font-family:monospace;">
          Aucune donnée fédérée — les instances doivent avoir DIRECTORY_TOKEN configuré
        </div>
      {:else}
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
              {#each ['Instance','Hits','IPs uniques','1ère attaque','Dernière attaque','Top path'] as col}
                <th style="padding:0.5rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.byInstance as inst, i}
              <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.03)'}">
                <td style="padding:0.5rem 0.875rem;">
                  <span style="
                    font-family:monospace; font-size:0.75rem; color:#93c5fd;
                    background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.2);
                    border-radius:4px; padding:0.1rem 0.45rem;
                  ">{inst.instance_slug}</span>
                </td>
                <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.78rem; color:#f59e0b;">{inst.total_hits}</td>
                <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.75rem; color:#94a3b8;">{inst.unique_ips}</td>
                <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">{fmt(inst.first_hit)}</td>
                <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#94a3b8; white-space:nowrap;">{fmt(inst.last_hit)}</td>
                <td style="padding:0.5rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#64748b; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={inst.top_path ?? ''}>{inst.top_path ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Methods breakdown -->
    <div class="glass-card" style="padding:1rem; overflow:hidden;">
      <div style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.875rem;">
        // MÉTHODES HTTP (30j)
      </div>
      {#each data.topMethods as m}
        {@const hits = parseInt(m.hits, 10)}
        {@const maxM = Math.max(...data.topMethods.map((x: any) => parseInt(x.hits, 10)), 1)}
        {@const pct  = Math.round((hits / maxM) * 100)}
        <div style="margin-bottom:0.6rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:0.2rem;">
            <span style="font-family:monospace; font-size:0.8rem; font-weight:700; {methodStyle(m.method)}">{m.method}</span>
            <span style="font-family:monospace; font-size:0.75rem; color:#94a3b8;">{hits.toLocaleString('fr')}</span>
          </div>
          <div style="height:3px; background:rgba(56,78,180,0.15); border-radius:2px;">
            <div style="height:3px; width:{pct}%; background:rgba(148,163,184,0.4); border-radius:2px;"></div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- ══ Blocklist locale (toutes les IPs vues) ════════════════════════════ -->
  {#if data.localBlocklist.length > 0}
    <div class="glass-card" style="margin-bottom:1.25rem; overflow:hidden;">
      <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15); display:flex; align-items:center; justify-content:space-between;">
        <div>
          <span style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em;">
            // MENACES DÉTECTÉES — toutes les IPs ayant touché le honeypot (local)
          </span>
          <span style="font-size:0.62rem; color:#334155; font-family:monospace; margin-left:0.75rem;">
            Bloquées automatiquement via fail2ban
          </span>
        </div>
        <span style="
          background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3);
          border-radius:4px; padding:0.15rem 0.5rem;
          font-size:0.65rem; font-family:monospace; color:#fca5a5;
        ">{data.localBlocklist.length} IP{data.localBlocklist.length > 1 ? 's' : ''}</span>
      </div>
      <div style="overflow-x:auto; max-height:300px; overflow-y:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead style="position:sticky; top:0; background:rgba(2,4,8,0.98);">
            <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
              {#each ['IP','Hits','Pays','Ville','ISP / Org','1ère vue','Dernière vue','Paths'] as col}
                <th style="padding:0.45rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.localBlocklist as entry, i}
              <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.03)'}">
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.78rem; color:#ef4444; white-space:nowrap;">{entry.ip}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.78rem; color:#f59e0b;">{entry.total_hits}</td>
                <td style="padding:0.4rem 0.875rem; font-size:0.73rem; color:#94a3b8;">{entry.country ?? '—'}</td>
                <td style="padding:0.4rem 0.875rem; font-size:0.72rem; color:#64748b;">{entry.city ?? '—'}</td>
                <td style="padding:0.4rem 0.875rem; font-size:0.7rem; color:#64748b; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="{entry.isp ?? ''} / {entry.org ?? ''}">{entry.isp ?? '—'}{entry.org && entry.org !== entry.isp ? ` / ${entry.org}` : ''}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.68rem; color:#475569; white-space:nowrap;">{fmt(entry.first_seen)}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.68rem; color:#94a3b8; white-space:nowrap;">{fmt(entry.last_seen)}</td>
                <td style="padding:0.4rem 0.875rem; max-width:200px;">
                  <div style="display:flex; flex-wrap:wrap; gap:0.2rem;">
                    {#each (entry.paths ?? []).slice(0, 3) as path}
                      <span style="font-family:monospace; font-size:0.6rem; color:#475569; background:rgba(56,78,180,0.08); border:1px solid rgba(56,78,180,0.15); border-radius:3px; padding:0.05rem 0.3rem; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={path}>{path}</span>
                    {/each}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- ══ Blocklist réseau (fédérée, multi-instances) ════════════════════════ -->
  {#if data.networkBlocklist.length > 0}
    <div class="glass-card" style="margin-bottom:1.25rem; overflow:hidden;">
      <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15); display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em;">
          // BLOCKLIST RÉSEAU — IPs confirmées par ≥2 instances Nodyx (30j)
        </span>
        <span style="
          background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3);
          border-radius:4px; padding:0.15rem 0.5rem;
          font-size:0.65rem; font-family:monospace; color:#fca5a5;
        ">{data.networkBlocklist.length} IP{data.networkBlocklist.length > 1 ? 's' : ''} réseau</span>
      </div>
      <div style="overflow-x:auto; max-height:240px; overflow-y:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead style="position:sticky; top:0; background:rgba(2,4,8,0.98);">
            <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
              {#each ['IP','Hits','Instances','1ère vue','Dernière vue'] as col}
                <th style="padding:0.45rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.networkBlocklist as entry, i}
              <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.03)'}">
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.78rem; color:#ef4444;">{entry.ip}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.78rem; color:#f59e0b;">{entry.total_hits}</td>
                <td style="padding:0.4rem 0.875rem;">
                  <div style="display:flex; gap:0.25rem; flex-wrap:wrap;">
                    {#each (entry.instances ?? []) as slug}
                      <span style="font-family:monospace; font-size:0.65rem; color:#93c5fd; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.2); border-radius:3px; padding:0.1rem 0.35rem;">{slug}</span>
                    {/each}
                  </div>
                </td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">{fmt(entry.first_seen)}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#94a3b8; white-space:nowrap;">{fmt(entry.last_seen)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- ══ Tracking Pixel hits ════════════════════════════════════════════════ -->
  <div class="glass-card" style="margin-bottom:1.25rem; overflow:hidden;">
      <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15); display:flex; align-items:center; justify-content:space-between;">
        <div>
          <span style="font-size:0.65rem; color:#f59e0b; font-family:monospace; letter-spacing:0.1em;">
            // TRACKING PIXEL — revisites &amp; chargements suspects
          </span>
          <span style="font-size:0.62rem; color:#334155; font-family:monospace; margin-left:0.75rem;">
            Fire à chaque chargement de la page piège · alerte Discord si revisit &gt; 30s
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:0.6rem; color:#475569; font-family:monospace;">{data.pixelStats.today} aujourd'hui</span>
          <span style="
            background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3);
            border-radius:4px; padding:0.15rem 0.5rem;
            font-size:0.65rem; font-family:monospace; color:#fcd34d;
          ">{data.pixelStats.total} vues · {data.pixelStats.uniqueIncidents} incidents</span>
        </div>
      </div>
      {#if data.pixelHits && data.pixelHits.length > 0}
        <div style="overflow-x:auto; max-height:280px; overflow-y:auto;">
          <table style="width:100%; border-collapse:collapse;">
            <thead style="position:sticky; top:0; background:rgba(2,4,8,0.98);">
              <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
                {#each ['Heure','Incident','IP originale','IP pixel','Pays / ISP','Path','Referer'] as col}
                  <th style="padding:0.45rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each data.pixelHits as hit, i}
                {@const sameIp = hit.pixel_ip === hit.original_ip}
                <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.03)'}">
                  <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">{fmt(hit.viewed_at)}</td>
                  <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.68rem; color:#f59e0b;">{hit.incident_id}</td>
                  <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.75rem; color:#ef4444;">{hit.original_ip ?? '—'}</td>
                  <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.75rem; color:{sameIp ? '#94a3b8' : '#f472b6'};">
                    {hit.pixel_ip ?? '—'}{!sameIp ? ' ←' : ''}
                  </td>
                  <td style="padding:0.4rem 0.875rem; font-size:0.7rem; color:#64748b; white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis;" title="{hit.country ?? ''} · {hit.isp ?? ''}">{hit.country ?? '—'}{hit.isp ? ` · ${hit.isp}` : ''}</td>
                  <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.68rem; color:#64748b; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={hit.original_path ?? ''}>{hit.original_path ?? '—'}</td>
                  <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.65rem; color:#334155; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={hit.referer ?? ''}>{hit.referer || '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div style="padding:2rem; text-align:center; font-size:0.75rem; color:#334155; font-family:monospace; letter-spacing:0.05em;">
          Aucun pixel chargé — la section apparaîtra dès qu'un attaquant visitera la page piège
        </div>
      {/if}
    </div>

  <!-- ══ Pièges actifs ══════════════════════════════════════════════════════ -->
  <div class="glass-card" style="margin-bottom:1.25rem; overflow:hidden;">
    <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15); display:flex; align-items:center; justify-content:space-between;">
      <span style="font-size:0.65rem; color:#10b981; font-family:monospace; letter-spacing:0.1em;">
        // PIÈGES ACTIFS — logins, canary files, honeytokens (30j)
      </span>
      <span style="font-size:0.65rem; color:#334155; font-family:monospace;">{data.trapStats?.length ?? 0} pièges touchés</span>
    </div>
    {#if data.trapStats && data.trapStats.length > 0}
      <div style="overflow-x:auto; max-height:260px; overflow-y:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead style="position:sticky; top:0; background:rgba(2,4,8,0.98);">
            <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
              {#each ['Type','Cible','Hits','Dernière alerte'] as col}
                <th style="padding:0.45rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.trapStats as trap, i}
              {@const typeColor = trap.trap_type === 'honeytoken' ? '#00ff88' : trap.trap_type === 'login' ? '#f472b6' : '#f59e0b'}
              {@const typeLabel = trap.trap_type === 'honeytoken' ? '🎯 Honeytoken' : trap.trap_type === 'login' ? '🔑 Faux login' : '📄 Canary file'}
              <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.025)'}">
                <td style="padding:0.4rem 0.875rem;">
                  <span style="font-family:monospace; font-size:0.72rem; color:{typeColor};">{typeLabel}</span>
                </td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.75rem; color:#94a3b8; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={trap.target}>{trap.target}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.8rem; font-weight:700; color:{typeColor};">{trap.hits}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">{fmt(trap.last_hit)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div style="padding:2rem; text-align:center; font-size:0.75rem; color:#334155; font-family:monospace; letter-spacing:0.05em;">
        Aucun piège déclenché pour l'instant
      </div>
    {/if}
  </div>

  <!-- ══ Fingerprints récurrents ═════════════════════════════════════════════ -->
  {#if data.fingerprints && data.fingerprints.length > 0}
    <div class="glass-card" style="margin-bottom:1.25rem; overflow:hidden;">
      <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15); display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:0.65rem; color:#f472b6; font-family:monospace; letter-spacing:0.1em;">
          // ATTAQUANTS RÉCURRENTS — empreintes canvas persistantes
        </span>
        <span style="
          background:rgba(244,114,182,0.12); border:1px solid rgba(244,114,182,0.3);
          border-radius:4px; padding:0.15rem 0.5rem;
          font-size:0.65rem; font-family:monospace; color:#f9a8d4;
        ">{data.fingerprints.length} empreinte{data.fingerprints.length > 1 ? 's' : ''}</span>
      </div>
      <div style="overflow-x:auto; max-height:260px; overflow-y:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead style="position:sticky; top:0; background:rgba(2,4,8,0.98);">
            <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
              {#each ['Fingerprint hash','IPs utilisées','Visites','Première vue','Dernière vue'] as col}
                <th style="padding:0.45rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.fingerprints as fp, i}
              <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.025)'}">
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.72rem; color:#94a3b8;">{fp.fp_hash?.slice(0, 16) ?? '—'}…</td>
                <td style="padding:0.4rem 0.875rem; max-width:220px;">
                  <div style="display:flex; flex-wrap:wrap; gap:0.2rem;">
                    {#each (fp.ip_list ?? []).slice(0, 4) as ipAddr}
                      <span style="font-family:monospace; font-size:0.68rem; color:#ef4444; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:3px; padding:0.05rem 0.3rem;">{ipAddr}</span>
                    {/each}
                    {#if (fp.ip_list ?? []).length > 4}
                      <span style="font-size:0.65rem; color:#475569; font-family:monospace;">+{fp.ip_list.length - 4}</span>
                    {/if}
                  </div>
                </td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.82rem; font-weight:700; color:{fp.visits > 5 ? '#ef4444' : fp.visits > 2 ? '#f59e0b' : '#94a3b8'};">{fp.visits}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">{fmt(fp.first_seen)}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#94a3b8; white-space:nowrap;">{fmt(fp.last_seen)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- ══ Credential Harvest ════════════════════════════════════════════════ -->
  <div class="glass-card" style="margin-bottom:1.25rem; overflow:hidden;">
    <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15); display:flex; align-items:center; justify-content:space-between;">
      <div>
        <span style="font-size:0.65rem; color:#f472b6; font-family:monospace; letter-spacing:0.1em;">
          // CREDENTIAL HARVEST — tentatives de connexion sur faux formulaires
        </span>
        <span style="font-size:0.62rem; color:#334155; font-family:monospace; margin-left:0.75rem;">
          wp-admin, phpmyadmin, adminer, /login, /panel…
        </span>
      </div>
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <span style="font-size:0.6rem; color:#475569; font-family:monospace;">{data.credentialStats.today} aujourd'hui · {data.credentialStats.uniqueIps} IPs</span>
        <span style="
          background:rgba(244,114,182,0.12); border:1px solid rgba(244,114,182,0.3);
          border-radius:4px; padding:0.15rem 0.5rem;
          font-size:0.65rem; font-family:monospace; color:#f9a8d4;
        ">{data.credentialStats.total} tentatives</span>
      </div>
    </div>
    {#if data.credentialAttempts && data.credentialAttempts.length > 0}
      <div style="overflow-x:auto; max-height:320px; overflow-y:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead style="position:sticky; top:0; background:rgba(2,4,8,0.98);">
            <tr style="border-bottom:1px solid rgba(56,78,180,0.1);">
              {#each ['Heure','IP','Pays / ISP','Path tenté','Username','Password',''] as col}
                <th style="padding:0.45rem 0.875rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.credentialAttempts as attempt, i}
              {@const isExpCred = expandedCreds.has(i)}
              {@const maskedPass = attempt.password ? (attempt.password.slice(0, 3) + '***') : '(vide)'}
              <tr style="border-bottom:1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.025)'}">
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">{fmt(attempt.attempted_at)}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.75rem; color:#ef4444; white-space:nowrap;">{attempt.ip}</td>
                <td style="padding:0.4rem 0.875rem; font-size:0.7rem; color:#64748b; white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis;" title="{attempt.country ?? ''} · {attempt.isp ?? ''}">{attempt.country ?? '—'}{attempt.isp ? ` · ${attempt.isp}` : ''}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.7rem; color:#f59e0b; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={attempt.login_path}>{attempt.login_path}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.75rem; color:#f472b6;">{attempt.username || '(vide)'}</td>
                <td style="padding:0.4rem 0.875rem; font-family:monospace; font-size:0.75rem; color:{isExpCred ? '#fca5a5' : '#64748b'};">
                  {isExpCred ? (attempt.password || '(vide)') : maskedPass}
                </td>
                <td style="padding:0.4rem 0.875rem;">
                  <button
                    onclick={() => toggleCred(i)}
                    style="
                      background:rgba(244,114,182,0.1); border:1px solid rgba(244,114,182,0.2);
                      color:#f9a8d4; border-radius:4px; padding:0.15rem 0.45rem;
                      font-size:0.65rem; font-family:monospace; cursor:pointer;
                    ">{isExpCred ? 'masquer' : 'voir'}</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div style="padding:2rem; text-align:center; font-size:0.75rem; color:#334155; font-family:monospace; letter-spacing:0.05em;">
        Aucune tentative — la section apparaîtra dès qu'un attaquant soumettra le faux formulaire de login
      </div>
    {/if}
  </div>

  <!-- ══ Attack log ═════════════════════════════════════════════════════════ -->
  <div class="glass-card" style="overflow:hidden;">
    <div style="padding:0.875rem 1.125rem; border-bottom:1px solid rgba(56,78,180,0.15);">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
        <span style="font-size:0.65rem; color:#475569; font-family:monospace; letter-spacing:0.1em;">
          // JOURNAL D'ATTAQUES RÉCENTES — {filteredHits.length} / {data.recentHits.length} entrée{data.recentHits.length > 1 ? 's' : ''}
        </span>
        <span style="font-size:0.65rem; color:#334155; font-family:monospace;">
          Cliquer une ligne pour déplier le détail complet
        </span>
      </div>
      <!-- Filters -->
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <input
          placeholder="Recherche IP / path / ISP / ID…"
          bind:value={filterSearch}
          style="
            background:rgba(8,12,28,0.8); border:1px solid rgba(56,78,180,0.25);
            border-radius:6px; padding:0.35rem 0.65rem; color:#f1f5f9;
            font-size:0.75rem; font-family:monospace; outline:none; width:220px;
          "
        />
        <select bind:value={filterTool} style="
          background:rgba(8,12,28,0.8); border:1px solid rgba(56,78,180,0.25);
          border-radius:6px; padding:0.35rem 0.65rem; color:#94a3b8;
          font-size:0.75rem; font-family:monospace; outline:none;
        ">
          <option value="">Tous les outils</option>
          {#each allTools as t}<option value={t}>{t}</option>{/each}
        </select>
        <select bind:value={filterCountry} style="
          background:rgba(8,12,28,0.8); border:1px solid rgba(56,78,180,0.25);
          border-radius:6px; padding:0.35rem 0.65rem; color:#94a3b8;
          font-size:0.75rem; font-family:monospace; outline:none;
        ">
          <option value="">Tous les pays</option>
          {#each allCountries as c}<option value={c}>{c}</option>{/each}
        </select>
        {#if filterTool || filterCountry || filterSearch}
          <button onclick={() => { filterTool = ''; filterCountry = ''; filterSearch = ''; }} style="
            background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25);
            color:#fca5a5; border-radius:6px; padding:0.35rem 0.65rem;
            font-size:0.75rem; cursor:pointer;
          ">✕ Effacer</button>
        {/if}
      </div>
    </div>

    <div style="overflow-x:auto; max-height:600px; overflow-y:auto;">
      <table style="width:100%; border-collapse:collapse;">
        <thead style="position:sticky; top:0; background:rgba(2,4,8,0.98); z-index:10;">
          <tr style="border-bottom:1px solid rgba(56,78,180,0.15);">
            {#each ['Date / Heure','IP','Pays / Ville','ISP','Outil','M.','Path','Réf.'] as col}
              <th style="padding:0.5rem 0.75rem; text-align:left; font-size:0.62rem; color:#334155; font-family:monospace; font-weight:600; letter-spacing:0.08em; white-space:nowrap;">{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each filteredHits as hit, i}
            {@const isExp = expanded.has(hit.incident_id)}
            <!-- Main row -->
            <tr
              onclick={() => toggleRow(hit.incident_id)}
              style="
                border-bottom: {isExp ? '0' : '1px solid rgba(56,78,180,0.06)'};
                cursor:pointer;
                background: {isExp ? 'rgba(239,68,68,0.05)' : (i % 2 === 0 ? 'transparent' : 'rgba(56,78,180,0.025)')};
                transition: background 0.1s;
              "
            >
              <td style="padding:0.45rem 0.75rem; font-family:monospace; font-size:0.7rem; color:#475569; white-space:nowrap;">
                {fmtFull(hit.created_at)}
              </td>
              <td style="padding:0.45rem 0.75rem; font-family:monospace; font-size:0.78rem; color:#ef4444; white-space:nowrap;">
                {hit.ip}
              </td>
              <td style="padding:0.45rem 0.75rem; font-size:0.73rem; color:#94a3b8; white-space:nowrap;">
                {hit.country ?? '—'}{hit.city ? ` / ${hit.city}` : ''}
              </td>
              <td style="padding:0.45rem 0.75rem; font-size:0.7rem; color:#64748b; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={hit.isp ?? ''}>
                {hit.isp ?? '—'}
              </td>
              <td style="padding:0.45rem 0.75rem;">
                <span style="font-family:monospace; font-size:0.68rem; padding:0.1rem 0.4rem; border-radius:3px; border:1px solid; {toolBadge(hit.tool)}">
                  {hit.tool}
                </span>
              </td>
              <td style="padding:0.45rem 0.75rem; font-family:monospace; font-size:0.75rem; font-weight:700; {methodStyle(hit.method)}">
                {hit.method}
              </td>
              <td style="padding:0.45rem 0.75rem; font-family:monospace; font-size:0.72rem; color:#64748b; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={hit.path}>
                {hit.path}
              </td>
              <td style="padding:0.45rem 0.75rem; font-family:monospace; font-size:0.65rem; color:#334155;">
                {hit.incident_id}
              </td>
            </tr>

            <!-- Expanded detail -->
            {#if isExp}
              <tr style="border-bottom:1px solid rgba(239,68,68,0.15);">
                <td colspan="8" style="padding:0; background:rgba(2,4,8,0.6);">
                  <div style="padding:1rem 1.25rem; display:grid; grid-template-columns:repeat(3,1fr); gap:1rem;">

                    <!-- Network info -->
                    <div>
                      <div style="font-size:0.6rem; color:#334155; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.5rem;">// RÉSEAU</div>
                      {#each [
                        ['IP',         hit.ip],
                        ['Pays',       hit.country ?? '—'],
                        ['Ville',      hit.city ?? '—'],
                        ['ISP',        hit.isp ?? '—'],
                        ['Org',        hit.org ?? '—'],
                      ] as [k,v]}
                        <div style="display:flex; gap:0.5rem; margin-bottom:0.25rem;">
                          <span style="font-size:0.68rem; color:#475569; font-family:monospace; min-width:60px;">{k}</span>
                          <span style="font-size:0.68rem; color:#94a3b8; font-family:monospace; word-break:break-all;">{v}</span>
                        </div>
                      {/each}
                    </div>

                    <!-- Request info -->
                    <div>
                      <div style="font-size:0.6rem; color:#334155; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.5rem;">// REQUÊTE</div>
                      {#each [
                        ['Méthode',    hit.method],
                        ['Path',       hit.path],
                        ['Outil',      hit.tool],
                        ['Date',       fmtFull(hit.created_at)],
                        ['Réf.',       hit.incident_id],
                      ] as [k,v]}
                        <div style="display:flex; gap:0.5rem; margin-bottom:0.25rem;">
                          <span style="font-size:0.68rem; color:#475569; font-family:monospace; min-width:60px;">{k}</span>
                          <span style="font-size:0.68rem; color:#94a3b8; font-family:monospace; word-break:break-all;">{v}</span>
                        </div>
                      {/each}
                    </div>

                    <!-- User-Agent -->
                    <div>
                      <div style="font-size:0.6rem; color:#334155; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.5rem;">// USER-AGENT</div>
                      <div style="font-size:0.68rem; color:#64748b; font-family:monospace; word-break:break-all; line-height:1.5;">
                        {hit.user_agent ?? '—'}
                      </div>
                    </div>

                    <!-- Headers dump -->
                    {#if hit.headers}
                      <div style="grid-column:1/-1;">
                        <div style="font-size:0.6rem; color:#334155; font-family:monospace; letter-spacing:0.1em; margin-bottom:0.5rem;">// HEADERS HTTP COMPLETS</div>
                        <div style="
                          background:rgba(0,0,0,0.4); border:1px solid rgba(56,78,180,0.2);
                          border-radius:6px; padding:0.75rem 0.875rem;
                          font-size:0.68rem; font-family:monospace; color:#64748b;
                          line-height:1.7; max-height:180px; overflow-y:auto;
                        ">
                          {#each Object.entries(typeof hit.headers === 'string' ? JSON.parse(hit.headers) : (hit.headers ?? {})) as [hk, hv]}
                            <div>
                              <span style="color:#3b82f6;">{hk}:</span>
                              <span style="color:#94a3b8; margin-left:0.4rem;">{String(hv)}</span>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}

                    <!-- CERT-FR action -->
                    {#if true}
                      {@const cs = certStatus[hit.incident_id] ?? 'idle'}
                      <div style="grid-column:1/-1; margin-top:0.25rem; padding-top:0.75rem; border-top:1px solid rgba(239,68,68,0.1); display:flex; align-items:center; gap:0.75rem;">
                        <button
                          onclick={() => sendToCERT(hit.incident_id)}
                          disabled={cs === 'sending' || cs === 'sent'}
                          style="
                            display:flex; align-items:center; gap:0.4rem;
                            background:{cs === 'sent' ? 'rgba(16,185,129,0.12)' : cs === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.1)'};
                            border:1px solid {cs === 'sent' ? 'rgba(16,185,129,0.4)' : cs === 'error' ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)'};
                            color:{cs === 'sent' ? '#6ee7b7' : '#fca5a5'};
                            border-radius:6px; padding:0.35rem 0.875rem;
                            font-size:0.72rem; font-family:monospace; cursor:{cs === 'sending' || cs === 'sent' ? 'default' : 'pointer'};
                            transition:all 0.2s; font-weight:600; letter-spacing:0.04em;
                          "
                        >
                          {#if cs === 'sending'}
                            <span style="display:inline-block; animation:spin 0.8s linear infinite;">⟳</span> Envoi en cours…
                          {:else if cs === 'sent'}
                            ✓ Transmis au CERT
                          {:else if cs === 'error'}
                            ✕ Echec — réessayer
                          {:else}
                            ⚑ Transmettre au CERT-FR
                          {/if}
                        </button>
                        {#if cs === 'sent'}
                          <span style="font-size:0.68rem; color:#475569; font-family:monospace;">
                            Rapport envoyé — incident {hit.incident_id} signalé
                          </span>
                        {/if}
                        {#if cs === 'error'}
                          <span style="font-size:0.68rem; color:#ef4444; font-family:monospace;">
                            Vérifiez la config SMTP dans .env
                          </span>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    {#if logLimit < data.recentHits.length}
      <div style="padding:0.75rem 1.125rem; border-top:1px solid rgba(56,78,180,0.1); text-align:center;">
        <button onclick={() => logLimit += 50} style="
          background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.2);
          color:#64748b; border-radius:6px; padding:0.4rem 1.5rem;
          font-size:0.75rem; font-family:monospace; cursor:pointer;
        ">Charger 50 de plus ({data.recentHits.length - logLimit} restants)</button>
      </div>
    {/if}
  </div>

</div>
