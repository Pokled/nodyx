# CDC — Partage d'écran sur SFU (P2)

> Statut : **conception, en attente validation Jonathan**
> Prérequis : bascule audio mesh↔SFU en prod (PRs #240→#249, canal « Réunion »).
> Réf. : `NODYX_SFU_CDC.md` §6 (le cas critique) + §17-B (bascule).

---

## 1. Pourquoi ce chantier

Le mesh WebRTC meurt en partage d'écran à ~4 personnes : chaque partageur
uploade son flux vidéo N-1 fois (une copie par spectateur). Une vidéo 720p à
2,5 Mbps × 5 spectateurs = 12,5 Mbps d'upload sur la machine du partageur. Un
particulier en fibre plafonne, un mobile s'effondre.

Le SFU renverse ça : le partageur uploade **une seule fois** vers le serveur, qui
recopie vers chaque spectateur. Upload partageur constant quel que soit le nombre
de spectateurs. C'est LE livrable « on tient tête à Discord » (studio Lapersonne).

**Objectif de tenue (CDC §6)** : 1 partageur + 15+ spectateurs fluide sur un VPS
standard, chaque spectateur servi selon SA bande passante.

---

## 2. Doctrine (non négociable)

1. **Additif.** Le screenshare mesh (`voice.ts` `startScreenShare`/`stopScreenShare`,
   `remoteScreenStore`) n'est PAS modifié dans son chemin mesh. On ajoute un chemin
   SFU à côté, choisi par le mode du canal.
2. **Gated.** Le screenshare SFU ne s'active QUE si le canal est en mode SFU
   (bascule active). En mode mesh, on garde le screenshare mesh actuel tel quel.
   Aucun flag global nouveau : on réutilise l'état de mode déjà porté par la bascule.
3. **Sanctuaire.** `voice.ts` (mesh) et le moteur Rust ne bougent qu'avec ton OK
   explicite, diff minimal, chaque ajout isolé du chemin mesh.
4. **UI inchangée.** L'UI lit déjà `remoteScreenStore` (Map socketId→stream) et
   `localScreenStore`. Le chemin SFU alimente ces MÊMES stores → zéro refonte UI.

---

## 3. Ce qui est DÉJÀ prêt (moitié du travail est faite)

| Couche | État |
|---|---|
| Trait `MediaEngine` | `TrackKind::{Audio,Screen,Cam}` existe déjà. `produce(kind)` typé. |
| Moteur `consumer_caps` | Convertit déjà les caps **vidéo** finalisées (anticipé). |
| Client `consumeOne` | Lit déjà `kind:'audio'|'video'` renvoyé par le serveur. |
| UI | Lit déjà `remoteScreenStore` / `localScreenStore`. |

Ce qui MANQUE, c'est le milieu du tuyau (détaillé §5).

---

## 4. Décisions de conception (tranchées, à valider)

### D1 — Codec : **VP8**
- VP8 : supporté partout (tous navigateurs), libre de droits, défaut mediasoup.
- H264 : meilleur sur certains encodeurs matériels mais licences + complexité.
- **Tranché : VP8 pour v1.** H264 possible plus tard sans casser l'archi.

### D2 — Simulcast : **v1 = 1 couche, simulcast en v1.1**
- Le CDC §6 veut le simulcast (servir à chacun la couche adaptée). C'est la
  finalité, mais ça ajoute une vraie complexité (3 encodages, sélection de couche
  par consumer selon la bande passante).
- **Tranché : v1 = une seule couche haute qualité** (le screenshare est souvent
  statique = compresse très bien), pour prouver le chemin de bout en bout et livrer
  vite un partage d'écran visible via SFU. **Simulcast = v1.1**, chantier suivant.

### D3 — Déclenchement : **v1 = SFU screenshare uniquement si canal DÉJÀ en SFU**
- Option couplée : démarrer un partage d'écran DÉCLENCHE la bascule mesh→SFU (c'est
  le scénario où le mesh meurt). Séduisant mais couple deux features.
- **Tranché : v1 découplé.** Screenshare SFU seulement quand le canal est déjà en
  mode SFU (bascule audio active). En mode mesh → screenshare mesh actuel intact.
  Le « screenshare déclenche la bascule » = v1.1 (une fois v1 prouvée).

