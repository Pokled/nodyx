# CDC — Finition du Streamer Hub (clôture du chantier)

> Statut : EN ATTENTE DE VALIDATION JONATHAN
> Date : 2026-06-10
> Contexte : ère de stabilisation (voir décision du 2026-06-10). Ce CDC liste
> TOUT ce qui manque pour déclarer le Streamer Hub "fini", après quoi le
> chantier est clos et on passe à la stabilisation transversale (sécu, réseau,
> perfs, UX). Aucune feature nouvelle : uniquement tenir les promesses déjà
> faites dans l'UI et nettoyer.

## 1. Inventaire des promesses non tenues (relevé du 2026-06-10)

| # | Où | Promesse | Verdict proposé |
|---|----|----------|-----------------|
| P1 | Tab Scènes (header + canvas) | "Phase B (à venir) : aperçu réel via OBS WebSocket" | **Implémenter** (Session A) |
| P2 | Tab Scènes, Audio Mixer | Badge "Phase B" : sliders volume une fois connecté à OBS | **Implémenter** (Session A) |
| P3 | Tab Scènes, Contrôles | Badge "Phase C" : Start Streaming / Recording / Studio Mode "via OBS" | **Implémenter** (Session A, devient trivial une fois le bridge en place) |
| P4 | Tab Scènes, source vidéo | "La vraie source OBS sera liée ici (Phase B)" | **Implémenter** (Session A, via import des scènes) |
| P5 | Page publique /soundboard | "Bientôt : demande des sons via `!next sound <nom>` dans le chat Twitch" | **Implémenter** (Session B, l'infra queue existe déjà avec `source: 'chat'`) |
| P6 | SoundLibraryPanel, tooltip visibilité | "Public (V2) : partagé avec tes modérateurs et utilisable via channel points" | **Reformuler** (Session B) : la moitié est déjà vraie (public = page viewers), la partie modérateurs/channel points est de l'idéation → retirer du tooltip |
| P7 | Console admin | `GET /api/v1/forums/categories` → 404 (CommandPalette appelle une route inexistante, "categories" interprété comme slug de communauté) | **Fixer** (Session C, hors hub mais observé et trivial) |
| P8 | Docs | Seul `docs/fr/streamer-hub/scenes-obs.md` existe. Pas de doc EN, pas de vue d'ensemble du hub (9 tabs) | **Écrire** (Session C) |

## 2. Session A — OBS Bridge (le gros morceau, ~3-4 sessions de travail)

### Principe d'architecture (à valider)
- **Tout côté navigateur.** `obs-websocket-js` (lib officielle) en dépendance
  frontend. Le navigateur de l'admin se connecte directement au WebSocket
  d'OBS (port 4455, plugin natif depuis OBS 28).
- **Le password OBS ne quitte JAMAIS la machine du streamer** : stocké en
  localStorage, aucun transit par nodyx-core, aucun stockage serveur.
  Cohérent avec la philosophie zéro-données du projet.
- Aucune migration, aucune route backend nouvelle. Le bridge est purement
  client. (Si un jour on veut du contrôle à distance hors du navigateur
  admin, ce sera un autre chantier, pas celui-ci.)

### Découpage
**A1 — Connexion + statut**
- Panneau "Connexion OBS" dans le tab Scènes : URL (défaut `ws://localhost:4455`),
  password, bouton Connecter/Déconnecter, indicateur d'état (vert/rouge),
  reconnexion auto avec backoff.
- États gérés : OBS fermé, WebSocket désactivé, mauvais password, version < 5.

**A2 — Aperçu réel**
- Quand connecté : le canvas Scènes affiche le screenshot de la scène
  programme (`GetSourceScreenshot`, polling 2-5 fps, fps réglable) à la place
  des iframes Phase A. Toggle "Aperçu OBS / Aperçu Nodyx" (les iframes
  restent le fallback hors connexion).
- C'est LA réponse définitive au problème de scaling qu'on a accepté en
  Phase A.

**A3 — Import des scènes OBS**
- Bouton "Importer depuis OBS" : `GetSceneList` + `GetSceneItemList` →
  crée/met à jour les scènes Nodyx correspondantes (sources en
  placeholders nommés, transforms récupérés).
- One-shot, pas de sync continue (à valider, voir Q4).

**A4 — Mixer + Contrôles (ex-Phase C, devient petit une fois A1 fait)**
- Audio Mixer : `GetInputList` + sliders `SetInputVolume` + mute.
- Contrôles : Start/Stop Stream, Start/Stop Record, toggle Studio Mode,
  switch de scène programme depuis la liste Scènes Nodyx.
- Garde-fous : confirmation avant Start/Stop Stream (action irréversible
  en live).

### Hors scope assumé (à rappeler si tentation)
- Plugin OBS natif (Rust) : 2-4 mois, surdimensionné. Parké.
- Push des layouts Nodyx vers OBS (`SetSceneItemTransform`) : utile mais
  c'est de l'ajout, pas de la finition. Parké, listé dans ideas.
- Contrôle OBS depuis le Deck mobile : idem, parké.

## 3. Session B — Soundboard, tenir les promesses (~1 session)

**B1 — Commande chat `!sound <nom>`**
- Commande hardcodée dans le chat bridge Twitch : recherche fuzzy dans les
  tracks publics, ajoute à la queue viewers (`source: 'chat'`, déjà typé
  dans soundboardQueueService).
- Mêmes garde-fous que le web : queue activée, rate-limit, cap par
  utilisateur, dédup. Réponse chat : confirmation ou raison du refus.
- Q3 à trancher : nom de la commande (`!sound` proposé, plus court que
  `!next sound` annoncé) + cooldown.

**B2 — Nettoyage des textes**
- Tooltip P6 reformulé (retirer modérateurs/channel points).
- Page publique : mettre à jour la mention de la commande avec le nom réel.

## 4. Session C — Polish + documentation (~1 session)

- Fix P7 (CommandPalette → bon endpoint).
- `docs/en/streamer-hub/scenes-obs.md` (traduction).
- Vue d'ensemble du hub : `docs/fr/streamer-hub/README.md` + EN (les 9 tabs,
  quickstart streamer : connecter Twitch → overlays → deck → soundboard →
  scènes, 1 page max chacun).
