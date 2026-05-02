import { readFile, readdir } from 'fs/promises'
import { existsSync }        from 'fs'
import { join, resolve }     from 'path'
import { marked }            from 'marked'
import hljs                  from 'highlight.js'
import { slugToFile }        from './nav.js'

// Resolve docs directory relative to the repo root
const REPO_ROOT = resolve(process.cwd(), '..')
const DOCS_DIR  = join(REPO_ROOT, 'docs', 'en')

// ── Custom renderer ───────────────────────────────────────────────────────────

const renderer = new marked.Renderer()

// Code blocks: wrap with copy button + optional filename
// marked v12 API: code(code, language, isEscaped)
renderer.code = function(code: string, lang?: string) {
  const text     = code
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

// ── Shared heading slug function ──────────────────────────────────────────────
// Works on both rendered HTML (from renderer.heading) and raw markdown
// (from extractHeadings). Both call sites MUST produce the same slug for a
// given heading, otherwise the TOC link href won't match the rendered <h2 id>
// and the click does nothing. This is exactly what bit us when marked
// HTML-encodes apostrophes to &#39; before passing to renderer.heading,
// while extractHeadings sees the raw ' character.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g,    (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g,  '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&nbsp;/g, ' ')
}

function slugifyHeading(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<[^>]*>/g, '')                  // strip HTML tags  (<code>, <strong>, etc.)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // strip markdown links  [text](url) → text
    .replace(/[*_`]/g, '')                    // strip markdown syntax  *, _, `
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')                 // strip non-word (emojis, em-dash, punct.)
    .replace(/\s+/g, '-')                     // spaces → dashes
    .replace(/-+/g, '-')                      // collapse runs of dashes  ("a---b" → "a-b")
    .replace(/^-+|-+$/g, '')                  // trim leading + trailing dashes
    .slice(0, 80)
    .replace(/-+$/g, '')                      // trim again in case slice cut mid-dash
}

// Headings: add anchor ids
// marked v12 API: heading(text, depth, raw)
renderer.heading = function(text: string, depth: number) {
  const id = slugifyHeading(text)
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

// Replace fenced code blocks with blank-line placeholders so the heading regex
// can't match shell/python comments like "# 1. Stop pm2" living inside ```bash
// blocks. Without this, the right sidebar fills with phantom entries that
// don't actually exist as <h*> in the rendered HTML, and every TOC click on
// them goes nowhere. (Affects INSTALL, RELAY, NEURAL-ENGINE, etc.)
//
// We replace lines (preserving line count, with empty content) rather than
// removing them so character offsets in `buildSearchIndex` stay valid for
// downstream slicing operations.
function stripFencedCode(md: string): string {
  const lines = md.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      inFence = !inFence
      lines[i] = ''                  // also blank the fence marker itself
      continue
    }
    if (inFence) lines[i] = ''
  }
  return lines.join('\n')
}

