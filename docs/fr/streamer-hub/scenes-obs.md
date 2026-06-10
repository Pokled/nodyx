# Scènes OBS — Compositeur visuel Nodyx

Le tab **Scènes** du Streamer Hub permet de composer visuellement les scènes que tu utilises dans OBS sans avoir à les configurer manuellement dans OBS. Tu poses tes sources (caméra, alerts, ticker, playlist, etc.) sur un canvas 1920×1080 à l'écran, et tu retrouves la même mise en page côté OBS.

> **Note Phase A.** Le compositeur stocke les scènes côté Nodyx. La synchronisation directe avec OBS via WebSocket (Phase B+) viendra plus tard : aujourd'hui tu poses ta composition dans Nodyx, tu copies les URLs d'overlay et tu reproduis les positions à la main dans OBS. Ce sera entièrement automatique quand le bridge sera activé.

## Layout général

Le tab reprend le layout d'OBS pour que tu ne perdes pas tes repères :

```
┌───────────────────────────────┬────────────┐
│                               │            │
│      Canvas preview 16:9      │  Contrôles │
│                               │            │
├──────────┬──────────┬─────────┤            │
│  Scènes  │  Sources │  Mixer  │            │
└──────────┴──────────┴─────────┴────────────┘
```

- **Canvas** (haut, large) : preview 16:9, scalé à la largeur disponible. Référence pixel = 1920×1080.
- **Scènes** : liste de tes scènes Nodyx (Dev, Discussion, Chill…). Boutons `＋ − dupliquer` style OBS.
- **Sources** : sources de la scène active, triées par ordre Z (devant → arrière). Boutons `＋ −`.
- **Audio Mixer** : sliders de volume des sources audio. *Phase B (à venir)*.
- **Contrôles** : `Start Streaming`, `Start Recording`, `Studio Mode`. *Phase C (à venir, via OBS WebSocket)*.
- **Propriétés** (panneau droit) : édition de la source sélectionnée (nom, X/Y, largeur, hauteur, URL, etc.).

## Créer une scène

1. Clique sur le bouton `＋` en bas de la colonne **Scènes**.
2. Saisis un nom (ex : `Dev`, `Discussion`, `Pause`, `BRB`).
3. `Entrée` pour valider.

Le nom doit être unique pour ton compte. Pour repartir d'une scène existante, sélectionne-la et clique sur l'icône **dupliquer** : tu obtiens `Dev (copie)` avec exactement la même composition.

## Ajouter une source

1. Sélectionne la scène cible dans la colonne **Scènes**.
2. Clique sur `＋` en bas de la colonne **Sources**.
3. Choisis un type dans le catalogue :
   - **📹 Source vidéo** : webcam, capture jeu ou image. Placeholder en Phase A ; la vraie source OBS sera liée en Phase B.
   - **🔔 Alert Box** : notifications follow / sub / raid / cheer.
   - **📰 Event Ticker** : bandeau d'events qui défile.
   - **🎵 Playlist** : musique d'ambiance en autoplay loop (voir [Soundboard & Playlists](soundboard.md)).
   - **🔊 Soundboard OSD** : carte affichée quand un son du Stream Deck joue.
   - **🎯 Goal Bar** : barre d'objectif (followers, subs…).
   - **🏆 Leaderboard** : top viewers, chat ou donateurs.
   - **🎬 Clips Player** : lecteur de top clips déclenchable depuis le Deck.
   - **🌐 Browser Source** : n'importe quelle URL HTTPS (widget externe).

La source apparaît centrée sur le canvas avec sa taille par défaut. Tu peux ensuite la déplacer ou la redimensionner.

## Manipuler une source

### Sélection
Clique sur la source dans le canvas ou dans la liste **Sources**. La source sélectionnée est encadrée d'une bordure rouge OBS-style avec 8 poignées de redimensionnement.