- Passe "track l'useless" sur les 9 tabs : chaque élément d'UI doit servir,
  sinon il saute (liste à constituer pendant la passe, validation Jonathan
  avant suppression).

## 5. Définition de "FINI"

Le Streamer Hub est déclaré fini quand :
1. Plus aucun badge "Phase X" / "à venir" / "bientôt" dans l'UI du hub.
2. Un streamer peut faire le parcours complet (Twitch → overlays → scènes
   avec aperçu OBS réel → deck → soundboard + playlists → commande chat)
   en suivant uniquement la doc, sans aide.
3. Tests verts, svelte-check 0 erreur, doc FR + EN.
Ensuite : chantier CLOS, on n'y revient que pour des bugs.

## 6. Questions ouvertes pour Jonathan

- **Q1** : Session A4 (mixer + contrôles) incluse dans la finition, ou on
  retire les placeholders de l'UI et on parke ? (Reco : inclure, c'est
  petit une fois A1 fait, et ça tient les promesses affichées.)
- **Q2** : aperçu OBS en remplacement du canvas quand connecté, ou en
  vignette à côté ? (Reco : remplacement avec toggle.)
- **Q3** : nom de la commande chat : `!sound <nom>` ? Cooldown 30s/user
  comme le web ?
- **Q4** : import scènes OBS one-shot (reco) ou sync continue (parké) ?
- **Q5** : ordre des sessions : A puis B puis C (reco), ou B d'abord
  (victoire rapide) ?
