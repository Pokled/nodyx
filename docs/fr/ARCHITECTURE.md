# Architecture

Comment une instance Nodyx est construite, ce qui tourne où, et pourquoi. Cette page décrit le code tel qu'il est aujourd'hui ; quand le code change, elle change avec lui.

## La règle fondatrice

**Une instance = une communauté.** Un serveur Nodyx héberge une seule communauté : son forum, son chat, ses salons vocaux, ses membres. Il n'y a ni mode multi-communautés ni serveur central. Les instances se trouvent grâce à un annuaire auquel chacune choisit de s'inscrire, et une instance continue de fonctionner si nodyx.org disparaît.

## Vue d'ensemble

```
            Navigateur (application SvelteKit, installable en PWA)
                          |  HTTPS + WebSocket
                          v
                   Caddy (proxy inverse, TLS)
             /api/* et /socket.io/*            tout le reste
                    |                               |
                    v                               v
          nodyx-core (port 3000)          nodyx-frontend (port 5173)
          Fastify v5 + TypeScript         SvelteKit 5, rendu serveur
          API REST + Socket.IO
              |            |
              v            v
         PostgreSQL      Redis
         toutes les      sessions, présence, limites de débit, files
         données
```

La voix et la vidéo ne passent pas par ce chemin : elles vont de navigateur à navigateur en WebRTC, avec des services Rust pour les cas où un lien direct est impossible (voir la section « La voix et la vidéo » plus bas).

## Les deux applications principales

### nodyx-core : l'API

- **Fastify v5 + TypeScript**, compilé dans `dist/` et lancé par PM2.
- **API REST sous `/api/v1/`**, un fichier par domaine dans `src/routes/` (environ 35 fichiers : auth, forums, chat, dm, users, polls, events, wiki, tasks, canvas, music, extensions, admin, etc.).
- **Socket.IO** pour tout le temps réel : chat, présence, « en train d'écrire », signalisation vocale, tableau blanc collaboratif, salons de chuchotement. Il est branché **après** `server.listen()`, une contrainte de Fastify v5.
- **Middlewares** dans `src/middleware/` : `requireAuth`, `optionalAuth`, `adminOnly`, permissions, limitation de débit, validation (zod).
- **Migrations** dans `src/migrations/` : de simples fichiers SQL numérotés, appliqués automatiquement au démarrage. Un changement de base est toujours un nouveau fichier, jamais la modification d'un ancien.

### nodyx-frontend : l'interface

- **SvelteKit 5 + Tailwind v4**, servi par l'adaptateur Node avec rendu côté serveur.
- Les pages sont d'abord rendues sur le serveur : un visiteur voit le contenu avant le chargement du JavaScript, et les moteurs de recherche indexent le forum.
- Pendant le rendu serveur, le frontend appelle le cœur directement sur le réseau local, sans repasser par Internet.
- **Les traductions** sont dans `src/lib/locales/*.json`. Le français est la langue source. Des contrôles de CI refusent les textes écrits en dur, les clés manquantes et les variables cassées.

## Les données

| Stockage | Ce qu'il contient |
|---|---|
| **PostgreSQL** | Tout ce qui dure : membres, forum, historique du chat, événements, sondages, wiki, réglages, journaux d'audit. |
| **Redis** | L'état de courte durée : sessions de connexion, présence en ligne, compteurs de limitation de débit, files de tâches. Toutes les clés portent le préfixe `nodyx:`. |
| **Disque local** | Les fichiers envoyés (avatars, images, audio), servis par l'instance elle-même. |

La recherche s'appuie sur les index plein texte de PostgreSQL. Il n'y a pas de moteur de recherche séparé à faire tourner.

## Comptes et sécurité

- **Connexion** : un jeton JWT, adossé à une session Redis (7 jours). Se déconnecter ou réinitialiser son mot de passe révoque la session côté serveur.
- **Double authentification** : codes TOTP (RFC 6238), calculés hors ligne dans n'importe quelle application d'authentification.
- **Nodyx Signet** : connexion sans mot de passe depuis un téléphone, avec une clé ECDSA P-256 qui ne quitte jamais l'appareil.
- **Les messages privés sont chiffrés de bout en bout** dans le navigateur (accord de clé ECDH P-256, AES-GCM). Le serveur ne stocke que du texte chiffré. Une sauvegarde facultative, verrouillée sur l'appareil par une phrase de récupération, permet de relire son historique sur un autre appareil.
- **Les données publiques passent par une liste blanche** : les fiches membres sortent par des fonctions dédiées, donc une nouvelle colonne en base ne fuit jamais par accident.

