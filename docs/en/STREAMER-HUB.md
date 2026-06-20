# Streamer Hub

A native Twitch bridge built into Nodyx. No dependency on Streamlabs, StreamElements, Streamer.bot or any third-party SaaS. Your OAuth tokens stay on your server, encrypted at rest.

If you stream and you also run a community, this module lets the same Nodyx instance double as your alerts panel, your unified chat (Twitch + Nodyx in one place), and the source of truth for your community activity.

**Status:** v2.8. Phases 1, 2 and 3 of [spec 015](https://github.com/Pokled/nodyx/tree/main/docs/specs/015-streamer-hub) are shipped and running in production: alerts, unified Twitch chat, the **Soundboard** with a viewer queue, the multi-page **Stream Deck**, **OBS browser-source overlays** and **audio playlists** with OBS scenes. Phases 4 to 5 (stats mirrors, top clips, Twitch Extension) are on the roadmap.

---

## What it does today

**Alerts.** Real-time webhook events from Twitch (follows, subs, gifted subs, bits, raids, polls, stream online/offline) land in a dedicated channel on your Nodyx instance, with the full payload persisted in `streamer_events` so you can build dashboards or replays.

**Unified chat.** Twitch chat messages are streamed into a `#twitch-chat` channel on your Nodyx instance. When a Nodyx member writes in that channel, the message is relayed back to your Twitch chat with their Nodyx username as the visible author. Both directions use EventSub (chat in) and Helix Send Chat Message (chat out), so this works without ever touching the legacy IRC interface.

**Viewer linking.** Any Nodyx member can link their personal Twitch account to their Nodyx profile from `/settings`. Once linked, their Twitch chatter id is mapped to their Nodyx user id, so when they speak in your Twitch chat you see them as themselves in the bridge.

**Soundboard, Stream Deck and OBS overlays.** A native soundboard your viewers can fill from a public page or with a chat command, a multi-page mobile control deck, and OBS browser-source overlays (alerts, goals, timers, tickers, leaderboards, clips, soundboard). Each documented in its own section below.

---

## Prerequisites

You need three environment variables in `nodyx-core/.env` before connecting:

```bash
# Twitch developer console: dev.twitch.tv/console
TWITCH_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWITCH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
STREAMER_OAUTH_KEY=64_hex_chars_keep_this_secret

# Public HTTPS URL of this instance (Twitch only delivers webhooks over HTTPS)
STREAMER_PUBLIC_BASE=https://your-instance.nodyx.org

# Full OAuth redirect URI, must exactly match what's configured in the Twitch app
STREAMER_OAUTH_REDIRECT_URI=https://your-instance.nodyx.org/api/v1/streamer/twitch/callback
```

**Creating the Twitch application.** Go to `dev.twitch.tv/console/apps`, click "Register Your Application". Pick any name. For "OAuth Redirect URLs", paste your `STREAMER_OAUTH_REDIRECT_URI` value exactly. Category: Application Integration. Confidential. Once registered you'll get the `Client ID` and you can `New Secret` to get the `Client Secret`.

**Generating the encryption key.** `STREAMER_OAUTH_KEY` is the master key that protects all stored OAuth tokens. It's a 32-byte secret, hex encoded (so 64 characters). One key per instance. Keep it in your secrets store next to `JWT_SECRET`. If you lose it, every connected streamer needs to reconnect.

After setting these and restarting `nodyx-core`, the admin panel at `/admin/streamer-hub` becomes operational.

---

## Connecting your account

1. Open `/admin/streamer-hub` on your instance.
2. Click "Connecter Twitch".
3. You're redirected to Twitch with the 7 requested scopes pre-filled.
4. Accept. Twitch redirects you back to your callback URL.
5. Nodyx exchanges the code for tokens, encrypts them with AES-256-GCM + HKDF, persists, and subscribes to the 9 EventSub events Phase 1+2 covers (follow, subscribe, subscription.gift, cheer, raid, poll.begin, poll.end, stream.online, stream.offline, chat.message).

If the dashboard shows the green "Connecté" pill, you're done. The Health Overview cards will populate within a few minutes as Twitch confirms each subscription.

**Required scopes.** `user:read:email` (so we can identify the streamer), `channel:read:subscriptions`, `bits:read`, `moderator:read:followers`, `user:read:chat`, `user:write:chat`, `channel:read:polls`. None of these grant access to your stream key, your Twitch settings, your payment history, or any other account you don't explicitly select on the consent screen.

---

## Soundboard

Upload your sounds once, then trigger them from your phone, your Twitch chat, or let viewers fill the queue. Everything is integrated, nothing wired between three SaaS.

**Library.** Drag-and-drop or multi-file upload (mp3, ogg, wav, flac) in the `Soundboard` tab of `/admin/streamer-hub`. ID3 tags are extracted automatically (title, artist, duration, embedded cover art). Per-track inline editing: title, artist, visibility (private or public), default volume (0 to 2x), fade in/out, loop, royalty-free flag. The per-community storage quota is bypassed for owners and admins, so you manage your own disk without friction.

**Public viewer page.** `/soundboard` is reachable without a login. Viewers browse the full library (live search by title or artist, preview on hover), see a real-time "now playing" card and an "up next" queue, and can push a sound with a single button. The page polls over REST every two seconds; no public socket is exposed.

**Viewer queue.** A dedicated Redis FIFO queue (max 50) with a rate limit (30s per IP), a per-IP cap (3 simultaneous sounds) and global deduplication by track. An admin toggle ("Viewers allowed / blocked", on by default, persisted in Redis) is your anti-raid net. When a sound finishes on the overlay, the backend pops the next one automatically. From the admin tab you see the queue live and can skip a specific sound or clear everything.

**Chat command `!ns`** (alias `!nextsound`). A viewer types `!ns ixion` in your Twitch chat and the bot adds the best-matching sound to the queue. The fuzzy matcher normalizes case and accents, then scores in cascade (exact, then prefix, then mid-substring, then token + Levenshtein with a 2-typo tolerance). If the top two candidates are too close, the bot replies with the three best matches so the viewer can disambiguate instead of getting the wrong sound. Each chatter is rate-limited individually.

---

## Stream Deck

A mobile control surface (the **Nodyx Deck**) you open on your phone while you stream, organized into logical pages.

**Multi-page layout.** Up to 8 pages per deck (one for sounds, one for commands, one for moderation, however you like), each with an accent color, inline rename (double-click) and drag-to-reorder. V1 single-page decks keep working: they are auto-wrapped into a "Main" page server-side, no migration. The mobile view shows a floating page dock at the bottom (accent colors, haptic feedback on switch, iOS safe-area aware) when the deck has more than one page.

**Button actions.** Alongside the existing alert, scene and chat actions, four audio and navigation actions:

```
play_audio      → trigger a soundboard track (picker with live search + thumbnails)
stop_audio      → stop the current playback with a fade out
pause_audio      → pause the current track
navigate_page    → jump to another deck page (target page, or home / prev / next)
```

`navigate_page` is intercepted client-side on mobile for zero latency.

**Send to Deck.** Each row of the Soundboard tab has a "+ Deck" button: attach a sound to a deck button without navigating three tabs. The modal lets you pick the target deck, the target page, and a free cell on a mini interactive grid (occupied cells show the existing button's icon), or auto-place in the first free slot. It stays open after each placement so you can build a full page in one go. Each track gets a deterministic color gradient so the same sound always looks the same on the deck.

---

## OBS overlays

Drop transparent browser sources into OBS, then barely touch OBS again.

**Seven overlay types**, each a browser-source URL gated by a single-use token:

```
alert · goal · timer · ticker · leaderboard · clips · soundboard
```

The soundboard overlay is a transparent Web Audio player: per-track fade in/out, automatic cross-fade when a new sound starts over a playing one, and a discreet on-screen display in a corner (thumbnail, title, artist, progress bar), positionable in any of the four corners or hidden. Several soundboard overlays per owner are supported, so each OBS scene gets its own browser source and they all receive the same stream.

**Audio playlists.** Group your sounds into named playlists (Dev, Discussion, ...), each with its own dedicated OBS overlay URL, controllable from the Stream Deck. A playlist maps cleanly onto a stream scene: one playlist per scene, one overlay URL per scene.

**OBS Scenes composer.** An OBS-style visual editor inside the Streamer Hub to place overlays and playlists per scene, with inline creation. Everything converges on the overlays and playlists you already have: pick an existing one, or create a new one on the spot, and place it in the scene.

---

## Architecture

Three layers, each isolated.

**OAuth and token lifecycle.** Tokens are stored in `streamer_tokens` encrypted AES-256-GCM with a per-row salt and an HKDF-derived key. A leak of the database alone is not enough to decrypt them. The master key version is recorded per row so monthly key rotation is possible without downtime. A background job refreshes access tokens 30 minutes before they expire using the stored refresh token. State strings on the OAuth flow are stored in Redis with a single-use semantics and a `replayed` flag so a duplicate callback (Twitch retries, browser prefetch) does not re-exchange the code.

**EventSub webhook.** A public endpoint at `/api/v1/integrations/twitch/eventsub/:nonce` receives Twitch's webhook calls. Each subscription has a unique nonce in its URL, so leakage of one webhook URL does not let an attacker forge events for another subscription. Every request is verified by HMAC-SHA256 over the raw body using the per-nonce shared secret. The `Twitch-Eventsub-Message-Id` is deduplicated in Redis for 24 hours to absorb retries safely. Any failed HMAC clears its dedupe entry so a legitimate retry from Twitch can still go through, and the attempt is recorded in the audit log with the source IP.

**Chat bridge.** Inbound: the `channel.chat.message` EventSub event is mapped to a Nodyx user (resolved via `twitch_id` if linked, created as a placeholder otherwise) and posted to the `#twitch-chat` channel. Outbound: when a Nodyx member writes in `#twitch-chat`, the message is relayed best-effort via Helix `POST /chat/messages` so the chat pipeline never pays the latency of a Twitch API call. On a 429 rate-limit response, the message is enqueued in a Redis sorted set with exponential backoff (`2^attempts * 1s`, capped at 30s), retried by a worker every 2 seconds, and dropped after 5 attempts or 60 seconds total TTL. Every drop is audited.

---

## Health Overview

The admin dashboard shows four live metric cards.

**Connexion.** Green when an admin has completed the OAuth flow and the tokens are still valid. Shows the linked Twitch login and the Twitch user id for cross-reference.

**EventSub.** Counts subscriptions by status. Green when at least one is `enabled` and none is `failed`. Amber if any are still in `pending` (Twitch is verifying the webhook). Rose if any are `failed`. Failed subscriptions usually mean Twitch could not reach your webhook URL (HTTPS certificate, proxy blocking POSTs, or a body parser stripping the raw bytes needed for HMAC).

**Chat bridge.** Shows the size of the outbound Redis queue. Anything above 50 means Twitch is rate-limiting your sends. Also shows the count of Nodyx members who have linked their Twitch account.

**Activité.** The most recent EventSub event we received, with a relative timestamp. If you haven't received any event in over 6 hours despite being live, the bridge is probably broken (check HMAC verification in the logs).

---

## Testing the pipeline

The dashboard has a "Tester le pipeline" section with a dropdown and an "Injecter l'event" button. This bypasses Twitch entirely: it generates a plausible-looking payload locally and pushes it through the same `ingestEvent` pipeline a real webhook would go through.

Use it to verify:

- Your `#twitch-chat` channel is correctly receiving dispatched events.
- The activity feed updates in real time.
- The chat bridge worker is alive (a sub event causes a notification message in `#twitch-chat`).

Five event types are supported: `channel.follow`, `channel.subscribe`, `channel.cheer`, `channel.raid`, `stream.online`. Nothing is sent to Twitch, the data is fully local and audited as `test=true`.

---

## When to use which action

**Synchroniser EventSub.** Run this after upgrading Nodyx if new event types are added (the new admin sees only their pre-upgrade subscriptions until you sync). Also run it if the EventSub card shows a failed subscription: the sync re-creates the failed ones from scratch with a new nonce.

**Refresh tokens.** Mostly a debugging aid. The automatic refresh worker runs 30 minutes before expiry; you should rarely need to trigger this manually. If you do, it should make the Connexion card go green again immediately.

**Déconnecter.** Wipes the encrypted tokens from the database and lets the EventSub subscriptions on Twitch's side go orphaned (they'll be revoked by Twitch within a few hours). A future reconnect will recreate them. Use this if you suspect a token leak or if you're handing over the streamer role to someone else.

---

## Troubleshooting

**"Pipeline failure" right after the callback.** Three things to check, in order: (1) `TWITCH_CLIENT_SECRET` matches what's in the Twitch developer console (it can be rotated and you must update both sides), (2) `STREAMER_OAUTH_REDIRECT_URI` is an exact match (trailing slash, scheme, port), (3) `STREAMER_PUBLIC_BASE` resolves to your instance over HTTPS from the public internet.

**EventSub subscription stuck in `pending` for more than a minute.** Twitch attempted the webhook verification and either didn't reach you or got an HMAC failure. Check `pm2 logs nodyx-core | grep EventSub`. If you see `HMAC invalid` lines, your reverse proxy is probably altering the request body before it reaches `nodyx-core` (Caddy is fine out of the box, but custom rewrites can break it). If you see no log line at all, Twitch never reached you: your HTTPS certificate or your domain DNS is probably the culprit.

**EventSub subscription in `failed` status.** Twitch tried for too long and gave up. Click "Synchroniser EventSub", it will recreate the subscription with a new nonce. Watch the logs to see the verification round-trip succeed.

**No events received but stream is live.** Two scenarios. (1) Subscriptions are `enabled` but no event lands: probably a webhook URL change since the subscription was created (Twitch is calling the old URL). Run "Synchroniser EventSub" to recreate them on the current URL. (2) Subscriptions are `enabled` and you see events arrive in the logs but not in `#twitch-chat`: the chat dispatch worker has died or the channel was deleted. Restart `nodyx-core`.

**Chat bridge queue is growing.** Twitch is rate-limiting you. The worker will retry with exponential backoff; if the queue keeps growing past 50 it usually means your stream is mid-raid or you have an automated message spammer. Set `STREAMER_CHAT_NO_PREFIX=1` to drop the `[username]` prefix and shave a few bytes per message; the per-message cost on the Twitch side is mostly fixed though.

---

## FAQ

**Why a native bridge instead of letting people pick Streamer.bot or StreamElements?**
Because each of those services owns your OAuth tokens, sees every message that flows through, and changes their terms whenever they want. The native bridge keeps everything on your hardware, encrypted, with the same lifecycle as the rest of your community. It also means one less point of failure (and one less account password to rotate).

**Why EventSub Chat and not IRC?**
Twitch has publicly signaled they want EventSub Chat to replace IRC. Building on IRC today would be writing a refactor for next year. EventSub Chat is also unified with the rest of our event pipeline: one HMAC verification, one dedupe, one audit log for everything.

**Does the bridge cost me anything?**
No. Twitch's Helix and EventSub APIs are free, with rate limits that comfortably cover the busiest small-to-medium streams. The only resource you spend is your own server's CPU and bandwidth, both negligible.

**What happens if Twitch deprecates an event type?**
The provider layer is versioned. We can switch one event source without touching the rest. We monitor Twitch's developer changelog and announce migration paths in the project changelog before any breaking change reaches production.

**Can I revoke the link from a viewer who linked their Twitch account?**
Yes. `/settings` on the viewer's side has an "Unlink Twitch" button. As an admin, you can also revoke from the database directly (it's a single nullable column on `users`).

**Where do the encrypted tokens live?**
In `streamer_tokens`. Each row has the ciphertext, a per-row salt, the GCM IV and auth tag, and a `key_version` column for rotation. The master key is read from `STREAMER_OAUTH_KEY` at runtime; it never touches the database.

**What's shipped and what's still coming?**
Phases 1 to 3 are live: alerts, unified chat, the Soundboard with its viewer queue and `!ns` command, the multi-page Stream Deck, the OBS overlays and audio playlists with scenes. Phases 4 (stats and poll mirrors) and 5 (top clips, raider preview, Twitch Extension generator) are on the roadmap in the spec. We ship what's tested: each phase lands when it's solid enough to replace what Streamlabs/StreamElements do today.

---

*Source spec: [`docs/specs/015-streamer-hub/SPEC.MD`](https://github.com/Pokled/nodyx/blob/main/docs/specs/015-streamer-hub/SPEC.MD). Phase reports: [PHASE_0_REPORT.md](https://github.com/Pokled/nodyx/blob/main/docs/specs/015-streamer-hub/PHASE_0_REPORT.md) and [PHASE_2_REPORT.md](https://github.com/Pokled/nodyx/blob/main/docs/specs/015-streamer-hub/PHASE_2_REPORT.md).*
