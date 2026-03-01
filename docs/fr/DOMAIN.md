# 🌐 Nexus — Guide complet des noms de domaine

> Ce guide répond à une question que tout le monde se pose au moment d'installer Nexus :
> **"Ai-je besoin d'un domaine ? Lequel ? Pourquoi mon No-IP ne marche pas ?"**

---

## Sommaire

- [Les 3 types de "domaines"](#-les-3-types-de-domaines)
- [Tableau de compatibilité](#-tableau-de-compatibilité)
- [Arbre de décision](#-arbre-de-décision--quel-script-utiliser-)
- [Pourquoi No-IP et DuckDNS ne fonctionnent pas avec CF Tunnel](#-pourquoi-no-ip-duckdns-etc-ne-fonctionnent-pas-avec-cloudflare-tunnel)
- [Où acheter un domaine pas cher](#-où-acheter-un-domaine-pas-cher)
- [Configurer son DNS](#-configurer-son-dns)

---

## 🧩 Les 3 types de "domaines"

Il existe trois réalités très différentes derrière le mot "domaine", et les confondre est la source de la plupart des problèmes.

### Type 1 — Vrai domaine (TLD)

> `moncommunaute.fr`, `clubtricot.net`, `association-lyon.org`

Tu **achètes** ce domaine chez un registrar (Namecheap, OVH, Porkbun…). Tu en es le propriétaire. Tu peux changer ses **nameservers** comme tu veux — c'est-à-dire désigner qui gère son DNS.

- ✅ Compatible avec `install.sh`
- ✅ Compatible avec `install_tunnel.sh` (Cloudflare Tunnel)
- ✅ Compatible avec nexusnode.app
- ✅ Stable, professionnel, portable
- 💰 ~1€/an (`.xyz`, `.site`) à ~15€/an (`.fr`, `.com`)

---

### Type 2 — Sous-domaine dynamique gratuit (DDNS)

> `monserveur.ddns.net` (No-IP), `moncommunaute.duckdns.org` (DuckDNS), `macommunaute.mooo.com` (Afraid.org)

Tu obtiens un **sous-domaine** d'un domaine qui appartient à No-IP, DuckDNS, etc. Tu ne possèdes **pas** la racine (`ddns.net`, `duckdns.org`). Ces services sont conçus pour pointer un hostname vers une IP qui change souvent (IP dynamique résidentielle).

- ✅ Compatible avec `install.sh` *(si tu configures Caddy manuellement — non automatisé)*
- ❌ **Incompatible avec `install_tunnel.sh`** — [voir pourquoi ci-dessous](#-pourquoi-no-ip-duckdns-etc-ne-fonctionnent-pas-avec-cloudflare-tunnel)
- ⚠️ Instable si ton IP change (résidentiel sans IP fixe)
- 🆓 Gratuit

---

### Type 3 — Sous-domaine offert par Nexus

> `moncommunaute.nexusnode.app` (via le directory Nexus)
> `46-225-20-193.sslip.io` (via l'IP publique du serveur)

Ces sous-domaines sont fournis **automatiquement** par `install.sh`. Tu n'as rien à configurer.

- ✅ Compatible avec `install.sh` (ports 80/443 ouverts)
- ❌ **Incompatible avec `install_tunnel.sh`** — `nexusnode.app` est notre zone DNS, pas la tienne
- ✅ Certificat HTTPS automatique via Let's Encrypt (Caddy)
- 🆓 100% gratuit, zéro configuration

---

## 📊 Tableau de compatibilité

| Solution | `install.sh` | `install_tunnel.sh` | HTTPS auto | Stable prod |
|---|:---:|:---:|:---:|:---:|
| **Vrai domaine payant** (~1€/an) | ✅ | ✅ | ✅ | ✅ |
| **nexusnode.app** (fourni par Nexus) | ✅ | ❌ | ✅ | ✅ |
| **sslip.io** (auto selon IP) | ✅ | ❌ | ✅ | ✅ (IP fixe) |
| **No-IP / DuckDNS / Afraid** | ⚠️ manuel | ❌ | ⚠️ manuel | ⚠️ IP dynamique |
| **Freenom (.tk, .ml, .ga…)** | ❌ service mort | ❌ | ❌ | ❌ |
| **CF Quick Tunnel** (`trycloudflare.com`) | — | ⚠️ test seul. | ✅ | ❌ URL change |

> **Légende :**
> ✅ Compatible et automatisé
> ⚠️ Possible mais avec limitations ou configuration manuelle
> ❌ Incompatible ou déconseillé

---

## 🗺️ Arbre de décision — quel script utiliser ?

```
Je veux installer Nexus sur mon serveur
│
├── Puis-je ouvrir les ports 80 et 443 sur mon routeur/box ?
│   │
│   ├── OUI → bash install.sh
│   │          │
│   │          ├── J'ai un domaine → je l'entre lors de l'install
│   │          └── Pas de domaine → sslip.io + nexusnode.app gratuits
│   │                              → tout est automatique ✅
│   │
│   └── NON → bash install_tunnel.sh
│              │
│              ├── J'ai un vrai domaine géré par Cloudflare
│              │   → je l'entre lors de l'install ✅
│              │
│              ├── J'ai un sous-domaine No-IP / DuckDNS
│              │   → ❌ incompatible (je ne possède pas la racine)
│              │   → Solution : acheter un vrai domaine (~1€/an)
│              │
│              └── Pas de domaine du tout
│                  → Solution 1 : acheter un domaine (~1€/an) + CF Tunnel
│                  → Solution 2 : ouvrir les ports 80/443 + install.sh
```

---

## ❓ Pourquoi No-IP, DuckDNS, etc. ne fonctionnent pas avec Cloudflare Tunnel

C'est la question la plus fréquente. L'explication est technique mais simple à comprendre.

### Comment fonctionne Cloudflare Tunnel avec le DNS

Quand tu lances `cloudflared tunnel route dns mon-tunnel moncommunaute.fr`, la commande :

1. Se connecte à ton compte Cloudflare
2. Accède à la **zone DNS** du domaine `moncommunaute.fr` *(que tu gères dans CF)*
3. Crée automatiquement un enregistrement **CNAME** :
   ```
   moncommunaute.fr  →  CNAME  →  abc123.cfargotunnel.com
   ```
4. Les visiteurs qui vont sur `moncommunaute.fr` arrivent chez Cloudflare, qui les redirige vers ton tunnel

### Pourquoi un sous-domaine DDNS bloque tout

Imagine que tu as `macommunaute.duckdns.org`.

- La zone DNS de `duckdns.org` appartient à **DuckDNS**, pas à toi
- Ton compte Cloudflare n'a **aucun accès** à cette zone
- `cloudflared tunnel route dns` va échouer avec une erreur du type :
  ```
  Error: failed to add route: code: 1003, reason: You do not own this domain
  ```

C'est aussi simple que ça : **tu dois posséder le domaine racine** pour que Cloudflare puisse y écrire des enregistrements DNS.

### Le même problème avec nexusnode.app

`nexusnode.app` est notre domaine. Son DNS est géré par notre instance Cloudflare, pas par le tien. Même si tu essaies d'y ajouter une route de tunnel, Cloudflare te dira que tu n'en es pas propriétaire.

### Pourquoi sslip.io ne marche pas non plus avec CF Tunnel

`sslip.io` fonctionne par un mécanisme de DNS magique : `46-225-20-193.sslip.io` résout automatiquement vers `46.225.20.193`. C'est un domaine public géré par ses créateurs — tu n'en es pas propriétaire. Même raisonnement.

### La seule vraie solution

Pour `install_tunnel.sh`, il te faut un **vrai domaine que tu as acheté** et dont tu as transféré les nameservers vers Cloudflare. C'est la condition non négociable.

La bonne nouvelle : les domaines sont devenus très bon marché.

---

## 💰 Où acheter un domaine pas cher

| Registrar | Extensions | Prix indicatif | Avantage |
|---|---|---|---|
| [Porkbun](https://porkbun.com) | `.xyz`, `.site`, `.app`, `.net`… | **~0,95€/an** (première année) | Le moins cher, interface claire |
| [Namecheap](https://namecheap.com) | `.com`, `.net`, `.org`, `.fr`… | ~2€–10€/an | Promo fréquentes, WHOIS privé inclus |
| [Cloudflare Registrar](https://cloudflare.com/products/registrar/) | `.com`, `.net`, `.org`… | Au coût réel (~8€/an) | Pas de marge, DNS CF natif |
| [OVH](https://ovh.com) | `.fr`, `.eu`, `.com`… | ~7€–12€/an | Hébergeur français, support FR |
| [Gandi](https://gandi.net) | `.fr`, `.com`, `.org`… | ~15€/an | Éthique, respect vie privée |

> 💡 **Conseil :** Si tu prends un domaine pour CF Tunnel, prends-le directement chez **Cloudflare Registrar** — tu évites l'étape "changer les nameservers" puisque c'est déjà géré nativement.

### Extensions les moins chères pour commencer

- `.xyz` → souvent **< 1€/an** la première année
- `.site` → souvent **< 1€/an** la première année
- `.app` → ~1€/an, bonus : Google l'oblige en HTTPS nativement
- `.fr` → ~5€/an, si tu veux une extension française

---

## 🛠️ Configurer son DNS

### Avec `install.sh` — enregistrement A classique

Une fois ton domaine acheté, ajoute ces enregistrements dans le panneau DNS de ton registrar :

```
Type   Nom    Valeur         TTL
A      @      IP_SERVEUR     300
A      www    IP_SERVEUR     300
```

Remplace `IP_SERVEUR` par l'IP publique de ton serveur (affichée au début de `install.sh`).

> ⚠️ Si ton domaine est proxifié par Cloudflare (nuage orange), le port TURN 3478 ne sera pas accessible par le nom de domaine. `install.sh` utilise l'IP directe pour l'URL TURN — c'est normal et voulu.

### Avec `install_tunnel.sh` — CNAME automatique

Tu n'as **rien à configurer** manuellement. Le script crée le CNAME automatiquement via `cloudflared tunnel route dns`. La seule chose à faire est d'avoir ajouté ton domaine à Cloudflare avec ses nameservers (étape 1 du guide CF Tunnel).

---

## 📎 Liens utiles

- [Guide d'installation complet](INSTALL.md)
- [Section Cloudflare Tunnel dans INSTALL.md](INSTALL.md#-héberger-chez-soi-sans-ouvrir-de-ports)
- [Cloudflare Registrar](https://cloudflare.com/products/registrar/)
- [Porkbun — domaines pas chers](https://porkbun.com)
- [Qu'est-ce que sslip.io ?](https://sslip.io)
