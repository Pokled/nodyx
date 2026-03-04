# NEXUS-ETHER — The Physical Layer
### "When the fiber is cut, the community survives."

> This document is a horizon specification.
> Not for tomorrow. For the people who will build it.
> Radioamateurs, LoRa makers, Meshtastic contributors — this is for you.

---

## The Problem We Haven't Solved Yet

Nexus decentralizes the **application layer**.
Your data lives on your server. Your voice travels peer-to-peer.
No Big Tech silo. No centralized relay.

But we still depend on one thing: **the physical internet infrastructure.**

Fiber cables controlled by ISPs. Submarine cables controlled by corporations.
Satellites controlled by a single person.

If a government cuts the fiber — Nexus goes silent.
If a natural disaster destroys infrastructure — the community loses contact.
If an ISP decides to throttle or block — the sovereign node becomes unreachable.

**The manifesto says: "decentralized by design."**
We haven't finished yet.

---

## The Insight: CRDTs Are the Bridge

Nexus already implements CRDT Last-Write-Wins in NexusCanvas.
Every canvas element has a UUID and a timestamp. State converges eventually, regardless of latency.

This is not a canvas feature. **This is the right data structure for any low-bandwidth, high-latency, sporadic link.**

```
LoRa at 250 bits/s   →  200-byte CRDT delta  →  one forum post synced
HF ionosphere        →  FT8-style encoding    →  community announcements
CPL power line       →  existing copper       →  local neighborhood mesh
Wi-Fi ad-hoc         →  no router needed      →  campus / village intranet
```

The same CRDT engine that synchronizes a whiteboard stroke can synchronize a forum post — even over radio waves, even with a 2-hour delay, even if only 10% of packets arrive.

**Eventual consistency is resilience.**

---

## Three Layers of Physical Decentralization

### Layer 1 — Local Mesh (0–10 km)

**Technology:** LoRa, Wi-Fi ad-hoc, Li-Fi
**Hardware:** Raspberry Pi + LoRa module (~30€) or RTL-SDR dongle (~25€)
**Bandwidth:** 250 bps – 250 kbps
**Use case:** Village, campus, neighborhood, event without connectivity

A new binary: **`nexus-relay-mesh`**

```
nexus-relay-mesh --medium lora --freq 868mhz --range local
nexus-relay-mesh --medium wifi-adhoc --ssid nexus-mesh-quartier
```

Instances within range discover each other automatically.
nexus-relay becomes a hop-by-hop packet router on the physical network.
Forum posts, chat messages, event announcements propagate node-to-node.
No internet required. No ISP. No infrastructure at all.

**Real precedent:** Meshtastic does exactly this for simple text messages.
Nexus-ether does it for structured community data with CRDTs.

---

### Layer 2 — Regional Radio (10–3000 km)

**Technology:** HF radio, NVIS (Near Vertical Incidence Skywave)
**Hardware:** HF transceiver 20-30 MHz + Raspberry Pi
**Bandwidth:** ~50–300 bps (FT8/JS8Call-style encoding)
**Use case:** Rural areas, disaster zones, regions without infrastructure

A software modem written in Rust: **`nexus-modem`**

```rust
// nexus-modem: encode CRDT ops into robust low-bandwidth packets
// Similar to FT8 (amateur radio digital mode) but for Nexus data
// 15-second transmission window, error-correcting codes, automatic retry
```

nexus-core adds an **"HF queue"** — a priority list of critical operations:
- New forum announcements
- Emergency community messages
- CRDT sync deltas for offline nodes

Messages go into the queue. The modem transmits when the band is open.
A node 2000 km away receives, applies the CRDT delta, and is back in sync.

**The delay is hours, not milliseconds. The data arrives.**

**Real precedent:** JS8Call operators already do this. Winlink carries email over HF globally.
Nexus-ether carries community knowledge.

---

### Layer 3 — Ionosphere (Global, infrastructure-free)

**Technology:** HF shortwave, ionospheric bounce
**Range:** Global (no satellites, no cables)
**Bandwidth:** ~50 bps
**Use case:** Total infrastructure blackout, international emergency coordination

At this layer, only metadata travels:
- Node announcements ("instance X is alive, here is its current state hash")
- CRDT sync triggers ("I have 47 ops you don't — request a full sync via LoRa when in range")
- Emergency broadcasts

This is not a replacement for fiber. It is a **heartbeat** that keeps the network topology alive when everything else fails.

**What this means in practice:**
A community in a disaster zone can announce its existence to the global Nexus network using a €50 radio and a Pi. When connectivity is restored — even temporarily — the CRDT sync completes the full state.

---

## nexus-relay as Multi-Path Orchestrator

The existing nexus-relay architecture is already transport-agnostic.
It pushes bytes over a TCP socket. Replace the socket with a serial port connected to a LoRa module — the Rust code doesn't know the difference.

The vision: **nexus-relay with pluggable transport backends.**

