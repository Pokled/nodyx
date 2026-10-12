<div align="center">

<img src="https://nodyx.org/uploads/assets/36644490ed9ac75ec1fb64b027c8cade8c1d0673e695b29d2bc0492102173d8f.webp" alt="Nodyx" width="80"/>

# Nodyx

### *« Le réseau, c'est les gens. »*

**La plateforme communautaire auto-hébergée qui vous appartient vraiment.**<br/>
Forum, chat, vocal, canvas et votre propre page d'accueil. Une installation, sur votre serveur, pour une communauté.

[![Version](https://img.shields.io/github/v/release/Pokled/nodyx?label=version&color=7c3aed)](https://github.com/Pokled/nodyx/releases/latest)
[![Licence : AGPL-3.0](https://img.shields.io/badge/Licence-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml)
[![Traduit en direct](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodyx.org%2Ftranslate%2Fprogress.json&query=%24.overallPct&suffix=%25&label=traduit%20en%20direct&color=6d76f5)](https://nodyx.org/translate)
[![Instances fédérées](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodyx.org%2Fapi%2Fdirectory&query=%24.instances.length&label=instances%20f%C3%A9d%C3%A9r%C3%A9es&color=2ece93)](https://nodyx.org/discover)

[![Démo en ligne](https://img.shields.io/badge/D%C3%A9mo-nodyx.org-6d76f5?style=flat-square)](https://nodyx.org)
[![Documentation](https://img.shields.io/badge/Documentation-nodyx.dev-6d76f5?style=flat-square)](https://nodyx.dev)
[![Découvrir](https://img.shields.io/badge/D%C3%A9couvrir-start.nodyx.org-6d76f5?style=flat-square)](https://start.nodyx.org)
[![English](https://img.shields.io/badge/EN-English-12131b?style=flat-square)](https://github.com/Pokled/nodyx/blob/main/README.md)
[![Español](https://img.shields.io/badge/ES-Espa%C3%B1ol-12131b?style=flat-square)](../es/README.md)

<br/>

<img src="../img/vitrine/home.webp" alt="La page d'accueil d'une communauté Nodyx : articles à la une, dernières discussions, mise en page magazine" width="900"/>

<sub>nodyx.org, la communauté du projet, qui tourne avec le même Nodyx que celui que vous installez.</sub>

</div>

---

## Ce que c'est

Nodyx donne à une communauté une maison qui lui appartient. On y trouve un forum que les moteurs de recherche savent lire, un chat en temps réel, des salons vocaux avec partage d'écran, un canvas collaboratif, des événements, des sondages, et une page d'accueil publique que vous composez par glisser-déposer. Le tout tourne sur un serveur que vous contrôlez, du petit VPS au Raspberry Pi posé derrière votre box.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Pas de Docker, pas de compte cloud, pas besoin de nom de domaine. L'installeur prépare tout et vous remet un compte administrateur quelques minutes plus tard.

> **Avant d'aller plus loin.** Nodyx n'est pas là pour combattre Discord, et ce n'est pas la seule alternative libre. Matrix, Discourse, Stoat, Fluxer, Mattermost, Rocket.Chat, Haven et d'autres sont de beaux projets, et nous les présentons sur une page écrite par nous : **[Pourquoi Nodyx, et les alternatives que nous respectons](https://nodyx.dev/why-nodyx)**. Le combat n'est pas entre nous. Il est entre les silos fermés et les communautés qui s'appartiennent.

---

## Le tour du propriétaire

### Se parler, comme votre communauté se parle vraiment

<img src="../img/vitrine/forum.webp" alt="Le forum Nodyx : catégories, sous-forums, dernier message de chaque catégorie, statistiques et activité récente" width="900"/>

Un vrai forum, avec ses catégories, ses sous-forums et le dernier message de chacun : on voit d'un coup d'œil où se trouve la vie. Chaque sujet a une adresse publique propre, des données structurées et sa place dans le plan du site. Ce que votre communauté écrit se retrouve, par les moteurs de recherche comme par le prochain arrivant. À côté, un chat en temps réel avec réponses, réactions et messages épinglés, des messages privés chiffrés de bout en bout, et des salons vocaux avec partage d'écran.

<img src="../img/vitrine/voice-screenshare.webp" alt="Un salon vocal avec le partage d'écran de Blender en direct sur le Nodyx Stage" width="900"/>

Le partage d'écran s'ouvre sur le **Nodyx Stage**, en plein écran ou en fenêtre flottante, et quiconque rejoint le salon en cours de partage le voit aussitôt.

### Faire des choses ensemble

<table>
  <tr>
    <td width="50%"><img src="../img/vitrine/canvas.webp" alt="NodyxCanvas : un tableau collaboratif avec cadres, notes, hexagones et connecteurs"/></td>
    <td width="50%"><img src="../img/vitrine/tasks.webp" alt="Un tableau de tâches en colonnes : à faire, en cours, terminé"/></td>
  </tr>
  <tr>
    <td><b>NodyxCanvas.</b> Un tableau blanc partagé : cadres, notes, formes, connecteurs, images. Tout le monde dessine en même temps, tout est sauvegardé.</td>
    <td><b>Tableaux de tâches.</b> Préparer une sortie, un tournoi ou une rencontre en colonnes, avec priorités et échéances.</td>
  </tr>
  <tr>
    <td width="50%"><img src="../img/vitrine/calendar.webp" alt="Le calendrier de la communauté avec trois événements à venir"/></td>
    <td width="50%"><img src="../img/vitrine/polls.webp" alt="Un sondage sur le sujet du prochain atelier"/></td>
  </tr>
  <tr>
    <td><b>Événements.</b> Soirées jeux, ateliers, sorties de version, avec un lieu, une carte et des inscriptions.</td>
    <td><b>Sondages.</b> Choix, classement ou planning, avec les résultats en direct.</td>
  </tr>
</table>

### Votre vitrine, à votre façon

<img src="../img/vitrine/homepage-builder.webp" alt="L'éditeur de page d'accueil : la structure de la page à gauche, l'aperçu en direct à droite" width="900"/>

La page d'accueil se compose comme vous l'entendez : des lignes et des colonnes sur une grille de 12, des widgets intégrés, un brouillon que vous seul voyez jusqu'à la publication, et un aperçu sur ordinateur, tablette et mobile. Il vous manque quelque chose ? Le **SDK d'extensions** permet à n'importe qui de créer un widget ou un jeu en JavaScript simple, et [extensions.nodyx.org](https://extensions.nodyx.org) l'installe en un clic. Une extension tourne isolée : elle ne voit jamais les vrais comptes, son stockage est cloisonné, son accès au réseau passe par un proxy qui la surveille.

<table>
  <tr>
    <td width="50%"><img src="../img/vitrine/appearance.webp" alt="Les réglages d'apparence : ambiances toutes prêtes comme Matrix, Cyberpunk, Gazette ou Océan, avec un aperçu en sombre et en clair"/></td>
    <td width="50%"><img src="../img/vitrine/home-light.webp" alt="La même page d'accueil avec l'interface claire"/></td>
  </tr>
  <tr>
    <td><b>Ambiances.</b> Quatorze ambiances toutes prêtes, ou vos propres couleurs. Le contraste est vérifié pour vous, et les membres ne voient rien tant que vous n'avez pas publié.</td>
    <td><b>Clair ou sombre.</b> Chaque membre choisit, l'identité de la communauté reste.</td>
  </tr>
</table>

### Fait par des gens, pour des gens

<table>
  <tr>
    <td width="50%"><img src="../img/vitrine/translate.webp" alt="La page de traduction : huit langues, leur avancement, les contributeurs"/></td>
    <td width="50%"><img src="../img/vitrine/profile.webp" alt="Un profil de membre avec niveau, réputation et centres d'intérêt"/></td>
  </tr>
  <tr>
    <td><b>Huit langues, traduites par la communauté.</b> Chaque langue tient dans un simple fichier texte : pas de compte, pas d'outil, aucune plateforme au milieu. <a href="https://nodyx.org/translate">L'état de chacune, en direct.</a></td>
    <td><b>Des profils qui racontent quelque chose.</b> Niveau, réputation, centres d'intérêt, présence : un membre est plus qu'un pseudo.</td>
  </tr>
</table>

### Et le reste de la maison

- **Un serveur à la maison, sans ouvrir de port.** Le relais Nodyx, écrit en Rust, donne une adresse publique à votre instance (`votreclub.nodyx.org`) avec des connexions sortantes seulement. Le site, le chat et le vocal à quelques-uns fonctionnent derrière une box. Les grands salons vocaux passent par un serveur de diffusion (SFU) qui doit encore être joignable depuis Internet ; le faire fonctionner derrière une box aussi, c'est le prochain grand chantier.
- **Un vocal qui tient la charge.** Les petits salons se parlent de pair à pair. Quand un salon grossit ou que quelqu'un partage son écran, il bascule sur le SFU de votre propre serveur : un seul envoi par personne qui parle, quelle que soit la taille de l'auditoire.
- **Des jeux dans le salon vocal.** Les activités s'installent directement dans un salon, pour jouer ensemble sans raccrocher.
- **Un réseau de communautés.** Chaque instance peut figurer dans un annuaire commun et être cherchée depuis les autres, sans aucun compte central.
- **Streamer Hub.** Soundboard avec file d'attente des spectateurs, stream deck sur mobile, sept overlays OBS, chat Twitch intégré. [Le guide, en anglais](../en/STREAMER-HUB.md)
- **Bibliothèque, musique, wiki, jardin à idées.** Cadres, badges et bannières partagés par les membres, une vitrine musicale publique, un wiki, et un jardin où les idées grandissent avec les votes de la communauté.
- **Des outils de modération.** Rôles et grades, journal de modération, bannissement de comptes et d'adresses, et OctoGuard, un automodérateur optionnel (filtres de mots, de liens et d'inondation, messages de bienvenue, commandes maison), dont chaque réglage est désactivé par défaut.

---

## Chaque projet a son terrain

Le paysage des outils communautaires n'est pas un champ de bataille. Chaque projet optimise autre chose, et le bon choix dépend de ce que vous construisez. Voici comment nous le dirions à un ami :

| Projet | Ce qu'il fait le mieux | Quand le choisir |
|---|---|---|
| **Discord** | Vocal et chat en temps réel pour des groupes fermés, pensé mobile, un immense écosystème de bots | Votre communauté est privée et informelle |
| **Matrix** ([Element](https://github.com/element-hq/element-web)) | Un protocole fédéré avec des passerelles vers presque tout | L'interopérabilité n'est pas négociable |
| **[Discourse](https://github.com/discourse/discourse)** | Des forums et bases de connaissances indexés et cherchables | La discussion de fond est votre cœur |
| **[Mattermost](https://github.com/mattermost/mattermost)** / **[Rocket.Chat](https://github.com/RocketChat/Rocket.Chat)** | Conformité entreprise, remplaçant de Slack à grande échelle | Vous avez un service achats |
| **[Haven](https://github.com/ancsemi/Haven)** | Chat centré sur la vie privée, clients natifs, aucune télémétrie | Chaque octet doit rester sur votre machine |
| **[Stoat](https://github.com/stoatchat/self-hosted)** / **[Fluxer](https://github.com/fluxerapp/fluxer)** | Une interface à la Discord, migration facile | Vos membres connaissent déjà Discord |
| **Lemmy** | Forums fédérés en fils, façon Reddit | Vous voulez une présence native dans le fédivers |
| **Nodyx** | Forum, chat, vocal, canvas et page d'accueil en une installation, avec un relais pour les serveurs à la maison | Vous voulez posséder une communauté aux formats multiples, sur votre propre matériel |

Si vous n'avez besoin que d'un ou deux de ces formats, un autre outil du tableau vous ira peut-être mieux. [Notre avis honnête, alternatives comprises.](./WHY-NODYX.md)

---

## Sécurité

S'auto-héberger, c'est prendre en charge la sécurité de sa communauté. Nodyx est conçu pour rendre cette charge plus légère.

| Surface | Comment c'est traité |
|---|---|
| Mots de passe | Argon2id avec les paramètres de l'OWASP, anciens hachages bcrypt migrés sans rien demander |
| Messages privés | Chiffrés de bout en bout (ECDH P-256 et AES-256-GCM). Les clés ne quittent jamais le navigateur, le serveur ne stocke que du chiffré |
| Double authentification | Applications TOTP, ou Nodyx Signet, une application de connexion sans mot de passe (ECDSA P-256) |
| Chaque entrée | Validée par un schéma, requêtes SQL paramétrées uniquement |
| Chaque réponse | CSP, HSTS, protection contre l'encadrement, HTML assaini |
| Limitation de débit | Calculée sur la vraie adresse du visiteur, derrière Cloudflare, Caddy ou un tunnel |
| Sauvegardes | Prouvées chaque nuit par une restauration automatique, pas seulement copiées |

Vous avez trouvé une faille ? **N'ouvrez pas de ticket public, s'il vous plaît.** Écrivez à `security@nodyx.org` ou passez par les [alertes privées de GitHub](https://github.com/Pokled/nodyx/security/advisories/new). Réponse sous 48 heures, évaluation sous 7 jours, et votre nom dans les notes de version si vous le souhaitez. [La politique de sécurité complète](https://github.com/Pokled/nodyx/blob/main/.github/SECURITY.md)

---

## Installer

Il vous faut une machine sous **Ubuntu 22.04 / 24.04** ou **Debian 11 / 12 / 13** (64 bits, ARM64 compris : un Raspberry Pi 4 ou 5 convient), et `curl`.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

L'installeur vous demande comment votre instance sera jointe :

| Mode | Ce qu'il vous faut | Ce que vous obtenez |
|---|---|---|
| **Relais Nodyx** (recommandé) | Rien, des connexions sortantes seulement | `votreclub.nodyx.org`, même derrière une box |
| **Votre propre domaine** | Un nom de domaine et les ports 80/443 ouverts | HTTPS avec Let's Encrypt, contrôle total |
| **sslip.io** | Les ports 80/443 ouverts, sans domaine | Une adresse automatique et gratuite |

Déjà derrière un tunnel ? `install_tunnel.sh` gère **Cloudflare Tunnel**, **Pangolin** et les tunnels maison (frp, rathole, votre propre proxy inverse).

L'installeur met en place Node.js, PostgreSQL, Redis, Caddy, PM2 et le relais vocal en Rust, génère tous les secrets, applique les migrations de la base et crée votre compte administrateur. Il sait aussi travailler sans surveillance (`--yes`, `--network=relay`, `--admin-password-file`).

Une fois installé :

```bash
sudo nodyx-update    # passer à la dernière version, base sauvegardée d'abord
sudo nodyx-doctor    # vérifier que chaque service va bien
sudo nodyx-recover   # retrouver l'accès à un compte administrateur perdu
```

[Le guide d'installation complet](./INSTALL.md) · [Installer derrière un tunnel](./INSTALL-TUNNEL.md)

---

## Sous le capot

| Couche | Technologie |
|---|---|
| API | TypeScript, Fastify 5, Socket.IO (`nodyx-core/`) |
| Application web | SvelteKit 5, Tailwind 4, éditeur TipTap (`nodyx-frontend/`) |
| Données | PostgreSQL 16 avec recherche plein texte, Redis 7 pour les sessions et la présence, 125 migrations appliquées automatiquement au démarrage |
| Vocal | WebRTC de pair à pair pour les petits salons, un SFU sur votre serveur pour les grands et le partage d'écran |
| Réseau | `nodyx-relay` (serveurs à la maison sans port ouvert) et `nodyx-turn` (STUN/TURN), tous deux en Rust (`nodyx-p2p/`) |
| Connexion sans mot de passe | Nodyx Signet, une application ECDSA P-256 (`nodyx-authenticator/`) |
| Processus et proxy | PM2 sous un utilisateur `nodyx` dédié, Caddy avec HTTPS automatique |

<details>
<summary>L'organisation du dépôt</summary>

```
nodyx/
├── nodyx-core/          API, Socket.IO, migrations de la base
├── nodyx-frontend/      application web SvelteKit
├── nodyx-p2p/           Rust : relais et serveur TURN
├── nodyx-authenticator/ Nodyx Signet, connexion sans mot de passe
├── nodyx-docs/          nodyx.dev, le site de documentation
├── nodyx-landing/       start.nodyx.org
├── docs/                documentation Markdown (EN, FR, ES)
├── install.sh           installeur (relais, domaine propre, sslip.io)
└── install_tunnel.sh    installeur derrière Cloudflare Tunnel, Pangolin ou votre tunnel
```

</details>

<details>
<summary>Comment les instances se trouvent</summary>

Chaque instance peut s'inscrire dans un annuaire commun et y partager régulièrement sa carte publique : nom, adresse, nombre de membres. La page `/discover` de n'importe quelle instance cherche dans les sujets et les événements publics des autres. Il n'y a pas de compte global ni de dépendance à ActivityPub : le protocole est volontairement petit, et une instance qui quitte l'annuaire continue de fonctionner exactement pareil.

</details>

---

## Où ça va

Nodyx est né le 18 février 2026 et a livré douze versions depuis : les fondations forum, chat et vocal, les messages chiffrés de bout en bout, le constructeur de page d'accueil et sa place de marché d'extensions, les jeux dans les salons vocaux, le Streamer Hub, les sauvegardes vérifiées, le SFU en Rust pour le vocal et le partage d'écran. La prochaine grande étape : faire fonctionner les grands salons vocaux depuis un serveur à la maison, pour qu'aucun administrateur de Nodyx n'ait jamais à ouvrir un port.

[Journal des versions](https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md) · [Feuille de route](./ROADMAP.md) · [Manifeste](./MANIFESTO.md)

---

## Contribuer

Nodyx appartient à sa communauté. Lisez [CONTRIBUTING.md](./CONTRIBUTING.md), parcourez les [tickets](https://github.com/Pokled/Nodyx/issues) ou lancez une [discussion](https://github.com/Pokled/Nodyx/discussions). La documentation et les idées (`docs/`, `docs/ideas/`) sont ouvertes à tous sans demander ; une modification du cœur commence par un ticket.

**Traduire Nodyx.** Le français et l'anglais sont complets, le portugais du Brésil presque, et cinq autres langues sont en route. Choisissez la vôtre sur [nodyx.org/translate](https://nodyx.org/translate), complétez les lignes manquantes d'un fichier JSON, ouvrez une pull request. La CI vérifie chaque variable, une traduction ne peut pas casser l'application.

### Les Nodyx Stars

Chaque contribution extérieure vaut une étoile, et chaque étoile entre dans [notre galerie des contributeurs](https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md), avec son histoire. L'open source sans reconnaissance, c'est du travail gratuit, et ce n'est pas notre façon de faire.

<table>
  <tr>
    <td align="center" width="140">
      <a href="https://github.com/Pranto2003"><img src="https://github.com/Pranto2003.png?size=80" width="64" height="64" alt="Pranto"/></a><br/>
      <b>Pranto Goswamee</b><br/><sub>🌟 Premier contributeur</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/waazaa-fr"><img src="https://github.com/waazaa-fr.png?size=80" width="64" height="64" alt="waazaa-fr"/></a><br/>
      <b>waazaa-fr</b><br/><sub>🌟🌟 Bugs de l'installeur</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/naranco66"><img src="https://github.com/naranco66.png?size=80" width="64" height="64" alt="naranco66"/></a><br/>
      <b>naranco66</b><br/><sub>🌟🌟🌟 Espagnol (es-ES)</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/forke24x7"><img src="https://github.com/forke24x7.png?size=80" width="64" height="64" alt="forke24x7"/></a><br/>
      <b>forke24x7</b><br/><sub>🌟🌟🌟🌟🌟 Allemand (de)</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/lukasMega"><img src="https://github.com/lukasMega.png?size=80" width="64" height="64" alt="Lukáš Melega"/></a><br/>
      <b>Lukáš Melega</b><br/><sub>🌟🌟 Recherche dans la doc</sub>
    </td>
  </tr>
</table>

[Toutes les histoires, tous les contributeurs](https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md)

---

## Soutenir Nodyx

Nodyx est construit par un seul développeur, sans investisseur et sans condition. S'il vous est utile, une étoile aide d'autres à le trouver, et [Ko-fi](https://ko-fi.com/Pokled) aide à payer les serveurs.

<a href="https://ko-fi.com/Pokled"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Soutenir sur Ko-fi"/></a>

---

## Licence

**AGPL-3.0.** Si vous faites tourner un Nodyx modifié pour d'autres, même à travers le réseau, vos modifications restent ouvertes. Et si Nodyx trahissait un jour ses principes, cette licence permet à n'importe qui de le reprendre et de continuer dans l'esprit du [Manifeste](./MANIFESTO.md).

<div align="center">
  <br/>
  <p><em>Né le 18 février 2026.</em></p>
  <p><strong>« Forkez-nous si on vous trahit. »</strong></p>
</div>
