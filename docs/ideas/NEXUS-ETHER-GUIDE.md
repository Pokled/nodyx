# NEXUS-ETHER — Guide Pratique & Appel à Contributeurs
### "Ton toit. Ton antenne. Ton réseau."

> Ce document est à la fois un guide technique, une feuille de route économique,
> et une lettre ouverte à tous ceux qui ont déjà eu une radio entre les mains.
> CB, radioamateurs, radios libres, makers LoRa — vous êtes exactement les bonnes personnes.

---

## Pourquoi ce document existe

Nexus peut tourner sans internet.

Pas dans 10 ans. Pas si on lève des fonds. Maintenant, avec les technologies existantes,
pour moins de 55€ de matériel, sur une table de cuisine.

Ce guide explique comment. Pour tout le monde — du débutant complet au radioamateur chevronné.

---

## Les 4 Niveaux — Choisir son entrée dans le réseau

```
NIVEAU 1 — LoRa Mesh        Pas de licence. ~55€.      Portée 2–50 km.
NIVEAU 2 — CB 27 MHz        Pas de licence (EU/FR).    Portée 5–300 km.
NIVEAU 3 — Radio Amateur VHF Licence Novice requise.   Portée 50–200 km.
NIVEAU 4 — Radio Amateur HF  Licence complète requise. Portée mondiale.
```

Chaque niveau est compatible avec les autres. Un nœud LoRa parle à un nœud CB
qui parle à un nœud HF qui parle à n'importe où sur la planète.

---

## NIVEAU 1 — LoRa Mesh : l'entrée sans licence

**Aucune licence radio requise.** La bande 868 MHz (EU) / 915 MHz (US) est libre d'utilisation.

### Ce qu'il faut acheter

| Composant | Modèle recommandé | Prix |
|---|---|---|
| Microcontrôleur + LoRa intégré | TTGO LoRa32 (ESP32 + SX1276) | ~18€ |
| Ou Raspberry Pi Zero 2W | + module LoRa Hat séparé | ~15€ + ~12€ |
| Antenne 868 MHz | Antenne externe magnétique | ~8€ |
| Boîtier étanche | Boîtier plastique IP65 | ~5€ |
| Câble alimentation | USB-C + bloc secteur | ~5€ |
| **Total** | | **~50–60€** |

### Ce que ça fait

- Se connecte automatiquement aux nœuds Nexus voisins à portée
- Relaie les messages, posts, et mises à jour d'état (CRDT deltas)
- Portée : **2–10 km en ville**, jusqu'à **50 km en rural** (ligne de vue)
- Débit : 250 bps – 5 kbps (suffisant pour texte + métadonnées)
- Consommation : ~150 mA en transmission, ~50 mA en veille

### Comment le configurer (vision future)

```bash
# Flash le firmware nexus-mesh sur ton TTGO LoRa32
curl -L nexusnode.app/firmware/nexus-mesh-lora32.bin | esptool.py flash -

# Ou sur un Raspberry Pi :
wget nexusnode.app/releases/nexus-mesh-rpi
chmod +x nexus-mesh-rpi
./nexus-mesh-rpi --token TON_TOKEN_INSTANCE --freq 868mhz
```

**C'est tout.** Le nœud se découvre automatiquement, rejoint le mesh, et commence à relayer.

### Projets existants à étudier

