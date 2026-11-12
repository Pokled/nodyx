# Webhooks

Webhooks send what happens in your community to other tools, as it happens: a new forum article in your Discord channel, a mute on your phone, every moderation decision in your own spreadsheet or automation.

You will find them in **Administration > Integrations > Webhooks**. Only admins and owners can open the page.

---

## Two kinds of destinations

Every destination is one of two kinds, chosen first, when you add it.

| Kind | For | Receives |
|---|---|---|
| **Community announcements** (public) | A public Discord or Matrix channel, an announcements page | New articles, tracks, events, polls, wiki pages, lives, new members |
| **Moderation alerts** (team only) | Your phone, a private team channel, your own tool | Everything above, plus sanctions, reports, held messages, appeals, the sanction ladder, OctoGuard settings |

A moderation alert names members. It **never** goes to a public destination: the server refuses to save a public destination with moderation events, and filters them again at delivery time. Turning a team destination into a public one asks for confirmation and removes its moderation events.

Only content that everyone can already see in your community is announced: a private calendar event or wiki page never goes out, and a forum post held by OctoGuard is announced only once a moderator approves it.

Never sent, whatever you tick: private messages, email addresses, IP addresses, passwords. The text of a reported or removed message only goes to a team destination that explicitly asked for it ("Include the text of the messages involved", off by default).

---

## Supported tools

| Tool | What arrives | Address |
|---|---|---|
| **ntfy** | A push notification on your phone, high priority for sanctions | `https://ntfy.sh/your-topic` or your own ntfy server |
| **Matrix** | A message in a room, through the hookshot bot | The address hookshot gives you after `!hookshot webhook nodyx` |
| **Discord** | A message with a coloured card in a channel | `https://discord.com/api/webhooks/…` (channel settings, Integrations, Webhooks) |
| **Slack** | A message in a channel | `https://hooks.slack.com/services/…` (Incoming Webhooks) |
| **My tool** | Signed JSON, for n8n, Node-RED or your own code | Any `https://` address that answers within 10 seconds |

Messages are written by the server in your community language (French or English, other languages fall back to English). On Discord, no message can ever ping `@everyone`.

---

## Setting one up

1. Click **Add a destination** and pick the kind.
2. Pick the tool and follow the three steps shown on screen.
3. Paste the address, then **Send a test**. You get an answer right away ("Received in 182 ms"), or a plain explanation of what went wrong (address not found, refused, 404, no answer within 10 seconds…).
4. Tick the events you want. Each one shows an estimate per week, based on the last 30 days of your community.
5. **Save**.

The page keeps the last 50 deliveries of each destination. Click one to see exactly what was sent and what the destination answered.

---

## Reliability

- **Nothing slows your community down.** Deliveries leave from a queue, on the side. A slow or broken destination never delays your members, nor the other destinations.
- **Three tries.** A failed delivery is retried after 1 minute, then after 10 minutes.
- **Pause after 10 failures in a row.** The destination pauses and admins get a notification. Events that happen during the pause are not resent later (nobody wants 40 alerts at once). **Test and resume** restarts it.

---

## Security

- An address that leads to the server itself or to its local network (`127.0.0.1`, `localhost`, `10.x`, `192.168.x`, cloud metadata addresses…) is refused, when you save it and again on every delivery. Redirects are never followed.
- To send to a service on your own local network, for example ntfy running at home, the server admin can set `OCTOGUARD_WEBHOOK_ALLOW_PRIVATE=true` in the core environment. Loopback and cloud metadata addresses stay forbidden in every case.
- Destination addresses are only visible to admins. A signing secret is shown once, when generated, and never sent back by the server.
- Every change (destination added, changed, deleted, resumed) is recorded in the admin log.

---

## For developers: the JSON format

With **My tool**, every delivery is a `POST` with a JSON body:

```json
{
  "version": 2,
  "event": "forum.article",
  "family": "forum_article",
  "delivery": "d1c9e2f0-7a3b-4c11-9e2d-5b8f6a0c3e71",
  "at": "2026-11-12T03:04:51.000Z",
  "test": false,
  "community": { "name": "Vieux Looters", "url": "https://vieuxlooters.nodyx.org" },
  "actor": { "type": "member", "name": "lea" },
  "target": null,
  "item": { "title": "Guide: beating level 4", "category": "Help", "excerpt": "…" },
  "rule": null,
  "place": null,
  "details": { "category_id": "…" },
  "title": "Guide: beating level 4",
  "text": "New article by lea in Help",
  "url": "https://vieuxlooters.nodyx.org/forum/help/guide-beating-level-4"
}
```

The shape is versioned: a Nodyx update will not break your integration without a new `version`.

### Headers

| Header | Meaning |
|---|---|
| `X-Nodyx-Event` | The event type, for example `forum.article` or `sanction.mute` |
| `X-Nodyx-Delivery` | A unique id. A retried delivery keeps the same id: handle each id once |
| `X-Nodyx-Timestamp` | Unix time of the delivery |
| `X-Nodyx-Signature` | `sha256=` followed by the HMAC-SHA256 of `timestamp + "." + body`, keyed with your secret |
| `X-Octoguard-Signature` | Kept for integrations made for the former OctoGuard webhook: HMAC-SHA256 of the body alone |

### Verifying a delivery (Node.js)

```js
import crypto from 'node:crypto'
const SECRET = process.env.NODYX_WEBHOOK_SECRET

app.post('/nodyx', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-Nodyx-Timestamp')
  const sig = req.get('X-Nodyx-Signature') ?? ''
  // Older than 5 minutes: refuse it, nobody can replay an old message
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.sendStatus(401)
  const want = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${req.body}`).digest('hex')
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)))
    return res.sendStatus(401)
  const event = JSON.parse(req.body)
  console.log(event.event, event.text)
  res.sendStatus(204)
})
```

The page shows the same check in Python and PHP, ready to copy.

### Event types

| Family | Events |
|---|---|
| `forum_article` | `forum.article` |
| `forum_pinned` | `forum.pinned` |
| `music` | `music.track` |
| `calendar` | `calendar.event` |
| `polls` | `poll.created` |
| `wiki` | `wiki.page` |
| `live` | `live.started` |
| `members` | `member.joined` |
| `sanctions` (team) | `sanction.warn`, `sanction.mute`, `sanction.unmute`, `sanction.ban`, `sanction.delete`, `sanction.undone` |
| `reports` (team) | `report.created` |
| `held` (team) | `held.created`, `held.approved`, `held.refused` |
| `appeals` (team) | `appeal.filed`, `appeal.upheld`, `appeal.overturned` |
| `ladder` (team) | `ladder.applied`, `ladder.pending`, `ladder.approved`, `ladder.dropped`, `ladder.alert` |
| `og_settings` (team) | `octoguard.enabled`, `octoguard.disabled`, `octoguard.settings` |
| `observations` (team) | `observation.*` (what a rule in observation mode would have done) |

---

## Coming from the former OctoGuard webhook

The single OctoGuard webhook became a team destination named "OctoGuard", in JSON format, with the same address, the same secret and all moderation events. The OctoGuard Webhook tab now lists the destinations that receive moderation and links to this page.
