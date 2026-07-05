# CDC — `nodyx-sfu` : moteur vocal & partage d'écran scalable

> **Statut** : proposition / à valider (Jonathan)
> **Auteur** : session Claude + Jonathan, 2026-07-02
> **Portée** : Phase 3 (Rust), brique média du réseau Nodyx
> **Objectif** : que Nodyx **ne pâlisse pas face à Discord** sur le vocal + partage d'écran, et fasse **mieux** là où ça compte (self-hosted, souverain, fédéré, zéro analytics).

---

## 1. Contexte & déclencheur

Le vocal actuel est un **mesh full-P2P** : chaque participant ouvre une `RTCPeerConnection` vers **chaque** autre (`voice:offer/answer/ice`, une PC par pair), `nexus-turn` (STUN/TURN maison, Rust) pour la traversée NAT, sièges limités (`VOICE_MAX_SEATS`), chaîne audio locale (gain / EQ / noise-gate via AudioContext), stats par pair (`PeerStats` : ping, jitter, perte).

**Excellent à 2-3. Structurellement impossible au-delà**, surtout avec partage d'écran.

### Le mur mathématique
À N participants, chacun **uploade son flux (N-1) fois**.
- **Voix** (Opus ~40 kbps) à 15 : 14 × 40 = ~560 kbps upload/pers → tendu mais parfois OK.
- **Partage d'écran** (~3 Mbps) à 15 : **14 × 3 = ~42 Mbps upload pour UNE personne**. Aucune connexion résidentielle ne tient. → écran noir, freeze, "rave party".

Ce n'est pas un défaut de réglage, c'est le mesh. **Le cas "15+ en watch-party sur un partage d'écran" = le quotidien d'un streamer** (cf. instance `sleemstudio`). Donc c'est un besoin **de fondation**, pas un confort.

### La réponse
Un **SFU** (Selective Forwarding Unit) : chaque participant envoie **UN** flux au serveur, qui **redistribue** aux autres. Upload constant quel que soit N. Celui qui partage : ~3 Mbps up ; l'égress serveur (~42 Mbps) est trivial sur un VPS. → ça marche, et ça débloque le **simulcast** (plusieurs qualités) et l'**adaptation** par abonné.

---

## 2. Principes directeurs (ADN Nodyx)

1. **Hybride, pas SFU partout.** ≤ seuil → **mesh P2P** (latence minimale, zéro serveur, P2P pur). Au-delà (ou dès qu'un partage d'écran démarre) → **SFU**. On garde le meilleur des deux.
2. **On possède le cerveau + le produit, pas le moteur média.** Comme la crypto (`ed25519-dalek` : "la courbe ne se code pas à la main"), le moteur média (RTP/SRTP, simulcast/SVC, congestion control) ne se hand-roll pas. On s'appuie sur **mediasoup** (worker C++ éprouvé, **API Rust**, licence ISC — cf §15) ; on **écrit en Rust** le signaling, l'orchestration Router/Transport, l'hybride mesh↔SFU, la fédération. Zéro-dep ≠ réinventer 10 ans d'ingénierie codec.
3. **Rust, dans `nodyx-p2p`.** `nodyx-sfu` = un crate à côté de `nexus-turn`, `nodyx-relay`, `nodyx-gossip`. Aligné Phase 3.
4. **Node-addressable dès le jour 1.** Chaque SFU est un **nœud** identifié (clé Ed25519, comme le `node_id` du gossip). Prérequis pour le **relais inter-SFU** futur.
5. **Self-hosted & souverain.** Le SFU tourne sur le VPS de l'instance (comme le relay/TURN). Une instance = son SFU. Zéro service tiers, zéro analytics.
6. **Dégradation gracieuse.** Panne SFU → repli mesh (petits salons) ou message clair. Jamais de salon "cassé" silencieusement.

---

## 3. Architecture cible

```
                 ┌───────────────────────────────────────────┐
   Client A ─────┤  signaling (WS via nodyx-core / socket.io) ├──── Client B, C, …
                 └───────────────────────────────────────────┘
                                    │  (négocie mesh OU SFU)
             ┌──────────────────────┴───────────────────────┐
        MESH (≤ seuil)                                   SFU (> seuil / screenshare)
   A ⇄ B ⇄ C (PC directes)                        ┌──────────── nodyx-sfu (Rust) ───────────┐
                                                  │  ingest (1 PC/pers, DTLS-SRTP)          │
                                                  │  router/forwarder (RTP par abonné)      │
                                                  │  simulcast/SVC layer selection          │
                                                  │  bandwidth estimation (transport-cc)    │
                                                  │  node identity (Ed25519) + WG-ready      │
                                                  └─────────────────────────────────────────┘
```

