<script lang="ts">
  import { onMount } from 'svelte'
  import type { Heading } from '$lib/docs.server.js'

  const { data } = $props()

  // Copy button handler (injected into rendered HTML)
  onMount(() => {
    // Expose to HTML onclick handlers
    (window as any).copyCode = (btn: HTMLButtonElement) => {
      const code = btn.closest('.code-block')?.querySelector('code')?.textContent ?? ''
      navigator.clipboard.writeText(code).then(() => {
        btn.classList.add('copied')
        const svg = btn.innerHTML
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
        setTimeout(() => {
          btn.classList.remove('copied')
          btn.innerHTML = svg
        }, 1800)
      })
    }
  })

  // Active TOC heading on scroll
  let activeId = $state('')
  onMount(() => {
    const headings = document.querySelectorAll('.prose h2, .prose h3')
    const obs = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) activeId = e.target.id
      }
    }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 })
    headings.forEach(h => obs.observe(h))
    return () => obs.disconnect()
  })
</script>

<svelte:head>
  <title>{data.docTitle} — Nodyx Docs</title>
  <meta name="description"        content={data.description} />
  <link rel="canonical"           href="https://nodyx.dev/{data.slug}" />

  <!-- Open Graph -->
  <meta property="og:type"        content="article" />
  <meta property="og:title"       content="{data.docTitle} — Nodyx Docs" />
  <meta property="og:description" content={data.description} />
  <meta property="og:url"         content="https://nodyx.dev/{data.slug}" />
  <meta property="og:site_name"   content="Nodyx Docs" />
  <meta property="og:image"       content="https://nodyx.dev/og-default.svg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Twitter/X card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="{data.docTitle} — Nodyx Docs" />
  <meta name="twitter:description" content={data.description} />
  <meta name="twitter:image"       content="https://nodyx.dev/og-default.svg" />

  <!-- JSON-LD: TechArticle + BreadcrumbList -->
  {@html `<script type="application/ld+json">${JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      "headline": data.docTitle,
      "description": data.description,
      "url": `https://nodyx.dev/${data.slug}`,
      "inLanguage": "en",
      "author": { "@type": "Organization", "name": "Nodyx", "url": "https://nodyx.org" },
      "publisher": { "@type": "Organization", "name": "Nodyx", "url": "https://nodyx.dev" },
      "isPartOf": { "@type": "WebSite", "name": "Nodyx Docs", "url": "https://nodyx.dev" }
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Docs", "item": "https://nodyx.dev" },
        { "@type": "ListItem", "position": 2, "name": data.docTitle, "item": `https://nodyx.dev/${data.slug}` }
      ]
    }
  ])}</script>`}
</svelte:head>

<!-- Breadcrumb -->
<nav class="breadcrumb" aria-label="Breadcrumb">
  <a href="/">Docs</a>
  <span aria-hidden="true">/</span>
  <span aria-current="page">{data.title}</span>
</nav>

<!-- Reading time -->
<div class="reading-time" aria-label="Reading time">{data.readingTime}</div>

<div class="doc-layout">
  <!-- Main content -->
  <article class="prose">
    {@html data.html}
  </article>

  <!-- TOC (right sidebar) -->
  {#if data.headings.length > 2}
    <aside class="toc" aria-label="Table of contents">
      <div class="toc-inner">
        <div class="toc-title">On this page</div>
        <nav>
          <ul class="toc-list">
            {#each data.headings.filter(h => h.level <= 3) as h}
              <li class="toc-item" class:toc-h3={h.level === 3}>
                <a
                  href="#{h.id}"
                  class="toc-link"
                  class:active={activeId === h.id}
                >
                  {h.text}
                </a>
              </li>
            {/each}
          </ul>
        </nav>
      </div>
    </aside>
  {/if}
</div>

<!-- Prev / Next navigation -->
{#if data.prev || data.next}
  <nav class="doc-nav" aria-label="Previous and next pages">
    <div class="doc-nav-inner">
      {#if data.prev}
        <a href="/{data.prev.slug}" class="doc-nav-btn doc-nav-prev">
          <span class="doc-nav-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            Previous
          </span>
          <span class="doc-nav-title">{data.prev.title}</span>
        </a>
      {:else}
        <div></div>
      {/if}
      {#if data.next}
        <a href="/{data.next.slug}" class="doc-nav-btn doc-nav-next">
          <span class="doc-nav-label">
            Next
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </span>
          <span class="doc-nav-title">{data.next.title}</span>
        </a>
      {/if}
    </div>
  </nav>
{/if}

<!-- Edit on GitHub -->
<div class="edit-link">
  <a
    href="https://github.com/Pokled/nodyx/edit/main/docs/en/{data.slug.toUpperCase().replace(/-/g, '-')}.md"
    target="_blank"
    rel="noopener noreferrer"
  >
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
    Edit this page on GitHub
  </a>
</div>

<style>
.doc-layout {
  display: flex;
  gap: 3rem;
  align-items: flex-start;
}

/* TOC */
.toc {
  flex-shrink: 0;
  width: 200px;
}

.toc-inner {
  position: sticky;
  top: calc(var(--header-height) + 2rem);
}

.toc-title {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

.toc-list { list-style: none; margin: 0; padding: 0; }

.toc-item { margin: 0; }

.toc-h3 .toc-link { padding-left: 1rem; font-size: 0.78rem; }

.toc-link {
  display: block;
  padding: 0.25rem 0.5rem 0.25rem 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  text-decoration: none;
  border-left: 2px solid var(--border);
  padding-left: 0.75rem;
  transition: color 0.12s, border-color 0.12s;
  line-height: 1.4;
}

.toc-link:hover { color: var(--text-secondary); }
.toc-link.active { color: var(--accent); border-left-color: var(--accent); }

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 1.5rem;
  margin-top: -1rem;
}

.breadcrumb a {
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.1s;
}

.breadcrumb a:hover { color: var(--accent); }
.breadcrumb [aria-current="page"] { color: var(--text-secondary); }

/* Prev/Next */
.doc-nav { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--border); }

.doc-nav-inner {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  max-width: var(--content-max);
}

.doc-nav-btn {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  text-decoration: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.doc-nav-btn:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.doc-nav-next { text-align: right; }

.doc-nav-label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  font-weight: 600;
}

.doc-nav-next .doc-nav-label { justify-content: flex-end; }

.doc-nav-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text);
}

/* Edit link */
.edit-link {
  margin-top: 1.25rem;
  font-size: 0.78rem;
}

.edit-link a {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.12s;
}

.edit-link a:hover { color: var(--accent); }

/* Reading time */
.reading-time {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-bottom: 1rem;
  margin-top: -0.5rem;
}

/* Responsive: hide TOC on smaller screens */
@media (max-width: 1200px) {
  .toc { display: none; }
  .doc-layout { display: block; }
}
</style>
