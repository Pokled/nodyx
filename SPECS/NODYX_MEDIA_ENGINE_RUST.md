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

Une pile ICE complète (candidate : **`webrtc-rs`**) **cherche activement** un chemin : elle
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

- **D1** : Brique ICE/WebRTC : `webrtc-rs` (str0m ? autre ?) → comparer maturité SFU, ICE
  complet, simulcast, SVC.
- **D2** : Le trait `MediaEngine` suffit-il, ou faut-il l'élargir (candidats ICE, événements
  de connectivité, relais TURN) ?
- **D3** : TURN intégré : `nexus-turn` suffit-il comme repli CGNAT, ou faut-il le lier au
  moteur natif ?
- **D4** : WireGuard : géré par Nodyx (montée/descente automatique du lien) ou pré-requis
  admin ? Découverte des nœuds (DHT/gossip = Phase 3.0-D) ou config statique d'abord ?
- **D5** : Codecs : VP8/Opus (déjà) ; H264/VP9/AV1 ? Simulcast/SVC natif.
- **D6** : Périmètre du premier jalon : audio seul d'abord (comme P1), ou audio+vidéo direct ?

---

## 9. PHASAGE (proposé, à ajuster)

| Phase | Contenu | Preuve |
|---|---|---|
| **A** | Spike `webrtc-rs` : un flux audio de bout en bout, ICE complet, **derrière le trait** | labo isolé |
| **B** | Adaptateur `NativeRustEngine` complet (produce/consume, transports, ICE) | parité audio avec mediasoup |
| **C** | Perçage de NAT prouvé : un serveur derrière une box réelle, **sans port ouvert** | test terrain |
| **D** | Vidéo + simulcast natifs | 1 partageur + N spectateurs |
| **E** | Fédération WireGuard (nœud relais choisi) pour les CGNAT | test CGNAT réel |
| **F** | Bascule mediasoup → natif par défaut, puis retrait de mediasoup | soak + rollout |

---

## 10. Risques

- **Maturité** : `webrtc-rs` est-il assez mûr pour un SFU de prod ? (D1 = investigation dure).
- **Perçage réel** : le hole punching marche en labo mais échoue sur certains NAT ; mesurer le
  taux de succès sur du terrain varié AVANT de promettre.
- **Effort** : c'est le plus gros chantier depuis le début. Le trait le rend faisable, pas
  petit. Découper en jalons prouvables, ne jamais tout jouer d'un coup.
- **Ne pas confondre** confort de dev (Rust) et topologie réseau (ICE) : la valeur est dans
  l'ICE complet, pas dans le langage.
