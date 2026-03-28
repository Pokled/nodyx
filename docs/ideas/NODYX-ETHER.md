# NODYX-ETHER — The Physical Layer
### "When the fiber is cut, the community survives."

> This document is a horizon specification.
> Not for tomorrow. For the people who will build it.
> Radioamateurs, LoRa makers, Meshtastic contributors — this is for you.

---

## The Problem We Haven't Solved Yet

Nodyx decentralizes the **application layer**.
Your data lives on your server. Your voice travels peer-to-peer.
No Big Tech silo. No centralized relay.

But we still depend on one thing: **the physical internet infrastructure.**

Fiber cables controlled by ISPs. Submarine cables controlled by corporations.
Satellites controlled by a single person.

If a government cuts the fiber — Nodyx goes silent.
If a natural disaster destroys infrastructure — the community loses contact.
If an ISP decides to throttle or block — the sovereign node becomes unreachable.

**The manifesto says: "decentralized by design."**
We haven't finished yet.

---

## The Insight: CRDTs Are the Bridge

Nodyx already implements CRDT Last-Write-Wins in NodyxCanvas.
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

A new binary: **`nodyx-relay-mesh`**

```
nodyx-relay-mesh --medium lora --freq 868mhz --range local
nodyx-relay-mesh --medium wifi-adhoc --ssid nodyx-mesh-quartier
```

Instances within range discover each other automatically.
nodyx-relay becomes a hop-by-hop packet router on the physical network.
Forum posts, chat messages, event announcements propagate node-to-node.
No internet required. No ISP. No infrastructure at all.

**Real precedent:** Meshtastic does exactly this for simple text messages.
Nodyx-ether does it for structured community data with CRDTs.

---

### Layer 2 — Regional Radio (10–3000 km)

**Technology:** HF radio, NVIS (Near Vertical Incidence Skywave)
**Hardware:** HF transceiver 20-30 MHz + Raspberry Pi
**Bandwidth:** ~50–300 bps (FT8/JS8Call-style encoding)
**Use case:** Rural areas, disaster zones, regions without infrastructure

A software modem written in Rust: **`nodyx-modem`**

```rust
// nodyx-modem: encode CRDT ops into robust low-bandwidth packets
// Similar to FT8 (amateur radio digital mode) but for Nodyx data
// 15-second transmission window, error-correcting codes, automatic retry
```

nodyx-core adds an **"HF queue"** — a priority list of critical operations:
- New forum announcements
- Emergency community messages
- CRDT sync deltas for offline nodes

Messages go into the queue. The modem transmits when the band is open.
A node 2000 km away receives, applies the CRDT delta, and is back in sync.

**The delay is hours, not milliseconds. The data arrives.**

**Real precedent:** JS8Call operators already do this. Winlink carries email over HF globally.
Nodyx-ether carries community knowledge.

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
A community in a disaster zone can announce its existence to the global Nodyx network using a €50 radio and a Pi. When connectivity is restored — even temporarily — the CRDT sync completes the full state.

---

## nodyx-relay as Multi-Path Orchestrator

The existing nodyx-relay architecture is already transport-agnostic.
It pushes bytes over a TCP socket. Replace the socket with a serial port connected to a LoRa module — the Rust code doesn't know the difference.

The vision: **nodyx-relay with pluggable transport backends.**

```toml
# nodyx-relay transport configuration
[transports]
ethernet  = { enabled = true, priority = 1 }
wifi-mesh = { enabled = true, priority = 2, ssid = "nodyx-mesh" }
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
| **Crypto mesh networking stack** | **[Reticulum Network Stack](https://reticulum.network)** | **Active — Python, transport-agnostic, E2E encrypted, delay-tolerant** |
| LoRa mesh messaging | [Meshtastic](https://meshtastic.org) | Production, thousands of nodes |
| HF digital text over radio | [JS8Call](http://js8call.com) | Active amateur radio community |
| Email over HF radio | [Winlink](https://winlink.org) | Decades of use, global coverage |
| Software-defined radio (SDR) | RTL-SDR, HackRF | €25–300, widely available |
| CRDT for offline-first sync | NodyxCanvas (this repo) | Shipped in v0.9.0 |

We are not inventing new physics. We are connecting existing pieces with the right data structure.

---

## Reticulum — The Foundation We Won't Rebuild From Scratch

> "ou améliorer Reticulum et le faire à notre sauce"

Someone already solved the hardest part.

[Reticulum Network Stack](https://reticulum.network) is an open-source cryptographic networking stack designed from the ground up for exactly the scenario NODYX-ETHER describes:
- Works over LoRa, serial, TCP, I2P, any interface
- Transport-agnostic — the application doesn't care what carries the bytes
- End-to-end encrypted by design (Curve25519 + AES-128)
- Delay-tolerant: messages propagate even with intermittent connectivity
- No central authority, no IP addresses, no infrastructure requirement
- Runs on Raspberry Pi Zero

This is not a coincidence of features. **This is the exact problem Reticulum was built to solve.**

### What Reticulum Gives Us

```
Reticulum handles:
  ├── Addressing (Destination = public key hash, not IP)
  ├── Routing (propagation mesh, announce/path-find)
  ├── Encryption (all traffic, always, zero config)
  ├── Fragmentation + reassembly (low-bandwidth links)
  ├── Delivery acknowledgments
  └── Transport interfaces (serial, LoRa, TCP, UDP, I2P, Pipe)

