# Homepage Builder

> Available in Nodyx v2.1+. A drag-and-drop admin tool that turns your instance's public homepage into a real, composable website, no template lock-in, no rebuild, no deploy.

:::info Related documentation
**Homepage Builder** and **Module System** are two distinct but connected systems, read both to understand the full picture.
- The **Homepage Builder** controls *what visitors see* on your public homepage (layout, widgets, theme)
- The **Module System** controls *what features exist* on your instance (forum, chat, voice, wiki...)
- A `website` module exposes widgets that appear in the Homepage Builder, but only when the module is active

See [Module System](module-system) for the other half of the picture.
:::

Nodyx ships with a drag-and-drop Homepage Builder and a complete Widget SDK, two features that no other self-hosted community platform offers together.

## The 11 layout zones

Place widgets anywhere on your homepage. Positions include:

```
banner          → full-width top announcement strip
hero            → main hero section
stats-bar       → community counters (members, online, posts)
main            → above main content
sidebar         → right column (join card, etc.)
half-1 / half-2 → 2-column grid
trio-1/2/3      → 3-column grid
footer-1/2/3    → footer columns
footer-bar      → full-width footer strip
```

Every zone accepts any widget, native or third-party. Drag a widget from the picker, drop it in a zone, done, no page reload, no build step.

## 4 native widgets (Phase 1)

| Widget | Description |
|---|---|
| **Hero Banner** | Animated hero with live/event/night variants resolved server-side |
| **Stats Bar** | Live member count, online count, thread count with animated counters |
| **Join Card** | CTA card for guests, hidden for logged-in members |
| **Announcement Banner** | Closeable info/warning/error strip with icon |

## Visibility rules

Every widget instance carries its own audience and schedule, independent of the others:

- **Audience**: everyone, guests only, or members only
- **Scheduling**: an optional start and end date, useful for a limited-time event banner that removes itself automatically

## Widget Store, install in one click

Any developer can package a widget as a `.zip` and install it on any Nodyx instance:

```
my-widget-1.0.0.zip
├── manifest.json     ← id, label, version, schema (config fields)
└── widget.iife.js    ← Web Component, Shadow DOM isolated
```

The admin panel handles upload, validation, extraction and activation. Under the hood: an XHR progress bar during upload, a 4-step validation pass, and an extraction whitelist so a malicious archive can't write outside its own widget folder. No rebuild, no deploy.

Once installed, a widget from the Store appears in the same picker as the 4 native widgets, drag it into any of the 11 zones like any other.

## Widget SDK, build your own, zero build tools

Widgets are standard **Custom Elements** (Web Components). Plain JavaScript, no React, no Vue, no npm required.

```javascript
class MyWidget extends HTMLElement {
  connectedCallback() { this._render() }

  _render() {
    var cfg = JSON.parse(this.dataset.config || '{}')
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = `<div>Hello ${cfg.title}</div>`
  }
}
customElements.define('nodyx-widget-my-widget', MyWidget)
```

The `manifest.json` schema drives the config fields shown in the Builder automatically, add a field to the schema and it appears in the admin UI, no extra wiring.

**→ [Full step-by-step guide, build your first widget](create-widget)**, written for non-developers, no prior JavaScript experience assumed.
