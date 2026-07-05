# Changelog

All notable changes to Nodyx are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [2.9.0] — 2026-07-05

### Vocal : le cap SFU est posé, et le mesh actuel respire mieux

Le constat est mathématique : en mesh P2P, celui qui partage son écran uploade son flux vers chaque spectateur (15 spectateurs à 3 Mbps = 42 Mbps montants, impossible sur une connexion résidentielle). Le cap est donc acté et outillé :

- **CDC complet du SFU** : `SPECS/NODYX_SFU_CDC.md`, architecture hybride (mesh en petit comité, SFU au-delà ou dès qu'un partage d'écran démarre), moteur mediasoup derrière une abstraction swap-ready, fédération inter-instances par cascade (PipeTransport sur WireGuard), phasage P0 à P5
- **Crate Rust `nodyx-sfu`** (le cerveau, déjà testé) : séparation hexagonale en trois étages, `VoiceService` (règles métier : salons, sièges, kick, bascule hybride, publish/subscribe) qui ne parle qu'au trait `MediaEngine` (transport pur), implémenté aujourd'hui par un `NullEngine` de test, demain par mediasoup, plus tard par un moteur Rust natif, sans réécrire le produit. Zéro dépendance, zéro `unsafe`, 23 tests
- **Quick wins immédiats sur le mesh actuel** : DTX Opus adaptatif (au-delà de 4 participants, le silence ne coûte quasi plus rien en upload ; en dessous, le réglage anti-jitter d'origine est conservé) et plafond de bitrate du partage d'écran selon qualité et fps (l'encodeur n'était pas borné : c'était le mur des watch-parties)
- Volume par participant enfin **persistant** (indexé par utilisateur + localStorage, il ne survivait pas au refresh)

### TURN : le serveur possède sa plage de ports relais (fix de fond)

`nexus-turn` allouait ses ports relais dans la plage éphémère de l'OS, alors que le pare-feu n'ouvre que 49152-65535. Sur un OS au défaut kernel (32768-60999), plus de la moitié des allocations tombaient hors pare-feu : relais bloqué, vocal intermittent pour les auto-hébergés (NAT strict, mobile).

- `nexus-turn` accepte `--min-port`/`--max-port` (défauts alignés sur le pare-feu de l'installeur) et sonde sa plage lui-même : plus aucune dépendance à `ip_local_port_range`
- Réparation du build (hmac 0.13) et **CI élargie à tout le workspace Rust** : un crate cassé ne peut plus passer inaperçu
- Diagnostic réseau admin (`/admin/status`) : le test TURN utilise désormais des **credentials frais** via `GET /api/v1/instance/ice-servers` (les credentials figés au build expiraient en moins de 24h et la tuile RELAY mentait), et le STUN Google est retiré du testeur (nexus-turn répond au STUN, zéro service tiers)

### Thème d'instance : l'owner impose son identité, le membre reste libre

- Nouveau système de thème d'instance : l'owner définit la base (`theme_vars` structuré, `theme_css` libre, effet d'ambiance type **Matrix** avec pluie de caractères respectueuse de `prefers-reduced-motion`), chaque membre peut surcharger pour lui-même
- Tokenisation de ~800 couleurs codées en dur vers des variables `--nx-*` (indigo/violet/cyan et leurs glows) : les instances peuvent enfin re-teinter toute l'interface sans fork, nodyx.org reste identique par défaut
- Fix critique multi-instances : le préfixe Redis lit désormais `REDIS_KEY_PREFIX` (deux instances co-hébergées partageaient sessions et caches)

### Emojis personnalisés (les émotes de la communauté)

- Upload d'emojis avec **shortcode** (`:mon_emote:`), rendus dans les messages et les réactions du chat, protection des blocs de code
- Picker enrichi : recherche, onglet Fréquents (usage local), onglet PERSO accentué, barre de réactions rapide au survol des messages alimentée par vos emojis les plus utilisés
- Aide au format à l'upload (taille idéale, formats) et déduplication des listeners socket du chat (réactions qui clignotaient)

### Feed social : vrai temps réel

- Le fil d'actualité se met à jour en direct (posts, réponses imbriquées, réactions) sans rafraîchir
- Compteur de réponses = total des descendants (fil complet), compteur de posts du profil corrigé, posts du profil cliquables vers une page `/status/:id` **interactive** (composer, réactions)
- Plus de notification de mention si vous êtes déjà sur le canal ; le compte de membres exclut les comptes système
- Mise à jour applicative **transparente** après déploiement (service worker + rechargement au premier clic) et `Cache-Control: no-cache` sur le HTML SSR (fin des pages figées au retour d'une autre instance)
- Édition d'un message du chat : tableaux et structure riches préservés

### i18n : couverture massive et deux nouvelles langues

- **Russe et portugais** ajoutés (6 langues au total)
- Traduction du cœur membre qui restait codé en dur en français : découverte, wiki, tâches, fil d'actu et navigation, chat, édition de profil, DM (bandeaux E2E inclus), réglages, comptes connectés, sidebars, page membres, widgets de homepage

### DM chiffrés : backup de clé (modèle Signal PIN)

- Sauvegarde de la clé E2E chiffrée par passphrase (PBKDF2 600k itérations puis AES-GCM), le serveur ne stocke qu'un blob opaque
- Restauration sur un nouvel appareil ou navigateur, générateur de phrase, bandeau pédagogique dans les DM, garde-fou avant envoi si la clé n'est pas sauvegardée

### P2P Rust : découverte de pairs par gossip

- Nouveau crate `nodyx-gossip` : découverte de pairs par anti-entropie épidémique, **bibliothèque standard uniquement** (zéro crate externe), auto-guérison par TTL, le réseau survit à la chute du nœud bootstrap
- Records **signés Ed25519** : node_id = clé publique, vérification stricte à la fusion (anti-spoofing, anti-rejeu), identité persistante par fichier de clé

### Bibliothèque

- Lecteur audio intégré et bouton d'insertion de fichier

### Dépendances

- Vagues Dependabot traitées (actions, groupes minor/patch npm et cargo)

---

## [2.8.0] — 2026-06-20

### Éditeur d'articles : refonte de robustesse et d'UX (sprint juin)

Gros chantier sur l'éditeur riche (TipTap) après un audit complet. Cause racine identifiée et corrigée : certains blocs personnalisés se reconnaissaient via des attributs `data-*` que le sanitizer backend supprime, donc l'éditeur les déstructurait à la réédition (perte silencieuse de contenu). Principe établi : **un bloc se reconnaît sur sa classe CSS** (préservée), jamais sur un `data-*` volatil.

**Robustesse round-trip (anti-perte de données)**
- Colonnes et vidéos YouTube : ne disparaissent plus à la réédition (parse sur la classe + reparse des iframes nus)
- Console SSH des tutos (`.nodyx-term`) : devient un **nœud atomique protégé** qui capture son HTML et le ré-émet tel quel, avec un toggle **Rendu / Code** façon CMS (la source est éditable, jamais corrompue au clavier)
- Sommaire étanche : une image ne peut plus se faire aspirer dans la boîte sommaire
- Remplacement d'image réel : capture de la sélection à l'ouverture du menu

**Nouvelles fonctionnalités d'édition**
- **Ancres à la sélection** : barre flottante sur le texte surligné avec un bouton « Ancre » qui transforme la ligne en titre de section et l'ajoute à un menu Sommaire dérivé (recalculé, avec flash de feedback)
- **Redimensionnement d'image** : poignées de coin avec aimant aux largeurs clés (25 / 50 / 75 / 100 %), largeur stockée en attribut `width`
- **Zone éditable à hauteur bornée** + ascenseur interne : la barre d'outils reste toujours accessible sur les longs articles
- **Console SSH stylée** (`.nodyx-term`) pour les tutoriels d'installation : fenêtre terminal avec barre de titre et coloration sémantique

**Doc** : audit complet de l'éditeur dans `docs/audits/2026-06-15-editeur-rich.md`

### Streamer Hub : playlists audio et scènes OBS

- Playlists nommées dans la bibliothèque audio (Dev, Discussion, etc.), URL d'overlay OBS dédiée par playlist, contrôle depuis le Stream Deck
- Tab « Scènes OBS » : compositeur visuel inspiré d'OBS pour placer overlays et playlists, avec pickers et création inline
- Migrations 100 à 102 (playlists, jonction, scènes OBS)

### Référencement (SEO / GEO) : fondations

- Correction du sitemap (les threads n'y apparaissaient jamais : passé de 14 à plus de 60 URLs)
- **og:image unique** par page = image de l'article (fini les doublons et la mauvaise image dans les partages Discord / Twitter), résolution rétroactive sur tous les articles
- `llms.txt` réécrit, `robots.txt` rebrandé Nodyx, fichiers de vérification moteurs gitignorés (propres à chaque instance)
- Guides publiés : comparatif honnête des alternatives (FR + EN) et guide d'installation débutant pas à pas (FR + EN)

### Admin et performance

- Refonte sobre (style Linear / Vercel / Stripe) de la sidebar et du dashboard admin : palette zinc, un seul accent, emojis hors labels système
- SSR sans suspension sur le fetch directory + invalidation du cache showcase par clé de version (un article épinglé apparaît immédiatement)
- La home se rafraîchit après suppression d'un thread (invalidation des chargements, plus de refresh manuel)
- Grid Builder : scroll automatique vers la nouvelle ligne ajoutée

### Sécurité et dépendances

- ws (high, DoS WebSocket) et tar (medium) corrigés sur core et frontend
- esbuild porté à `>= 0.28.1` via override sur les 4 projets SvelteKit (sans montée vite 8 cassante)
- nodemailer 8 → 9 (validé en production), `@types/node` ajouté à l'authenticator, groupes de dépendances minor/patch à jour, GitHub Actions checkout / setup-node à jour
- js-yaml (turn-server legacy non déployé) : dismissée avec motif documenté

---

## [2.7.0] — 2026-06-02

### Streamer Hub : Nodyx Soundboard (bibliothèque, overlay OBS, queue viewers)

Un soundboard complet : le streamer upload ses sons, les déclenche depuis son Stream Deck mobile ou son chat Twitch, ils sortent sur OBS via une browser source, et les viewers peuvent piocher dans la liste publique pour remplir la queue. Tout est intégré, rien à câbler entre 3 SaaS.

**Bibliothèque audio**
- Nouvelle migration 098 : table `streamer_audio_library` jointe à `community_assets`
- Upload drag and drop ou click multi-fichiers, formats mp3, ogg, wav, flac
- Extraction automatique des tags ID3 via `music-metadata` : titre, artiste, durée, cover art embedded (APIC) sauvée dans `uploads/audio_thumbs/`
- Compteur de progression live durant les uploads en batch (le streamer voit où il en est sur 50 fichiers)
- Édition inline par piste : titre, artiste, visibilité (privé / public), volume défaut 0 à 2x, fade in / out 0 à 10s, loop, indicateur royalty-free, tags
- Migration 099 : bump du cap `valid_file_size` de 12 à 50 MB pour accueillir les WAV courts, aligné avec la limite Fastify multipart
- Bypass de la quota community 200 MB / 24h pour les owner / admin (le streamer gère son propre disque, pas de friction)

**Overlay OBS Soundboard**
- Nouveau type d'overlay `soundboard` qui s'ajoute aux 6 existants (alert, goal, timer, ticker, leaderboard, clips)
- Page browser source `/overlay/soundboard/[token]` : fond transparent, player Web Audio API
- Fade in / out par piste, cross-fade automatique quand un nouveau son démarre pendant qu'un autre joue
- OSD discret en coin (vignette, titre, artiste, barre de progression), position configurable (4 coins ou caché)
- Plusieurs overlays soundboard par owner supportés : une browser source par scène OBS, toutes reçoivent le même flux
- Badge "Soundboard prêt" affiché 6 secondes au connect pour confirmer la liaison en preview navigateur, disparaît tout seul en prod

**Page publique viewers `/soundboard`**
- Accessible sans login, lien direct depuis le tab admin Soundboard
- Section "En cours" temps réel : carte avec vignette, titre, artiste, barre de progression recalculée client-side depuis le timestamp serveur
- Section "À suivre" : queue des sons demandés, source visible (ajout web ou ajout chat) et username
- Bibliothèque publique en liste verticale full-width : titre complet visible (plus de troncature sur les titres longs), preview audio au hover, recherche live par titre ou artiste
- Polling REST toutes les 2 secondes, pas de socket public exposé (surface d'attaque minimisée)

**Queue viewers**
- Service Redis dédié (`soundboardQueueService.ts`) : queue FIFO max 50, rate limit 30s par IP, cap 3 sons simultanés par IP, déduplication globale par trackId
- Bouton "+ Queue" violet sur chaque track de la page publique, feedback toast clair pour chaque cas de refus (rate-limit, dédup, queue désactivée, cap atteint)
- Toggle admin "Viewers autorisés / Viewers bloqués", ON par défaut, persiste en Redis (filet anti-spam en cas de raid)
- Auto-consume : quand un son finit côté overlay (event `audio:ended`), le backend pop le suivant et émet automatiquement le prochain `audio:play`
- Affichage admin temps réel dans le tab Soundboard : liste FIFO, skip d'un son spécifique, "Tout vider"

**Commande chat `!nextsound` et alias `!ns`**
- Le viewer tape `!ns ixion` dans le chat Twitch, le bot Nodyx ajoute le son qui matche le mieux dans la queue
- Fuzzy matcher dédié (`audioTrackMatcher.ts`) : normalisation casse + accents, scoring en cascade (exact > substring début > substring milieu > tokens + Levenshtein sur premier mot avec tolérance 2 fautes)
- Détection d'ambiguïté : si les 2 meilleurs résultats sont à moins de 100 points d'écart, le bot répond les 3 candidats pour que le viewer précise au lieu de deviner mal
- Bot replies dédiées pour chaque cas (succès, ambigu, introuvable, rate-limit, cap 3 atteint, dédup, queue désactivée)
- Rate-limit par chatter Twitch (via `chatter_user_id`), pas par IP

### Streamer Hub : Nodyx Deck multi-pages + actions audio

Évolution majeure du Stream Deck pour intégrer le soundboard et permettre d'organiser les boutons sur plusieurs écrans logiques (une page sons, une page commandes, une page modération).

**Layout multi-pages**
- Le layout passe de `{ rows, cols, buttons[] }` à `{ rows, cols, pages: [{ id, name, color, buttons[] }] }`, jusqu'à 8 pages par deck
- Sanitizer backwards-compat côté serveur : les decks V1 (`buttons` à plat) sont automatiquement wrappés dans une page "Principal" sans migration SQL ni casser l'existant
- Pill bar admin avec rename inline (double-clic), choix de couleur d'accent via color picker, drag-to-reorder, suppression avec confirmation si la page contient des boutons
- Sélecteur "Page" dans l'éditeur de bouton : déplace le bouton vers une autre page (placement automatique dans la 1ère case libre)
- Compteur de cases libres par page dans le dropdown pour éviter "page pleine"

**Quatre nouvelles actions Deck**
- `play_audio` : déclenche un son du soundboard (picker intégré avec recherche live + vignettes dans l'éditeur d'action)
- `stop_audio` : coupe la lecture en cours avec fade out
- `pause_audio` : met en pause la piste courante
- `navigate_page` : saute vers une autre page du deck (cible précise ou jump relatif `home` / `prev` / `next`), intercepté client-side sur le mobile pour zéro latence

**Mobile deck**
- Dock flottant en bas de l'écran : chips par page avec couleur d'accent custom, pastille de sélection animée, blur backdrop, safe-area iOS pour pas être mangé par la home bar
- N'apparaît que si le deck a plus d'une page et qu'on n'est pas en mode chat plein écran
- Vibration haptique au switch de page

**Send to Deck modal**
- Bouton "+ Deck" sur chaque ligne du tab Soundboard : rattache un son à un bouton sans naviguer dans 3 onglets
- Modal avec sélection du deck cible, sélection de la page, mini-grille interactive pour cliquer sur une case libre (les cases occupées montrent l'icône du bouton existant)
- Bouton "Auto-placement" qui pose dans la 1ère case libre
- Reste ouvert après chaque placement pour enchaîner facilement (idéal pour bâtir une page complète d'un coup)
- Gradient déterministe par trackId : un même son aura toujours la même couleur dans le deck, mémoire visuelle renforcée

### Infrastructure et divers

- Limite Fastify multipart globale passée de 12 à 50 MB
- Trois nouvelles `AuditAction` : `audio_track_added`, `audio_track_updated`, `audio_track_deleted`
- Refonte de plusieurs panels admin (Chat Timers, Chat Commands) en grille tabulaire alignée (header + colonnes) avec sub-nav unifiée dans le tab Bot Chat
- Refonte de `Tooltip.svelte` avec icône Lucide sobre
- Refonte du tab admin Streamer Hub : design "Linear / Vercel sober", palette zinc / accent purple, 3 niveaux d'élévation, suppression du look "trop IA / carnaval"

---

## [2.6.0] — 2026-05-28

### Streamer Hub : Bot Chat (timers, commands natives et custom)

Suite logique du chat bridge livré en 2.5.0. Le streamer dispose maintenant d'un véritable bot configurable côté Nodyx, qui réutilise le pipeline de relay Twitch existant.

**Chat timers (messages bot récurrents)**
- Nouvelle table `streamer_chat_timers` (migration 093) avec scheduler interne tick 60 secondes
- Trois modes de déclenchement (migration 094) : récurrent, une fois par live (idéal phrase d'accueil après go-live), une seule fois avec auto désactivation
- Anti-spam chat vide via compteur Redis incrémenté à chaque message inbound, reset après envoi
- Template avec variables `{nodyx_url}`, `{streamer}`, `{uptime}` et aliases tolérants `{url}`, `{lien}`, `{link}`, `{chaine}`, `{channel}`, `{duree}`, `{duration}`
- UI admin tab Bot Chat avec recettes pré-faites : Bienvenue, Pub Nodyx, Schedule, Réseaux, Annonce
- Bouton aperçu rendu + bouton envoyer maintenant pour tester en direct

**Chat commands**
- Six commandes natives : `!nodyx` (lien instance), `!uptime` (durée stream live), `!commands` (liste publique), `!so @streamer` (shoutout via Helix lookup), `!highlight` (marker VOD + audit), `!topclips` (existant, refactoré)
- Commandes custom éditables admin (migration 095) avec validation regex stricte sur le nom (`![a-z0-9_-]{1,30}`), cooldown personnalisable 5 à 3600 secondes, mod-only togglable
- Réservation des noms hardcoded : impossible de créer une commande custom qui shadowerait `!nodyx` ou `!topclips`
- UI admin avec presets prêts à l'emploi (`!discord`, `!schedule`, `!social`, `!lurk`, `!soutien`, `!projet`)
- Dispatcher unifié dans `streamerHubService.handleChatCommand` : hardcoded d'abord, fallback DB ensuite, même pipeline cooldown Redis

### Streamer Hub : Nodyx Deck (Stream Deck tactile)

Nouvelle face du hub : un panneau de boutons mobile-first qui remplace un device Stream Deck physique. Une URL token-auth, une grille configurable, plein écran sans chrome.

**Backend**
- Migration 096 : table `streamer_decks` avec layout en JSONB (rows, cols, buttons) pour évoluer sans migration
- Quatre types d'actions V1 : `top_clips` (overlay cible + période + count), `vod_marker` (description optionnelle), `chat_message` (texte libre via relay), `trigger_command` (déclenche une command custom par nom)
- Sanitization stricte côté serveur : un layout malformé est silencieusement nettoyé, jamais rejeté
- Token unguessable 43 chars base64url, révocable, `last_seen_at` trackée

**Page mobile `/deck/[token]`**
- Plein écran sans aucun chrome Nodyx (bypass layout cascade comme les overlays OBS)
- Grille adaptative landscape/portrait, boutons avec gradient animé, effet pressed scale + ring glow
- Haptic feedback via Vibration API (20 ms au tap, 30/40/30 ms en confirmation OK)
- Toast slide-in fade-out 2.8 s pour chaque action
- Screen Wake Lock API : l'écran reste allumé tant que le deck est ouvert, re-demande automatique au foreground après mise en arrière-plan
- Indicateur cliquable pour toggle le wake lock

**Éditeur admin WYSIWYG**
- Mockup mobile en preview live à droite du panneau d'édition
- Bibliothèque emoji 36 entrées + champ libre, palette 8 gradients pré-fabs (Cyber, Néon, Inferno, Forest, Minimal, Sunset, Ocean, Amber), gradient custom au format `hex/hex`
- Trois packs de presets de deck : Démarrage, Modération, Engagement
- Boutons redimensionnables (1 à 4 cellules) et déplaçables dans la grille
- Modal de partage : QR code 280px, Web Share API native, envoi par mail, copie URL

### Streamer Hub : Sound Library (presets WebAudio)

Nouvelle bibliothèque de sons d'alerte synthétisés en pur WebAudio.

- Nouveau module `lib/sounds/presetSounds.ts` avec six presets : Carillon, Ding, Pop, Cloche, Retro 8-bit, Fanfare, plus une option "Aucun" silencieuse
- Aucun fichier audio bundlé, aucune charge réseau, latence inférieure à 5 ms
- Helper unifié `playAlertSound(soundUrl, volume)` qui accepte soit une URL classique (médiathèque, externe), soit un préfixe `nodyx:<preset>`
- Intégration overlay alert_box : rangée de chips presets par event, preview au clic, fonctionne avec ou sans URL personnalisée en parallèle
- AudioContext singleton avec resume automatique au premier user gesture (Safari, Chrome autoplay policy)

### Streamer Hub : Notifications sonores admin

Le streamer qui coupe son retour audio OBS (pour éviter l'écho micro) ne ratait plus ses follow / sub / cheer / raid : un son joue maintenant côté Nodyx.

- Nouvelle sous-section "Notifications Streamer (Twitch)" dans `/settings` Sons, visible uniquement pour owners et admins
- Toggle master + slider volume + par event un sélecteur de preset, un bouton tester et un toggle individuel
- Persisté en localStorage par device : un streamer peut configurer différemment son ordi et son tel
- Listener global `StreamerNotifListener` monté dans le layout racine qui joint la room `admin:streamer-hub` via Socket.IO et joue le son configuré sur réception d'un `streamer:event` matching
- Défauts intelligents : pop pour follow, fanfare pour sub et sub gift, ding pour cheer, cloche pour raid

### UX : composant Tooltip et propagation des presets

Premier pas vers une expérience néophyte friendly.

- Nouveau composant `lib/components/ui/Tooltip.svelte` réutilisable, pure CSS, accessible (focus, aria-label), 3 positions, 3 variantes (info, tip, warn)
- Tooltips sur tous les champs techniques du tab Bot Chat : modes de déclenchement, intervalle, min messages chat, live only, cooldown, mod-only, variables disponibles
- Bandeaux "Recettes prêtes à l'emploi" sur Timers et Commandes custom : un clic pour pré-remplir un timer ou une commande avec des défauts intelligents, ajustables avant enregistrement

### Backend

- Audit log enrichi de 11 nouveaux event types : `chat_timer_created/updated/deleted/send_now`, `chat_command_created/updated/deleted`, `deck_created/updated/revoked/action_executed`
- Service `twitchStreamControl` exporté avec deux nouveaux helpers Helix : `getUserByLogin(login)` et `getChannelByBroadcasterId(broadcasterId)` réutilisés par la command `!so`
- `streamerHubService.getHardcodedCommandNames()` exporté pour permettre au service custom commands de refuser les noms réservés

### Installer (déjà mergé sur main)

- `install.sh` ligne 2317 : heap cap Node scalé selon la RAM totale (commit 6c06839)
  - moins de 1.5 GB : 768 MB
  - 1.5 à 3 GB : 1536 MB
  - 3 à 8 GB : 2048 MB
  - 8 GB et plus : 4096 MB
- Corrige les OOM lors du build SvelteKit constatés sur hosts récents : le cap 1024 MB précédent crashait à environ 1015 MB sur les builds Vite 4500+ modules
- Même logique appliquée au bloc rebuild du chemin update via `free -m`

---

## [2.5.0] — 2026-05-10

### Streamer Hub — Phase 2 : chat unifié Twitch ↔ Nodyx (spec 015)

Chat bidirectionnel temps réel entre une instance Nodyx et le chat Twitch du streamer principal. Pipeline 100% EventSub Chat + Helix Send Chat Message, zéro IRC. Vérifié en prod (277 messages reçus pendant la session test). Voir [PHASE_2_REPORT.md](docs/specs/015-streamer-hub/PHASE_2_REPORT.md) pour le détail complet.

**Chat inbound (Twitch → Nodyx)**
- Subscription EventSub `channel.chat.message` créée et persistée (`enabled`)
- Channel `#twitch-chat` auto-créé à la première sync, read-write par défaut pour tous les membres
- Chaque message Twitch est mappé à un author Nodyx (résolu via `twitch_id` si lié, sinon créé en placeholder) et publié dans `#twitch-chat`
- Volume non persisté dans `streamer_events` (early-return), atterrit directement dans `channel_messages`

**Chat outbound (Nodyx → Twitch)**
- Quand un membre Nodyx écrit dans `#twitch-chat`, le message est relayé via Helix `POST /chat/messages` (best-effort, async, ne bloque pas le socket)
- Préfixe `[username]` activé par défaut (transparence pour les viewers Twitch), désactivable via `STREAMER_CHAT_NO_PREFIX=1`
- Garde-fou : on n'envoie QUE si une session `streamer_sessions.ended_at IS NULL` existe. Mode test bypass via `STREAMER_CHAT_TEST_MODE=1`
- Sur 429 Twitch (rate-limit), le message est enqueué dans une sorted set Redis `streamer:chat:send_queue` (score = nextRetryAt). Worker `setInterval(2s)` qui dépile par batch de 10, retry avec backoff exponentiel `2^attempts * 1s` (cap 30s). Drop si attempts > 5 ou TTL 60s dépassé
- Alerte audit `chat_relay_queue_overflow` si la queue dépasse 50 messages
- Nouvelles actions audit : `chat_relay_sent`, `chat_relay_queued`, `chat_relay_dropped`, `chat_relay_queue_overflow`

**Lifecycle des sessions de stream**
- `stream.online` event → INSERT row dans `streamer_sessions` (external_id = stream_id Twitch, idempotent `ON CONFLICT DO NOTHING`)
- `stream.offline` event → UPDATE `ended_at = NOW()` sur toutes les rows ouvertes du provider
- Nécessaire pour le check live du chat bridge outbound (§6.4)

**Emotes et badges**
- Emotes natives Twitch rendues depuis les fragments du payload (CDN `static-cdn.jtvnw.net`)
- Emotes BTTV / FFZ / 7TV fetched en parallèle par channel, cache Redis 24h (`streamer:emotes:ch:<id>`). Précédence 7TV > FFZ > BTTV pour les codes en collision
- Badges Twitch globaux + channel via Helix `/chat/badges/global` + `/chat/badges/channel`. Caches Redis : global 7j, channel 24h, App Access Token 50j. Badge channel override global (custom subscriber, etc.)
- Render `<img class="streamer-badge">` préfixé au message, `<img class="streamer-emote">` inline
- Dégradation gracieuse : si Helix ou un provider tiers échoue, le message reste lisible sans emotes/badges

**Tests**
- 65 nouveaux tests Phase 2 (5 fichiers) : bridge (14), emotes (11), lifecycle (9), outbound queue (17), badges (14)
- Suite complète : 269/269 verts (vs 204/204 avant Phase 2)

**Scopes Twitch (Phase 1+2 accordés)**
`bits:read`, `channel:bot`, `channel:read:polls`, `channel:read:subscriptions`, `moderator:read:followers`, `user:bot`, `user:read:chat`, `user:read:email`, `user:write:chat`. Phase 4 ajoutera `channel:manage:polls`. Phase 5 ajoutera `clips:edit`.

**Hygiène & docs**
- Audit complet Phase 2 réalisé le 2026-05-10 (détection : badges manquants, queue manquante, tests Phase 2 à zéro, commentaires obsolètes)
- Cleanup : import `redis` inutilisé retiré, commentaires obsolètes corrigés (`twitchChatBridge.ts`)
- `docs/specs/015-streamer-hub/PHASE_2_REPORT.md` créé (source froide, pattern aligné sur `PHASE_0_REPORT.md`)
- Spec §13 + §17 rectifiées : Phase 1 = Flow A only (Flow B/C reportés en Phase 5 où ils s'intègrent avec la Twitch Extension)

---

## [2.4.0] — 2026-05-07

### Backup System — Phase 1 MVP (spec 014)

First slice of the backup & restore system, fully wired end-to-end and smoke-tested on prod before merge — including a real-world incident that revealed and fixed a design bug live (see "The Yannick Story" below).

**Backend**
- New migration `077_backups.sql` with three tables: `backups`, `backup_settings` (singleton), `backup_audit_log`
- `backupService.ts` shells out to `pg_dump --format=custom --compress=9` and `tar -czf`, computes SHA-256 of the archive, and writes the row + audit entry. Restores use `pg_restore --single-transaction --clean --if-exists` so a half-failed restore rolls back atomically
- `pg_dump` excludes the four meta-system tables (`backups`, `backup_audit_log`, `backup_settings`, `schema_migrations`) so a restore can never wipe its own safety net (see Yannick story)
- Pre-restore snapshot is automatic: before any restore, a `source='pre-restore'` backup is created, marked `protected=TRUE` and `expires_at = NOW() + 24h`, and cannot be deleted manually during that window
- Redis lock `backup:lock` (NX EX 3600) prevents two backups (or a backup-during-restore) from running concurrently. Released via Lua so a process can never delete a lock owned by someone else
- 11 admin endpoints under `/api/v1/admin/backups`: list, create, get, download, delete, restore, verify, diff, audit, storage, settings, **reindex** (recovery for orphan archives)
- `path.basename()` on the download path to defuse traversal attempts
- 13 vitest tests added, full suite stays at 194 passing, zero regression

**Frontend admin**
- New page `/admin/backups` with storage indicator, table of backups, per-row Download / Verify / Restore / Delete actions
- Linked from the admin sidebar in the *Instance* section (💾 Sauvegardes)
- Restore modal with diff preview (`+/- threads, posts, messages, users, uploads`), pre-restore snapshot reassurance, type-to-confirm slug input, 5-second client countdown that only starts once the slug matches (server enforces the slug check too)
- **Dry-run** button: verify the archive's checksum + format-version compat + tar structure WITHOUT touching the DB or filesystem. Result displayed inline (green ✓ "restorable" or red ✗ with the exact error). Audited as `metadata.dry_run = true`
- Ordered list of restore steps shown in the modal — no more black box on a destructive action
- `/admin/backups/audit` log viewer with action chips, success/failure pills, IP and user-agent shown — designed for post-compromise forensics (an attacker downloading a backup is an exfiltration event)

**Docs**
- Spec promoted from `.claude/ideas/BACKUP_SYSTEM.md` (informal brainstorming) to [`docs/specs/014-backup-system/SPEC.MD`](docs/specs/014-backup-system/SPEC.MD) (canonical, indexed by nodyx.dev like the other 8 specs)

**Phase 1 deliberately omits** Socket.IO progress (sync POST is fine for small instances), auto-backup scheduler, rotation, drag-and-drop upload of an external `.tar.gz`, AES-256-GCM encryption, and Docker bind-mount detection. Those land in Phase 2 / 3.

**Note for self-hosters**: the backup directory is `nodyx-core/backups/` and must be writable by the `nodyx` user. On existing instances, run `sudo install -d -o nodyx -g nodyx -m 0700 /var/www/nexus/nodyx-core/backups` once. Phase 2 adds this step to `install.sh` automatically.

### Live Maintenance Mode

A user (`Yannick`) registered on nodyx.org during the very first prod restore test, between the `pg_dump` (21:00) and the matching `pg_restore` (21:17). His user row got wiped by the restore — recovered manually via CLI restore of the pre-restore snapshot, but the lesson was clear: **a critical write window has to be communicated to users**, not silently swallow their actions.

Added in the same release:
- `maintenanceService.ts` — single Redis flag (`nodyx:maintenance:meta`) with EX safety belt (auto-clear if the operation crashes). Set/cleared from `createBackup` and `restoreBackup` around their critical sections (TTL: 30 min create, 60 min restore)
- `maintenanceGuard` middleware — global Fastify `onRequest` hook returning **503** with `{error, code: 'MAINTENANCE_IN_PROGRESS', reason, since, label}` on user-facing writes. Skips: GET/HEAD, `/api/v1/admin/*` (admin keeps working), `/api/v1/instance/maintenance`, static assets, Socket.IO
- `GET /api/v1/instance/maintenance` — public, lightweight, polled by the frontend banner
- `MaintenanceBanner.svelte` — sticky amber banner at the top of every page when active. Self-managing 15 s polling, hidden when no operation is in flight

### Backup System — post-incident hardening

Three commits triggered by the Yannick incident:
- `--exclude-table` on `pg_dump` for `backups`, `backup_audit_log`, `backup_settings`, `schema_migrations` so a restore cannot wipe its own tracking metadata or the freshly-created pre-restore snapshot row
- `instance` slug resolution now prefers `process.env.NODYX_COMMUNITY_SLUG` over `ORDER BY created_at` (mirrors `adminOnly.ts` behaviour, fixes filename `nodyx-backup-instance-...` → `nodyx-backup-nodyx-...`)
- Drop the non-existent `language` column from the community SELECT — that field lives in the env, not the table
- New `POST /admin/backups/reindex` endpoint and `reindexBackups()` service helper that scans `BACKUP_DIR`, parses each `.tar.gz` manifest in-memory (no full extraction), and INSERTs missing rows ON CONFLICT DO NOTHING. Idempotent. Use case: recovery after an incident, manual archive drop, or partial DB corruption that took out only the backups table

### The Yannick Story

This is the one moment we want preserved in the changelog because it's a perfect case of "test in production reveals what unit tests can't". The full play-by-play:

1. Phase 1 MVP backend + frontend merged on `main`, smoke-tested via curl with admin tokens (all green)
2. The maintainer creates the first real production backup at 21:00 (manual, full, including uploads)
3. Between 21:00 and 21:17, **Yannick registers on nodyx.org** (perfectly innocent action)
4. The maintainer clicks "Restore" on the 21:00 backup at 21:17 to validate the round-trip mechanics
5. `pg_restore --clean --if-exists` rewinds the DB to its 21:00 state — Yannick's user row gets wiped
6. The pre-restore snapshot's own row in `backups` also disappears, because that table is itself in the dump
7. The audit log can no longer reference any row in `backups` (FK violation), errors silently
8. Yannick pings on Discord: *"my profile is broken, I'm logged in but my page is dead"*
9. Diagnostic: 26 users in DB, 27 in the pre-restore snapshot file → diff = Yannick
10. Recovery via CLI restore of the pre-restore snapshot — Yannick's account is back, no content lost
11. Three commits ship in the next 90 minutes: the dump exclusion, the maintenance flag, the reindex endpoint
12. Yannick gets credited as ["The accidental contributor"](CONTRIBUTORS.md#-the-accidental-contributor) — first user whose mere existence at the wrong second taught the system its own design flaws

Total cost of the incident on prod: 0 user lost, 0 thread lost, 0 post lost, 8 sessions to refresh, 1 design bug fixed forever, 1 new feature shipped (maintenance mode), 1 contributor immortalised in the repo.

---

## [2.3.0] — 2026-05-06

### Widget System — Universal Media Player + Builder Catalog Fusion

**Builder picker now lists installed widgets** (closes the gap reported during a live debug session)
- The Grid Builder previously read only the 9 hardcoded native plugins from `PLUGIN_LIST`. Widgets uploaded via the Widget Store admin or installed from the demo catalog were saved to `installed_widgets` in DB and rendered correctly by `WidgetZone` on public homepages, but were invisible in the picker — so they could never be placed in a layout.
- New aggregation layer `lib/components/homepage/catalog.ts` fuses native plugins (phase 1 only) with installed widgets fetched from `/api/v1/widget-store-public` server-side
- Builder consumes a unified `CatalogEntry[]` for picker, icon resolution, config form generation, and live preview
- Custom-panel branch (`customPanel`) gated on native source via `selNativePlugin`, so it never fires for installed widgets

**Field type canonicalization** at catalog-load time
- External SDKs commonly emit `type:"checkbox"` while the builder renderer expects `type:"boolean"`
- The mapping is permissive on input, strict on output, so existing widgets keep working

**Universal Media Player** (`video-player` demo, v1.0 → v1.2.0)
- Renamed from "Lecteur Vidéo" to **Lecteur Multimédia** to reflect actual scope
- Auto-detection of 7 platforms via single URL field:
  - **Video**: YouTube (watch / `youtu.be` / embed / shorts) → `youtube-nocookie.com`, Vimeo (basic + showcase + event), Dailymotion (`dailymotion.com/video` + `dai.ly`), Twitch live (channel), Twitch VOD (`videos/<id>`), Twitch clip (`clips.twitch.tv` + `twitch.tv/<u>/clip/<id>`)
  - **Audio**: SoundCloud (track or playlist embed), Spotify (track / episode / playlist / album / show / artist)
  - **Direct file**: `.mp4`, `.webm`, `.mov`, `.m3u8` (HLS) → native `<video>`, and `.mp3`, `.ogg`, `.wav`, `.flac`, `.m4a`, `.opus`, `.aac` → native `<audio>` with audio-shaped wrapper
- Privacy-first: YouTube embeds via `youtube-nocookie.com`, Vimeo with `dnt=1`
- Twitch sets the required `parent` parameter from `window.location.hostname` at render time
- Audio sources (SoundCloud, Spotify track/episode) get fixed-height embeds instead of the 16:9 wrapper
- Manifest schema exposes `hint` (one-liner under field label) + `details` (collapsible (?) panel with exact URL formats per platform plus CORS note)

**CSP `frame-src` extended** to cover all new platforms in `install.sh` and `install_tunnel.sh`: added `geo.dailymotion.com`, `player.twitch.tv`, `clips.twitch.tv`, `w.soundcloud.com`, `open.spotify.com` (Vimeo was missing for new installs and is now included)

**Demo source refactor** — `widgetDemo.ts` reads manifest + JS from `nodyx-core/widget-demos/<id>/` at module init. The previous escaped template-literal embed (190 lines of `\\${` noise) is gone; single source of truth.

---

### Installer — Pangolin Mode Hardening (closes #23)

Twelve fixes to `install_tunnel.sh` after a multi-round community debug pass with @forke24x7. The blank-page bug that blocked Pangolin self-hosters was rooted in Caddy site-address Host filtering, not interface binding.

**Caddy site address rewritten** ([5445e8b])
- Previous form `http://127.0.0.1:80, http://[::1]:80 { }` was a Host filter masquerading as an interface bind
- Caddy only matched requests whose `Host` header was literally `127.0.0.1` or `[::1]`, so when newt forwarded a request from Pangolin with the public Host, no site matched and Caddy returned 0 bytes (rendered as a blank page)
- New form `:80 { bind 127.0.0.1 ::1 [LAN_IP] }` decouples interface listening from Host matching

**`--repair` flow now regenerates Caddyfile** ([cfa52ee])
- Previously skipped Caddy section entirely, so any drift between installed script and live config persisted
- `_render_caddyfile()` is now called from both fresh install and `--repair`, with atomic tempfile + `caddy validate` before `mv`

**UFW `:80` from RFC1918 in Pangolin mode** ([cfa52ee])
- Method B (newt in default Docker bridge) connecting to LXC's LAN IP on `:80` was blocked at the host firewall under default-deny-incoming
- New `_ensure_pangolin_ufw()` opens `:80/tcp` from `10/8`, `172.16/12`, `192.168/16` only — public internet still cannot bypass the tunnel

**`nodyx-doctor` improvements**
- New check lists Caddy's actual bind addresses and warns if the LAN IP is missing in bridge mode
- "Caddy NOT bound on the LAN IP" warning now gated on `docker + non-host network mode`, so Method A (`--network host`) and native newt no longer trigger a false positive ([3b74e73])

**Domain prompt mode-neutral** ([8722878])
- Cloudflare nameserver requirement is now surfaced only after picking mode 1 (CF), not before mode selection

**Other tunnel installer fixes**
- Bilingual EN/FR rewrite + modern security parity ([8bd85be])
- Real client IP via `X-Forwarded-For` from trusted private/loopback ranges, mode-aware ([dfa8eca])
- Drain stdin before `exec` to avoid `curl exit 23` ([763c410])
- Write `PUBLIC_TURN_*` and `PUBLIC_SIGNET_URL` placeholders in frontend `.env` ([cbc9e6b], [14794ce])
- `fonts-dejavu-core` instead of `fonts-dejavu` ([9ab10b9])
- New operator guide [`docs/en/INSTALL-TUNNEL.md`](docs/en/INSTALL-TUNNEL.md) with topology diagrams and a troubleshooting table

---

### Documentation site — nodyx.dev

**Search overhaul** ([a429fa3], [882099d])
- Heading-aware search with deep-link anchors — `h2` and `h3` sections are now indexed individually, search hits land directly on the right anchor instead of the page top
- Slug correctness fixed: 108 broken TOC links, 60 leading-dash IDs, 11 phantom entries from code-block comments cleaned up
- Anchor fallback for stale URLs

**TOC sidebar** ([3c62275])
- Sticky right-side table of contents on every doc page
- Scrollspy with active marker dot
- Auto-collapse on mobile

**`Why Nodyx` positioning page** ([feb00b6], [93ad60d], [18ae4a0])
- New canonical doc [`docs/en/WHY-NODYX.md`](docs/en/WHY-NODYX.md) listing alternative federated/self-hosted platforms (Matrix, Stoat, Fluxer, Haven, etc.) with their GitHub links — humble posture, no anti-Discord framing
- README aligned with the same posture

**Other doc improvements**
- Tunnel install surfaced in nodyx.dev navigation ([fe84813])
- Anchor refs corrected (single-dash, not GitHub double) ([a7f9eb4])
- Haven added to the ecosystem map ([88039aa])

---

### nodyx-relay v0.1.4 — TCP keepalive

- TCP keepalive + read deadline to detect dead sessions ([5893b57])
- Sessions that disappear without a clean FIN are now reaped instead of accumulating

---

### Internationalization

- **German (de)** translation: 741 strings, hand-reviewed by a native speaker, contributed by @forke24x7 ([cc79147])
- **Spanish (es)** translation: 719 strings, full key + placeholder parity, contributed by @e806482 with native review by @naranco66 ([e806482], [a9a90b3])
- `install.sh` itself now supports EN/FR with English as default ([ddf3acb])

---

### Homepage Builder polish

- Clickable `(?)` info panel on field labels for long-form explanations ([c5ed290])
- New native widgets: **Twitch stream** + **Articles showcase** ([d6a0975])

---

### Voice & UX

- **Voice kick** action for owners, admins and moderators ([ef383a6])
- Chat auto-scroll on join + forum reactions persistence ([a3b8824])
- Chat `scrollToBottom` wrapped in arrow function for jump-to-bottom button ([18fc8d4])
- Auto-flip toolbar popups when they would overflow the scroll container ([0efd537])
- `/login` and `/register` now 301-redirect to `/auth/*` ([9e4a4f9])

---

### Community Pulse

- New `community pulse` page with co-presence trail and wave visualization ([7bb0229])

---

### Process & Recognition

- **Nodyx Stars** system: proper recognition for external contributors with star ratings, public CONTRIBUTORS.md and avatar block in README ([d68c081])
- Maintainer checklist + PR template ([92a7b78])
- Polish Trail section: public transparency on the maintainer's polish-after-merge pass ([c5fc859])
- Origin-story note on CONTRIBUTORS.md ([d14f84d])
- "Gesture-over-perfection" maintainer note translated into 17 languages ([88903d6])
- Stars bumped: @forke24x7 → 5 (root cause + de translation + Pangolin work), @lukasMega → 2 (docs search hunt), @waazaa-fr → 2 (installer fixes), @naranco66 → Regular (es review)

---

### Stability & Infra

- Directory assets HTTP 500 loop fixed; hub SQLite readonly fixed; docs memory limit raised ([d9fd459])
- Docker Compose orphan `nexus-*` references purged post-rebrand; Alpine font path mismatch fixed (PR #22 by @naranco66) ([b629242])
- Ko-fi badge added to README; FUNDING.yml updated ([197a450], [658e3a8], [fb67943])
- Issue templates, SECURITY.md, FUNDING.yml ([1553e80])

---

### Bug fixes (canvas)

- `Ctrl/Cmd + D` to duplicate selected canvas elements with offset positioning (PR #11) ([90f3644], [d19682f], [cbecb2f], [de84424])

---

### Notes for self-hosters

The runtime `widget.iife.js` for the Lecteur Multimédia is served live from `nodyx-core/uploads/widgets/video-player/` so an upgrade applies immediately. To pick up the new manifest (label / hints / version), reinstall the demo from the Widget Store admin (`/admin/widgets`) or run a full `--repair`. The CSP `frame-src` is shipped in the templates of `install.sh` and `install_tunnel.sh`; existing instances need to either rerun `--repair` or update their Caddyfile manually.

---

## [2.2.0] — 2026-04-17

### Canvas Sprint C — Collaborative Whiteboard Upgrade

**Multi-selection**
- `Shift+Click` to toggle elements in selection
- Lasso tool: click-drag on empty space to draw a selection rectangle
- Multi-drag: all selected elements move together
- `Delete` / `Escape` operate on entire selection
- Dashed purple bounding box around multi-selected elements

**Minimap**
- 160×100px thumbnail in bottom-right corner
- All elements rendered as violet blobs at scale
- White dashed viewport rectangle
- Click to navigate — recenters view on that world-space point

**Brainwave Sync**
- 3-state toggle: Off → Leading (purple) → Following (cyan)
- Leader broadcasts pan/zoom transform via Socket.IO (`canvas:sync:view`)
- Followers receive and apply the transform in real-time
- Throttled at 50ms for smooth performance

**Background Color Chooser**
- 21 color presets (dark, colored dark, light themes)
- Native color picker for custom colors
- Conic gradient rainbow button for the picker

**Frames — Move with Children**
- Dragging a frame now moves all contained elements
- Child count shown in frame label (`"FrameName · 3 elements"`)
- Colored dashed ring around frame children

**Anchor Badge**
- Purple anchor icon on frame children (visible in select mode)
- Click to detach element from its parent frame

**Lock System**
- Lock/unlock any element via padlock badge
- Locked elements: no drag, no resize, no erase, no delete
- Amber glow on locked+selected elements
- Orange lock badge always visible on locked elements

### Other Fixes

- Keyboard shortcuts no longer interfere with chat input
- Chat messages persist across canvas sessions (localStorage per board)
- Fixed rectangle tool icon (was showing grid icon)

---

## [2.1.0] — 2026-04-08

### Homepage Builder + Widget SDK

Nodyx gets a visual CMS layer. Instance owners can now build a fully custom homepage — drag and drop widgets, configure them live, and extend the system with their own Web Components.

**Homepage Builder**
- 11 layout zones: Banner, Hero, Half Left/Right, Stats Bar, Wide Strip, Sidebar, Three Columns, Footer columns
- Drag and drop: reorder zones, resize widget slots
- Live config panel: each widget exposes its own schema (text, checkbox, select, number fields)
- Per-instance: each instance builds its own homepage independently
- Redis cache: homepage layout cached, instant load for visitors

**Native Widgets (12 included)**
- `welcome-banner` — hero text with CTA button
- `announcements` — latest pinned posts from a category
- `forum-preview` — recent threads with author avatars
- `member-count` — live member count (online / total)
- `recent-activity` — feed of recent forum + chat activity
- `events-preview` — upcoming events from the calendar
- `top-members` — leaderboard by post count
- `chat-preview` — last messages from a public channel
- `custom-text` — free rich-text / HTML block
- `image-banner` — full-width image with overlay text
- `poll-embed` — embed a live poll
- `countdown` — countdown to a date

**Widget SDK**
- Build your own widgets as standard Web Components and upload them to your instance
- Two files per widget: `manifest.json` (schema + metadata) + `widget.iife.js` (Web Component)
- Shadow DOM: full CSS isolation, zero conflicts
- Upload via admin: `.zip` containing both files, validated server-side
- Live preview in the Widget Store before installing
- Full tutorial at [nodyx.dev/create-widget](https://nodyx.dev/create-widget)

**Demo Widget — Video Player**
- Auto-detects YouTube, Vimeo, or raw MP4 URLs
- Configurable from the builder: URL, title, autoplay, show controls
- Source `.zip` downloadable from the Widget Store admin to use as a template

### Under the Hood

- New DB tables: `homepage_positions`, `homepage_widgets`, `installed_widgets`
- New routes: `/api/v1/admin/homepage/*`, `/api/v1/widget-store/*`, `/api/v1/widget-assets/*`, `/api/v1/admin/widget-store/demo/*`
- `DynamicWidget.svelte` — Svelte 5 Web Component loader with 5s timeout + error state
- `uploads/widgets/.gitkeep` — directory guaranteed on fresh clone
- `adm-zip` — server-side ZIP assembly (demo download) and extraction (widget upload)
- Migrations `065_homepage_builder.sql` through `071_widget_store.sql`

---

## [2.0.0] — 2026-04-06

### Private and Sovereign Communications

The biggest Nodyx release since launch. v2.0 brings end-to-end encrypted DMs with a per-instance obfuscation layer that's uniquely ours.

**DM End-to-End Encryption**
- ECDH P-256 key exchange — your private key is generated in the browser and never leaves it (stored as a non-extractable `CryptoKey` in IndexedDB)
- AES-256-GCM authenticated encryption — the server stores and transmits only opaque ciphertext
- ESY Barbare layer — a second, per-instance obfuscation layer on top of AES-GCM (byte-permutation + deterministic PRNG noise, N rounds). Even if AES were broken, an attacker would still need to reverse the ESY transform specific to your instance
- E2E shield — live indicator in the DM header (green pulse when both sides have E2E active, orange when only one side has generated their keypair)
- ESY fingerprint visible on hover — verify your instance's layer
- Barbarize animation — when sending, you see your text scramble into glyphs during encryption; when the other side receives, they watch it decipher in real-time

**DM Message Editing**
- Inline edit on hover — pencil icon appears on your messages
- Encrypted messages are re-encrypted when edited — the new content goes through the full ECDH + AES + ESY chain
- The other side receives the updated plaintext in real-time
- Timestamp shows `· edited` after modification

**DM Message Delete — Real-time**
- Previously, deleting a message only removed it for the sender. Now the deletion propagates instantly to all participants via socket.

**DM Full-Width Redesign**
- Split layout: sidebar (288px) + chat zone full-width
- Glassmorphism sidebar with conversation list
- iMessage-style bubbles with grouped messages and per-sender avatars
- Typing indicator in header

### Under the Hood

- `e2e.ts` — new crypto module (IndexedDB keypair, ECDH, AES-GCM, ESY barbarize/debarbarize)
- Caddy routing fixed for `/users/*/public-key` and `/forums/categories` (relay was intercepting)
- AudioContext shared across all peer VAD — fixes Chrome's 6-context-per-origin limit
- Socket poll fallback when `initSocket` async isn't done at `onMount`
- Migration `064_dm_edit.sql`

---

## [1.9.5] — 2026-03-30

### Living Profile — User profile enrichment

**Generative Banner (`GenerativeBanner.svelte`)**
- Unique SVG banner per username — deterministic Lissajous curves via FNV-1a 32-bit hash (SSR-safe, no SHA-256)
- 3 animated curves (CW 80s / CCW 55s / CW 120s + breathe) via SVG-native `animateTransform` — works everywhere without CSS transform-origin hacks
- Per-user color palette (triadic HSL), grain texture filter, vignette gradient
- Displayed only when no custom banner is set — zero visual collision

**Reputation Rings (`ReputationRings.svelte`)**
- 3 concentric SVG rings: Longevity (days since registration / 365), Quality (XP / 500), Engagement (threads × 2 / posts + threads)
- `animateTransform` rotating arcs — CSS transform-origin on SVG `<g>` is unreliable cross-browser; fixed with SVG-native animation
- Click → `/reputation` transparent explanation page
- Tooltips on hover per ring (label + value)

**Activity Heatmap (`ActivityHeatmap.svelte`)**
- GitHub-style 53 × 7 grid, last 365 days, aligned to Monday (ISO week start)
- 5 intensity levels via `color-mix(in srgb)` from user accent
- Tooltip: `position: fixed` + `getBoundingClientRect()` — escapes `overflow-x: auto` containers without scrollbar artifacts
- Stats: total contributions, current streak, all-time record

**Backend — Activity endpoint**
- `GET /api/v1/users/:username/activity` — SQL UNION of posts + threads, grouped by `date_trunc('day')`, 365-day window
- Returns `{ activity: [{ date: 'YYYY-MM-DD', count: number }] }`

**Profile hero**
- Parallax banner: scrolls at 35% of page speed, capped at 60px translateY
- SVG arcs rotating around avatar (3 circles, `animateTransform`, glow pulse CSS)
- Delete avatar / delete banner buttons — server action clears both `banner_url` AND `banner_asset_id` together (fixed stale JOIN returning old asset path)

**Timeline**
- Temporal milestones + XP thresholds, positioned at the very bottom of the profile

**`/reputation` page**
- Full transparent formula documentation: Longevity, Quality (with λ exponential decay `e^{-λt}` for future Merci system), Engagement
- Note: Q currently uses XP fallback until the Merci backend is deployed

### Forum Redesign — Flat & wide

**Width**
- Forum index: removed `max-w-5xl mx-auto` wrapper — content now fills the full available width between sidebars (layout already provides padding)

**No radius**
- Removed all `rounded-2xl`, `rounded-xl`, `rounded-lg`, `rounded` across all 4 forum files
- `rounded-full` preserved for avatars only
- Affected: category header, subcategory cards, search input, filter/sort dropdowns, thread rows, badge pills (pinned/locked/featured/tags), stats counters, pagination buttons, mod action buttons, empty state, new thread form selects/inputs/buttons

**Thread rows**
- Simplified hover state (border + background only, no scale/shadow theatrics)
- Badge indicators moved into inline chips — no more overlay dots on avatars
- Reply counter: flat border card instead of rounded pill

**Buttons**
- "New thread", "Publish", "Cancel", filter/sort triggers: all flat — consistent with the rest of the shell

---

## [1.9.4] — 2026-03-28

### Security — Process isolation
- All application processes now run as `nodyx` system user — `nexus-turn.service` switched from `User=root` to `User=nodyx`; `pm2-root.service` replaced by `pm2-nodyx.service` (`User=nodyx`, `PM2_HOME=/home/nodyx/.pm2`)
- `/home/nodyx` created with correct ownership (nodyx:nodyx 750)
- `nodyx-frontend/.env` and `nodyx-hub/.env` permissions tightened: 644 → `root:nodyx 640`
- `uploads/` directory transferred to `nodyx:nodyx`

### Testing — Node.js 181/181
- 6 new test files: `modules.test.ts`, `polls.test.ts`, `search.test.ts`, `notifications.test.ts`, `wiki.test.ts`, `middleware-extended.test.ts`
- Fixed `vi.resetAllMocks()` pattern — `restoreRedis()` helper added to all `beforeEach` blocks to restore `redis.exists` and `redis.setex` implementations destroyed by reset
- Fixed module-level `_communityId` cache isolation across test runs using SQL-content-aware `mockImplementation`
- Fixed `db.connect()` transaction mocking for polls routes with `makeMockClient()` helper

### Testing — Rust 18/18
- First Rust unit tests for `nodyx-server`: `error.rs` (11 tests — HTTP status mapping, JSON body format, internal error leak prevention, `Retry-After` header on 429) and `extractors.rs` (7 tests — `Claims` serde `userId` rename, JWT decode, wrong secret rejection, expired token rejection, malformed token rejection)

### Stability
- Critical dependencies pinned to exact versions: `fastify@5.8.2`, `socket.io@4.8.3`, `jsonwebtoken@9.0.3`, `argon2@0.44.0`, `bcrypt@6.0.0`, `pg@8.18.0`, `ioredis@5.9.3`, `web-push@3.6.7`
- CI pipeline: two parallel jobs (`test-node`, `test-rust`), npm + cargo cache, `tsc --noEmit` typecheck gate, Rust build + tests
- Migration sequence gap closed: `052_placeholder.sql` added between 051 and 053

---

## [1.9.3] — 2026-03-25

### Stability — Production hardening & cross-runtime Redis coherence

**Redis keyPrefix audit — Node.js (Sprint 1)**
- Removed all manual `nodyx:` prefixes from Node.js code — ioredis `keyPrefix: 'nodyx:'` handles this automatically
- `auth.ts` — single `session:{token}` check (was dual check `nodyx:session:` + `session:` — double-prefix always returned 0)
- `adminOnly.ts` — same fix + `heartbeat:{userId}` corrected
- `socket/index.ts` — `authenticateSocket` single session + `banned:{userId}` corrected
- `scheduler.ts` — `blocklist` / `blocklist:tmp` (was `nodyx:blocklist` / `nodyx:blocklist:tmp`)
- `index.ts` — blocklist IP check corrected
- `routes/admin.ts` — `update_check` cache key corrected (was `nodyx:update_check`)
- 6 test files — dead condition `|| key.startsWith('nodyx:banned:')` removed from Redis mock

**Redis keyPrefix audit — Rust nodyx-server (Sprint 4)**
- Rust has no ioredis keyPrefix — all shared keys must carry `nodyx:` manually
- `routes/auth.rs` — 7 keys fixed: `banned:`, `user_sessions:`, `login_rate:`, `register_rate:`, `reset_rate:`, `resend_verify:`, `resend_verify_ip:`
- `routes/admin.rs` — 3 keys fixed: `banned:` (ban/unban), `user_sessions:` (invalidate sessions), `heartbeat:*` scan (online_count was always 0)
- `routes/directory.rs` — `rate:search:` fixed
- **Impact**: bans now cross-visible between Node.js and Rust runtimes; rate limiting shared; online count functional; session invalidation on password change covers both runtimes

**install.sh — version centralization (Sprint 2)**
- Single `NODYX_VERSION="1.9.0"` variable at top of script — used consistently in `.env` generation, directory registration, post-install summary (was 3 different hardcoded values: 1.8.1, 1.8.2, 1.9.0)
- Both Caddyfile blocks (relay + normal mode) now include: security headers (X-Frame-Options, CSP, HSTS, X-Content-Type-Options, Referrer-Policy, `-Server`), honeypot block (25 scanner paths), `header_up -X-Forwarded-For` on all API reverse_proxy blocks
- PM2 ecosystem template now includes `max_memory_restart` (512M core, 256M frontend)

**Scheduler — fetch timeouts (Sprint 3)**
- `AbortSignal.timeout()` added to all 4 previously unguarded fetch calls: `pingDirectory` (8s), `pushAssetsToDirectory` (15s), `announceThreadsToDirectory` (10s), `announceEventsToDirectory` (10s)

**Caddy — Rust failover (Sprint 3)**
- All 18 `localhost:3100` blocks (9 external nodyx.org + 9 internal :3099) switched to `lb_policy first` + `fail_duration 30s` with `localhost:3000` as fallback
- If nodyx-server (Rust) is down, Caddy automatically routes to nodyx-core (Node.js) within 30 seconds — zero manual intervention

**Infrastructure**
- PM2 `max_memory_restart`: core 512M, frontend 256M, hub 256M, docs 128M — automatic restart on OOM
- `/etc/logrotate.d/nodyx-auth` — daily rotation, 30-day retention, compressed
- `nodyx-relay.service` — `SyslogIdentifier` and description rebranded to `nodyx-relay`

---

## [1.9.2] — 2026-03-21

### Security — Advanced Honeypot Suite

**Tracking pixel (spy detection)**
- 1×1 transparent PNG pixel embedded in the scary page (`GET /api/v1/_hp_px/:incidentId`)
- Every load logged to `honeypot_pixel_hits` (migration 059): incident_id, IP, user_agent, referer, viewed_at
- Discord "👁 Pixel Spy" alert on revisits (>30s threshold) — detects attackers who bookmark or revisit via proxy
- Linked to original honeypot hit for full correlation

**Fake login traps — credential harvesting**
- 12 login paths trapped: `/wp-admin`, `/phpmyadmin`, `/wp-login.php`, `/admin/login`, `/user/login`, `/panel`, etc.
- Convincing fake WordPress-style HTML form served to attackers (no artificial delay — immediately convincing)
- Credentials captured in `honeypot_credential_attempts` (migration 060): IP, username, password, login_path, geolocation
- After submission: Discord "🔑 Credential Harvest" embed, then scary page streamed to attacker

**Canary files — realistic fake credentials**
- 11 file patterns trapped: `.env`, `backup.sql`, `dump.sql`, `id_rsa`, `config.json`, `credentials.json`, `database.yml`, `wp-config.php`, `config.php`, `database.sql`, `db.sql`
- Content generated per file type: env vars, SQL dump, RSA private key, JSON config, YAML database, PHP config
- Deterministic PRNG seeded by IP (`fakeSeed`) — same attacker always receives the same fake credentials
- Discord "📄 Canary File Accessed" embed — single notification (no double-fire)

**Persistent canvas fingerprint**
- Browser JS in scary page generates a canvas fingerprint hash, POSTs to `POST /api/v1/_hp_fp`
- Upserted in `honeypot_fingerprints` (migration 060): `fp_hash TEXT PK`, `visits INT`, `ip_list TEXT[]`, `incident_ids TEXT[]`, `first_seen`, `last_seen`
- Discord "🔍 Fingerprint Reconnu" if same attacker seen more than once, even across different IPs

**Honeytokens (invisible + quasi-invisible links)**
- 3 invisible `<a>` tags (`position:absolute; top:-9999px; opacity:0`) embedded in the scary page HTML
- 1 quasi-invisible "Dispute this automated report" link (`color:#1a2a1a`) — visible only when reading source
- All links redirect to `/_ht` — logged as honeytoken click, Discord "🎯 HONEYTOKEN CLICKED" (green embed)

**Slowloris inverse (bandwidth drain)**
- Non-canary, non-login paths stream the scary page byte-by-byte via `reply.hijack()` / raw Node.js response
- Browser: 96 bytes every 180ms (~45–90s total transfer)
- Bot/scanner: 256 bytes every 80ms — ties up connection pool, burns attacker threads
- Checks `raw.destroyed` before every write to prevent crashes on early disconnect

**Olympus Hub — new security sections**
- "PIÈGES ACTIFS" — aggregated trap stats (login/canary/honeytoken) with type-colored rows (🎯/🔑/📄)
- "CREDENTIAL HARVEST" — full table with masked passwords (reveal on click), IP, geolocation, path, timestamp
- "ATTAQUANTS RÉCURRENTS" — persistent fingerprint hashes, IP badge list (max 4 + overflow), visit count with color coding

**Bug fix — single Discord notification per hit**
- Canary files and login paths were triggering both a generic "🚨 Honeypot Hit" AND a type-specific embed
- Fixed: type detection (honeytoken → canary → login → generic) now runs before Discord webhook call — exactly one embed per hit
- Login paths produce no Discord from the main handler; notification fires only on credential submission

---

## [1.9.1] — 2026-03-21

### Security — 2FA & Nodyx Signet

**2FA TOTP (RFC 6238)**
- New 2FA system using time-based one-time passwords (TOTP) compatible with any authenticator app (Google Authenticator, Aegis, Bitwarden)
- Migration 057: `totp_enabled` + `totp_secret` columns on `users` table
- New routes: `POST /api/v1/auth/totp/setup` (QR code generation), `/confirm` (activation), `/disable`, `/validate` (login step 2), `GET /status`
- Two-step login: password OK → if TOTP enabled, returns `{ requires_totp, totp_pending }` → Redis-backed 5-min pending session → JWT only after valid code
- Frontend: TOTP step in login page + full setup/disable flow in Settings

**2FA via Nodyx Signet (prioritaire)**
- If user has a registered Signet device, Signet is used as the 2nd factor instead of TOTP (stronger: ECDSA P-256 vs shared secret)
- After password verification, backend checks `authenticator_devices` → if device found, returns `{ requires_signet: true, username }`
- Login page auto-triggers the Signet approval flow (push notification on phone) without any user input
- Approved Signet challenge → JWT issued → cookie set (full reuse of existing Signet infra)
- Priority: Signet > TOTP > direct login

**Nodyx Signet PWA rebuild**
- Rebuilt with fixed URLs: placeholders updated from `nexusnode.app` to `nodyx.org`

---

## [1.9.0] — 2026-03-21

### Security — Active Defense & Runtime Security

**Honeypot**
- New honeypot system trapping ~25 common scanner paths (`/.env`, `/.git/config`, `/wp-admin`, `/phpmyadmin`, `/shell.php`, `/backup.sql`, etc.)
- Tarpit: 3–7 second artificial delay burns attacker time/threads
- Real-time geolocation (country, city, ISP) via ip-api.com
- Scary terminal-style 403 page showing attacker's own IP, location, ISP and legal warning (Code Pénal art. 323-1)
- All hits logged to DB (`honeypot_hits` table — migration 056) + `/var/log/nodyx-honeypot.log`
- Optional Discord webhook notification per hit (`HONEYPOT_DISCORD_WEBHOOK`)
- Automatic 7-day IP ban via fail2ban on first hit

**fail2ban**
- Installed and configured: 4 jails — `sshd` (24h), `sshd-ddos` (permanent after 3 bans), `nodyx-auth` (1h after 5 failed logins), `nodyx-honeypot` (7 days on first hit), `nodyx-permban` (permanent)
- `nodyx-auth.log` now fed by `auth.ts` on every `INVALID_CREDENTIALS` event (was previously unfed)
- `nodyx-auth` jail `maxretry` corrected to 5 (matching the Redis rate limiter window)
- Log rotation configured for both security log files (daily, 90-day retention, compressed)

**Permanent IP blacklist**
- New fail2ban jail `nodyx-permban` with `bantime = -1` for definitively blocked IPs
- Known bad actors banned at 3 levels: DB `ip_bans`, fail2ban permanent, application layer

**Discord security monitoring** (`SECURITY_DISCORD_WEBHOOK`)
- Alert on brute force: notified on 3rd consecutive failed login attempt against the same account
- Alert on admin login: every successful owner/admin authentication logged with IP
- Alert on new IP: login from an IP different from the last known IP triggers an orange warning embed
- Alert on new registration: every account creation logged with username, email and IP

**Password hashing — Argon2id migration**
- New accounts now hashed with Argon2id (OWASP 2026 recommendation): 64 MB memory, 3 iterations, 4 threads
- Existing bcrypt hashes remain fully valid — no forced password reset
- Transparent rehash: on successful login with a bcrypt hash, password is silently upgraded to Argon2id in the background

**Chat & content security**
- Anti-spam rate limiter on `chat:send`: dual sliding window (5 msg/3s burst + 15 msg/15s sustained)
- Client feedback: `chat:rate_limited` event with `retryAfter` ms + cooldown UI banner
- `chat:blocked` event for content violations with reason
- Image allowlist: only Tenor and Giphy CDN hostnames allowed in `<img>` tags
- Domain blocklist: configurable via `BLOCKED_LINK_DOMAINS` env var
- Nazi/hate symbol filter: 6 Unicode codepoints blocked platform-wide (swastika, SS runes, Othala)
- Content filter applied to: chat messages, forum posts/replies, profile fields (display_name, bio, status, location)
- Optional NSFW image scan on upload via `nsfwjs` + TensorFlow.js (`NSFW_SCAN=true`)

**Upload rate limiting**
- `POST /api/v1/users/me/upload` now rate-limited: 10 uploads per 10 minutes per user

**Email verification**
- Registration now requires email verification when SMTP is configured
- Login blocked for unverified accounts with clear error message
- Resend verification endpoint + dedicated pending page

**SQL injection hardening (additional)**
- All remaining `ORDER BY ${variable}` patterns replaced with two-query branching (no dynamic SQL fragments)
- `admin.ts` audit log: `.slice(0, 100)` on query params before ILIKE

**Other**
- `verify-email` cookie: `secure: true` enforced in production

---

## [1.8.2] — 2026-03-20

### Security — Full Paranoid Audit (38 vulnerabilities fixed)

**Critical — SQL Injection**
- **`gardenService.ts`** — `requesterId` interpolated directly into SQL template literal → full parameterized query with `$N` placeholder
- **`models/notification.ts`** — `daysOld` interpolated into `INTERVAL '${daysOld} days'` → parameterized via `$1 * INTERVAL '1 day'`

**Critical — JWT Algorithm Confusion**
- **`middleware/auth.ts`**, **`middleware/adminOnly.ts`**, **`socket/index.ts`** — `jwt.verify()` without explicit algorithm → added `{ algorithms: ['HS256'] }` on all verify calls
- **`routes/auth.ts`**, **`routes/authenticator.ts`** — `jwt.sign()` without explicit algorithm → added `{ algorithm: 'HS256' }` on all sign calls

**High — SSRF / DNS Rebinding**
- **`routes/chat.ts` — `/unfurl`** — two-step DNS resolution (validate then fetch) vulnerable to DNS rebinding: attacker resolves to safe IP, then re-resolves to `127.0.0.1` during fetch → replaced `fetch()` with a custom `https.request()`/`http.request()` that connects directly to the pre-resolved IP (single DNS lookup, anti-rebinding)
- **`routes/chat.ts` — `isPrivateIp()`** — missing IPv6 documentation prefix `2001:db8::/32` (RFC 3849) → added

**High — Socket.IO IDOR & Missing Guards**
- **`socket/index.ts` — `chat:typing`** — no room membership check → user could broadcast typing to any channel UUID → added `socket.rooms.has()` guard
- **`socket/index.ts` — `chat:react`** — no channel membership check → user could toggle reactions on messages of channels they're not in → added `findMessageById()` + `socket.rooms.has()` pre-check
- **`socket/index.ts` — `chat:delete`** — admin check used `community_members WHERE user_id = $1` (any community) → admin of community A could delete messages of community B → scoped to `JOIN channels ON community_id` of the specific message
- **`socket/voice.ts` — `voice:stats`** — no room check, no rate limit → any authenticated user could broadcast to any voice room → added room check + rate limit (10/s)
- **`socket/voice.ts` — `voice:ping`** — no rate limit → spam triggered expensive `fetchSockets()` on every call → added rate limit (3/s)
- **`socket/voice.ts` — `jukebox:request_sync`** — no rate limit, no room check, no UUID validation → full DoS vector → added all three guards
- **`socket/index.ts` — `dm:typing`** — no participant check → any user could spoof typing to any conversation ID → added `EXISTS (SELECT 1 FROM dm_participants WHERE user_id = $2)` subquery

**High — XSS / CSS Injection**
- **`routes/users.ts` — `website_url`** — `z.string().url()` accepts `javascript:` protocol → added `.refine(v => /^https?:\/\//i.test(v))`
- **`routes/users.ts` — `name_font_family`** — free string, injected in `font-family: '...'` CSS → added regex `^[a-zA-Z0-9 _\-]+$`
- **`routes/users.ts` — `localFontUrl`** — `/uploads/` path without quote restriction, injected in `@font-face { src: url('...') }` → added `!/['"\\]/.test(v)` guard
- **`routes/users.ts` — `metadata.theme.bgImage`** — unvalidated, injected in `background: url("...")` → added strict Zod schema (HTTPS only)
- **`lib/nameEffects.ts`** (frontend) — `fontUrl` and `fontFamily` not escaped in CSS string context → added backslash + single-quote escaping before injection
- **`lib/profileThemes.ts`** (frontend) — `bgImage` from JSONB injected without validation → added `https://` guard (defense in depth)
- **`routes/chat/+page.svelte`** (frontend) — GIF URL injected unescaped in `<img src="...">` template → added `https://` validation + `"` / `'` encoding

**Medium — Crypto / File Validation**
- **`services/fileScanner.ts` — WebP**  — RIFF magic bytes shared with AVI/WAV; `offset 8` ("WEBP") not checked → added dedicated step-2 check after EXPECTED_MAGIC validation
- **`services/emailService.ts`** — `username` and `communityName` embedded in email templates without sanitization → added `sanitizeHeader()` stripping `\r\n` (SMTP header injection)
- **`routes/users.ts` — font upload`** — extension derived from `data.filename` (client-controlled), not MIME type → switched to `mimeToExt` lookup table

**Medium — Auth & Access Control**
- **`routes/authenticator.ts` — `POST /devices/register`** — no rate limit on enrollment token endpoint → added `enrollRateLimit` (3 req/5min/IP)
- **`routes/tasks.ts` — `PATCH /cards/:id` assignee**  — `assignee_id` accepted without membership check → added `community_members` validation before update
- **`routes/polls.ts` — `POST /:id/vote`** — no ban check → banned users could still vote → added `community_bans` lookup
- **`routes/auth.ts` — logout`** — `redis.del(session:token)` without cleaning `user_sessions:userId` index → added `redis.srem()`
- **`routes/directory.ts` — gossip receive`** — UUID not validated before PostgreSQL `::uuid` cast (throws unhandled error on malformed input) → added `UUID_RE.test()` skip

**Low / Infrastructure**
- **`config/database.ts`** — PostgreSQL SSL not configurable → added `DB_SSL=true` opt-in with `rejectUnauthorized: true`
- **`index.ts` — Socket.IO`** — transports not explicitly set (relay strips Upgrade header) → added `transports: ['polling', 'websocket']`, `pingInterval: 8000`, `pingTimeout: 4000`
- **`socket/rateLimiter.ts`** — added rules for `voice:stats` (10/s), `voice:ping` (3/s), `jukebox:request_sync` (3/s)
- **`socket/voice.ts` — `voice:stats`** — `rtt` accepted `NaN` / `Infinity` → added `isFinite()` check
- **`socket/index.ts`** — `JSON.parse` on Redis status data without try-catch → wrapped in try/catch

---

## [1.8.1] — 2026-03-15

### Security
- **`PATCH /cards/:id` — permission check ajouté** — n'importe quel membre authentifié pouvait modifier n'importe quelle carte (titre, description, assigné, priorité, déplacement de colonne). Le handler vérifie désormais que l'utilisateur est créateur de la carte, créateur du tableau, ou admin/mod (même logique que le DELETE).
- **`POST /api/auth/enrollment-tokens` — restreint aux admins** — la route d'émission de tokens Signet n'était protégée que par `requireAuth`. Ajout de `adminOnly` en preHandler.
- **`ecosystem.config.js` — HOST: 127.0.0.1** — le frontend SvelteKit SSR écoutait sur `0.0.0.0:5173` en production. Ajout de `HOST: '127.0.0.1'` pour lier sur localhost uniquement derrière Caddy.
- **`/api/v1/health` — HTTP 503 si DB down** — le catch renvoyait `{ status: 'error' }` avec HTTP 200 → tout monitoring considérait l'instance saine même si la DB était déconnectée. Fix : `reply.code(503).send(...)`.

### Fixed
- **`tasks.ts` — cache `getCommunityId()`** — la fonction refaisait une requête DB à chaque appel. Ajout d'un cache module-level `_communityId` (même pattern que `admin.ts`).
- **`tasks.ts` — try/catch sur toutes les routes** — les 9 handlers propagaient les erreurs DB en 500 non maîtrisé. Chaque handler est maintenant enveloppé dans un try/catch avec `reply.code(500).send({ error: 'Internal server error' })`.
- **`/api/v1/instance/announcement` — rateLimit ajouté** — route appelée à chaque chargement de page (layout.server.ts), exposée au flood sans protection.
- **`instance.ts POST /tags` — modérateurs autorisés** — les modérateurs étaient bloqués à tort pour créer/supprimer des tags (incohérent avec les autres routes où mods = admins).
- **Version corrigée** — `nodyx-core/package.json` et `nodyx-frontend/package.json` passés de `1.0.0` à `1.8.0` ; `GET /` retournait `version: '0.1.0'` → lit désormais `process.env.NODYX_VERSION ?? '1.8.0'`.
- **`install.sh` — bannière et version** — bannière affichait `v1.0`, enregistrement directory hardcodait `"1.0.0"` → corrigés en `v1.8` et `${NODYX_VERSION:-1.8.0}`.
- **`admin/ai` — Neural Engine** — `selectModel()` appelait `POST /api/v1/admin/neural/set-model` (route inexistante) avec token depuis `localStorage` (violation de la convention HttpOnly cookie). Remplacé par un no-op avec bannière "En développement".
- **`.env.example` — variables manquantes documentées** — `nodyx-core/.env.example` : ajout de `GOSSIP_PEERS`, `STUN_FALLBACK_URLS`, `SIGNET_URL`, `VPS_IP`, `CF_TOKEN`, `CF_ZONE_ID` ; `nodyx-frontend/.env.example` : `PUBLIC_API_URL` corrigé (était `/api/v1` → maintenant la racine du domaine), ajout de `PRIVATE_API_SSR_URL` et `PUBLIC_DIRECTORY_URL`.

### Added
- **Previews SVG pour les table-templates** — `brasserie-de-nuit`, `pierre-et-braise`, `table-de-feutre` : fichier `preview.svg` (280×160px) créé pour chaque template officiel, requis par la future UI de sélection.

---

## [1.8.0] — 2026-03-14

### Added
- **Système de tâches léger** — Kanban par communauté, accessible sur `/tasks`
  - Tableaux avec 3 colonnes par défaut (À faire / En cours / Terminé)
  - Colonnes configurables : nom, couleur (9 variantes), ajout/suppression
  - Cartes : titre, description, assignation, échéance, priorité (basse/normale/haute/urgente)
  - Drag & drop natif HTML5 entre colonnes (zéro dépendance)
  - Modal d'édition complète avec sélecteur de membre pour l'assignation
  - Permissions : tout membre peut créer tableaux et cartes ; gestion colonnes réservée au créateur + admin/mod
  - Migration 047 (`task_boards`, `task_columns`, `task_cards`)
- **Alerte de mise à jour dans le panel admin** — bannière indigo affichée dès qu'une nouvelle version est disponible sur GitHub, avec lien vers les notes de version ; vérification via l'API GitHub Releases, résultat mis en cache Redis 6h
- **Numéro de version** affiché sur la page d'accueil dans la section "Cette instance" (ex: `Nodyx v1.8.0`) — lu depuis la variable d'environnement `NODYX_VERSION`
- **Directory réseau — instances hors ligne masquées** — `GET /directory` filtre désormais les instances dont `last_seen > 30 minutes` ; seules les instances actives apparaissent dans la Galaxy Bar et sur `/admin/status`

### Fixed
- **Raspberry Pi ARM64 (Pi 4/5)** — `install.sh` : installation forcée de `@rollup/rollup-linux-arm64-gnu` si absent après `npm install` (évite l'erreur `traceVariable / tick from svelte` due au fallback JS de Rollup 4 sans binaire natif)
- **ARM32 bloqué** (`armv7l`/`armv6l`) — message d'erreur explicite avec instruction pour passer en OS 64-bit
- **Build ARM** — `NODE_OPTIONS=--max-old-space-size=1024` ajouté sur le build frontend

---

## [1.7.0] — 2026-03-10

### Added
- **Landing page refonte** — hero dynamique avec stats live (membres/canaux/threads), feature highlights illustrés, footer institutionnel avec lien GitHub/AGPL
- **Admin — Dashboard enrichi** — statistiques étendues (événements, sondages, assets, messages chat, DMs), graphique d'activité duale (posts + nouveaux membres sur 7 jours), top 5 contributeurs du mois, derniers inscrits
- **Annonces système** — bannières colorées (6 variantes : indigo/amber/green/red/sky/rose) créées par les admins, dismissibles par l'utilisateur, expiration optionnelle par date/heure, prévisualisation live dans le panneau admin (`/admin/announcements`)
- **Journal de modération** — audit trail complet des actions admin (`/admin/audit-log`), 11 types d'actions (ban/unban/kick/rôle/pin/unpin/lock/unlock/supprimer fil/créer annonce/supprimer annonce), filtres par action et par admin, pagination 50 entrées, helper `logAction()` fire-and-forget
  - Migrations 045 (`system_announcements`) + 046 (`admin_audit_log`)

### Fixed
- **Stabilité admin** — pool PG `max` 10 → 20 pour absorber les requêtes SSR parallèles lors des rechargements de pages admin ; `connectionTimeoutMillis: 5000` ; `.catch()` ajouté sur toutes les queries stats vulnérables (`activityRes`, `membersActivityRes`, `topContribRes`, `recentMembersRes`) — corrige les déconnexions socket intermittentes lors des actions admin (changement de rôle, ban, etc.)
- **Directory** — `online_count` dédupliqué via `io.in('presence').fetchSockets()`, fenêtre `isOnline` élargie à 20 minutes
- **Tests** — `admin.test.ts` : mock fallback `mockResolvedValue` pour les queries supplémentaires du dashboard enrichi ; pattern SQL `community_members` mis à jour pour matcher le JOIN users

---

## [1.6.0] — 2026-03-08

### Added
- **Calendrier d'événements** (SPEC 011) — CRUD complet, RSVP (going/maybe/not_going), cover upload (`asset_type: banner`), sanitize-html étendu (img/iframe/table/div/span)
  - Pages `/calendar`, `/calendar/new`, `/calendar/[id]`, `/calendar/[id]/edit`
  - `can_manage` retourné par `GET /events/:id` (auteur OU mod/admin de la communauté)
  - `canManageEvent()` helper dans `events.ts`
- **Gossip Protocol** — synchronisation légère des événements cross-instances
  - Scheduler `announceEventsToDirectory()` — pousse les événements à venir toutes les 10 min
  - `/discover` multi-type : cards communautés + threads + événements avec types dédiés

---

## [1.5.0] — 2026-03-08

### Added
- **Slug URLs pour les catégories** — URLs lisibles pour toutes les catégories et sous-catégories
  - Format : `/forum/nouvelles-fonctionnalites` (NFD + strip emojis + tirets)
  - Redirect 301 automatique UUID → slug sur les pages catégorie et thread
  - `generateCategorySlug()` dans `community.ts` (même algo que threads)
  - Régénération automatique du slug quand un admin renomme une catégorie
  - `scripts/regen-category-slugs.ts` — script one-shot pour les instances existantes
  - Migrations 039 (`categories.slug`) + 040 (`network_index.category_slug`)
- **Sous-catégories visibles** — les catégories parentes (ex: Développement) affichent maintenant leurs sous-catégories en grille avant la liste de threads
- **Global Search cross-instances** (`/discover`) — SPEC 010
  - Table `network_index` avec indexation FTS PostgreSQL (GIN)
  - Scheduler `announceThreadsToDirectory()` : pousse les threads publics toutes les 10 min
  - Directory : `POST /announce` + `GET /search` avec `ts_rank` et fallback `updated_at`
  - Page `/discover` avec barre de recherche, cards instances, tags, pagination
  - Opt-in via `NODYX_GLOBAL_INDEXING=true` dans `.env`
  - Lien « Découvrir » dans la navigation principale
- **URLs cross-instances correctes** — les liens depuis `/discover` pointent vers `/forum/{category_slug}/{thread_slug}` de l'instance distante

### Fixed
- Redirect post-création de thread vers l'URL canonique (slug catégorie + slug thread)
- `category_slug` retourné par `ThreadModel.create` via sous-requête inline
- Tous les liens forum utilisent `category.slug ?? category.id` (home, search, notifications, admin, sitemap, RSS)

---

## [1.4.0] — 2026-03-08

### Added
- **Slug URLs** — threads accessibles via URLs lisibles et indexables par les moteurs de recherche
  - Format : `/forum/[category]/mon-titre-de-thread-XXXXXXXX` (NFD accent-stripping + suffixe UUID)
  - Redirect 301 automatique des anciens UUID vers le slug canonique
  - `scripts/regen-slugs.ts` — script de régénération pour les instances existantes
- **SEO complet** — chaque page forum correctement balisée
  - `<link rel="canonical">` sur toutes les pages thread et catégorie
  - OpenGraph complet : `og:url`, `og:image` (banner communautaire), `og:site_name`, `og:type`
  - JSON-LD `DiscussionForumPosting` avec `url`, `dateModified`, `isPartOf`, `interactionStatistic`
  - `og:site_name` + `theme-color` injectés globalement via le layout
- **`/sitemap.xml` dynamique** — toutes les catégories et threads publics avec `lastmod` et priorité
  - Fetch en parallèle par catégorie, cache 1h, regeneration automatique
  - `robots.txt` déjà référencé (était présent, maintenant actif)
- **Migration 036** — colonnes `slug`, `is_indexed`, `last_indexed_at` sur `threads`
  - Infrastructure prête pour le Global Search (SPEC 010)

### Fixed
- `forums.ts GET /threads/:id` — toutes les queries suivantes (posts, tags, views) utilisent `thread.id` (UUID résolu) et non le slug brut
- `forums.ts POST /posts` — `thread_id` résolu en UUID avant insert FK et vérification de ban
- `forums.ts PATCH /threads/:id` — `isMod`, `update`, `remove`, `setThreadTags` utilisent `thread.id`
- `CreatePostBody` Zod — `thread_id` accepte string (UUID ou slug), résolution côté serveur
- `+page.server.ts` — requête polls utilise `thread.id` et non `params.thread` (slug)
- Suppression de `pokled.ddns.net` hardcodé dans `og:image` (vestige d'une instance de dev)

---

## [1.3.0] — 2026-03-08

### Added
- **Système de ban complet** — protection multi-couches contre les abus
  - IP ban + email ban : les comptes recréés depuis la même IP ou avec le même email sont bloqués dès l'inscription
  - Déconnexion socket immédiate au moment du ban (le modérateur n'a pas à attendre)
  - Enforcement à toutes les couches : login, socket.io, API, `instance/members`, `communities/join`
  - Page `/banned` dédiée, redirection automatique dès l'événement `banned` Socket.IO
  - Panel admin : formulaire de ban avec motif, durée optionnelle, confirmation modale
  - Migration 030 : `community_bans` (userId, reason, bannedBy, expiresAt, ipBan, emailBan)
- **nodyx-turn — TURN over TCP (RFC 6062)** — les utilisateurs derrière VPN ou firewall strict peuvent désormais utiliser les salons vocaux
  - Écoute simultanée UDP:3478 + TCP:3478 — même binaire, même configuration
  - Framing RFC 4571 : préfixe 2 octets big-endian par message
  - Registry partagée UDP/TCP — une seule allocation par client quel que soit le transport
  - ICE server URL ajouté automatiquement : `turn:IP:3478?transport=tcp`
- **nodyx-turn — MESSAGE-INTEGRITY sur les réponses** (RFC 5389 §10.3)
  - Les réponses TURN (Allocate, Refresh, CreatePermission, ChannelBind) incluent désormais le champ MESSAGE-INTEGRITY obligatoire
  - Fixe le problème fondamental : Firefox et Chrome rejetaient silencieusement les réponses sans MI → aucun relay candidate généré → TURN inutilisable en relay

### Fixed
- **Voice — Relay failover automatique** — détection de qualité dégradée et bascule relay
  - Si la perte de paquets dépasse 25% pendant 3 polls consécutifs (~6s), la connexion bascule en relay-only via `pc.setConfiguration({ iceTransportPolicy: 'relay' })` + ICE restart
  - Bascule silencieuse (sans coupure audio) — spécialement conçu pour les utilisateurs VPN
- **Voice — Opus optimisé pour les liens à forte perte**
  - Bitrate par défaut : 64 kbps → **32 kbps** (paquets plus petits, meilleure résistance à la perte)
  - DTX (Discontinuous Transmission) désactivé : les silences généraient des bursts au retour de la parole
  - Mono forcé (`stereo=0`) : la voix ne nécessite pas la stéréo, réduit encore la bande passante
  - FEC (in-band Forward Error Correction) maintenu : `useinbandfec=1`
- **Voice — Calcul packet loss** — `Math.max(0, dLost)` protège contre les deltas négatifs lors d'un ICE restart
- **nodyx-turn — Quota allocation** — `MAX_LIFETIME` plafonné à 300s (Firefox demandait 3600s → quota saturé en ~25 reconnexions → vocal bloqué 1h)
- **Socket.IO — Transport polling-first** — `transports: ['polling', 'websocket']` — nodyx-relay strip le header `Upgrade`, le WebSocket seul en premier tentait indéfiniment → `online_count = 0` sur toutes les instances relay
- **Salons vocaux — Capacité portée à 25** — limite relevée + enforcement côté serveur + notification `voice:full` côté client

---

## [1.2.0] — 2026-03-07

### Added
- **Sondages (Polls)** — système complet dans le chat ET le forum
  - 3 types : choix unique, planning (schedule), classement (ranking)
  - Résultats en temps réel via Socket.IO, clôture par l'auteur ou un admin
  - Bouton 📊 dans l'input du chat, intégration à la création de sujet forum
  - Composants `PollCard.svelte` (affichage + vote) et `PollCreator.svelte`
  - Migrations 028 (tables polls/options/votes + `channel_messages.poll_id`) et 029 (`polls.thread_id`)
- **Messages Privés (DM)** — messagerie 1-to-1 temps réel
  - Route dédiée `/dm/:username`, inbox triée par dernier message
  - Socket.IO room `dm:<userId>` — livraison instantanée, badge de non-lus
- **Galaxy Bar — instances liées** — affichage des instances Nodyx fédérées dans la barre latérale gauche
  - Liste dynamique depuis le directory, indicateur d'état (en ligne / hors ligne)
  - Navigation rapide entre communautés
- **Forum — sélecteur catégorie/sous-catégorie** — formulaire de nouveau sujet avec dropdown hiérarchique, navigation URL persistée
- **uninstall.sh** — script de désinstallation complète interactif
  - Double confirmation avant toute suppression
  - Suppression sélective : PM2, Caddy, Redis, PostgreSQL, nodyx-turn, nodyx-relay, UFW
- **nodyx-update** — script `/usr/local/bin/nodyx-update` généré à l'install pour mettre à jour Nodyx en une commande

### Fixed
- **Installer — Redis sur Debian Trixie / Raspberry Pi** — service marqué "static" → `systemctl unmask` ajouté ; répertoires `/var/lib/redis` et `/var/log/redis` créés avant le démarrage (cause de crash "No such file or directory")
- **Installer — Spinners animés** — progression visible pendant `npm install` et `npm run build` (surtout utile sur ARM lent)
- **Installer — Détection crash PM2** — vérification `online` 5s après `pm2 start`, dump des logs si crash
- **Installer — Attente backend** — timeout porté à 180s avec spinner animé (était 60s silencieux)
- **Installer — Enregistrement admin** — 3 tentatives avec délai 8s, gestion des codes 409 (réinstall)
- **Installer — README** — `cd Nodyx` manquant dans la commande one-liner
- **SSR — URL API** — configurable via `PRIVATE_API_SSR_URL` pour les environnements non-standard
- **Polls — persistance** — `getMessages` n'incluait pas `poll_id` dans le SELECT → sondages perdus au refresh
- **Polls — messages vides** — contrainte `content NOT NULL` → insérer `''` pour les messages de type poll
- **Forum — bouton Annuler** — couleur et navigation corrigées (URL absolue avec paramètres de catégorie)
- **online_count** — comptait les heartbeats Redis (TTL 15min) au lieu de `io.fetchSockets()` → comptage exact

---

## [1.1.0] — 2026-03-06

### Added
- **Chat — Système de réponses/citations** — `reply_to_id` sur les messages, barre de prévisualisation dans l'input, citation inline avec bordure colorée dans le message
- **Chat — Messages épinglés** — un admin peut épingler un message par canal, bannière sticky dans le header du canal, masquable, désépinglage admin
- **Chat — Aperçus de liens (Open Graph)** — unfurl côté serveur avec cache Redis 1h, cartes de prévisualisation (titre, description, image, site_name) sous les messages
- **Chat — Badge de mention** — bulle rouge sur l'icône Chat dans la navigation quand un utilisateur est @mentionné (séparé de la cloche de notifications générale)
- **Chat — Barre d'actions messages** — réponse (↩️), édition (propres messages), épinglage (admin), suppression, copie
- **Présence — Statuts personnalisés** — emoji + texte libre, 8 presets (En réunion, Distrait, BRB…), persisté dans Redis 24h, visible dans la sidebar pour tous les membres
- **Présence — Statut dans le panel de profil** — bouton de statut rapide au-dessus des liens du dropdown, ouvre la modale de statut
- **Présence — Liste des membres hors ligne** — section collapsible "Hors ligne — N" en bas de la sidebar, avatars en niveaux de gris, opacité 50%
- **Auth — Mot de passe oublié** — flow complet (token email, TTL 1h, migration 025, emailService.ts)
- **Migration 025** — table `password_reset_tokens` (userId, token hash, expiration)
- **Migration 026** — `reply_to_id` sur `channel_messages` + `pinned_message_id` sur `channels`
- **Plugins** — dossier `plugins/` (retiré du .gitignore) avec README et 3 table-templates officiels (Brasserie de Nuit, Table de Feutre, Pierre & Braise)
- **Nouveaux composants** — `ChannelSidebar.svelte`, `EmojiPicker.svelte`, `VoiceRoom.svelte`
- **GET /api/v1/instance/members** — liste complète des membres pour la sidebar hors-ligne

### Fixed
- **Voice en mode Relay** — `TURN_PUBLIC_IP` vide = zéro ICE server → voix impossible en NAT strict. `voice.ts` lit désormais `STUN_FALLBACK_URLS` et `install.sh` injecte deux STUN Google publics en mode Relay
- **install.sh — Version** — enregistrement auprès du directory avec `"0.4.1"` → corrigé en `"1.0.0"`
- **install.sh — Description communauté** — jamais renseignée (créée vide en SQL), `NODYX_COMMUNITY_DESCRIPTION` absent du `.env` → prompt ajouté, variable injectée
- **install.sh — Pays** — `NODYX_COMMUNITY_COUNTRY` toujours vide → prompt ajouté

---

## [1.0.0] — 2026-03-05

### Added
- **Profile theme system** — complete per-user personalization engine
  - 6 built-in presets: Défaut 🌑, Minuit 🌌, Forêt 🌲, Chaleur 🔥, Rose 🌸, Verre 💎
  - CSS variable architecture: `--p-bg`, `--p-card-bg`, `--p-card-border`, `--p-accent`, `--p-text`, `--p-text-muted`
  - Live preview editor in `/users/me/edit` — preset grid + 5 individual hex color pickers
  - Migration 024 — `metadata JSONB DEFAULT '{}'` on `user_profiles`
  - Theme stored as `metadata.theme` via PostgreSQL JSONB merge operator (`||`)
- **App-wide theming** — user's profile theme propagates to the entire interface: top nav, Galaxy Bar sidebar, members sidebar, bottom nav, page background — every logged-in user skins the app with their own preset
- **Mobile-responsive UI overhaul** — full mobile-first layout
  - Chat page: sliding channel drawer (hamburger button), VoicePanel always accessible on mobile
  - Forum pages: responsive category icon, title, and dropdown sizing
  - Admin settings: responsive two-column form layout
  - Bottom navigation bar (`lg:hidden`) with `--bottom-nav-h` CSS variable for safe content padding
- **Community favicon** — dynamic `<link rel="icon">` injected from the community logo in `<svelte:head>`
- **Asset library — 12 MB upload limit** (up from 5 MB)
  - `@fastify/multipart` limit updated to 12 MB
  - Migration 023 — DB constraint updated (`CHECK (file_size <= 12582912)`)
  - Per-type upload tooltips with design guidelines, recommended dimensions, format advice
- **Profile badges** — displayed at 56 × 56 px (doubled from 28 × 28 px)

### Fixed
- Profile `metadata` column was missing from `SELECT` in `GET /users/:username/profile` — theme was saved to DB but never returned to frontend
- Chat page channel sidebar visual gap on desktop — `fixed top-14` base class leaked through `lg:relative` override; restructured using `max-lg:` Tailwind prefix for mobile-only fixed positioning
- `@fastify/multipart` file size limit (5 MB) was independent of the DB constraint — both now consistently at 12 MB

---

## [0.9.0] — 2026-03-04

### Added
- **NodyxCanvas** — tableau blanc collaboratif P2P dans les salons vocaux
  - CRDT LWW (Last-Write-Wins) par élément — convergence garantie sans conflit
  - Curseurs distants en temps réel (throttle 50ms, fade 4s, halo vocal si `speaking: true`)
  - Outils : stylo, post-it, rect, cercle, effaceur, colorpicker, undo local, clear all
  - Grille de fond CSS `radial-gradient` dark (dots)
  - Export PNG + envoi du récap dans le canal texte au choix
  - Protocole `canvas:op` via DataChannels P2P
- **Jukebox collaboratif** — lecteur audio synchronisé dans les salons vocaux
  - Web Audio API — play/pause/next en sync P2P
  - Queue collaborative, historique de session
  - Volume individuel (GainNode + localStorage, jamais broadcasté)
  - Autoplay unblock automatique (gestion politique navigateur)
  - VoiceToolbar : boutons Jukebox / Canvas / Screenshare + controls row compact
- **nodyx-turn** — STUN/TURN Rust natif remplace coturn (Phase 3.0-C ✅)
  - Binaire 2.9MB statique (tokio + RFC 5389/5766)
  - Credentials dynamiques HMAC-SHA1 time-based (coturn `use-auth-secret` compatible)
  - MESSAGE-INTEGRITY vérification, ChannelBind / ChannelData
  - Rate limiter UDP par IP (30 pkt/sec) + quotas allocations (10/IP, 1000 total)
  - Migration : nodyx-core génère les creds par utilisateur → `voice:init` Socket.IO
  - `install.sh` intégré, service systemd, GitHub Release `v0.1.2-p2p` (amd64 + arm64)
- **P2P asset transfer** — transfert de fichiers entre pairs via DataChannels
  - Protocole `p2p:asset:*` (chunks 32 Ko, indicateur de progression)
  - Store `p2pAssetPeers`, bouton ⚡ jaune dans la sidebar
- **Partage d'écran** — améliorations
  - Bouton screen share restauré dans la barre de controls + sidebar
  - Flux vidéo distants affichés dans le salon vocal

### Fixed
- P2P DataChannel restait actif à la navigation (déconnexion propre ajoutée)
- Admin branding file upload — mauvaise URL + token null
- Seed forum : ordre des posts + images de badges externes remplacées
- Homepage : vraies images d'avatars sur les articles + derniers posts

---

## [0.8.0] — 2026-03-02

### Added
- **Phase 3.0-B — Browser P2P DataChannels** ✅ POC validé
  - `nodyx-frontend/src/lib/p2p.ts` — gestionnaire RTCPeerConnection + DataChannel
  - Signaling via Socket.IO existant (events `p2p:offer`, `p2p:answer`, `p2p:ice`)
  - Handshake polite/impolite — un seul initiateur, pas de collision
  - Indicateur UI `⚡ P2P · N` dans l'en-tête du canal texte (jaune si actif, gris pulsant si en cours)
  - Fallback gracieux WebRTC (timeout ICE 12s, toast discret)
- **Indicateurs de frappe P2P instantanés** — ~1–5ms via DataChannel (dots animés style Discord)
- **Réactions optimistes** — animation spring physics, arrive avant confirmation serveur
- **Transfert d'assets P2P** — premier prototype (chunks 32 Ko)

### Fixed
- Fallback ICE : flag `_hadAttempt`/`_hadSuccess` pour éviter double toast
- Plusieurs connexions pairs simultanées (Map de RTCPeerConnections)

---

## [0.7.0] — 2026-03-01

### Added
- **Bibliothèque d'assets communautaire**
  - Upload multipart avec compression Sharp → WebP + thumbnail auto
  - Catégories : cadres, bannières, badges, stickers, avatars, fonds
  - Recherche full-text FR, filtres, tri popularité
  - Limite 5 MB (augmentée à 12 MB en v1.0.0)
  - Routes `POST/GET/DELETE /api/v1/assets` + `/api/v1/assets/user/:id`
  - Page `/library` — galerie avec filtres + upload
  - Page `/library/[id]` — détail, like, équipement, bouton Chuchoter
  - Profil utilisateur — affichage des assets équipés (frame, banner, badge, wallpaper)
  - Page `/users/me/edit` — gestion des slots d'assets
  - Admin — pages gestion assets + jardin
- **Jardin de fonctionnalités** (Garden)
  - `feature_seeds` — propositions de fonctionnalités votables
  - `seed_waters` — vote unique par utilisateur (409 si double vote)
  - Page `/garden` — propositions, barre de progression, arrosage one-shot, toast "déjà voté"
  - Routes `POST/GET /api/v1/garden/seeds` + `POST /api/v1/garden/seeds/:id/water`
- **Fédération d'assets** — snapshot des assets vers le directory nodyx.org
  - Migration 021 — `directory_assets`
  - Route `POST /api/directory/assets` + `GET /api/directory/assets/search`
  - Onglet "🌐 Toutes les instances" dans `/library`
  - Scheduler : push assets toutes les heures
- **Chuchotements (Whispers)** — salons de chat éphémères
  - Migration 022 — `whisper_rooms` + `whisper_messages`
  - Socket.IO events `whisper:*` (join, leave, message, typing, history, expired)
  - Page `/whisper/[id]` — salon temps réel style iMessage, TTL affiché
  - Bouton "🤫 Chuchoter" sur les pages asset
  - Scheduler : nettoyage des whispers expirés toutes les 10 minutes
- **`linkify.ts`** — URLs cliquables dans le chat et les whispers (sans XSS)
- **Migrations 017–022** (name_color, community_assets, feature_seeds, profile_assets, directory_assets, whisper_rooms)
- **Slug `fix`** — `GIF` préservés sans conversion WebP (animation conservée)

### Fixed
- `@fastify/multipart` : fichier doit être en dernier dans FormData (champs collectés avant le fichier)

---

## [0.5.0] — 2026-03-01

### Added
- **nodyx-relay** — Rust P2P relay infrastructure (Phase 3.0-A ✅)
  - `nodyx-relay server` — deployed on VPS: TCP:7443 (relay clients) + HTTP:7001 (Caddy proxy), tokio async, DashMap in-memory registry
  - `nodyx-relay client` — 9MB static binary, outbound TCP connection only — **zero open ports, zero domain required**
  - Automatic `slug.nodyx.org` provisioning — slug reserved in DB at registration, DNS wildcard served by relay proxy
  - Exponential backoff reconnection (1s → 2s → 4s → max 30s)
  - `install.sh` — option 2 "Nodyx Relay (recommended)" → auto-downloads binary, generates systemd service, full URL without touching a router
  - `nodyx-relay-client.service` — systemd unit, auto-restart, enabled on boot
  - GitHub Releases `v0.1.0-relay` + `v0.1.1-relay` — amd64 + arm64 static binaries
  - **Validated:** Raspberry Pi 4, zero open ports, zero Cloudflare account → `https://test.nodyx.org` live ✅
- **Voice channel member interaction panel**
  - Click any member in the voice channel sidebar → opens their real-time stats in VoicePanel (RTT, jitter, packet loss, volume slider)
  - Click yourself ("vous") → green self-monitoring panel: live audio level meter, muted / deafened / PTT status badges
  - Interaction buttons per peer: Profile link, Direct Message (functional), File sharing + Mini-game (coming soon)
  - `voicePanel.ts` — shared Svelte writable store for cross-component panel targeting (discriminated union: `{ type: 'peer', socketId } | { type: 'self', username, avatar } | null`)
- **VoicePanel sidebar** — redesigned as a fixed-position left sidebar (Galaxy Bar layout)
  - Participant list with clickable member rows, animated connection indicator, member count badge
  - VoiceSettings popup — fixed-position (`bottom-24 left-1/2`), 360px wide, escapes sidebar overflow with backdrop blur overlay

### Fixed
- **nodyx-relay concurrent requests** — relay client was processing requests sequentially. With Socket.IO long-polling (pingInterval 8s), one user's blocking GET delayed all others → relay server 10s timeout → 504 Gateway Timeout → Socket.IO disconnect → presence sidebar empty. Fixed by spawning a tokio task per request; writes are serialized via `mpsc`. Timeout ladder: `pingInterval(8s) < reqwest(12s) < relay-server(15s)`
- **online_count off-by-default** — `/info` and `/admin/stats` counted `redis.keys('nodyx:heartbeat:*')` (set on API calls, 15 min TTL). Active Socket.IO session ≠ recent API call → count dropped to 0 after 15 min of browse-only activity. Fixed: `io.in('presence').fetchSockets()` — Socket.IO presence room as the source of truth, deduplicated by `userId`

### Infrastructure
- `relay.nodyx.org` — DNS A record (grey cloud, no Cloudflare proxy) for direct TCP:7443 relay client connections
- UFW: port 7443/tcp opened on the VPS for relay client inbound connections
- `nodyx-relay.service` — systemd unit active on VPS, ~1.3MB RAM, Restart=on-failure
- Caddy: `*.nodyx.org` now routes to `localhost:7001` (nodyx-relay HTTP proxy) instead of `localhost:3000` — relay handles routing (tunnel → active relay, 302 → DB URL, 404 → unknown)

---

## [0.4.0] — 2026-02-28

### Added
- **Production deployment** — full stack live on [nodyx.org](https://nodyx.org) (Hetzner CPX42, Ubuntu 24.04, PM2, Caddy, Cloudflare)
- **Directory API** — instance registry with automatic Cloudflare DNS subdomain provisioning
  - `GET /api/directory` — list active instances
  - `POST /api/directory/register` — register an instance, triggers URL check + DNS creation
  - `POST /api/directory/ping` — heartbeat to update member/online counts and `last_seen`
  - `DELETE /api/directory/:slug` — unregister and remove DNS record
- **Migration 014** — `directory_instances` table (slug, token, subdomain, cloudflare_record_id, last_seen…)
- **Scheduler** (`scheduler.ts`) — auto-pings the directory every 5 minutes with live member/online counts from DB + Socket.IO
- **Communities page** — replaced mock data with live `/api/directory` API data

### Infrastructure
- Caddy reverse proxy with Cloudflare Origin Certificate (Full Strict SSL)
- `*.nodyx.org` wildcard block — all registered subdomains routed to the same stack
- `code.nodyx.org` — code-server (VS Code in browser) for remote development
- Claude Code CLI installed on VPS for remote AI-assisted development

### Fixed
- Directory DNS creation: replaced `dnsLookup` (returned Cloudflare proxy IP) with `VPS_IP` env var

---


## [0.4.1] — 2026-03-01

### Added
- **`install.sh`** — one-click node installer for Ubuntu 22.04/24.04 and Debian 11/12
  - Detects the server's public IP automatically (used for TURN relay config)
  - Installs and configures: Node.js 20, PostgreSQL, Redis, coturn, Caddy, PM2
  - Grants PostgreSQL 15+ `CREATE ON SCHEMA public` (migration fix for fresh installs)
  - Configures UFW firewall (SSH, HTTP, HTTPS, TURN ports, WebRTC relay range)
  - Generates secure random secrets (DB password, JWT secret, TURN credential)
  - Bootstraps the instance community and creates the admin account automatically
  - Saves all credentials to `/root/nodyx-credentials.txt` (chmod 600)
  - TURN URL uses server IP directly — bypasses Cloudflare proxy automatically
- **`docs/en/INSTALL.md`** — comprehensive English installation guide
  - Hardware requirements, OS compatibility table
  - VPS recommendations (Hetzner, DigitalOcean, Vultr, OVH)
  - Windows WSL2 step-by-step guide
  - Home server / NAT / CGNAT section with port forwarding table
  - VPN and WireGuard considerations (Phase 3 preview)
  - Common errors & fixes (port conflicts, DNS, TURN, SSL, uploads)
  - Post-install guide and admin tips
- **`docs/fr/INSTALL.md`** — guide d'installation complet en français (même contenu)
- **`nodyx-core/src/migrations/015_admin_role.sql`** — fixes `community_members_role` constraint to include `'admin'` role (was missing from migration 001, causing DB errors when promoting users to admin)
- **GitHub CLI (`gh`)** — installed on the VPS for release management

### Fixed
- **DB constraint `community_members_role`** — migration 001 only allowed `('owner', 'moderator', 'member')`; the admin middleware and routes already referenced `'admin'`, causing a silent mismatch. Migration 015 aligns the constraint with the codebase.

### Changed
- **TURN relay** — removed hardcoded home server (`pokled.ddns.net`). TURN is now configured entirely via `.env` variables (`PUBLIC_TURN_URL`, `PUBLIC_TURN_USERNAME`, `PUBLIC_TURN_CREDENTIAL`), set automatically by `install.sh` using the detected public IP.
- **File uploads** — Caddy now routes `/uploads/*` to port 3000 (was missing, causing 404 on uploaded avatars/banners)
- **Instance directory** — backend scheduler pings directory every 5 minutes with live member/online stats

---

## [0.3.3] — 2026-02-28

### Fixed
- **Forum:** erreur 500 sur toutes les pages catégories — la requête SQL `GET /forums/threads` référençait `c.slug` (colonne inexistante sur la table `categories`)
- **TipTap:** warning "Duplicate extension names: link, underline" — StarterKit v3 inclut désormais ces extensions par défaut ; désactivées dans StarterKit, conservées avec leur config personnalisée

### Build
- `tsconfig.json` : exclut `src/tests/` du build de production — `npm run build` propre sans erreurs de test
- `tsconfig.test.json` : nouveau fichier dédié à vitest (`noEmit: true`, inclut les tests)

### Docs
- Documentation EN/FR complète — README, ARCHITECTURE, ROADMAP, MANIFESTO, CONTRIBUTING traduits intégralement
- `docs/en/specs/` : 8 specs traduites (002 à 013)
- `docs/fr/` : AUDIO et NEURAL-ENGINE ajoutés
- Tous les liens internes `docs/` corrigés
- README racine : diagramme réseau P2P, notice alpha, badge version mis à jour

---

## [0.3.2] — 2026-02-28

### Fixed
- **WebRTC TURN relay fully operational** — relay candidates now correctly advertise the public IP
  - `turn-server/server.js`: `externalIp` → `externalIps` (node-turn reads the plural form — one character, weeks of debugging)
  - `turn-server/server.js`: `relayIps: ['0.0.0.0']` → `['192.168.1.100']` — relay socket now binds to the actual LAN interface instead of wildcard (was causing `xor-relayed-address: 0.0.0.0` in ALLOCATE responses)
  - `turn-server/server.js`: added `credentials` config so node-turn can validate `MESSAGE-INTEGRITY` from browsers
  - PM2 process now started with explicit `--cwd` — `dotenv` was silently failing to find `.env` causing 40+ crash-restart cycles
  - Bbox port forwarding rule fixed: relay port range `49152–55440` was mapped to internal port `48000` instead of `49152`

- **WebRTC ICE reconnection loop** — `_scheduleRejoin` was destroying all peer connections when a single peer failed
  - Added `_dropPeer()`, `_hasOtherConnectedPeer()`, `_handlePeerFailure()` — only triggers full rejoin if no other connected peer exists
  - Per-peer ICE restart (2 attempts before escalating to rejoin)

- **Double-peer appearance on reconnect** — race condition where `voice:peer_joined` arrived before `voice:peer_left` for the same `userId`
  - `onPeerJoined` now detects stale peers by `userId` and calls `_dropPeer` before adding the new socket

### Changed
- **ICE config cleanup** — removed broken TCP/TLS TURN URL variants (`?transport=tcp`, port 443, `turns:`) injected via `configureICE` — these were timing out and delaying ICE gathering
- `iceCandidatePoolSize: 2` added to pre-gather relay candidates before ICE checking starts
- Added `[ICE gather]` + `[ICE config]` console debug logging for future diagnostics

### Security
- Removed two user logo uploads (`uploads/logos/`) that were accidentally tracked in git

---

## [0.3.1] — 2026-02-27

### Fixed
- **Screen sharing in voice channels** — the feature existed but did nothing (video was only shown locally, never sent to peers)
  - `voice.ts`: `startScreenShare()` now adds the video track to all active `RTCPeerConnection`s and triggers renegotiation (`createOffer` → `voice:offer`) for each peer
  - `voice.ts`: `stopScreenShare()` removes video senders and renegotiates to signal end of share
  - `voice.ts`: `ontrack` handler now splits audio/video — video tracks go to `remoteScreenStore`
  - `MediaCenter.svelte`: rewritten to use `startScreenShare`/`stopScreenShare` from `voice.ts`
  - Remote screens visible inside MediaCenter panel (with username + live badge)
  - Clip recording (rolling 60s) now connected to the actual shared stream

---

## [0.3.0] — 2026-02-27

### Added
- **`docker-compose.yml`** — full stack in one command: PostgreSQL 16 + Redis 7 + API + Frontend
  - PostgreSQL healthcheck ensures API waits for DB before starting
  - Volumes for persistent data (`postgres_data`, `redis_data`) and uploads bind-mount
- **`.env.example`** (root) — `DB_PASSWORD` for docker-compose
- **`nodyx-core/src/scripts/migrate.ts`** — idempotent SQL migration runner
  - Creates `schema_migrations` tracking table on first run
  - Skips already-applied migrations — safe to call on every boot
- **`nodyx-frontend/Dockerfile`** — multi-stage Node.js build (builder → runner, PORT=3001)

### Changed
- **`nodyx-core/src/index.ts`** — `runMigrations()` called before `server.listen()`
- **`nodyx-core/Dockerfile`** — `src/migrations/` copied into runner image; `uploads/` subdirs created

---

## [0.2.0] — 2026-02-27

### Added
- **Test suite** (nodyx-core): 34 Vitest tests covering auth routes, middleware, and forum routes
  - `auth.test.ts` — 13 tests: register/login/logout with mocked DB + Redis
  - `middleware.test.ts` — 10 tests: `requireAuth`, `optionalAuth`, `rateLimit`
  - `forums.test.ts` — 11 tests: GET /threads, POST /threads, POST /posts
- **GitHub Actions CI** — automated test run on every push/PR to `main`
- **Docs restructuring** — all `.MD` files reorganized into `docs/{en,fr,es,it,de}/`
- **Multilingual documentation stubs** — `docs/es/`, `docs/it/`, `docs/de/` ready for future translations
- **Technical specs** moved to `docs/specs/` (8 specs: profiles, grades, social widgets, audio, search, calendar, galaxy bar, node)
- **Root `README.md`** in English with stack table, project status, and multilingual links
- **`Caddyfile.example`** — generic Caddy reverse proxy config
- **`ecosystem.config.example.js`** — PM2 config with relative paths
- **`turn-server/.env.example`** — template env vars for TURN server

### Security
- Removed sensitive files from git tracking: hardcoded IP addresses, absolute paths, user upload assets
- Sanitized `turn-server/server.js`: replaced hardcoded IP (`87.88.104.61`) and domain with env vars (`TURN_EXTERNAL_IP`, `TURN_REALM`)
- Updated `.gitignore` to exclude `uploads/avatars/*`, `uploads/banners/*`, `uploads/logos/*`, `.claude/`, `.nodyx-context/`
- Added `.gitkeep` files to preserve `uploads/` directory structure

### Removed
- Dead files: `VoicePanel_old.svelte`, `svelte.config_old.js`, boilerplate SvelteKit README
- Redundant docs scattered across `nodyx-core/` root (moved to `docs/`)

---

## [0.1.0] — 2026-02-20

### Added
- **Forum** — categories, threads, posts, reactions, thanks, tags, pin/lock/feature
- **Real-time chat** — channels, WebSocket (send/edit/delete/react/typing), @mentions, notifications
- **Voice channels** — WebRTC P2P mesh, TURN fallback, VAD, network stats (RTT/jitter/loss)
- **Screen sharing + clip recording** — `MediaCenter.svelte` (60s clips, snapshots)
- **User profiles** — avatar/banner upload, GitHub widget, bio, points
- **Communities + roles + permissions** — granular permission system with grades
- **Admin panel** — stats, moderation, branding (logo/banner), category/channel management
- **PostgreSQL full-text search** — instant search across threads and posts
- **Notifications** — reply, mention, thanks events
- **JWT auth** — sessions stored in Redis, 7-day TTL, logout blacklisting
- **Rate limiting** — sliding window via Redis, per-IP with `X-RateLimit-*` headers
- **AI assistant** — local Ollama integration (no cloud dependency)
- **13 SQL migrations** — complete schema from users to voice channels

[Unreleased]: https://github.com/Pokled/Nodyx/compare/v1.8.2...HEAD
[1.8.2]: https://github.com/Pokled/Nodyx/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/Pokled/Nodyx/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/Pokled/Nodyx/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/Pokled/Nodyx/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Pokled/Nodyx/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Pokled/Nodyx/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Pokled/Nodyx/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Pokled/Nodyx/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Pokled/Nodyx/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Pokled/Nodyx/compare/v1.0.0...v1.1.0
[0.9.0]: https://github.com/Pokled/Nodyx/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Pokled/Nodyx/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Pokled/Nodyx/compare/v0.5.0...v0.7.0
[0.5.0]: https://github.com/Pokled/Nodyx/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Pokled/Nodyx/compare/v0.3.3...v0.4.1
[0.3.3]: https://github.com/Pokled/Nodyx/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Pokled/Nodyx/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Pokled/Nodyx/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Pokled/Nodyx/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Pokled/Nodyx/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pokled/Nodyx/releases/tag/v0.1.0
