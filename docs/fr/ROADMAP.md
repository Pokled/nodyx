# NODYX, Roadmap

> *"Un projet qui veut tout faire en même temps ne fait rien bien."*
> La roadmap Nodyx est construite sur une règle simple : chaque phase doit fonctionner
> parfaitement avant de passer à la suivante.

> Ce document donne l'état actuel et la direction. Pour le détail complet de chaque
> fonctionnalité livrée, ligne par ligne, c'est le
> [CHANGELOG](https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md) qui fait foi :
> lui seul est mis à jour à chaque version.

---

## ÉTAT ACTUEL, octobre 2026, v2.13.0 en approche

| Phase | Titre | État |
|---|---|---|
| **Phase 1** | Forum MVP + Admin | Complète |
| **Phase 2** | Chat temps réel + Annuaire + Identité réseau | Complète |
| **Phase 2.5** | Personnalisation communautaire + Fédération légère | Complète |
| **Phase 3** | Infrastructure P2P + Fondation Rust | En cours (voir 3.0-D) |
| **Phase 4** | Enrichissement de la plateforme | Complète |
| **Phase 4.5 à 4.16** | Durcissement sécurité, stabilité, tests, OctoGuard | Complètes |
| **Phase 4.17** | Streamer Hub, la chaîne complète pour les streamers | Complète |
| **Phase 4.18** | Vocal nouvelle génération : le SFU (audio + vidéo) | Complète |
| **Phase 4.19** | Nodyx parle huit langues | Complète (traduction continue) |
| **Phase 4.20** | Personnalisation avancée de l'instance | Complète |
| **Phase 4.21** | SDK d'extensions + marketplace | Complète (v1) |
| **Phase 4.22** | Activités communautaires en vocal | Complète (v1) |
| **Phase 4.23** | Vitrine musique + durcissement de la vitrine publique | Complète |
| **Phase 4.24** | Les ambiances et le contenant flottant | Complète |
| **Phase 4.25** | Installeur reconstruit, audit de sécurité | Complète |
| **Phase 4.26** | Stabilisation : chasser les bugs en usage réel | En cours |
| Phase 5 | Mobile + Nodes + Réputation | En cours |
| **Phase Horizon** | NODYX-ETHER, souveraineté de la couche physique | Vision |
| **Phase Radio** | NODYX-RADIO, tuner radio internet + régie coopérative | Vision |

Chaque ligne ci-dessous donne l'essentiel. Le détail (migrations, fichiers, bench, PR) vit dans
le CHANGELOG à la version indiquée.

---

## PHASE 1, MVP Forum + Admin (complète)

Une communauté peut s'installer, se configurer et vivre sur Nodyx en autonomie complète.

- Forum complet : catégories récursives, threads, posts, réactions, tags, recherche full-text,
  notifications, panneau admin
