# NEXUS-RADIO — The Internet Radio Tuner
### *"De nouvelles ondes vont voir le jour. Parce qu'elles ont enfin une raison d'exister."*

> Ce document est une idée de design — pas encore une SPEC formelle.
> Il explore comment Nexus peut devenir le système nerveux d'un réseau radio vivant,
> à la fois sur IP et sur les ondes physiques.

---

## Le problème que personne n'a résolu

Des milliers de petites stations de radio existent ou ont existé.
Radios associatives. Radios libres. Podcasts sans audience.
Radioamateurs qui émettent dans le vide.
Opérateurs CB qui n'ont plus grand monde à qui parler.

Ils ont arrêté. Ou ils continuent, esseulés.

**Pas parce qu'ils n'avaient rien à dire.**
Parce qu'ils n'avaient plus d'audience interactive.
Pas de retour. Pas de communauté. Juste des ondes qui partent dans la nuit.

---

## Ce que Nexus peut faire

Chaque station de radio qui tourne une instance Nexus obtient immédiatement :

- **Un forum** — les archives, les discussions, les annonces
- **Un chat en direct** — les auditeurs qui réagissent en temps réel pendant l'émission
- **Des salons vocaux** — le studio de monitoring, les coulisses ouvertes
- **Une bibliothèque d'assets** — jingles, logos, visuels partagés
- **Un jardin de fonctionnalités** — les auditeurs votent ce qu'ils veulent entendre

**La station ne diffuse plus dans le vide. Elle diffuse dans sa communauté.**

Et cette communauté — indexée par Google, accessible sans compte, fedérée avec les autres instances Nexus — attire de nouveaux auditeurs qui ne savaient pas que cette station existait.

---

## NEXUS-RADIO : l'intégration dans Nexus

### Côté instance (la station)

Une instance Nexus peut se déclarer comme **station radio** dans ses paramètres :

```toml
[radio]
enabled = true
stream_url  = "https://stream.maradio.fr:8000/live.mp3"   # Icecast / Shoutcast / HLS
stream_hls  = "https://stream.maradio.fr/hls/index.m3u8"  # optionnel
name        = "Radio des Collines"
genre       = "local / variétés"
language    = "fr"
region      = "Occitanie"
rf_fm_mhz   = 95.4          # fréquence FM locale si émetteur légal
rf_cb_ch    = 20            # canal CB si nœud NEXUS-ETHER
rf_hf_khz   = 14074         # fréquence HF si radioamateur
```

Ces métadonnées sont publiées dans le **directory nexusnode.app** avec le profil de l'instance.

---

### Côté auditeur (le panneau radio intégré)

Un panneau **NEXUS-RADIO** dans l'interface Nexus — accessible depuis n'importe quelle instance.

```
┌─────────────────────────────────────────────────────┐
│  📻 NEXUS-RADIO                          [× Fermer] │
├─────────────────────────────────────────────────────┤
│  🔴 EN DIRECT   Radio des Collines  · Occitanie      │
│  ████████████░░░░░░░░░░░░  ▶ 0:14:32                 │
│  🎵 "Soir d'été" — Jazz ensemble local               │
├─────────────────────────────────────────────────────┤
│  STATIONS ACTIVES                                    │
│  ● Radio des Collines      Occitanie · FR            │
│  ● Radio Fil Bleu (relance) Bretagne · FR            │
│  ● HF Node 14.074 MHz       Île-de-France · HAM      │
│  ● CB Nexus Ch.20 — Alpes   Région PACA              │
│  ○ Radio Compostelle        Espagne · ES             │
├─────────────────────────────────────────────────────┤
│  [🎛️ Genres] [🗺️ Carte] [📡 RF only] [🌐 Toutes]   │
└─────────────────────────────────────────────────────┘
```

**Un clic sur une station** → le stream démarre dans le panneau flottant.
**Un clic sur son nom** → on arrive dans l'instance Nexus de la station.
Le chat en direct. Le forum. Les gens qui écoutent en même temps.

---

## Le changement de paradigme

