# OctoGuard, step by step

OctoGuard is your community's built-in moderator: a friendly octopus that watches your chat and acts on rules **you** set. No bot to install, no third-party service, no monthly fee. It is off by default and does absolutely nothing until you tell it to, so you can take it slow.

This is a hands-on tutorial for someone who has never set up auto-moderation. If you can fill a form and copy-paste a line, you can run OctoGuard.

**Status:** v2.6+. Native auto-moderation, ReDoS-safe (a "bad" rule can never freeze your server), all admin-tunable. Admin panel: `/admin/octoguard`.

---

## What you'll have at the end

A community that quietly handles spam, insults, link-dumps and mention-storms by your rules, while you sleep. And the golden part: you can watch every rule in a **test mode** that does nothing visible, until you trust it. No surprises, no over-zealous bot deleting the wrong messages.

---

## Step 1: Turn OctoGuard on

OctoGuard ships disabled. To switch it on, just flip a toggle in your admin panel, no file editing, no restart:

1. Open **`/admin/settings`**.
2. Scroll to the **Sécurité & modération** (Security & moderation) section.
3. Switch on **Activer OctoGuard (auto-modération)**. Done. It takes effect instantly.

Now open **`/admin/octoguard`**. You'll see the **Vue d'ensemble** (Overview) with a green "OctoGuard active" state and three counters: active auto-mod rules, active mutes, open reports.

**Important and reassuring:** turning OctoGuard on does **nothing** on its own. With an empty rules list, it just sits there. It only ever acts on rules you create. So flipping the switch is completely safe.

> **Emergency kill-switch.** There is also an environment variable, `OCTOGUARD_ENABLED`, in `nodyx-core/.env`. The admin toggle is the normal control, but if you ever need to force the whole system off at the lowest level (an incident, a runaway rule), set `OCTOGUARD_ENABLED=false`, restart `nodyx-core`, and nothing OctoGuard-related runs, no matter what the admin panel says.

---

## The eight tabs, in 30 seconds

`/admin/octoguard` has eight tabs:

| Tab | What it's for |
|---|---|
| **Vue d'ensemble** | Status, counters, a "how to start" checklist |
| **Auto-mod** | Your rules: what to catch, and what to do about it |
| **Bienvenue** | The message new members get when they join |
| **Commandes** | Custom chat commands like `!rules` or `!discord` |
| **Sourdines** | Who is currently muted, add or lift a mute |
| **Signalements** | Reports your members filed, to review |
| **Journal** | The log of everything OctoGuard did (or would have done) |
| **Webhook** | Advanced: send signed events to your own service |

We'll spend most of our time in **Auto-mod**.

---

## Step 2: Your first rule, in TEST mode (the golden rule)

The single most important beginner habit: **always start a new rule in test mode.** In test mode OctoGuard only **writes to the Journal**, it never deletes, mutes or bans anyone. You watch for a day, confirm it catches the right things and nothing innocent, and only then let it act. This is how you avoid the classic "the bot nuked half my chat" disaster.

Let's create a rule that flags two insults.