- SEO natif : rendu SSR, sitemap, RSS, JSON-LD, `llms.txt` pour les agents IA. Passe de
  durcissement SEO/GEO en v2.8 (sitemap, og:image, guides d'installation)
- Self-hosting en 15 minutes : `install.sh` (VPS), `install_tunnel.sh` (zéro port, Raspberry Pi),
  Docker, script Windows sans Docker, health check visuel post-install

**Critère de succès** : installer, configurer, créer du contenu, administrer et être indexé par
les moteurs de recherche, sans être développeur. Validé.

---

## PHASE 2, Chat temps réel + Annuaire + Identité réseau (complète)

Les membres communiquent en direct, l'annuaire est réel, chaque instance a son URL propre.

- Chat WebSocket (Socket.IO), canaux configurables, historique persisté
- `nodyx.org` Directory : enregistrement automatique, ping toutes les 5 minutes, page
  `/communities` réelle
- Identité réseau `slug.nodyx.org` : DNS wildcard, Caddy, zéro configuration admin
- Salons vocaux, couche réseau : coturn puis `nexus-turn` (Rust), signalisation WebRTC

---

## PHASE 2.5, Personnalisation communautaire + Fédération légère (complète)

Chaque instance devient unique, et les instances peuvent partager leurs créations.

- Bibliothèque d'assets (cadres, bannières, badges), Jardin (propositions + vote par graines)
- Fédération d'assets entre instances, Chuchotements (salons éphémères), URLs cliquables

---

## PHASE 3, Infrastructure P2P + Fondation Rust (en cours)

> *"Le P2P est l'âme. Rust est le corps."*
> Rust vient en dessous, invisible pour l'utilisateur, pour le réseau bas niveau,
> le chiffrement, WireGuard, le DHT. Communication avec `nodyx-core` par socket Unix local.

### 3.0-A, `nodyx-relay-client` (validée, mars 2026)
Remplace `install_tunnel.sh` + Cloudflare Tunnel. Zéro domaine, zéro port ouvert, testé sur
Raspberry Pi. Binaire Rust statique, reconnexion automatique, intégré à `install.sh`.

### 3.0-B, Browser P2P Nodes (WebRTC DataChannels) (livrée, mars 2026)
Les navigateurs deviennent des nœuds actifs : mesh 1-N, indicateurs de frappe P2P, réactions
optimistes, transfert d'assets entre pairs par chunks. Réutilise le signaling existant de
`voice.ts`, zéro nouvelle infrastructure serveur.

### 3.0-C, `nodyx-turn` (remplace coturn) (validée, mars 2026)
Serveur STUN/TURN en Rust, 2.9 Mo, zéro dépendance. TURN-over-TCP (RFC 6062), credentials
dynamiques HMAC, rate limiting, quotas d'allocation. Fix de fond en v2.9 : plage de ports relais
propre au serveur, indépendante du kernel (le vocal était intermittent pour une partie des
auto-hébergés avant ce correctif).

### 3.0-D, `nodyx-p2p` core, vision long terme (démarrée)
Le cœur distribué : DHT, WireGuard mesh, gossip, CRDTs, réplication, résilience sans serveur
central.
- [x] **`nodyx-gossip`** (v2.9) : découverte de pairs par anti-entropie épidémique, bibliothèque
  standard uniquement, records signés Ed25519 (anti-spoofing, anti-rejeu)
- [ ] DHT Kademlia, WireGuard mesh chiffré, API IPC exposée à `nodyx-core`, réplication facteur 3

### 3.1, Salons vocaux, interface et modes avancés
- [x] VoicePanel sidebar, panneau d'interaction membre (RTT/jitter/perte), self-monitoring
- [ ] Mode Amphithéâtre (diffusion 1→N), Nodes-as-a-Service

### v1.0, Table Collaborative (planifiée)
Le salon vocal devient un espace de vie : jeux, fichiers, musique partagée, dans la même
fenêtre. Fondation P2P DataChannels déjà opérationnelle (v0.9). Reste à construire : table SVG,
protocole `table:*`, jukebox collaboratif, jeux (dés, échecs, poker), système de plugins
`plugins/table-templates/`. Détail complet conservé dans l'historique de ce fichier sur
`git log -- docs/fr/ROADMAP.md`, rien de nouveau livré ici depuis la dernière version.

### 3.2, Réseau maillé inter-instances
- [ ] WireGuard mesh, DHT de secours, fédération légère entre communautés

---

## PHASE 4, Enrichissement de la plateforme (complète)

Nodyx devient la plateforme communautaire complète : NodyxCanvas (tableau blanc P2P), thèmes de
profil, UI responsive mobile, réponses/citations et messages épinglés dans le chat, DMs
chiffrés bout-en-bout, sondages, système de ban multi-couches, calendrier d'événements, Gossip
Protocol pour la recherche et la découverte cross-instances, dashboard admin enrichi, annonces
système, journal de modération, tâches façon Kanban.

Détail ligne par ligne dans le CHANGELOG, versions 1.1 à 1.8.

---

## PHASE 4.5, Durcissement sécurité (complète, mars 2026)
Injection SQL, JWT, SSRF/DNS rebinding, IDOR Socket.IO, injection CSS/XSS, rate limiting auth,
validation crypto. Premier audit sécurité complet du projet, avant l'ouverture de la Phase 5.

## PHASE 4.6, Défense active et sécurité runtime (complète)
Honeypot (25+ chemins piégés, tarpit, fingerprinting, honeytokens), fail2ban (5 jails), liste
noire permanente, Argon2id, anti-spam chat, filtre de contenu, scan NSFW optionnel, Olympus Hub
(centre de commandement sécurité).

## PHASE 4.7, Double authentification (2FA) (complète)
TOTP (RFC 6238) et Nodyx Signet comme second facteur, priorité Signet > TOTP > connexion directe.

## PHASE 4.8, Stabilité production et cohérence cross-runtime (complète)
Audit chirurgical Node.js/Rust/Caddy/PM2/systemd : keyPrefix Redis unifié, bans et rate limiting
cohérents entre les deux runtimes, invalidation de session au changement de mot de passe,
failover Caddy automatique si le service Rust tombe.

## PHASE 4.9, Isolation processus, couverture de tests et CI (complète)
Tous les processus sous l'utilisateur système `nodyx` (plus aucun root sauf systemd), permissions
fichiers durcies, premiers tests Rust, dépendances critiques épinglées, pipeline CI à deux jobs
parallèles.

## PHASE 4.10 à 4.15 (complètes)
Profil vivant et refonte forum (v1.9.5), DM chiffrés bout-en-bout (v2.0), Homepage Builder et
Widget SDK v1 (v2.1), NodyxCanvas mise à jour majeure (v2.2), lecteur multimédia universel et
hardening tunnel (v2.3), système de sauvegarde et mode maintenance live (v2.4).

## PHASE 4.16, OctoGuard Phase 1, auto-modération native (complète, v2.6)
> *"La liberté de l'admin n'est pas négociable. OctoGuard arrive désactivé, chaque règle est
> opt-in."*

Pipeline auto-mod fail-open sous 50 ms, protection ReDoS (moteur `re2`), 6 actions
(delete/warn/mute/kick/ban/report_only), flux de bienvenue, commandes personnalisées, mutes,
file de signalements, journal d'audit, webhook HMAC sortant, kill-switch. 69 tests, bench p95
mesuré à 0,2 ms.

Les phases 2 (XP/niveaux/leaderboard), 3 (modération forums, filtre NSFW local) et 4 (API Bot
externe, SDK Python) restent tracées séparément dans `docs/specs/016-Octoguard/`.

---

## PHASE 4.17, Streamer Hub, la chaîne complète pour les streamers (complète, v2.5 → v2.8)

Un pont bidirectionnel complet entre une instance Nodyx et Twitch, pensé pour qu'un streamer
n'ait plus besoin de jongler entre trois SaaS.

- **Chat unifié** : bridge temps réel Twitch ↔ Nodyx (EventSub + Helix, zéro IRC), emotes et
  badges natifs + BTTV/FFZ/7TV, vérifié en prod (277 messages reçus en session test)
- **Bot Chat** : timers récurrents, six commandes natives (`!nodyx`, `!uptime`, `!so`...),
  commandes custom avec cooldown configurable
- **Nodyx Deck** : Stream Deck tactile mobile-first, multi-pages, actions clip/VOD/chat/audio,
  éditeur WYSIWYG avec presets
- **Nodyx Soundboard** : bibliothèque audio avec extraction ID3, overlay OBS dédié, queue
  viewers publique avec anti-spam, commande chat `!nextsound` avec fuzzy matching
- **Playlists et scènes OBS** : playlists nommées pilotables depuis le Deck, compositeur visuel
  de scènes façon OBS

Spec complète et rapports de phase dans `docs/specs/015-streamer-hub/`.

---

## PHASE 4.18, Vocal nouvelle génération, le SFU (complète, v2.9 → v2.11)

Le mur mathématique du mesh P2P (15 spectateurs à 3 Mbps chacun = impossible sur une connexion
résidentielle) avait sa réponse écrite dans le CDC depuis longtemps. Elle est livrée.

- **`nodyx-sfu`** (Rust, zéro `unsafe`) : architecture hexagonale, `VoiceService` derrière un
  trait `MediaEngine` swap-ready, prouvée par 25 tests contre un moteur nul avant tout moteur réel
- **Audio en prod** (v2.10) : adaptateur mediasoup, daemon `nodyx-sfud` à jeton constant-time,
  bascule hybride mesh ↔ SFU automatique
- **Vidéo et partage d'écran** (v2.11) : un seul flux montant recopié serveur-side, La Scène
  (plein écran avec chat et fil de discussion dans les salons vocaux), équaliseur réel par
  personne, chemin TCP de secours pour l'ICE
- **Exploration en cours** : spike d'un moteur média 100 % Rust (`str0m`) pour lever le dernier
  verrou "zéro port ouvert" du SFU. Verdict du perçage NAT en attente d'un test sur box
  résidentielle réelle. Détail dans `SPECS/NODYX_MEDIA_ENGINE_RUST.md`

---

## PHASE 4.19, Nodyx parle huit langues (complète, traduction continue)

Le grand audit "plus rien en dur" est terminé : toute l'interface, publique et admin, passe par
des clés de traduction, avec cinq portes CI qui empêchent toute régression (dont une dédiée aux
fichiers `.ts`, angle mort découvert en cours de route).

- Huit langues au cœur de l'interface, anglais à parité totale (repli d'exécution avant le
  français), portugais brésilien première locale communautaire à 100 % (4567 clés)
