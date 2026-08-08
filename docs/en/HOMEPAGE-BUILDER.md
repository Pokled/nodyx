# Homepage Builder

> Available in Nodyx v2.1+, rebuilt as Grid Builder v2 in v2.3. A drag-and-drop admin tool that turns your instance's public homepage into a real, composable website, no template lock-in, no rebuild, no deploy.

:::info Related documentation
**Homepage Builder** and **[Module System](module-system)** are two distinct but connected systems, read both to understand the full picture.
- The **Homepage Builder** controls *what visitors see* on your public homepage (layout, widgets, theme)
- The **Module System** controls *what features exist* on your instance (forum, chat, voice, wiki...)
- A `website` module exposes widgets that appear in the Homepage Builder, but only when the module is active
:::

Nodyx ships with a drag-and-drop Homepage Builder and a complete Widget SDK, two features that no other self-hosted community platform offers together.

## Rows and columns, not fixed zones

Earlier versions positioned widgets into a fixed set of named zones (banner, hero, sidebar...). That system is gone. The homepage is now a free stack of **rows**, each split into **columns** on a 12-unit grid, closer to Bootstrap or CSS Grid than to a template.

- **Add a row** from a preset: 1, 2, 3 or 4 equal columns, or an asymmetric split like `8+4`, `6+3+3`, `4+4+4`, `2+8+2`. The preset only sets the starting point.
- **Resize a column** by dragging the handle between two adjacent columns. Its neighbor shrinks by the same amount, the row's spans always sum back to 12, and each column keeps a minimum width of 2 units.
- **Add or remove a column** inside an existing row at any time, as long as at least one remains.
- **Reorder rows** by dragging the row handle, drop it above or below any other row.
- Each row has its own gap, vertical padding and an optional background color override.
- Every column independently adapts down to tablet and mobile widths, and can be hidden on either.

There are no named zones left to reason about, a row is a row wherever it sits on the page. Order is everything.

## 9 native widgets (Phase 1)

| Widget | Description |
|---|---|
| **Hero Banner** | Animated hero with live/event/night variants resolved server-side |
| **Stats Bar** | Live member count, online count, thread count with animated counters |
| **Join Card** | CTA card for guests, hidden for logged-in members |
| **Announcement Banner** | Closeable info/warning/error strip with icon |
| **Article Slideshow** | Rotating showcase of featured articles |
| **Articles Showcase** | Configurable grid or list of recent articles |
| **Recent Threads** | Latest forum activity, with a custom section heading |
| **Social Links Bar** | Row of social/external links with brand icons |
| **Twitch Stream** | Embedded live channel, on air or offline state |

Drop any widget into any column, on any row, click the empty cell and pick it from the picker.

## Visibility rules

Every widget instance carries its own audience, independent of the others:

- **Audience**: everyone, guests only, or members only

## Draft and publish

Edits save as a **draft** (`draft_layout`) that only admins preview, the live site keeps serving the last **published** version (`published_layout`) until you explicitly publish. Nothing a visitor sees changes mid-edit.

## Widget Store, install in one click

Any developer can package a widget as a `.zip` and install it on any Nodyx instance:

```
my-widget-1.0.0.zip
├── manifest.json     ← id, label, version, schema (config fields)
└── widget.iife.js    ← Web Component, Shadow DOM isolated
```

The admin panel handles upload, validation, extraction and activation. Under the hood: an XHR progress bar during upload, a 4-step validation pass, and an extraction whitelist so a malicious archive can't write outside its own widget folder. No rebuild, no deploy.

Once installed, a widget from the Store appears in the same picker as the 9 native widgets, drop it into any column like any other.

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