1. Open the **Auto-mod** tab.
2. Click **+ Nouvelle règle**.
3. **Name** it something you'll recognize, for example `anti-insults`.
4. **Type:** choose **Regex (texte)**. The **Paramètres (JSON)** box auto-fills with a starter template.
5. Edit the template to your words. To flag "idiot" and "moron" (case-insensitive):

   ```json
   { "pattern": "\\b(idiot|moron)\\b", "flags": "i" }
   ```

   The `\\b` means "whole word only" (so "moron" matches but "oxymoron" doesn't). `flags: "i"` means case doesn't matter.
6. **Action:** choose **Test (dry-run, log only)**. (Or pick a real action and switch on **Mode test** below, same effect.)
7. **Rôles immunisés:** leave the default `owner, admin, moderator`. Your staff is never auto-moderated.
8. Make sure **Activée** is on, and **Save**.

That's it. From now on, every time someone writes one of those words, OctoGuard records it in the **Journal** tab, and does nothing else. Go live your life. Come back tomorrow.

---

## Step 3: Read the Journal, then go live

Open the **Journal** tab. You'll see each match: who, which rule, what message. Two things to check:

- Is it catching what you wanted? Good.
- Is it catching innocent messages (a false positive)? Then tweak the pattern before going live.

When you trust the rule, make it real: edit it, change the **Action** from "Test" to **Supprimer le message** (delete) or **Avertir (warn)**, switch **Mode test** off, and **Save**. OctoGuard now enforces it, instantly, on every new message. You can always flip it back to test, or disable it, in one click.

---

## The five rule types (copy-paste ready)

When you create a rule, the **Type** dropdown decides what OctoGuard looks for, and the **Paramètres (JSON)** box is pre-filled with a working template you just edit.

| Type | What it catches | Starter JSON |
|---|---|---|
| **Regex (texte)** | Words or patterns you define | `{ "pattern": "\\b(motA\|motB)\\b", "flags": "i" }` |
| **Majuscules abusives** | SHOUTING (too many caps) | `{ "min_length": 15, "threshold_percent": 70 }` |
| **Filtre de domaines** | Specific links (block or allow only) | `{ "mode": "blacklist", "domains": ["discord.gg"] }` |
| **Spam de mentions** | Mention-storms (`@everyone` raids) | `{ "max_mentions": 5 }` |
| **Spam de liens** | Too many links in one message | `{ "max_links": 2 }` |

Plain-language notes:

- **Majuscules abusives**: only kicks in on messages of at least `min_length` characters that are over `threshold_percent` uppercase. A short "OK!" is fine; a 40-character all-caps rant is not.
- **Filtre de domaines**: `mode: "blacklist"` blocks the listed domains; `mode: "whitelist"` blocks every link **except** the listed ones (handy for a strict community).
- **Regex** is the most powerful, and you never have to fear a bad pattern: OctoGuard runs it through Google's `re2` engine, which is mathematically immune to the "catastrophic backtracking" that can freeze a normal regex. A clumsy rule might match too much, but it will **never** hang your server.

---

## The six actions, from gentle to strict

The **Action** dropdown decides what happens when a rule matches:

| Action | What it does |
|---|---|
| **Test (dry-run, log only)** | Logs only. Your safety net. Start here. |
| **Notifier seulement (log+webhook)** | Logs and pings your webhook, but leaves the message. Good for "I want to know, not act". |
| **Supprimer le message** | Removes the message. The everyday workhorse. |
| **Avertir (warn)** | Sends the member a warning. |
| **Mute (silence)** | Temporarily silences the member (set a duration). |
| **Bannissement temporaire** | Temp-ban with an expiry. The big hammer. |

A healthy escalation: start a rule in **Test**, graduate it to **Supprimer**, and reserve **Mute** / **Ban** for rules that catch genuinely abusive behavior. For mutes and temp-bans, the form shows a **Durée** field where you set how long (for example `{ "minutes": 15 }`).

---

## Common recipes (copy, paste, tweak)

These are the rules real communities run, day in, day out. Each one: the type to pick, the JSON to paste into **Paramètres**, and a sensible action. Remember the golden rule, drop each into **Test mode** for a day before it acts.

**1. Block insults and slurs.** The bread and butter. Type **Regex (texte)**, action **Supprimer le message**.

```json
{ "pattern": "\\b(idiot|moron|slur1|slur2)\\b", "flags": "i" }
```

Keep your word list private (don't post it where trolls can read it), and use `\\b` so "moron" doesn't also flag "oxymoron".

**2. Stop people poaching your members to Discord.** The classic. Type **Filtre de domaines** (blacklist), action **Supprimer le message**.

```json
{ "mode": "blacklist", "domains": ["discord.gg", "discord.com/invite", "t.me"] }
```

**3. Kill scam and phishing links.** Type **Filtre de domaines** (blacklist), action **Mute (silence)** or **Bannissement temporaire** (scammers rarely deserve a second message).

```json
{ "mode": "blacklist", "domains": ["bit.ly", "tinyurl.com", "steamcommunlty.com", "free-nitro.gg"] }
```

Note `steamcommunlty` (missing the "i"): typo-squatted domains are the #1 trick of crypto and game scammers.

**4. Calm the SHOUTING.** Type **Majuscules abusives**, action **Avertir (warn)** (a gentle nudge, not a punishment).

```json
{ "min_length": 15, "threshold_percent": 70 }
```

Only messages of 15+ characters that are over 70 percent uppercase are flagged, so a quick "OK!" or "LOL" is left alone.

**5. Survive a mention raid.** When a troll spams `@everyone` or tags twenty people. Type **Spam de mentions**, action **Mute (silence)**.

```json
{ "max_mentions": 5 }
```

**6. Stop drive-by advertising.** Someone dumping ten links in one message. Type **Spam de liens**, action **Supprimer le message**.

```json
{ "max_links": 3 }
```

**7. Lockdown mode (strict communities).** Allow links to a handful of trusted sites and delete everything else. Type **Filtre de domaines** (whitelist), action **Supprimer le message**.

```json
{ "mode": "whitelist", "domains": ["youtube.com", "github.com", "your-community.org"] }
```

With `whitelist`, only the listed domains survive. Powerful, but test it first or you'll delete legitimate links.

**8. The usual spam phrases.** "free nitro", "check my bio", crypto-pump invites. Type **Regex (texte)**, action **Supprimer le message** (or a temp ban for repeat offenders).

```json
{ "pattern": "(free\\s*nitro|check my (bio|profile)|onlyfans|pump\\s*signal)", "flags": "i" }
```

A good starter set for a brand-new community: recipe **2** (no Discord poaching), recipe **3** (no scams), and recipe **5** (no mention raids), all in test mode for the first day. That covers 90 percent of what hits a young server.

---

## A guided tour of the seven other tabs

Auto-mod is the engine, but OctoGuard is a whole toolbox. Here is every other tab, in plain steps.

> A quick word about **UUIDs.** A few tabs (Bienvenue, Sourdines) ask for a "UUID": that's the long unique ID of a channel, a member or a role. You find it in that item's admin page or its URL. Copy-paste it, that's all.

### Vue d'ensemble: your cockpit

You met this one in Step 1. It is your at-a-glance dashboard:

- the **global state** (OctoGuard active or off),
- three live counters: **active auto-mod rules**, **active mutes**, **open reports**,
- a **ReDoS protection** indicator (proof the regex engine is the safe one),
- a **Comment démarrer** checklist that links straight to each tab.

Your daily habit: glance here. Are the counters where you'd expect? A sudden spike in "open reports" means something is happening in your chat.

### Bienvenue: greet every new member

When someone joins, OctoGuard can post a public welcome in a channel you choose, signed by its **ghost bot** (the "[OctoGuard]" sender, with no real user behind it).

1. Open the **Bienvenue** tab.
2. Switch on **Activer le message de bienvenue**.
3. **Message public**: write your greeting. Three variables you can drop in:
   - `{userMention}` — pings the new member (a clickable @name),
   - `{user}` — their name as plain text,
   - `{communityName}` — your instance's name.
   Example: `Welcome {userMention} to {communityName}! Read the rules and say hi in general.`
4. **Channel cible (UUID)**: paste the ID of the channel where the message should appear.
5. *(Optional)* **Auto-grade à l'inscription (UUID)**: paste a role ID, and every new member is automatically given that role the moment they sign up. Perfect for a "Newcomer" or "Member" role.
6. **Enregistrer**.

### Commandes: your own !commands

Create chat commands your members can call, like `!rules`, `!faq` or `!discord`. The ghost bot answers instantly. No bot to host, it's built in.

1. Open the **Commandes** tab and click **Créer**.
2. **Nom (sans le !)**: the trigger word, for example `rules` (members will type `!rules`).
3. **Réponse du bot**: what the bot replies. It supports markdown, so links and bold text work.
4. **Cooldown (s)**: the minimum number of seconds between two uses, so nobody can spam it. 30 is a sane default.
5. Save. You can remove any command later with **Supprimer**.

A member types `!rules` in chat, the bot instantly posts your answer. Classic starters: `!rules`, `!faq`, `!discord`, `!ip`.

### Sourdines: mute someone by hand

Auto-mod can mute automatically, but sometimes you just need to silence one person yourself. This tab lists every active mute (who, which channel, the reason, when it expires) and lets you add or lift one.

To mute someone:

1. Open the **Sourdines** tab.
2. **UUID utilisateur**: the member's ID.
3. **UUID channel**: leave it **empty to mute them everywhere**, or paste a channel ID to mute them in that one channel only.
4. **Durée** + **Unité**: a number plus a unit, **minutes, heures, jours or semaines** (hours is the default).
5. **Raison**: a short note for your audit trail (and your future self).
6. **Appliquer mute**.

To lift a mute early, click **Unmute** next to it in the list. Otherwise it expires on its own.

### Signalements: when members flag a message

Your community can report messages they find abusive. Each report lands here as a queue you work through. Built-in anti-abuse stops one person from spam-reporting.

A report moves through four states, and you can filter the queue by any of them:

- **open** — fresh, waiting for you,
- **reviewed** — you've looked at it (button **Marquer revu**),
- **actioned** — you acted on it (muted, deleted, banned),
- **dismissed** — not a real problem (button **Rejeter**).

For each report you see the flagged message, who reported it and why. You record a **Résolution** so there's a permanent trace of what you decided, which protects you as much as the community.

### Journal: the black box

Every action OctoGuard takes, and every relevant admin action, is written here, permanently. The columns:

| Column | Meaning |
|---|---|
| **Date** | When it happened |
| **Acteur** | Who did it (the bot, or which admin) |
| **Action** | What was done (deleted, muted, warned…) |
| **Cible** | The affected member or message |
| **Détails** | The rule that fired, the reason, the specifics |

It's paginated (**Suivant →**). This is where your **test-mode** rules record their would-be catches, so the Journal is the first place you look when tuning a new rule, and the place you go to answer "wait, why was this message removed?".

### Webhook: pipe events to your own tools (advanced)

For people who want OctoGuard events in their own dashboard, an alerts channel, or a log aggregator. OctoGuard can POST every action to a URL you own.

1. Open the **Webhook** tab and switch on **Activer le webhook**.
2. **URL POST**: where the events should be sent.
3. **Secret HMAC**: a shared secret. OctoGuard signs every POST with it in a header, `X-Octoguard-Signature: sha256=<hex>`, so your receiver can verify the request genuinely came from your instance and wasn't forged. Leave the field empty to keep the current secret.
4. **Enregistrer**.

Your chat is **never slowed down** by this: webhooks fire asynchronously, after the action, so a slow or offline receiver can never lag your community.

---

## Tips for beginners

- **Always test first.** Every new rule, test mode, one day of watching the Journal. No exceptions, and you'll never have a regret.
- **Your staff is immune.** As long as their role is in "Rôles immunisés", owners, admins and moderators are never auto-moderated.
- **Empty is safe.** No rules means OctoGuard does nothing. Add them one at a time and watch each one settle.
- **You can't break the server.** Even a sloppy regex runs in linear time via `re2`. The worst a bad rule can do is match too much, and you'll see that immediately in the Journal.
- **The kill-switch.** Set `OCTOGUARD_ENABLED=false` and restart to bypass the entire system instantly, no matter how many rules you have.

---

## FAQ

**Will OctoGuard moderate my moderators?**
No, as long as their role is listed in "Rôles immunisés" (the default includes owner, admin and moderator).

**I turned it on but nothing happens.**
That's correct and expected. OctoGuard with zero rules does nothing. Create your first rule in the Auto-mod tab.

**I'm scared a rule will delete the wrong messages.**
That's exactly what test mode is for. A rule in "Test (dry-run)" only logs to the Journal, it never touches a message. Watch it, then promote it when you trust it.

**Can a bad regex freeze my instance?**
No. OctoGuard uses Google's `re2`, a linear-time engine immune to catastrophic backtracking. A pattern that would hang a normal regex engine simply runs safely here.

**Does any of this leave my server?**
No. OctoGuard is native to your Nodyx instance. The only thing that can leave is what *you* configure in the Webhook tab, signed and pointed at a URL you chose.

---

*Backend: [`nodyx-core/src/services/octoguard/`](https://github.com/Pokled/nodyx/tree/main/nodyx-core/src/services/octoguard) and [`nodyx-core/src/routes/octoguard.ts`](https://github.com/Pokled/nodyx/blob/main/nodyx-core/src/routes/octoguard.ts). Admin UI: `/admin/octoguard`.*