- `nodyx.org/translate` : état des traductions calculé depuis les fichiers eux-mêmes, page qui
  ne peut pas mentir, met en avant tous les contributeurs
- Fusionner une traduction déploie désormais automatiquement (avant, elle pouvait rester
  invisible plusieurs jours)

---

## PHASE 4.20, Personnalisation avancée de l'instance (complète, v2.12)

Née d'un test grandeur nature : une vraie communauté multigaming a buté sur des éléments non
configurables dès son premier réflexe d'admin.

- Widget "En-tête" (Homepage Builder) : fond et logo positionnables et redimensionnables
  indépendamment, chaque élément affichable ou non, aucune valeur de repli piégeuse
- Fond d'image pour la sidebar des membres, visibilité par rôle, assombrissement et dézoom
  réglables
- Système de thème d'instance (v2.9) : l'owner impose sa base, chaque membre peut surcharger
  pour lui-même, ~800 couleurs tokenisées

---

## PHASE 4.21, SDK d'extensions et marketplace (complète, v1)

Nodyx peut être étendu par des tiers sans toucher au cœur. Couvre une bonne partie de l'objectif
"API publique documentée pour développeurs tiers" de la Phase 5.

- SDK pensé sécurité d'abord : surface isolée, pont hôte défini, stockage clé/valeur cloisonné
  par extension, identité projetée (jamais les vrais comptes), proxy réseau anti-SSRF à
  épinglage d'adresse, écran de permissions admin