### Composants `nodyx-sfu`
- **Signaling adapter** : n'invente pas un serveur WS de plus. Réutilise le canal socket.io existant (`nodyx-core`) pour l'échange SDP/ICE avec le SFU (le SFU expose une API interne ; `nodyx-core` relaie). Un seul plan de signaling, cohérent avec le mesh.
- **Ingest** : une `PeerConnection` serveur par participant (DTLS-SRTP), reçoit ses tracks (audio + éventuel screenshare).
- **Router / Forwarder** : pour chaque abonné, forwarde les RTP des autres. Réécriture SSRC/seqnum/timestamp, gestion des key-frames (PLI/FIR à la demande sur (re)subscribe).
- **Simulcast / SVC** : le partage d'écran (et la cam future) monte en **plusieurs couches** ; le SFU choisit la couche par abonné selon sa bande passante estimée.
- **Bandwidth estimation** : transport-wide congestion control (transport-cc) + REMB ; pilote la sélection de couche et le pacing.
- **Node identity** : clé Ed25519 (réutilise l'appro `nodyx-gossip`) → adressable pour le relais inter-nœuds.

---

## 4. Protocole de signaling & bascule mesh↔SFU

- **Démarrage** : salon vide/petit → **mesh** (comme aujourd'hui).
- **Bascule vers SFU** quand : `participants > SEUIL` (défaut **4**, configurable) **OU** un partage d'écran démarre (quel que soit N ≥ 3).
- **Migration** : le serveur annonce `voice:mode=sfu` ; chaque client (a) établit **une** PC vers le SFU, (b) republie ses tracks, (c) ferme ses PC mesh une fois l'audio SFU confirmé (overlap bref pour **zéro coupure**).
- **Bascule retour** (SFU→mesh) quand on repasse sous le seuil ET plus de screenshare : optionnel (v2). En v1 on peut **rester en SFU** une fois basculé (plus simple, coût serveur négligeable).
- **Signaling events** (extension des events voice existants) : `voice:mode`, `voice:sfu_offer/answer/ice`, `voice:subscribe/unsubscribe`, `voice:layer` (demande de qualité).

---

## 5. Média

- **Audio** : Opus, **DTX** (silence = quasi zéro trafic), FEC in-band, 48 kHz. Mixage **non** fait par le SFU (forwarding pur → chaque client mixe, comme Discord) pour garder le CPU serveur bas et la latence minimale.
- **Vidéo / partage d'écran** : VP8/VP9 en v1 (large support), **AV1 en option v2** (meilleure compression écran). **Simulcast** (ex. 3 couches : source / medium / low) OU **SVC** (VP9/AV1). Content hint `detail` (texte net) vs `motion` (jeu). Key-frame à chaque nouvel abonné.
- **Congestion** : transport-cc côté client + estimation serveur ; le SFU **descend la couche** avant que ça casse (pas après). Les `PeerStats` déjà collectés alimentent l'UI (indicateur qualité) et l'adaptation.
- **Pacing** : le SFU lisse l'envoi pour éviter les bursts.

---

## 6. Partage d'écran (le cas critique)

- Le partageur envoie **une** couche haute + 1-2 couches réduites (simulcast). Le SFU sert à chaque spectateur la couche adaptée à SA bande passante → un spectateur en 4G ne casse pas le flux des autres.
- Framerate adaptatif : contenu statique (slides, code) = fps bas + résolution haute ; jeu = fps haut + résolution modérée.
- **Objectif de tenue** : **1 partageur + 15+ spectateurs** fluide sur un VPS standard. Égress SFU ≈ Σ (couche servie par spectateur) — dimensionnable.

---

## 7. Scalabilité & perf

- **Cible v1** : un SFU mono-process tient **~50-100 participants audio** ou **1 screenshare + 15-30 spectateurs** sur un CPX (à mesurer/benchmarker — pas d'affirmation en l'air).
- **Limite d'un SFU** : CPU (forwarding + réécriture RTP) et égress réseau. Au-delà → **plusieurs SFU** (sharding par salon) puis **cascade** (§8).
- **Bench obligatoire** avant prod (cf. discipline OctoGuard : tests + bench + soak avant activation).

---

## 8. Node-addressing & fédération WireGuard (le futur qui justifie tout)

**WireGuard ≠ transport média utilisateur** (c'est le transport **nœud↔nœud** de la fédération, cf. `feedback_couche_transitoire_focus_3_0`). Mais l'SFU node-addressable + WireGuard = **vocal fédéré** :

- Un salon peut **s'étendre sur plusieurs instances**. Chaque instance a **son** SFU qui gère **ses** membres locaux.
- Les SFU se **relaient** entre eux (cascade / "piping", façon Jitsi Octo ou mediasoup pipe) **via tunnels WireGuard** : l'SFU de sleemstudio n'envoie qu'**un** flux du partageur à l'SFU de nodyx.org, qui le redistribue à ses locaux.
- Résultat : un **watch-party cross-instance** (sleemstudio ↔ nodyx.org) sans qu'aucune instance ne relaie tout le monde. Discord ne sait pas faire ça (centralisé). **C'est là qu'on fait mieux.**

Prérequis à intégrer **dès la v1** : identité de nœud (Ed25519), API de subscribe inter-SFU, et un modèle de salon qui sait qu'un participant est "local" ou "distant".

---

## 9. Sécurité

- **DTLS-SRTP** (chiffrement du transport média, standard WebRTC) obligatoire.
- **Admission** : le SFU ne laisse entrer qu'un participant authentifié par `nodyx-core` (jeton court, comme les creds TURN dynamiques déjà en place). Respect des sièges + permissions de canal.
- **Anti-abus** : limites de bitrate montant par participant, cap de screenshare, éviction (kick) déjà existante à propager côté SFU.
- **Souveraineté** : le média transite par l'SFU de l'instance (self-hosted). Pour le cross-instance, chiffré de bout en bout du transport via WireGuard entre nœuds. Pas de tiers.
- **Note E2E** : un SFU forwarde des flux déchiffrés au niveau transport (il voit le média, comme tout SFU). Un vrai **E2EE média** (insertable streams / SFrame) est un chantier séparé, v3+ (Discord ne le fait pas non plus en vocal de groupe). À documenter comme limite assumée.

---

## 10. Observabilité

- Métriques par participant (bitrate, perte, jitter, RTT, couche servie) → l'UI qualité existante (`PeerStats`) + un dashboard admin.
- Logs SFU structurés, compteurs Prometheus-friendly (sans analytics utilisateur).

---

## 11. Phasage (réaliste)

> Stratégie **« B en anticipant A »** (§18) : livrer avec **mediasoup derrière le trait `MediaEngine`**, et faire mûrir un moteur **Rust natif** en parallèle pour swapper plus tard sans réécrire le produit.

- **P0 — Quick wins mesh (maintenant, jours)** : Opus DTX, cap de bitrate montant, partage d'écran bridé (fps/résolution) + adaptation via `PeerStats`. Tenir proprement les salons ≤4. **Aucun SFU requis.**
- **Spike — validation mediasoup (2-3 j)** : `examples/`, prototype salon à 2 **derrière le trait**, bench perf, **confirmer PipeTransport distant**. Gate avant P1.
- **P1 — SFU MVP audio (`MediasoupEngine` via le trait)** : create_room/transport/produce/consume audio, bascule mesh→SFU au seuil, signaling via nodyx-core. Cible : 15-30 en vocal fluide. Bench.
- **P2 — SFU vidéo / partage d'écran** : produce/consume vidéo, key-frames, cap bitrate. Cible : 1 screenshare + 15+ spectateurs. **Le livrable qui "bat Discord" pour Lapersonne.**
- **P3 — Simulcast + adaptation** : couches multiples (mediasoup les gère), sélection par abonné, congestion control fin.
- **P4 — Fédération** : cascade inter-SFU (PipeTransport) sur WireGuard, salons cross-instance.
- **P5 (option lointaine)** : E2EE média (SFrame).
- **Track R&D parallèle — `NativeRustEngine`** (webrtc-rs/rsfu) : implémente le **même trait**, testé contre **la même suite**. Swap quand il passe tests+bench+soak → **full-Rust, déploiement simplifié** (plus de worker C++). Sans deadline subie.

Chaque phase : **CDC ne se code pas sans validation Jonathan**, tests Vitest/Rust dans la même session que le code critique, bench avant prod.

---

## 12. Face à Discord — où on est à parité, où on fait mieux

| | Discord | Nodyx (cible SFU) |
|---|---|---|
| Vocal groupe + screenshare scalable | ✅ (SFU centralisé) | ✅ (SFU self-hosted hybride) |
| Watch-party 15+ | ✅ | ✅ |
| **Self-hosted / souverain** | ❌ | ✅ |
| **Zéro analytics / zéro tracking** | ❌ | ✅ |
| **Fédéré (salon cross-instance)** | ❌ | ✅ (via cascade WireGuard) |
| **On possède la stack (Rust)** | ❌ | ✅ |
| E2EE média | ❌ | 🔶 (v5, honnête sur la limite) |

**La thèse** : on atteint la parité fonctionnelle, et on gagne sur la **souveraineté + la fédération** — précisément l'ADN Nodyx ("on a créé internet pour rassembler, pas diviser").

---

## 13. Risques & décisions ouvertes

- **Ampleur** : un SFU est un chantier comparable au P2P Rust. À découper strictement par phase, ne pas tout viser d'un coup.
- **webrtc-rs maturité** : ~~à auditer~~ **AUDITÉ + TRANCHÉ → voir §15.** Résumé : le crate `webrtc` (transport ICE/DTLS/SRTP/RTP) est utilisable ; le SFU de référence `webrtc-rs/sfu` est trop jeune (v0.0.3) → on ne s'appuie PAS dessus comme turnkey, on s'en inspire (Sans-IO). Plan A Rust étagé + Plan B (LiveKit self-hosted) gardé au gate P2→P3.
- **Seuil mesh↔SFU** : 4 par défaut, à régler au bench.
- **Rester-en-SFU vs re-bascule** : v1 = rester en SFU une fois basculé (simple).
- **Coût VPS** : égress SFU à dimensionner selon la taille des instances.

---

## 14. Critères d'acceptation (Definition of Done, P2)

1. 1 partageur d'écran + **15 spectateurs**, fluide, sur un VPS standard, upload partageur ≤ 4 Mbps.
2. Bascule mesh→SFU **sans coupure audio** perceptible.
3. Un spectateur à faible bande passante **ne dégrade pas** les autres (simulcast).
4. Repli gracieux si SFU indisponible.
5. Bench + soak documentés ; aucun leak mémoire Rust ; clippy clean.
6. Zéro dépendance non justifiée (mediasoup/ISC = justifiée, comme dalek ; notice de copyright conservée dans `NOTICE`).

---

## 15. Décision média (**mediasoup**, swap-ready) — **tranchée**

**Recherche (2026-07-02)** :
- Le crate **`webrtc`** (webrtc-rs) implémente le protocole WebRTC en Rust (ICE, DTLS, SRTP, RTP/RTCP). Utilisable comme **couche transport/primitives**.
- Le SFU de référence **`webrtc-rs/sfu`** est **early** (v0.0.3, mars 2024, ~69★, activité rare) → **on ne construit PAS dessus** comme base prod, mais son design **Sans-IO** est une bonne source d'inspiration. `rsfu` (port de ion-sfu) prouve aussi la faisabilité.
- **Constat** : un SFU from-scratch en Rust = **vrai chantier** (simulcast, congestion control, perf), risque concentré sur le simulcast spatial.
- **MAIS (découverte Jonathan, 2026-07-02)** : le crate officiel **`mediasoup`** a une **API Rust de première classe** (versatica). Ça change la donne.

### DÉCISION : **mediasoup (crate Rust)** — validée (Jonathan, 2026-07-02)

> **Stratégie : « B en anticipant A ».** On **livre** avec mediasoup **maintenant**, mais **derrière une abstraction moteur** (`trait MediaEngine`, §18) : tout le contrôle Rust (signaling, salons, hybride, fédération) tape sur l'interface, **jamais** sur mediasoup en direct. Objectif full-Rust **conservé** : le jour où un moteur Rust natif (webrtc-rs/rsfu) est mûr, on réécrit **l'adaptateur moteur**, pas le produit. Cf §18.

**Ce que c'est** : le **même moteur média que mediasoup standard** (worker **C++** éprouvé, des années de prod) piloté par une **API Rust de contrôle** (Router / WebRtcTransport / Producer / Consumer). Simulcast **ET** SVC **inclus**, congestion control mûr, **activement maintenu**.

**Licence — vérifiée : ISC** (permissive, type MIT/BSD). Autorise usage commercial, self-hosted, modification, redistribution. **GPL/AGPL-compatible** → intégrable dans Nodyx (AGPL-3.0) sans souci. **Seule obligation : conserver la notice de copyright** (une ligne mediasoup dans `NOTICE`/`licenses/`). Le worker C++ est un **sous-processus** (IPC), pas linké → aucun débat de linking. Zéro lock-in.

**Point clé — "low-level = un avantage"** : le crate **ne fournit PAS de signaling**, et c'est **exactement ce qu'on veut** : on a déjà le nôtre (nodyx-core + socket.io, §17). On branche notre plan de signaling sur mediasoup au lieu d'en subir un imposé.

**Pourquoi c'est LE choix (meilleur des deux mondes)** :
1. **Fiabilité mediasoup** : le risque dur (simulcast/SVC prod) **disparaît**. On ne réinvente pas le moteur média — sagesse `ed25519-dalek` appliquée au média (le worker C++ = l'exception **bornée**, comme la courbe elliptique).
2. **Cohérence stack Rust** : contrôle piloté en **Rust** → rejoint `nodyx-p2p` (gossip/turn/relay déjà Rust), Phase 3. Un pas vers le **full-Rust** visé. (LiveKit-Go ne collerait pas à cette cohérence.)
3. **Fédération** : le **PipeTransport** relie des Routers entre eux → **base de la cascade inter-SFU** cross-instance (piper les routers via tunnels WireGuard).
4. Perf attendue = celle de la version TS (même cœur C++).

**Ce qu'on écrit nous-mêmes, en Rust (le cœur produit + la souveraineté)** :
- Cycle de vie **Worker / Router / WebRtcTransport** par salon, fermeture propre des ressources (le **`Drop` de Rust** nous couvre).
- **Câblage** des events SFU ↔ notre système de **salons** existant.
- Le **signaling** (§17), l'**admission / seats / permissions**, la **bascule hybride mesh↔SFU**, l'**adaptation UI** (via PeerStats), l'**orchestration des PipeTransport** sur WireGuard (fédération).

**Avant engagement — spike obligatoire (2-3 j)** : (1) lire les `examples/` du dépôt ; (2) **prototype salon à 2** (Worker→Router→Transport→Producer/Consumer audio) dans notre env ; (3) **bench perf** (≈ TS attendu) + **confirmer le PipeTransport vers un host distant** (le point à valider pour la fédération).

**Plan B conservé** (si l'intégration déçoit, improbable) : hand-roll Rust sur le crate `webrtc` (étagé P1 audio→P2 vidéo→P3), ou LiveKit (Go, self-hosted).

---

## 16. Modèle de données (SFU)

```
Room            { id, community_id, channel_id, mode: mesh|sfu, participants[] }
Participant     { id, user_id, node_id (local|remote), seat, publications[], subscriptions[] }
Publication     { id, kind: audio|screen|cam, ssrc, layers[]: {rid, bitrate, fps} }
Subscription    { participant_id, publication_id, current_layer, target_bitrate }
NodeLink        { peer_node_id, wg_endpoint, relayed_publications[] }   // fédération (P4)
```

- Un **participant local** publie/souscrit directement à l'SFU de son instance.
- Un **participant distant** (autre instance) apparaît via un `NodeLink` : l'SFU distant lui relaie **une** copie du flux, notre SFU le re-distribue en local (cascade).
- Le `seat` reste géré comme aujourd'hui (`VOICE_MAX_SEATS`), l'SFU refuse au-delà.

---

## 17. Signaling — séquences concrètes

Réutilise le canal socket.io de `nodyx-core` (un seul plan de signaling, mesh ET SFU). Events (extension des `voice:*` existants) :

**A. Rejoindre (salon déjà en SFU)**
```
client → server : voice:join {channelId}
server → client : voice:mode {sfu, sfuNodeId}
client → server : voice:sfu_offer {sdp}          # PC unique vers l'SFU (publie ses tracks)
server → client : voice:sfu_answer {sdp}
client ⇄ server : voice:sfu_ice {candidate}
server → client : voice:publications {list}       # ce qui est publié dans le salon
client → server : voice:subscribe {publicationIds}
server → client : voice:sfu_offer {sdp}          # renégocie pour ajouter les tracks souscrits
```

**B. Bascule mesh → SFU (seuil franchi / screenshare démarre)**
```
server → all    : voice:mode {sfu}               # annonce la bascule
each client     : établit sa PC SFU + republie (comme A), MAIS
                  garde ses PC mesh actives jusqu'à voice:sfu_ready
server → client : voice:sfu_ready                 # audio SFU confirmé
each client     : ferme ses PC mesh               # overlap bref => ZÉRO coupure
```

**C. Adaptation de qualité (P3)**
```
server → client : voice:layer {publicationId, layer}   # l'SFU a baissé/monté la couche servie
client → server : voice:prefer {publicationId, max}    # l'user force une qualité (ex: cap data)
```

**D. Départ / plus de screenshare**
```
client → server : voice:leave {channelId}         # ferme la PC SFU, libère le seat
# (re-bascule SFU→mesh sous le seuil = optionnel v2 ; v1 reste en SFU)
```

Règle d'or : **overlap avant fermeture** à chaque transition (mesh↔SFU, resubscribe) pour ne jamais couper l'audio.

---

## 18. Abstraction moteur média (**swap-ready** — « B en anticipant A »)

**But** : livrer avec mediasoup **sans jamais s'y coupler**, pour pouvoir basculer vers un moteur **Rust natif** (webrtc-rs/rsfu) le jour où il est mûr, **sans réécrire le produit**. C'est ce qui rend l'objectif full-Rust atteignable **sans prendre le produit en otage**.

### Trois étages (séparation hexagonale — ports & adapters)

L'abstraction ne s'arrête pas au trait moteur. On distingue **trois responsabilités**, empilées, pour que les **règles métier de Nodyx ne se retrouvent jamais noyées dans du code mediasoup** :

```text
VoiceService     ← MÉTIER Nodyx : salons, sièges (VOICE_MAX_SEATS), permissions,
      │            kick, join/leave, bascule hybride mesh↔SFU, orchestration
      │            fédération. Ne connaît du média QUE le trait ci-dessous.
      ▼
MediaEngine      ← LE PORT : transport pur (create_room / transport / produce /
      │            consume / set_preferred_layer / pipe_to_remote / stats / close).
      ▼
MediasoupEngine  ← L'ADAPTATEUR : l'impl technique, isolée. (Demain : NativeRustEngine.)
```

- **`VoiceService`** porte la logique fonctionnelle. Il est **générique sur le moteur** (`VoiceService<E: MediaEngine>`) : testé contre `NullEngine` (orchestration prouvée **sans** mediasoup), branché sur `MediasoupEngine` en prod.
- **`MediaEngine`** ne s'occupe **que** du transport audio/vidéo. Aucune règle Nodyx dedans.
- **`MediasoupEngine`** n'est **qu'une** implémentation technique du port.

Bénéfice concret du découplage : le jour du swap full-Rust, **`VoiceService` ne bouge pas d'une ligne** — on ne réécrit que l'adaptateur. Et si Nodyx évolue au-delà d'un simple moteur vocal (métier plus riche : modération, présence, seats dynamiques…), ça vit dans `VoiceService`, hors du code média.

> **État (2026-07-05)** : `VoiceService` + le trait `MediaEngine` + `NullEngine` sont **livrés** (crate `nodyx-p2p/crates/nodyx-sfu`, zéro-dep, zéro-`unsafe`, 23 tests verts). **SPIKE MEDIASOUP : VERT** (crate `nodyx-sfu-mediasoup`, hors workspace pour épargner la CI) : le MÊME `VoiceService`, inchangé d'une ligne, a piloté le vrai worker mediasoup derrière le trait (join ×5, bascule mesh→SFU au seuil, Producer/Consumer audio Opus réels), ET la primitive de fédération fonctionne (pipe du producer vers un worker dédié "nœud distant" + consume côté distant). Enseignements gravés dans l'adaptateur : le pipe relie des workers DIFFÉRENTS ; le producer pipé garde l'UUID de l'original (clé de registre distincte sinon fermeture en cascade au Drop) ; conversion `RtpCapabilitiesFinalized`→`RtpCapabilities` = le germe du `CodecAdapter`. **Gate P1 : OUVERT.** Reste : câblage signaling (§17), `WebRtcTransport` (le spike utilise des transports Direct), bench, et pipe vers un host réellement distant (gate P4).

### Le trait (contrat unique entre le contrôle et le moteur)

```rust
/// Tout le contrôle Rust (signaling, salons, hybride, fédération) parle À ÇA,
/// jamais à mediasoup directement.
trait MediaEngine {
    async fn create_room(&self, room: RoomId) -> RouterHandle;
    async fn create_transport(&self, r: &RouterHandle, p: ParticipantId) -> TransportHandle;
    async fn produce(&self, t: &TransportHandle, track: TrackKind) -> ProducerId;
    async fn consume(&self, t: &TransportHandle, prod: ProducerId) -> ConsumerId;
    async fn set_preferred_layer(&self, c: &ConsumerId, layer: Layer);
    async fn pipe_to_remote(&self, prod: ProducerId, node: NodeId) -> PipeHandle; // fédération
    async fn stats(&self, scope: StatsScope) -> EngineStats;
    // close = géré par Drop (RAII Rust)
}
```

- **Aujourd'hui** : `struct MediasoupEngine` implémente le trait (pilote le worker C++ via l'API Rust).
- **Demain** : `struct NativeRustEngine` (webrtc-rs/rsfu) implémente **le même trait**.
- **Swap** = changer **l'injection** (`Box<dyn MediaEngine>`). Zéro changement dans le signaling, les salons, la fédération, le produit.

### Ce qui reste vs ce qui change au swap

| Reste (le gros, Rust, écrit **une fois**) | Change (uniquement l'adaptateur moteur) |
|---|---|
| signaling §17, modèle de données §16 | l'**implémentation du trait** (la partie média dure : RTP/SRTP, simulcast, congestion control) |
| bascule mesh↔SFU, admission/seats/permissions | mapping codecs / `RtpCapabilities` (léger, propre à chaque moteur) |
| adaptation UI (PeerStats), orchestration fédération | empaquetage/déploiement (cf ci-dessous) |
| **la suite de tests d'intégration** (au niveau du trait) | — (le nouveau moteur passe **la même** suite) |

### Honnêteté / points à surveiller

- L'abstraction n'est **pas 100 % étanche** : la négociation codecs/`RtpCapabilities` diffère un peu entre moteurs → un peu d'adaptation au swap. Mais **~90 % du code (le produit) ne bouge pas**.
  - **Mitigation (isoler la fuite)** : sortir la négociation codecs dans un **`CodecAdapter`** séparé (propre à chaque moteur), pas dilué dans le signaling. Au swap on remplace **deux choses connues et nommées** — l'impl `MediaEngine` **et** le `CodecAdapter` — et **rien d'autre**. La seule fuite de l'abstraction devient un point unique, testable isolément.
- Le swap est **« pas cher », pas « gratuit »** : on réimplémente le **moteur** (partie dure), pas le **cerveau**.
- **Le spike (§15) doit prototyper mediasoup DERRIÈRE le trait**, pas en direct → abstraction prouvée dès le jour 1, **et confirmer le PipeTransport vers un host distant** (non négociable : si la fédération ne passe pas par le pipe, il faut le savoir avant de s'engager).
- **Empaquetage (Jonathan)** : le worker C++ (`mediasoup-worker`) est un binaire à **livrer avec Nodyx** pour les auto-hébergeurs. Complexifie un peu le déploiement, mais **gérable** — même modèle que `nodyx-turn` / `nodyx-relay` (binaires déjà empaquetés). **Anticiper A = un argument de plus** : le jour du swap vers `NativeRustEngine`, ce binaire C++ **disparaît** → déploiement **simplifié** (un binaire Rust de moins à shipper).
- **Plan B (webrtc-rs pur / LiveKit)** : conservé (§15). S'il est activé, **ré-évaluer le phasage** (les cibles P1-P2 restent, les délais bougent).
- **E2EE média (§9)** : limite assumée, v5. Sujet réellement complexe (SFrame / insertable streams) — Discord lui-même n'est pas clair dessus. À ne pas sous-estimer le jour où on l'attaque.

### Track R&D parallèle (le chemin vers full-Rust)

Pendant que mediasoup tourne en prod (valeur livrée), un **track R&D `NativeRustEngine`** avance **en parallèle**, testé contre **la même suite** que l'adaptateur mediasoup. Quand il passe tests + bench + soak → **on swappe**. Full-Rust atteint, sans régression produit, sans deadline subie.
