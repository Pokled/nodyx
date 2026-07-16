# CDC : MediaEngine Rust natif + WireGuard (promesse zéro-port)

> Statut : **SQUELETTE, en conception. À remplir collaborativement (piloté via le module Tâches).**
> Réf. : `memory/project_promesse_zero_port.md`, `NODYX_SFU_CDC.md`, `docs/en/ROADMAP.md` (Phase 3.0-D).

---

## 1. La promesse (le POURQUOI, non négociable)

**Un auto-hébergeur ne doit JAMAIS avoir à ouvrir un port sur sa box.** Décision fondatrice
(Jonathan, 2026-07-14). Demander une redirection de ports, c'est perdre l'utilisateur : la
plupart ne sauront pas, n'oseront pas, ou n'auront pas accès à leur box. Une plateforme
auto-hébergée qui exige une config réseau n'est pas vraiment auto-hébergeable.

Aujourd'hui c'est tenu pour le **web** (tunnel Cloudflare, HTTP sortant) mais PAS pour le
**vocal/vidéo** : le SFU exige des ports média joignables. Ce CDC lève ce dernier verrou.

---

## 2. Le VERROU : mediasoup est « ICE-Lite »

mediasoup **ne fait que RÉPONDRE**. Il n'a aucune initiative réseau : il attend qu'on vienne
le chercher, il ne va jamais vers l'autre. D'où l'obligation d'une IP publique + ports ouverts.

**Ce n'est PAS un problème de langage** (C++ vs Rust ne crée aucune IP publique). C'est un
problème d'ICE-Lite. Réécrire mediasoup en Rust « pour le confort » raterait la cible ; c'est
l'ICE COMPLET qui compte.

---

## 3. La CIBLE : une pile ICE complète

Une pile ICE complète (retenue : **`str0m`**, cf. §8.1 ; plan B : `webrtc-rs`) **cherche activement** un chemin : elle
sonde, découvre son adresse vue de l'extérieur (STUN), et **perce le NAT** (hole punching).
C'est exactement ce que font deux navigateurs derrière deux box qui se parlent en direct,
sans que personne n'ouvre un port. Le vocal MESH actuel de Nodyx fait déjà ça.

Un SFU à ICE complet peut donc **percer le NAT de la box** : un serveur à la maison devient
joignable **sans redirection de ports**.

⇒ Le chantier `NativeRustEngine` n'est PLUS un confort. **C'est la condition d'existence de
l'auto-hébergement maison.**

---

## 4. LE LEVIER QU'ON A DÉJÀ : le trait `MediaEngine` (port hexagonal)

C'est le point le plus important, et la meilleure nouvelle. L'architecture SFU (CDC §18) est
**hexagonale** : `VoiceService` (métier) → `MediaEngine` (port) → adaptateur.

- `MediasoupEngine` est **UN** adaptateur derrière ce port.
- Le moteur Rust natif serait **un second adaptateur** derrière le **MÊME** trait.

**La migration n'est donc pas une réécriture, c'est un second adaptateur** qu'on branche par
configuration, en gardant les deux pendant la transition. Tout le métier (bascule, seats,
heartbeat, screenshare, simulcast…) reste **inchangé**. On a payé cette abstraction au spike,
elle rembourse ici.

> À VÉRIFIER : le trait `MediaEngine` couvre-t-il tout ce dont un moteur natif a besoin, ou
> a-t-il des fuites d'abstraction propres à mediasoup (le « CodecAdapter » identifié au CDC) ?
> → première carte d'investigation.

---

## 5. Le rôle de WireGuard (à ne PAS confondre avec le perçage de NAT)

⚠ **WireGuard ne perce PAS le NAT pour les navigateurs.** Les navigateurs des utilisateurs ne
sont pas des pairs WireGuard : ils parlent WebRTC. WireGuard chiffre un tunnel entre des
machines **qui se sont déjà trouvées** ; il ne rend pas joignable une machine qui ne l'est pas.

