<script lang="ts">
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import { instanceStatus, timeAgo } from '$lib/utils.js';

  let { data } = $props();

  // Map
  let mapEl: HTMLDivElement;
  let mapLoaded = $state(false);

  onMount(async () => {
    const L = (await import('leaflet')).default;

    const map = L.map(mapEl, {
      center: [20, 10],
      zoom: 2,
      zoomControl: true,
      attributionControl: true,
      minZoom: 2,
      maxZoom: 10,
    });

    // CartoDB Dark Matter tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Add instance markers
    for (const inst of data.instances) {
      if (!inst.lat || !inst.lng) continue;
      const st = instanceStatus(inst);
      const colors: Record<string, string> = {
        online:  '#10b981',
        warning: '#f59e0b',
        danger:  '#ef4444',
        banned:  '#475569',
      };
      const color = colors[st] ?? '#64748b';

      const icon = L.divIcon({
        html: `<div style="
          width:12px; height:12px; border-radius:50%;
          background:${color};
          box-shadow: 0 0 8px ${color}, 0 0 16px ${color}40;
          position: relative;
        ">
          ${st === 'online' ? `<div style="
            position:absolute; inset:-6px; border-radius:50%;
            border:1px solid ${color}60;
            animation: ring-expand 2s ease-out infinite;
          "></div>` : ''}
        </div>`,
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -10],
      });

      const lastSeen = inst.last_seen ? timeAgo(inst.last_seen) : 'jamais';
      const popup = L.popup({
        className: 'hub-popup',
        maxWidth: 240,
      }).setContent(`
        <div style="background:rgba(8,12,28,0.97);border:1px solid rgba(56,78,180,0.3);border-radius:10px;padding:12px;color:#f1f5f9;font-family:system-ui;min-width:200px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};flex-shrink:0;"></div>
            <span style="font-weight:700;font-size:0.9rem;">${inst.name}</span>
          </div>
          <div style="font-size:0.75rem;color:#64748b;margin-bottom:6px;font-family:monospace;">${inst.url}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:0.75rem;">
            <span style="color:#64748b;">Membres</span><span style="font-family:monospace;">${inst.members}</span>
            <span style="color:#64748b;">En ligne</span><span style="font-family:monospace;">${inst.online}</span>
            <span style="color:#64748b;">Version</span><span style="font-family:monospace;">${inst.version ?? '—'}</span>
            <span style="color:#64748b;">Vu</span><span style="font-family:monospace;">${lastSeen}</span>
            ${inst.geo_city ? `<span style="color:#64748b;">Ville</span><span style="font-family:monospace;">${inst.geo_city}</span>` : ''}
          </div>
        </div>
      `);

      L.marker([inst.lat, inst.lng], { icon }).addTo(map).bindPopup(popup);
    }

    mapLoaded = true;
  });

  // Derived stats
  const onlineCount  = $derived(data.instances.filter(i => instanceStatus(i) === 'online').length);
  const warningCount = $derived(data.instances.filter(i => instanceStatus(i) === 'warning').length);
  const dangerCount  = $derived(data.instances.filter(i => ['danger','banned'].includes(instanceStatus(i))).length);

  function fmtUptime(s: number) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    if (d > 0) return `${d}j ${h}h`;
    return `${h}h`;
  }
</script>

<svelte:head><title>Olympus — Dashboard</title></svelte:head>

<!-- MAP HERO -->
<div style="position: relative; height: 44vh; min-height: 320px; background: #030610; overflow: hidden;">
  <!-- Map -->
  <div bind:this={mapEl} id="hub-map" style="width:100%; height:100%;"></div>

  <!-- Overlay: top-left title -->
  <div style="
    position: absolute; top: 1rem; left: 1rem; z-index: 500;
    display: flex; align-items: center; gap: 0.75rem;
    pointer-events: none;
  ">
    <div style="
      background: rgba(2,4,8,0.85);
      border: 1px solid rgba(56,78,180,0.3);
      border-radius: 8px;
      padding: 0.5rem 1rem;
      backdrop-filter: blur(8px);
    ">
      <span style="font-family:monospace; font-size:0.7rem; color:#3b82f6; letter-spacing:0.1em;">
        GLOBAL NETWORK — LIVE
      </span>
    </div>
  </div>

  <!-- Overlay: bottom status legend -->
  <div style="
    position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%); z-index: 500;
    display: flex; align-items: center; gap: 1.25rem;
    background: rgba(2,4,8,0.85);
    border: 1px solid rgba(56,78,180,0.25);
    border-radius: 20px;
    padding: 0.5rem 1.5rem;
    backdrop-filter: blur(8px);
    pointer-events: none;
  ">
    <div style="display:flex;align-items:center;gap:0.4rem;">
      <div style="width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981;"></div>
      <span style="font-size:0.75rem;font-family:monospace;color:#10b981;">{onlineCount} EN LIGNE</span>
    </div>
    <div style="width:1px;height:12px;background:rgba(56,78,180,0.3);"></div>
    <div style="display:flex;align-items:center;gap:0.4rem;">
      <div style="width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 6px #f59e0b;"></div>
      <span style="font-size:0.75rem;font-family:monospace;color:#f59e0b;">{warningCount} AVERTISSEMENT</span>
    </div>
    <div style="width:1px;height:12px;background:rgba(56,78,180,0.3);"></div>
    <div style="display:flex;align-items:center;gap:0.4rem;">
      <div style="width:8px;height:8px;border-radius:50%;background:#ef4444;"></div>
      <span style="font-size:0.75rem;font-family:monospace;color:#ef4444;">{dangerCount} HORS LIGNE</span>
    </div>
  </div>

  {#if !mapLoaded}
    <div style="
      position:absolute;inset:0;z-index:400;
      display:flex;align-items:center;justify-content:center;
      background:#030610;
    ">
      <span style="color:#3b82f6;font-family:monospace;font-size:0.8rem;letter-spacing:0.1em;">
        CHARGEMENT DE LA CARTE...
      </span>
    </div>
  {/if}
</div>

<!-- STATS BAR -->
<div style="
  background: rgba(5,8,20,0.95);
  border-bottom: 1px solid rgba(56,78,180,0.2);
  padding: 0.875rem 1.5rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
">
  {#each [
    { label: 'INSTANCES ACTIVES', value: `${data.stats.active} / ${data.stats.total}`, color: '#3b82f6' },
    { label: 'MEMBRES TOTAL',     value: String(data.stats.totalMembers),               color: '#8b5cf6' },
    { label: 'EN LIGNE',          value: String(data.stats.onlineMembers),              color: '#10b981' },
    { label: 'CPU SERVEUR',       value: `${data.sys.cpu_pct}%`,                        color: data.sys.cpu_pct > 80 ? '#ef4444' : data.sys.cpu_pct > 60 ? '#f59e0b' : '#10b981' },
    { label: 'RAM',               value: `${data.sys.mem_pct}%`,                        color: data.sys.mem_pct > 85 ? '#ef4444' : data.sys.mem_pct > 70 ? '#f59e0b' : '#10b981' },
    { label: 'DISQUE',            value: `${data.sys.disk_pct}%`,                       color: data.sys.disk_pct > 85 ? '#ef4444' : data.sys.disk_pct > 70 ? '#f59e0b' : '#10b981' },
    { label: 'UPTIME SERVEUR',    value: fmtUptime(data.sys.uptime_s),                  color: '#64748b' },
  ] as stat}
    <div style="text-align:center;">
      <div style="font-family:monospace;font-size:1.4rem;font-weight:700;color:{stat.color};line-height:1;">
        {stat.value}
      </div>
      <div style="font-size:0.62rem;color:#334155;letter-spacing:0.1em;margin-top:0.25rem;font-family:monospace;">
        {stat.label}
      </div>
    </div>
  {/each}
</div>

<!-- INSTANCES GRID -->
<div style="padding: 1.5rem; max-width: 1400px; margin: 0 auto;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
    <h2 style="font-size:0.8rem;font-weight:700;color:#475569;letter-spacing:0.1em;font-family:monospace;margin:0;">
      INSTANCES RÉSEAU
    </h2>
    <a href="/instances" style="font-size:0.75rem;color:#3b82f6;text-decoration:none;">
      Gérer toutes les instances →
    </a>
  </div>

  <div style="
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  ">
    {#each data.instances.filter(i => i.status !== 'banned') as inst}
      {@const st = instanceStatus(inst)}
      {@const colors: Record<string,string> = { online:'#10b981', warning:'#f59e0b', danger:'#ef4444', banned:'#475569' }}
      {@const color = colors[st]}
      <div class="glass-card" style="padding: 1.25rem; position: relative; overflow: hidden;">
        <!-- Glow accent top border -->
        <div style="
          position:absolute;top:0;left:0;right:0;height:2px;
          background:linear-gradient(90deg, transparent, {color}60, transparent);
        "></div>

        <!-- Header -->
        <div style="display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.875rem;">
          <!-- Status orb -->
          <div style="
            width:10px;height:10px;border-radius:50%;
            background:{color};
            box-shadow:0 0 8px {color};
            flex-shrink:0;margin-top:4px;
            {st === 'online' ? 'animation: orb-pulse 2s ease-in-out infinite;' : ''}
          "></div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.95rem;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              {inst.name}
            </div>
            <div style="font-size:0.7rem;color:#475569;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              {inst.url}
            </div>
          </div>
          {#if inst.version}
            <span style="
              font-size:0.65rem;font-family:monospace;
              background:rgba(59,130,246,0.1);
              border:1px solid rgba(59,130,246,0.25);
              color:#93c5fd;border-radius:4px;padding:1px 6px;
              flex-shrink:0;
            ">{inst.version}</span>
          {/if}
        </div>

        <!-- Stats grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.875rem;">
          {#each [
            { label:'Membres',   value: String(inst.members) },
            { label:'En ligne',  value: String(inst.online)  },
            { label:'Langue',    value: inst.language?.toUpperCase() ?? '—' },
            { label:'Vu',        value: timeAgo(inst.last_seen) },
          ] as row}
            <div style="background:rgba(15,20,40,0.5);border-radius:6px;padding:0.4rem 0.6rem;">
              <div style="font-size:0.6rem;color:#475569;font-family:monospace;letter-spacing:0.05em;">{row.label}</div>
              <div style="font-size:0.8rem;font-family:monospace;color:#cbd5e1;font-weight:600;">{row.value}</div>
            </div>
          {/each}
        </div>

        <!-- Location -->
        {#if inst.geo_city || inst.country}
          <div style="font-size:0.7rem;color:#334155;font-family:monospace;margin-bottom:0.75rem;">
            📍 {[inst.geo_city, inst.country].filter(Boolean).join(', ')}
          </div>
        {/if}

        <!-- Actions -->
        <div style="display:flex;gap:0.5rem;">
          <a href={inst.url} target="_blank" rel="noopener" class="btn-primary" style="flex:1;text-align:center;text-decoration:none;padding:0.375rem 0;">
            Visiter →
          </a>
          <a href="/instances" class="btn-primary" style="padding:0.375rem 0.75rem;text-decoration:none;">
            ⚙
          </a>
        </div>
      </div>
    {/each}
  </div>
</div>
