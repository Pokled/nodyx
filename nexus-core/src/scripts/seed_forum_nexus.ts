/**
 * NEXUS — Forum seed : histoire et évolution de Nexus
 *
 * Crée les catégories, sous-catégories et fils de discussion
 * autour du développement de Nexus, postés par Pokled.
 *
 * Usage:
 *   cd nexus-core
 *   npx tsx src/scripts/seed_forum_nexus.ts
 *   npx tsx src/scripts/seed_forum_nexus.ts --reset  (supprime les catégories créées)
 */

import * as dotenv from 'dotenv'
dotenv.config()

import { db, redis } from '../config/database'

const RESET = process.argv.includes('--reset')

// ── Config ───────────────────────────────────────────────────────────────────

const COMMUNITY_SLUG = process.env.NEXUS_COMMUNITY_SLUG ?? 'nexusnode'
const AUTHOR_USERNAME = 'Pokled'

// ── Contenu ──────────────────────────────────────────────────────────────────

interface ThreadDef {
  title: string
  category: string      // nom de la catégorie (ou "parent > enfant")
  featured?: boolean
  posts: string[]       // premier élément = OP
}

const CATEGORIES = [
  {
    name: '📣 Annonces',
    description: 'Nouvelles officielles, releases et événements importants de Nexus.',
    children: [],
  },
  {
    name: '🚀 Développement',
    description: 'Suivi du développement, nouvelles fonctionnalités et architecture technique.',
    children: [
      { name: 'Nouvelles fonctionnalités', description: 'Présentation et retours sur les nouvelles features.' },
      { name: 'Bugs & correctifs',         description: 'Rapport de bugs, correctifs appliqués, post-mortems.' },
      { name: 'Architecture & technique',  description: 'Choix techniques, stack, décisions d\'architecture.' },
    ],
  },
  {
    name: '💬 Discussions',
    description: 'Échanges libres autour de Nexus et de sa communauté.',
    children: [
      { name: 'Général',        description: 'Tout ce qui ne rentre pas ailleurs.' },
      { name: 'Présentations',  description: 'Dites bonjour ! Qui êtes-vous ?' },
    ],
  },
  {
    name: '💡 Idées & Retours',
    description: 'Vos suggestions, idées de features et retours d\'expérience.',
    children: [],
  },
  {
    name: '📚 Guides & Documentation',
    description: 'Tutoriels, guides d\'installation et documentation pratique.',
    children: [],
  },
]

