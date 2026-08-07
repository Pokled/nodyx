# Contributing to Nodyx

Read this in [Français](docs/fr/CONTRIBUTING.md) or [Español](docs/es/CONTRIBUTING.md).

> "Nodyx belongs to its community. Not its creators."

This page is the short version, so GitHub can point you here from any issue or pull
request. The complete guide lives in [docs/en/CONTRIBUTING.md](docs/en/CONTRIBUTING.md).

---

## Translate Nodyx

The most accessible contribution. No code to write, and no account to create anywhere
except GitHub.

**[nodyx.org/translate](https://nodyx.org/translate)** lists every language, how far
along it is, and links straight to the file you would edit.

```
nodyx-frontend/src/lib/locales/   , the interface, one flat JSON file per language
docs/                             , the documentation, one folder per language
```

Leave every `{{variable}}` exactly as it is. Continuous integration checks them for
you, so you cannot break the app by translating.

Full details: [Translating Nodyx](docs/en/CONTRIBUTING.md#translating-nodyx).

---

## Report a bug

Open an [issue](https://github.com/Pokled/nodyx/issues/new/choose) with:

- The Nodyx version
- The server operating system
- Steps to reproduce
- What you saw against what you expected
- Logs if you have them

A security flaw never goes in a public issue. Read [SECURITY.md](.github/SECURITY.md)
first.

---

## Write code

1. Fork the repository, then branch: `feat/my-feature` or `fix/my-fix`
2. TypeScript, comments in English
3. Tests are required for any new API route
4. `cd nodyx-frontend && npm run check` must report zero errors
5. Open a Pull Request and fill in every section of the template

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
and are written in English:

```
feat: add voice channel mute shortcut
fix: correct JWT expiry check
docs: update installation guide
```

### The core is a sanctuary

`nodyx-core/src/` and `docs/en/MANIFESTO.md` do not change without prior discussion.
If you think something there should move, open an issue and explain why. The
discussion is open. Unilateral modification is not.

### What we will not merge

- Code without tests
- Code that breaks existing tests
- Code with proprietary dependencies
- Code that centralizes user data
- Code that contradicts [ARCHITECTURE.md](docs/en/ARCHITECTURE.md) without prior discussion

---

Every contributor gets a star and a place in [CONTRIBUTORS.md](CONTRIBUTORS.md),
translators included.
