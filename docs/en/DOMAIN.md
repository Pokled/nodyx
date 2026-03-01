# 🌐 Nexus — Complete Domain Name Guide

> This guide answers the question everyone asks when installing Nexus:
> **"Do I need a domain? Which one? Why doesn't my No-IP work?"**

---

## Table of Contents

- [The 3 Types of "Domains"](#-the-3-types-of-domains)
- [Compatibility Table](#-compatibility-table)
- [Decision Tree](#-decision-tree--which-script-should-i-use)
- [Why No-IP and DuckDNS Don't Work with CF Tunnel](#-why-no-ip-duckdns-etc-dont-work-with-cloudflare-tunnel)
- [Where to Buy a Cheap Domain](#-where-to-buy-a-cheap-domain)
- [DNS Setup](#-dns-setup)

---

## 🧩 The 3 Types of "Domains"

There are three very different realities behind the word "domain", and confusing them is the source of most problems.

### Type 1 — Real Domain (TLD)

> `mycommunity.com`, `knittingclub.net`, `association.org`

You **buy** this domain from a registrar (Namecheap, OVH, Porkbun…). You own it. You can change its **nameservers** freely — meaning you control who manages its DNS.

- ✅ Compatible with `install.sh`
- ✅ Compatible with `install_tunnel.sh` (Cloudflare Tunnel)
- ✅ Compatible with nexusnode.app
- ✅ Stable, professional, portable
- 💰 ~$1/year (`.xyz`, `.site`) to ~$15/year (`.com`, `.org`)

---

### Type 2 — Free Dynamic DNS Subdomain (DDNS)

> `myserver.ddns.net` (No-IP), `mycommunity.duckdns.org` (DuckDNS), `mysite.mooo.com` (Afraid.org)

You get a **subdomain** of a domain that belongs to No-IP, DuckDNS, etc. You do **not** own the root domain (`ddns.net`, `duckdns.org`). These services are designed to point a hostname to an IP that often changes (residential dynamic IP).

- ✅ Compatible with `install.sh` *(only with manual Caddy config — not automated)*
- ❌ **Incompatible with `install_tunnel.sh`** — [see why below](#-why-no-ip-duckdns-etc-dont-work-with-cloudflare-tunnel)
- ⚠️ Unstable if your IP changes (residential without a static IP)
- 🆓 Free

---

### Type 3 — Subdomain Offered by Nexus

> `mycommunity.nexusnode.app` (via the Nexus directory)
> `46-225-20-193.sslip.io` (via the server's public IP)

These subdomains are provided **automatically** by `install.sh`. No setup required.

- ✅ Compatible with `install.sh` (ports 80/443 open)
- ❌ **Incompatible with `install_tunnel.sh`** — `nexusnode.app` is our DNS zone, not yours
- ✅ Automatic HTTPS certificate via Let's Encrypt (Caddy)
- 🆓 100% free, zero configuration

---

## 📊 Compatibility Table

| Solution | `install.sh` | `install_tunnel.sh` | Auto HTTPS | Prod stable |
|---|:---:|:---:|:---:|:---:|
| **Paid real domain** (~$1/year) | ✅ | ✅ | ✅ | ✅ |
| **nexusnode.app** (provided by Nexus) | ✅ | ❌ | ✅ | ✅ |
| **sslip.io** (auto from IP) | ✅ | ❌ | ✅ | ✅ (static IP) |
| **No-IP / DuckDNS / Afraid** | ⚠️ manual | ❌ | ⚠️ manual | ⚠️ dynamic IP |
| **Freenom (.tk, .ml, .ga…)** | ❌ service dead | ❌ | ❌ | ❌ |
| **CF Quick Tunnel** (`trycloudflare.com`) | — | ⚠️ testing only | ✅ | ❌ URL changes |

> **Legend:**
> ✅ Compatible and automated
> ⚠️ Possible but with limitations or manual configuration
> ❌ Incompatible or not recommended

---

## 🗺️ Decision Tree — Which Script Should I Use?

```
I want to install Nexus on my server
│
├── Can I open ports 80 and 443 on my router/box?
│   │
│   ├── YES → bash install.sh
│   │          │
│   │          ├── I have a domain → enter it during install
│   │          └── No domain → sslip.io + nexusnode.app free
│   │                         → fully automatic ✅
│   │
│   └── NO → bash install_tunnel.sh
│              │
│              ├── I have a real domain managed by Cloudflare
│              │   → enter it during install ✅
│              │
│              ├── I have a No-IP / DuckDNS subdomain
│              │   → ❌ incompatible (I don't own the root)
│              │   → Solution: buy a real domain (~$1/year)
│              │
│              └── No domain at all
│                  → Option 1: buy a domain (~$1/year) + CF Tunnel
│                  → Option 2: open ports 80/443 + install.sh
```

---

## ❓ Why No-IP, DuckDNS, etc. Don't Work with Cloudflare Tunnel

This is the most common question. The explanation is technical but easy to understand.

### How Cloudflare Tunnel Works with DNS

When you run `cloudflared tunnel route dns my-tunnel mycommunity.com`, the command:

1. Connects to your Cloudflare account
2. Accesses the **DNS zone** for `mycommunity.com` *(which you manage in CF)*
3. Automatically creates a **CNAME** record:
   ```
   mycommunity.com  →  CNAME  →  abc123.cfargotunnel.com
   ```
4. Visitors who go to `mycommunity.com` arrive at Cloudflare, which redirects them through your tunnel

### Why a DDNS Subdomain Blocks Everything

Imagine you have `mycommunity.duckdns.org`.

- The DNS zone for `duckdns.org` belongs to **DuckDNS**, not you
- Your Cloudflare account has **no access** to that zone
- `cloudflared tunnel route dns` will fail with an error like:
  ```
  Error: failed to add route: code: 1003, reason: You do not own this domain
  ```

It's that simple: **you must own the root domain** for Cloudflare to write DNS records into it.

### The Same Problem with nexusnode.app

`nexusnode.app` is our domain. Its DNS is managed by our Cloudflare instance, not yours. Even if you tried to add a tunnel route to it, Cloudflare would tell you that you don't own it.

### Why sslip.io Doesn't Work with CF Tunnel Either

`sslip.io` works through a magic DNS mechanism: `46-225-20-193.sslip.io` automatically resolves to `46.225.20.193`. It's a public domain managed by its creators — you don't own it. Same reasoning.

### The Only Real Solution

For `install_tunnel.sh`, you need a **real domain you've purchased** and whose nameservers you've transferred to Cloudflare. That's the non-negotiable requirement.

The good news: domains have become very affordable.

---

## 💰 Where to Buy a Cheap Domain

| Registrar | Extensions | Indicative price | Advantage |
|---|---|---|---|
| [Porkbun](https://porkbun.com) | `.xyz`, `.site`, `.app`, `.net`… | **~$0.95/year** (first year) | Cheapest, clean interface |
| [Namecheap](https://namecheap.com) | `.com`, `.net`, `.org`… | ~$2–$10/year | Frequent promos, free WHOIS privacy |
| [Cloudflare Registrar](https://cloudflare.com/products/registrar/) | `.com`, `.net`, `.org`… | At cost (~$8/year) | No markup, native CF DNS |
| [OVH](https://ovh.com) | `.com`, `.net`, `.eu`… | ~$7–$12/year | French provider, FR support |
| [Gandi](https://gandi.net) | `.com`, `.org`, `.net`… | ~$15/year | Ethical, privacy-focused |

> 💡 **Tip:** If you're buying a domain for CF Tunnel, get it directly from **Cloudflare Registrar** — it skips the "change nameservers" step since it's managed natively.

### Cheapest Extensions to Get Started

- `.xyz` → often **< $1/year** for the first year
- `.site` → often **< $1/year** for the first year
- `.app` → ~$1/year, bonus: Google enforces HTTPS natively
- `.com` → ~$8–10/year, the most recognized extension

---

## 🛠️ DNS Setup

### With `install.sh` — Classic A Record

Once you have a domain, add these records in your registrar's DNS panel:

```
Type   Name   Value          TTL
A      @      SERVER_IP      300
A      www    SERVER_IP      300
```

Replace `SERVER_IP` with your server's public IP (displayed at the start of `install.sh`).

> ⚠️ If your domain is proxied through Cloudflare (orange cloud), TURN port 3478 won't be accessible by domain name. `install.sh` uses the direct IP for the TURN URL — this is intentional and correct.

### With `install_tunnel.sh` — Automatic CNAME

You have **nothing to configure manually**. The script creates the CNAME automatically via `cloudflared tunnel route dns`. The only thing you need to do is add your domain to Cloudflare with its nameservers (Step 1 of the CF Tunnel guide).

---

## 📎 Useful Links

- [Full Installation Guide](INSTALL.md)
- [Cloudflare Tunnel Section in INSTALL.md](INSTALL.md#-hosting-at-home-without-opening-ports)
- [Cloudflare Registrar](https://cloudflare.com/products/registrar/)
- [Porkbun — affordable domains](https://porkbun.com)
- [What is sslip.io?](https://sslip.io)
