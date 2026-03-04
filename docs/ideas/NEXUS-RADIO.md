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

### Les chiffres du vide

Dans le répertoire Icecast/Shoutcast au pic de l'internet radio (2010–2015) :
**~100 000 stations actives dans le monde.**
Stations avec plus de 10 auditeurs simultanés : **moins de 5%.**

Aujourd'hui, entre 10 000 et 50 000 streams Icecast actifs à tout moment.
Nombre moyen d'auditeurs simultanés : **2 à 3** — souvent l'opérateur qui teste son propre flux.

**50 000 Ellies Arroway pointées vers le vide.**
Chacune convaincu qu'il y a quelqu'un qui écoute.
La plupart ont tort.

> *"If it's just us... seems like an awful waste of space."*
> — David Arroway à sa fille Ellie, dans le film Contact (1997)

C'est exactement ça. Des milliers de voix qui émettent. Personne pour répondre.
Pas parce que les signaux sont mauvais. Parce qu'il n'existe aucune structure
pour transformer des auditeurs simultanés en communauté.

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

## Ce que l'histoire a déjà prouvé

La recherche sur les radios internet mondiales révèle un pattern constant.
**Les stations qui ont survécu** avaient une couche communautaire structurellement attachée.
**Les stations qui sont mortes** avaient des auditeurs, mais pas de communauté.

### Les survivantes — et pourquoi

**SomaFM** (San Francisco, 2000 — toujours en vie) :
En 2002, la RIAA impose des redevances rétroactives qui tuent presque toutes les radios internet overnight.
SomaFM survit parce que sa communauté — dispersée sur Reddit et IRC — se mobilise en 48h et fait des dons
pour couvrir les factures. Des dizaines de milliers de dollars en quelques jours.
La communauté a sauvé la station. Mais elle vit *ailleurs* — pas sur la plateforme de la station elle-même.
**C'est le problème que Nexus résout.**

**Radio Paradise** (Californie, 2000 — toujours en vie) :
La seule radio internet à avoir construit une couche communautaire *intégrée* dans le stream :
les auditeurs votent les chansons en temps réel, ce qui influence la playlist.
Ce retour direct donne aux auditeurs un sentiment de propriété sur la station.
2 millions d'auditeurs uniques par mois. Entièrement financée par abonnements volontaires.
**Modèle le plus proche de Nexus-Radio.**

**SDF anonradio** (1987 — toujours en vie, 40 ans) :
Tourne sur SDF (Super Dimensional Fortress), un des plus vieux systèmes Unix publics d'internet.
Radio + forum + chat + identité persistante = **une seule infrastructure**.
Les auditeurs ne partent pas sur Discord. La communauté *est* la station.
**C'est exactement l'architecture Nexus.**

**EchoLink / AllStarLink** (HAM radio + internet) :
400 000+ opérateurs radioamateurs connectés. Actif depuis 20+ ans.
La licence radioamateur crée l'investissement initial (effort = appartenance).
Les "nets" hebdomadaires (rendez-vous récurrents sur une fréquence) sont des communautés
qui se retrouvent autour d'un programme — exactement comme un salon vocal Nexus avec récurrence.

### Les mortes — et pourquoi

**WOXY "97X" (Cincinnati)** :
Radio culte du rock indépendant américain. Communauté passionnée.
Fermée en 2010 faute de financement.
Quand le stream s'est éteint, les fans n'avaient **nulle part où se retrouver ensemble**.
Même pour faire leur deuil. La communauté s'est dispersée immédiatement.
Un forum Nexus actif aurait survécu à l'arrêt du stream.

**Last.fm** :
À son apogée (2007–2010) : 40 millions d'utilisateurs. Social radio, profils de goûts, recommandations.
Acquis par CBS, revendu, la radio tuée en 2014 (licences trop chères).
Quand la radio est morte, la communauté s'est effondrée.
**La communauté dépendait du stream.** Chez Nexus, c'est l'inverse :
le stream est une fonctionnalité de la communauté — pas l'inverse.

**Lofi Girl** (YouTube, 20 000+ auditeurs simultanés) :
En 2020, YouTube suspend le stream par erreur de DMCA.
Tollé mondial. Restauré en quelques heures.
Mais les 20 000 auditeurs simultanés sont **des inconnus anonymes les uns pour les autres**.
Aucun forum. Aucun profil. Aucune mémoire collective.
Si le stream meurt demain, il ne reste rien. La communauté n'existe pas — c'est une foule.

### La leçon universelle

```
Stations mortes    :  audience → espoir de communauté
Stations vivantes  :  communauté → broadcast comme expression
```

**Ce n'est pas la qualité du programme qui fait la différence.
C'est la direction du flux.**

La communauté doit exister *d'abord*, ou être construite *simultanément*.
Le broadcast seul ne génère pas de communauté. Il génère une foule.
Et une foule n'a pas de mémoire, pas de fidélité, pas de résilience.

---

## Le parallèle Contact (1997)

*Contact* de Carl Sagan, film de Robert Zemeckis avec Jodie Foster.

Ellie Arroway, enfant, scanne les fréquences radio dans sa chambre.
Son père lui dit : **"Small moves, Ellie. Small moves."**
*(Petit à petit, Ellie. Petit à petit.)*

Adulte, elle pointe le radiotélescope d'Arecibo vers le ciel pendant des années.
Le projet est coupé. Les gens disent que c'est inutile. Elle continue.

Parce qu'elle croit : le signal existe. Il n'a pas encore été trouvé.

Elle demande à son père enfant :
*"Tu penses qu'on est seuls dans l'univers ?"*