Nodyx adds on top:
  ├── Community data structures (forum, chat, events)
  ├── CRDT sync (eventually-consistent state)
  ├── Web UI (the thing that makes it human)
  ├── Voice (WebRTC over normal links, CRDT-only over mesh)
  └── Federation protocol (gossip, directory, relay)
```

### The Gap We Fill

Reticulum is brilliant infrastructure with no community platform layer.
It ships with [Nomad Network](https://github.com/markqvist/NomadNetwork) — a terminal-based BBS.
Good for a certain type of user. Not for a village in a disaster zone. Not for a neighborhood trying to self-organize.

**Nodyx-ether is Reticulum + a real community platform.**

### Strategy: Fork, Contribute, Extend

We don't rewrite Reticulum. We:
1. **Bridge it** — `nodyx-ether` speaks Reticulum protocol natively
2. **Port the core to Rust** — the Python implementation is solid but won't run on microcontrollers or WASM. A Rust port opens embedded hardware and browser-side mesh participation.
3. **Contribute upstream** — improvements to fragmentation, CRDT-friendly transport, better LoRa drivers go back to the Reticulum project
4. **Build the layer above** — the community platform that turns a mesh network into a living space

```
"Fork us if we betray you."  ← Nodyx manifesto
"Reticulum is the postal service. Nodyx is the town square."
```

---

## The Architecture Sketch (Reticulum as Foundation)

```
┌─────────────────────────────────────────────────────┐
│                  nodyx-core (Fastify)               │
│              CRDT store — eventually consistent      │
└───────────────────────┬─────────────────────────────┘
                        │ CRDT delta ops (serialized)
                        ▼
┌─────────────────────────────────────────────────────┐
│          nodyx-relay (multi-path orchestrator)       │
└───────────────────────┬─────────────────────────────┘
                        │ Reticulum Packet Protocol
                        ▼
┌─────────────────────────────────────────────────────┐
│        nodyx-ether (Reticulum Rust bridge)           │
├─────────────┬──────────────┬────────────┬───────────┤
│  TCP/UDP    │  wifi-mesh   │   LoRa     │ HF radio  │
│  (internet) │  (ad-hoc)    │  (LoRa32)  │ (20 MHz)  │
└─────────────┴──────────────┴────────────┴───────────┘
      │               │              │           │
  internet        0–10 km        0–50 km     0–3000 km
  (normal)       (no infra)    (rural)     (ionosphere)

Legend:
  nodyx-relay  → exists today (Rust, TCP tunnel)
  nodyx-ether  → future (Reticulum Rust bridge)
  nodyx-sync   → future (CRDT over Reticulum transport)
```

One Nodyx. One protocol stack. Every physical medium.
**The community survives all of them failing except the last.**

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

Nodyx-ether decentralizes the **physical layer itself.**

Cutting Nodyx would require simultaneously:
- Cutting all fiber (ISPs)
- Jamming all LoRa frequencies (regulators)
- Shutting down all HF radio (impossible globally)
- Cutting all power (chaos)

At that point, Nodyx is the least of anyone's problems.

**The network is the people. And people have always found ways to communicate.**

Radio waves don't need permission.

---

## Suggested Repository Structure

```
nodyx-p2p/
├── nodyx-turn/               ← exists (Rust STUN/TURN)
├── nodyx-relay/              ← exists (Rust TCP tunnel)
└── nodyx-ether/              ← future (Reticulum Rust bridge)
    ├── reticulum-rs/         ← Rust port of Reticulum core protocol
    │   ├── src/identity.rs   ← Destination = Curve25519 key pair
    │   ├── src/link.rs       ← Encrypted link establishment
    │   ├── src/transport.rs  ← Routing, announce, path-find
    │   └── src/interfaces/   ← LoRa, Serial, TCP, UDP backends
    ├── nodyx-modem/          ← software modem (HF / FT8-style encoding)
    ├── nodyx-mesh/           ← LoRa / WiFi-adhoc interface driver
    └── nodyx-sync/           ← CRDT delta serialization over Reticulum
        │                        (Cap'n Proto / FlatBuffers)
        └── src/crdt.rs       ← LWW ops → Reticulum packets → remote CRDT apply
```

The workspace is already Rust. The CRDT is already written. Reticulum's protocol is documented and open.
The next binary is waiting — and it has a blueprint.

---

## Why This Idea Exists

Genius is not inventing. It's connecting.

Every piece of this vision already existed. CRDTs, LoRa, HF radio, Rust, Meshtastic, Reticulum — all of it was already there, scattered across garages, amateur radio clubs, research papers, and open source repositories. The missing piece was not technology. It was the will to connect them around a simple human question:

*"What happens to the community when the cable gets cut?"*

That question doesn't come from a lab. It comes from people who have learned — through experience, not theory — that infrastructure fails, that systems betray, and that what survives is always the same thing: people who trust each other enough to keep communicating.

---

Nodyx exists because some tools should be like good animals.

No hidden agenda. No terms of service that change overnight. No algorithm that decides what you see. No company that owns what you shared.

What you see is what you have. What you build stays yours.

That's not a feature. That's the whole point.

---

*This document was shaped by a conversation with someone who asked to remain anonymous.*
*They have no interest in credit. They just wanted the idea to exist.*
*Thank you.*

---

*Written March 2026 — Nodyx v1.9.3 — updated to incorporate Reticulum Network Stack as transport foundation*
*"The network is the people. And people have always found ways to communicate."*
*AGPL-3.0 — Fork us if we betray you.*