const THREADS: ThreadDef[] = [

  // ── 📣 Annonces ────────────────────────────────────────────────────────────

  {
    title: '🎉 Nexus v0.9 — WebRTC P2P mesh, partage d\'écran, NexusCanvas',
    category: '📣 Annonces',
    featured: true,
    posts: [
      `**Nexus v0.9 vient d'être déployé.** C'est une version majeure.

Voilà ce qui change concrètement :

**WebRTC P2P mesh complet**
Les salons vocaux fonctionnent maintenant en maille directe : chaque participant est connecté à chaque autre via une connexion peer-to-peer chiffrée. Aucun flux audio ne passe par le serveur. Nexus Core ne voit que la signalisation (qui veut parler à qui) — jamais le contenu.

**nexus-turn : notre propre serveur STUN/TURN**
Pour les connexions derrière des NAT stricts, on a écrit nexus-turn en Rust. Binaire de 2,9 MB, credentials HMAC-SHA1 time-based, UDP 3478. Déployé sur le VPS, disponible sur GitHub en release v0.1.0-turn (amd64 + arm64).

**Partage d'écran**
Le bouton 📺 dans la barre de contrôle vocal active le partage. Le stream apparaît dans le panel "Vidéo" du salon. Les streams distants sont reçus via les DataChannels WebRTC existants.

**NexusCanvas — tableau collaboratif P2P**
Le bouton 🎨 dans la barre vocale ouvre une surface de dessin partagée. Synchronisation CRDT Last-Write-Wins via les DataChannels. Curseurs distants avec halo de parole. Export PNG. Zéro backend — les données ne touchent jamais le serveur.

C'est une version qu'on attendait depuis longtemps. La prochaine étape : v1.0, la radio.`,

      `Magnifique release. Le NexusCanvas c'est vraiment une killer feature — je n'ai rien vu de comparable dans les outils de chat décentralisés.`,

      `Je viens de tester le partage d'écran avec un ami en NAT strict. Ca passe parfaitement via nexus-turn. Impressionnant pour un binaire Rust de 3MB.`,

      `La notion de CRDT pour le canvas est intéressante. LWW par élément c'est simple mais suffisant pour un tableau de brainstorm. Bravo.`,
    ],
  },

  {
    title: 'Nexus Relay — votre instance accessible depuis n\'importe où, sans ouvrir un port',
    category: '📣 Annonces',
    posts: [
      `**Nexus Relay est disponible.**

Le problème qu'on résout : beaucoup de gens veulent héberger leur instance Nexus depuis chez eux — mais leur FAI leur assigne une IP dynamique, bloque les ports entrants, ou met tout derrière un CGNAT.

nexus-relay est un service de tunnel TCP écrit en Rust. Il fonctionne en deux parties :

- **relay server** (sur notre VPS nexusnode.app) : écoute sur TCP 7443, reçoit les connexions clients
- **relay client** (sur votre machine) : se connecte au relay server avec un token et un slug unique, expose votre port 80 local

Quand quelqu'un visite \`votre-slug.nexusnode.app\`, Caddy proxy vers le relay server qui pipe le trafic HTTP vers votre relay client qui le transmet à votre Nexus local.

**Résultat concret** : un Raspberry Pi 4 chez soi, aucun port ouvert, aucun domaine — accessible via \`https://slug.nexusnode.app\` avec TLS Cloudflare.

Testé en conditions réelles : reconnexion automatique avec backoff exponentiel (1s → 2s → 4s → max 30s), traitement concurrent des requêtes, compatible Socket.IO long-polling et WebSocket.

Release : \`v0.1.1-relay\` sur GitHub (amd64 + arm64). Déjà intégré dans \`install.sh\`.`,

      `C'est exactement ce qu'il manquait. Les gens qui veulent self-host n'ont pas forcément un VPS. Un Pi à la maison c'est bien plus accessible.`,

      `La partie concurrent processing c'est crucial pour Socket.IO. Les long polls qui se bloquent mutuellement c'est une galère classique avec les tunnels naïfs.`,
    ],
  },

  {
    title: 'nexus-turn v0.1.0 — serveur STUN/TURN maison en Rust',
    category: '📣 Annonces',
    posts: [
      `**Nexus dispose maintenant de son propre serveur STUN/TURN.**

On a remplacé coturn (complexe à configurer, lourd) par nexus-turn — un binaire Rust de 2,9 MB qui fait exactement ce qu'il faut pour les connexions WebRTC de Nexus.

**Pourquoi c'était nécessaire**
WebRTC fonctionne en P2P direct dans 80% des cas. Mais pour les 20% restants (NAT symétrique, réseau d'entreprise, 4G/5G avec CGNAT), il faut un relais TURN. Sans ça, ces utilisateurs ne peuvent tout simplement pas rejoindre les salons vocaux.

**Architecture**
- STUN : répond aux Binding Requests (RFC 5389) — permet de découvrir son IP publique
- TURN : relaie le trafic UDP pour les cas difficiles (RFC 5766)
- Credentials : HMAC-SHA1 time-based (username = \`{expires}:{userId}\`, password = base64(HMAC-SHA1(secret, username)))
- Configurable via env vars : \`TURN_PUBLIC_IP\`, \`TURN_SECRET\`, \`TURN_PORT\`, \`TURN_TTL\`

**Validation**
Testé avec des Binding Requests STUN → réponse \`0x0101\` Success. Connexions vocales avec un utilisateur derrière CG-NAT → OK.

Le service tourne en systemd sur le VPS, UDP 3478 ouvert dans UFW. Les credentials sont distribués automatiquement par nexus-core via \`voice:init\`.`,

      `Chapeau pour l'implémentation propre. HMAC-SHA1 time-based c'est exactement le standard TURN — pas de gestion d'état, credentials auto-expirés, parfait.`,
    ],
  },

  // ── 🚀 Nouvelles fonctionnalités ──────────────────────────────────────────

  {
    title: 'DataChannels WebRTC P2P — typing instantané et réactions optimistes',
    category: '🚀 Développement > Nouvelles fonctionnalités',
    posts: [
      `**Phase 3.0-B : DataChannels P2P pour le chat en temps réel.**

Jusqu'ici, tout le chat passait par le serveur : message envoyé → Socket.IO → nexus-core → broadcast. Ça marche, mais il y a une latence et ça charge le serveur.

Avec les DataChannels WebRTC, les pairs déjà connectés en vocal peuvent s'envoyer des données directement — sans passer par le serveur.

**Ce qu'on a mis en place :**

\`\`\`
p2p.ts — gestionnaire de mesh DataChannels
├── Un DataChannel par pair (côté initiateur)
├── Réception via ondatachannel (côté répondeur)
├── File de messages en attente si channel pas encore ouvert
└── Reconnexion automatique si peer disparaît
\`\`\`

**Usages actuels :**
- **Typing indicators** : \`p2p:typing\` → instantané (pas de round-trip serveur)
- **Réactions emoji** : \`p2p:reaction\` → rendu optimiste immédiat chez tous les pairs
- **Canvas ops** : \`canvas:op\`, \`canvas:cursor\`, \`canvas:clear\` pour NexusCanvas

L'indicateur P2P dans le header chat (⚡ jaune) montre quand la connexion directe est établie. Le fallback Socket.IO reste toujours actif pour les cas sans P2P.`,

      `L'indicateur ⚡ P2P c'est un beau détail UX. L'utilisateur sait qu'il est "dans le mesh" — c'est concret, pas juste un concept marketing.`,

      `Question : est-ce que les DataChannels passent par le TURN si le P2P direct échoue ? Ou c'est uniquement sur connexion P2P réussie ?`,

      `Les DataChannels utilisent les mêmes ICE servers que les connexions audio. Donc oui, si la connexion P2P directe passe par TURN pour le son, les DataChannels passent aussi par TURN. La connexion est partagée.`,
    ],
  },

  {
    title: 'NexusCanvas — tableau collaboratif P2P embarqué dans le salon vocal',
    category: '🚀 Développement > Nouvelles fonctionnalités',
    posts: [
      `**NexusCanvas est la feature qui m'a le plus excité à coder.**

L'idée : quand tu parles avec des gens dans un salon vocal, tu peux ouvrir une surface de dessin partagée. Tout le monde dessine, voit les curseurs des autres, et tout est synchronisé en temps réel — P2P, sans serveur.

**Architecture CRDT (Last-Write-Wins par élément)**

Chaque tracé, sticky note ou forme est un \`CanvasElement\` avec un UUID et un timestamp. La règle de merge est simple : si deux peers ont modifié le même élément, celui avec le timestamp le plus récent gagne.

\`\`\`ts
type CanvasElement = {
  id: string      // UUID v4
  ts: number      // Date.now() — LWW
  author: string
  kind: 'path' | 'sticky' | 'rect' | 'circle'
  data: PathData | StickyData | ShapeData
  deleted?: boolean  // soft delete pour l'effaceur
}
\`\`\`

**Curseurs distants**
Chaque mouvement de souris est broadcasté aux pairs (throttle 50ms). Les curseurs distants affichent le username et pulsent avec un halo violet quand le peer parle (VAD détecté).

**Fin de session**
Quand tu fermes le canvas avec des éléments dedans : "Garder la table ?" → export PNG ou résumé dans le chat du canal. Zéro backend.

**Limitation v1.0**
Un peer qui rejoint en milieu de session ne reçoit pas l'historique (les ops arrivent seulement depuis sa connexion). La v1.1 ajoutera un \`canvas:full_sync\` au join.`,

      `Le soft delete avec \`deleted: true\` c'est exactement la bonne approche pour CRDT. Un hard delete créerait des conflits insolubles si un autre peer reçoit l'op de création après.`,

      `L'export PNG + résumé dans le chat c'est brilliant. Session éphémère par défaut mais avec une porte de sortie. Pas besoin de stocker quoi que ce soit.`,

      `J'ai testé à 3 sur le canvas ce matin. Les curseurs avec les halos vocaux c'est vraiment immersif. On se sent dans la même pièce.`,
    ],
  },

  {
    title: 'VoiceJukebox — la musique partagée dans les salons vocaux',
    category: '🚀 Développement > Nouvelles fonctionnalités',
    posts: [
      `**Le Jukebox vocal est en ligne.**

Fonctionnement : dans un salon vocal, n'importe quel membre peut ajouter une piste à la queue. Les pistes se jouent à la suite pour tous les participants connectés.

**Synchronisation**
Le serveur maintient l'état de la queue (piste courante, position temporelle). Quand un nouveau peer rejoint, il reçoit la position actuelle et peut se synchroniser. Pas de P2P pour ça — le serveur est la source de vérité.

**Sources supportées**
Pour l'instant : upload direct de fichiers audio (mp3, ogg, flac, wav). Le streaming YouTube/Spotify est intentionnellement absent — on ne veut pas de dépendance à des APIs propriétaires.

**Interface**
La toolbar du salon vocal a un bouton ♫ Jukebox. Quand une piste joue, il pulse en ambre. La queue montre les tracks avec l'auteur, la durée et le bouton de vote pour passer à la suivante.

Prochaine étape : support des URL de flux radio HLS/MP3 — ce qui ouvre la porte à NEXUS-RADIO.`,

      `La position temporelle partagée c'est la partie difficile. Comment gérez-vous la dérive si un client a un buffer différent ?`,

      `On envoie la position serveur en ms au join, le client scrub sa lecture. Il y a une dérive potentielle de quelques secondes entre pairs mais sur de la musique c'est imperceptible. Pour du voice chat synchronisé ce serait un problème, pas pour du jukebox.`,

      `Hâte de voir les URLs de flux radio. Je pense à une intégration avec SomaFM ou Radio Paradise — des stations qui ont une communauté forte.`,
    ],
  },

  // ── 🚀 Architecture & technique ──────────────────────────────────────────

  {
    title: 'Pourquoi Fastify v5 + SvelteKit 5 — nos choix de stack et retours après 6 mois',
    category: '🚀 Développement > Architecture & technique',
    posts: [
      `**Retour d'expérience sur la stack de Nexus après 6 mois de dev.**

Quand j'ai commencé Nexus, j'avais une contrainte forte : **une seule instance = une seule communauté**. Pas de multitenancy. Ça change tout dans les choix d'architecture.

**Fastify v5**
J'avais l'habitude d'Express mais Fastify a plusieurs avantages concrets :
- Schéma de validation JSON Schema natif → les routes sont auto-documentées
- Performances supérieures sur les petits payloads (ce qu'on a en forum/chat)
- Écosystème de plugins cohérent
- TypeScript first sans torsion

L'unique galère v5 : Socket.IO doit être attaché **après** \`server.listen()\`. Fastify v5 a changé le cycle de vie et le plugin fastify-socket.io ne suit pas encore. Solution : import direct de socket.io et \`io.attach(server.server)\` post-listen.

**SvelteKit 5**
Les runes (\`$state\`, \`$derived\`, \`$effect\`) ont transformé ma façon d'écrire les composants. Plus de stores verbeux pour les cas simples. La réactivité fine-grained est très agréable sur les panels complex (VoicePanel, NexusCanvas).

**PostgreSQL + Redis**
Choix sans regret. PG pour tout ce qui est persistant (forums, membres, assets), Redis pour les sessions JWT et la présence en ligne. Pas de MongoDB, pas d'ORM — du SQL direct avec \`pg\`. Ça reste lisible et maîtrisable.`,

      `Le point sur Socket.IO post-listen dans Fastify v5 m'a sauvé il y a quelques semaines. Je cherchais depuis des heures pourquoi mes events n'arrivaient pas.`,

      `Les runes Svelte 5 c'est vraiment une autre dimension. J'ai réécrit VoicePanel avec et le code est deux fois plus court pour le même comportement.`,

      `La contrainte "une instance = une communauté" c'est une décision forte mais cohérente avec la philosophie décentralisée. Pas de compromis de perf pour le multi-tenant.`,
    ],
  },

  {
    title: 'Architecture du mesh WebRTC — comment on gère N participants sans SFU',
    category: '🚀 Développement > Architecture & technique',
    posts: [
      `**Le mesh WebRTC de Nexus — choix, limitations, et pourquoi on s'y tient.**

Pour les non-initiés : il y a deux grandes architectures pour la VoIP P2P.

**Mesh (notre choix)**
Chaque participant est connecté à chaque autre. Si tu es dans un salon à 5, tu as 4 connexions WebRTC actives. Chacune est P2P chiffré.

\`\`\`
A ←→ B
A ←→ C
A ←→ D
B ←→ C
B ←→ D
C ←→ D
\`\`\`

**SFU (Selective Forwarding Unit)**
Chaque participant envoie son flux à un serveur central qui le redistribue. Meilleure scalabilité, mais le serveur voit les flux audio/vidéo.

**Pourquoi mesh ?**
1. **Confidentialité** : Nexus Core ne voit jamais les flux. Zéro donnée audio sur le serveur.
2. **Simplicité** : Pas besoin d'un service SFU (Mediasoup, Janus, Livekit). Nexus reste un binaire simple.
3. **Réalité d'usage** : les communautés Nexus ont des salons à 2-10 personnes. Pas besoin de scaler à 100.

**La limite en pratique**
Au-delà de 8-10 participants, la charge CPU côté client augmente (encodage × N). C'est acceptable pour notre cible.

Pour les très grandes instances si un jour ça arrive, on ajoutera un SFU optionnel. Mais ce n'est pas dans la roadmap v1.`,

      `La limite CPU client est réelle mais honnêtement pour des salons de discussion quotidiens on ne dépasse jamais 6-7 simultanés. Le mesh est le bon compromis.`,

      `J'apprécie la transparence sur les limitations. C'est rare de voir une doc technique qui dit clairement "ça ne scale pas au-delà de X".`,
    ],
  },

  // ── 🚀 Bugs & correctifs ──────────────────────────────────────────────────

  {
    title: 'Post-mortem : bug Relay — présence cassée avec 2+ utilisateurs',
    category: '🚀 Développement > Bugs & correctifs',
    posts: [
      `**Ce bug m'a pris 4 heures à diagnostiquer. Je le documente pour que personne ne reperde ce temps.**

**Symptôme**
Avec 2+ utilisateurs connectés via nexus-relay, la sidebar membres était vide. L'online count restait à 0. Les messages Socket.IO n'arrivaient pas.

**Root cause**
Le relay client traitait les requêtes HTTP **en séquence**. Socket.IO utilise du long-polling comme transport de fallback (GET bloquant pendant 8 secondes = pingInterval).

Avec 2 utilisateurs :
- User A : GET /socket.io/?sid=xxx → bloque 8s dans la queue TCP
- User B : GET /socket.io/?sid=yyy → attend que User A soit traité

Résultat : le relay server avait un timeout de 10s. La requête de User B expirait → 504 → Socket.IO se déconnectait → reconnect → même problème en boucle.

**Fix**
\`\`\`rust
// Avant : séquentiel
while let Some(req) = queue.recv().await {
    handle(req).await;  // bloque tout pendant 8s
}

// Après : concurrent
while let Some(req) = queue.recv().await {
    let writer = writer.clone();
    tokio::spawn(async move {
        handle(req, writer).await;
    });
}
\`\`\`

Chaque requête est traitée dans son propre task Tokio. L'écriture reste sérialisée via mpsc pour éviter les race conditions sur le socket TCP.

**Leçon**
Les timeouts en cascade sont insidieux. Le symptôme (sidebar vide) était loin de la cause (séquentialité du relay). Il faut toujours vérifier la couche transport en premier.`,

      `Le debugging distribué c'est ça — le symptôme et la cause sont dans des couches complètement différentes. Bonne documentation.`,

      `La solution tokio::spawn par requête c'est élégant. Et le mpsc pour sérialiser l'écriture TCP est exactement la bonne primitive.`,
    ],
  },

  {
    title: '[Fix] online_count toujours à 0 — mauvaise source de vérité',
    category: '🚀 Développement > Bugs & correctifs',
    posts: [
      `**Petit bug mais visible : le compteur "en ligne" sur la page d'accueil restait à 0.**

**Cause**
\`/api/v1/instance/info\` comptait les clés Redis \`nexus:heartbeat:*\` pour déterminer qui est en ligne. Ces clés sont posées par \`requireAuth\` middleware — donc uniquement quand l'utilisateur fait des appels API.

Problème : un utilisateur connecté mais inactif (lecture passive du forum) n'appelle pas l'API. Sa clé heartbeat expire après 15 minutes. Résultat : online_count = 0 même avec des gens connectés.

**Fix**
\`\`\`ts
// Avant : clés Redis (peu fiables)
const keys = await redis.keys('nexus:heartbeat:*')
const online_count = keys.length

// Après : sockets actifs (source de vérité)
const sockets = await io.in('presence').fetchSockets()
const userIds = new Set(sockets.map(s => s.data.userId))
const online_count = userIds.size
\`\`\`

Socket.IO maintient une room \`presence\` où tous les utilisateurs connectés sont présents. C'est la vraie source de vérité — pas les heartbeats API.`,

      `fetchSockets() c'est exactement l'outil pour ça. La room presence comme source de vérité c'est propre.`,
    ],
  },

  // ── 💬 Discussions ────────────────────────────────────────────────────────

  {
    title: 'La vision de Nexus — pourquoi on construit ça et où on va',
    category: '💬 Discussions > Général',
    posts: [
      `**Nexus existe parce qu'il n'existait rien qui fasse tout ça en un seul outil décentralisé.**

Discord : excellent UX, propriétaire, vos données chez eux, peut disparaître du jour au lendemain.
Matrix/Element : décentralisé ✅, mais UX complexe, lourd à auto-héberger.
Discourse : excellent pour les forums, mais pas de chat temps réel, pas de voix.
Mumble/Teamspeak : voix uniquement, pas de forum, pas de chat persistant.

**Nexus est le premier à faire les trois en même temps :**
- Forum classique avec catégories, fils, réponses, recherche
- Chat temps réel avec canaux texte, réactions, historique
- Voix P2P chiffrée avec partage d'écran, jukebox, tableau collaboratif

**La contrainte qui définit tout : une instance = une communauté.**
Pas de multitenancy. Ton instance Nexus c'est **ta** communauté. Tu contrôles les données, les règles, la modération. Tu peux la fermer, la migrer, la sauvegarder.

**La prochaine frontière : le réseau.**
Les instances Nexus ne sont pas encore interconnectées. On travaille sur le directory (nexusnode.app) qui recense toutes les instances actives. La phase 4 sera la fédération : un compte sur une instance, membre de plusieurs communautés.

Ce n'est pas Discord. Ce n'est pas Mastodon. C'est autre chose.`,

      `La contrainte "une instance = une communauté" est contre-intuitive au début mais en y réfléchissant c'est ce qui garantit la souveraineté. Impossible de diluer avec du multi-tenant.`,

      `La fédération c'est la vraie promesse. Pouvoir suivre des communautés d'autres instances sans créer un compte sur chacune. Un peu comme l'email : mon adresse gmail peut écrire à une adresse protonmail.`,

      `Ce qui me plaît dans la roadmap : les choix sont cohérents. On n'ajoute pas des features pour faire des features — chaque brique sert la vision décentralisée.`,
    ],
  },

  {
    title: 'Nexus vs Discord vs Matrix — ce qui nous différencie vraiment',
    category: '💬 Discussions > Général',
    posts: [
      `**Comparaison honnête. Pas de mauvaise foi dans un sens ou dans l'autre.**

| | Nexus | Discord | Matrix/Element |
|---|---|---|---|
| Auto-hébergeable | ✅ | ❌ | ✅ |
| Forum classique | ✅ | ❌ | ❌ |
| Chat temps réel | ✅ | ✅ | ✅ |
| Voix P2P | ✅ | Serveurs Discord | ✅ (Jitsi) |
| Données sur vos serveurs | ✅ | ❌ | ✅ |
| UX accessible | ✅ | ✅ | ⚠️ complexe |
| Licence | AGPL-3.0 | Propriétaire | Apache 2.0 |
| Fédération | 🚧 en cours | ❌ | ✅ ActivityPub |
| Install en 1 commande | ✅ | N/A | ⚠️ lourd |

**Ce que Discord fait mieux :** UX mobile (on n'a pas encore d'app), bots, intégrations, réseau d'effet (tout le monde y est déjà), stabilité à 100M d'utilisateurs.

**Ce que Matrix fait mieux :** Fédération mature, protocole ouvert, clients multiples.

**Ce que Nexus fait mieux :** Forum + chat + voix dans un seul outil léger. Install en une commande. P2P chiffré natif. Tableau collaboratif. Jukebox. Aucune dépendance cloud. Zéro tracking.

On ne remplace pas Discord. On existe pour les communautés qui veulent la souveraineté numérique sans sacrifier les fonctionnalités.`,

      `Le tableau de comparaison honnête c'est rare. J'apprécie qu'on reconnaisse les forces de Discord plutôt que de faire semblant qu'il n'existe pas.`,

      `La fédération ActivityPub chez Matrix est une bonne base mais le protocole Matrix est complexe à implémenter pour un tiers. AGPL + API simple c'est peut-être plus accessible pour des contributeurs.`,
    ],
  },

  {
    title: 'Bienvenue ! Présentez-vous ici 👋',
    category: '💬 Discussions > Présentations',
    posts: [
      `**Bienvenue sur l'instance Nexus Node !**

Ce fil est l'endroit pour se présenter. Qui êtes-vous ? Comment avez-vous découvert Nexus ? Qu'est-ce que vous attendez de cette communauté ?

Je commence : je suis Pokled, le créateur de Nexus. Je construis ce projet parce que je voulais exactement ce genre de plateforme pour mes propres communautés — et elle n'existait pas.

Je suis passionné par les systèmes décentralisés, le Rust, le WebRTC, et les outils qui redonnent le contrôle aux utilisateurs. Nexus est mon projet principal en ce moment, développé en public sur GitHub.

N'hésitez pas à partager vos idées, remonter des bugs, ou juste dire bonjour. Cette communauté est la vôtre.`,

      `Je suis Morty, admin de cette instance. Je suis là pour tester toutes les features au fur et à mesure qu'elles sortent et remonter les bugs. Ravi d'être parmi les premiers utilisateurs !`,
    ],
  },

  // ── 💡 Idées & Retours ────────────────────────────────────────────────────

  {
    title: 'NEXUS-RADIO — une nouvelle façon d\'exister pour les radios internet',
    category: '💡 Idées & Retours',
    featured: true,
    posts: [
      `**Une idée qui me tient à cœur et que je documente ici.**

Il y a 50 000 stations de radio actives dans le monde. La majorité diffuse dans le vide. Pourquoi ? Parce qu'une radio sans communauté c'est un cri dans le désert.

La radio classique a fonctionné parce qu'elle créait de la communauté autour d'elle. Les auditeurs de SomaFM ou Radio Paradise ne sont pas juste des consommateurs — ce sont des membres. Ils donnent, ils interagissent, ils font partie de quelque chose.

**Ce que Nexus change :**
- Les stations mortes : broadcast → espoir de communauté
- Les stations vivantes : communauté → broadcast comme expression naturelle

Une instance Nexus pourrait déclarer un champ \`stream_url\` et apparaître dans le directory nexusnode.app comme station de radio. Le jukebox existant est déjà une radio interne.

**Le modèle économique coopératif :**
Régie publicitaire intégrée — 80% à la station, 20% à nexusnode.app pour maintenir l'infrastructure. Ciblage géographique uniquement, zéro tracking, zéro profil. Le boulanger local finance la radio locale.

**La connexion ionosphérique :**
La radio HF rebondit sur l'ionosphère — cette couche de plasma que personne ne peut acheter ni breveter. Nexus ambitionne la même chose pour internet : un réseau de communautés sur une infrastructure que personne ne contrôle.

C'est loin, c'est ambitieux. Mais c'est la direction.`,

      `L'analogie ionosphère → réseau décentralisé est puissante. L'ionosphère c'est de la physique — immuable, accessible à tous, impossible à privatiser. C'est exactement ce que devrait être l'infrastructure du web.`,

      `Le modèle 80/20 est réaliste. Les stations radio ont besoin de revenus pour payer leurs licences et leur bande passante. Un système coopératif où chaque station contribue à l'infrastructure commune c'est une belle idée.`,

      `Je pense à SomaFM qui survit depuis 2000 uniquement par les dons de la communauté. Si Nexus avait existé en 2000, SomaFM aurait eu un forum, un chat, des salons vocaux — et probablement 10x plus de donateurs fidèles.`,
    ],
  },

  {
    title: 'Retours sur l\'UX de la v0.9 — ce qui marche, ce qui manque',
    category: '💡 Idées & Retours',
    posts: [
      `**Après quelques semaines d'utilisation quotidienne de la v0.9, voici mes retours honnêtes.**

**Ce qui marche vraiment bien :**
- La barre de contrôle vocal est intuitive. Mute, sourd, PTT — tout est accessible en un clic.
- Le NexusCanvas est une killer feature. Même à 2, c'est magique.
- Le Jukebox est simple et efficace.
- La latence voix est excellente (moins de 50ms en P2P direct).

**Ce qui pourrait être amélioré :**
- La page d'accueil forum était trop grande (déjà corrigé avec la bande compacte).
- Le partage d'écran n'affichait rien après sélection — corrigé.
- L'historique des messages ne charge pas toujours au premier join d'un canal.
- Pas d'indicateur visuel quand un pair a une mauvaise connexion (qualité réseau dans le panneau pair, oui, mais pas dans la liste des membres).

**Suggestions :**
1. Notification sonore quand quelqu'un rejoint le salon vocal
2. Possibilité de nommer les sessions NexusCanvas
3. Mode "lecture seule" pour les visiteurs non-inscrits sur le forum`,

      `+1 sur la notification sonore au join. C'est un détail mais ça change l'immersion.`,

      `Pour le mode lecture seule, c'est déjà partiellement là non ? Les threads sont accessibles sans compte. Mais la recherche nécessite un compte je crois.`,

      `La recherche est publique. Ce qui nécessite un compte : poster, réagir, accéder au chat et vocal. La vision est d'avoir un forum ouvert en lecture avec une couche sociale optionnelle.`,
    ],
  },

  // ── 📚 Guides ─────────────────────────────────────────────────────────────

  {
    title: 'Guide : installer Nexus sur un VPS en 5 minutes',
    category: '📚 Guides & Documentation',
    posts: [
      `**L'installation la plus rapide d'une plateforme communautaire complète.**

**Prérequis :**
- Un VPS avec Ubuntu 22.04 ou 24.04 (2 vCPU, 2 GB RAM minimum)
- Ports 80 et 443 ouverts
- Optionnel : un domaine pointant vers votre IP

**Installation en une commande :**
\`\`\`bash
bash <(curl -fsSL https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh)
\`\`\`

Le script vous pose 5 questions :
1. Nom de votre communauté
2. Description
3. Email admin
4. Mot de passe admin
5. Domaine (optionnel — si vide, utilise \`{IP}.sslip.io\` avec Let's Encrypt auto)

**Ce que le script fait :**
- Installe Node.js 20, PostgreSQL, Redis, Caddy
- Clone le repo, build backend + frontend
- Configure PM2 pour le démarrage automatique
- Configure Caddy avec HTTPS (Let's Encrypt)
- Crée la communauté et le compte admin
- Propose l'enregistrement sur nexusnode.app (annuaire des instances)

**En option : Nexus Relay pour les home servers**
Si vous hébergez depuis chez vous sans port ouvert :
\`\`\`bash
bash <(curl -fsSL https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh)
# Choisir l'option 2 "Nexus Relay" quand elle est proposée
\`\`\`

Votre instance sera accessible via \`votre-slug.nexusnode.app\` avec TLS Cloudflare.`,

      `Je viens de tester sur un VPS Oracle Cloud Free Tier (ARM Ampere). Ça tourne parfaitement. L'install a pris 4 minutes chrono.`,

      `Oracle Cloud Free Tier ARM c'est le bon plan pour tester. 4 vCPU + 24GB RAM gratuitement. Nexus tourne confortablement là-dessus.`,

      `Est-ce que ça fonctionne aussi sur Raspberry Pi ? Je voudrais tester depuis chez moi avec le relay.`,

      `Pi 4 (4GB RAM) : testé et validé. Le relay client tourne en service systemd, la connexion est stable. Voir le guide relay pour les détails.`,
    ],
  },

  {
    title: 'Guide : héberger Nexus depuis chez soi avec Nexus Relay',
    category: '📚 Guides & Documentation',
    posts: [
      `**Pour ceux qui veulent héberger leur instance à la maison, sans ouvrir de ports.**

**La situation typique :**
- Box FAI avec CGNAT (très courant en 4G/5G, de plus en plus fréquent en fibre)
- IP dynamique qui change régulièrement
- Pas envie de payer pour un VPS

**Solution : Nexus Relay**

Le relay est un tunnel TCP qui passe votre trafic HTTP(S) via nos serveurs nexusnode.app. Votre instance locale reste sur votre machine — seul le routage est externe.

**Installation :**
\`\`\`bash
bash <(curl -fsSL https://raw.githubusercontent.com/Pokled/Nexus/main/install_tunnel.sh)
\`\`\`

Ou, sur une instance déjà installée, lancer le relay manuellement :
\`\`\`bash
nexus-relay client \\
  --server relay.nexusnode.app:7443 \\
  --slug votre-slug \\
  --token votre-token \\
  --local-port 80
\`\`\`

**Votre instance sera disponible sur :** \`https://votre-slug.nexusnode.app\`

**Points techniques :**
- Connexion TCP persistante avec reconnexion automatique (backoff 1s → 2s → 4s → max 30s)
- Compatible Socket.IO long-polling ET WebSocket
- TLS géré par Cloudflare (nexusnode.app est proxifié CF)
- Le relay ne voit que le trafic HTTP en transit — pas de déchiffrement

**Recommandé pour :** Raspberry Pi, NAS Synology, mini-PC maison, VM locale.`,

      `Testé sur un Pi 4 derrière une box Orange. Pas de port ouvert, IP dynamique. La reconnexion automatique fonctionne à chaque redémarrage du Pi.`,

      `Le point sur le TLS Cloudflare est important : CF gère le chiffrement entre le visiteur et CF, mais le trafic entre CF et votre machine passe via le relay. Pour des données sensibles, ajouter un certificat SSL local en plus.`,
    ],
  },

]

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`  ${msg}\n`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Nexus Forum Seed — histoire et évolution de Nexus\n')

  // ── Résoudre la communauté ─────────────────────────────────────────────────
  const { rows: communityRows } = await db.query(
    `SELECT id FROM communities WHERE slug = $1`, [COMMUNITY_SLUG]
  )
  if (!communityRows[0]) {
    console.error(`❌ Communauté "${COMMUNITY_SLUG}" introuvable. Vérifiez NEXUS_COMMUNITY_SLUG.`)
    process.exit(1)
  }
  const communityId = communityRows[0].id
  log(`Communauté : ${COMMUNITY_SLUG} (${communityId})`)

  // ── Résoudre l'auteur ──────────────────────────────────────────────────────
  const { rows: authorRows } = await db.query(
    `SELECT id FROM users WHERE lower(username) = lower($1)`, [AUTHOR_USERNAME]
  )
  if (!authorRows[0]) {
    console.error(`❌ Utilisateur "${AUTHOR_USERNAME}" introuvable.`)
    process.exit(1)
  }
  const authorId = authorRows[0].id
  log(`Auteur : ${AUTHOR_USERNAME} (${authorId})\n`)

  // ── --reset ────────────────────────────────────────────────────────────────
  if (RESET) {
    console.log('⚠️  --reset: suppression des catégories créées par ce seed...')
    const names = CATEGORIES.map(c => c.name)
    const childNames = CATEGORIES.flatMap(c => c.children.map(ch => ch.name))
    await db.query(
      `DELETE FROM categories WHERE community_id = $1 AND name = ANY($2)`,
      [communityId, [...names, ...childNames]]
    )
    log('Catégories supprimées (threads en cascade).')
    await db.end(); await redis.quit(); return
  }

  // ── 1. Catégories ─────────────────────────────────────────────────────────
  console.log('📁 Création des catégories...')
  const catMap: Record<string, string> = {}  // "Nom" → id

  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i]

    const existing = await db.query(
      `SELECT id FROM categories WHERE community_id = $1 AND name = $2`,
      [communityId, cat.name]
    )
    let catId: string

    if (existing.rows[0]) {
      catId = existing.rows[0].id
      log(`skip  ${cat.name}`)
    } else {
      const { rows } = await db.query(
        `INSERT INTO categories (community_id, name, description, position)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [communityId, cat.name, cat.description, i]
      )
      catId = rows[0].id
      log(`create ${cat.name}`)
    }
    catMap[cat.name] = catId

    // Sous-catégories
    for (let j = 0; j < cat.children.length; j++) {
      const child = cat.children[j]
      const existingChild = await db.query(
        `SELECT id FROM categories WHERE community_id = $1 AND name = $2`,
        [communityId, child.name]
      )
      if (existingChild.rows[0]) {
        catMap[child.name] = existingChild.rows[0].id
        log(`  skip  ${child.name}`)
        continue
      }
      const { rows } = await db.query(
        `INSERT INTO categories (community_id, name, description, position, parent_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [communityId, child.name, child.description, j, catId]
      )
      catMap[child.name] = rows[0].id
      log(`  create ${child.name}`)
    }
  }

  // ── 2. Threads + posts ────────────────────────────────────────────────────
  console.log('\n💬 Création des fils de discussion...')
  let threadCount = 0
  let postCount   = 0

  for (const t of THREADS) {
    // Résoudre la catégorie ("Parent > Enfant" ou "Nom")
    let catId: string | undefined
    if (t.category.includes(' > ')) {
      const child = t.category.split(' > ')[1]
      catId = catMap[child]
    } else {
      catId = catMap[t.category]
    }

    if (!catId) {
      log(`WARN: catégorie introuvable pour "${t.category}" (thread: ${t.title.slice(0, 40)})`)
      continue
    }

    // Skip si déjà existant
    const existing = await db.query(
      `SELECT id FROM threads WHERE category_id = $1 AND title = $2`,
      [catId, t.title]
    )
    if (existing.rows[0]) {
      log(`skip  "${t.title.slice(0, 55)}"`)
      continue
    }

    // Créer le thread
    const { rows: tRows } = await db.query(
      `INSERT INTO threads (category_id, author_id, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [catId, authorId, t.title]
    )
    const threadId = tRows[0].id
    threadCount++

    // Featured ?
    if (t.featured) {
      await db.query(
        `UPDATE threads SET is_featured = true WHERE id = $1`,
        [threadId]
      )
    }

    // Posts — OP par Pokled, réponses par des comptes demo si dispo
    const { rows: demoUsers } = await db.query(
      `SELECT id, username FROM users
       WHERE lower(username) != lower($1)
       ORDER BY created_at
       LIMIT 5`,
      [AUTHOR_USERNAME]
    )

    // Timestamps étalés sur les derniers 30 jours pour donner du relief
    const now = Date.now()
    const spread = 30 * 24 * 60 * 60 * 1000

    for (let i = 0; i < t.posts.length; i++) {
      // OP = Pokled ; réponses = démo users en round-robin ou Pokled si aucun
      let postAuthorId = authorId
      if (i > 0 && demoUsers.length > 0) {
        postAuthorId = demoUsers[(i - 1) % demoUsers.length].id
      }

      const ageOffset = Math.floor(Math.random() * spread * (1 - i / t.posts.length))
      const createdAt = new Date(now - ageOffset)

      await db.query(
        `INSERT INTO posts (thread_id, author_id, content, created_at)
         VALUES ($1, $2, $3, $4)`,
        [threadId, postAuthorId, t.posts[i], createdAt]
      )
      postCount++
    }

    // Vues aléatoires
    await db.query(
      `UPDATE threads SET views = $1 WHERE id = $2`,
      [Math.floor(Math.random() * 400) + 30, threadId]
    )

    log(`create "${t.title.slice(0, 55)}" (${t.posts.length} posts${t.featured ? ' ⭐' : ''})`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complet !')
  console.log(`   ${CATEGORIES.length} catégories racines | ${CATEGORIES.reduce((a, c) => a + c.children.length, 0)} sous-catégories | ${threadCount} fils | ${postCount} posts`)
  console.log()

  await db.end()
  await redis.quit()
}

seed().catch(err => {
  console.error('\n❌ Seed échoué :', err)
  process.exit(1)
})
