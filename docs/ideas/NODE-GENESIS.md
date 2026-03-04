# IDEA — Node Genesis Paths
### "A Node is never created. It emerges."

> This document captures the design thinking around SPEC 013 (Node) —
> specifically: **how and where does a Node come into existence?**
> The SPEC deliberately leaves this open. This document proposes the answer.

---

## Core Principle

A Node should **never** be created from a blank page.

There is no "Create a Node" button in an empty menu.
A Node is the **crystallization** of something that already lives in the community.
It is a reward for quality. A natural elevation of what already matters.

> *Nodes must impose themselves through their utility, not by rule.*
> — SPEC 013

---

## The 4 Genesis Paths

### Path 1 — Forum Thread → Node

A thread accumulates rich discussion. A moderator (or a community threshold) decides it deserves to be preserved.

```
Thread with deep discussion
  → "🧠 Elevate to Node" button appears (moderator or activity threshold)
  → All messages become Node posts
  → Pinned / highlighted messages become Anchor candidates
  → An empty Summary field appears → community fills it in
  → Node state: "Active"
```

**The signal:** This thread produced something durable. Let's preserve it.

**UX rule:** The button is discreet — it appears only when certain conditions are met
(minimum post count, minimum unique contributors, no spam flags).

---

### Path 2 — Calendar Event → Node

An event ends. It produced decisions, notes, important moments.
The organizer transforms the event page into a living memory.

```
Event ends
  → Organizer sees: "📋 Create a Node from this event"
  → Event description → Node initial Summary
  → Key decisions marked during the event → Anchors
  → Participants automatically notified of the Node's creation
  → Node state: "Slow" (the event is over, reflection time begins)
```

**The signal:** This meeting decided something important. Let's document it permanently.

**Powerful case:** A dart club organizes a tournament.
The event page becomes a Node: results as Anchors, rules as Summary.
Indexed by Google. Findable forever.

---

### Path 3 — Poll / Vote → Node

A community poll closes with a clear result.
The decision needs a permanent, navigable record.

```
Poll closes
  → "🧠 Document this decision" appears
  → Poll question → Node title
  → Results + context → first Anchor
  → Discussion that led to the vote → Node posts
  → Node state: "Stabilized" (already voted — starts validated)
```

**The signal:** The community decided. This Node is the official register of that decision.

**Key difference from a thread:** The Node starts in "Stabilized" state
because the community has already spoken. It doesn't need to grow — it was born mature.

---

### Path 4 — Garden Seed 🍎 → Node

A community feature seed reaches the Fruit stage (200+ waters).
The idea has been collectively validated. Now it needs to be tracked.

```
Seed reaches 🍎 Fruit (200+ waters)
  → "This seed is ripe → Transform into a tracking Node"
  → Seed description → Node Summary
  → Waters become the Node's initial Garden validation
  → The Node tracks the idea's implementation over time
  → Node state: "Active" (implementation begins)
```

**The signal:** You voted for this. Here is the Node that follows its realization.

**The loop:** The Node is watered by the community as the implementation progresses.
When the feature ships → Node state: "Stabilized" → Garden validation: 🍎

---

## The Garden × Node Connection

The Garden is not just a standalone voting tool.
It is the **organic validation mechanism** of the Node lifecycle.

```
Node state   →  Garden stage   →  Community signal
─────────────────────────────────────────────────────
Active       →  🌱 Germe        →  "We're exploring this"
Slow         →  🌿 Pousse       →  "This is gaining trust"
Stabilized   →  🌸 Fleur        →  "The community validates this"
Archived     →  🍎 Fruit        →  "This is a definitive reference"
```

No admin decides the state arbitrarily.
The community **waters** the Node, and the state emerges organically.

This is the anti-Reddit: scoring based on **quality validation**, not activity volume.

---

## Global Search × Node (SPEC 010 Connection)

A 🍎 Fruit Node in the global search engine = **priority result**.

Not because it was posted recently.
Not because it has 500 comments.
Because the community has **collectively validated it as reliable**.

```
Nexus Global Search ranking for Nodes:
  1. Stability (state: stabilized > slow > active)
  2. Garden validation (water count)
  3. Cross-references (how many other Nodes link to it)
  4. NOT activity. NOT recency. NOT popularity.
```

This is knowledge-first search. The anti-algorithm.

---

## What a Node Is NOT born from

- ❌ A blank form someone filled in isolation
- ❌ An admin decision ("I declare this a Node")
- ❌ An automated process with no human intent
- ❌ A migration of old content for its own sake

---

## Summary

```
Event (calendar)   ──┐
Poll / Vote        ──┤──→ trigger → PROMOTION → Node
Forum Thread       ──┤
Garden Seed 🍎     ──┘

Never: "Create a Node" in the void.
Always: "Elevate what already exists."
```

A Node is a **place**, not a score.
It is born from community life, not from administrative will.

---

*Captured from a design session — March 2026.*
*Connects: SPEC 011 (Events) × SPEC 010 (Global Search) × SPEC 013 (Node) × Garden (v0.6)*
