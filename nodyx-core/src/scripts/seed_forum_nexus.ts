/**
 * NODYX — Forum seed : histoire et évolution de Nodyx
 *
 * Crée les catégories, sous-catégories et fils de discussion
 * autour du développement de Nodyx, postés par Pokled.
 *
 * Usage:
 *   cd nodyx-core
 *   npx tsx src/scripts/seed_forum_nodyx.ts
 *   npx tsx src/scripts/seed_forum_nodyx.ts --reset  (supprime les catégories créées)
 */

import * as dotenv from 'dotenv'
dotenv.config()

import { db, redis } from '../config/database'

const RESET = process.argv.includes('--reset')

// ── Config ───────────────────────────────────────────────────────────────────

const COMMUNITY_SLUG = process.env.NODYX_COMMUNITY_SLUG ?? 'nodyxnode'
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
    description: 'Nouvelles officielles, releases et événements importants de Nodyx.',
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
    description: 'Échanges libres autour de Nodyx et de sa communauté.',
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

  {
    title: '🎉 Nodyx v0.9 — WebRTC P2P mesh, partage d\'écran, NodyxCanvas',
    category: '📣 Annonces',
    featured: true,
    posts: [
      `<h2>Nodyx v0.9 est en ligne</h2>
<p>C'est la release la plus ambitieuse depuis le début du projet. Voici ce qui change concrètement.</p>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">v0.9.0</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#22c55e;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">WebRTC P2P</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#f97316;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">Rust</span>
</p>

<h3>WebRTC P2P mesh complet</h3>
<p>Les salons vocaux fonctionnent maintenant en <strong>maille directe</strong> : chaque participant est connecté à chaque autre via une connexion WebRTC chiffrée. Aucun flux audio ne passe par le serveur. Nodyx Core ne voit que la signalisation — jamais le contenu.</p>

<h3>nodyx-turn — notre propre serveur STUN/TURN en Rust</h3>
<p>Pour les connexions derrière des NAT stricts, on a écrit <strong>nodyx-turn</strong> : binaire Rust de 2,9 MB, credentials HMAC-SHA1 time-based, service systemd sur UDP 3478.</p>
<pre><code class="language-bash"># Credentials time-based (RFC 5766)
username = "{expires}:{userId}"
password = base64(HMAC-SHA1(TURN_SECRET, username))</code></pre>

<h3>Partage d'écran</h3>
<p>Le bouton moniteur dans la barre de contrôle vocal lance <code>getDisplayMedia()</code>. La track vidéo est ajoutée aux peer connections existantes — un seul renegotiate, pas de reconnexion.</p>

<h3>NodyxCanvas — tableau collaboratif P2P 🎨</h3>
<p>Surface de dessin partagée, synchronisée via les DataChannels WebRTC en <strong>CRDT Last-Write-Wins</strong>. Curseurs distants avec halo de parole. Export PNG. <strong>Zéro backend</strong> — les données ne touchent jamais le serveur.</p>
<blockquote><p>Un peer qui parle dans le salon vocal fait pulser son curseur sur le canvas. On se sent dans la même pièce.</p></blockquote>
<hr />
<p>La prochaine étape : <strong>v1.0</strong> avec NODYX-RADIO. On y est presque.</p>`,

      `<p>Magnifique release. Le NodyxCanvas c'est vraiment une <strong>killer feature</strong> — je n'ai rien vu de comparable dans les outils de chat décentralisés.</p>
<p>Le fait que tout soit P2P sans serveur rend ça extensible à l'infini. Chaque nouveau salon vocal = tableau collaboratif gratuit.</p>`,

      `<p>Je viens de tester le partage d'écran avec un ami derrière un NAT strict. Ça passe parfaitement via nodyx-turn.</p>
<p>Impressionnant pour un binaire Rust de <code>3MB</code>. Le TURN coton classique c'est 50x plus lourd à configurer.</p>`,

      `<p>La notion de CRDT pour le canvas est intéressante. <strong>LWW par élément</strong> c'est simple mais suffisant pour un tableau de brainstorm.</p>
<blockquote><p>Simple, correct, suffisant pour le MVP — c'est exactement la bonne philosophie.</p></blockquote>`,

    ],
  },

  {
    title: 'Nodyx Relay — votre instance accessible depuis n\'importe où, sans ouvrir un port',
    category: '📣 Annonces',
    posts: [
      `<h2>Le problème</h2>
<p>Beaucoup de gens veulent héberger leur instance Nodyx depuis chez eux — mais leur FAI leur assigne une IP dynamique, bloque les ports entrants, ou met tout derrière un CGNAT.</p>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">nodyx-relay</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6b7280;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">TCP 7443</span>
</p>

<h2>La solution : nodyx-relay</h2>
<p>Un tunnel TCP écrit en Rust, deux composants :</p>
<ul>
  <li><strong>relay server</strong> (sur nos VPS nodyx.org) — écoute sur TCP 7443</li>
  <li><strong>relay client</strong> (votre machine) — se connecte avec un token, expose votre port 80</li>
</ul>

<h3>Flux d'une requête</h3>
<pre><code>Visiteur → Cloudflare → Caddy → relay server (7001)
                                      ↓ TCP tunnel
                               relay client (votre Pi)
                                      ↓
                               Nodyx local (port 80)</code></pre>

<h3>Résultat concret</h3>
<p>Un <strong>Raspberry Pi 4</strong> chez soi, aucun port ouvert, aucun domaine → accessible via <code>https://votre-slug.nodyx.org</code> avec TLS Cloudflare.</p>

<h3>Fonctionnalités</h3>
<ul>
  <li>Reconnexion automatique avec backoff exponentiel <code>1s → 2s → 4s → max 30s</code></li>
  <li>Traitement <strong>concurrent</strong> des requêtes (tokio task par requête)</li>
  <li>Compatible Socket.IO long-polling <em>et</em> WebSocket</li>
  <li>Release <code>v0.1.1-relay</code> sur GitHub (amd64 + arm64)</li>
</ul>`,

      `<p>C'est exactement ce qu'il manquait. Les gens qui veulent self-host n'ont pas forcément un VPS.</p>
<p>Un Pi à la maison c'est <strong>bien plus accessible</strong> — et c'est la vraie décentralisation : des instances qui tournent dans des appartements, des garages, des associatifs.</p>`,

      `<p>La partie <strong>concurrent processing</strong> c'est cruciale pour Socket.IO. Les long-polls qui se bloquent mutuellement c'est une galère classique avec les tunnels naïfs.</p>
<p>J'avais codé quelque chose de similaire en Go l'an dernier et c'est exactement le piège où tout le monde tombe en premier.</p>`,

    ],
  },

  {
    title: 'nodyx-turn v0.1.0 — serveur STUN/TURN maison en Rust',
    category: '📣 Annonces',
    posts: [
      `<h2>Nodyx dispose maintenant de son propre serveur STUN/TURN</h2>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#f97316;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">Rust</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">2.9MB</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#3b82f6;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">RFC 5766</span>
</p>
<p>On a remplacé coturn (complexe à configurer, 50+ fichiers de config) par <strong>nodyx-turn</strong> — un binaire Rust de 2,9 MB qui fait exactement ce qu'il faut.</p>

<h3>Pourquoi c'était nécessaire</h3>
<p>WebRTC fonctionne en P2P direct dans <strong>~80% des cas</strong>. Mais pour les 20% restants (NAT symétrique, réseau d'entreprise, 4G/5G avec CGNAT), il faut un relais TURN. Sans ça, ces utilisateurs ne peuvent tout simplement pas rejoindre les salons vocaux.</p>

<h3>Architecture des credentials (RFC 5766)</h3>
<pre><code class="language-typescript">// Générés par nodyx-core à chaque voice:init
const expires  = Math.floor(Date.now() / 1000) + TTL
const username = \`\${expires}:\${userId}\`
const password = base64(HMAC_SHA1(TURN_SECRET, username))

// Fournis au client via Socket.IO
socket.emit('voice:init', { iceServers: [
  { urls: \`turn:\${TURN_PUBLIC_IP}:\${TURN_PORT}\`, username, credential: password }
] })</code></pre>

<h3>Configuration</h3>
<pre><code class="language-bash"># /etc/nodyx-turn.env
TURN_PUBLIC_IP=YOUR_SERVER_IP
TURN_REALM=nodyx.org
TURN_SECRET=your_secret_here
TURN_PORT=3478
TURN_TTL=86400</code></pre>

<h3>Validation</h3>
<p>Testé avec des Binding Requests STUN manuelles → réponse <code>0x0101</code> Success Response. Connexions vocales avec un utilisateur derrière CG-NAT → ✅ opérationnel.</p>`,

      `<p>Chapeau pour l'implémentation propre. <strong>HMAC-SHA1 time-based</strong> c'est exactement le standard TURN — pas de gestion d'état côté serveur, credentials auto-expirés, parfait.</p>
<p>Le fait que les credentials soient distribués dynamiquement par nodyx-core via <code>voice:init</code> c'est élégant. Pas besoin de configurer quoi que ce soit côté client.</p>`,

    ],
  },

  {
    title: 'DataChannels WebRTC P2P — typing instantané et réactions optimistes',
    category: '🚀 Développement > Nouvelles fonctionnalités',
    posts: [
      `<h2>Phase 3.0-B — DataChannels P2P pour le chat en temps réel</h2>
<p>Jusqu'ici, tout le chat passait par le serveur : message envoyé → Socket.IO → nodyx-core → broadcast. Ça marche, mais il y a une latence et ça charge le serveur.</p>
<p>Avec les <strong>DataChannels WebRTC</strong>, les pairs déjà connectés en vocal peuvent s'envoyer des données directement — sans passer par le serveur.</p>

<h3>Architecture p2p.ts</h3>
<pre><code class="language
">p2p.ts — gestionnaire de mesh DataChannels
├── Un DataChannel par pair (côté initiateur)
├── Réception via ondatachannel (côté répondeur)
├── File de messages en attente si channel pas encore ouvert
└── Reconnexion automatique si peer disparaît</code></pre>

<h3>Messages P2P supportés</h3>
<table>
  <thead><tr><th>Type</th><th>Payload</th><th>Usage</th></tr></thead>
  <tbody>
    <tr><td><code>p2p:typing</code></td><td><code>{ userId, username, channelId }</code></td><td>Indicateur de frappe instantané</td></tr>
    <tr><td><code>p2p:reaction</code></td><td><code>{ messageId, emoji, userId }</code></td><td>Réaction emoji optimiste</td></tr>
    <tr><td><code>canvas:op</code></td><td><code>CanvasElement</code></td><td>Tracé / forme / sticky NodyxCanvas</td></tr>
    <tr><td><code>canvas:cursor</code></td><td><code>{ x, y, userId, speaking }</code></td><td>Curseur distant sur le canvas</td></tr>
    <tr><td><code>canvas:clear</code></td><td><code>{ by, ts }</code></td><td>Effacement total du canvas</td></tr>
  </tbody>
</table>

<h3>L'indicateur P2P</h3>
<p>Le badge <strong>⚡ P2P</strong> dans le header des canaux texte s'allume quand la connexion directe est établie. Le fallback Socket.IO reste toujours actif pour les cas sans P2P.</p>
<blockquote><p>L'utilisateur sait qu'il est "dans le mesh" — c'est concret, pas juste un concept marketing.</p></blockquote>`,

      `<p>Le badge ⚡ P2P c'est un beau détail UX. Ça donne une vraie sensation de connexion directe — pas un serveur intermédiaire opaque.</p>
<p>Et le fallback Socket.IO transparent c'est la bonne approche : <strong>progressivement amélioré</strong>, jamais cassé.</p>`,

      `<p>Question sur le DataChannel : est-ce que les messages canvas passent par TURN si le P2P direct échoue ?</p>`,

      `<p>Oui — les DataChannels partagent la même connexion ICE que le flux audio. Si la connexion passe par TURN pour le son, les data channels passent aussi par TURN.</p>
<p>Un seul établissement de connexion ICE pour tout : audio + data. C'est une économie de setup importante.</p>`,

    ],
  },

  {
    title: 'NodyxCanvas — tableau collaboratif P2P embarqué dans le salon vocal',
    category: '🚀 Développement > Nouvelles fonctionnalités',
    posts: [
      `<h2>NodyxCanvas — la feature qui m'a le plus excité à coder</h2>
<p>L'idée : quand tu parles avec des gens dans un salon vocal, tu peux ouvrir une <strong>surface de dessin partagée</strong>. Tout le monde dessine, voit les curseurs des autres, synchronisé en temps réel — P2P, sans serveur.</p>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">CRDT LWW</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#22c55e;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">DataChannels</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6b7280;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">PNG Export</span>
</p>

<h3>Le modèle CRDT — Last-Write-Wins par élément</h3>
<p>Chaque tracé, sticky note ou forme est un <code>CanvasElement</code> avec un UUID et un timestamp. La règle de merge est simple :</p>
<pre><code class="language-typescript">type CanvasElement = {
  id:       string          // UUID v4
  ts:       number          // Date.now() — LWW : le plus grand gagne
  author:   string          // userId
  kind:     'path' | 'sticky' | 'rect' | 'circle'
  data:     PathData | StickyData | ShapeData
  deleted?: boolean         // soft delete pour l'effaceur
}

// Règle d'application
function apply(op: CanvasElement): boolean {
  const existing = elements.get(op.id)
  if (existing && existing.ts >= op.ts) return false  // discard
  elements.set(op.id, op)
  return true  // state changed → redraw
}</code></pre>

<h3>Curseurs distants</h3>
<ul>
  <li>Chaque <code>pointermove</code> → broadcast <code>canvas:cursor</code> (throttle 50ms)</li>
  <li>Fade-out automatique après <strong>3 secondes</strong> sans update</li>
  <li>Halo violet <code>nodyx-pulse</code> quand le peer parle (VAD actif)</li>
</ul>

<h3>Fin de session</h3>
<p>Quand tu fermes le canvas avec des éléments : <em>"Garder la table ?"</em></p>
<ul>
  <li>📥 <strong>Télécharger PNG</strong> — <code>canvas.toBlob('image/png')</code> → download</li>
  <li>📋 <strong>Résumé dans le chat</strong> — <code>socket.emit('chat:send', { content: '📋 Table de travail — N éléments...' })</code></li>
  <li>✕ <strong>Jeter</strong> — ferme sans trace</li>
</ul>
<blockquote><p>Session éphémère par défaut, mais avec une porte de sortie. Zéro backend. Zéro stockage.</p></blockquote>`,

      `<p>Le <strong>soft delete</strong> avec <code>deleted: true</code> c'est exactement la bonne approche pour CRDT. Un hard delete créerait des conflits insolubles si un autre peer reçoit l'op de création après.</p>
<p>C'est le même pattern qu'utilisent Figma, Notion, et tous les éditeurs collaboratifs sérieux.</p>`,

      `<p>L'export PNG + résumé dans le chat c'est brilliant. <strong>Session éphémère par défaut mais avec une porte de sortie</strong>. Pas besoin de stocker quoi que ce soit côté serveur.</p>`,

      `<p>J'ai testé à 3 sur le canvas ce matin. Les curseurs avec les halos vocaux c'est vraiment immersif.</p>
<p>On se sent dans la même pièce. La combinaison voix + dessin collaboratif c'est quelque chose que Discord ne fera jamais de cette façon.</p>`,

    ],
  },

  {
    title: 'VoiceJukebox — la musique partagée dans les salons vocaux',
    category: '🚀 Développement > Nouvelles fonctionnalités',
    posts: [
      `<h2>Le Jukebox vocal</h2>
<p>Dans un salon vocal, n'importe quel membre peut ajouter une piste à la queue. Les pistes se jouent à la suite pour <strong>tous les participants connectés</strong>.</p>

<h3>Synchronisation</h3>
<p>Le serveur maintient l'état de la queue (piste courante, position temporelle). Quand un nouveau peer rejoint, il reçoit la position actuelle et peut synchroniser sa lecture.</p>
<blockquote><p>Contrairement au NodyxCanvas, le Jukebox a besoin du serveur comme source de vérité — la synchronisation temporelle ne peut pas être purement P2P.</p></blockquote>

<h3>Sources supportées</h3>
<table>
  <thead><tr><th>Source</th><th>Support</th><th>Raison</th></tr></thead>
  <tbody>
    <tr><td>Fichiers audio (mp3, ogg, flac, wav)</td><td>✅</td><td>Upload direct, pas de dépendance externe</td></tr>
    <tr><td>URL de flux radio (HLS/MP3)</td><td>🚧 en cours</td><td>Prérequis pour NODYX-RADIO</td></tr>
    <tr><td>YouTube / Spotify</td><td>❌ intentionnel</td><td>Dépendance API propriétaire — contre la philosophie</td></tr>
  </tbody>
</table>

<h3>Interface</h3>
<ul>
  <li>Bouton <strong>♫ Jukebox</strong> dans la toolbar du salon vocal</li>
  <li>Pulse en ambre quand une piste joue</li>
  <li>Queue avec auteur, durée, vote pour passer à la suivante</li>
</ul>

<h3>Prochaine étape</h3>
<p>Support des URL de flux radio HLS/MP3 — ce qui ouvre la porte à <strong>NODYX-RADIO</strong>. Une instance Nodyx pourrait déclarer son flux et apparaître dans le directory comme station de radio.</p>`,

      `<p>La position temporelle partagée c'est la partie difficile. Comment gérez-vous la dérive si un client a un buffer différent ?</p>`,

      `<p>On envoie la position serveur en ms au join, le client scrub sa lecture. Il y a une dérive potentielle de quelques secondes entre pairs mais <strong>sur de la musique c'est imperceptible</strong>.</p>
<p>Pour du voice chat synchronisé ce serait un problème — pour du jukebox passif, pas du tout.</p>`,

      `<p>Hâte de voir les URLs de flux radio. Je pense à une intégration avec <strong>SomaFM</strong> ou Radio Paradise — des stations qui ont une communauté forte et un stream MP3 public.</p>
<p>Ça collerait parfaitement avec la vision NODYX-RADIO.</p>`,

    ],
  },

  {
    title: 'Pourquoi Fastify v5 + SvelteKit 5 — nos choix de stack et retours après 6 mois',
    category: '🚀 Développement > Architecture & technique',
    posts: [
      `<h2>Retour d'expérience sur la stack Nodyx</h2>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">Fastify v5</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#f97316;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">SvelteKit 5</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">PostgreSQL</span>
</p>

<h3>Fastify v5</h3>
<p>J'avais l'habitude d'Express mais Fastify a plusieurs avantages concrets :</p>
<ul>
  <li>Schéma de validation JSON Schema natif → routes auto-documentées</li>
  <li>Performances supérieures sur les petits payloads (ce qu'on a en forum/chat)</li>
  <li>TypeScript first sans torsion</li>
</ul>
<p>⚠️ <strong>La galère v5</strong> : Socket.IO doit être attaché <em>après</em> <code>server.listen()</code>. Fastify v5 a changé le cycle de vie :</p>
<pre><code class="language-typescript">// ❌ Ne pas faire (Fastify v5)
await server.register(fastifySocketIO)

// ✅ Correct
await server.listen({ port: 3000 })
const io = new Server(server.server, { cors: { origin: FRONTEND_URL } })</code></pre>

<h3>SvelteKit 5 — les runes</h3>
<p>Les runes (<code>$state</code>, <code>$derived</code>, <code>$effect</code>) ont transformé ma façon d'écrire les composants :</p>
<pre><code class="language-svelte">// Avant (Svelte 4) — stores verbeux
const voiceStore = writable({ active: false, peers: [] })
$: peers = $voiceStore.peers

// Après (Svelte 5) — réactivité fine-grained
const vs    = $derived($voiceStore)
const peers = $derived(vs.peers)
const level = $derived($inputLevel)</code></pre>

<h3>PostgreSQL + Redis</h3>
<table>
  <thead><tr><th>Technologie</th><th>Usage</th><th>Pourquoi pas autre chose</th></tr></thead>
  <tbody>
    <tr><td>PostgreSQL 16</td><td>Persistance : forums, membres, assets</td><td>SQL direct avec <code>pg</code> — lisible, maîtrisable</td></tr>
    <tr><td>Redis</td><td>Sessions JWT, présence en ligne</td><td>TTL natif pour les sessions — parfait</td></tr>
    <tr><td>Pas d'ORM</td><td>—</td><td>Requêtes complexes (FTS, JSON, agrégats) → SQL direct</td></tr>
  </tbody>
</table>`,

      `<p>Le point sur Socket.IO post-listen dans Fastify v5 m'a sauvé il y a quelques semaines. Je cherchais depuis des heures pourquoi mes events n'arrivaient pas.</p>
<p>C'est un piège classique — la doc Fastify v5 le mentionne mais seulement dans une note de bas de page.</p>`,

      `<p>Les runes Svelte 5 c'est vraiment une autre dimension. J'ai réécrit VoicePanel avec et le code est <strong>deux fois plus court</strong> pour le même comportement.</p>
<p>La réactivité fine-grained évite aussi les re-renders inutiles — c'est sensible sur les composants qui écoutent des stores qui changent souvent (inputLevel, peerStatsStore...).</p>`,

      `<p>La contrainte "une instance = une communauté" c'est une décision forte mais cohérente avec la philosophie décentralisée.</p>
<p><strong>Pas de compromis de performance pour le multi-tenant.</strong> Toutes les ressources de l'instance servent une seule communauté.</p>`,

    ],
  },

  {
    title: 'Architecture du mesh WebRTC — comment on gère N participants sans SFU',
    category: '🚀 Développement > Architecture & technique',
    posts: [
      `<h2>Mesh WebRTC vs SFU — le choix de Nodyx</h2>
<p>Pour les non-initiés, il y a deux grandes architectures pour la VoIP multi-participants.</p>

<h3>Mesh (notre choix)</h3>
<p>Chaque participant est connecté à chaque autre. Dans un salon à 5 :</p>
<pre><code>A ←──── WebRTC P2P chiffré ────→ B
A ←────────────────────────────→ C
A ←────────────────────────────→ D
B ←────────────────────────────→ C
B ←────────────────────────────→ D
C ←────────────────────────────→ D

N participants → N*(N-1)/2 connexions</code></pre>

<h3>SFU — Selective Forwarding Unit</h3>
<p>Chaque participant envoie son flux à un <strong>serveur central</strong> qui le redistribue. Meilleure scalabilité, mais le serveur voit les flux audio/vidéo.</p>

<h3>Pourquoi mesh ?</h3>
<table>
  <thead><tr><th>Critère</th><th>Mesh</th><th>SFU</th></tr></thead>
  <tbody>
    <tr><td>Confidentialité</td><td>✅ Serveur ne voit rien</td><td>⚠️ Serveur voit tout</td></tr>
    <tr><td>Scalabilité</td><td>⚠️ Limite ~10 pairs</td><td>✅ Illimitée</td></tr>
    <tr><td>Complexité deploy</td><td>✅ Aucun service SFU</td><td>❌ Mediasoup/Janus/Livekit</td></tr>
    <tr><td>Usage Nodyx</td><td>✅ 2-10 personnes</td><td>Inutile pour notre cible</td></tr>
  </tbody>
</table>

<h3>La limite en pratique</h3>
<p>Au-delà de <strong>8-10 participants</strong>, la charge CPU côté client augmente (encodage × N connexions). C'est acceptable pour des salons de discussion quotidiens.</p>
<blockquote><p>Pour les très grandes instances : un SFU optionnel pourrait être ajouté. Mais ce n'est pas dans la roadmap v1 — les communautés Nodyx ont des salons à 2-10 personnes.</p></blockquote>`,

      `<p>La limite CPU client est réelle mais honnêtement pour des salons de discussion quotidiens on ne dépasse jamais 6-7 simultanés.</p>
<p>Le mesh est le bon compromis. <strong>La confidentialité ne doit pas être optionnelle.</strong></p>`,

      `<p>J'apprécie la transparence sur les limitations. C'est rare de voir une doc technique qui dit clairement "ça ne scale pas au-delà de X".</p>
<p>C'est le signe d'une architecture honnête plutôt que d'un over-engineering pour impressionner.</p>`,

    ],
  },

  {
    title: 'Post-mortem : bug Relay — présence cassée avec 2+ utilisateurs',
    category: '🚀 Développement > Bugs & correctifs',
    posts: [
      `<h2>Ce bug m'a pris 4h à diagnostiquer</h2>
<p>Je le documente ici pour que personne ne reperde ce temps.</p>

<h3>Symptôme</h3>
<p>Avec 2+ utilisateurs connectés via nodyx-relay, la sidebar membres était vide. L'online count restait à 0. Les messages Socket.IO n'arrivaient pas.</p>

<h3>Root cause — séquentialité du relay client</h3>
<p>Socket.IO utilise du <strong>long-polling</strong> comme transport de fallback (GET bloquant pendant 8 secondes = pingInterval).</p>
<pre><code>Timeline avec 2 users et relay séquentiel :

t=0s   User A : GET /socket.io/?sid=aaa → entre dans la queue
t=0s   User B : GET /socket.io/?sid=bbb → attend derrière A
t=8s   User A : GET se résout (réponse Socket.IO)
t=8s   User B : commence à être traité
t=10s  relay-server timeout → 504 Gateway Timeout
       Socket.IO de User B se déconnecte → reconnect → boucle</code></pre>

<h3>Le fix — tokio::spawn par requête</h3>
<pre><code class="language-rust">// ❌ Avant : séquentiel — bloque tout pendant 8s
while let Some(req) = queue.recv().await {
    handle(req).await;
}

// ✅ Après : concurrent — chaque requête dans son propre task
while let Some(req) = queue.recv().await {
    let writer = writer.clone();
    tokio::spawn(async move {
        handle(req, writer).await;
    });
}</code></pre>
<p>L'écriture reste <strong>sérialisée via mpsc</strong> pour éviter les race conditions sur le socket TCP partagé.</p>

<h3>Leçon</h3>
<blockquote><p>Les timeouts en cascade sont insidieux. Le symptôme (sidebar vide) était loin de la cause (séquentialité du relay). Il faut toujours vérifier la couche transport en premier.</p></blockquote>`,

      `<p>Le debugging distribué c'est ça — le symptôme et la cause sont dans des couches complètement différentes. <strong>Bonne documentation.</strong></p>
<p>Ce type de post-mortem devrait être la norme dans les projets open source.</p>`,

      `<p>La solution <code>tokio::spawn</code> par requête c'est élégant. Et le <code>mpsc</code> pour sérialiser l'écriture TCP est exactement la bonne primitive.</p>
<p>Ce pattern "concurrent reads, serialized writes" est fondamental en async Rust.</p>`,

    ],
  },

  {
    title: '[Fix] online_count toujours à 0 — mauvaise source de vérité',
    category: '🚀 Développement > Bugs & correctifs',
    posts: [
      `<h2>Petit bug mais très visible : le compteur "en ligne" restait à 0</h2>

<h3>Cause</h3>
<p><code>/api/v1/instance/info</code> comptait les clés Redis <code>nodyx:heartbeat:*</code> pour déterminer qui est en ligne. Ces clés sont posées par le middleware <code>requireAuth</code> — donc <em>uniquement quand l'utilisateur fait des appels API</em>.</p>
<p>Un utilisateur connecté mais en lecture passive (forum, scroll) n'appelle pas l'API → sa clé expire après 15 minutes → <code>online_count = 0</code>.</p>

<h3>Fix</h3>
<pre><code class="language-typescript">// ❌ Avant : clés Redis — peu fiables
const keys = await redis.keys('nodyx:heartbeat:*')
const online_count = keys.length

// ✅ Après : sockets actifs — source de vérité
const sockets = await io.in('presence').fetchSockets()
const userIds  = new Set(sockets.map(s => s.data.userId))
const online_count = userIds.size</code></pre>

<p>Socket.IO maintient une room <code>presence</code> où tous les utilisateurs connectés sont présents. C'est la vraie source de vérité — pas les heartbeats API.</p>
<blockquote><p>Règle générale : pour la présence en temps réel, toujours utiliser l'état de la connexion socket, jamais une valeur persistée qui peut expirer.</p></blockquote>`,

      `<p><code>fetchSockets()</code> c'est exactement l'outil pour ça. La room <code>presence</code> comme source de vérité c'est propre.</p>
<p>J'avais eu le même bug dans un autre projet — le fix en une ligne mais le diagnostic qui prend une heure !</p>`,

    ],
  },

  {
    title: 'La vision de Nodyx — pourquoi on construit ça et où on va',
    category: '💬 Discussions > Général',
    posts: [
      `<h2>Nodyx existe parce qu'il n'existait rien qui fasse tout ça en un seul outil décentralisé</h2>

<table>
  <thead><tr><th>Outil</th><th>Points forts</th><th>Problème</th></tr></thead>
  <tbody>
    <tr><td>Discord</td><td>UX excellent, riche en features</td><td>Propriétaire, vos données chez eux</td></tr>
    <tr><td>Matrix/Element</td><td>Décentralisé, fédéré</td><td>UX complexe, lourd à héberger</td></tr>
    <tr><td>Discourse</td><td>Excellent forum</td><td>Pas de chat temps réel, pas de voix</td></tr>
    <tr><td>Mumble</td><td>Voix P2P propre</td><td>Voix uniquement</td></tr>
    <tr><td><strong>Nodyx</strong></td><td><strong>Forum + Chat + Voix P2P</strong></td><td><strong>En construction 🚧</strong></td></tr>
  </tbody>
</table>

<h3>La contrainte qui définit tout</h3>
<blockquote><p><strong>Une instance = une communauté.</strong> Pas de multitenancy. Ton instance Nodyx c'est <em>ta</em> communauté. Tu contrôles les données, les règles, la modération.</p></blockquote>

<h3>La roadmap en 3 phases</h3>
<ol>
  <li><strong>Phase 1–2</strong> (complètes) — Forum + Chat temps réel + Auth + Admin</li>
  <li><strong>Phase 3</strong> (en cours) — Voix P2P, DataChannels, NodyxCanvas, Relay, TURN</li>
  <li><strong>Phase 4</strong> (à venir) — Fédération inter-instances, NODYX-RADIO, réseau de communautés</li>
</ol>

<h3>La prochaine frontière : le réseau</h3>
<p>Les instances Nodyx ne sont pas encore interconnectées. Le directory <strong>nodyx.org</strong> recense toutes les instances actives. La phase 4 sera la fédération : un compte sur une instance, membre de plusieurs communautés.</p>
<p><em>Ce n'est pas Discord. Ce n'est pas Mastodon. C'est autre chose.</em></p>`,

      `<p>La contrainte "une instance = une communauté" est contre-intuitive au début. Mais en y réfléchissant c'est ce qui garantit la <strong>souveraineté</strong>.</p>
<p>Impossible de diluer avec du multi-tenant. Chaque instance a ses propres règles, ses propres modérateurs, son propre style.</p>`,

      `<p>La fédération c'est la vraie promesse. Pouvoir suivre des communautés d'autres instances sans créer un compte sur chacune.</p>
<p>Un peu comme l'email : mon adresse gmail peut écrire à une adresse protonmail. La fédération Nodyx permettrait la même chose entre communautés.</p>`,

      `<p>Ce qui me plaît dans la roadmap : <strong>les choix sont cohérents</strong>. On n'ajoute pas des features pour faire des features — chaque brique sert la vision décentralisée.</p>
<p>NodyxCanvas P2P, relay TCP, TURN Rust... tout va dans le même sens : réduire la dépendance au serveur central.</p>`,

    ],
  },

  {
    title: 'Nodyx vs Discord vs Matrix — ce qui nous différencie vraiment',
    category: '💬 Discussions > Général',
    posts: [
      `<h2>Comparaison honnête — pas de mauvaise foi dans un sens ou dans l'autre</h2>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">comparaison honnête</span>
</p>

<table>
  <thead><tr><th>Feature</th><th>Nodyx</th><th>Discord</th><th>Matrix</th></tr></thead>
  <tbody>
    <tr><td>Auto-hébergeable</td><td>✅</td><td>❌</td><td>✅</td></tr>
    <tr><td>Forum classique</td><td>✅</td><td>❌</td><td>❌</td></tr>
    <tr><td>Chat temps réel</td><td>✅</td><td>✅</td><td>✅</td></tr>
    <tr><td>Voix P2P chiffrée</td><td>✅</td><td>Serveurs Discord</td><td>✅ via Jitsi</td></tr>
    <tr><td>Tableau collaboratif</td><td>✅ NodyxCanvas</td><td>❌</td><td>❌</td></tr>
    <tr><td>Install en 1 commande</td><td>✅</td><td>N/A</td><td>⚠️ lourd</td></tr>
    <tr><td>Fédération</td><td>🚧 en cours</td><td>❌</td><td>✅ ActivityPub</td></tr>
    <tr><td>Licence</td><td>AGPL-3.0</td><td>Propriétaire</td><td>Apache 2.0</td></tr>
  </tbody>
</table>

<h3>Ce que Discord fait mieux</h3>
<ul>
  <li>UX mobile (on n'a pas encore d'app native)</li>
  <li>Bots et intégrations tierces</li>
  <li>Réseau d'effet — tout le monde y est déjà</li>
</ul>

<h3>Ce que Matrix fait mieux</h3>
<ul>
  <li>Fédération mature avec protocole ouvert</li>
  <li>Clients multiples (Element, FluffyChat, Cinny...)</li>
</ul>

<h3>Ce que Nodyx fait mieux</h3>
<ul>
  <li><strong>Forum + Chat + Voix dans un seul outil léger</strong></li>
  <li>Install en une commande sur n'importe quel VPS</li>
  <li>P2P chiffré natif sans serveur média</li>
  <li>NodyxCanvas, Jukebox, Relay — des features inédites</li>
  <li>Zéro tracking, zéro analytics, zéro dépendance cloud</li>
</ul>
<blockquote><p>On ne remplace pas Discord. On existe pour les communautés qui veulent la souveraineté numérique sans sacrifier les fonctionnalités.</p></blockquote>`,

      `<p>Le tableau de comparaison honnête c'est rare. J'apprécie qu'on reconnaisse les forces de Discord plutôt que de faire semblant qu'il n'existe pas.</p>
<p>La concurrence honnête c'est ce qui pousse à faire mieux.</p>`,

      `<p>La fédération ActivityPub chez Matrix est bien mais le <strong>protocole Matrix est complexe</strong> à implémenter pour un tiers.</p>
<p>AGPL + API simple c'est peut-être plus accessible pour des contributeurs qui veulent intégrer Nodyx dans leur écosystème.</p>`,

    ],
  },

  {
    title: 'Bienvenue ! Présentez-vous ici 👋',
    category: '💬 Discussions > Présentations',
    posts: [
      `<h2>Bienvenue sur l'instance Nodyx Node ! 👋</h2>
<p>Ce fil est l'endroit pour se présenter. Qui êtes-vous ? Comment avez-vous découvert Nodyx ? Qu'est-ce que vous attendez de cette communauté ?</p>
<hr />
<p>Je commence : je suis <strong>Pokled</strong>, le créateur de Nodyx. Je construis ce projet parce que je voulais exactement ce genre de plateforme pour mes propres communautés — et elle n'existait pas.</p>
<ul>
  <li>Passionné par les <strong>systèmes décentralisés</strong>, Rust, WebRTC</li>
  <li>Fasciné par les outils qui redonnent le contrôle aux utilisateurs</li>
  <li>Nodyx est mon projet principal, développé <em>entièrement en public</em> sur GitHub</li>
</ul>
<blockquote><p>Cette communauté est la vôtre. N'hésitez pas à partager vos idées, remonter des bugs, ou juste dire bonjour. 🙂</p></blockquote>`,

      `<p>Je suis <strong>Morty</strong>, admin de cette instance. Je suis là pour tester toutes les features au fur et à mesure qu'elles sortent et remonter les bugs.</p>
<p>Ravi d'être parmi les premiers utilisateurs. Le NodyxCanvas m'a particulièrement bluffé — on voit rarement une feature aussi bien intégrée dans un outil de communication.</p>`,

    ],
  },

  {
    title: 'NODYX-RADIO — une nouvelle façon d\'exister pour les radios internet',
    category: '💡 Idées & Retours',
    featured: true,
    posts: [
      `<h2>Une idée qui me tient profondément à cœur</h2>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">vision</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6b7280;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">phase 4+</span>
</p>

<h3>Le problème des radios internet</h3>
<p>Il y a <strong>50 000 stations de radio actives</strong> dans le monde. La majorité diffuse dans le vide. Pourquoi ?</p>
<blockquote><p>Une radio sans communauté, c'est un cri dans le désert.</p></blockquote>
<p>Les stations qui survivent — SomaFM, Radio Paradise, SDF anonradio — ont toutes une chose en commun : elles ont créé une <strong>communauté</strong> autour d'elles avant d'être des radios.</p>

<h3>L'inversion que Nodyx permet</h3>
<table>
  <thead><tr><th>Modèle classique (mort)</th><th>Modèle Nodyx (vivant)</th></tr></thead>
  <tbody>
    <tr><td>Broadcast → espoir de communauté</td><td>Communauté → broadcast comme expression</td></tr>
    <tr><td>Studio d'abord, auditeurs ensuite</td><td>Forum, chat, voix d'abord — radio ensuite</td></tr>
    <tr><td>Revenus incertains</td><td>Régie coopérative intégrée</td></tr>
  </tbody>
</table>

<h3>Le modèle économique coopératif</h3>
<ul>
  <li><strong>80%</strong> des revenus publicitaires → la station</li>
  <li><strong>20%</strong> → nodyx.org (maintenance de l'infrastructure)</li>
  <li>Ciblage <em>géographique uniquement</em> — zéro tracking, zéro profil</li>
  <li>Le boulanger local finance la radio locale</li>
</ul>

<h3>La connexion ionosphérique</h3>
<p>La radio HF rebondit sur l'<strong>ionosphère</strong> — cette couche de plasma à 80-500 km d'altitude que personne ne peut acheter ni breveter. WSPR avec 1W traverse l'Atlantique. Utilisée dans la Seconde Guerre mondiale pour des communications longue distance.</p>
<blockquote><p><em>Personne ne peut acheter l'ionosphère.</em></p></blockquote>
<p>Nodyx ambitionne la même chose pour internet : un réseau de communautés sur une infrastructure que personne ne contrôle — technique, juridique, économique.</p>
<hr />
<p>C'est loin, c'est ambitieux. Mais c'est la direction.</p>`,

      `<p>L'analogie ionosphère → réseau décentralisé est puissante. L'ionosphère c'est de la <strong>physique</strong> — immuable, accessible à tous, impossible à privatiser.</p>
<p>C'est exactement ce que devrait être l'infrastructure du web.</p>`,

      `<p>Le modèle 80/20 est réaliste. Les stations radio ont besoin de revenus pour payer leurs licences et leur bande passante.</p>
<p>Un système coopératif où chaque station contribue à l'infrastructure commune — c'est exactement ce que fait SomaFM avec ses donateurs depuis 2000.</p>`,

      `<p>Je pense à <strong>SomaFM</strong> qui survit depuis 2000 uniquement par les dons de la communauté.</p>
<p>Si Nodyx avait existé en 2000, SomaFM aurait eu un forum, un chat, des salons vocaux — et probablement 10x plus de donateurs fidèles. <em>La communauté vient avant la radio.</em></p>`,

    ],
  },

  {
    title: 'Retours sur l\'UX de la v0.9 — ce qui marche, ce qui manque',
    category: '💡 Idées & Retours',
    posts: [
      `<h2>Retours honnêtes après quelques semaines d'utilisation quotidienne</h2>

<h3>✅ Ce qui marche vraiment bien</h3>
<ul>
  <li>La barre de contrôle vocal — intuitive, tout accessible en un clic</li>
  <li>NodyxCanvas — killer feature, surtout à 2-3 personnes</li>
  <li>Latence voix <strong>excellente</strong> (moins de 50ms en P2P direct)</li>
  <li>Le Jukebox — simple et efficace</li>
  <li>L'install en une commande — vraiment fluide</li>
</ul>

<h3>⚠️ Ce qui peut être amélioré</h3>
<ul>
  <li>Le partage d'écran n'affichait rien après sélection — <em>corrigé</em> ✅</li>
  <li>La page d'accueil forum était trop grande — <em>corrigée</em> ✅</li>
  <li>Pas d'indicateur visuel de qualité réseau dans la liste membres</li>
  <li>L'historique des messages ne charge pas toujours au premier join</li>
</ul>

<h3>💡 Suggestions</h3>
<ol>
  <li>Notification sonore quand quelqu'un rejoint le salon vocal</li>
  <li>Possibilité de nommer les sessions NodyxCanvas pour les exporter</li>
  <li>Mode "lecture seule" pour les visiteurs non-inscrits sur le forum</li>
  <li>Raccourcis clavier pour mute/sourd</li>
</ol>`,

      `<p>+1 sur la notification sonore au join. C'est un détail mais ça change l'immersion — tu sais que quelqu'un vient d'arriver sans regarder la liste.</p>`,

      `<p>Pour le mode lecture seule : c'est déjà partiellement là, non ? Les threads sont accessibles sans compte. Mais la <strong>recherche</strong> nécessite un compte je crois ?</p>`,

      `<p>La recherche est publique — tu peux chercher sans être connecté. Ce qui nécessite un compte : poster, réagir, accéder au chat et vocal.</p>
<p>La vision : forum <strong>ouvert en lecture</strong> avec une couche sociale optionnelle. Comme un vrai forum public, pas un walled garden.</p>`,

    ],
  },

  {
    title: 'Guide : installer Nodyx sur un VPS en 5 minutes',
    category: '📚 Guides & Documentation',
    posts: [
      `<h2>L'installation la plus rapide d'une plateforme communautaire complète</h2>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">Ubuntu</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#3b82f6;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">2GB RAM</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">ports 80 443</span>
</p>

<h3>Prérequis</h3>
<ul>
  <li>VPS Ubuntu 22.04 ou 24.04 (2 vCPU, 2 GB RAM minimum)</li>
  <li>Ports <strong>80</strong> et <strong>443</strong> ouverts</li>
  <li>Optionnel : un domaine pointant vers votre IP</li>
</ul>

<h3>Installation en une commande</h3>
<pre><code class="language-bash">bash &lt;(curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh)</code></pre>

<h3>Le script vous pose 5 questions</h3>
<ol>
  <li>Nom de votre communauté</li>
  <li>Description</li>
  <li>Email admin</li>
  <li>Mot de passe admin</li>
  <li>Domaine <em>(optionnel — si vide, utilise <code>{IP}.sslip.io</code> avec Let's Encrypt auto)</em></li>
</ol>

<h3>Ce que le script installe</h3>
<ul>
  <li>Node.js 20, PostgreSQL, Redis, Caddy</li>
  <li>Clone du repo + build backend + frontend</li>
  <li>PM2 pour le démarrage automatique au boot</li>
  <li>Caddy avec <strong>HTTPS automatique</strong> (Let's Encrypt)</li>
  <li>nodyx-turn (serveur STUN/TURN Rust)</li>
</ul>

<h3>Oracle Cloud Free Tier — le meilleur plan gratuit</h3>
<p>Pour tester : <strong>Oracle Cloud Free Tier</strong> propose ARM Ampere A1 — jusqu'à 4 vCPU + 24 GB RAM, <em>gratuitement et en permanence</em>. Nodyx tourne confortablement là-dessus.</p>
<pre><code class="language-bash"># Sur Oracle Cloud Ubuntu 22.04 ARM
bash &lt;(curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh)
# Durée : ~4 minutes ⏱️</code></pre>`,

      `<p>Je viens de tester sur un VPS Oracle Cloud Free Tier (ARM Ampere). Ça tourne parfaitement. <strong>L'install a pris 4 minutes chrono.</strong></p>
<p>C'est vraiment impressionnant pour une stack aussi complète : forum, chat temps réel, voix P2P, tableau collaboratif, tout en place.</p>`,

      `<p>Oracle Cloud Free Tier ARM c'est LE bon plan pour tester. 4 vCPU + 24GB RAM gratuitement. Nodyx tourne confortablement là-dessus.</p>
<p>Attention : il faut s'inscrire avec une carte de crédit (pour vérification) mais le tier gratuit <strong>ne débite rien</strong>.</p>`,

      `<p>Est-ce que ça fonctionne aussi sur Raspberry Pi ? Je voudrais tester depuis chez moi avec le relay.</p>`,

      `<p><strong>Pi 4 (4GB RAM) : testé et validé.</strong> Le relay client tourne en service systemd, la connexion est stable. Voir le guide relay pour les détails complets.</p>
<p>Sur Pi 3 (1GB RAM) c'est limité — le build frontend consomme beaucoup de RAM. Pré-builder sur une autre machine et copier le <code>build/</code> fonctionne.</p>`,

    ],
  },

  {
    title: 'Guide : héberger Nodyx depuis chez soi avec Nodyx Relay',
    category: '📚 Guides & Documentation',
    posts: [
      `<h2>Héberger son instance à la maison — sans ouvrir de ports</h2>
<p>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">Raspberry Pi</span>
  <span style="display:inline-block;padding:1px 8px;border-radius:4px;background:#6366f1;color:white;font-size:11px;font-weight:600;margin:2px 4px 2px 0;white-space:nowrap">aucun port</span>
</p>

<h3>La situation typique</h3>
<ul>
  <li>Box FAI avec CGNAT (courant en 4G/5G, de plus en plus en fibre)</li>
  <li>IP dynamique qui change régulièrement</li>
  <li>Pas envie de payer pour un VPS</li>
</ul>

<h3>Installation</h3>
<pre><code class="language-bash">bash &lt;(curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh)</code></pre>
<p>Ou sur une instance déjà installée :</p>
<pre><code class="language-bash">nodyx-relay client \\
  --server relay.nodyx.org:7443 \\
  --slug votre-slug \\
  --token votre-token \\
  --local-port 80</code></pre>

<p><strong>Résultat :</strong> votre instance accessible sur <code>https://votre-slug.nodyx.org</code></p>

<h3>Points techniques importants</h3>
<ul>
  <li>Reconnexion automatique avec <strong>backoff exponentiel</strong> <code>1s → 2s → 4s → max 30s</code></li>
  <li>Compatible Socket.IO long-polling <em>et</em> WebSocket</li>
  <li>TLS géré par Cloudflare — pas besoin de certificat local</li>
  <li>Le relay ne voit que le trafic HTTP en transit — pas de déchiffrement</li>
</ul>

<h3>Recommandé pour</h3>
<ul>
  <li>🍓 Raspberry Pi 4 (4GB+)</li>
  <li>NAS Synology / QNAP</li>
  <li>Mini-PC maison (NUC, Beelink...)</li>
  <li>VM locale sur un serveur de gaming</li>
</ul>`,

      `<p>Testé sur un Pi 4 derrière une box Orange. Pas de port ouvert, IP dynamique. <strong>La reconnexion automatique fonctionne à chaque redémarrage du Pi.</strong></p>
<p>J'ai même coupé le Pi pendant 2h et la reconnexion au relay s'est faite en moins de 30 secondes au redémarrage.</p>`,

      `<p>Le point sur le TLS Cloudflare est important à comprendre : CF gère le chiffrement entre le visiteur et CF, mais le trafic entre CF et votre machine passe via le relay en clair (sur localhost).</p>
<p>Pour des données très sensibles, ajouter un certificat SSL local en plus. Pour un usage communauté normale, le schéma actuel est très bien.</p>`,

    ],
  },

]

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`  ${msg}\n`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Nodyx Forum Seed — histoire et évolution de Nodyx\n')

  // ── Résoudre la communauté ─────────────────────────────────────────────────
  const { rows: communityRows } = await db.query(
    `SELECT id FROM communities WHERE slug = $1`, [COMMUNITY_SLUG]
  )
  if (!communityRows[0]) {
    console.error(`❌ Communauté "${COMMUNITY_SLUG}" introuvable. Vérifiez NODYX_COMMUNITY_SLUG.`)
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

    // Timestamps strictement croissants : OP le plus ancien, dernière réponse la plus récente
    const now = Date.now()
    const spread = 30 * 24 * 60 * 60 * 1000
    const n = t.posts.length

    for (let i = 0; i < n; i++) {
      // OP = Pokled ; réponses = démo users en round-robin ou Pokled si aucun
      let postAuthorId = authorId
      if (i > 0 && demoUsers.length > 0) {
        postAuthorId = demoUsers[(i - 1) % demoUsers.length].id
      }

      // i=0 (OP) → oldest (~30j ago) ; i=n-1 (last reply) → most recent (~1j ago)
      const fraction = n === 1 ? 1 : i / (n - 1)
      const ageOffset = Math.floor(spread * (1 - fraction * 0.97))
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