- [**Meshtastic**](https://meshtastic.org) — le plus mature, hardware identique
- [**LoRa-APRS**](https://github.com/lora-aprs) — intégration avec le réseau radioamateur
- [**Reticulum**](https://reticulum.network) — stack réseau agnostique au médium, en Python

---

## NIVEAU 2 — CB 27 MHz : réveiller les anciens

**En France, la CB est libre sans licence.** 40 canaux, 4W en AM/FM, bande des 27 MHz.

### Pourquoi la CB est importante pour Nexus-Ether

La CB n'est pas morte. Elle dort.

Des millions de postes CB sont entassés dans des greniers, des garages, des camions à l'arrêt.
Des camionneurs qui s'appelaient sur le canal 19. Des familles qui gardaient le contact sur la route.
Des communities entières qui ont communiqué pendant des décennies sans aucune infrastructure.

**Nexus-Ether peut les réveiller avec un rôle nouveau : devenir des nœuds du réseau.**

### Ce qu'il faut (si tu as déjà un poste CB)

| Composant | Prix |
|---|---|
| Ton poste CB existant | 0€ |
| Interface soundcard (Signalink USB) | ~100€ |
| Ou interface DIY (câble audio + résistances) | ~5€ |
| Raspberry Pi 4 (ou Zero 2W) | ~15–55€ |
| **Total si tu as déjà un poste** | **~20–155€** |

### Si tu n'as pas de poste CB

| Composant | Prix |
|---|---|
| Poste CB d'occasion (Albrecht AE 6110) | ~50–80€ |
| Antenne magnétique voiture ou fixe | ~20–40€ |
| Interface soundcard DIY | ~5€ |
| Raspberry Pi | ~15–55€ |
| **Total** | **~90–180€** |

### Ce que ça fait

- **Portée locale** : 5–15 km (terrain plat, antenne basse)
- **Portée sky wave** (nuit, ionosphère) : jusqu'à **300 km** sur la bande CB
- **Débit** : ~300 bps en BPSK31, ~100 bps en RTTY (modes numériques éprouvés)
- **Usage** : sync des messages de forum, annonces communautaires, alertes

### Le canal Nexus-CB (proposition)

Canal **20** réservé données numériques Nexus (à côté du canal 19 routiers).
Un bip discret toutes les 5 minutes = heartbeat d'un nœud Nexus actif dans le coin.

### Et les radios régionales ?

C'est là que la CB devient vraiment intéressante.

Dans les années 80, la France comptait des centaines de **radios libres** locales.
Radio Verte, Radio Fil Bleu, des dizaines de stations communautaires.
La plupart ont disparu, rachetées ou étouffées par les grandes chaînes.

**Nexus-Ether peut leur redonner vie — dans un rôle différent.**

Une petite radio associative (ou même un particulier avec un émetteur FM légal)
pourrait devenir un **gateway Nexus** :

```
Émetteur FM local
  → diffuse les annonces de la communauté Nexus locale
  → sous-porteuse numérique (RDS étendu ou sous-porteuse FM) = données Nexus
  → les auditeurs avec un RTL-SDR (~25€) reçoivent les mises à jour CRDT
  → certains auditeurs ont aussi un émetteur = ils répondent, ils participent
```

Une radio de village qui diffuse les marchés, les événements, les annonces locales —
et en sous-titre numérique, les posts du forum Nexus de la commune.

**Ce n'est pas de la nostalgie. C'est de l'infrastructure.**

---

## NIVEAU 3 — Radio Amateur VHF/UHF : le réseau intermédiaire

**Licence requise.** En France : examen à la préfecture, passable par n'importe qui.
Coût de la licence : **~30€** (une fois pour toute la vie).
Niveau requis : **Novice** (facile, pas de morse depuis 2003).

### Pourquoi passer la licence

- Accès à des fréquences plus puissantes (jusqu'à 50W)
- Utilisation de **répéteurs** déjà en place (relais VHF sur les collines)
- **APRS** — réseau de données radioamateurs mondial, déjà opérationnel
- **Packet radio** (1200/9600 baud AX.25) — déjà testé et prouvé

### Hardware recommandé

| Composant | Modèle | Prix |
|---|---|---|
| Radio portable | Baofeng UV-5R (basique) | ~25€ |
| Radio portable | Yaesu FT-60 (qualité) | ~120€ |
| TNC (Terminal Node Controller) | Mobilinkd TNC4 | ~80€ |
| Ou TNC logiciel | Direwolf (gratuit) + carte son | 0€ |
| Antenne extérieure | Dipôle vertical ~145 MHz | ~20–50€ |
| Raspberry Pi | — | ~15–55€ |
| **Total** | | **~60–250€** |

### Ce que ça apporte à Nexus-Ether

- **Portée** : 20–80 km direct, 100–300 km via répéteur
- Les **répéteurs radioamateurs existants** deviennent des nœuds Nexus gratuits
- Protocole APRS déjà mondial : on peut s'y greffer proprement

### Le réseau APRS comme infrastructure gratuite

APRS (Automatic Packet Reporting System) est un réseau radioamateur mondial.
Il y a des digi-péaters (relais) sur des collines dans toute l'Europe.
Nexus-Ether peut s'y greffer pour la propagation des métadonnées.

```
Nœud Nexus LoRa local
  → encode les CRDT deltas en paquets APRS
  → les répéteurs APRS existants les relaient gratuitement
  → les nœuds Nexus VHF les reçoivent et appliquent les deltas
```

**Zéro infrastructure supplémentaire. Juste un protocole déjà en place.**

---

## NIVEAU 4 — Radio Amateur HF : le backbone mondial

**Licence complète requise** (Intermédiaire ou Supérieur en France).
C'est le niveau qui permet de **causer partout dans le monde** sans satellite.

### Comment l'ionosphère fonctionne pour Nexus

La bande HF (3–30 MHz) rebondit sur l'ionosphère.
Un signal émis depuis Paris peut être capté à Madrid, Istanbul, ou Dakar.
Sans aucun satellite. Sans aucun câble sous-marin.

C'est le seul réseau vraiment souverain à l'échelle mondiale.

### Hardware HF

| Composant | Modèle | Prix |
|---|---|---|
| Émetteur-récepteur HF entrée de gamme | Xiegu G90 | ~350€ |
| Émetteur-récepteur HF qualité | Icom IC-7300 | ~950€ |
| Émetteur-récepteur SDR (réception seule) | RTL-SDR v3 | ~25€ |
| Antenne filaire (dipôle 40m, fait maison) | Fil de cuivre + isolateurs | ~15€ |
| Coupleur d'antenne | Manuel (MFJ-949) | ~100€ |
| Interface soundcard | Signalink USB | ~100€ |
| **Total (setup complet)** | | **~550–1200€** |
| **Total (réception seule, SDR)** | | **~40€** |

> **Note importante** : La réception seule (SDR ~25€) permet déjà de recevoir
> les messages Nexus-HF et de les appliquer localement. L'émission nécessite la licence.

### Les modes numériques HF pour Nexus

| Mode | Débit | Robustesse | Usage Nexus |
|---|---|---|---|
| **JS8Call** | ~50 bps | Excellente | Messages texte, heartbeats |
| **FT8** | ~10 bps | Remarquable | Annonces, présence de nœuds |
| **Winlink** | ~200 bps | Bonne | Email-like, syncs longues |
| **VARA HF** | ~300–2400 bps | Bonne | Syncs CRDT complètes |

**JS8Call est la cible principale pour Nexus-HF** :
il est conçu pour les messages texte courts, supporte le store-and-forward,
et a déjà une communauté mondiale active.

---

## Comment participer au développement

### Si tu es maker / développeur Rust

```
nexus-p2p/nexus-ether/     ← le workspace qui attend
    nexus-modem/           ← encode/décode CRDT ops en paquets radio
    nexus-mesh/            ← gestion du mesh LoRa hop-by-hop
    nexus-sync/            ← sérialisation Cap'n Proto des deltas CRDT
```

**Issues à ouvrir sur GitHub :**
- `[nexus-ether] LoRa driver abstraction trait`
- `[nexus-ether] CRDT delta serialization spec`
- `[nexus-ether] Meshtastic bridge protocol`

### Si tu es radioamateur expérimenté

Tu as déjà tout ce qu'il faut. Ce qu'on a besoin de toi :

1. **Tester JS8Call avec des paquets CRDT** encodés manuellement
2. **Documenter la propagation** de ta région (quelles bandes, quelles heures)
3. **Cartographier les répéteurs APRS** près de chez toi
4. **Écrire le mode d'emploi** pour les nouveaux radioamateurs qui veulent participer

### Si tu as un poste CB et rien d'autre

Tu es exactement le profil qu'on cherche pour le niveau 2.

1. **Rejoins la Discussion GitHub** "Nexus-Ether CB Community"
2. **Teste la réception** de signaux numériques sur 27 MHz (BPSK31 par exemple)
3. **Dis-nous ta localisation approximative** (département) — on cartographie les nœuds potentiels
4. **Parle-en autour de toi** — chaque ancien opérateur CB est un nœud potentiel

### Si tu gères une radio associative / radio libre

C'est peut-être le cas d'usage le plus puissant.

Une radio associative qui émet en FM ou DAB+ peut devenir un **gateway Nexus bidirectionnel** :
- **Sortant** : les annonces du forum Nexus local passent à l'antenne
- **Entrant** : les auditeurs avec un RTL-SDR reçoivent les CRDT deltas
- **Réponse** : les auditeurs équipés d'un émetteur (CB ou HAM) peuvent poster des réponses

**Ce que vous y gagnez :**
- Une raison de continuer à émettre (contenu communautaire vivant)
- Des auditeurs actifs (participants plutôt que consommateurs)
- Une infrastructure qui tient quand internet tombe

Contactez-nous : ouvrir une Issue sur GitHub avec le tag `[radio-libre]`.

---

## Carte des nœuds potentiels (vision)

```
France hexagonale
  → ~4 500 communes avec au moins un radioamateur répertorié
  → ~150 000 licences CB actives estimées
  → Des centaines de radios associatives (CNRA)
  → Des milliers de makers LoRa (communauté Meshtastic France active)

Couverture théorique avec 1% de participation :
  → ~45 nœuds HF (backbone longue distance)
  → ~1 500 nœuds CB (mesh régional)
  → ~x 000 nœuds LoRa (mesh local)
```

Ce n'est pas un réseau social de niche. C'est une infrastructure nationale distribuée.

---

## Le scénario de résilience — pour être concret

```
Panne nationale d'internet (câble sous-marin coupé, cyberattaque, tempête solaire)

Ce qui tombe :        Discord, Twitter, WhatsApp, toutes les apps centralisées.
Ce qui reste :        Les nœuds Nexus-Ether.

À Paris :
  Un nœud LoRa sur les toits du 11e relaie les messages du quartier.
  Un radioamateur dans le 18e émet sur 14 MHz vers Toulouse et Lyon.
  Une radio associative diffuse les annonces de la mairie en FM.

À Toulouse :
  Le nœud HF reçoit Paris, relaie vers Bordeaux et Marseille.
  Les CRDT deltas fusionnent. L'état converge. Les communautés continuent.

Dans un village isolé des Pyrénées :
  Un couple avec un nœud LoRa et une antenne CB reçoit les annonces régionales.
  Pas de 4G. Pas de fibre. Pas de problème.
  Nexus tourne. Les enfants sont en sécurité. Les voisins le savent.
```

Ce n'est pas un scénario catastrophiste. C'est une infrastructure de résilience civile.
**Elle n'existait pas. Elle peut exister maintenant.**

---

## Licence et esprit

Tout ce qui sera développé dans `nexus-ether/` sera **AGPL-3.0**.

Ce qui signifie : si quelqu'un prend ce code, le modifie, et le déploie — même sur un réseau radio —
il doit publier ses modifications. Le réseau reste ouvert. Pour toujours.

C'est la même règle que pour le reste de Nexus.
**Ce que vous construisez ensemble ne peut pas être privatisé.**

---

## Comment commencer aujourd'hui

1. **Lire** [NEXUS-ETHER.md](NEXUS-ETHER.md) — l'architecture technique
2. **Ouvrir une Discussion** sur [GitHub](https://github.com/Pokled/Nexus/discussions) — présentez-vous, votre matériel, votre région
3. **Tester Meshtastic** sur un TTGO LoRa32 — c'est la base hardware qu'on va réutiliser
4. **Rejoindre la conversation** — on construit ça ensemble

---

*"Les ondes radio n'ont pas besoin de permission.*
*Les communautés non plus."*

*AGPL-3.0 — nexusnode.app — Mars 2026*
