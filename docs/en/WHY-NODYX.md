# 🧭 Why Nodyx

> **TL;DR** Discord isn't the enemy. Centralized silos are. Nodyx exists because we believe communities should belong to the people who build them, on hardware they choose. We're not the only ones who think so. This page is honest about what Discord did right, where Nodyx makes a different bet, and which other projects deserve your attention. **Pick the tool that fits you. The fight isn't between us.** ☕

---

## Table of Contents

- [What Discord got right](#what-discord-got-right)
- [Why something else exists](#why-something-else-exists)
- [Where Nodyx makes a different bet](#where-nodyx-makes-a-different-bet)
- [When Nodyx is NOT the right pick](#when-nodyx-is-not-the-right-pick)
- [The other tools in this space](#the-other-tools-in-this-space)
- [The real fight isn't between us](#the-real-fight-isnt-between-us)

---

## What Discord got right

Let's be honest from the start: Discord earned its place. Plenty of things people now take for granted simply did not exist at this quality before it shipped.

- **Multi-user, low-latency voice that just works.** Before Discord, you had Mumble (great but technical), TeamSpeak (paid, fiddly), Skype (buggy). Discord made stable group voice into a one-click experience. That alone changed gaming, study groups, dev teams, language learners. Millions of communities exist today because someone could press a button and talk to ten friends.

- **Servers as a social object.** Channels for text + voice in the same UI, roles, permissions, invites. The "server" model is so familiar now we forget how messy it used to be (IRC + Mumble + a Wordpress forum, all separate). Discord stitched it together.

- **Mobile-first done right.** Most of the older tools were desktop-bound. Discord shipped a phone app you actually wanted to use, and that opened the platform to people who don't sit at a desk.

- **A bot ecosystem.** Music, moderation, polls, mini-games, custom integrations. Discord made it easy enough for non-developers to add bots to their server, which spawned an entire economy of tools.

- **Free as the default.** No paywall to start a community. Whatever you think of Nitro, the base experience is genuinely free.

This page isn't a takedown. Discord deserves credit for democratizing a lot of things. **If Discord works for you and your friends: keep using it. Seriously.**

---

## Why something else exists

So if Discord did so much right, why build anything else?

Because building a community on Discord (or Slack, or any closed platform) means you don't own that community. The platform does. And in the last decade, this is what we've watched happen across the web:

- **Forums died.** Decades-old fan communities, technical Q&A sites, gardening clubs, niche fandoms. Most of them migrated to Discord and disappeared from search engines, archives, and the open web.
- **IRC died.** A protocol that ran the internet's underground for 30 years. Now, mostly empty channels and a few diehards.
- **Mailing lists got captured by Slack.** All that institutional memory is now behind a paywall and a 90-day retention limit on free tiers.

This isn't Discord's fault specifically. It's what happens when a generation of users forgets that **decentralized infrastructure is a thing**. Big platforms aren't villains, they're just defaults that won. But defaults can be questioned.

Nodyx is one of many projects asking the question: *what if a community could own itself again?*

---

## Where Nodyx makes a different bet

Not "Discord is bad, here's why we're better". Just the calls we made:

- **One instance = one community.** Your server, your hardware (or your VPS), your data. If we disappear tomorrow, your instance keeps running. Forever.
- **Forum + chat + voice + canvas + homepage builder, in one piece.** A community is not just a chat. It needs persistent threads (forum), real-time chat, voice, collaborative canvas, and a public-facing homepage. We bundle these so you don't stitch five tools together.
- **P2P relay for NAT traversal.** Run Nodyx on a Raspberry Pi behind your home router, no port forwarding, no Cloudflare account required. Our relay is a Rust service that punches through NAT for you, optionally.
- **Modules you turn on, not features dumped on you.** Activate the wiki, the events calendar, the jukebox, the canvas, only when your community needs them. CMS-style, not feature-bloat.
- **Reputation that you can audit.** Reputation scores are computed from on-chain (well, on-server) actions. The math is open, the history is visible. No mystery algorithm.
- **End-to-end encrypted DMs by default.** ECDH key exchange + AES-256-GCM. Your DMs are unreadable even to your own instance admin.
- **Public credit for contributors.** Every external PR is acknowledged in the README and in our `CONTRIBUTORS.md`. We call this Nodyx Stars. The people who help build this deserve to be visible.

These are bets. Some will age well. Some won't. We'll be honest as we go.

---

## When Nodyx is NOT the right pick

We owe you this section. If we don't write it, someone else will (and they'll be less kind).

- **You're 12 friends playing Fortnite.** Discord is fine. Genuinely. The friction of self-hosting is not worth it for a closed group of mates. Don't migrate just because we exist.
- **You need enterprise compliance certifications today.** Mattermost or Rocket.Chat are far more mature on this. SOC2, HIPAA, signed audits, that whole world. Nodyx is months old.
- **You want bridges to every existing protocol.** Matrix is the right answer. Their bridge ecosystem connects Discord, Slack, Telegram, IRC, XMPP, Signal, and more. Nodyx focuses on being its own thing, not a hub-of-hubs.
- **You want a UI that feels exactly like Discord.** Stoat (formerly Revolt) and Fluxer get closer to that visual identity. Nodyx is community-first, not chat-first, so the UI puts forums, threads, and the homepage builder up front.
- **You want a giant public app store of bots.** Discord has 10 years of head start there.
- **You don't have ~5€/month for a VPS, and you don't have a homelab.** Self-hosting has a floor. If you have neither, [Nodyx Relay](RELAY.md) (`*.nodyx.org`) might fit, but it's still our infrastructure, not yours.

If any of the above is you: pick the tool that fits. We're not offended.

---

## The other tools in this space

We owe sincere acknowledgment to every project working on this problem. Below is the list as we'd recommend it to a friend who asked. No hierarchy, no "best of", no "competitor" framing. Just the ecosystem.

### Heavy decentralized hitters

**[Matrix](https://matrix.org)** — `github.com/matrix-org` / Element client: [github.com/element-hq/element-web](https://github.com/element-hq/element-web)
The most mature open protocol in this space. Federated like email, end-to-end encrypted, with bridges to almost everything. If you want maximum interoperability and a long-term bet on a real protocol, start here.

### Discord-shaped clones

**[Stoat](https://github.com/stoatchat/self-hosted)** (formerly Revolt)
The closest visual feel to Discord. Built in Rust, fully open source, self-hostable. Best pick if you want minimal friction migrating a Discord-native community.

**[Spacebar](https://github.com/spacebarchat/server)**
A complete reimplementation of the Discord API. Existing Discord client mods often work against it. Excellent for technical communities that want compatibility.

**[Fluxer](https://fluxer.app/)** — [github.com/fluxerapp/fluxer](https://github.com/fluxerapp/fluxer)
Newer entrant, gaining traction quickly. Strong customization, human support, and an active community of users testing daily. Worth watching.

**[Haven](https://github.com/ancsemi/Haven)**
Private-first chat. Self-hosted, no cloud, no telemetry. Native desktop and Android clients. For people who want zero data leaving their machines.

### Other approaches worth knowing

**[Rocket.Chat](https://github.com/RocketChat/Rocket.Chat)**
Mature open-source platform with audio, video, screen sharing. Equally good for communities and enterprises.

**[Mattermost](https://github.com/mattermost/mattermost)**
The Slack alternative people actually deploy in production. Self-hostable, enterprise-ready, very battle-tested.

**[Discourse](https://github.com/discourse/discourse)**
Next-generation forum software. Not real-time chat, but unmatched for structured, archivable conversations and knowledge bases.

**[Zulip](https://github.com/zulip/zulip)**
Threaded chat done seriously. Streams + topics make long async conversations actually navigable. Big in research and dev teams.

**[Peersuite](https://github.com/openconstruct/peersuite)**
Bold P2P approach. No central server at all, encrypted end-to-end. Earlier-stage but interesting if pure peer-to-peer is what you want.

If we missed your favorite: open a PR on this page. Genuinely.

---

## The real fight isn't between us

The question isn't "Nodyx vs Matrix" or "Fluxer vs Stoat". The question is: *do you own your community, or does a Delaware corporation*?

Every person who leaves a closed silo for an open alternative is a win, regardless of which alternative. If someone reads this page and picks Matrix because Matrix fits them better: **good**. If Discord changes its practices because the open alternatives create real pressure: **even better**. We're all on the same team without realizing it.

> "I don't believe in turf wars. Each one brings their stone. If you also want to take part in an alternative, even modestly, come take a look. And if you prefer another solution, that's fine too. The important thing is that we stop letting ourselves be locked in. Let's support each other."
>
> *— from a [Reddit thread on Discord alternatives](https://www.reddit.com/r/BannedFromDiscord/comments/1swnq9b/), where this page started.*

---

## See also

- [The Nodyx manifesto](MANIFESTO.md) — the full philosophical framing
- [Installation guide](INSTALL.md) — if you decided to give it a shot
- [Architecture overview](ARCHITECTURE.md) — what's under the hood
- [Roadmap](ROADMAP.md) — where we're heading

---

<div align="center">
  <em>Pick the tool that fits you. We'll cheer either way.</em>
</div>
