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

## The other tabs, briefly

**Bienvenue.** Write the message new members see when they join. It supports variables: `{user}`, `{userMention}`, `{communityName}`. Example: `Welcome {userMention} to {communityName}! Read the rules and say hi.`

**Commandes.** Create custom chat commands your members can call, like `!rules` or `!discord`, with markdown answers. Each command has a cooldown (so it can't be spammed) and you can restrict which channels and roles may use it.

**Sourdines.** See who is currently muted, with the reason and the time left. Lift a mute early, or add one by hand. Scope can be global or one channel.

**Signalements.** When members report a message, it lands here. Review the queue and act (mute, delete, or dismiss). There is built-in anti-abuse, so a single user can't spam reports.

**Webhook.** Advanced. OctoGuard can POST every action to a URL you own, signed with `X-Octoguard-Signature: sha256=...` so you can verify it's really from your instance. Build a dashboard, an alerts channel, anything. The chat is never slowed down by this: the webhook fires asynchronously.

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
