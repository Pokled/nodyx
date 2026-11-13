# Article Editor

The rich editor behind every forum post, wiki page, article and direct message on Nodyx. It is a true WYSIWYG editor (built on TipTap / ProseMirror) with first-class support for images, anchored tables of contents, two-column layouts, embedded media, and styled console blocks for tutorials.

**Status:** v2.8. The editor went through a full robustness audit and overhaul in June 2026 ([audit](https://github.com/Pokled/nodyx/blob/main/docs/audits/2026-06-15-editeur-rich.md)). Everything below is round-trip safe: your content survives being re-edited and re-saved, no silent loss.

---

## Why round-trip safety matters

Most rich editors quietly corrupt complex content when you re-edit it: a column layout flattens, an embedded video vanishes, a styled block loses its structure. Nodyx fixed this at the root. Every custom block identifies itself by its **CSS class** (which the content sanitizer always preserves), never by a volatile `data-*` attribute that gets stripped on save. The practical promise: write a rich article, close it, reopen it a week later, edit one word, save. Everything else stays exactly as it was.

---

## Formatting basics

The toolbar covers the essentials: bold, italic, underline, strikethrough, inline code, headings (H1 to H3), bullet and numbered lists, blockquotes, code blocks (with syntax highlighting), links, text color, text alignment, and a horizontal rule. On a long article the toolbar stays in reach: the editable area has a bounded height with its own scrollbar, so the toolbar is always one glance away, you never scroll the whole page to reach it.

A floating quick-bar also appears when you select text, with bold, italic and the **Anchor** button (see below).

---

## Images

**Insert.** Click the image button. You can paste a URL, or open the **media library** to pick an asset already uploaded to your instance.

**Align.** Four alignments: left and right (text wraps around), center, and full width.

**Resize.** Click an image and four purple corner handles appear. Drag a corner and the width snaps to a key fraction of the column: **25, 50, 75 or 100 percent**. A small badge shows the live width as you drag. The chosen width is stored as a plain `width` attribute, so it is preserved on save and reload, and it renders identically on the published page.

**Replace.** Select an image, reopen the image menu, and it pre-fills with the current image. Confirm to swap it in place, no need to delete and reinsert.

---

## Table of contents (anchors)

Nodyx builds a wiki-style table of contents from the sections **you** choose, by a direct gesture.

1. Select the line that should become a section (or place your cursor on it).
2. In the floating bar, click **Anchor**.
3. The line becomes a section heading with an anchor, and a link to it appears in a **Sommaire** box at the top of the article.
4. Repeat for each section. The menu is rebuilt from your anchored headings, in document order, with a short flash so you see it was taken into account.
5. Click Anchor again on an anchored section to remove it from the menu.

The menu is **derived**: you do not type into it, you drive it by anchoring and un-anchoring. Anchors are always section headings (an `id` only survives the sanitizer on a heading, and that is also what search engines expect), so your table of contents is good for navigation and for SEO at the same time.

---

## Two-column layouts

Insert a two-column block to place content side by side (text and an image, two lists, a comparison). Each column accepts the full range of blocks. Columns are round-trip safe: they no longer flatten when you re-edit the article.

---

## Embedded media

**Videos.** Paste a YouTube URL to embed a player (privacy-friendly `youtube-nocookie` by default). You can place several videos in one article and re-edit freely; they are preserved across saves.

**Audio.** The Nodyx audio player can be embedded inline, single track or a small playlist, with cover art, title and artist. Useful for release notes, podcasts, or sound-design write-ups.

**Tables.** A standard table tool (insert, add/remove rows and columns) for structured data.

---

## Console blocks (for tutorials)

When you write an installation guide or a command-line tutorial, a plain code block is not enough. Nodyx has a **styled SSH console block**: a terminal window with a title bar and semantic coloring (the shell prompt, the command you type, the script's questions, the answer to give highlighted, success and info lines).

In the editor the console is a **protected block**: you cannot corrupt it by typing into it by accident. To edit its content, use the **Code / Render toggle** on the block (the CMS pattern): click **Code** to edit the raw HTML source, click **Render** to see the styled result. The source is taken into account as you type, so saving works whether or not you switch back to Render.

This is what powers the [installation guides](https://nodyx.org): the reader sees a faithful simulation of the install command, with the answers to type highlighted.

---

## Publishing and SEO

Everything you write is rendered server-side as a permanent, indexable web page: canonical URL, structured data, sitemap entry, and a correct `og:image` (the article's lead image) for clean link previews on Discord, Twitter and search engines. Public forum threads are readable without an account, so your community's knowledge stays on the open web instead of vanishing into a silo.

---

## FAQ

**Will my content break if I re-edit it?**
No. That was the whole point of the v2.8 overhaul. Columns, videos, images, console blocks and the table of contents all survive re-editing. If you ever find a block that does not, it is a bug worth reporting, not expected behavior.

**Can I write raw HTML?**
The console block has a Code view for raw HTML, gated by a sanitizer allowlist (the same one that protects every post). Arbitrary `<script>` and unsafe attributes are stripped. What survives is a safe, structured subset (headings with ids, styled spans, tables, allowed iframes, images from your instance or a known GIF CDN).

**Is the editor used everywhere?**
Yes, the same editor powers forum posts, wiki pages, the homepage article widgets, calendar event descriptions and direct messages. Learn it once.

**Does the table of contents update if I rename a section?**
Re-click Anchor on the section, or anchor any section again, and the menu is rebuilt from the current headings. It is derived, not a frozen snapshot.

---

*Editor component: [`nodyx-frontend/src/lib/components/editor/NodyxEditorCore.svelte`](https://github.com/Pokled/nodyx/blob/main/nodyx-frontend/src/lib/components/editor/NodyxEditorCore.svelte). Robustness audit: [`docs/audits/2026-06-15-editeur-rich.md`](https://github.com/Pokled/nodyx/blob/main/docs/audits/2026-06-15-editeur-rich.md).*
