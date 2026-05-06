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

### 🌟🌟 Regulars : 2 to 4 stars

<table>
  <tr>
    <td align="center" width="200">
      <a href="https://github.com/waazaa-fr">
        <img src="https://github.com/waazaa-fr.png?size=120" width="120" height="120" style="border-radius:50%;" alt="waazaa-fr"/>
        <br/>
        <sub><b>waazaa-fr</b></sub>
      </a>
      <br/>
      <sub>🌟 × 2</sub>
      <br/>
      <sub><a href="https://github.com/Pokled/nodyx/issues/14">#14</a> · <a href="https://github.com/Pokled/nodyx/issues/15">#15</a></sub>
      <br/>
      <sub><em>installer bug hunter, hat trick edition</em></sub>
      <br/>
      <sub><strong>First Regular 🎯</strong></sub>
    </td>
    <td align="center" width="200">
      <a href="https://github.com/naranco66">
        <img src="https://github.com/naranco66.png?size=120" width="120" height="120" style="border-radius:50%;" alt="naranco66"/>
        <br/>
        <sub><b>naranco66</b></sub>
      </a>
      <br/>
      <sub>🌟 × 3</sub>
      <br/>
      <sub><a href="https://github.com/Pokled/nodyx/pull/16">PR #16</a> · <a href="https://github.com/Pokled/nodyx/pull/19">PR #19</a> · <a href="https://github.com/Pokled/nodyx/pull/22">PR #22</a></sub>
      <br/>
      <sub><em>Spanish (es) translation + Docker setup fixes</em></sub>
      <br/>
      <sub><strong>First Hispanic contributor 🇪🇸</strong></sub>
    </td>
    <td align="center" width="200">
      <a href="https://github.com/forke24x7">
        <img src="https://github.com/forke24x7.png?size=120" width="120" height="120" style="border-radius:50%;" alt="forke24x7"/>
        <br/>
        <sub><b>forke24x7</b></sub>
      </a>
      <br/>
      <sub>🌟 × 5</sub>
      <br/>
      <sub><a href="https://github.com/Pokled/nodyx/issues/5">#5</a> · <a href="https://github.com/Pokled/nodyx/issues/18">#18</a> · <a href="https://github.com/Pokled/nodyx/issues/21">#21</a> · <a href="https://github.com/Pokled/nodyx/discussions/23">#23</a></sub>
      <br/>
      <sub><em>German translation + Pangolin support + tunnel installer hardener + Caddy Host-filter root cause</em></sub>
      <br/>
      <sub><strong>First German contributor 🇩🇪</strong></sub>
    </td>
    <td align="center" width="200">
      <a href="https://github.com/lukasMega">
        <img src="https://github.com/lukasMega.png?size=120" width="120" height="120" style="border-radius:50%;" alt="Lukáš Melega"/>
        <br/>
        <sub><b>Lukáš Melega</b></sub>
      </a>
      <br/>
      <sub>🌟 × 2</sub>
      <br/>
      <sub><a href="https://github.com/Pokled/nodyx/discussions/12">#12</a> · <a href="https://github.com/Pokled/nodyx/discussions/12#discussioncomment-16720117">focus bug</a></sub>
      <br/>
      <sub><em>docs search UX hunter (heading-aware index + focus + slug pipeline)</em></sub>
      <br/>
      <sub><strong>First Czech contributor 🇨🇿</strong></sub>
    </td>
  </tr>
</table>

### 🌟 Rookies : first contribution merged

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

### 🎲 The accidental contributor

Sometimes a contribution isn't a PR. Sometimes it's just being there at exactly the wrong second.

<table>
  <tr>
    <td align="center" width="280">
      <div style="font-size:56px; line-height:1">🎲</div>
      <br/>
      <sub><b>Yannick</b></sub>
      <br/>
      <sub><em>nodyx.org member · 2026-05-06 21:05</em></sub>
      <br/>
      <sub><em>Registered an account precisely between a `pg_dump` (21:00) and the corresponding restore test (21:17). His user row got wiped by the restore, which revealed the system was dumping its own meta-tables (`backups`, `backup_audit_log`, `backup_settings`, `schema_migrations`) and erasing them at restore time — including the freshly-created pre-restore safety snapshot. Account was recovered via CLI restore of the pre-restore snapshot. Bug then fixed in <a href="https://github.com/Pokled/nodyx/commit/87696f6">87696f6</a>: `--exclude-table` on the four meta-system tables, plus a forthcoming maintenance-mode UX so the next person who registers during a backup window sees a friendly notice instead of a vanishing act.</em></sub>
      <br/>
      <sub><strong>Surfaced the backup safety-net bug 🛡️</strong></sub>
    </td>
  </tr>
</table>

---

## Contribution log