- `extensions.nodyx.org` : vitrine, registre, index. Première extension réelle (`next-event`)
  comme preuve, tenue par des tests
- Surfaces d'extension intégrées à la homepage et au Homepage Builder

CDC complet dans `SPECS/NODYX_SDK_CDC.md`, `SPECS/NODYX_SDK_SECURITY.md`,
`SPECS/NODYX_SDK_REFERENCE.md`.

---

## PHASE 4.22, Activités communautaires en vocal (complète, v1)

Un salon vocal peut héberger une activité, un jeu joué à plusieurs pendant qu'on parle, sur le
modèle des extensions : bundle applicatif livré par l'instance, relais temps réel dédié, identité
Nodyx résolue côté hôte. Galerie façon Play Store, dock plein écran, stockage applicatif pour les
scores et l'état de partie.

Détail dans `SPECS/NODYX_ACTIVITIES_CDC.md`.

---

## PHASE 4.23, Vitrine musique et durcissement de la vitrine publique (complète)

**Vitrine musique** : module public `/musique` géré depuis `/admin/music`, né pour héberger une
bande originale de jeu vidéo et devenu générique (titre, sous-titre, bannière éditables).
Catégories réordonnables, upload en un geste avec scan anti-malware, attestation de licence PDF
générée à la volée par catégorie.