## La voix et la vidéo

```
   petit salon :  navigateur <------ WebRTC (direct, P2P) ------> navigateur
                            \                                    /
                             `-- nexus-turn (relais si bloqué) -'

   grand salon :  navigateur ----> nodyx-sfud (SFU) ----> tous les autres
```

- **Par défaut, les salons sont en pair à pair (mesh)** : l'audio et le partage d'écran vont directement d'un participant à l'autre. Le cœur ne relaie que la signalisation.
- **nexus-turn** (Rust, remplace coturn) relaie le flux quand deux participants ne peuvent pas se joindre directement.
- **nodyx-sfud** est un démon SFU facultatif (mediasoup aujourd'hui, derrière une interface de moteur prévue pour passer à un moteur 100 % Rust). Quand il est activé, un salon passe du mesh au SFU dès qu'il atteint un seuil de participants, et y reste jusqu'à ce qu'il se vide. La bascule se fait sans coupure : le mesh reste debout tant que tous les participants ne sont pas prêts sur le SFU.
- La chaîne audio (suppression du bruit, noise gate, égaliseur « broadcast ») tourne dans le navigateur, avant tout envoi.

## Fonctionner sans ouvrir de port

Une communauté ne devrait pas avoir besoin d'une adresse IP publique ni d'un port ouvert sur sa box. **nexus-relay** (Rust) fournit un tunnel : l'instance se connecte vers l'extérieur à un relais, et le relais lui ramène les visiteurs par un sous-domaine du type `votre-communaute.nodyx.org`. Le tunnel passe par un port dédié ou par du HTTPS ordinaire (WebSocket sur le 443), donc il fonctionne aussi depuis les réseaux qui ne laissent passer que le web.

## Le réseau

Les instances restent indépendantes et choisissent ce qu'elles partagent :

- **Annuaire** (nodyx-hub) : une instance peut s'y inscrire pour que d'autres la trouvent.
- **Découverte globale** : avec `NODYX_GLOBAL_INDEXING=true`, une instance partage ses sujets et événements publics avec la recherche réseau de `/discover`.
- **Gossip** (nodyx-gossip, Rust) : découverte des pairs sans serveur central. En développement.

## Étendre une instance

- **Widgets** : des blocs pour l'éditeur de page d'accueil, installés à partir d'un paquet zip.
- **Extensions** : elles tournent dans une iframe isolée et ne reçoivent que les permissions accordées par l'administrateur à l'installation.
- **Boutique d'extensions** : [extensions.nodyx.org](https://extensions.nodyx.org) liste les paquets publiés.

## Le dépôt

| Dossier | Rôle |
|---|---|
| `nodyx-core/` | L'API (TypeScript). |
| `nodyx-frontend/` | L'interface (SvelteKit). |
| `nodyx-p2p/` | L'espace de travail Rust : `nexus-relay` (tunnel), `nexus-turn` (TURN), `nodyx-sfu` (SFU), `nodyx-gossip` (découverte), `nodyx-server` (un portage de l'API en Axum, en cours, qui ne sert pas encore de trafic). |
| `nodyx-authenticator/` | Nodyx Signet, l'application téléphone pour la connexion sans mot de passe. |
| `nodyx-hub/` | L'annuaire des instances. |
| `nodyx-store/` | La boutique d'extensions. |
| `nodyx-docs/` | Ce site de documentation, [nodyx.dev](https://nodyx.dev). |
| `nodyx-landing/` | Le site de présentation, [start.nodyx.org](https://start.nodyx.org). |
| `docs/` | Les pages de documentation, en plusieurs langues. |
| `scripts/` | Scripts d'installation, de mise à jour et d'exploitation, avec leurs tests. |

## L'installer soi-même

`install.sh` (serveur classique) et `install_tunnel.sh` (sans port ouvert, via le relais) mettent en place PostgreSQL, Redis, Caddy, PM2 et les services Rust, puis construisent les applications. Les mises à jour passent par les mêmes scripts : la nouvelle version se construit à côté de celle qui tourne, et la bascule n'a lieu qu'une fois que tout a réussi. Voir le [guide d'installation](./INSTALL.md).
