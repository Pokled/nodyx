# Contributing to Nodyx
### Welcome to the Nodyx community

---

> "Nodyx belongs to its community. Not its creators."
> If you're reading this file, you are potentially a builder of the free internet.
> Welcome.

---

## Before you start

Read these files in this order:
1. `ARCHITECTURE.md`, How Nodyx is built
2. `MANIFESTO.md`, The soul of the project
3. `ROADMAP.md`, Where we're going

If you disagree with the Manifesto, Nodyx may not be the right project for you.
And that's okay.

---

## Where to contribute

### You can contribute freely in
```
nodyx-frontend/src/lib/locales/  , Translate the interface
docs/                            , Documentation, and its translations
nodyx-frontend/src/              , Frontend features and fixes
nodyx-docs/                      , The nodyx.dev documentation site
```

### You cannot modify without validation
```
nodyx-core/src/          , Main server code
docs/en/ARCHITECTURE.md
docs/en/MANIFESTO.md
```

If you think something in the core should change, open an Issue and explain why. Discussion is open. Unilateral modification is not.

---

## Creating a plugin

### Minimal structure
```
nodyx-plugins/my-plugin/
├── plugin.json    , Required manifest
├── index.ts       , Entry point
├── README.md      , Documentation
└── LICENSE        , License (MIT recommended)
```

### Minimal plugin.json
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What my plugin does",
  "author": "Your name or username",
  "license": "MIT",
  "nodyxVersion": ">=1.0.0"
}
```

### Plugin rules
1. A plugin never modifies core tables (users, communities, categories, threads, posts)
2. A plugin may add its own tables with the prefix `plugin_{name}_`
3. A plugin only uses hooks documented in ARCHITECTURE.md
4. A plugin cannot disable another plugin
5. A plugin must work even if its optional dependencies are absent

---

## Contributing to core code

### Process
1. Fork the repo
2. Create a branch: `feat/my-feature` or `fix/my-fix`
3. Code in TypeScript, comments in English
4. Tests are required for any new API route
5. Open a Pull Request with a clear description

### Commit format (required)

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add voice channel mute shortcut
fix: correct JWT expiry check
docs: update installation guide
refactor: extract voice signaling to separate module
test: add auth middleware unit tests
chore: update dependencies
```

All commit messages and code comments must be in **English**.

### What we won't merge
- Code without tests
- Code that breaks existing tests
- Code with proprietary dependencies
- Code with backdoors (obviously)
- Code that centralizes user data
- Code that contradicts ARCHITECTURE.md without prior discussion

---

## Translating Nodyx

Translation is the most accessible contribution. No coding required, and no account to create anywhere except GitHub.

**Live status: [nodyx.org/translate](https://nodyx.org/translate)** lists every language, how far along it is, and links straight to the file you would edit.

### The interface

The entire app interface lives in one flat JSON file per language:

```
nodyx-frontend/src/lib/locales/
  fr.json          , source language
  en.json          , reference, kept at 100%
  de.json  es.json  pt-PT.json  ru.json  vi.json
```

1. Open [nodyx.org/translate](https://nodyx.org/translate) and find your language
2. Click "Translate on GitHub", it forks the repository for you
3. Fill in the missing keys, leaving every `{{variable}}` exactly as it is
4. Open a Pull Request

Continuous integration checks that no variable was altered, so you cannot break the app by translating. We review, we merge, your work ships in the next release.

Your language is not in the list? Copy `en.json`, name it with your language code, and open an Issue so we can wire it into the language picker.

### The documentation
1. Go to `docs/`
2. Copy the `en/` folder and rename it with your language code (`de/`, `es/`, `ja/`, etc.)
3. Translate the files
4. Open a Pull Request

Files to translate:
```
MANIFESTO.md   , The founding text
THANKS.md      , Acknowledgements
README.md      , Project overview
CONTRIBUTING.md, This guide
ARCHITECTURE.md, Technical reference
ROADMAP.md     , Development roadmap
```

### Translation rules
- Translate meaning, not word-for-word
- Keep the original tone (direct, human, not corporate)
- Never touch what sits inside `{{ }}`, those are values the app fills in at runtime
- If a concept has no equivalent in your language, keep the English term
- Proper nouns (Nodyx, NodyxPoints, Guard Protocol, etc.) are never translated

Translators get a star and a place in [CONTRIBUTORS.md](../../CONTRIBUTORS.md), like every other contributor.

---

## Reporting a bug

Open an Issue with:
- The Nodyx version
- The server operating system
- Steps to reproduce
- What you saw vs. what you expected
- Logs if available

---

## Proposing a feature

Open an Issue with the tag `[FEATURE]` and explain:
- What problem it solves
- For whom (what type of user)
- How you imagine it working
- Should it be in the core or a plugin?

The rule: if it can be a plugin, it must be a plugin.

---

## Code of conduct

### We are here to
- Build something good
- Learn together
- Respect others' work
- Critique ideas, not people

### We are not here to
- Impose our technical opinions
- Dismiss others' contributions
- Promote proprietary tools or services
- Circumvent core rules

---

## Questions

- GitHub Issues for bugs and features
- GitHub Discussions for general questions
- The Nodyx forum itself for everything else

---

## Thank you

Every contribution, no matter how small, is part of something larger.
A typo fix in the docs. A translation. A plugin. A reported bug.

Everything counts. Everything is recorded in the history of the project.

```
git log --oneline
```

Your name will be there.

---

*"The network is the people."*
*AGPL-3.0, The code belongs to its community.*
