![Screenshot of a comment on a GitHub issue showing an image, added in the Markdown, of an Octocat smiling and raising a tentacle.](https://github.com/Pokled/Nexus/blob/main/docs/img/Nexus_Install.png?raw=true)

# 🚀 Nexus — Guide d'installation complet

> **En bref :** Clone le repo sur un serveur Linux, lance `bash install.sh`, réponds à 5 questions. C'est tout. ☕

---

## Sommaire

- [Avant de commencer](#-avant-de-commencer)
- [Où héberger ?](#-où-héberger-)
- [Ai-je besoin d'un nom de domaine ?](#-ai-je-besoin-dun-nom-de-domaine-)
- [Quels ports ouvrir ?](#-quels-ports-ouvrir-)
- [Installation — La méthode simple](#-installation--la-méthode-simple-recommandée)
- [Utilisateurs Windows — Guide WSL](#-utilisateurs-windows--guide-wsl)
- [Serveur maison / Derrière un routeur (NAT)](#-serveur-maison--derrière-un-routeur-nat)
- [Héberger SANS ouvrir de ports (Cloudflare Tunnel, Tailscale)](#-héberger-chez-soi-sans-ouvrir-de-ports)
- [Derrière un VPN ou WireGuard](#-derrière-un-vpn-ou-wireguard)
- [Erreurs fréquentes et solutions](#-erreurs-fréquentes-et-solutions)
- [Après l'installation](#-après-linstallation)
- [Conseils et astuces](#-conseils-et-astuces)

---

## 📋 Avant de commencer

### Configuration matérielle minimale

| Composant | Minimum | Recommandé |
|---|---|---|
| CPU | 1 vCPU / 1 cœur | 2 vCPU ou plus |
| RAM | 1 Go | 2 Go ou plus |
| Disque | 10 Go SSD | 20 Go SSD |
| Bande passante | 10 Mbps | 100 Mbps |
| OS | Ubuntu 22.04 | Ubuntu 24.04 LTS |

> 💡 **Exemple réel :** Une communauté de 50 utilisateurs actifs tourne sans problème sur un VPS à 4€/mois (Hetzner CX22, 2 vCPU / 4 Go RAM). Les salons vocaux sont en P2P — ils ne consomment pas la bande passante du serveur.

### Systèmes d'exploitation supportés

| OS | Support | Notes |
|---|---|---|
| Ubuntu 24.04 LTS | ✅ Recommandé | Le mieux testé |
| Ubuntu 22.04 LTS | ✅ Supporté | Fonctionne parfaitement |
| Debian 12 (Bookworm) | ✅ Supporté | Entièrement compatible |
| Debian 11 (Bullseye) | ✅ Supporté | Compatible |
| Windows (WSL2) | ✅ Supporté | [Voir section WSL](#-utilisateurs-windows--guide-wsl) |
| macOS | ⚠️ Manuel seulement | install.sh est Linux uniquement |
| CentOS / RHEL / Fedora | ❌ Non supporté | Utilise Docker à la place |
| Raspberry Pi OS | ✅ Supporté | Utilise la version 64 bits |

### Un seul prérequis — Git

L'installateur a besoin de `git` pour cloner le dépôt Nexus. La plupart des images VPS ne l'incluent pas par défaut. Installe-le en premier :

```bash
# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y git

# C'est tout. L'installateur s'occupe du reste.
```

---

### Ce que `install.sh` installe automatiquement

Tu n'as rien d'autre à installer manuellement. Le script s'occupe de tout :

- **Node.js 20 LTS** — Runtime JavaScript
- **PostgreSQL 16** — Base de données principale
- **Redis 7** — Cache et sessions temps réel
- **Coturn** — Relais TURN/STUN pour les salons vocaux (WebRTC, traversée NAT)
- **Caddy** — Reverse proxy + HTTPS automatique (Let's Encrypt)
- **PM2** — Gestionnaire de processus (redémarrage auto, démarrage au boot)

---

## 🖥️ Où héberger ?

### Option 1 — VPS (Recommandé pour débuter)

Un VPS (serveur privé virtuel) est une machine Linux distante louée au mois. Elle est toujours en ligne, a une IP fixe, et tu peux t'y connecter en SSH depuis n'importe où.

**Hébergeurs recommandés :**

| Hébergeur | Offre d'entrée | Prix/mois | Notes |
|---|---|---|---|
| [Hetzner Cloud](https://hetzner.com/cloud) | CX22 (2 vCPU, 4 Go) | ~3,5€ | Meilleur rapport qualité/prix en Europe |
| [DigitalOcean](https://digitalocean.com) | Basic (1 vCPU, 1 Go) | 6$ | Panel très accessible aux débutants |
| [Vultr](https://vultr.com) | Cloud Compute 1 vCPU | 6$ | Bonne couverture mondiale |
| [OVH](https://ovh.com) | VPS Starter | ~3€ | Hébergeur français |

> 💡 **Conseil :** Choisis toujours un VPS proche de tes utilisateurs (Europe → Frankfurt ou Paris, Amérique du Nord → New York ou Dallas).

**Comment créer un VPS (exemple avec Hetzner) :**
1. Crée un compte sur hetzner.com
2. Va dans **Cloud → Projects → New Project**
3. Clique sur **Add Server**
4. Choisis : Location (ex: Nuremberg), Image = **Ubuntu 24.04**, Type = **CX22**
5. Ajoute ta clé SSH publique (recommandé) ou définis un mot de passe root
6. Clique sur **Create & Buy**
7. L'IP de ton serveur apparaît dans le dashboard en 30 secondes

**Connexion à ton VPS :**
```bash
ssh root@IP_DE_TON_VPS
```

---

### Option 2 — Serveur maison

Un vieux PC, un laptop inutilisé, ou un Raspberry Pi branché chez toi. Ça marche très bien, mais ça demande :
- Une IP fixe **ou** un service DDNS (voir [section Serveur maison](#-serveur-maison--derrière-un-routeur-nat))
- La redirection de ports sur ton routeur
- Ta machine doit rester allumée 24h/24

> ⚠️ **Attention :** Beaucoup de FAI bloquent les ports entrants 80/443. Vérifie avec ton FAI avant d'investir du temps. Certains FAI (surtout la fibre) peuvent fournir une IP fixe contre une petite somme.

---

### Option 3 — Windows avec WSL (Test / Développement)

Tu peux faire tourner Nexus sur Windows 10/11 via WSL2 (Sous-système Windows pour Linux). Idéal pour tester ou développer, mais pas recommandé pour un serveur de production 24h/24.

→ [Voir le guide WSL détaillé ci-dessous](#-utilisateurs-windows--guide-wsl)

---

## 🌐 Ai-je besoin d'un nom de domaine ?

**Réponse courte : Non !** Si tu n'as pas de domaine, l'installateur crée automatiquement un domaine gratuit de type `46-225-20-193.sslip.io` (basé sur l'IP de ton serveur). Ce domaine est reconnu par Let's Encrypt → HTTPS fonctionne sans rien acheter.

En plus, tu reçois un alias mémorable `ton-slug.nexusnode.app` qui redirige vers ton instance.

**Si tu as ton propre domaine** (`macommunaute.fr`), c'est encore mieux :
- URL plus lisible et professionnelle
- Meilleure indexation Google (nom de domaine personnalisé)
- Tu peux le migrer plus tard sans tout réinstaller

> **Résumé :** sslip.io = domaine fonctionnel immédiat, certificat HTTPS automatique, aucune configuration. Ton domaine = meilleure présence, même fonctionnement.

**Registrars de domaines recommandés :**

| Registrar | Prix/an | Notes |
|---|---|---|
| [Namecheap](https://namecheap.com) | ~10$ | Super UI, WHOIS gratuit |
| [Cloudflare Registrar](https://cloudflare.com/registrar) | Au coût (~8$) | Pas de marge, DNS gratuit |
| [Gandi](https://gandi.net) | ~15€ | Hébergeur français, éthique |
| [OVH](https://ovh.com) | ~7€ | Hébergeur français |

**Configuration DNS (pointer ton domaine vers ton serveur) :**

Une fois ton domaine acheté, ajoute un **enregistrement A** dans ton panneau DNS :

```
Type  Nom     Valeur          TTL
A     @       IP_SERVEUR      300
A     www     IP_SERVEUR      300
```

> 💡 **Astuce Cloudflare :** Si tu utilises Cloudflare comme DNS, tu peux activer le nuage orange (proxy) pour HTTP/HTTPS — ça te donne une protection DDoS gratuite. **Cependant, désactive le proxy (nuage gris) pour tout sous-domaine TURN** — les salons vocaux ne fonctionneront pas à travers le proxy Cloudflare.

---

## 🔌 Quels ports ouvrir ?

Le script `install.sh` configure le pare-feu (UFW) automatiquement. Voici ce qu'il ouvre :

| Port | Protocole | Service | Obligatoire ? |
|---|---|---|---|
| 22 | TCP | SSH | ✅ Oui (pour gérer ton serveur) |
| 80 | TCP | HTTP | ✅ Oui (challenge Let's Encrypt) |
| 443 | TCP | HTTPS | ✅ Oui (ton site web) |
| 3478 | TCP + UDP | TURN/STUN (relais vocal) | ✅ Oui (salons vocaux) |
| 5349 | TCP + UDP | TURN/STUN TLS | ⚠️ Optionnel |
| 49152–65535 | UDP | Relais médias WebRTC | ✅ Oui (salons vocaux) |

> ❓ **C'est quoi un relais TURN ?** Quand deux utilisateurs veulent parler dans un salon vocal, ils essaient d'établir une connexion directe (P2P). Si l'un d'eux est derrière un NAT restrictif (connexion 4G, réseau d'entreprise), la connexion directe est impossible. Le relais TURN sert d'intermédiaire — la voix passe par ton serveur. C'est uniquement un fallback quand le P2P échoue.

---

## 🚀 Installation — La méthode simple (Recommandée)

### Étape 1 — Clone le dépôt

Sur ton serveur Linux (via SSH) :

```bash
git clone https://github.com/Pokled/Nexus.git /opt/nexus-install
cd /opt/nexus-install
```

Ou télécharge juste le script d'installation :

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh -o install.sh
```

### Étape 2 — Lance l'installateur

```bash
sudo bash install.sh
```

> 🔐 Le script doit être exécuté en root (ou avec sudo). Il installe des paquets système, configure le pare-feu et met en place les services.

### Étape 3 — Réponds aux questions

L'installateur va te demander :

```
? Nom de la communauté (ex: Linux France): Ma Super Communauté
? Identifiant unique (slug) [ma-super-communaute]:
? Langue principale (fr/en/de/es/it/pt) [fr]:

  Domaine de ton instance
  ┌─ Si tu as un domaine (ex: moncommunaute.fr), entre-le ci-dessous.
  └─ Sinon, appuie sur Entrée → domaine gratuit 46-225-20-193.sslip.io utilisé automatiquement.

? Domaine (Entrée pour obtenir un domaine gratuit): macommunaute.fr   ← ou Entrée pour sslip.io

? Nom d'utilisateur admin: alice
? Email admin: alice@exemple.fr
? Mot de passe admin: ••••••••
```

> 💡 **Pas de domaine ?** Appuie sur Entrée — ton instance sera accessible sur `46-225-20-193.sslip.io` avec HTTPS automatique. Tu peux changer pour ton propre domaine plus tard.

C'est tout. Le script s'occupe du reste automatiquement (≈ 3 à 10 minutes selon la vitesse de ton serveur).

### Étape 4 — Attends et profite ☕

L'installateur affiche un résumé à la fin :

```
╔══════════════════════════════════════════════════╗
║       ✔  Nexus installé avec succès !            ║
╚══════════════════════════════════════════════════╝

  Instance : https://macommunaute.fr
  Admin    : alice / alice@exemple.fr
  Vocal    : Relais TURN sur 46.225.20.193:3478

  Credentials sauvegardés dans : /root/nexus-credentials.txt
```

> 💡 **Le DNS prend du temps.** Après avoir pointé ton domaine vers l'IP de ton serveur, la propagation DNS peut prendre jusqu'à 24–48h dans le monde entier (en pratique 5–30 minutes). Caddy obtiendra automatiquement ton certificat SSL dès que le DNS sera résolu.

---

## 🪟 Utilisateurs Windows — Guide WSL

WSL (Windows Subsystem for Linux) permet de faire tourner Ubuntu directement dans Windows. Le `install.sh` de Nexus fonctionne parfaitement dans WSL2.

### Étape 1 — Activer WSL2

Ouvre **PowerShell en Administrateur** et lance :

```powershell
wsl --install
```

Cela installe WSL2 et Ubuntu automatiquement. **Redémarre ton PC** quand c'est demandé.

> 💡 Si WSL est déjà installé, mets-le à jour : `wsl --update`

### Étape 2 — Ouvrir Ubuntu

Après le redémarrage, recherche **"Ubuntu"** dans le menu Démarrer et ouvre-le. La première fois, il te demandera de créer un nom d'utilisateur et un mot de passe Linux.

### Étape 3 — Mettre à jour Ubuntu

```bash
sudo apt update && sudo apt upgrade -y
```

### Étape 4 — Installer Git (si besoin)

```bash
sudo apt install -y git
```

### Étape 5 — Cloner Nexus

```bash
git clone https://github.com/Pokled/Nexus.git
cd Nexus
```

### Étape 6 — Lancer l'installateur

```bash
sudo bash install.sh
```

> ⚠️ **Limitation WSL :** Les services lancés dans WSL ne redémarrent pas automatiquement avec Windows. Pour un serveur 24h/24, utilise un vrai VPS Linux. WSL est parfait pour les tests et le développement.

> 💡 **Accès depuis ton navigateur Windows :** Une fois l'installation terminée, ouvre ton navigateur et va sur `http://localhost` — Nexus sera là.

### Conseils spécifiques à WSL

- **Accès aux fichiers :** Tes fichiers Windows sont accessibles via `/mnt/c/Users/TonNom/` dans WSL
- **Raccourci terminal WSL :** Dans n'importe quel dossier Windows, tape `wsl` dans la barre d'adresse
- **Intégration VS Code :** Installe l'extension "WSL" pour VS Code et édite tes fichiers directement
- **Redirection de ports :** Pour exposer WSL sur ton réseau local, redirige les ports manuellement :
  ```powershell
  # En Administrateur dans PowerShell
  netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=80 connectaddress=$(wsl hostname -I)
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=443 connectaddress=$(wsl hostname -I)
  ```

---

## 🏠 Serveur maison / Derrière un routeur (NAT)

Faire tourner Nexus sur une machine chez toi (derrière ton box/routeur) nécessite quelques étapes supplémentaires.

### Étape 1 — Trouve ton IP publique

Va sur [whatismyip.com](https://whatismyip.com) — c'est l'IP que le monde extérieur voit.

> ⚠️ **Problème :** La plupart des FAI attribuent des **IP dynamiques** — ton IP publique peut changer. Solution : utilise un service DDNS.

### Étape 2 — Configurer un DDNS (si tu n'as pas d'IP fixe)

Un service DDNS (DNS dynamique) associe un nom d'hôte à ton IP actuelle et se met à jour automatiquement.

**Options gratuites :**
- [DuckDNS](https://www.duckdns.org) — complètement gratuit, simple, fiable
- [No-IP](https://noip.com) — offre gratuite disponible
- [Dynu](https://dynu.com) — offre gratuite disponible

**Exemple avec DuckDNS :**
1. Inscris-toi sur duckdns.org
2. Crée un sous-domaine (ex: `macommunaute.duckdns.org`)
3. Installe le client de mise à jour automatique sur ton serveur :
   ```bash
   # Ajoute au crontab (mise à jour toutes les 5 minutes)
   */5 * * * * curl -s "https://www.duckdns.org/update?domains=macommunaute&token=TON_TOKEN&ip=" > /dev/null
   ```

### Étape 3 — Redirection de ports sur ton routeur

Tu dois rediriger le trafic depuis ta box vers ton serveur. La procédure varie selon le modèle de ta box.

**Étapes générales :**
1. Connecte-toi à l'interface d'administration de ta box (généralement `http://192.168.1.1` ou `http://192.168.0.1`)
2. Trouve la section **Redirection de ports**, **NAT**, ou **Virtual Server**
3. Ajoute ces règles :

| Port externe | Protocole | IP interne | Port interne |
|---|---|---|---|
| 80 | TCP | `IP_LOCALE_DU_SERVEUR` | 80 |
| 443 | TCP | `IP_LOCALE_DU_SERVEUR` | 443 |
| 3478 | TCP+UDP | `IP_LOCALE_DU_SERVEUR` | 3478 |
| 49152–65535 | UDP | `IP_LOCALE_DU_SERVEUR` | 49152–65535 |

> 💡 **Trouver l'IP locale de ton serveur :**
> ```bash
> ip addr show | grep 'inet ' | grep -v '127.0.0.1'
> # Généralement quelque chose comme 192.168.1.42
> ```

> 💡 **Donne une IP locale fixe à ton serveur :** Dans les paramètres de ta box, cherche **Bail DHCP statique** ou **Réservation d'adresse**. Associe l'adresse MAC de ton serveur à une IP locale fixe (ex: `192.168.1.100`) pour qu'elle ne change jamais.

### CG-NAT (Carrier-Grade NAT)

Certains FAI utilisent le CG-NAT — ta connexion partage une IP publique avec des centaines d'autres clients. Dans ce cas, la redirection de ports est **impossible**.

**Comment savoir si tu es derrière un CG-NAT :**
```bash
# Compare l'IP WAN de ta box (dans son interface) avec ton IP publique (whatismyip.com)
# Si elles sont différentes → tu es derrière un CG-NAT
```

> 💡 **Astuce Orange/SFR/Bouygues :** Beaucoup de box 4G et certaines offres fibre utilisent le CG-NAT. Appelle le support de ton FAI et demande une "IP publique fixe" — c'est parfois gratuit, parfois quelques €/mois.

**Solutions si tu es derrière un CG-NAT :**
1. **Demande à ton FAI** une IP publique réelle
2. **Utilise un VPS bon marché comme relais** — installe Nginx sur le VPS et tunnel le trafic vers ton serveur maison via SSH :
   ```bash
   # Sur ton serveur maison (crée un tunnel inverse)
   ssh -R 80:localhost:80 -R 443:localhost:443 user@IP_VPS -N
   ```
3. **Utilise Cloudflare Tunnel** — gratuit, sans redirection de ports, sans VPS (mais Cloudflare voit ton trafic)

---

## 🚇 Héberger chez soi SANS ouvrir de ports

Tu veux faire tourner Nexus sur un Raspberry Pi (ou un vieux PC) à la maison, mais tu ne veux pas — ou ne peux pas — ouvrir les ports 80/443 sur ton routeur ? Pas de panique, il existe des solutions gratuites et simples.

### Pourquoi les ports sont-ils nécessaires ? (explication pour débutant)

Imagine que ton serveur est une maison. Pour que les visiteurs du monde entier puissent sonner à ta porte, il faut :
1. Que ta maison ait une **adresse visible de l'extérieur** (IP publique)
2. Que la **porte soit ouverte** (ports 80 et 443 redirigés depuis ta box vers ton serveur)

Si tu ne veux pas ouvrir ces portes, il faut passer par un **tunnel** — un intermédiaire qui reçoit les visiteurs pour toi et les fait entrer par une porte de service que tu contrôles, sans exposer ta maison directement.

> ⚠️ **Important :** Sans HTTPS, les **salons vocaux ne fonctionneront pas** — les navigateurs refusent d'accéder au micro/caméra sur HTTP non sécurisé. Une solution tunnel est obligatoire pour utiliser toutes les fonctionnalités de Nexus.

---

### 🌩️ Solution 1 — Cloudflare Tunnel *(recommandée, 100% gratuite)*

Cloudflare Tunnel crée une connexion **sortante** depuis ton serveur vers les serveurs Cloudflare. Aucun port à ouvrir. Cloudflare reçoit les visiteurs et les transmet à ton serveur via ce tunnel.

**Ce qu'il te faut :**
- Un compte Cloudflare gratuit → [dash.cloudflare.com](https://dash.cloudflare.com)
- Un nom de domaine (~1€/an chez [Porkbun](https://porkbun.com) ou [Namecheap](https://namecheap.com))

> 💡 Tu n'as pas de domaine ? Cloudflare propose des domaines `.workers.dev` gratuits, mais avec des limitations. Pour Nexus, un vrai domaine à 1€/an est très recommandé.

#### Étape 1 — Crée un compte Cloudflare

1. Va sur [dash.cloudflare.com](https://dash.cloudflare.com) et crée un compte gratuit
2. Clique sur **"Add a site"** et entre ton nom de domaine
3. Choisis le plan **Free** (0€/mois)
4. Cloudflare te donne deux **serveurs DNS** à configurer (ex: `aria.ns.cloudflare.com`)
5. Va dans le panneau de gestion de ton registrar (là où tu as acheté le domaine) et remplace les DNS par ceux de Cloudflare
6. Attends 5-30 minutes que la propagation se fasse (Cloudflare te le confirme par email)

#### Étape 2 — Installe `cloudflared` sur ton serveur

Sur ton Raspberry Pi / serveur Ubuntu/Debian :

```bash
# Télécharge cloudflared (vérifie l'architecture : arm64 pour Raspberry Pi 4, amd64 pour PC)
# Raspberry Pi 4 (arm64) :
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
     -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# PC classique (amd64) :
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
     -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Vérifie que ça fonctionne :
cloudflared --version
```

#### Étape 3 — Connecte-toi à Cloudflare

```bash
cloudflared tunnel login
```

👆 Cette commande affiche un lien URL. **Copie-le** et ouvre-le dans ton navigateur. Connecte-toi à ton compte Cloudflare et autorise l'accès. Un fichier de certificat est automatiquement téléchargé sur ton serveur (dans `~/.cloudflared/cert.pem`).

#### Étape 4 — Crée le tunnel

```bash
# Remplace "ma-communaute" par le nom que tu veux
cloudflared tunnel create ma-communaute
```

Cette commande crée un fichier de configuration dans `~/.cloudflared/`. Note l'**ID du tunnel** qui s'affiche (ex: `6ff42ae2-765d-4adf-8112-31c55c1551ef`).

#### Étape 5 — Configure le tunnel

Crée le fichier de configuration :

```bash
nano ~/.cloudflared/config.yml
```

Colle ce contenu (remplace `TUNNEL_ID` par l'ID de l'étape 4, et `moncommunaute.fr` par ton domaine) :

```yaml
tunnel: TUNNEL_ID
credentials-file: /root/.cloudflared/TUNNEL_ID.json

ingress:
  # Le frontend (interface web)
  - hostname: moncommunaute.fr
    service: http://localhost:4173
  # L'API backend
  - hostname: api.moncommunaute.fr
    service: http://localhost:3000
  # Route par défaut (obligatoire)
  - service: http_status:404
```

#### Étape 6 — Crée les entrées DNS

```bash
# Pointe moncommunaute.fr vers le tunnel
cloudflared tunnel route dns ma-communaute moncommunaute.fr

# Pointe api.moncommunaute.fr vers le tunnel
cloudflared tunnel route dns ma-communaute api.moncommunaute.fr
```

Ces commandes créent automatiquement les enregistrements DNS dans Cloudflare. Aucune manipulation manuelle dans le panneau DNS.

#### Étape 7 — Lance le tunnel (test)

```bash
cloudflared tunnel run ma-communaute
```

Si tout va bien, tu verras `INF Connection established` dans les logs. Ouvre `https://moncommunaute.fr` dans ton navigateur — Nexus doit s'afficher !

#### Étape 8 — Lance le tunnel automatiquement au démarrage

Pour que le tunnel démarre tout seul quand ton serveur redémarre :

```bash
# Installe cloudflared comme service système
cloudflared service install

# Active et démarre le service
systemctl enable cloudflared
systemctl start cloudflared

# Vérifie que c'est bien lancé
systemctl status cloudflared
```

#### Étape 9 — Configure Nexus pour utiliser ce domaine

Lors de l'installation, entre ton domaine `moncommunaute.fr` quand l'installateur te le demande. Caddy sera configuré, mais dans le cas d'un tunnel Cloudflare, **tu peux désactiver Caddy** (Cloudflare gère le HTTPS) :

```bash
systemctl stop caddy
systemctl disable caddy
```

Puis modifie le Caddyfile ou configure directement Nexus pour écouter en HTTP (pas HTTPS) sur localhost — le tunnel Cloudflare s'occupe de chiffrer la connexion.

> 💡 **Le TURN vocal :** Le tunnel Cloudflare ne supporte pas UDP, donc les **salons vocaux utiliseront ton TURN relay** à l'IP de ton serveur. Pour que ça fonctionne, le port **3478 UDP** doit être ouvert sur ton routeur. C'est le seul port indispensable pour la voix. Si tu ne peux pas l'ouvrir, la voix ne fonctionnera qu'en mode relay TCP (dégradé).

---

### 🦎 Solution 2 — Tailscale Funnel *(gratuit, aucun domaine nécessaire)*

Tailscale Funnel expose ton serveur sur internet via le réseau Tailscale, sans ouvrir de ports. Tu obtiens une URL HTTPS gratuite du type `https://monserveur.tail1234.ts.net`.

**Ce qu'il te faut :**
- Un compte Tailscale gratuit → [tailscale.com](https://tailscale.com)

#### Étape 1 — Installe Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

#### Étape 2 — Connecte-toi

```bash
tailscale up
```

Un lien s'affiche → ouvre-le dans ton navigateur et connecte-toi à ton compte Tailscale.

#### Étape 3 — Active Funnel

```bash
# Expose le frontend (port 4173) sur internet
tailscale funnel 4173
```

Tailscale te donne une URL HTTPS publique (ex: `https://monserveur.tail1234.ts.net`). Utilise cette URL lors de l'installation de Nexus quand on te demande le domaine.

> ⚠️ **Limitations de Tailscale Funnel :** L'URL gratuite est en `.ts.net` (pas personnalisable sans abonnement), et le débit est limité sur le plan gratuit. Convient pour une petite communauté ou pour tester.

---

### 🖥️ Solution 3 — Un petit VPS *(la plus simple et la plus fiable)*

Franchement, pour une communauté sérieuse et accessible 24h/24, **un VPS reste la meilleure option**. C'est moins cher qu'une abonnement Netflix et ça évite tous ces problèmes de tunnels.

| Hébergeur | Prix/mois | Specs | Idéal pour |
|---|---|---|---|
| [Hetzner](https://hetzner.com/cloud) | 3,29€ | 2 vCPU, 4 Go RAM | ✅ Petite communauté (recommandé) |
| [Hetzner](https://hetzner.com/cloud) | 5,39€ | 2 vCPU, 8 Go RAM | ✅ Communauté active |
| [OVH VPS](https://ovhcloud.com/fr/vps/) | 3,99€ | 1 vCPU, 2 Go RAM | ✅ Débutant, serveur FR |
| [Scaleway](https://scaleway.com) | 3,60€ | 2 vCPU, 2 Go RAM | ✅ Datacenter France/Europe |

Sur un VPS :
- IP publique fixe incluse
- Ports 80/443 ouverts par défaut
- `bash install.sh` et c'est terminé en 10 minutes
- Accès 24h/24 garanti

---

## 🔒 Derrière un VPN ou WireGuard

### Nexus derrière un VPN traditionnel (NordVPN, ProtonVPN, etc.)

Si ton serveur se connecte à un VPN (peu courant, mais possible), tout le trafic sortant passe par le VPN. Ça crée deux problèmes :
- Ton serveur TURN annonce l'IP du VPN, pas la vraie IP de ton serveur
- Let's Encrypt ne peut pas atteindre ton serveur pour le challenge HTTP

**Solution :** Configure le VPN pour exclure le trafic local et ne pas router les services publics du serveur via le VPN.

Pour la plupart des configurations, **n'installe pas un VPN personnel sur la même machine que Nexus**. Utilise-le uniquement sur les appareils clients.

---

### WireGuard — Maillage P2P (Fédération Nexus — Phase 3)

> 🔭 **Ça arrive en Phase 3** — Les nœuds Nexus formeront automatiquement un réseau maillé WireGuard, rendant le réseau vraiment décentralisé et résilient.

Aujourd'hui, chaque instance Nexus est indépendante. À l'avenir, les instances se connecteront via des tunnels WireGuard pour :
- Partager les données de fédération (annuaire des instances)
- Router le trafic entre communautés
- Rendre le réseau résilient aux pannes individuelles

**Si tu as déjà WireGuard sur ton serveur** (ex: VPN personnel ou entre serveurs), attention :

1. **Assure-toi que les services Nexus écoutent sur la bonne interface** — le script utilise `0.0.0.0` par défaut (toutes les interfaces), ce qui est correct
2. **Règles de pare-feu** — UFW ouvre les ports nécessaires sur toutes les interfaces. Si tu utilises WireGuard avec un routage strict, tu devras peut-être ajouter les règles pour l'interface WireGuard (`wg0`) manuellement :
   ```bash
   sudo ufw allow in on wg0 to any port 3478
   ```
3. **IP externe TURN** — `install.sh` détecte ton IP publique automatiquement via `api.ipify.org`. Si ton serveur route le trafic sortant via WireGuard, ça pourrait retourner l'IP du pair WireGuard au lieu de ta vraie IP publique. Corrige-le :
   ```bash
   # Édite /etc/turnserver.conf
   # Modifie external-ip= avec ta vraie IP publique
   sudo systemctl restart coturn
   ```

---

## ❌ Erreurs fréquentes et solutions

### 🔴 "Address already in use" sur le port 80 ou 443

Un autre service utilise le port (souvent Apache ou une autre instance Nginx).

```bash
# Trouve ce qui utilise le port 80
sudo lsof -i :80
sudo lsof -i :443

# Arrête Apache si présent
sudo systemctl stop apache2
sudo systemctl disable apache2

# Puis redémarre Caddy
sudo systemctl restart caddy
```

---

### 🔴 Le domaine ne répond pas / Le certificat SSL échoue

Caddy essaie d'obtenir un certificat SSL de Let's Encrypt au démarrage. Si ton domaine ne pointe pas encore vers le serveur, ça échoue.

```bash
# Vérifie si ton domaine résout vers ton serveur
dig +short tondomain.fr
# Doit retourner l'IP de ton serveur

# Vérifie les logs Caddy pour les erreurs
sudo journalctl -u caddy -f

# Force Caddy à réessayer
sudo systemctl restart caddy
```

> ⏳ **La propagation DNS prend du temps** — si tu viens de changer ton DNS, attends 5–30 minutes et réessaie.

---

### 🔴 Le backend ne démarre pas (port 3000)

Consulte les logs PM2 :

```bash
pm2 logs nexus-core --lines 50
```

Causes courantes :
- **Mauvais mot de passe base de données** — vérifie `/opt/nexus/nexus-core/.env`
- **PostgreSQL pas lancé** — `sudo systemctl start postgresql`
- **Redis pas lancé** — `sudo systemctl start redis-server`
- **Port 3000 déjà utilisé** — `sudo lsof -i :3000`

---

### 🔴 Les salons vocaux affichent "Relay (TURN)" au lieu de "P2P" pour certains utilisateurs

C'est **normal et attendu**. Les utilisateurs derrière un NAT (réseaux d'entreprise, 4G, certains FAI) ne peuvent pas établir de connexions P2P directes. Le relais TURN est le fallback — il fonctionne correctement, il utilise simplement la bande passante de ton serveur.

Le vrai P2P ne fonctionne que quand les deux utilisateurs ont des IPs publiques accessibles ou des types NAT compatibles.

---

### 🔴 Le relais TURN ne fonctionne pas du tout (salons vocaux complètement en panne)

```bash
# Vérifie que coturn tourne
sudo systemctl status coturn

# Vérifie les logs coturn
tail -f /var/log/coturn.log

# Teste la connectivité TURN (depuis ta machine locale)
# Utilise https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
# Saisis : turn:IP_SERVEUR:3478 / utilisateur: nexus / credential: TON_CREDENTIAL
```

> 💡 **Utilisateurs Cloudflare :** Si ton domaine est proxifié par Cloudflare, le port 3478 ne fonctionnera pas via le nom de domaine. `install.sh` utilise **l'adresse IP directement** pour l'URL TURN (`turn:IP:3478`) pour contourner ça automatiquement.

---

### 🔴 "Failed to fetch" lors de l'upload d'avatar/bannière

Vérifie que Caddy route `/uploads/*` vers le port 3000 :

```bash
cat /etc/caddy/Caddyfile
# Doit contenir : reverse_proxy /uploads/* localhost:3000
```

---

### 🔴 Le frontend affiche une page blanche ou des erreurs SvelteKit

```bash
pm2 logs nexus-frontend --lines 50
```

Causes courantes :
- Le build frontend a échoué — recompile : `cd /opt/nexus/nexus-frontend && npm run build && pm2 restart nexus-frontend`
- Mauvais `PUBLIC_API_URL` dans `.env` — doit être `https://tondomain.fr` (sans `/api/v1`)

---

## 🎛️ Après l'installation

### Première connexion

1. Ouvre `https://tondomain.fr` dans ton navigateur
2. Connecte-toi avec les identifiants admin définis pendant l'installation
3. Tu es **owner** de la communauté — tu as accès complet au panel admin

### Panel d'administration

Accessible via le menu → **Admin** (visible uniquement pour les owners et admins).

Depuis le panel admin, tu peux :
- Uploader un logo et une bannière de communauté
- Créer des catégories de forum
- Créer des salons vocaux
- Gérer les membres (promouvoir, bannir, attribuer des grades)
- Configurer la description de la communauté

### Inviter tes premiers membres

Partage l'URL de ton instance. Les nouveaux utilisateurs peuvent s'inscrire sur `https://tondomain.fr/auth/register`.

Pour promouvoir quelqu'un en modérateur ou admin :
1. Panel admin → **Membres**
2. Trouve l'utilisateur → **Modifier le rôle**
3. Choisis : `member`, `moderator`, ou `admin`

---

## 💡 Conseils et astuces

### Commandes utiles

```bash
# Vérifier l'état de tous les services
pm2 list

# Voir les logs du backend (temps réel)
pm2 logs nexus-core

# Voir les logs du frontend
pm2 logs nexus-frontend

# Redémarrer tout
pm2 restart all

# Recompiler et redémarrer après une mise à jour
cd /opt/nexus/nexus-core && npm run build && pm2 restart nexus-core
cd /opt/nexus/nexus-frontend && npm run build && pm2 restart nexus-frontend

# Vérifier Caddy (HTTPS/proxy)
sudo systemctl status caddy
sudo journalctl -u caddy -f

# Vérifier coturn (relais vocal)
sudo systemctl status coturn
tail -f /var/log/coturn.log

# Vérifier l'espace disque
df -h

# Vérifier la mémoire
free -h

# Voir qui est connecté en SSH
who
```

### Sécuriser ton serveur

```bash
# Changer le port SSH (optionnel mais réduit le bruit)
# Édite /etc/ssh/sshd_config → Port 2222
sudo systemctl restart sshd

# Désactiver la connexion root via SSH (utilise un utilisateur normal + sudo)
# Édite /etc/ssh/sshd_config → PermitRootLogin no

# Installer fail2ban (bloque les tentatives de brute-force)
sudo apt install -y fail2ban
sudo systemctl enable fail2ban --now
```

### Sauvegardes

```bash
# Sauvegarder la base de données PostgreSQL
sudo -u postgres pg_dump nexus > /backup/nexus_$(date +%Y%m%d).sql

# Sauvegarder les uploads (avatars, bannières)
tar -czf /backup/uploads_$(date +%Y%m%d).tar.gz /opt/nexus/nexus-core/uploads/

# Automatiser avec une tâche cron quotidienne
crontab -e
# Ajoute : 0 3 * * * sudo -u postgres pg_dump nexus > /backup/nexus_$(date +%Y%m%d).sql
```

### Mettre à jour Nexus

```bash
cd /opt/nexus
git pull

# Recompiler le backend
cd nexus-core && npm install && npm run build && pm2 restart nexus-core

# Recompiler le frontend
cd ../nexus-frontend && npm install && npm run build && pm2 restart nexus-frontend
```

> 💡 **Les migrations s'appliquent automatiquement** — le backend applique les nouvelles migrations SQL au démarrage.

---

## 🗑️ Désinstallation propre

Si tu veux supprimer Nexus complètement de ton serveur :

```bash
# 1. Arrêter et supprimer les processus PM2
pm2 delete nexus-core nexus-frontend
pm2 save

# 2. Supprimer le démarrage automatique PM2
pm2 unstartup systemd

# 3. Supprimer le répertoire Nexus
rm -rf /opt/nexus

# 4. Supprimer la base de données et l'utilisateur PostgreSQL
sudo -u postgres psql -c "DROP DATABASE IF EXISTS nexus;"
sudo -u postgres psql -c "DROP ROLE IF EXISTS nexus_user;"

# 5. Supprimer la configuration Caddy
sudo rm -f /etc/caddy/Caddyfile
sudo systemctl restart caddy

# 6. Arrêter et désactiver coturn
sudo systemctl stop coturn
sudo systemctl disable coturn
sudo rm -f /etc/turnserver.conf

# 7. Réinitialiser le pare-feu (optionnel)
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw --force enable

# 8. Supprimer le fichier de credentials
rm -f /root/nexus-credentials.txt
```

> ⚠️ **Uploads** (avatars, bannières, etc.) sont dans `/opt/nexus/nexus-core/uploads/`. Fais une sauvegarde avant de supprimer si tu veux conserver les fichiers des utilisateurs.

### Désinstaller les paquets système (optionnel)

Ne fais ça que si ces paquets ont été installés uniquement pour Nexus :

```bash
# Supprimer coturn
sudo apt-get remove --purge -y coturn

# Supprimer Caddy
sudo apt-get remove --purge -y caddy
sudo rm -f /etc/apt/sources.list.d/caddy-stable.list

# Supprimer Redis (seulement si aucun autre service ne l'utilise)
sudo apt-get remove --purge -y redis-server

# Supprimer PostgreSQL (DANGER : supprime toutes les DB du serveur)
# sudo apt-get remove --purge -y postgresql postgresql-contrib
# sudo rm -rf /var/lib/postgresql/

# Supprimer Node.js
# sudo apt-get remove --purge -y nodejs
```

---

## 🆘 Toujours bloqué ?

- Consulte les [Issues ouvertes](https://github.com/Pokled/Nexus/issues)
- Ouvre une [Discussion](https://github.com/Pokled/Nexus/discussions)
- Lis la [doc Architecture](./ARCHITECTURE.md) pour comprendre comment les pièces s'assemblent

---

*Guide d'installation Nexus — v0.4.1 — Mars 2026*