WireGuard sert la **FÉDÉRATION ENTRE INSTANCES** :
- relier deux instances/nœuds SFU par un lien chiffré (ex. une maison + un petit VPS relais,
  ou deux communautés qui s'interconnectent) ;
- le média inter-nœuds passe par ce lien, jamais en clair sur internet.

On a déjà la primitive : `pipe_to_remote` (relais SFU→SFU), **prouvée au spike mediasoup**.

**Souveraineté** : le relais éventuel doit être **CHOISI** (le VPS de l'utilisateur, celui d'un
ami, un nœud communautaire), **jamais imposé**, **jamais une dépendance à nodyx.org**.

---

## 6. Les LIMITES honnêtes (ne jamais les cacher)

Le perçage de NAT échoue quand **les DEUX bouts** sont derrière un NAT symétrique / CGNAT
(ex. serveur en fibre CGNAT + visiteur en 4G). C'est ~10-20 % des cas en WebRTC. Aucune
technique ne perce ça, ni en Rust ni ailleurs.

Ces cas-là auront **toujours** besoin d'un relais avec une IP publique (TURN, ou un nœud SFU
fédéré via WireGuard). On a `nexus-turn` (STUN/TURN Rust). **Le relais reste choisi, jamais
imposé.** On passe de « TOUS les serveurs maison sont exclus » à « seuls les CGNAT doubles le
sont, et ils ont une porte de sortie souveraine ». Changement de nature.

---

## 7. Stratégie de migration (progressive, réversible)

1. **Adaptateur en parallèle** : `NativeRustEngine: MediaEngine`, choisi par un flag (comme
   tout le reste chez nous). mediasoup reste le défaut tant que le natif n'est pas prouvé.
2. **Preuve par isolation d'abord** (labo `/admin/sfu-lab`), puis un canal, puis élargir,
   exactement le chemin qui a marché pour la bascule et le screenshare.
3. **Vérité par la mesure** : réutiliser l'instrument daemon (`/v1/subscriptions`, audit ICE,
   couches) pour prouver que le natif tient, avant d'exposer un utilisateur.
4. mediasoup ne disparaît que le jour où le natif est prouvé au moins équivalent.

---

## 8. DÉCISIONS À TRANCHER (à remplir ensemble)

- **D1** : Brique ICE/WebRTC. **ANALYSE FAITE (2026-07-16), verdict proposé : `str0m`,
  à CONFIRMER par le spike de la Phase A.** Voir §8.1.
- **D2** : Le trait `MediaEngine` suffit-il, ou faut-il l'élargir (candidats ICE, événements
  de connectivité, relais TURN) ?
- **D3** : TURN intégré : `nexus-turn` suffit-il comme repli CGNAT, ou faut-il le lier au
  moteur natif ?
- **D4** : WireGuard. **Réponse proposée (2026-07-16)** : en Phase E v1, le tunnel est
  **préconfiguré par l'administrateur** (clés échangées hors bande, configuration statique,
  Nodyx CONSOMME un tunnel existant). L'orchestration automatique (échange de clés, rotation,
  découverte DHT/gossip = Phase 3.0-D) viendra APRÈS : ce n'est pas le verrou actuel, et
  personne ne doit partir construire un orchestrateur avant que le perçage soit prouvé.
- **D5** : Codecs : VP8/Opus (déjà) ; H264/VP9/AV1 ? Simulcast/SVC natif.
- **D6** : Périmètre du premier jalon : audio seul d'abord (comme P1), ou audio+vidéo direct ?

### 8.1 D1, l'analyse (faits vérifiés le 2026-07-16, pas des dires d'IA)

Point de départ : une analyse DeepSeek fournie par Jonathan (« à prendre avec des
pincettes »). Tout ce qui suit a été REVÉRIFIÉ à la source (crates.io, dépôts GitHub).

**Les faits, vérifiés :**

| Critère | `str0m` | `webrtc-rs` (v0.17) | `rustrtc` |
|---|---|---|---|
| **ICE COMPLET (notre critère n°1)** | **OUI, par défaut** (`set_ice_lite(true)` est l'option, pas l'inverse) + tests d'ICE restart | OUI (héritage Pion) | à vérifier |
| Architecture | **Sans-IO** (machine à états pure, on possède les sockets) | callbacks + verrous internes, critiquée | jeune |
| Simulcast | OUI (table des features du README) | partiel historiquement | inconnu |
| Estimation de bande passante | module `bwe/` dédié | oui | inconnu |
| Vitalité | v0.21, push la veille, 1,47 M téléchargements, prod chez Lookback | v0.17.1, push la veille, 5 M téléchargements | v0.3.x, **9 861 téléchargements** |