Il répond :
**"If it's just us... seems like an awful waste of space."**
*(Si c'est juste nous... ça serait une belle perte d'espace.)*

---

**Les 50 000 opérateurs de radio internet sont Ellie.**
Ils pointent leur émetteur vers le vide. Ils programment des semaines, des mois.
Ils sont convaincus que quelqu'un écoute — ou devrait écouter.
La plupart ont 2-3 auditeurs. Souvent eux-mêmes, en test.

La différence entre Ellie et eux : Ellie cherchait un signal *sortant*.
Les opérateurs radio cherchent un signal *entrant* — une réponse.

**Nexus est la réponse.**

Pas "quelqu'un écoute ton stream".
Mais "voici ta communauté. Elle existait déjà. Elle t'attendait."

Le signal était là. Il fallait un endroit où il pouvait atterrir.

---

## L'ionosphère — le réseau que personne ne peut acheter

C'est là que ça devient vraiment inconfortable pour les grands groupes.

L'ionosphère est une couche de l'atmosphère terrestre, entre 80 et 400 km d'altitude.
Elle réfléchit les ondes radio HF (3–30 MHz) comme un miroir courbe.

Un signal émis depuis un village de Bretagne peut rebondir sur l'ionosphère
et être reçu à New York, Dakar, ou Tokyo.

```
Paris → ionosphère → New York
        ↕ rebond
        → Dakar → ionosphère → Tokyo
```

**Sans satellite. Sans câble sous-marin. Sans compte cloud. Sans permission.**
Juste de la physique. De la même physique qui existait avant internet.
De la même physique qui existera après.

### Ce que ça signifie pour NEXUS-RADIO

Une station de radio communautaire avec un émetteur HF de 100W et une antenne filaire
faite maison (15€ de fil de cuivre tendu entre deux arbres) peut diffuser son programme
**à l'autre bout du monde.**

Pas en streaming. Pas avec une carte de crédit. Pas avec un CDN.
Avec de la physique.

Et les CRDT deltas du forum Nexus — les mêmes qui synchronisent NexusCanvas en temps réel —
voyagent sur ces ondes en JS8Call ou VARA HF.

```
Radio communautaire, Creuse, France :
  → Programme audio diffusé en HF 14 MHz
  → Reçu à Buenos Aires par un radioamateur qui a un RTL-SDR (~25€)
  → Les CRDT deltas du forum arrivent avec le signal audio
  → L'état du forum Nexus se reconstitue localement
  → L'auditeur argentin peut lire les discussions du village de Creuse
  → Et répondre. Via son émetteur. Ses mots remontent vers l'ionosphère.
  → Et atterrissent dans le village, le lendemain matin.
```

### Ce qui rend les "gros" incapables de répondre

Spotify peut acheter des serveurs. Google peut acheter des câbles sous-marins.
Apple peut acheter des satellites.

**Personne ne peut acheter l'ionosphère.**

C'est de la physique solaire. Elle se recharge chaque jour avec l'énergie du soleil.
Elle fonctionnait avant internet. Elle fonctionnera après.

Une communauté Nexus avec un émetteur HF et une antenne dans un arbre
est **structurellement indestructible** par n'importe quelle puissance commerciale ou étatique.

Pas de serveur à couper. Pas de domaine à saisir. Pas de compte à fermer.
Pas de datacenter à rançonner.

Juste des ondes. Et des gens de l'autre côté.

> *"Seems like an awful waste of space."*
>
> Non, David. Pas du tout.

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

## Le modèle économique — la régie coopérative

C'est la pièce qui manquait à toutes les radios qui sont mortes.

### Le problème des petites stations

Une radio associative avec 80 auditeurs ne peut pas négocier avec un annonceur.
Elle n'a pas le poids. Elle n'a pas les contacts. Elle n'a pas le temps.
Résultat : zéro revenus, dépendance aux subventions, mort lente.

### La solution Nexus-Radio : mutualisation des audiences

200 stations Nexus-Radio avec 80 auditeurs chacune = **16 000 auditeurs locaux/régionaux.**
Un artisan, une salle de concert, un événement régional — ils paient pour ça.
Pas parce que c'est "internet". Parce que c'est **leur bassin de vie**.

```
nexusnode.app/radio
  → régie publicitaire coopérative
  → annonceurs locaux/régionaux déposent leurs spots audio
  → spots distribués aux stations de la région ciblée
  → revenus partagés automatiquement

Répartition :
  80% → la station (son infrastructure, ses animateurs)
  20% → nexusnode.app (maintenance serveurs, développement Nexus)
```

### Pourquoi ce n'est pas de la pub Big Tech

- Aucun tracking. Aucun profil utilisateur. Aucun pixel.
- Les annonceurs ciblent par **région géographique** et **genre de station** — pas par données personnelles.
- Le boulanger du village cible les auditeurs de sa commune. Pas les "personnes intéressées par la boulangerie".
- Les stations choisissent quels annonceurs elles acceptent. Droit de refus total.
- L'argent circule entre locaux. Il ne quitte pas la région.

### Ce que ça change pour les stations

Une radio associative qui diffuse 4h/semaine avec 80 auditeurs locaux
peut générer **200–500€/mois** de revenus publicitaires via la régie.

Ce n'est pas une fortune. C'est assez pour :
- Payer le VPS ou le Raspberry Pi
- Couvrir la licence SACEM
- Garder l'antenne allumée

Et pour nexusnode.app, c'est le modèle qui rend l'infrastructure **auto-suffisante**.
Pas de VC. Pas de levée de fonds. Pas d'actionnaire à satisfaire.
**La communauté finance sa propre infrastructure. En diffusant de la pub locale.**

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