```toml
# nexus-relay transport configuration
[transports]
ethernet  = { enabled = true, priority = 1 }
wifi-mesh = { enabled = true, priority = 2, ssid = "nexus-mesh" }
lora      = { enabled = true, priority = 3, freq = "868mhz" }
hf-radio  = { enabled = true, priority = 4, port = "/dev/ttyUSB0" }
powerline = { enabled = false }

[routing]
# If ethernet fails, fall through to wifi-mesh, then lora, then hf
# CRDT ensures consistency regardless of which path delivers the packet
fallback  = true
```

The orchestrator selects the best available path automatically.
The CRDT handles the rest — packets may arrive out of order, duplicated, or hours late.
**The state is always correct.**

---

## What Already Exists (Not Science Fiction)

| Technology | Project | Status |
|---|---|---|
| LoRa mesh messaging | [Meshtastic](https://meshtastic.org) | Production, thousands of nodes |
| Transport-agnostic crypto networking | [Reticulum Network Stack](https://reticulum.network) | Active, designed for exactly this |
| HF digital text over radio | [JS8Call](http://js8call.com) | Active amateur radio community |
| Email over HF radio | [Winlink](https://winlink.org) | Decades of use, global coverage |
| Software-defined radio (SDR) | RTL-SDR, HackRF | €25–300, widely available |
| CRDT for offline-first sync | NexusCanvas (this repo) | Shipped in v0.9.0 |

We are not inventing new physics. We are connecting existing pieces with the right data structure.

---

## The Architecture Sketch

```
┌─────────────────────────────────────────────────────┐
│                  nexus-core (Fastify)               │
│              CRDT store — eventually consistent      │
└───────────────────────┬─────────────────────────────┘
                        │ CRDT delta ops
                        ▼
┌─────────────────────────────────────────────────────┐
│              nexus-relay (multi-path)               │
├─────────────┬──────────────┬────────────┬───────────┤
│  ethernet   │  wifi-mesh   │   lora     │ hf-radio  │
│  (fiber)    │  (ad-hoc)    │  (LoRa32)  │ (20MHz)   │
└─────────────┴──────────────┴────────────┴───────────┘
      │               │              │           │
  internet        0-10 km        0-50 km     0-3000 km
  (normal)       (no infra)    (rural)     (ionosphere)
```

One Nexus. Four physical layers. The community survives all of them failing except the last.

---

## Who Should Build This

This is not a web developer project.

**We are looking for:**
- Amateur radio operators (HAM license holders)
- Meshtastic contributors and LoRa experimenters
- SDR (software-defined radio) developers
- Embedded Rust developers
- Off-grid / resilience community builders
- Disaster response technology researchers

If you are one of these people and you found this document — **this was written for you.**

Open an Issue. Start a Discussion. The architecture is here. The CRDT foundation is shipped.
The radio layer is waiting for the right hands.

---

## Why This Completes the Manifesto

We wrote: *"The internet was decentralized by design. Big Tech centralized it into silos."*

But "the internet" became synonymous with "fiber cables and satellites controlled by corporations."

Nexus-ether decentralizes the **physical layer itself.**

Cutting Nexus would require simultaneously:
- Cutting all fiber (ISPs)
- Jamming all LoRa frequencies (regulators)
- Shutting down all HF radio (impossible globally)
- Cutting all power (chaos)

At that point, Nexus is the least of anyone's problems.

**The network is the people. And people have always found ways to communicate.**

Radio waves don't need permission.

---

## Suggested Repository Structure

```
nexus-p2p/
├── nexus-turn/          ← exists (Rust STUN/TURN)
├── nexus-relay/         ← exists (Rust TCP tunnel)
└── nexus-ether/         ← future
    ├── nexus-modem/     ← software modem (HF encoding)
    ├── nexus-mesh/      ← LoRa / WiFi-adhoc mesh relay
    └── nexus-sync/      ← CRDT delta serialization (Cap'n Proto / FlatBuffers)
```

The workspace is already Rust. The CRDT is already written.
The next binary is waiting.

---

## Why This Idea Exists

Genius is not inventing. It's connecting.

Every piece of this vision already existed. CRDTs, LoRa, HF radio, Rust, Meshtastic — all of it was already there, scattered across garages, amateur radio clubs, research papers, and open source repositories. The missing piece was not technology. It was the will to connect them around a simple human question:

*"What happens to the community when the cable gets cut?"*

That question doesn't come from a lab. It comes from people who have learned — through experience, not theory — that infrastructure fails, that systems betray, and that what survives is always the same thing: people who trust each other enough to keep communicating.

---

Nexus exists because some tools should be like good animals.

No hidden agenda. No terms of service that change overnight. No algorithm that decides what you see. No company that owns what you shared.

What you see is what you have. What you build stays yours.

That's not a feature. That's the whole point.

---

*This document was shaped by a conversation with someone who asked to remain anonymous.*
*They have no interest in credit. They just wanted the idea to exist.*
*Thank you.*

---

*Written March 2026 — Nexus v0.9.0*
*"The network is the people. And people have always found ways to communicate."*
*AGPL-3.0 — Fork us if we betray you.*