**Ce que l'analyse DeepSeek avait juste** : l'architecture Sans-IO de str0m, les critiques
structurelles de webrtc-rs, la jeunesse de rustrtc. **Ce qu'elle avait raté** : elle n'a
jamais évalué l'ICE complet, qui est TOUTE la raison d'être de ce chantier.

**L'argument Sans-IO a un poids SPÉCIFIQUE à Nodyx** que l'analyse générique ne pouvait
pas voir. Sans-IO = la brique ne touche jamais au réseau, elle consomme et produit des
datagrammes ; c'est NOUS qui possédons les sockets. Conséquences :

1. **Multiplexage mono-port possible** : tout le média sur UN SEUL port UDP (au lieu de
   la plage 40000-40999), et un repli TCP qu'on implémente nous-mêmes. Surface pare-feu
   minimale, install encore plus simple.
2. **Le média peut voyager sur N'IMPORTE QUEL transport qu'on contrôle, y compris un
   tunnel WireGuard** (Phase E, fédération) : on donne les datagrammes au tunnel au lieu
   d'un socket UDP, str0m n'en sait rien. L'intégration WireGuard devient naturelle au
   lieu d'être un contournement.
3. Cohérent avec notre doctrine d'instrumentation : on voit chaque paquet passer.

**Réserves honnêtes** : communauté plus petite que webrtc-rs (579 étoiles contre 5083),
donc moins de DIVERSITÉ d'utilisateurs pour débusquer les bugs profonds (DTLS, SRTP, ICE) ;
un retour signale une latence sur le premier paquet DataChannel (~1,5 s), peu pertinent pour
nous (le média passe en RTP) mais noté ; la promesse d'un webrtc-rs v0.20 « Sans-IO » existe,
mais on ne construit pas sur une promesse.

