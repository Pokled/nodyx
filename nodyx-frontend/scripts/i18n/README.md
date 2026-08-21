# i18n tooling

Small, dependency-free scripts that keep Nodyx fully translatable: they catch
hardcoded strings, dangling keys, English falling behind the source, and
placeholders corrupted by a translation. **Five gates run in CI.**

**The rule they enforce: i18n ships with the feature, never after it.** A new
user-facing string is a key from its first commit, added to `fr.json` **and**
`en.json` in the same pull request. That is the whole point: retrofitting i18n
onto an existing app cost roughly a hundred pull requests once. Never again.

Contributors: the friendly view of all this is **<https://nodyx.org/translate>**.
You do not need any of these commands to translate Nodyx.

## The rule

**Every user-facing string goes through a translation key. Nothing hardcoded.**
Keys are written in English; strings are authored in French in `fr.json` (the
source), mirrored to `en.json`, then translated into the other locales.

At runtime a missing key falls back to **English** before French, because
`en.json` is kept at full parity with the source. A partially translated locale
therefore shows English, never a surprise French sentence.

## `npm run i18n:scan`

Finds French text still living in Svelte markup **outside** an i18n call
(`tFn(...)` / `$t(...)`). Since keys are English, any French left in a template
is a string that was never extracted.

It also flags hardcoded **translatable attributes** (`aria-label`, `title`,
`placeholder`, `alt`, `data-tip`) with a literal value, in **any** language, so
English strings from contributors are caught too. An `attr={tFn(...)}` uses
braces, not quotes, so it is never flagged.

```bash
npm run i18n:scan              # count per file + total
npm run i18n:scan -- --list    # show every offending line
npm run i18n:scan -- --public  # ignore admin / studio (owner-only) pages
npm run i18n:check             # exit 1 if anything is found (CI gate)
```

It sits at **0**, and CI keeps it there for the whole frontend.

Known blind spot: the heuristic looks for accents, a French wordlist, and French
contractions. A sentence that is French, accent-free, and outside the wordlist
can still slip through. The scanner is a net, not a proof.

## `npm run i18n:ts:check` — the ratchet

Until 2026-08-20 the scanner walked **`.svelte` files only**. Every `.ts` file
was invisible to it, and about **375 user-facing strings** were living there
unnoticed: icon labels, module names, widget schemas, server-side page messages.

Clearing them is a long job, so this gate is a **ratchet, not a wall**:

- the debt is frozen, file by file, in `dette-ts.json`;
- a **new** file with French, or a known file that **gains** strings, fails CI;
- the count may fall freely. It may never rise.

That is the whole point. The 2026 extraction marathon happened because nothing
stopped the debt building up in the first place.

```bash
npm run i18n:ts                # list what is still hardcoded in .ts
npm run i18n:ts:check          # exit 1 if the debt grew (CI gate)
npm run i18n:ts:baseline       # re-freeze after clearing some, then commit it
```

Test fixtures (`*.test.ts`, `*.spec.ts`) are excluded on purpose: their French is
the bait that proves the scanner works. Flagging it would ask you to translate
the trap.

**Working some off?** Turn the strings into keys exactly as anywhere else, in
`fr.json` **and** `en.json`, then run `i18n:ts:baseline` and commit the updated
`dette-ts.json` in the same pull request. The gate will then hold the new, lower
number.

## `npm run i18n:keys`

Verifies that every key referenced in the code actually exists in `fr.json`. A
missing one renders the raw key on screen (`dm.reply`), and neither
`svelte-check` nor the build notices.

```bash
npm run i18n:keys              # list missing keys
npm run i18n:keys:check        # exit 1 if any is missing (CI gate)
```

## `npm run i18n:placeholders`

The translator safety net. A translation may change every word, but it must not
invent something the app is meant to fill in. Checks three things against the
source:

- `{{var}}` i18n interpolations, replaced at runtime by `tFn(key, vars)`
- `{token}` single-brace template tokens (OctoGuard welcome messages, alert
  templates, chat timers), substituted later by the feature itself
- `<tag>` markup inside strings rendered with `{@html}`, including balance

The rule is asymmetric on purpose. Something **in the translation but not in the
source** is an error: the call site never passes it, so `{{foo}}` is printed
literally and an unclosed tag leaks markup. Something **in the source but
dropped by the translation** is only a warning, because it is usually a language
choice: French writes `({{n}} non lue{{s}})` with a plural marker that no other
language needs.

```bash
npm run i18n:placeholders        # full report, errors and warnings
npm run i18n:placeholders:check  # exit 1 on errors only (CI gate)
```

## `npm run i18n:parity:check`

Fails when `en.json` is missing a key that exists in the source `fr.json`.

English is not just another language here: it is the **runtime fallback** for
every locale. The moment it falls behind, every non-French speaker starts seeing
French again, which is how the drift begins. So English is the one translation
that is not optional, and CI treats it that way.

Parity is measured against the source, not against the union of all locales: a
key a translator adds in their own language alone never fails the English gate.

```bash
npm run i18n:parity:check                       # exit 1 if en.json lags (CI gate)
node scripts/i18n/coverage.mjs --require en,es  # gate several locales
```

## `npm run i18n:coverage`

Shows, per locale, how many keys are present vs missing. This is the "what is
left to translate" surface, and the same numbers power
<https://nodyx.org/translate>.

```bash
npm run i18n:coverage                 # coverage table
npm run i18n:coverage -- --emit de    # print { key: source } missing in `de`
```

## Translating a language (contributors welcome)

You do **not** need to hunt through the code. Everything is already extracted
into keys, and the whole interface is one flat JSON file per language.

The easy path: open <https://nodyx.org/translate>, click your language, edit on
GitHub, open a pull request. CI runs the placeholder check on it, so you cannot
break the app by translating.

The command-line path:

1. Pick your language (e.g. `de`) and run
   `npm run i18n:coverage -- --emit de > de.todo.json`.
2. Translate the **values** in that file, keeping the keys and every
   `{{placeholder}}` untouched.
3. Merge them into `src/lib/locales/de.json` and open a PR.

One merged translation PR earns a star on the Nodyx Stars wall. A native speaker
sanity-checking existing wording counts too.
