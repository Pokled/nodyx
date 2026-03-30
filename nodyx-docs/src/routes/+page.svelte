<script lang="ts">
  import { onMount } from 'svelte'

  const { data } = $props()

  let copied = $state(false)
  let canvasEl = $state<HTMLCanvasElement | null>(null)

  const instanceCount = $derived(data.instanceCount as number | null)

  const INSTALL_CMD = 'curl -fsSL https://nodyx.org/install.sh | bash'

  function copyInstall() {
    navigator.clipboard.writeText(INSTALL_CMD)
    copied = true
    setTimeout(() => { copied = false }, 2000)
  }

  // ── Animated node graph ────────────────────────────────────────────────────
  onMount(() => {
    const canvas = canvasEl
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    let W = 0, H = 0, raf = 0

    function resize() {
      const rect = canvas.getBoundingClientRect()
      W = canvas.width  = rect.width  * devicePixelRatio
      H = canvas.height = rect.height * devicePixelRatio
      ctx.scale(devicePixelRatio, devicePixelRatio)
      W /= devicePixelRatio
      H /= devicePixelRatio
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    // Node definitions: [x%, y%, size, color, speed]
    const NODES_DEF = [
      [0.15, 0.18, 4,   '#3b82f6', 0.6],
      [0.50, 0.10, 3.5, '#818cf8', 0.45],
      [0.82, 0.22, 4,   '#06b6d4', 0.55],
      [0.25, 0.50, 5,   '#3b82f6', 0.35], // main-ish left
      [0.55, 0.45, 7,   '#ffffff', 0.25], // CENTER — biggest
      [0.78, 0.55, 4,   '#818cf8', 0.5],
      [0.12, 0.75, 3.5, '#06b6d4', 0.65],
      [0.42, 0.80, 4,   '#3b82f6', 0.4],
      [0.72, 0.82, 3.5, '#818cf8', 0.55],
      [0.90, 0.40, 3,   '#06b6d4', 0.7],
    ]

    // Connections: [fromIndex, toIndex]
    const EDGES = [
      [0,1],[1,2],[0,3],[1,4],[2,5],[2,9],
      [3,4],[4,5],[4,6],[4,7],[4,8],
      [3,6],[5,9],[6,7],[7,8],[8,5],
      [0,4],[9,5],
    ]

    type Node = {
      bx: number; by: number
      x: number; y: number
      r: number; color: string
      ox: number; oy: number; speed: number
      phase: number
    }

    let nodes: Node[] = []
    let t = 0

    function initNodes() {
      nodes = NODES_DEF.map(([px, py, r, color, speed]) => {
        const bx = (px as number) * W
        const by = (py as number) * H
        return {
          bx, by, x: bx, y: by,
          r: r as number,
          color: color as string,
          speed: speed as number,
          ox: (Math.random() - 0.5) * 40,
          oy: (Math.random() - 0.5) * 30,
          phase: Math.random() * Math.PI * 2,
        }
      })
    }

    function tick() {
      t += 0.008
      ctx.clearRect(0, 0, W, H)

      // Update node positions (gentle floating)
      nodes.forEach(n => {
        n.x = n.bx + n.ox * Math.sin(t * n.speed + n.phase)
        n.y = n.by + n.oy * Math.cos(t * n.speed * 0.7 + n.phase)
      })

      // Draw edges
      EDGES.forEach(([a, b]) => {
        const na = nodes[a], nb = nodes[b]
        if (!na || !nb) return
        const dx = nb.x - na.x, dy = nb.y - na.y
        const dist = Math.sqrt(dx*dx + dy*dy)
        const alpha = Math.max(0, 1 - dist / 320) * 0.35

        const grad = ctx.createLinearGradient(na.x, na.y, nb.x, nb.y)
        grad.addColorStop(0, na.color + '60')
        grad.addColorStop(1, nb.color + '60')

        // Traveling pulse on the edge
        const pulse = ((t * 60 * 0.3 + a * 37 + b * 13) % dist) / dist
        ctx.save()
        ctx.strokeStyle = grad
        ctx.lineWidth = 1
        ctx.globalAlpha = alpha
        ctx.setLineDash([dist * 0.25, dist * 0.75])
        ctx.lineDashOffset = -dist * pulse
        ctx.beginPath()
        ctx.moveTo(na.x, na.y)
        ctx.lineTo(nb.x, nb.y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()

        // Base line (faint)
        ctx.save()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 0.5
        ctx.globalAlpha = alpha * 0.4
        ctx.beginPath()
        ctx.moveTo(na.x, na.y)
        ctx.lineTo(nb.x, nb.y)
        ctx.stroke()
        ctx.restore()
      })

      // Draw nodes
      nodes.forEach((n, i) => {
        const pulse = 0.85 + 0.15 * Math.sin(t * 1.8 + n.phase)
        const r = n.r * pulse

        // Outer glow
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 5)
        glow.addColorStop(0, n.color + '30')
        glow.addColorStop(1, n.color + '00')
        ctx.save()
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(n.x, n.y, r * 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        // Core
        ctx.save()
        ctx.fillStyle = n.color
        ctx.shadowColor = n.color
        ctx.shadowBlur = r * 4
        ctx.globalAlpha = i === 4 ? 1 : 0.85
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      })

      raf = requestAnimationFrame(tick)
    }

    initNodes()
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })

  const FEATURES = [
    {
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
      title: 'Forum & threads',
      desc: 'Categories, subcategories, threaded replies, rich editor, polls, pinned threads — flat, wide, professional by design.',
      color: '#3b82f6',
    },
    {
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
      title: 'Real-time chat',
      desc: 'Socket.IO powered channels, DMs, replies, pins, link unfurling, online presence — zero latency.',
      color: '#8b5cf6',
    },
    {
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>`,
      title: 'Voice channels',
      desc: 'WebRTC audio rooms with noise cancellation, echo suppression, per-user gain control and screen sharing.',
      color: '#06b6d4',
    },
    {
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
      title: 'P2P Relay',
      desc: 'nodyx-relay lets you expose any instance behind a NAT. No port forwarding, no cloud lock-in — pure Rust TCP tunneling.',
      color: '#f59e0b',
    },
    {
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
      title: 'Living Profiles',
      desc: 'Generative animated banners, reputation rings, activity heatmaps, XP levels and custom name effects. Identity, not just an avatar.',
      color: '#a855f7',
    },
    {
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      title: 'AGPL-3.0 — Free forever',
      desc: 'Open source, copyleft, community-owned. Fork it, contribute, run it. No enterprise tier, no feature gating.',
      color: '#ef4444',
    },
  ]

  const STEPS = [
    {
      n: '01',
      title: 'One command install',
      code: 'curl -fsSL https://nodyx.org/install.sh | bash',
      desc: 'Detects your OS, installs Node, PostgreSQL, Redis, configures Caddy reverse proxy and sets up PM2. Done in under 3 minutes.',
    },
    {
      n: '02',
      title: 'Name your community',
      code: 'NODYX_COMMUNITY_NAME="The Hive"\nNODYX_COMMUNITY_SLUG="the-hive"',
      desc: 'Set a handful of environment variables. Your instance, your name, your identity — no approval required.',
    },
    {
      n: '03',
      title: 'Invite your people',
      code: 'https://your-domain.com/auth/register',
      desc: 'Registration opens immediately. First user becomes admin. Start building — forum, channels, voice rooms are all ready.',
    },
  ]
</script>

<svelte:head>
  <title>Nodyx Docs — Self-hosted community platform</title>
  <meta name="description"        content="Official documentation for Nodyx — the open-source, self-hosted community platform. Forum + real-time chat + P2P voice. One command install." />
  <link rel="canonical"           href="https://nodyx.dev" />

  <!-- Open Graph -->
  <meta property="og:type"        content="website" />
  <meta property="og:title"       content="Nodyx Docs — Self-hosted community platform" />
  <meta property="og:description" content="Official documentation for Nodyx — the open-source, self-hosted community platform. Forum + real-time chat + P2P voice. One command install." />
  <meta property="og:url"         content="https://nodyx.dev" />
  <meta property="og:image"       content="https://nodyx.dev/og-default.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Twitter/X card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="Nodyx Docs — Self-hosted community platform" />
  <meta name="twitter:description" content="Official documentation for Nodyx — open-source, self-hosted, P2P. Forum + Chat + Voice. One command install." />
  <meta name="twitter:image"       content="https://nodyx.dev/og-default.png" />

  <!-- JSON-LD: WebSite + SearchAction -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Nodyx Docs",
    "url": "https://nodyx.dev",
    "description": "Official documentation for Nodyx — the open-source, self-hosted community platform",
    "inLanguage": "en",
    "publisher": { "@type": "Organization", "name": "Nodyx", "url": "https://nodyx.org" },
    "potentialAction": {
      "@type": "SearchAction",
      "target": { "@type": "EntryPoint", "urlTemplate": "https://nodyx.dev/search?q={search_term_string}" },
      "query-input": "required name=search_term_string"
    }
  })}</script>`}
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- HERO                                                                     -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="hero">
  <!-- Background grid -->
  <div class="hero-grid" aria-hidden="true"></div>

  <div class="hero-inner">
    <div class="hero-text">
      <div class="badge-row">
        <span class="badge badge-agpl">AGPL-3.0</span>
        <span class="badge badge-self">Self-hosted</span>
        <span class="badge badge-p2p">P2P</span>
        <span class="badge badge-os">Open Source</span>
      </div>

      <h1 class="hero-title">
        Build the community<br>
        <span class="hero-accent">you actually own.</span>
      </h1>

      <p class="hero-sub">
        Nodyx is a self-hosted, open-source community platform.<br>
        Forum + real-time chat + voice channels — one server, one community, zero lock-in.
      </p>

      <div class="install-box">
        <span class="install-prompt">$</span>
        <code class="install-cmd">{INSTALL_CMD}</code>
        <button
          class="install-copy"
          class:install-copied={copied}
          onclick={copyInstall}
          aria-label="Copy install command"
          title={copied ? 'Copied!' : 'Copy'}
        >
          {#if copied}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          {/if}
        </button>
      </div>

      <div class="hero-ctas">
        <a href="/install" class="cta-primary">
          Get started
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
        <a href="/architecture" class="cta-secondary">
          How it works
        </a>
        <a href="https://github.com/Pokled/nodyx" target="_blank" rel="noopener noreferrer" class="cta-ghost">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>
          GitHub
        </a>
      </div>
    </div>

    <div class="hero-canvas-wrap" aria-hidden="true">
      <canvas bind:this={canvasEl} class="hero-canvas"></canvas>
      <div class="hero-canvas-label">
        <span class="canvas-dot canvas-dot-blue"></span> your-community.nodyx.org
      </div>
    </div>
  </div>

  <!-- Scroll indicator -->
  <div class="scroll-hint" aria-hidden="true">
    <span class="scroll-hint-text">Discover more</span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- STAT BAR                                                                 -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="stat-bar">
  <div class="stat-bar-inner">
    <div class="stat">
      <span class="stat-val">v1.9.5</span>
      <span class="stat-label">Latest stable</span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-val">{instanceCount !== null ? instanceCount : '—'}</span>
      <span class="stat-label">
        {#if instanceCount !== null}
          <span class="stat-live-dot" aria-hidden="true"></span>
        {/if}
        Instances live
      </span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-val">49</span>
      <span class="stat-label">DB migrations</span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-val">Rust + Node</span>
      <span class="stat-label">Hybrid backend</span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-val">AGPL-3.0</span>
      <span class="stat-label">Free forever</span>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- FEATURES                                                                 -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="section">
  <div class="section-inner">
    <div class="section-label">CAPABILITIES</div>
    <h2 class="section-title">Everything a community needs. Nothing it doesn't.</h2>
    <p class="section-sub">No feature gating. No tiers. The full platform, from day one.</p>

    <div class="features-grid">
      {#each FEATURES as f}
        <div class="feature-card" style="--fc: {f.color}">
          <div class="feature-icon" style="color: {f.color}">
            {@html f.icon}
          </div>
          <h3 class="feature-title">{f.title}</h3>
          <p class="feature-desc">{f.desc}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- PHILOSOPHY BANNER                                                        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="manifesto">
  <div class="manifesto-inner">
    <div class="manifesto-quote">
      <span class="manifesto-mark">"</span>
      We built the internet to bring people together. Not to divide them.
      <span class="manifesto-mark">"</span>
    </div>
    <p class="manifesto-sub">
      One instance = one community. No algorithmic feeds, no engagement traps,<br>
      no data brokers. Just a space that belongs to your people.
    </p>
    <a href="/manifesto" class="manifesto-cta">Read the manifesto</a>
  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- QUICK START                                                              -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="section section-alt">
  <div class="section-inner">
    <div class="section-label">QUICK START</div>
    <h2 class="section-title">Up and running in minutes.</h2>
    <p class="section-sub">One script. Three environment variables. A community that's yours forever.</p>

    <div class="steps">
      {#each STEPS as s}
        <div class="step">
          <div class="step-num">{s.n}</div>
          <div class="step-body">
            <h3 class="step-title">{s.title}</h3>
            <div class="step-code-wrap">
              <pre class="step-code"><code>{s.code}</code></pre>
            </div>
            <p class="step-desc">{s.desc}</p>
          </div>
        </div>
      {/each}
    </div>

    <div class="steps-cta">
      <a href="/install" class="cta-primary">Full install guide</a>
      <a href="/domain" class="cta-secondary">Domain setup</a>
    </div>
  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- LIVING PROFILE                                                            -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="section section-alt">
  <div class="section-inner lp-layout">

    <!-- Left: text -->
    <div class="lp-text">
      <div class="section-label">LIVING PROFILES</div>
      <h2 class="section-title" style="margin-bottom: 1rem;">Identity, not just an avatar.</h2>
      <p class="lp-intro">
        Profiles in Nodyx are alive. Every user gets a generative animated banner
        that's unique to them, a reputation ring that grows with their activity,
        and an activity heatmap that tells their story at a glance.
      </p>
      <ul class="lp-features">
        <li>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <strong>Generative banner</strong> — procedural animation seeded from username, unique per user
        </li>
        <li>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <strong>Reputation rings</strong> — concentric SVG arcs tracking posts, replies, reactions
        </li>
        <li>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <strong>Activity heatmap</strong> — 12-week GitHub-style contribution grid
        </li>
        <li>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <strong>XP levels &amp; grades</strong> — sqrt-based progression, custom colors, animated name effects
        </li>
      </ul>
    </div>

    <!-- Right: CSS profile card mockup -->
    <div class="lp-card-wrap" aria-hidden="true">
      <div class="lp-card">
        <!-- Generative banner animation -->
        <div class="lp-banner">
          <div class="lp-banner-anim"></div>
        </div>

        <!-- Avatar + rings -->
        <div class="lp-avatar-area">
          <div class="lp-ring lp-ring-outer"></div>
          <div class="lp-ring lp-ring-mid"></div>
          <div class="lp-ring lp-ring-inner"></div>
          <div class="lp-avatar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
        </div>

        <!-- Username + grade -->
        <div class="lp-identity">
          <span class="lp-username">nekr0s</span>
          <span class="lp-grade">Core Member</span>
        </div>

        <!-- XP bar -->
        <div class="lp-xp-row">
          <span class="lp-xp-label">Lv. 14</span>
          <div class="lp-xp-track">
            <div class="lp-xp-bar"></div>
          </div>
          <span class="lp-xp-label">Lv. 15</span>
        </div>

        <!-- Stats row -->
        <div class="lp-stats">
          <div class="lp-stat">
            <span class="lp-stat-val">847</span>
            <span class="lp-stat-lbl">Posts</span>
          </div>
          <div class="lp-stat-sep"></div>
          <div class="lp-stat">
            <span class="lp-stat-val">2.1k</span>
            <span class="lp-stat-lbl">Replies</span>
          </div>
          <div class="lp-stat-sep"></div>
          <div class="lp-stat">
            <span class="lp-stat-val">94</span>
            <span class="lp-stat-lbl">Merci</span>
          </div>
        </div>

        <!-- Heatmap (12×7 grid) -->
        <div class="lp-heatmap">
          {#each { length: 84 } as _, i}
            {@const intensity = Math.random()}
            <div class="lp-cell" style="opacity: {0.07 + intensity * 0.85}; background: {intensity > 0.7 ? '#818cf8' : intensity > 0.4 ? '#6366f1' : '#3b3f6e'}"></div>
          {/each}
        </div>
        <div class="lp-heatmap-label">Activity — last 12 weeks</div>
      </div>
    </div>

  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- ARCHITECTURE PILL STRIP                                                  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="section">
  <div class="section-inner">
    <div class="section-label">TECH STACK</div>
    <h2 class="section-title">Built on proven, boring technology.</h2>
    <p class="section-sub">No blockchain. No AI hype. Just the right tools for a fast, reliable community platform.</p>

    <div class="arch-grid">
      <div class="arch-layer">
        <div class="arch-layer-label">Frontend</div>
        <div class="arch-pills">
          <span class="arch-pill">SvelteKit 5</span>
          <span class="arch-pill">Tailwind v4</span>
          <span class="arch-pill">WebRTC</span>
          <span class="arch-pill">Socket.IO client</span>
          <span class="arch-pill">TipTap editor</span>
        </div>
      </div>
      <div class="arch-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </div>
      <div class="arch-layer">
        <div class="arch-layer-label">Backend</div>
        <div class="arch-pills">
          <span class="arch-pill arch-pill-rust">Rust / Axum</span>
          <span class="arch-pill">Node / Fastify v5</span>
          <span class="arch-pill">Socket.IO server</span>
          <span class="arch-pill">JWT + Redis sessions</span>
        </div>
      </div>
      <div class="arch-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </div>
      <div class="arch-layer">
        <div class="arch-layer-label">Data</div>
        <div class="arch-pills">
          <span class="arch-pill">PostgreSQL</span>
          <span class="arch-pill">Redis</span>
          <span class="arch-pill">S3-compatible</span>
        </div>
      </div>
      <div class="arch-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </div>
      <div class="arch-layer">
        <div class="arch-layer-label">Infra</div>
        <div class="arch-pills">
          <span class="arch-pill">Caddy (TLS)</span>
          <span class="arch-pill arch-pill-rust">nodyx-relay (Rust)</span>
          <span class="arch-pill arch-pill-rust">nexus-turn (STUN/TURN)</span>
          <span class="arch-pill">PM2</span>
        </div>
      </div>
    </div>

    <div class="arch-note">
      <a href="/architecture">Full architecture reference →</a>
    </div>
  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- DECENTRALIZED SECTION                                                    -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="section section-alt">
  <div class="section-inner decentralized">
    <div class="decent-text">
      <div class="section-label">DECENTRALIZED</div>
      <h2 class="section-title" style="margin-bottom: 1rem;">The network lives without us.</h2>
      <p class="decent-p">
        Every Nodyx instance is independent. No central server, no corporate hub.
        Instances can discover each other via the <strong>global directory</strong>, relay through
        <strong>nodyx-relay</strong> even behind NAT, and the network keeps running if any single node goes dark —
        including ours.
      </p>
      <p class="decent-p">
        This is the fundamental design goal: <strong>Nodyx must survive without nodyx.org.</strong>
      </p>
      <div class="decent-links">
        <a href="/relay" class="cta-secondary">nodyx-relay docs</a>
        <a href="/architecture" class="cta-ghost-subtle">Architecture deep-dive</a>
      </div>
    </div>

    <!-- Instance constellation diagram -->
    <div class="decent-diagram" aria-hidden="true">
      <div class="inst-node inst-main">
        <div class="inst-dot inst-dot-blue"></div>
        <span>your-community.nodyx.org</span>
      </div>
      <div class="inst-line inst-line-1"></div>
      <div class="inst-node inst-b">
        <div class="inst-dot inst-dot-purple"></div>
        <span>art-collective.net</span>
      </div>
      <div class="inst-line inst-line-2"></div>
      <div class="inst-node inst-c">
        <div class="inst-dot inst-dot-teal"></div>
        <span>gamedev-hub.io</span>
      </div>
      <div class="inst-line inst-line-3"></div>
      <div class="inst-node inst-d">
        <div class="inst-dot inst-dot-blue"></div>
        <span>home-server.local</span>
      </div>
      <div class="decent-relay-badge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        nodyx-relay mesh
      </div>
    </div>
  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- FINAL CTA                                                                -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<section class="final-cta">
  <div class="final-cta-inner">
    <h2 class="final-cta-title">Ready to own your community?</h2>
    <p class="final-cta-sub">Free. Forever. Yours.</p>
    <div class="final-cta-btns">
      <a href="/install" class="cta-primary cta-lg">Start in 3 minutes</a>
      <a href="/readme" class="cta-secondary cta-lg">Read the docs</a>
    </div>
    <p class="final-cta-footnote">
      No account needed &middot; No credit card &middot; No vendor lock-in
    </p>
  </div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- FOOTER                                                                   -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)"/>
        <circle cx="16" cy="16" r="5" fill="white" opacity="0.9"/>
        <circle cx="6"  cy="8"  r="2.5" fill="white" opacity="0.6"/>
        <circle cx="26" cy="8"  r="2.5" fill="white" opacity="0.6"/>
        <circle cx="6"  cy="24" r="2.5" fill="white" opacity="0.6"/>
        <circle cx="26" cy="24" r="2.5" fill="white" opacity="0.6"/>
        <line x1="6"  y1="8"  x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
        <line x1="26" y1="8"  x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
        <line x1="6"  y1="24" x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
        <line x1="26" y1="24" x2="16" y2="16" stroke="white" stroke-width="1.2" opacity="0.4"/>
      </svg>
      <span class="footer-name">nodyx<span style="color: var(--accent)">.dev</span></span>
    </div>

    <nav class="footer-nav" aria-label="Footer navigation">
      <div class="footer-col">
        <div class="footer-col-title">Docs</div>
        <a href="/readme">Overview</a>
        <a href="/install">Installation</a>
        <a href="/domain">Domain</a>
        <a href="/email">Email</a>
      </div>
      <div class="footer-col">
        <div class="footer-col-title">Architecture</div>
        <a href="/architecture">Overview</a>
        <a href="/relay">Relay</a>
        <a href="/audio">Audio</a>
        <a href="/neural-engine">Neural Engine</a>
      </div>
      <div class="footer-col">
        <div class="footer-col-title">Community</div>
        <a href="/manifesto">Manifesto</a>
        <a href="/contributing">Contributing</a>
        <a href="/thanks">Thanks</a>
        <a href="/roadmap">Roadmap</a>
      </div>
      <div class="footer-col">
        <div class="footer-col-title">Links</div>
        <a href="https://nodyx.org" target="_blank" rel="noopener noreferrer">nodyx.org</a>
        <a href="https://github.com/Pokled/nodyx" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://github.com/Pokled/nodyx/issues" target="_blank" rel="noopener noreferrer">Issues</a>
        <a href="https://github.com/Pokled/nodyx/releases" target="_blank" rel="noopener noreferrer">Releases</a>
      </div>
    </nav>
  </div>

  <div class="footer-bottom">
    <span>AGPL-3.0 — built in the open, for the people.</span>
    <span>One instance = one community.</span>
  </div>
</footer>


<style>
/* ── Hero ──────────────────────────────────────────────────────────────────── */

.hero {
  position: relative;
  min-height: min(88vh, 860px);
  display: flex;
  flex-direction: column;
  background: #030712;
  overflow: hidden;
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, black 40%, transparent 100%);
}

.hero-inner {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4rem;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
  padding: 5rem 3rem 4rem;
  width: 100%;
  position: relative;
  z-index: 1;
}

/* Badge row */
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.75rem;
}

.badge {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.25em 0.7em;
  border-radius: 100px;
  border: 1px solid;
}

.badge-agpl   { color: #ef4444; border-color: #ef444430; background: #ef444410; }
.badge-self   { color: #10b981; border-color: #10b98130; background: #10b98110; }
.badge-p2p    { color: #f59e0b; border-color: #f59e0b30; background: #f59e0b10; }
.badge-os     { color: #3b82f6; border-color: #3b82f630; background: #3b82f610; }

/* Title */
.hero-title {
  font-size: clamp(2.5rem, 5vw, 3.75rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.08;
  color: #ffffff;
  margin: 0 0 1.25rem;
}

.hero-accent {
  background: linear-gradient(135deg, #3b82f6, #8b5cf6 50%, #06b6d4);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Subtitle */
.hero-sub {
  font-size: 1.05rem;
  line-height: 1.65;
  color: #94a3b8;
  margin: 0 0 2rem;
}

/* Install box */
.install-box {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 10px;
  padding: 0.7rem 1rem;
  margin-bottom: 2rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  overflow: hidden;
}

.install-prompt {
  color: #3b82f6;
  flex-shrink: 0;
  font-weight: 700;
}

.install-cmd {
  color: #e2e8f0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: inherit;
}

.install-copy {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 6px;
  cursor: pointer;
  color: #94a3b8;
  transition: color 0.12s, border-color 0.12s;
}

.install-copy:hover { color: #e2e8f0; border-color: #475569; }
.install-copied     { color: #22c55e !important; border-color: #22c55e40 !important; }

/* CTAs */
.hero-ctas {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1.2rem;
  background: #3b82f6;
  color: #fff;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.15s, transform 0.12s;
  border: 1px solid transparent;
}
.cta-primary:hover { background: #2563eb; transform: translateY(-1px); }
.cta-lg { padding: 0.75rem 1.75rem; font-size: 0.95rem; }

.cta-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1.2rem;
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}
.cta-secondary:hover { background: var(--bg-hover); border-color: var(--text-muted); }
.cta-lg.cta-secondary { padding: 0.75rem 1.75rem; font-size: 0.95rem; }

.cta-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1rem;
  color: #94a3b8;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.12s;
  border-radius: 8px;
}
.cta-ghost:hover { color: #e2e8f0; }

.cta-ghost-subtle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1.2rem;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.12s, border-color 0.12s;
}
.cta-ghost-subtle:hover { color: var(--text); border-color: var(--border-strong); }

/* Canvas */
.hero-canvas-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.75rem;
}

.hero-canvas {
  width: 100%;
  height: 380px;
  border-radius: 16px;
  border: 1px solid #1e293b;
  background: transparent;
}

.hero-canvas-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  color: #475569;
  font-family: var(--font-mono);
}

.canvas-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  animation: pulse-dot 2s ease-in-out infinite;
}
.canvas-dot-blue { background: #3b82f6; box-shadow: 0 0 6px #3b82f6; }

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.6; transform: scale(0.85); }
}

/* Scroll hint */
.scroll-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1.25rem 0 2rem;
  color: #475569;
  animation: bounce-down 2.2s ease-in-out infinite;
}

.scroll-hint-text {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.7;
}

@keyframes bounce-down {
  0%, 100% { transform: translateY(0); opacity: 0.8; }
  50%       { transform: translateY(6px); opacity: 1; }
}

/* ── Stat bar ────────────────────────────────────────────────────────────── */

.stat-bar {
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.stat-bar-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 3rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 0;
  gap: 0.15rem;
  flex: 1;
  min-width: 100px;
}

.stat-val {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}

.stat-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.stat-live-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 6px #4ade80;
  animation: pulse-dot 2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.stat-sep {
  width: 1px;
  height: 2.5rem;
  background: var(--border);
  flex-shrink: 0;
}

/* ── Sections ────────────────────────────────────────────────────────────── */

.section {
  padding: 6rem 0;
}

.section-alt {
  background: var(--bg-subtle);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.section-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 3rem;
}

.section-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #3b82f6;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.035em;
  color: var(--text);
  margin: 0 0 0.75rem;
  line-height: 1.15;
}

.section-sub {
  font-size: 1rem;
  color: var(--text-muted);
  margin: 0 0 3rem;
  max-width: 540px;
}

/* ── Feature cards ───────────────────────────────────────────────────────── */

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.25rem;
}

.feature-card {
  padding: 1.5rem;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  position: relative;
  overflow: hidden;
}

.feature-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 0 0, color-mix(in srgb, var(--fc) 8%, transparent), transparent 60%);
  opacity: 0;
  transition: opacity 0.2s;
}

.feature-card:hover {
  border-color: color-mix(in srgb, var(--fc) 40%, var(--border));
  transform: translateY(-2px);
  box-shadow: 0 8px 32px color-mix(in srgb, var(--fc) 10%, transparent);
}
.feature-card:hover::before { opacity: 1; }

.feature-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--fc) 12%, var(--bg-subtle));
  margin-bottom: 1rem;
  position: relative;
}

.feature-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 0.5rem;
}