**Le risque dépendances, rendu MESURABLE** (plutôt qu'un tableau non vérifié) : pendant les
Phases A et B, auditer chaque dépendance critique de str0m (STUN, DTLS, SRTP, ICE) sur cinq
points : activité récente, tests, rythme de publication, mainteneur identifiable, et
stratégie de fork si nécessaire. Autrement dit : **assumer consciemment qu'on devient
capables de maintenir une dépendance si un bug profond l'exige.** L'inventaire réel des
dépendances se fait au spike (Cargo.lock en main), pas sur des affirmations d'IA.

**Verdict proposé** : `str0m` candidat principal. **La décision n'est confirmée que par
le spike de la Phase A**, dont le critère de succès est LE nôtre : un endpoint str0m
derrière un vrai NAT établit la connexion avec un navigateur **sans aucune redirection
de port** (perçage mesuré, pas supposé). `webrtc-rs` v0.17 = plan B si le spike échoue.
`rustrtc` = à surveiller, pas à adopter.

---

## 9. PHASAGE (proposé, à ajuster)

| Phase | Contenu | Preuve |
|---|---|---|
| **A** | Spike `str0m` : un flux audio de bout en bout, ICE complet, **derrière le trait** (échec → même protocole avec `webrtc-rs`, plan B) | protocole §9.1 |
| **B** | Adaptateur `NativeRustEngine` complet (produce/consume, transports, ICE) | parité audio avec mediasoup |
| **C** | Perçage de NAT prouvé : un serveur derrière une box réelle, **sans port ouvert** | test terrain |
| **D** | Vidéo + simulcast natifs | 1 partageur + N spectateurs |
| **E** | Fédération WireGuard (nœud relais choisi) pour les CGNAT | test CGNAT réel |
| **F** | Bascule mediasoup → natif par défaut, puis retrait de mediasoup | grille §9.2 + soak |

### 9.1 Protocole du spike Phase A (l'expérience falsifiable)

Un seul essai sur une seule box ne prouve rien : les NAT diffèrent (Full Cone, Restricted,
Port Restricted, Symmetric), et le perçage échoue sur le dernier. Le but n'est pas 200
essais, c'est une **première photographie réelle**.

**Matrice minimale** (étendue si l'occasion se présente) :
1. box résidentielle FTTH, FAI n°1 ;
2. box résidentielle FTTH, FAI n°2 (les box des FAI français ont des NAT différents) ;
3. partage de connexion 4G/5G (souvent le plus dur : CGNAT opérateur) ;
4. si possible, un cas CGNAT identifié des deux côtés (la limite connue du §6).

**Chaque essai documente** : type de réseau · candidats ICE émis · **type du candidat
gagnant (host / srflx / relay)** · temps d'établissement · succès ou échec · journaux ICE.
Le type du candidat gagnant est LA donnée : `srflx` = perçage réel ; `relay` = on est passé
par TURN, ce n'est PAS un perçage.

**Verdict** : str0m est confirmé si le perçage réussit sur les réseaux résidentiels (1 et 2)
et que les échecs restants correspondent aux limites connues du §6. Sinon, même protocole
avec `webrtc-rs`, et comparaison factuelle.

**Critères d'ARRÊT (« kill criteria »).** Un bon protocole définit ses conditions d'échec
autant que ses conditions de réussite, sinon on s'accroche indéfiniment à « ça va finir par
marcher ». Le spike str0m est déclaré en échec si l'un de ces cas est observé :

1. **impossibilité reproductible** d'établir une session sur plusieurs NAT résidentiels
   alors que le même protocole réussit avec `webrtc-rs` (l'architecture Sans-IO ne
   compense pas un défaut de perçage) ;
2. **limitation architecturale** empêchant d'implémenter le trait `MediaEngine` sans
   contournements majeurs (fuite d'abstraction rédhibitoire) ;
3. **instabilité ou bug bloquant** dans str0m ou une de ses dépendances, non corrigeable
   dans un délai raisonnable et hors de notre capacité de patch/fork.

Dans ces cas : exécuter le plan B (`webrtc-rs`) avec le MÊME protocole, puis rouvrir D1 avec
les mesures des deux côtés. L'échec du spike n'est pas l'échec du chantier : c'est le
protocole qui fait son travail.

### 9.2 Critères de sortie de migration (« équivalent » a une définition)

Sans grille, « mediasoup ne disparaît que le jour où le natif est équivalent » n'a pas de
réponse objective : le jour peut être repoussé indéfiniment, ou déclaré trop tôt. Le moteur
natif est déclaré équivalent quand il satisfait TOUT ceci, simultanément :

| Domaine | Critère |
|---|---|
| Fonctionnel | audio, vidéo, simulcast, partage d'écran (avec son), ICE restart |
| Réseau | taux de connexion ≥ mediasoup sur le même panel de NAT (§9.1) |
| Performance | CPU ≤ mediasoup ± 10 % à charge égale (bench sfu-bench rejoué) |
| Latence | RTT et gigue comparables (instrument daemon) |
| Robustesse | soak 72 h sans fuite mémoire ni crash (méthode du soak SFU) |
| Observabilité | audit ICE, /v1/subscriptions, couches servies : au moins équivalents |
| Réversibilité | retour à mediasoup par simple flag, à tout moment |

Et seulement après : mediasoup cesse d'être le défaut, puis est retiré.

---

## 10. Risques

- **Maturité** : `webrtc-rs` est-il assez mûr pour un SFU de prod ? (D1 = investigation dure).
- **Perçage réel** : le hole punching marche en labo mais échoue sur certains NAT ; mesurer le
  taux de succès sur du terrain varié AVANT de promettre.
- **Effort** : c'est le plus gros chantier depuis le début. Le trait le rend faisable, pas
  petit. Découper en jalons prouvables, ne jamais tout jouer d'un coup.
- **Ne pas confondre** confort de dev (Rust) et topologie réseau (ICE) : la valeur est dans
  l'ICE complet, pas dans le langage.

---

## 11. Partage et remerciements (communauté Rust)

Ce moteur s'appuiera sur le travail de la communauté Rust (webrtc-rs ou str0m, l'écosystème
async, les crates STUN/ICE). Quand il sera prouvé, on veut :

- lui donner une **page dédiée** qui explique l'approche et **remercie** les projets sur
  lesquels il repose, sans prétention ;
- envisager de sortir la partie réutilisable en **crate ouverte** (le cœur du produit reste
  AGPL sur Nodyx ; une brique moteur générique pourrait être partagée sous une licence
  adaptée, à décider), pour qu'elle serve à d'autres auto-hébergeurs ;
- documenter **honnêtement** ce qui marche et ce qui ne marche pas (le taux de perçage réel
  mesuré), pour que ce soit utile et pas un argument marketing.

C'est cohérent avec l'ADN du projet : rendre à l'écosystème ce qu'il nous a donné. Et si ça
sert un jour à d'autres, tant mieux.
