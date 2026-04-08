# 🧩 Create Your First Nodyx Widget

> **You don't need to be a developer.** If you can copy-paste code and edit a text file, you can build a widget and install it on your Nodyx community in under 10 minutes.

Nodyx widgets are small pieces of code that appear on your homepage. Think of them like apps you install on a phone — except *you* can build them, and they're completely yours.

---

## What You'll Build

By the end of this guide, you'll have created a **"Welcome Banner"** widget: a customizable card that greets your community members. It will appear in the Homepage Builder, support a custom title and message, and look beautiful out of the box.

Then you'll package it as a `.zip` file and install it on your Nodyx instance in one click.

---

## Table of Contents

- [What is a Widget?](#what-is-a-widget)
- [Step 1 — Set Up Your Files](#step-1-set-up-your-files)
- [Step 2 — Write the manifest.json](#step-2-write-the-manifestjson)
- [Step 3 — Write the Widget Code](#step-3-write-the-widget-code)
- [Step 4 — Understand the Code](#step-4-understand-the-code)
- [Step 5 — Package Your Widget](#step-5-package-your-widget)
- [Step 6 — Install on Your Instance](#step-6-install-on-your-instance)
- [Step 7 — Use it in the Homepage Builder](#step-7-use-it-in-the-homepage-builder)
- [Going Further](#going-further)

---

## What is a Widget?

A Nodyx widget is two files inside a `.zip` archive:

```
welcome-banner-1.0.0.zip
├── manifest.json     ← describes your widget (name, version, config fields)
└── widget.iife.js    ← the actual code that runs in the browser
```

The widget code uses a web standard called a **Custom Element** (also called a Web Component). It's a self-contained piece of HTML that Nodyx loads and renders anywhere you place it.

:::tip No build tools required
You write plain JavaScript. No React, no Vue, no npm, no Webpack. A text editor is all you need.
:::

---

## Step 1 — Set Up Your Files

Create a folder on your computer called `welcome-banner`. Inside it, create two empty files:

```
welcome-banner/
├── manifest.json
└── widget.iife.js
```

You can use any text editor:
- **Windows**: Notepad, Notepad++, or VS Code
- **Mac**: TextEdit (in plain text mode), or VS Code
- **Linux**: gedit, nano, or VS Code

---

## Step 2 — Write the manifest.json

Open `manifest.json` and paste this:

```json:manifest.json
{
  "id": "welcome-banner",
  "label": "Welcome Banner",
  "version": "1.0.0",
  "author": "Your Name",
  "icon": "👋",
  "family": "community",
  "description": "A warm welcome message for your community members.",
  "entry": "widget.iife.js",
  "schema": [
    {
      "key": "title",
      "type": "text",
      "label": "Title",
      "placeholder": "Welcome to our community!"
    },
    {
      "key": "message",
      "type": "text",
      "label": "Message",
      "placeholder": "We're glad you're here."
    },
    {
      "key": "color",
      "type": "color",
      "label": "Accent color",
      "default": "#a78bfa"
    },
    {
      "key": "show_join_button",
      "type": "checkbox",
      "label": "Show join button"
    }
  ]
}
```

### What each field means

| Field | What it does |
|---|---|
| `id` | Unique identifier — only lowercase letters, numbers, and hyphens |
| `label` | The name shown in the Homepage Builder |
| `version` | Follows `major.minor.patch` format |
| `icon` | An emoji shown next to the widget name |
| `family` | Category: `community`, `media`, `gaming`, `esport`, `social`, or `content` |
| `entry` | The name of your JavaScript file (must end in `.js`) |
| `schema` | The list of config fields your widget exposes in the builder |

### Schema field types

| Type | What it renders in the builder |
|---|---|
| `text` | A text input |
| `color` | A color picker |
| `checkbox` | A toggle switch |
| `number` | A numeric input |
| `select` | A dropdown — add `options: [{value, label}]` |

---

## Step 3 — Write the Widget Code

Open `widget.iife.js` and paste this complete code:

```javascript:widget.iife.js
(function () {
  // ── Welcome Banner — Nodyx Widget ──────────────────────────────

  var STYLE = `
    :host { display: block; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .card {
      padding: 28px 32px;
      background: #0d0d12;
      border: 1px solid rgba(255,255,255,.08);
      font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
      padding: 3px 10px;
      border-radius: 999px;
      margin-bottom: 16px;
      border: 1px solid;
    }

    .title {
      font-size: 22px;
      font-weight: 800;
      color: #f1f5f9;
      margin-bottom: 8px;
      line-height: 1.25;
    }

    .message {
      font-size: 14px;
      color: #6b7280;
      line-height: 1.6;
      margin-bottom: 20px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: opacity .15s;
    }

    .btn:hover { opacity: .85; }
  `;

  class WelcomeBanner extends HTMLElement {
    connectedCallback() {
      this._render();
    }

    // Re-render whenever attributes change (builder live preview)
    static get observedAttributes() {
      return ['data-config', 'data-title'];
    }
    attributeChangedCallback() {
      this._render();
    }

    _render() {
      // 1. Read config sent by Nodyx
      var cfg = {};
      try { cfg = JSON.parse(this.dataset.config || '{}'); } catch (e) {}

      // 2. Extract your fields (with fallback defaults)
      var title   = cfg.title   || 'Welcome to our community!';
      var message = cfg.message || 'We\'re glad you\'re here. Explore, connect, and join the conversation.';
      var color   = cfg.color   || '#a78bfa';
      var showBtn = cfg.show_join_button !== false;

      // 3. Build the shadow DOM
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

      this.shadowRoot.innerHTML = `
        <style>${STYLE}</style>
        <div class="card">
          <div class="tag" style="color:${color}; border-color:${color}30; background:${color}12">
            <span>👋</span>
            Community
          </div>
          <div class="title">${escHtml(title)}</div>
          <div class="message">${escHtml(message)}</div>
          ${showBtn ? `
            <a href="/forum" class="btn" style="background:${color}20; color:${color}; border:1px solid ${color}40">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/>
              </svg>
              Join the forum
            </a>
          ` : ''}
        </div>
      `;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Register the Custom Element ──────────────────────────────────
  // The tag name MUST be: nodyx-widget- followed by your widget id

  if (!customElements.get('nodyx-widget-welcome-banner')) {
    customElements.define('nodyx-widget-welcome-banner', WelcomeBanner);
  }

})();
```

---

## Step 4 — Understand the Code

Don't worry if you're not a developer — here's what each part does:

### The outer wrapper `(function () { ... })()`
This is called an IIFE (Immediately Invoked Function Expression). It keeps your widget's code isolated so it doesn't interfere with the rest of the page. **Always wrap your widget in this.**

### The `STYLE` variable
This is CSS — the visual design of your widget. It uses **Shadow DOM**, which means your styles are completely isolated. They won't affect the rest of the page, and the page's styles won't affect your widget.

### The `WelcomeBanner` class
This is your widget. It extends `HTMLElement`, which means it becomes a real HTML element that the browser understands.

| Method | When it runs |
|---|---|
| `connectedCallback()` | When the widget is first placed on the page |
| `observedAttributes` | Which attribute changes should trigger a re-render |
| `attributeChangedCallback()` | When a config value changes (live preview in builder) |
| `_render()` | Your main render function — reads config, builds HTML |

### Reading the config
```javascript
var cfg = {};
try { cfg = JSON.parse(this.dataset.config || '{}'); } catch (e) {}
```
Nodyx passes your config fields as a JSON string in the `data-config` attribute. This line safely parses it.

### `customElements.define()`
This registers your class under the tag name `nodyx-widget-welcome-banner`. The name **must** start with `nodyx-widget-` followed by your widget's `id` from `manifest.json`.

:::warning The tag name rule
If your widget `id` is `my-countdown`, the tag name must be `nodyx-widget-my-countdown`. This is how Nodyx finds and renders your widget.
:::

---

## Step 5 — Package Your Widget

You need to create a `.zip` file containing both files **at the root** (not inside a subfolder).

**On Windows:**
1. Select both `manifest.json` and `widget.iife.js`
2. Right-click → **Compress to ZIP file** (Windows 11) or **Send to → Compressed folder** (Windows 10)
3. Name it `welcome-banner-1.0.0.zip`

**On Mac:**
1. Select both files
2. Right-click → **Compress 2 Items**
3. Rename `Archive.zip` to `welcome-banner-1.0.0.zip`

**On Linux:**
```bash
cd welcome-banner
zip welcome-banner-1.0.0.zip manifest.json widget.iife.js
```

:::tip Check the zip structure
Open the zip and verify the files are at the **root**, not inside a subfolder named `welcome-banner/`. Nodyx expects to find `manifest.json` immediately when it opens the archive.
:::

---

## Step 6 — Install on Your Instance

1. Go to your Nodyx admin panel: **Admin → Widgets**
2. In the **"Install a widget"** section, drag and drop your `.zip` file (or click to browse)
3. Watch the progress bar — Nodyx will validate the manifest, extract the files, and register the widget
4. You'll see **"Installation successful!"** with your widget's name

If you see an error, the most common causes are:
- `manifest.json` is missing or has a typo (check the JSON is valid at [jsonlint.com](https://jsonlint.com))
- The `entry` field in `manifest.json` doesn't match your `.js` filename exactly
- The files are inside a subfolder in the zip instead of at the root

---

## Step 7 — Use it in the Homepage Builder

1. Go to **Admin → Homepage**
2. Click **+ Add widget** on any position
3. Scroll to the **"Installed"** section in the widget picker — your widget is there
4. Fill in the config fields (Title, Message, Color, Show join button)
5. Click **Save**
6. Open your homepage — your widget is live!

---

## Going Further

Now that you've built your first widget, here's what you can explore:

### Fetch data from your instance

Nodyx passes your instance info to every widget via `data-instance`:

```javascript
var instance = {};
try { instance = JSON.parse(this.dataset.instance || '{}'); } catch (e) {}

// Available fields:
// instance.name          → community name
// instance.member_count  → number of members
// instance.online_count  → currently online
// instance.thread_count  → total threads
// instance.logo_url      → logo URL
```

### Know if the user is logged in

```javascript
var user = null;
try { user = this.dataset.user ? JSON.parse(this.dataset.user) : null; } catch (e) {}

if (user) {
  // User is logged in
  console.log('Hello', user.username);
} else {
  // Guest
}
```

### Add animations

Since your CSS is in Shadow DOM, you can use `@keyframes` freely:

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card { animation: fadeIn .4s ease; }
```

### Use a select field

In `manifest.json`, add a select field:

```json
{
  "key": "style",
  "type": "select",
  "label": "Card style",
  "default": "dark",
  "options": [
    { "value": "dark",  "label": "Dark" },
    { "value": "light", "label": "Light" },
    { "value": "glass", "label": "Glass" }
  ]
}
```

Then read it in your widget:

```javascript
var style = cfg.style || 'dark';
```

---

:::tip Study the example widget
The **Video Player** demo widget available in **Admin → Widgets** is fully commented and open source. It handles YouTube, Vimeo, and direct MP4 URLs. Download it as a `.zip` and read the source — it's a great starting point.
:::

---

*Widget SDK · Nodyx Documentation · [nodyx.dev](https://nodyx.dev)*
