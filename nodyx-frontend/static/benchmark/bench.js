/* Nodyx · Benchmark — moteur partagé (graphes, reveal au scroll, thème, nav) */
(() => {
  "use strict";
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const el = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

  // ── Navigation (source unique) ─────────────────────────────
  const PAGES = [
    { id: "pire-cas",        href: "pire-cas.html",        label: "Le pire cas" },
    { id: "diffusion-audio", href: "diffusion-audio.html", label: "Diffusion audio" },
    { id: "partage-ecran",   href: "partage-ecran.html",   label: "Partage d'écran" },
    { id: "technique",       href: "technique.html",       label: "Technique", tech: true },
  ];
  function buildNav(current) {
    const mount = document.getElementById("nav-mount");
    if (!mount) return;
    const links = PAGES.map(p => {
      const cur = p.id === current ? ' aria-current="page"' : "";
      const cls = p.tech ? ' class="tech-link"' : "";
      return `<li${p.tech ? ' class="tech"' : ""}><a href="${p.href}"${cur}${cls}>${p.label}</a></li>`;
    }).join("");
    mount.className = "nav";
    mount.innerHTML =
      `<div class="nav-in">
        <a class="brand" href="pire-cas.html"><span class="dot"></span> Nodyx · Benchmark</a>
        <ul>${links}</ul>
        <button class="theme-btn" id="theme" type="button" aria-label="Thème clair/sombre"><span id="theme-ico">◐</span></button>
      </div>`;
    initTheme();
  }

  // ── Thème ──────────────────────────────────────────────────
  function initTheme() {
    const root = document.documentElement, ico = document.getElementById("theme-ico"), btn = document.getElementById("theme");
    if (!btn) return;
    try { const s = localStorage.getItem("nodyx-bench-theme"); if (s) root.setAttribute("data-theme", s); } catch (e) {}
    const sync = () => { const t = root.getAttribute("data-theme"); if (ico) ico.textContent = t === "dark" ? "●" : t === "light" ? "○" : "◐"; };
    sync();
    btn.addEventListener("click", () => {
      const cur = root.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : cur === "light" ? "dark" : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("nodyx-bench-theme", next); } catch (e) {}
      sync();
      redrawAll();
    });
  }

  // ── Reveal au scroll (une fois) ────────────────────────────
  function onView(node, fn) {
    if (!("IntersectionObserver" in window)) { fn(); return; }
    const io = new IntersectionObserver((ents) => {
      ents.forEach(e => { if (e.isIntersecting) { io.disconnect(); fn(); } });
    }, { threshold: 0.25, rootMargin: "0px 0px -8% 0px" });
    io.observe(node);
  }

  // ── Compteurs (chiffres qui montent, au scroll) ────────────
  function animateCount(s) {
    if (s.dataset.done) return; s.dataset.done = "1";
    const to = parseFloat(s.dataset.count), dec = +(s.dataset.dec || 0);
    const fmt = v => v.toFixed(dec).replace(".", ",");
    if (REDUCED) { s.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 1300;
    const step = t => { const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3); s.textContent = fmt(to * e); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function counters(scope) { (scope || document).querySelectorAll("[data-count]").forEach(animateCount); }
  function autoCounters() { document.querySelectorAll("[data-count]").forEach(s => onView(s, () => animateCount(s))); }

  // ── Barres comparatives (data-bar = largeur %) ─────────────
  function autoBars() {
    document.querySelectorAll("[data-bar]").forEach(f => {
      f.style.width = "0%";
      onView(f, () => {
        if (REDUCED) { f.style.width = f.dataset.bar + "%"; return; }
        f.style.transition = "width 1.5s cubic-bezier(.22,.61,.36,1)";
        requestAnimationFrame(() => requestAnimationFrame(() => { f.style.width = f.dataset.bar + "%"; }));
      });
    });
  }

  // ── Graphe (aire + ligne, reveal géométrique, hover) ───────
  const tip = (() => { let t = document.querySelector(".tip"); if (!t) { t = document.createElement("div"); t.className = "tip"; document.body.appendChild(t); } return t; })();
  const registry = [];

  function chart(svg, opts) {
    const spec = { svg, opts };
    registry.push(spec);
    build(spec);
    // Démarre vide (hors écran), s'anime en entrant dans la vue.
    if (!REDUCED) spec.reveal(0);
    onView(svg, () => play(spec));
    return { play: () => play(spec) };
  }

  function play(spec) {
    if (REDUCED) { spec.reveal(1); return; }
    const dur = 1500, t0 = performance.now();
    const step = t => { const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3); spec.reveal(e); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function build(spec) {
    const { svg, opts } = spec;
    const W = +svg.viewBox.baseVal.width, H = +svg.viewBox.baseVal.height;
    const m = opts.margin || { t: 24, r: 20, b: 34, l: 48 };
    const rows = opts.rows, xkey = opts.xkey || (d => d.x);
    const pw = W - m.l - m.r, ph = H - m.t - m.b, N = rows.length, baseY = m.t + ph;
    const x = i => m.l + (N === 1 ? pw / 2 : (i / (N - 1)) * pw);
    const y = v => m.t + ph - (v / opts.max) * ph;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (opts.ruptureFrom != null) { const xi = x(opts.ruptureFrom); svg.appendChild(el("rect", { x: xi, y: m.t, width: m.l + pw - xi, height: ph, class: "rupture-band" })); }
    (opts.yticks || []).forEach(t => {
      const yy = y(t);
      svg.appendChild(el("line", { x1: m.l, y1: yy, x2: m.l + pw, y2: yy, class: "grid-line" }));
      const lb = el("text", { x: m.l - 8, y: yy + 4, class: "axis-txt", "text-anchor": "end" }); lb.textContent = opts.yfmt ? opts.yfmt(t) : t; svg.appendChild(lb);
    });
    if (opts.ref != null) {
      const yy = y(opts.ref);
      svg.appendChild(el("line", { x1: m.l, y1: yy, x2: m.l + pw, y2: yy, class: "refline" }));
      const rt = el("text", { x: m.l + pw, y: yy - 7, class: "axis-txt", "text-anchor": "end", fill: css("--ink-2") }); rt.textContent = opts.refLabel || ""; svg.appendChild(rt);
    }
    rows.forEach((d, i) => { if (opts.xevery && !opts.xevery.includes(xkey(d))) return; const t = el("text", { x: x(i), y: H - 12, class: "axis-txt", "text-anchor": "middle" }); t.textContent = xkey(d); svg.appendChild(t); });
    const pts = rows.map((d, i) => [x(i), y(opts.val(d))]);
    const linePath = a => { let s = `M ${a[0][0]} ${a[0][1]} `; for (let i = 1; i < a.length; i++) s += `L ${a[i][0]} ${a[i][1]} `; return s; };
    const areaPath = a => { let s = `M ${a[0][0]} ${baseY} `; a.forEach(p => s += `L ${p[0]} ${p[1]} `); s += `L ${a[a.length - 1][0]} ${baseY} Z`; return s; };
    const area = el("path", { d: areaPath(pts), fill: opts.areaFill }); svg.appendChild(area);
    const line = el("path", { d: linePath(pts), class: "series-line", stroke: opts.stroke }); svg.appendChild(line);
    const last = pts[pts.length - 1];
    const endpoint = el("circle", { cx: last[0], cy: last[1], r: 4.5, fill: opts.stroke, class: "endpoint" }); svg.appendChild(endpoint);
    const labelObjs = [];
    (opts.labels || []).forEach(L => {
      const i = rows.findIndex(d => xkey(d) === L.at); if (i < 0) return;
      const px = x(i), py = y(opts.val(rows[i])), g = el("g", { style: "transition:opacity .35s" });
      const tw = L.text.length * 7.6 + 12, lx = Math.min(Math.max(px + L.dx, m.l + tw / 2), m.l + pw - tw / 2 - 2);
      g.appendChild(el("rect", { x: lx - tw / 2, y: py + L.dy - 12, width: tw, height: 18, rx: 5, class: "dlabel-bg" }));
      const tx = el("text", { x: lx, y: py + L.dy + 1, class: "dlabel", "text-anchor": "middle", fill: L.color || opts.stroke }); tx.textContent = L.text; g.appendChild(tx); svg.appendChild(g);
      labelObjs.push({ g, px });
    });
    spec.reveal = e => {
      const xMax = m.l + e * pw, inc = [];
      for (let i = 0; i < pts.length; i++) { if (pts[i][0] <= xMax) inc.push(pts[i]); else { if (i > 0) { const a = pts[i - 1], b = pts[i], tt = (xMax - a[0]) / (b[0] - a[0]); inc.push([xMax, a[1] + (b[1] - a[1]) * tt]); } break; } }
      if (!inc.length) inc.push([pts[0][0], pts[0][1]]);
      line.setAttribute("d", linePath(inc)); area.setAttribute("d", areaPath(inc));
      const tp = inc[inc.length - 1]; endpoint.setAttribute("cx", tp[0]); endpoint.setAttribute("cy", tp[1]);
      labelObjs.forEach(o => o.g.style.opacity = xMax >= o.px ? 1 : 0);
    };
    // hover
    const cross = el("line", { class: "crosshair", y1: m.t, y2: m.t + ph }); svg.appendChild(cross);
    const hoverDot = el("circle", { r: 5, fill: opts.stroke, class: "endpoint", opacity: 0 }); svg.appendChild(hoverDot);
    const overlay = el("rect", { x: m.l, y: m.t, width: pw, height: ph, fill: "transparent", style: "cursor:crosshair" }); svg.appendChild(overlay);
    const move = ev => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
      let best = 0, bd = 1e9; pts.forEach((p, i) => { const dd = Math.abs(p[0] - sx); if (dd < bd) { bd = dd; best = i; } });
      const p = pts[best], d = rows[best];
      cross.setAttribute("x1", p[0]); cross.setAttribute("x2", p[0]); cross.setAttribute("opacity", 1);
      hoverDot.setAttribute("cx", p[0]); hoverDot.setAttribute("cy", p[1]); hoverDot.setAttribute("opacity", 1);
      tip.innerHTML = `<div class="tn">${opts.tipTitle(d)}</div><div class="tv">${opts.tipVal(d)}</div><div class="ts">${opts.tipSub(d)}</div>`;
      tip.style.opacity = 1; tip.style.left = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = (ev.clientY - tip.offsetHeight - 10) + "px";
    };
    overlay.addEventListener("pointermove", move);
    overlay.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); hoverDot.setAttribute("opacity", 0); tip.style.opacity = 0; });
  }

  function redrawAll() { registry.forEach(spec => { build(spec); spec.reveal(1); }); }

  window.Bench = {
    boot(page) { buildNav(page); autoCounters(); autoBars(); },
    chart, counters, onView, css,
  };
})();