Avant Nexus-Radio, créer une radio web nécessitait :
- Un serveur de streaming (Icecast : complexe, coûteux)
- Un site web (WordPress, entretien, SEO)
- Des réseaux sociaux (algorithmes, modération, shadowban)
- Un Discord ou un Telegram pour la communauté (silo, fermé)

Et malgré tout ça : une audience atomisée. Des commentaires éphémères. Zéro mémoire collective.

**Avec Nexus :**

```
install.sh → Nexus tourne
Ajouter stream_url dans les paramètres → station déclarée dans le directory
Les auditeurs trouvent via nexusnode.app → arrivent dans l'instance → s'inscrivent
Le forum accumule les archives de chaque émission → indexé par Google
Le chat s'anime pendant les directs → mémoire collective
Le Garden vote les prochains thèmes → participation organique
```

**Une radio associative qui était morte redevient vivante.**
Pas parce que la technologie a changé.
Parce qu'elle a maintenant une raison d'exister : sa communauté la soutient.

---

## Nouvelles stations qui n'existeraient pas sans Nexus

C'est la partie la plus importante.

Des gens n'ont jamais créé de radio parce que le ratio effort/audience était trop défavorable.
Nexus change ce calcul.

- Un club de jazz local → stream de leurs sessions → forum des membres → archives des concerts
- Une école de musique → émission hebdo des élèves → feedback de la communauté → Garden pour voter les programmes
- Un marché artisanal → radio du marché → annonces en direct → forum des producteurs
- Un hameau de 300 habitants → radio communale → agenda local → chat pendant les émissions
- Un radioamateur → stream de sa fréquence de veille → communauté de passionnés → tutoriels forum

**Ces stations n'émettront que parce que Nexus leur donne une communauté.**
Avant, elles auraient émis dans le vide. Elles ne l'auraient pas fait.

---

## L'intégration NEXUS-ETHER

Quand l'internet tombe (panne, tempête, crise) :

```
Station Nexus-Radio
  → stream IP normal quand internet fonctionne
  → bascule automatique sur émetteur FM local (si disponible)
  → ou RF numérique via CB canal 20 (BPSK31 — métadonnées + texte)
  → ou HF (JS8Call / Winlink — messages store-and-forward)

Auditeur Nexus-Radio
  → écoute stream IP normal
  → si internet absent : RTL-SDR (~25€) → reçoit FM ou HF
  → les CRDT deltas du forum arrivent via RF → état reconstruit localement
  → "l'émission continue. La communauté aussi."
```

Le même RTL-SDR qui reçoit la météo maritime peut recevoir les posts du forum Nexus local.
**Ce n'est pas de la science-fiction. Ces protocoles existent et fonctionnent aujourd'hui.**

---

## Le panneau radio dans Nexus — vision UX

### Bouton dans la nav principale

Un bouton `📻` dans la barre de navigation globale.
Pas intrusif. Toujours accessible.

### Lecture en arrière-plan

Le stream audio continue pendant la navigation.
Exactement comme Spotify ou une appli radio — le lecteur ne s'arrête pas quand on change de page.

### Chat de la station en overlay optionnel

Petit panneau dépliable depuis le lecteur :
"47 personnes écoutent en ce moment."
Les messages du chat de la station défilent.
On peut répondre directement depuis le panneau, sans quitter la page courante.

### Carte des stations (vue géographique)

Vue optionnelle : carte OpenStreetMap avec les stations actives.
Point vert = en direct. Point gris = hors antenne.
Filtre par genre (musique / parole / actualités / radio amateur / CB).

---

## Architecture technique (vision)

### Côté nexusnode.app

Extension du directory existant :

```sql
ALTER TABLE instances ADD COLUMN IF NOT EXISTS radio_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS radio_stream_url TEXT;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS radio_genre TEXT;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS radio_rf_fm DECIMAL(5,1);  -- MHz
ALTER TABLE instances ADD COLUMN IF NOT EXISTS radio_rf_cb SMALLINT;      -- canal 1-40
ALTER TABLE instances ADD COLUMN IF NOT EXISTS radio_rf_hf DECIMAL(7,1);  -- kHz
```

