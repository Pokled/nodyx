# Module System

> Available in Nodyx v2.2+. The Module System transforms every instance into a fully configurable community platform — no CLI, no code, no restarts.

---

## The Core Concept

Every Nodyx instance is **two things at once**:

```
┌──────────────────────────────────────────────────┐
│                  YOUR INSTANCE                   │
│                                                  │
│  PUBLIC FACE   (no account required)             │
│  → A real website, shaped by your community      │
│  → Your showcase to the outside world            │
│                                                  │
│  INTERNAL FACE  (members only)                   │
│  → Forum, chat, voice, wiki, calendar…           │
│  → Only the tools your community actually needs  │
│                                                  │
└──────────────────────────────────────────────────┘
```

A gaming clan, a sports club, an agricultural cooperative, a company — each activates only what it needs, with its own identity. One platform, infinite configurations.

---

## Modules vs Widgets

These two concepts are distinct and should not be confused:

| | **Module** | **Widget** |
|---|---|---|
| **What it is** | A full feature of the platform | A visual block on the public homepage |
| **Scope** | Backend + frontend + database | Homepage display only |
| **Impact** | Changes what members can do | Changes what visitors see |
| **Example** | Enable the `wiki` module → members get a `/wiki` page | Add a `forum-preview` widget → visitors see recent threads |
| **Dependency** | Independent | May depend on a module being active |

**Rule of thumb:**
- *"Does this feature exist on the instance?"* → Module
- *"What do I put on my public homepage?"* → Widget

A widget can depend on a module (the `forum-preview` widget needs the `forum` module active), but a module works perfectly without any widget.

---

## The 4 Module Families

### `core` — Always active, cannot be disabled

| Module | Description |
|---|---|
| `auth` | Registration, login, sessions |
| `members` | Profiles, roles, permissions |
| `forum` | The main forum — the backbone |
| `admin` | Administration panel |
| `settings` | Instance configuration |

### `community` — Internal tools (toggle on/off)

These modules add functionality available to logged-in members.

| Module | Description | Best for |
|---|---|---|
| `chat` | Real-time text channels | All communities |
| `voice` | WebRTC voice channels | Gaming, sports, companies |
| `dm` | End-to-end encrypted direct messages | All communities |
| `calendar` | Shared calendar with events | Sports, cooperatives |
| `polls` | Polls and votes | All communities |
| `wiki` | Internal knowledge base | Companies, cooperatives |
| `files` | File library | Cooperatives, companies |
| `canvas` | Collaborative whiteboard | Gaming, creatives |
| `jukebox` | Shared P2P music queue | Gaming, events |
| `announcements` | Pinned announcements board | All communities |
| `leaderboard` | Community rankings | Gaming, sports |
| `tasks` | Lightweight task management | Companies, cooperatives |

### `website` — Public face (homepage modules)

These modules build the public-facing side of your instance — no account required to see them.

| Module | Description | Best for |
|---|---|---|
| `hero` | Welcome block with CTA | All communities |
| `news` | Latest forum posts / announcements | All communities |
| `events-public` | Public event calendar | Sports, cooperatives |
| `gallery` | Photo / media gallery | Sports, nature, creatives |
| `members-showcase` | Team / member showcase | Sports, companies |
| `newsletter` | Email subscription | All communities |
| `map` | Location map | Hunting/fishing, local sports |
| `shop` | Memberships / fees / store | Sports, associations |
| `blog` | Long-form articles | Companies, cooperatives |
| `faq` | Frequently asked questions | All communities |
| `contact` | Public contact form | All communities |
| `sponsors` | Sponsor / partner banner | Sports, events |
| `stats` | Public counters (members, posts…) | All communities |

### `integration` — External connections

| Module | Description |
|---|---|
| `rss-import` | Import RSS feeds as forum threads |
| `webhook` | Send events to external services |
| `discord-bridge` | Bidirectional Discord ↔ Nodyx chat bridge |
| `ical-sync` | iCal calendar sync (Google Calendar, etc.) |
| `oauth-provider` | Login via GitHub, Google, etc. |

---

## Usage Matrix by Community Type

| Module | Gaming | Sports club | Cooperative | Company |
|---|:---:|:---:|:---:|:---:|
| Forum | ✅ | ✅ | ✅ | ✅ |
| Chat | ✅ | ✅ | — | ✅ |
| Voice | ✅ | ✅ | — | ✅ |
| Calendar | ✅ | ✅ | ✅ | ✅ |
| Wiki | ✅ | — | ✅ | ✅ |
| Files | — | ✅ | ✅ | ✅ |
| DMs | ✅ | ✅ | ✅ | ✅ |
| Polls | ✅ | ✅ | ✅ | ✅ |
| Gallery | — | ✅ | ✅ | — |
| Leaderboard | ✅ | ✅ | — | — |
| Tasks | — | — | ✅ | ✅ |
| Canvas | ✅ | — | — | — |
| Map (public) | — | ✅ | ✅ | — |
| Shop (public) | — | ✅ | ✅ | — |
| Newsletter | — | ✅ | ✅ | ✅ |

---

## Activation Flow

No CLI. No rebuild. No PM2 restart. Everything happens from the admin panel in the browser.