| Contributor | Contribution | Type | Issue / PR | Fix / polish | Date |
|---|---|---|---|---|---|
| Yannick (nodyx.org member) | Created an account at the worst possible second of the very first prod backup test (between `pg_dump` at 21:00 and `pg_restore` at 21:17). The user row got wiped by the restore, which is what made it visible that `pg_dump` was capturing the system tables themselves (`backups`, `backup_audit_log`, `backup_settings`, `schema_migrations`) — meaning a restore was destroying the safety net created seconds earlier. Account recovered via CLI restore of the pre-restore snapshot. | `bug(backup)` | — | [`87696f6`](https://github.com/Pokled/nodyx/commit/87696f6) | 2026-05-06 |
| [@lukasMega](https://github.com/lukasMega) | Reported docs search input losing focus on click (had to click twice), second-pass test of [`882099d`](https://github.com/Pokled/nodyx/commit/882099d) which triggered a full slug + UX audit : 108 broken TOC links, 60 leading-dash ids, 11 phantom entries from code-block comments | `bug(docs)` | [#12](https://github.com/Pokled/nodyx/discussions/12) | [`a429fa3`](https://github.com/Pokled/nodyx/commit/a429fa3) | 2026-05-02 |
| [@lukasMega](https://github.com/lukasMega) | Reported docs search returned no results for `"minimum requirements"` (h3 sections invisible to the index) and asked about Raspberry Pi 4 / 5 + local-IP-no-HTTPS support | `bug(docs)` | [#12](https://github.com/Pokled/nodyx/discussions/12) | [`882099d`](https://github.com/Pokled/nodyx/commit/882099d) | 2026-04-26 |
| [@naranco66](https://github.com/naranco66) | Fixed orphaned `nexus-*` references in `docker-compose.yml` post-rebrand + Alpine font path mismatch breaking frontend build | `fix(docker)` | [#22](https://github.com/Pokled/nodyx/pull/22) | [`b629242`](https://github.com/Pokled/nodyx/commit/b629242) | 2026-04-27 |
| [@waazaa-fr](https://github.com/waazaa-fr) | Reported broken `nodyx-turn` download URL in installer | `bug(installer)` | [#14](https://github.com/Pokled/nodyx/issues/14) | [`c24a851`](https://github.com/Pokled/nodyx/commit/c24a851) | 2026-04-26 |
| [@waazaa-fr](https://github.com/waazaa-fr) | Reported `/opt/nodyx` parent dir not auto-created in installer | `bug(installer)` | [#15](https://github.com/Pokled/nodyx/issues/15) | [`4c0ab74`](https://github.com/Pokled/nodyx/commit/4c0ab74) | 2026-04-26 |
| [@forke24x7](https://github.com/forke24x7) | Pinned the blank-page root cause via byte-count diagnostic on Caddy `:80` : `Host: 127.0.0.1` returned 37 KB of HTML, `Host: <public-domain>` returned 0 bytes. Showed the rendered site address `http://127.0.0.1:80, http://[::1]:80 { }` was a Host filter, not a bind. Validated the `:80 { bind ... }` fix manually before it shipped. | `bug(caddy)` | [#23](https://github.com/Pokled/nodyx/discussions/23) | [`5445e8b`](https://github.com/Pokled/nodyx/commit/5445e8b) | 2026-05-03 |
| [@forke24x7](https://github.com/forke24x7) | Reported Bad Gateway then loading-spinner on Pangolin install, second-pass test of PR #24 surfaced two remaining issues : `--repair` skipped Caddyfile regen, UFW blocked LAN port 80 in bridge mode | `bug(installer)` | [#23](https://github.com/Pokled/nodyx/discussions/23) | [`cfa52ee`](https://github.com/Pokled/nodyx/commit/cfa52ee) | 2026-05-01 |
| [@forke24x7](https://github.com/forke24x7) | Caught regression in `install_tunnel.sh` : missing `PUBLIC_TURN_*` vars broke the SvelteKit build | `bug(installer)` | [#21](https://github.com/Pokled/nodyx/issues/21) | [`cbc9e6b`](https://github.com/Pokled/nodyx/commit/cbc9e6b) | 2026-04-27 |
| [@forke24x7](https://github.com/forke24x7) | German (de) translation : 741 strings, hand-reviewed by a native German speaker, attached on issue #5 | `feat(i18n)` | [#5](https://github.com/Pokled/nodyx/issues/5) | _integrated by maintainer_ | 2026-04-27 |
| [@forke24x7](https://github.com/forke24x7) | Pangolin / alternative-tunnel support requested | `feat(installer)` | [#18](https://github.com/Pokled/nodyx/issues/18) | [`dfa8eca`](https://github.com/Pokled/nodyx/commit/dfa8eca) | 2026-04-26 |
| [@naranco66](https://github.com/naranco66) | Native Spanish review of community pulse strings (7 keys, dropped 2 duplicate keys) | `i18n(es)` | [#19](https://github.com/Pokled/nodyx/pull/19) | [`a9a90b3`](https://github.com/Pokled/nodyx/commit/a9a90b3) | 2026-04-27 |
| [@naranco66](https://github.com/naranco66) | Spanish (es-ES) translation : 719 strings, full key + placeholder parity | `feat(i18n)` | [#16](https://github.com/Pokled/nodyx/pull/16) | _polish pending if needed_ | 2026-04-26 |
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

> *« Rien n'est parfait. On veut aider, parfois même en croyant bien faire, on se trompe un peu, mais le geste est là. »*
>
> — Jonathan, April 18, 2026

**That's the part that counts. That's the part we protect here.**

<details>
<summary><strong>🌍 The same words, in the languages of everyone who might read this one day</strong></summary>

<br/>

**🇬🇧 English**
> *"Nothing is ever perfect. We try to help, and sometimes even when we think we're doing it right, we get it a little wrong — but the gesture is there."*

**🇧🇩 বাংলা (Bengali)** — *for @Pranto2003, who brought us here*
> *"কিছুই নিখুঁত নয়। আমরা সাহায্য করতে চাই, কখনও ভালো করার চেষ্টা করেও সামান্য ভুল করে ফেলি — কিন্তু উদ্যোগটি সেখানে আছে।"*

**🇪🇸 Español**
> *"Nada es perfecto. Queremos ayudar, a veces incluso creyendo hacer lo correcto nos equivocamos un poco — pero el gesto está ahí."*

**🇧🇷 Português (Brasil)**
> *"Nada é perfeito. Queremos ajudar, às vezes mesmo achando que estamos fazendo certo, a gente erra um pouquinho — mas o gesto está lá."*

**🇩🇪 Deutsch**
> *"Nichts ist perfekt. Wir wollen helfen, und selbst wenn wir glauben, es richtig zu machen, irren wir uns manchmal ein wenig — aber die Geste zählt."*

**🇮🇹 Italiano**
> *"Niente è perfetto. Vogliamo aiutare, e a volte anche credendo di fare bene, sbagliamo un po' — ma il gesto c'è."*

**🇳🇱 Nederlands**
> *"Niets is perfect. We willen helpen, soms zelfs wanneer we denken dat we het goed doen, gaan we een beetje de mist in — maar het gebaar is er."*

**🇵🇱 Polski**
> *"Nic nie jest idealne. Chcemy pomóc, czasem nawet myśląc, że robimy dobrze, trochę się mylimy — ale gest tam jest."*

**🇹🇷 Türkçe**
> *"Hiçbir şey mükemmel değildir. Yardım etmek isteriz, bazen doğrusunu yaptığımızı düşünürken biraz hata yaparız — ama jest oradadır."*

**🇷🇺 Русский**
> *"Ничто не идеально. Мы хотим помочь, иногда даже думая, что делаем правильно, ошибаемся немного — но жест есть."*

**🇺🇦 Українська**
> *"Ніщо не ідеальне. Ми хочемо допомогти, іноді навіть думаючи, що робимо правильно, трохи помиляємось — але жест є."*

**🇨🇳 中文 (简体)**
> *"没有什么是完美的。我们想要帮忙，有时即使觉得自己做对了，也会犯些小错——但心意在那里。"*

**🇯🇵 日本語**
> *"完璧なものなんて何もない。私たちは助けたいと思っていて、時には正しいと思っても少し間違えてしまう——でも、その気持ちは確かにそこにある。"*

**🇰🇷 한국어**
> *"완벽한 것은 없습니다. 우리는 돕고 싶고, 때로는 옳게 하고 있다고 생각해도 조금 틀릴 수 있어요 — 하지만 그 마음은 거기 있습니다."*

**🇻🇳 Tiếng Việt**
> *"Không gì là hoàn hảo. Chúng ta muốn giúp đỡ, đôi khi dù nghĩ rằng mình đang làm đúng, vẫn sai sót một chút — nhưng tấm lòng vẫn ở đó."*

**🇸🇦 العربية**
> *"لا شيء مثالي. نحن نريد أن نساعد، وأحيانًا حتى عندما نظن أننا نفعل الصواب، نخطئ قليلاً — لكن النية موجودة."*

**🇮🇳 हिन्दी**
> *"कुछ भी परफेक्ट नहीं होता। हम मदद करना चाहते हैं, कभी-कभी सही करते हुए भी थोड़ा गलत कर बैठते हैं — लेकिन भावना वहीं है।"*

<br/>

*If you speak a language not listed above and want to add it, open a PR. Your name goes on this wall, your language goes in this note. Nodyx is built by people — that's the whole point.*

</details>

---

<div align="center">

*"We built the internet to bring people together. Not to divide them."*

**[Nodyx](https://nodyx.org)** — Self-hosted, AGPL-3.0, zero analytics, forever.

</div>