### D4 — Plusieurs partageurs simultanés : **autorisé** (gratuit dans le modèle SFU)
- Chaque partage = un producer vidéo de plus. `remoteScreenStore` est déjà une Map.
  Pas de limite artificielle. L'UI affiche chaque écran distant.

---

## 5. Ce qu'il faut construire (le milieu du tuyau)

### 5-A · Moteur Rust (`nodyx-sfu-mediasoup/engine.rs`) — sanctuaire
1. Ajouter une capability **VP8** (`vp8_capability()`) au router, à côté d'Opus :
   `create_router(RouterOptions::new(vec![opus_capability(), vp8_capability()]))`.
2. `produce` : lever le refus non-audio (ligne 501). Pour `Screen`/`Cam`, construire
   `ProducerOptions::new(MediaKind::Video, rtp)` à partir des `rtpParameters` client.
   (En WebRTC les rtpParameters viennent du navigateur, comme pour l'audio.)
3. `consume` : déjà générique (sert le producer par id). Vérifier qu'il n'a pas de
   supposition audio. `consumer_caps` gère déjà la vidéo.
4. Tests Rust : produce/consume vidéo sur un router VP8 (labo, zéro prod).

### 5-B · Relais core (`socket/…`) — passe-plat
- Les events `voice:sfu_produce`/`voice:sfu_consume`/`voice:sfu_new_producer`
  portent déjà `kind`. Vérifier que le relais vers `/v1/produce` du daemon passe
  `kind` sans le forcer à `audio`. Probablement déjà opaque : à confirmer.

### 5-C · Client SFU (`voiceSfu.ts`)
1. `sfuStartScreenShare()` : `getDisplayMedia` → `sendTransport.produce({track})` en
   `kind:'video'`. Lever le refus ligne 213 (`kind !== 'audio'`). Émettre
   `voice:sfu_produce {kind:'video', rtpParameters}`. `localScreenStore.set(stream)`.
2. `sfuStopScreenShare()` : `producer.close()`, stop tracks, vider `localScreenStore`.
3. `consumeOne` : si `kind==='video'`, router `consumer.track` vers
   `remoteScreenStore` (Map keyée par socketId via userId→socketId, comme la bascule
   audio) au lieu d'un `<audio>`. À la fermeture du consumer → retirer du store.

### 5-D · Orchestration (`voiceBascule.ts` + `voice.ts` borné)
- Un bouton « partager l'écran » qui, si `_channelMode==='sfu'`, appelle
  `sfuStartScreenShare` ; sinon garde le mesh. Le mapping userId→socketId pour
  `remoteScreenStore` réutilise le roster déjà présent (comme `peerStatsStore`).

### 5-E · Stats / labels (mineur)
- Étendre le panneau : afficher le partageur, éventuellement le bitrate servi.

---

## 6. Phasage (livrable par livrable)

| Phase | Contenu | Testable |
|---|---|---|
| **P2-A** | Moteur : VP8 router + produce/consume vidéo + tests Rust | Labo isolé, zéro risque prod |
| **P2-B** | Client : produce screenshare + consume vidéo → `remoteScreenStore` | /admin/sfu-lab |
| **P2-C** | Orchestration bouton + mapping roster + UI branchée | Canal « Réunion » en SFU |
| **P2-D** | Simulcast 3 couches + `preferredLayers` par bande passante | 1 partageur + N spectateurs |
| **P2-E** | Screenshare déclenche la bascule mesh→SFU (v1.1) | Prod élargie |

**Cette session** : valider ce CDC, puis démarrer **P2-A** (moteur vidéo, isolable
au labo, aucun risque pour la prod audio qui tourne).

---

## 7. Risques / garde-fous

- **NE JAMAIS** `pkill -f mediasoup-worker` (tue le worker prod). Redéploiement
  binaire = `mv` (ETXTBSY), jamais `cp`.
- Le chemin audio SFU en prod (canal Réunion) ne doit pas régresser : VP8 s'AJOUTE
  aux caps, ne remplace pas Opus. Tests audio à re-passer après P2-A.
- Screenshare mesh intact tant que P2-E n'est pas là : filet si le SFU vidéo déçoit.
- CPU : la vidéo coûte plus que l'audio. Le pool de workers (PR #240, 6 workers +
  réserve) absorbe ; mesurer avant d'élargir.
