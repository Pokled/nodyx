# Spike Phase A — str0m perce-t-il le NAT sans port ouvert ?

Ce crate répond à UNE question, posée par `SPECS/NODYX_MEDIA_ENGINE_RUST.md` (§9.1) :
**un serveur derrière une vraie box résidentielle est-il joignable par un navigateur, sans
qu'aucun port ne soit ouvert manuellement sur le routeur ?**

Il ne remplace rien en production. `nodyx-sfud` (mediasoup) continue de tourner exactement
comme avant, ce crate est hors du workspace Cargo (`nodyx-p2p/Cargo.toml`, `exclude`), un
`cargo build` normal du dépôt ne le touche jamais.

## Ce qui a déjà été vérifié (en session, prouvé, pas supposé)

- Le crate compile proprement (`cargo build`, `cargo clippy` : zéro avertissement).
- Le client STUN maison (`src/stun.rs`) a été testé contre `nexus-turn`, **le vrai serveur de
  prod**, deux fois : en boucle locale et via l'IP publique réelle du VPS (`46.225.20.193:3478`).
  Les deux fois, une adresse `server-reflexive` cohérente a été obtenue. 4 tests unitaires
  supplémentaires couvrent le protocole (parsing XOR-MAPPED-ADDRESS, rejet d'une transaction ID
  ou d'un cookie magique invalide).
- Le build `release` natif (glibc) fonctionne (`cargo build --release --bin nat-probe`).

## Ce qui N'A PAS pu être vérifié en session, et pourquoi

- **Le perçage NAT lui-même.** Ce VPS a une IP publique directe, aucun NAT en face : un test
  ici prouverait seulement que le code fonctionne, jamais qu'il perce quoi que ce soit. Le CDC
  est explicite là-dessus (§9.1) : la preuve n'existe que sur un vrai réseau résidentiel.
- **Un aller-retour complet avec un vrai navigateur.** Pas de navigateur pilotable dans cet
  environnement. Le code suit fidèlement `examples/chat.rs` du dépôt officiel `algesten/str0m`
  (même construction `Rtc`, mêmes types `Input`/`Output`/`Event`), mais ce round-trip précis
  reste à faire une première fois par toi.
- **Le binaire livrable pour ta machine.** Aucune cible `musl` n'est installée dans cet
  environnement (`rustup target list --installed` ne montre que du glibc), et il n'y a pas de
  toolchain C pour cross-compiler en statique. Deux options, à trancher ensemble :
  1. Tu as `cargo`/Rust sur la machine qui va tourner derrière ta box → tu clones et tu
     `cargo build --release --bin nat-probe` toi-même, aucun souci de cross-compilation.
  2. Tu n'as pas de toolchain Rust sur cette machine → dis-moi l'architecture exacte (x86_64 ?
     ARM/Raspberry Pi ?) et je prépare une vraie cross-compilation la prochaine session.

## Protocole de test (CDC §9.1) — à toi de jouer

### Avant de commencer
1. Sur la machine qui va jouer le rôle du serveur (chez toi, derrière ta box) :
   ```
   cd nodyx-p2p/crates/nodyx-sfu-str0m
   cargo build --release --bin nat-probe
   ```
2. Ouvre `src/bin/probe.html` dans un navigateur — **sur un autre appareil, sur un autre
   réseau physique** (ex. ton téléphone en 4G avec le wifi coupé). Si tu testes depuis le même
   wifi que la box, tu ne testes rien : le trafic ne sort jamais vraiment du réseau local.
3. Modifie la ligne `const STUN_URL = 'stun:CHANGE_ME:3478';` dans `probe.html` avec l'adresse
   IP publique réelle du serveur STUN à utiliser (`nexus-turn` en prod sur `46.225.20.193:3478`,
   ou un autre si tu préfères).

### Lancer un essai
```
./target/release/nat-probe \
  --label ftth-free-1 \
  --network "FTTH Free" \
  --stun 46.225.20.193:3478
```
Le binaire affiche l'adresse `srflx` découverte, puis attend une offre SDP sur son entrée
standard (colle le contenu de la case « 1. Générer l'offre » de la page, puis Ctrl+D). Il
imprime une réponse à coller dans la case 2 de la page, puis attend la connexion ICE (jusqu'à
60 secondes par défaut, `--timeout-secs` pour changer).

### Ce que ça produit
- Un fichier `essai-ftth-free-1.jsonl` (un événement par ligne, détail complet).
- Une ligne-résumé imprimée à la fin, du style :
  ```
  [ftth-free-1] réseau=FTTH Free · candidat gagnant=srflx (PERÇAGE RÉEL) · établi en 2.87s · succès
  ```
  **C'est cette ligne qui compte.** `srflx` = perçage réel, sans port ouvert. `relay` = un
  relais TURN a été utilisé, ce n'est PAS un perçage (attendu si les deux côtés sont en CGNAT,
  cf. limite honnête du CDC §6). `host` = pas de NAT du tout entre les deux (même réseau local
  — signe que le test n'était pas valide, recommence depuis un vrai réseau externe).

### Le tableau à remplir (colle une ligne-résumé par essai)

| # | Réseau testé | Candidat gagnant | Verdict | Temps d'établissement | Succès |
|---|---|---|---|---|---|
| 1 | box résidentielle FTTH, FAI n°1 | | | | |
| 2 | box résidentielle FTTH, FAI n°2 | | | | |
| 3 | partage de connexion 4G/5G | | | | |
| 4 | (si possible) CGNAT des deux côtés | | | | |

### Verdict (CDC §9.1)
`str0m` est confirmé si le perçage réussit sur les essais 1 et 2 (réseaux résidentiels), et que
les échecs restants correspondent aux limites connues (§6 : CGNAT double). Le spike est déclaré
en échec si l'un des critères d'arrêt suivants est observé :
1. impossibilité reproductible d'établir une session sur plusieurs NAT résidentiels ;
2. limitation architecturale rédhibitoire dans l'implémentation du trait (voir `trait-spike`,
   pas encore livré cette session) ;
3. bug bloquant dans str0m ou une dépendance, non corrigeable dans un délai raisonnable.

Dans ce cas : même protocole avec `webrtc-rs` (plan B), rouvrir D1 avec les deux mesures.

## Isolation garantie pendant le test
- Crate hors workspace : aucun `cargo build` du dépôt principal ne le compile.
- Port UDP éphémère (`--port 0` par défaut), jamais la plage `40000-40999` réservée à
  `nodyx-sfud` (mediasoup, prod).
- Aucun service systemd installé par ce crate : tu le lances à la main, tu l'arrêtes à la main.
- `nodyx-sfud` (prod) n'est ni modifié ni redémarré par quoi que ce soit ici.