**Durcissement de la vitrine publique**, suite à l'incident du 1ᵉʳ septembre 2026 (un compte
membre standard avait fait remonter du spam en page d'accueil et dans l'annuaire fédéré, sans
aucune faille d'authentification) : catégories restreignables par rôle, vitrine et annuaire
limités aux fils explicitement mis en avant par un admin, message de ban IP qui dit la vérité
quand aucune adresse publique n'est connue. CDC complet dans
`SPECS/NODYX_DURCISSEMENT_VITRINE_CDC.md`.

En prolongement direct de cet incident, un audit sécurité systématique de tout ce qui tourne en
production a démarré mi-septembre, module par module : couche temps réel Socket.IO, complétude
des vérifications d'autorisation admin, et une faille XSS non authentifiée trouvée et corrigée
au passage sur le titre des fils de discussion. Toujours en cours au moment d'écrire ces lignes.

---

## PHASE 4.24, Les ambiances et le contenant flottant (complète, v2.13)

L'apparence d'une instance, réglée en profondeur par son admin, sans jamais écrire de CSS.

- Sur grand écran, le contenu flotte en plaques de verre sur le papier peint de l'instance
- Quatorze ambiances toutes prêtes (Matrix, Cyberpunk, Gazette, Océan…) avec de vraies photos sous
  licence libre, ou l'accent, les fonds, le décor et l'intensité choisis par l'admin
- Un contraste calculé, jamais deviné (au moins 4,5:1) ; un brouillon côté serveur que personne ne
  voit avant « Publier », annuler et rétablir, un code d'ambiance à partager
- Un stylo directement sur le site pour styler chaque zone (fond, flou, arrondis, image, police),
  avec des réglages bornés et revalidés par le cœur

---

## PHASE 4.25, Installeur reconstruit, audit de sécurité (complète, v2.13)

`install.sh` et `install_tunnel.sh` relus ligne à ligne, puis en grande partie reconstruits, à la
suite d'un signalement sur une Debian 13 minimale.

- Une mise à jour ne fait plus tomber le site : la nouvelle version se compile à côté, la bascule
  n'a lieu que si tout a réussi, la base est sauvegardée et vérifiée avant
- L'adresse réelle du visiteur parvient à Nodyx sur tous les types d'installation (limitation de
  débit et bannissements en dépendaient), le pare-feu ne peut plus enfermer l'administrateur dehors
- Programmes téléchargés vérifiés par SHA-256, plus aucun secret dans une ligne de commande ni en
  clair sur le disque
- Installation sans surveillance (`--yes`, `--network`, fichiers de mot de passe et de jeton),
  `nodyx-update`, `nodyx-doctor`, `nodyx-recover`, un `uninstall.sh` réécrit
- Un banc d'essai pour chaque chemin des installeurs, joué en CI

---

## PHASE 4.26, Stabilisation : chasser les bugs en usage réel (en cours)

Utiliser Nodyx chaque jour sur nodyx.org, et prendre les captures de cette documentation, a fait
remonter des bugs qu'aucun test n'avait vus. Chaque correctif arrive avec un test qui échoue sur
l'ancien code, et il est vérifié en direct après déploiement.

- Canvas : les cadres, les formes avancées et les connecteurs disparaissaient au rechargement
  depuis la 2.2
- Voix : un onglet fermé laissait un fantôme dans le salon ; quelqu'un qui arrivait pendant un
  partage d'écran ne le voyait jamais
- Une première visite chargeait chaque page deux fois ; forum et barre latérale écrasés sur écran
  de bureau
- Ensuite : faire fonctionner les grands salons vocaux depuis un serveur à la maison aussi (le
  moteur `str0m`, phase 4.18), pour qu'aucun administrateur de Nodyx n'ait jamais à ouvrir un port

---

## PHASE 5, Mobile et réputation (en cours)
### Nodyx dans la poche de tout le monde

- [ ] App iOS via Capacitor
- [ ] App Android via Capacitor
- [ ] Desktop via Tauri (.exe/.app/.sh ~10 Mo, autonome)
- [ ] NodyxPoints, système de réputation communautaire inter-instances
- [ ] Badges et niveaux
- [x] **API publique pour développeurs tiers** : largement couverte par le SDK d'extensions, voir
  Phase 4.21. Reste ouvert : une marketplace tierce au-delà de la première extension de preuve
