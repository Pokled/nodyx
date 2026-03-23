import { readFile, readdir } from 'fs/promises'
import { existsSync }        from 'fs'
import { join, resolve }     from 'path'
import { marked }            from 'marked'
import { markedHighlight }   from 'marked-highlight'
import hljs                  from 'highlight.js'
import { slugToFile }        from './nav.js'

// Resolve docs directory relative to the repo root
const REPO_ROOT = resolve(process.cwd(), '..')
const DOCS_DIR  = join(REPO_ROOT, 'docs', 'en')

// ── Highlight.js integration ──────────────────────────────────────────────────

marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext'
    return hljs.highlight(code, { language }).value
  },
}))

// ── Custom renderer ───────────────────────────────────────────────────────────

const renderer = new marked.Renderer()

// Code blocks: wrap with copy button + optional filename
renderer.code = function({ text, lang }) {
  const language = lang?.split(':')[0] || 'plaintext'
  const filename = lang?.includes(':') ? lang.split(':')[1] : null
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(text, { language }).value
    : hljs.highlightAuto(text).value

  const filenameHtml = filename
    ? `<div class="code-filename">${escHtml(filename)}</div>`
    : ''

  return `
<div class="code-block">
  ${filenameHtml}
  <button class="copy-btn" onclick="copyCode(this)" aria-label="Copy">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  </button>
  <pre><code class="hljs language-${language}">${highlighted}</code></pre>
</div>`
}

// Headings: add anchor ids
renderer.heading = function({ text, depth }) {
  const id = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${depth}>\n`
}

marked.use({ renderer })

// ── Callout processor ─────────────────────────────────────────────────────────
// Transforms ::: blocks into styled callout divs
// Syntax: :::tip Title\nContent\n:::

function processCallouts(md: string): string {
  return md.replace(
    /^:::(\w+)(?:\s+(.+))?\n([\s\S]*?)^:::/gm,
    (_match, type: string, title: string | undefined, content: string) => {
      const t = type.toLowerCase()
      const label = title || capitalize(t)
      const icon = { tip: '💡', warning: '⚠️', security: '🔒', danger: '🚨', info: 'ℹ️' }[t] ?? 'ℹ️'
      return `<div class="callout callout-${t}" role="note">
<div class="callout-header"><span class="callout-icon">${icon}</span><strong>${escHtml(label)}</strong></div>
<div class="callout-body">${marked.parse(content.trim())}</div>
</div>\n`
    }
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
function escHtml(s: string)    { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

// ── Extract headings for TOC ──────────────────────────────────────────────────

export interface Heading { level: number; text: string; id: string }

function extractHeadings(md: string): Heading[] {
  const headings: Heading[] = []
  const regex = /^#{1,3}\s+(.+)$/gm
  for (const m of md.matchAll(regex)) {
    const level = (m[0].match(/^#+/) ?? [''])[0].length
    const text  = m[1].replace(/\*\*/g, '').replace(/`/g, '')
    const id    = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80)
    headings.push({ level, text, id })
  }
  return headings
}

// ── Search index ──────────────────────────────────────────────────────────────

export interface SearchEntry {
  slug:    string
  title:   string
  excerpt: string
}

let _searchIndex: SearchEntry[] | null = null

export async function buildSearchIndex(pages: Array<{ slug: string; title: string }>): Promise<SearchEntry[]> {
  if (_searchIndex) return _searchIndex

  const entries: SearchEntry[] = []
  for (const page of pages) {
    try {
      const raw = await readDocFile(page.slug)
      if (!raw) continue
      const plain = raw
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*|__|\*|_|`{1,3}[^`]*`{1,3}|\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/:::.*?\n/g, '')
        .replace(/\n+/g, ' ')
        .trim()
      entries.push({ slug: page.slug, title: page.title, excerpt: plain.slice(0, 500) })
    } catch { /* skip */ }
  }

  _searchIndex = entries
  return entries
}

// ── Main render function ──────────────────────────────────────────────────────

export interface DocResult {
  html:      string
  headings:  Heading[]
  title:     string
  raw:       string
}

async function readDocFile(slug: string): Promise<string | null> {
  const filename = slugToFile(slug)
  const filepath = join(DOCS_DIR, filename)
  if (!existsSync(filepath)) return null
  return readFile(filepath, 'utf-8')
}

export async function renderDoc(slug: string): Promise<DocResult | null> {
  const raw = await readDocFile(slug)
  if (raw === null) return null

  const processed  = processCallouts(raw)
  const html       = await marked.parse(processed)
  const headings   = extractHeadings(raw)

  // Extract title from first H1
  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title      = titleMatch
    ? titleMatch[1].replace(/[🚀🔒⚡🌐🛡️]/g, '').trim()
    : slug.toUpperCase()

  return { html, headings, title, raw }
}