.feature-desc {
  font-size: 0.82rem;
  color: var(--text-muted);
  line-height: 1.65;
  margin: 0;
}

/* ── Manifesto ───────────────────────────────────────────────────────────── */

.manifesto {
  background: #030712;
  padding: 6rem 3rem;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.manifesto::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 60% 80% at 50% 50%, #3b82f610, transparent);
}

.manifesto-inner {
  position: relative;
  max-width: 720px;
  margin: 0 auto;
}

.manifesto-quote {
  font-size: clamp(1.3rem, 3vw, 2rem);
  font-weight: 700;
  line-height: 1.4;
  color: #f8fafc;
  letter-spacing: -0.02em;
  margin-bottom: 1.5rem;
}

.manifesto-mark {
  color: #3b82f6;
  font-size: 1.5em;
  line-height: 0;
  vertical-align: -0.2em;
}

.manifesto-sub {
  font-size: 0.95rem;
  color: #64748b;
  line-height: 1.7;
  margin: 0 0 2rem;
}

.manifesto-cta {
  display: inline-flex;
  align-items: center;
  padding: 0.6rem 1.4rem;
  border: 1px solid #1e293b;
  border-radius: 8px;
  color: #94a3b8;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.12s, border-color 0.12s;
}
.manifesto-cta:hover { color: #e2e8f0; border-color: #334155; }

/* ── Steps ───────────────────────────────────────────────────────────────── */

.steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
  margin-bottom: 2.5rem;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.step-num {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: #3b82f6;
  font-family: var(--font-mono);
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.step-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.step-code-wrap {
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 8px;
  overflow: hidden;
}

.step-code {
  margin: 0;
  padding: 0.85rem 1rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--code-text);
  overflow-x: auto;
  white-space: pre;
}

.step-desc {
  font-size: 0.82rem;
  color: var(--text-muted);
  line-height: 1.65;
  margin: 0;
}

.steps-cta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* ── Architecture ────────────────────────────────────────────────────────── */

.arch-grid {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1.75rem;
}

.arch-layer {
  flex: 1;
  min-width: 150px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem 1.25rem;
}

.arch-layer-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

.arch-pills {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.arch-pill {
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.25em 0.6em;
}

.arch-pill-rust {
  color: #f59e0b;
  background: #f59e0b10;
  border-color: #f59e0b30;
}

.arch-arrow {
  display: flex;
  align-items: center;
  padding-top: 2.5rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.arch-note {
  font-size: 0.82rem;
}

.arch-note a {
  color: #3b82f6;
  text-decoration: none;
}
.arch-note a:hover { text-decoration: underline; }

/* ── Decentralized ───────────────────────────────────────────────────────── */

.decentralized {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5rem;
  align-items: center;
}

.decent-p {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.75;
  margin: 0 0 1rem;
}

.decent-links {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 1.75rem;
}

/* Instance diagram */
.decent-diagram {
  position: relative;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 2rem;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.75rem;
}

.inst-node {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.78rem;
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.inst-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: pulse-dot 2s ease-in-out infinite;
}

.inst-dot-blue   { background: #3b82f6; box-shadow: 0 0 5px #3b82f6; }
.inst-dot-purple { background: #8b5cf6; box-shadow: 0 0 5px #8b5cf6; animation-delay: 0.5s; }
.inst-dot-teal   { background: #06b6d4; box-shadow: 0 0 5px #06b6d4; animation-delay: 1s; }

.inst-line {
  height: 1px;
  background: linear-gradient(90deg, var(--border), transparent);
  margin-left: 4px;
  opacity: 0.6;
  animation: line-travel 3s linear infinite;
  background-size: 200% 100%;
}

.inst-line-1 { width: 70%; animation-delay: 0s; }
.inst-line-2 { width: 55%; animation-delay: 1s; }
.inst-line-3 { width: 65%; animation-delay: 0.5s; }

@keyframes line-travel {
  0%   { background-position: 0% 0%; }
  100% { background-position: 200% 0%; }
}

.decent-relay-badge {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: #f59e0b;
  background: #f59e0b10;
  border: 1px solid #f59e0b30;
  border-radius: 100px;
  padding: 0.25em 0.7em;
}

/* ── Final CTA ───────────────────────────────────────────────────────────── */

.final-cta {
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
  padding: 7rem 3rem;
  text-align: center;
}

.final-cta-inner {
  max-width: 560px;
  margin: 0 auto;
}

.final-cta-title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  color: #f8fafc;
  margin: 0 0 0.75rem;
  line-height: 1.1;
}

.final-cta-sub {
  font-size: 1.1rem;
  color: #64748b;
  margin: 0 0 2.5rem;
}

.final-cta-btns {
  display: flex;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.final-cta-footnote {
  font-size: 0.78rem;
  color: #334155;
  margin: 0;
}

/* ── Footer ──────────────────────────────────────────────────────────────── */

.footer {
  background: var(--bg-subtle);
  border-top: 1px solid var(--border);
  padding: 3.5rem 0 0;
}

.footer-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 3rem 3rem;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4rem;
  align-items: start;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
  text-decoration: none;
}

.footer-name { color: var(--text); }

.footer-nav {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2rem;
}

.footer-col {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.footer-col-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.25rem;
}

.footer-col a {
  font-size: 0.82rem;
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.12s;
}
.footer-col a:hover { color: var(--text); }

.footer-bottom {
  border-top: 1px solid var(--border);
  padding: 1rem 3rem;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-muted);
  max-width: 100%;
}

/* ── Responsive ──────────────────────────────────────────────────────────── */

@media (max-width: 1024px) {
  .hero-inner         { grid-template-columns: 1fr; gap: 2rem; padding: 3.5rem 2rem 3rem; }
  .hero-canvas-wrap   { display: none; }
  .features-grid      { grid-template-columns: repeat(2, 1fr); }
  .steps              { grid-template-columns: 1fr; gap: 2.5rem; }
  .decentralized      { grid-template-columns: 1fr; gap: 2.5rem; }
  .arch-grid          { flex-direction: column; }
  .arch-arrow         { transform: rotate(90deg); padding: 0; align-self: center; }
  .footer-inner       { grid-template-columns: 1fr; gap: 2rem; }
  .footer-nav         { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 640px) {
  .section-inner, .manifesto, .final-cta, .stat-bar-inner { padding-left: 1.25rem; padding-right: 1.25rem; }
  .features-grid  { grid-template-columns: 1fr; }
  .hero-inner     { padding: 2.5rem 1.25rem 2rem; }
  .stat-bar-inner { justify-content: center; gap: 0; }
  .stat-sep       { display: none; }
  .stat           { min-width: 110px; }
  .footer-nav     { grid-template-columns: repeat(2, 1fr); }
  .footer-bottom  { padding-left: 1.25rem; padding-right: 1.25rem; }
  .footer-inner   { padding: 0 1.25rem 2rem; }
  .lp-layout      { flex-direction: column; }
  .lp-card-wrap   { justify-content: center; }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* LIVING PROFILE SECTION                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

.lp-layout {
  display: flex;
  gap: 4rem;
  align-items: center;
}

.lp-text {
  flex: 1;
  min-width: 0;
}

.lp-intro {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 1.5rem;
}

.lp-features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.lp-features li {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.lp-features li svg {
  flex-shrink: 0;
  margin-top: 0.15rem;
  color: #6366f1;
}

.lp-features strong {
  color: var(--text);
  font-weight: 600;
}

/* Card wrapper */
.lp-card-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.lp-card {
  width: 280px;
  background: #0c0c12;
  border: 1px solid rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

/* Generative banner */
.lp-banner {
  height: 72px;
  position: relative;
  overflow: hidden;
  background: #0a0a14;
}

.lp-banner-anim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    120deg,
    #1a1040 0%,
    #2d1b6e 20%,
    #4c1d95 35%,
    #0e3a5c 55%,
    #1a1040 75%,
    #3b0764 90%,
    #1a1040 100%
  );
  background-size: 300% 100%;
  animation: banner-shift 8s ease-in-out infinite alternate;
  opacity: 0.9;
}

.lp-banner-anim::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.15) 2px,
    rgba(0, 0, 0, 0.15) 3px
  );
  opacity: 0.4;
}

@keyframes banner-shift {
  from { background-position: 0% 50%; }
  to   { background-position: 100% 50%; }
}

/* Avatar + reputation rings */
.lp-avatar-area {
  position: relative;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 16px;
}

.lp-ring {
  position: absolute;
  border-radius: 50%;
  border: 2px solid transparent;
}

.lp-ring-outer {
  inset: -4px;
  border-color: rgba(99, 102, 241, 0.25);
  animation: ring-pulse 3s ease-in-out infinite;
}

.lp-ring-mid {
  inset: -1px;
  border-color: rgba(99, 102, 241, 0.55);
  border-width: 1.5px;
}

.lp-ring-inner {
  inset: 0;
  border-color: rgba(139, 92, 246, 0.8);
  border-width: 1.5px;
  animation: ring-pulse 3s ease-in-out infinite 1s;
}

@keyframes ring-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.lp-avatar {
  position: absolute;
  inset: 0;
  background: #1a1040;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Identity */
.lp-identity {
  padding: 0.6rem 1rem 0;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.lp-username {
  font-size: 0.9rem;
  font-weight: 700;
  color: #a78bfa;
  letter-spacing: -0.01em;
}

.lp-grade {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.25);
}

/* XP bar */
.lp-xp-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 1rem;
}

.lp-xp-label {
  font-size: 0.6rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.2);
  font-family: ui-monospace, monospace;
  white-space: nowrap;
}

.lp-xp-track {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.lp-xp-bar {
  height: 100%;
  width: 62%;
  background: linear-gradient(90deg, #6366f1, #a855f7);
  animation: xp-pulse 2.5s ease-in-out infinite;
}

@keyframes xp-pulse {
  0%, 100% { opacity: 0.9; }
  50% { opacity: 0.6; }
}

/* Stats row */
.lp-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.lp-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
}

.lp-stat-val {
  font-size: 0.85rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: -0.02em;
}

.lp-stat-lbl {
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.2);
  font-weight: 600;
}

.lp-stat-sep {
  width: 1px;
  height: 1.5rem;
  background: rgba(255, 255, 255, 0.06);
}

/* Activity heatmap */
.lp-heatmap {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 2px;
  padding: 0.6rem 1rem 0.25rem;
}

.lp-cell {
  aspect-ratio: 1;
}

.lp-heatmap-label {
  padding: 0 1rem 0.75rem;
  font-size: 0.58rem;
  color: rgba(255, 255, 255, 0.15);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 600;
}
</style>