- [ ] **Nodes**, connaissance structurée durable, validée via le Jardin, voir
  [SPEC 013](../en/specs/013-node/SPEC.md)
- [ ] **Galaxy Bar**, switcher multi-instances, SSO décentralisé, voir
  [SPEC 012](../en/specs/012-nodyx-galaxy-bar/SPEC.md)

---

## RÈGLES DE LA ROADMAP

1. On ne commence pas une phase sans que la précédente soit stable et utilisée
2. On ne casse pas ce qui marche, on propose des alternatives (ex : Relay vs CF Tunnel vs ports ouverts)
3. La complexité est cachée : l'utilisateur voit un bouton, la couche Rust gère la complexité
4. Chaque ajout doit être cohérent avec l'aspect décentralisé et souverain
5. Le core reste simple, la complexité va dans les plugins
6. La communauté peut voter pour reprioriser les phases futures

## CE QUI N'EST JAMAIS DANS LA ROADMAP

- Publicité, vente de données
- Fonctionnalité qui nécessite un serveur central obligatoire (`nodyx.org` est optionnel, sans
  lui l'instance reste pleinement fonctionnelle sur son propre domaine)
- Backdoor de quelque nature que ce soit
- Dépendance permanente à un service propriétaire tiers
- Remplacement de Node.js ou SvelteKit par Rust (chaque outil à sa place)

---

## PHASE HORIZON, NODYX-ETHER
### La couche physique. La dernière frontière.

> *"Les ondes radio n'ont pas besoin de permission."*

Nodyx décentralise la couche applicative. Mais nous dépendons encore d'une chose :
l'infrastructure physique d'internet, câbles en fibre et satellites contrôlés par des tiers.
NODYX-ETHER décentralise la couche physique elle-même, via les CRDTs déjà en production dans
NodyxCanvas : le même mécanisme qui synchronise un coup de pinceau peut synchroniser un post de
forum sur un lien LoRa à 250 bits/s, même avec deux heures de délai.

```
Couche 1, Mesh local        LoRa / Wi-Fi ad-hoc     0-50 km       sans infrastructure
Couche 2, Radio régionale   HF / NVIS               500-3000 km   rebond ionosphérique
Couche 3, Ionosphère        HF ondes courtes        Mondial       sans câble, sans satellite
```

Ce n'est pas une fonctionnalité pour demain, c'est un appel à contributeurs : radioamateurs,
makers LoRa, contributeurs Meshtastic, développeurs Rust embarqué. L'architecture est là, la
fondation CRDT est livrée, la couche radio attend les bonnes mains.

→ **[Spec complète : docs/ideas/NODYX-ETHER.md](https://github.com/Pokled/nodyx/blob/main/docs/ideas/NODYX-ETHER.md)**

---

## PHASE RADIO, NODYX-RADIO
### La radio internet qui a enfin une raison d'exister.

> *"50 000 opérateurs de radio internet qui émettent dans le vide. Nodyx est la réponse."*

Moins de 5 % des 100 000+ stations radio internet à leur apogée avaient plus de 10 auditeurs
simultanés, pas faute de programme, faute de structure pour transformer des auditeurs en
communauté. Une instance Nodyx EST cette couche communautaire : forum indexé, chat en direct
pendant l'émission, salons vocaux comme studio ouvert, Jardin pour voter les prochains
programmes.

La régie coopérative propose le modèle économique manquant : 200 stations Nodyx-Radio à 80
auditeurs chacune, ça fait 16 000 auditeurs locaux qu'un artisan ou un événement régional peut
financer. Ciblage géographique uniquement, zéro tracking, zéro profil utilisateur. L'argent
reste local, l'infrastructure reste libre.

→ **[Vision complète : docs/ideas/NODYX-RADIO.md](https://github.com/Pokled/nodyx/blob/main/docs/ideas/NODYX-RADIO.md)**

---

*Version 2.12.0, 17 septembre 2026.*
*"Le P2P est l'âme. Rust est le corps. La radio est la résilience. La communauté est la raison."*
