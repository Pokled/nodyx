# i18n tooling

Two small, dependency-free scripts to keep Nodyx fully translatable and catch
hardcoded strings before they pile up.

## The rule

**Every user-facing string goes through a translation key. Nothing hardcoded.**
Keys are written in English; strings are authored in French in `fr.json` (the
source), mirrored to `en.json`, then translated into the other locales.

## `npm run i18n:scan`

Finds French text still living in Svelte markup **outside** an i18n call
(`tFn(...)` / `$t(...)`). Since keys are English, any French left in a template
is a string that was never extracted.

It also flags hardcoded **translatable attributes** (`aria-label`, `title`,
`placeholder`, `alt`, `data-tip`) with a literal value, in **any** language, so
English strings from contributors are caught too (the French heuristic misses
those). An `attr={tFn(...)}` uses braces, not quotes, so it is never flagged.

```bash
npm run i18n:scan              # count per file + total
npm run i18n:scan -- --list    # show every offending line
npm run i18n:scan -- --public  # ignore admin / studio (owner-only) pages
npm run i18n:scan -- --check   # exit 1 if anything is found (CI gate)
```

The goal is **0** (public pages first, admin/studio next), then wire
`--public --check` into CI so it never regresses.

## `npm run i18n:coverage`

Shows, per locale, how many keys are present vs missing. A missing key falls
back to French at runtime, so coverage is the "what is left to translate"
surface.

```bash
npm run i18n:coverage                 # coverage table
npm run i18n:coverage -- --emit de    # print { key: source } missing in `de`
```

## Translating a language (contributors welcome)

You do **not** need to hunt through the code. Everything is already extracted
into keys:

1. Pick your language (e.g. `de`) and run
   `npm run i18n:coverage -- --emit de > de.todo.json`.
2. Translate the **values** in that file (keep the keys and any `{{placeholders}}`).
3. Merge them into `src/lib/locales/de.json` and open a PR.

One merged translation PR earns a star on the Nodyx Stars wall. A native speaker
sanity-checking existing wording counts too.