function extractHeadings(md: string): Heading[] {
  const cleaned = stripFencedCode(md)
  const headings: Heading[] = []
  const regex = /^#{1,3}\s+(.+)$/gm
  for (const m of cleaned.matchAll(regex)) {
    const level = (m[0].match(/^#+/) ?? [''])[0].length
    const raw   = m[1]
    const text  = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '')
    const id    = slugifyHeading(raw)
    headings.push({ level, text, id })
  }
  return headings
}

// ── Search index ──────────────────────────────────────────────────────────────
// Each entry is either a whole page or a single H2/H3 section. Section entries
// carry their anchor id so search results can deep-link into the right heading.

export interface SearchEntry {
  slug:          string
  title:         string         // page title
  excerpt:       string         // body text for matching
  headingText?:  string         // section heading text (undefined for whole-page entries)
  headingId?:    string         // anchor id for deep link
  headingLevel?: number         // 2 | 3
}

let _searchIndex: SearchEntry[] | null = null

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')                       // fenced code blocks
    .replace(/`[^`]*`/g, ' ')                              // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                 // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')               // links → keep label
    .replace(/^:::.*$/gm, ' ')                             // callout markers
    .replace(/\*\*|__|\*|_/g, '')                          // emphasis
    .replace(/^>\s?/gm, '')                                // blockquotes
    .replace(/^[-*+]\s+/gm, '')                            // list bullets
    .replace(/<[^>]+>/g, ' ')                              // raw html
    .replace(/\s+/g, ' ')
    .trim()
}

export async function buildSearchIndex(pages: Array<{ slug: string; title: string }>): Promise<SearchEntry[]> {
  if (_searchIndex) return _searchIndex

  const entries: SearchEntry[] = []
  for (const page of pages) {
    try {
      const raw = await readDocFile(page.slug)
      if (!raw) continue

      // Whole-page entry — first 500 chars of plain text, anchored at top of page
      const wholePlain = stripMarkdown(raw.replace(/^#{1,6}\s+/gm, ''))
      entries.push({ slug: page.slug, title: page.title, excerpt: wholePlain.slice(0, 500) })

      // Section entries — split on H2/H3 boundaries. Run the regex on a
      // code-block-stripped copy so shell comments like "# 1. Stop pm2" don't
      // create phantom search results, but slice the ORIGINAL `raw` for
      // section bodies so the indexed text matches what the user will read.
      const cleaned = stripFencedCode(raw)
      const sectionRe = /^(#{2,3})\s+(.+?)\s*$/gm
      const matches: Array<{ level: number; text: string; start: number; end: number }> = []
      let m: RegExpExecArray | null
      while ((m = sectionRe.exec(cleaned)) !== null) {
        matches.push({ level: m[1].length, text: m[2], start: m.index, end: m.index + m[0].length })
      }

      for (let i = 0; i < matches.length; i++) {
        const cur  = matches[i]
        const next = matches[i + 1]
        const body = raw.slice(cur.end, next ? next.start : raw.length)
        const headingClean = cur.text
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/[*_`]/g, '')
          .trim()
        const bodyPlain = stripMarkdown(body)
        // Prepend the heading text into the excerpt so heading-only queries match
        const excerpt = (headingClean + ' — ' + bodyPlain).slice(0, 600)
        entries.push({
          slug:         page.slug,
          title:        page.title,
          excerpt,
          headingText:  headingClean,
          headingId:    slugifyHeading(cur.text),
          headingLevel: cur.level,
        })
      }
    } catch { /* skip */ }
  }

  _searchIndex = entries
  return entries
}

// ── Main render function ──────────────────────────────────────────────────────

// ── Description extraction ────────────────────────────────────────────────────
// First non-empty paragraph after the H1, stripped of markdown syntax

export function extractDescription(raw: string): string {
  const lines = raw.split('\n')
  let pastH1 = false
  let para = ''
  for (const line of lines) {
    if (!pastH1) {
      if (/^#\s/.test(line)) pastH1 = true
      continue
    }
    const stripped = line
      .replace(/^#{1,6}\s+.*$/, '')           // strip headings
      .replace(/\*\*|__|\*|_/g, '')           // strip bold/italic
      .replace(/`[^`]*`/g, (m) => m.slice(1, -1)) // strip inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // strip links
      .replace(/^>\s+/, '')                    // strip blockquotes
      .replace(/^:::.*$/, '')                  // strip callout markers
      .trim()
    if (!stripped) {
      if (para) break  // blank line after a paragraph → stop
      continue
    }
    para += (para ? ' ' : '') + stripped
    if (para.length > 160) break
  }
  return para.slice(0, 160).trim() || 'Nodyx documentation'
}

// ── Reading time ───────────────────────────────────────────────────────────────
// ~200 wpm, rounded to nearest 0.5min

export function readingTime(raw: string): string {
  const words = raw.replace(/```[\s\S]*?```/g, '').trim().split(/\s+/).length
  const mins  = Math.round(words / 200 * 2) / 2
  if (mins < 1) return '< 1 min read'
  return `${mins} min read`
}

export interface DocResult {
  html:        string
  headings:    Heading[]
  title:       string
  description: string
  readingTime: string
  raw:         string
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

  const description = extractDescription(raw)
  const rt          = readingTime(raw)

  return { html, headings, title, description, readingTime: rt, raw }
}