### Déplacement
Drag le centre de la source. Le mouvement **se magnétise** aux bords du canvas et au centre (X et Y), comme OBS.

### Redimensionnement
Drag une des 8 poignées rouges :
- 4 poignées d'angle (`↖ ↗ ↘ ↙`) : redimensionnement libre 2D.
- 4 poignées de bord (`↑ ↓ ← →`) : un seul axe.

La taille reste clampée au canvas (impossible de déborder).

### Visibilité et verrouillage (style OBS)
Dans la liste **Sources** :
- L'icône **œil** masque la source du canvas sans la supprimer (utile pour tester une compo).
- L'icône **cadenas** empêche le drag/resize accidentel sur le canvas (souvent utile pour la caméra une fois bien réglée).

### Ordre Z (devant / derrière)
Survole une source dans la liste et utilise les chevrons `↑ ↓` pour la déplacer dans la pile. OBS et Nodyx affichent les sources de fond en bas et les sources de premier plan en haut.

### Suppression
Sélectionne et clique sur `−` en bas de la liste **Sources**. La source est retirée de la scène (les autres scènes ne sont pas touchées).

## Propriétés détaillées

Quand une source est sélectionnée, le panneau **Propriétés** (à droite) permet d'ajuster :
- **Nom affiché** : étiquette de la source (visible dans la liste et le canvas).
- **X / Y / Largeur / Hauteur** : pixels absolus (référentiel 1920×1080).
- Selon le type :
  - **Browser Source** : URL (HTTPS uniquement, validée côté backend).
  - **Source vidéo** : type visé (webcam / capture / image) pour la liaison Phase B.
  - Pour les overlays Nodyx (alert, ticker, playlist…) : le token d'overlay et la config seront éditables dans une prochaine itération.

## Sauvegarde

Tout est sauvegardé automatiquement, **debounced à 400 ms** après ta dernière action. Tu vois "sauvegardé à l'instant" en haut à droite quand le PATCH a réussi.

Si la sauvegarde échoue (réseau, conflit), un toast rouge s'affiche. Réessaye en bougeant la source de 1 pixel.

## Roadmap

| Phase | Contenu | État |
|-------|---------|------|
| **A** | Canvas WYSIWYG + scènes côté Nodyx + génération d'URLs | ✅ Disponible |
| **B** | Connexion OBS WebSocket en lecture seule (import des scènes OBS) | À venir |
| **C** | Sync bidirectionnelle (drag/resize Nodyx → OBS en live), Audio Mixer et Contrôles activés | À venir |
| **D** | Auto-installer : Nodyx recrée toutes les Browser Sources dans OBS depuis tes scènes | À venir |
| **E** | Actions Stream Deck dédiées OBS (scene switch, source toggle, stream start) | À venir |

## FAQ

**Q. Pourquoi la Browser Source apparaît seulement comme un placeholder ?**
Le canvas Nodyx ne rend pas encore le contenu vivant des sources (iframe live) pour rester rapide à manipuler. Tu vois l'emprise (position + taille), pas le contenu. Le rendu fidèle viendra en Phase B avec le bridge OBS qui peut envoyer des screenshots de la scène réelle.

**Q. Puis-je avoir plusieurs Audio Mixer ?**
Le mixer est une vue agrégée des sources audio toutes scènes confondues côté OBS. Il sera unique et persistant en Phase B.

**Q. Que se passe-t-il si je supprime une scène utilisée par mon Stream Deck ?**
Les boutons "Démarrer playlist X" du Deck restent attachés à la playlist, pas à la scène Nodyx. Tu peux supprimer / renommer / réorganiser tes scènes sans casser tes boutons.

**Q. La Phase B sera-t-elle compatible avec mon OBS ?**
Oui, si tu es sur OBS 28 ou plus récent. Le plugin OBS WebSocket 5.x est intégré nativement depuis cette version. Pas d'install supplémentaire à prévoir.
