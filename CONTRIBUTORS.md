<div align="center">

# 🌟 Nodyx Stars

**The people who make Nodyx better.**

*Every external contribution — a bug fix, a typo, a new feature, a translation — earns a star.<br/>
Because open source without recognition is just free labor.*

</div>

---

## The Nodyx Star Rank System

| Rank | Stars | Contributions merged |
|:---:|:---:|:---|
| 🌟 | 1 star | **Rookie** — first contribution, welcome aboard |
| 🌟🌟 | 2–4 stars | **Regular** — you know where the files live |
| 🌟🌟🌟 | 5–9 stars | **Core Contributor** — the project leans on you |
| 🌟🌟🌟🌟 | 10–19 stars | **Nodyx Star** — part of the project's backbone |
| 🌟🌟🌟🌟🌟 | 20+ stars | **Legend** — a piece of Nodyx is yours |

One merged PR = one star. Typos count. Translations count. Bug reports that turn into fixes count. Everything counts.

---

## Hall of Fame

### 🌟 Rookies — First contribution merged

<table>
  <tr>
    <td align="center" width="200">
      <a href="https://github.com/Pranto2003">
        <img src="https://github.com/Pranto2003.png?size=120" width="120" height="120" style="border-radius:50%;" alt="Pranto Goswamee"/>
        <br/>
        <sub><b>Pranto Goswamee</b></sub>
      </a>
      <br/>
      <sub>🌟 × 1</sub>
      <br/>
      <sub><a href="https://github.com/Pokled/nodyx/pull/11">PR #11</a></sub>
      <br/>
      <sub><em>Ctrl/Cmd + D canvas duplication</em></sub>
      <br/>
      <sub><strong>First external contributor 🏆</strong></sub>
    </td>
  </tr>
</table>

---

## Contribution log

| Contributor | Contribution | Type | PR | Polish applied | Date |
|---|---|---|---|---|---|
| [@Pranto2003](https://github.com/Pranto2003) | Ctrl/Cmd + D to duplicate selected canvas elements | `feat(canvas)` | [#11](https://github.com/Pokled/nodyx/pull/11) | [`d19682f`](https://github.com/Pokled/nodyx/commit/d19682f) · [`cbecb2f`](https://github.com/Pokled/nodyx/commit/cbecb2f) · [`de84424`](https://github.com/Pokled/nodyx/commit/de84424) | 2026-04-18 |

---

## The Polish Trail — what we fixed behind each contribution

**Transparency matters.** Every external contribution is listed below with the polish commits that followed the merge. This is not a walk of shame — it's proof that we care about the final quality of the codebase, and that we do the cleanup ourselves rather than sending contributors through review hell.

**The contributor keeps the feature credit, we keep the polish behind them.** Both are visible. Both are in the repo forever.

### PR [#11](https://github.com/Pokled/nodyx/pull/11) — @Pranto2003 — `feat(canvas): Ctrl/Cmd + D`

**Original commit:** [`90f3644`](https://github.com/Pokled/nodyx/commit/90f3644) — core logic was correct, pattern-matched the existing `cs.apply` / `pushUndo` / `socket.emit` pipeline, included `preventDefault`, handled multi-selection.

**Polish commit 1:** [`d19682f`](https://github.com/Pokled/nodyx/commit/d19682f) — `chore(contrib): polish PR #11`
- Restored an inline comment in `onKeydown` that had been removed
- Reordered `cs.apply` → `pushUndo` → `socket.emit` to match the 23 other handlers in the file
- Added a guard so `selectedIds` isn't wiped when every selected element was locked/deleted

**Polish commit 2:** [`cbecb2f`](https://github.com/Pokled/nodyx/commit/cbecb2f) — `fix(canvas): always preventDefault on Ctrl+D`
- Moved `preventDefault()` outside the `selectedIds.size > 0` guard
- Fixes a UX bug: without a selection, Chrome/Firefox would open the "Add bookmark" dialog on the canvas page

Caught during production testing after merge. Not visible in async review.

**Polish commit 3:** [`de84424`](https://github.com/Pokled/nodyx/commit/de84424) — `fix(canvas): use moveElement() for proper type-safe clone offset`
- Replaced top-level `el.x / el.y` access (which doesn't exist on `CanvasElement`) with the existing `moveElement(el, el.data, 20, 20)` helper
- Fixes **2 TypeScript errors** that broke CI after merge
- Also fixes a runtime bug: the `+20px` offset wasn't actually applied — clones were stacking exactly on top of the originals (caught thanks to the CI red flag)
- Now supports every canvas element type correctly: pen paths, sticky notes, shapes, arrows, connectors, frames

**This is exactly why we merge-then-polish: some bugs only surface when real hands touch real pixels, and some only when CI runs the type checker.** Three polish passes on one PR is not a failure — it's the system working. The contributor still gets the star, the feature ships, the codebase stays clean. Everyone wins.

---

## Core maintainer

<table>
  <tr>
    <td align="center" width="200">
      <a href="https://github.com/Pokled">
        <img src="https://github.com/Pokled.png?size=120" width="120" height="120" style="border-radius:50%;" alt="Jonathan"/>
        <br/>
        <sub><b>Jonathan (Pokled)</b></sub>
      </a>
      <br/>
      <sub><em>Creator & core maintainer</em></sub>
      <br/>
      <sub>Built Nodyx from day one</sub>
    </td>
  </tr>
</table>

---

## Want to be on this wall?

1. Browse [open Issues](https://github.com/Pokled/nodyx/issues) — look for the `good first issue` label
2. Read [CONTRIBUTING.md](docs/en/CONTRIBUTING.md)
3. Open a PR — "does it work and does it respect the existing patterns" is the bar, **not** "is it perfect"

### Our rule

**Merge-then-polish, never gatekeep.**

If your code has rough edges, we add a follow-up commit and you still get your star. We'd rather merge 100 imperfect contributions than block 10 perfect ones behind review hell.

Your name, your GitHub avatar, and your profile link go on this page. **Forever.** This file is part of the repo — it'll outlive any of us.

### But we're serious about quality

The [Polish Trail](#the-polish-trail--what-we-fixed-behind-each-contribution) above lists every follow-up commit we added after merging. Nothing is hidden. You can see exactly what we changed, why, and where.

This is the deal:
- **You** ship the feature, keep the credit, earn the star.
- **We** do the cleanup, publicly, with commits you can read.
- **Nothing gets swept under the rug** — not your contribution, not our edits.

---

### A note on how this page came to be

The *Polish Trail* and *serious about quality* sections above didn't exist before PR #11. They exist **because of it** — that's what one contribution taught us on April 18, 2026.

Nothing is ever perfect. People show up trying to help, sometimes they get it slightly wrong while trying to do good — but the gesture is there. That's the part that counts, and that's the part we protect here.

---

<div align="center">

*"We built the internet to bring people together. Not to divide them."*

**[Nodyx](https://nodyx.org)** — Self-hosted, AGPL-3.0, zero analytics, forever.

</div>
