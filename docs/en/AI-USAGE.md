# AI Usage

> By transparency — and because it's in the open-source spirit of this project — here's how artificial intelligence is involved in Nodyx development.

## Context

Nodyx is a solo project. One developer — me, Pokled — designs, codes, tests, and maintains the entire platform. AI is a tool that lets me develop at a speed that would otherwise be impossible alone, while keeping full control over every decision.

## What the AI does

- **Code generation** — Svelte components, Fastify routes, SQL migrations, bash scripts. I describe what I want, the AI produces a base, I read through it and adapt.
- **Architecture & design thinking** — challenging my technical choices, anticipating problems, structuring complex features before implementing them.
- **Debugging** — analyzing errors, tracing bugs in dense code, understanding unexpected behavior.
- **Writing** — error messages, UI text, documentation, installation scripts.
- **Refactoring** — improving readability, harmonizing patterns, cleaning up accumulated code.

## What I do

- **I read every line of code produced.** Nothing goes to production without me having read, understood, and validated it. The AI doesn't commit on my behalf.
- **I make all architecture decisions.** The project vision, structural technical choices, trade-offs — that's me. The AI executes, I decide.
- **I test and validate.** On the real platform, not just by reading generated code.
- **I fix the AI's mistakes.** It's wrong often — missing context, bad assumptions, unsuitable patterns. My job is also to catch those errors before they cause problems.
- **I maintain project coherence over time.** The AI has no long memory of the project — I'm the one holding the thread.

## Tool

I primarily use **Claude Code** by Anthropic — an AI assistant that operates directly in the command line within the repository. It can read files, search through code, write and modify files. Everything it does is visible and reversible via git.

## Why be transparent about this

Nodyx is licensed under AGPL-3.0. The source code is public, decisions are documented in git. It would be inconsistent to hide how the project is built. AI isn't cheating — it's a tool, like a compiler or a linter. What matters is the quality of the result and the accountability of the person who signs the code.

If you find a bug or unexpected behavior, report it — AI or not, it's my code, it's my responsibility.