Endpoint : `GET /api/directory/radio?genre=&region=&lang=&active=true`

### Côté nexus-core

```ts
// Nouveau endpoint d'état radio (public, non authentifié)
GET /api/v1/radio/now-playing
→ { title, artist, listeners, stream_url, chat_channel_id }
```

### Côté nexus-frontend

- `RadioPlayer.svelte` — lecteur audio flottant (Web Audio API)
- `RadioDirectory.svelte` — liste des stations depuis nexusnode.app/api/directory/radio
- `RadioMap.svelte` — carte OSM (Leaflet.js) optionnelle
- Intégration dans `VoicePanel.svelte` ou panneau séparé

---

## Scénario complet — une station qui renaît

```
2019 : Radio Fil Bleu ferme. 12 ans d'émissions. Archives perdues.

2026 : Un ancien animateur installe Nexus sur un Raspberry Pi 4.
       Connecte un émetteur FM légal (100mW, portée 5 km — légal en France).
       Déclare sa station dans le directory nexusnode.app.

Semaine 1 :
  5 anciens auditeurs trouvent via Google "Radio Fil Bleu Bretagne".
  Ils s'inscrivent. Le forum reprend vie. Les archives remontent.

Semaine 4 :
  23 membres. Le Garden a voté "émission folk breton le vendredi soir".
  Le premier direct est écouté en stream + FM simultanément.
  Le chat du salon vocal pulse pendant l'émission.

Mois 3 :
  150 membres actifs. Les émissions sont archivées automatiquement (podcast).
  Les posts du forum sont indexés par Google → "Radio Fil Bleu" redevient visible.

Tempête de janvier 2027 : internet coupé 18 heures.
  La FM locale continue d'émettre.
  Les auditeurs avec RTL-SDR reçoivent les CRDT deltas — le forum fonctionne hors-ligne.
  "Radio Fil Bleu était là quand tout le reste s'est tu."
```

---

## Connexion avec NEXUS-ETHER

NEXUS-RADIO et NEXUS-ETHER ne sont pas deux projets.
C'est la même infrastructure, deux faces du même prisme.

```
NEXUS-ETHER  →  réseau de transport physique (LoRa, CB, HF)
NEXUS-RADIO  →  couche applicative et communautaire au-dessus des ondes
```

Une station CB qui diffuse des données CRDT (NEXUS-ETHER) peut aussi diffuser
un programme audio encodé (NEXUS-RADIO). Les deux partagent l'antenne, la licence,
et la communauté Nexus qui les fait vivre.

**Le réseau radio est le réseau de données est le réseau communautaire.**
Trois en un. Sur des fréquences que personne ne peut éteindre.

---

## Ce qu'on attend des contributeurs radio

### Si tu as une station active (association, FM légale, web radio)

Contacte-nous : issue GitHub avec le tag `[nexus-radio]`.
On veut comprendre ton infrastructure (Icecast ? Liquidsoap ? AzuraCast ?) et adapter l'intégration.

### Si tu es développeur

Les problèmes techniques à résoudre :
- Proxy de stream audio (CORS, HLS vs MP3)
- Lecteur audio flottant persistant en SvelteKit (Web Audio API, SSR-safe)
- Endpoint `now-playing` côté nexus-core (metadonnées Icecast ICY)
- Visualisation carte (Leaflet + OpenStreetMap, données directory)

### Si tu es radioamateur

Le pont NEXUS-ETHER ↔ NEXUS-RADIO est à construire.
Quelqu'un doit documenter comment un nœud HF (JS8Call) peut aussi devenir une "station" dans le directory.

---

## Pourquoi maintenant

Parce que les outils existent. Parce que les gens existent.
Il manquait la plateforme qui les connecte.

Nexus est cette plateforme.

Et elle n'appartient à personne — donc elle appartient à tout le monde.

---

*"Les ondes radio n'ont pas besoin de permission.*
*Les communautés non plus."*

*AGPL-3.0 — nexusnode.app — Mars 2026*