```
Admin clicks "Enable" on a module
  → POST /api/v1/admin/modules/:id/enable
  → nodyx-core runs the module's SQL migrations
  → nodyx-core registers the module's routes (hot-reload via Fastify hooks)
  → nodyx-frontend updates navigation dynamically (via store + SSE event)
  → The module appears in the internal nav / public homepage
  → Zero downtime
```

Disabling a module is equally clean — routes are unregistered, the UI element disappears, data is preserved.

---

## Module Manifest

Each module ships a `module.json` that describes its capabilities:

```json:module.json
{
  "id": "calendar",
  "name": "Calendar",
  "version": "1.0.0",
  "family": "community",
  "description": "Shared calendar with public and private events.",
  "icon": "calendar",
  "color": "#06b6d4",

  "zones": {
    "nav": true,
    "homepage_widget": true,
    "admin_panel": true
  },

  "has_public_face": true,
  "configurable": true,
  "core": false,

  "backend": {
    "routes": "backend/routes.ts",
    "migrations": ["backend/migrations/001_calendar.sql"]
  },
  "frontend": {
    "internal_routes": "frontend/app/",
    "public_routes": "frontend/public/",
    "widgets": "frontend/widgets/",
    "components": "frontend/components/"
  }
}
```

---

## Module File Structure

```
modules/
  calendar/
    module.json             ← manifest
    backend/
      routes.ts             ← Fastify routes (auto-registered)
      migrations/
        001_calendar.sql    ← DB schema
    frontend/
      app/                  ← internal pages (/app/calendar/)
        +page.svelte
        +page.server.ts
      public/               ← public pages (no login required)
        +page.svelte
      widgets/              ← homepage widget blocks
        CalendarWidget.svelte
        UpcomingEventsWidget.svelte
      components/           ← reusable internal components
        EventCard.svelte
        EventModal.svelte
    preview.png             ← screenshot shown in Module Manager
```

---

## Module Manager — Admin UI

The admin sees three panels:

**1. Module list**

```
MODULE MANAGER                              [+ Add from marketplace]
─────────────────────────────────────────────────────────────────────
Filters: [All ▾]  [Community ▾]  [Active only]

● CORE (always active)
  ✅ Forum          v2.1  — [Configure]
  ✅ Members        v2.0  — [Configure]
  ✅ Auth           v2.0

● COMMUNITY
  ✅ Chat           v1.8  — [Configure]  [Disable]
  ✅ Voice          v1.5  — [Configure]  [Disable]
  ◻  Canvas         v1.2  — [Enable]
  ◻  Wiki           v1.0  — [Enable]
  ◻  Tasks          v0.9  — [Enable]  [Beta]

● WEBSITE
  ✅ Hero           v1.0  — [Configure]  [Disable]
  ✅ Gallery        v1.1  — [Configure]  [Disable]
  ◻  Shop           v0.8  — [Enable]  [Beta]
  ◻  Newsletter     v1.0  — [Enable]
```

**2. Homepage Builder**

Drag widget blocks into layout zones: `banner` / `hero` / `half-left` / `half-right` / `stats-bar` / `wide-strip` / `sidebar` / `footer-1,2,3`. Each widget has its own config form.

**3. Per-module configuration**

Each active module exposes its own config form. Example for `calendar`: timezone, date format, default event visibility, category colors.

---

## Database Tables

```sql
-- Installed modules and their state
CREATE TABLE modules (
  id           TEXT PRIMARY KEY,
  family       TEXT NOT NULL,        -- 'core' | 'community' | 'website' | 'integration'
  version      TEXT NOT NULL,
  enabled      BOOLEAN DEFAULT false,
  config       JSONB   DEFAULT '{}',
  installed_at TIMESTAMPTZ DEFAULT now()
);

-- Homepage layout (widget placement)
CREATE TABLE homepage_layout (
  id        SERIAL PRIMARY KEY,
  zone      TEXT NOT NULL,           -- 'hero' | 'sidebar' | 'footer' …
  module_id TEXT REFERENCES modules(id),
  widget_id TEXT NOT NULL,
  position  INTEGER DEFAULT 0,
  config    JSONB DEFAULT '{}'
);
```

---

## Roadmap

:::info Coming in v2.2
The Module System is currently in development. The first batch of modules ships with v2.2:
- **Core modules** already live: `forum`, `chat`, `voice`, `calendar`, `polls`, `dm`, `wiki`
- **v2.2 targets**: formal activation/deactivation UI, `module.json` manifest loader, hot-reload routes, dynamic navigation
- **v2.3 targets**: `gallery`, `files`, `newsletter`, `contact`, `shop` (beta)
- **v3.0 target**: community marketplace — share and install modules from other instances
:::

---

## Why Not Just Plugins?

Traditional plugin systems (WordPress, Joomla extensions) require:
- SSH access to the server
- Running install scripts
- Restarting services
- Managing dependency conflicts

Nodyx modules are designed for **instance owners who aren't developers**. Activation is one click. Configuration is a form. There's no server knowledge required.

| | Plugin system | Nodyx modules |
|---|---|---|
| Install method | CLI on the server | Admin panel in the browser |
| Target user | Sysadmin / developer | Any community manager |
| Apply changes | Rebuild + restart | Hot-reload, zero downtime |
| Contribute | GitHub PR | Module marketplace (coming) |
| Scope | Extends source code | Composes the interface |
