# Streamer Hub : un QG de stream complet, auto-hébergé, et vraiment possédé par le streamer

## En une phrase

Le Streamer Hub transforme une instance Nodyx en QG complet pour un streamer : alertes, chat unifié, overlays OBS, stream deck mobile, stats et bot, le tout libre, auto-hébergé, et possédé par le streamer.

## Le problème qu'on a voulu résoudre

Un streamer un minimum équipé, c'est une pile d'outils :

- Streamlabs ou StreamElements pour les alertes et overlays
- Un bot dédié (Nightbot, StreamElements bot)
- Un Stream Deck Elgato à 200-400 euros (ou l'app mobile payante)
- Parfois un service de stats
- Et tout ça éparpillé, avec des abonnements mensuels et des données captives

Et au milieu de tout ça, la communauté vit sur Twitch. Pas chez le streamer.

Si le streamer change de plateforme un jour, il repart de zéro. Ses viewers, son chat, son historique, ses commandes : tout reste derrière lui.

On trouvait ça absurde.

## Ce qu'on a fait

On a intégré dans Nodyx un Streamer Hub qui remplace une bonne partie de cette pile. Tout tourne sur le VPS du streamer. Pas de SaaS, pas d'abonnement, pas d'analytics envoyés à un tiers.

Et parce que Nodyx a déjà un forum, un chat, un vocal et un canvas, le Streamer Hub ne fait pas que des alertes : il transforme l'instance en espace de communauté où les viewers peuvent vivre même quand le stream est éteint.

## Ce qu'il sait faire concrètement

### Connexion Twitch

OAuth Twitch, tokens chiffrés au repos (AES-256-GCM + HKDF), configuration depuis l'admin sans toucher au serveur. EventSub temps réel : follows, subs, subs offerts, raids, bits, sondages, début et fin de stream.

### Chat unifié Twitch et Nodyx

Le chat Twitch arrive dans un canal Nodyx. Les messages Nodyx peuvent repartir vers Twitch. Émotes natives Twitch plus BTTV, FFZ et 7TV, badges Twitch, le tout rendu fidèlement. La communauté peut discuter que le streamer soit en live ou non.

### Overlays OBS (sources navigateur)

Six types d'overlay, chacun déclinable en plusieurs thèmes visuels :

- Alert box (follow, sub, raid, bits)
- Event ticker défilant
- Barre d'objectif
- Leaderboard et podium
- Minuteur de stream
- Lecteur de clips avec autoplay

Chaque overlay a une URL tokenisée à coller dans OBS. Zéro exposition inutile.

### Studio Live (le cockpit admin)

Une vue unique pendant le stream :

- Hero Twitch plus courbe de stats sur 7 jours
- Changement de titre et de catégorie en direct
- Pose de marqueur VOD
- Sondages et prédictions Twitch
- Clips récents de la chaîne

### Bot de chat

Timers récurrents (trois modes : répétitif, une fois par live, one-shot). Variables dynamiques : `{nodyx_url}`, `{streamer}`, `{uptime}`, avec des alias tolérants comme `{url}`, `{lien}`, `{chaine}`, `{duree}`.

Commandes natives : `!nodyx`, `!uptime`, `!commands`, `!so`, `!highlight`, `!topclips`. Commandes custom éditables avec cooldown.

### Stream Deck tactile (Nodyx Deck)

Une grille de boutons sur le téléphone, via une URL tokenisée. Plein écran, retour haptique, écran maintenu allumé.

Actions disponibles : lancer les top clips dans un overlay, poser un marqueur VOD, envoyer un message dans le chat, déclencher une commande.

Détail qui compte : le QR code d'accès est flouté par défaut, révélé au clic, refloué à la fermeture. Pour éviter qu'un viewer ne le prenne en photo à la caméra. Ça paraît anodin, mais c'est le genre de chose qu'on oublie jusqu'à ce que ça arrive.

Éditeur WYSIWYG côté admin : presets, gradients, emojis. Partage par QR code.

### Sons d'alerte

Pas de bibliothèque MP3 sous licence douteuse. Un générateur WebAudio qui synthétise des sons à la volée (par exemple une rampe de 700 Hz vers 320 Hz). Tout est dans le navigateur, zéro fichier.

### Récompenses Channel Points

Gestion CRUD des récompenses via l'API Twitch (scope `channel:manage:redemptions`, pour les streamers Affiliate ou Partner). Le déclenchement d'actions en réaction à un échange est prévu mais pas encore livré. On assume.

### Liaison comptes viewers

Un viewer peut lier son compte Twitch à son profil Nodyx existant. Son identifiant Twitch persiste même si la connexion Twitch est rompue.

### Sécurité

Tokens chiffrés (AES-256-GCM + HKDF), webhooks EventSub signés HMAC avec URL à nonce, audit log des actions sensibles.

## Ce qui nous différencie

Un seul outil libre remplace ce qui demandait plusieurs services payants empilés.

Le streamer possède ses données et son audience. La communauté vit dans son instance Nodyx (forum, chat, vocal), pas dans un silo tiers.

Architecture multi-provider, avec une nuance importante : le code est organisé autour d'une interface `StreamerProvider`. Aujourd'hui seul Twitch est implémenté, parce que c'est notre cas d'usage principal. L'ajout d'un second provider (Owncast, PeerTube, YouTube, Kick) est identifié et spécifié, mais pas encore livré. On ne va pas dire "c'est trivial", on dit "c'est l'architecture, et le travail est cadré".

Du soin produit : le QR flouté, le générateur audio, la config sans SSH, les overlays thémés. Ce n'est pas juste des fonctions brutes.

## Ce qu'on assume honnêtement

Le Streamer Hub n'est pas parfait, et il ne prétend pas l'être.

- Dépendance à Twitch OAuth et EventSub aujourd'hui : c'est notre provider unique pour l'instant.
- Pas d'app mobile native : le deck est une web-app, et ça suffit pour notre usage.
- Channel Points : CRUD des récompenses présent, mais pas de déclenchement d'actions en live.
- Pont chat Twitch et Nodyx : si EventSub tombe, le chat Nodyx continue mais le pont est rompu. On a des métriques de santé et un diagnostic de configuration, mais pas encore d'alerte automatique "aucun event depuis 1h".
- Notifications live hors Twitch : webpush, RSS, ActivityPub ne sont pas encore là. C'est une roadmap identifiée.
- Découverte : on ne remplace pas la page "live" de Twitch. La souveraineté a un prix : pour l'instant, les viewers viennent via Twitch ou via l'URL de l'instance.

Sur la souveraineté, on ne va pas vendre du rêve impossible. La communauté et son historique vivent chez le streamer. La découverte et la monétisation restent côté Twitch tant que le streamer streame sur Twitch. Ce n'est pas "anti-Twitch", c'est "la communauté ne part pas si tu changes de plateforme".

## La vision

Aujourd'hui, c'est Twitch.

Demain, l'architecture en providers permettra d'ajouter Owncast (libre, auto-hébergé, le plus aligné), PeerTube, YouTube Live, Kick, sans réécrire le moteur.

Le combat n'est pas Nodyx contre une plateforme. C'est les silos contre la liberté du créateur.

Ce qu'on veut, c'est qu'un streamer puisse changer de plateforme sans refaire son overlay, son bot, ses commandes, son chat, et sans perdre sa communauté.

On n'y est pas encore à 100%. Mais l'architecture est posée, le chemin est tracé, et ce qui est livré aujourd'hui tient déjà la route pour des centaines d'heures de stream.

## Pour qui c'est fait

Pour les streamers qui :

- En ont marre des abonnements SaaS qui s'additionnent
- Veulent que leur communauté leur appartienne, pas à une plateforme
- Ont un VPS ou sont prêts à en prendre un (l'instance Nodyx tourne sur un simple 4 à 8 Go)
- Ne veulent pas dépendre d'un service tiers pour leurs alertes, leur bot, ou leur stream deck
- Et qui aiment l'idée que leur chat, forum et vocal partagent la même brique

## Et concrètement, comment on commence

1. On déploie Nodyx via `install.sh` (one-click VPS) ou Docker Compose
2. On va dans l'admin, on connecte Twitch (OAuth, tokens chiffrés)
3. On configure ses overlays, on copie les URLs dans OBS
4. On ouvre le Nodyx Deck sur son téléphone via le QR
5. On streame

Le reste (commandes, timers, chat bridge) se fait depuis l'interface.

Le Streamer Hub est libre, auto-hébergé, et ne vous quittera pas si vous quittez Twitch un jour.

Parce que votre communauté vous appartient.

## Comparatif

Ces outils ne sont pas mauvais, au contraire. Le problème n'est pas leur qualité, c'est l'empilement, l'abonnement, et la captivité des données.

| Fonction | Streamlabs (pro) | StreamElements | Elgato Stream Deck | Nodyx Streamer Hub |
|---|---|---|---|---|
| Alertes OBS | ✅ | ✅ | ❌ | ✅ |
| Overlays | ✅ | ✅ | ❌ | ✅ |
| Bot chat | ✅ (freemium) | ✅ | ❌ | ✅ |
| Stream deck | ❌ | ❌ | ✅ (physique, 200-400 euros) | ✅ (tactile, téléphone/tablette, inclus) |
| Retour tactile physique | ❌ | ❌ | ✅ | ❌ |
| Stats | ✅ (cloud) | ✅ (cloud) | ❌ | ✅ (locales) |
| Banque de templates et maturité | ✅ | ✅ | ✅ | en construction |
| Auto-hébergé | ❌ | ❌ | ❌ | ✅ |
| Abonnement | optionnel | optionnel | non | non |
| Chat unifié avec forum | ❌ | ❌ | ❌ | ✅ |

Sur le stream deck, soyons précis : Elgato a l'avantage des boutons physiques avec un vrai retour tactile. Nodyx Deck, lui, fonctionne sur n'importe quel téléphone ou tablette que vous possédez déjà (coût zéro, accès par QR code). Et rien ne vous empêche de dédier une vieille tablette posée sur le bureau pour en faire un stream deck tactile permanent.
