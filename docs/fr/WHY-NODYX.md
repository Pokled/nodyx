# 🧭 Pourquoi Nodyx

> **TL;DR** Discord n'est pas l'ennemi. Les silos centralisés, oui. Nodyx existe parce qu'on pense que les communautés devraient appartenir aux gens qui les construisent, sur le matériel de leur choix. On n'est pas les seuls à le penser. Cette page est honnête sur ce que Discord a apporté, sur les paris différents qu'on a pris avec Nodyx, et sur les autres projets qui méritent ton attention. **Choisis l'outil qui te va. Le combat n'est pas entre nous.** ☕

---

## Sommaire

- [Ce que Discord a apporté](#ce-que-discord-a-apporté)
- [Pourquoi autre chose existe](#pourquoi-autre-chose-existe)
- [Les paris différents qu'on a pris avec Nodyx](#les-paris-différents-quon-a-pris-avec-nodyx)
- [Quand Nodyx n'est PAS le bon choix](#quand-nodyx-nest-pas-le-bon-choix)
- [Les autres outils de cet écosystème](#les-autres-outils-de-cet-écosystème)
- [Le vrai combat n'est pas entre nous](#le-vrai-combat-nest-pas-entre-nous)

---

## Ce que Discord a apporté

Soyons honnêtes dès le départ : Discord a mérité sa place. Plein de choses qu'on tient pour acquises aujourd'hui n'existaient simplement pas à cette qualité avant lui.

- **De la voix multi-utilisateurs low-latency qui marche.** Avant Discord, on avait Mumble (super mais technique), TeamSpeak (payant, pénible à configurer), Skype (buggué). Discord a fait du chat vocal stable une expérience un-clic. Ça seul a changé le gaming, les groupes d'études, les équipes dev, les apprenants en langues. Des millions de communautés existent aujourd'hui parce que quelqu'un a pu appuyer sur un bouton et parler avec dix amis.

- **Le serveur comme objet social.** Channels texte + voix dans la même UI, rôles, permissions, invitations. Le modèle "serveur" est tellement familier qu'on oublie à quel point c'était le bordel avant (IRC + Mumble + un forum Wordpress, tous séparés). Discord a tout cousu ensemble.

- **Mobile-first bien fait.** La plupart des outils plus anciens étaient desktop-only. Discord a sorti une app mobile que tu avais vraiment envie d'utiliser, et ça a ouvert la plateforme à des gens qui ne sont pas devant un bureau.

- **Un écosystème de bots.** Musique, modération, sondages, mini-jeux, intégrations custom. Discord a rendu l'ajout de bots assez simple pour que des non-devs s'y mettent, ce qui a fait naître toute une économie d'outils.

- **Le gratuit par défaut.** Pas de paywall pour démarrer une communauté. Quoi qu'on pense de Nitro, l'expérience de base est vraiment gratuite.

Cette page n'est pas une descente en flèche. Discord mérite le crédit pour avoir démocratisé beaucoup de choses. **Si Discord te va, à toi et à tes potes : continue. Sérieusement.**

---

## Pourquoi autre chose existe

Donc si Discord a tellement bien fait, pourquoi construire autre chose ?

Parce que construire une communauté sur Discord (ou Slack, ou n'importe quelle plateforme fermée) veut dire que cette communauté ne t'appartient pas. La plateforme la possède. Et voilà ce qu'on a vu se passer sur le web ces dix dernières années :

- **Les forums sont morts.** Des communautés de fans vieilles de décennies, des sites de Q&A technique, des clubs de jardinage, des fandoms de niche. La plupart ont migré sur Discord et ont disparu des moteurs de recherche, des archives, du web ouvert.
- **IRC est mort.** Un protocole qui a fait tourner l'underground d'internet pendant 30 ans. Aujourd'hui, surtout des channels vides et quelques irréductibles.
- **Les mailing lists ont été capturées par Slack.** Toute cette mémoire institutionnelle est maintenant derrière un paywall avec une rétention de 90 jours sur le tier gratuit.

Ce n'est pas spécifiquement la faute de Discord. C'est ce qui arrive quand une génération d'utilisateurs oublie que **l'infrastructure décentralisée existe**. Les grandes plateformes ne sont pas des méchants, ce sont juste des défauts qui ont gagné. Mais on a le droit de questionner les défauts.

Nodyx fait partie de plein de projets qui posent la même question : *et si une communauté pouvait se posséder elle-même à nouveau ?*

---

## Les paris différents qu'on a pris avec Nodyx

Pas "Discord est mauvais, voilà pourquoi on est mieux". Juste les choix qu'on a faits :

- **Une instance = une communauté.** Ton serveur, ton matériel (ou ton VPS), tes données. Si on disparaît demain, ton instance continue de tourner. Pour toujours.
- **Forum + chat + voice + canvas + homepage builder, dans un seul outil.** Une communauté ce n'est pas juste un chat. Ça a besoin de fils persistants (forum), de chat temps réel, de voix, d'un canvas collaboratif, et d'une page d'accueil publique. On regroupe tout ça pour que tu n'aies pas à coudre cinq outils ensemble.
- **Un relay P2P pour passer le NAT.** Lance Nodyx sur un Raspberry Pi derrière ta box, sans port forwarding, sans compte Cloudflare requis. Notre relay est un service Rust qui perce le NAT pour toi, en option.
- **Des modules que tu actives, pas des fonctionnalités balancées par-dessus.** Active le wiki, le calendrier d'évènements, le jukebox, le canvas, seulement quand ta communauté en a besoin. Style CMS, pas du feature-bloat.
- **Une réputation auditable.** Les scores de réputation sont calculés à partir d'actions on-chain (enfin, on-server). Le calcul est ouvert, l'historique est visible. Pas d'algo mystère.
- **DMs chiffrés bout en bout par défaut.** ECDH pour l'échange de clés + AES-256-GCM. Tes DMs sont illisibles même pour l'admin de ton instance.
- **Reconnaissance publique des contributeurs.** Chaque PR externe est créditée dans le README et dans `CONTRIBUTORS.md`. On appelle ça les Nodyx Stars. Les gens qui aident à construire ça méritent d'être visibles.

Ce sont des paris. Certains vieilliront bien. D'autres pas. On sera honnêtes au fil de l'eau.

---

## Quand Nodyx n'est PAS le bon choix

On te doit cette section. Si on ne l'écrit pas, quelqu'un d'autre le fera (et il sera moins gentil).

- **Vous êtes 12 potes qui jouent à Fortnite.** Discord est très bien. Vraiment. Le coût d'auto-héberger ne vaut pas le coup pour un groupe fermé de copains. Ne migre pas juste parce qu'on existe.
- **Tu as besoin de certifications enterprise compliance dès aujourd'hui.** Mattermost ou Rocket.Chat sont bien plus matures là-dessus. SOC2, HIPAA, audits signés, tout ce monde-là. Nodyx a quelques mois.
- **Tu veux des bridges vers tous les protocoles existants.** Matrix est la bonne réponse. Leur écosystème de bridges connecte Discord, Slack, Telegram, IRC, XMPP, Signal, et plus. Nodyx se concentre sur être son propre truc, pas un hub-de-hubs.
- **Tu veux une UI qui ressemble exactement à Discord.** Stoat (anciennement Revolt) et Fluxer s'en rapprochent visuellement plus. Nodyx est community-first, pas chat-first, donc l'UI met les forums, les threads, et le homepage builder en avant.
- **Tu veux un app store géant de bots publics.** Discord a 10 ans d'avance là-dessus.
- **Tu n'as pas ~5€/mois pour un VPS, et tu n'as pas de homelab.** L'auto-hébergement a un coût plancher. Si tu n'as ni l'un ni l'autre, [Nodyx Relay](RELAY.md) (`*.nodyx.org`) peut convenir, mais c'est encore notre infrastructure, pas la tienne.

Si l'un de ces cas est le tien : choisis l'outil qui colle. On n'est pas vexés.

---

## Les autres outils de cet écosystème

On doit une reconnaissance sincère à chaque projet qui bosse sur ce problème. Voici la liste comme on la conseillerait à un pote qui demanderait. Pas de hiérarchie, pas de "le meilleur de", pas de cadre "concurrent". Juste l'écosystème.

### Les poids lourds décentralisés

**[Matrix](https://matrix.org)** — `github.com/matrix-org` / Client Element : [github.com/element-hq/element-web](https://github.com/element-hq/element-web)
Le protocole ouvert le plus mature de cet espace. Fédéré comme l'email, chiffré bout en bout, avec des bridges vers presque tout. Si tu veux un maximum d'interopérabilité et un pari long terme sur un vrai protocole, commence ici.

### Les clones Discord

**[Stoat](https://github.com/stoatchat/self-hosted)** (anciennement Revolt)
Le visuel le plus proche de Discord. Construit en Rust, complètement open source, auto-hébergeable. Le meilleur choix si tu veux migrer une communauté Discord-native avec un minimum de friction.

**[Spacebar](https://github.com/spacebarchat/server)**
Une réimplémentation complète de l'API Discord. Les mods existants du client Discord fonctionnent souvent dessus. Excellent pour les communautés techniques qui veulent de la compatibilité.

**[Fluxer](https://fluxer.app/)** — [github.com/fluxerapp/fluxer](https://github.com/fluxerapp/fluxer)
Nouvel arrivant, qui prend du terrain rapidement. Customisation forte, support humain, et une communauté active d'utilisateurs qui testent au quotidien. À surveiller.

**[Haven](https://github.com/ancsemi/Haven)**
Chat orienté privacy. Auto-hébergé, pas de cloud, pas de télémétrie. Clients desktop et Android natifs. Pour les gens qui veulent que zéro donnée quitte leur machine.

### D'autres approches qu'il faut connaître

**[Rocket.Chat](https://github.com/RocketChat/Rocket.Chat)**
Plateforme open source mature avec audio, vidéo, partage d'écran. Aussi bonne pour les communautés que pour les entreprises.

**[Mattermost](https://github.com/mattermost/mattermost)**
L'alternative à Slack que les gens déploient vraiment en production. Auto-hébergeable, enterprise-ready, super éprouvée.

**[Discourse](https://github.com/discourse/discourse)**
Forum nouvelle génération. Pas du chat temps réel, mais inégalé pour les conversations structurées, archivables, et les bases de connaissances.

**[Zulip](https://github.com/zulip/zulip)**
Le chat threadé pris au sérieux. Les streams + topics rendent les longues conversations async réellement navigables. Très utilisé en recherche et chez les équipes dev.

**[Peersuite](https://github.com/openconstruct/peersuite)**
Approche P2P audacieuse. Aucun serveur central du tout, chiffré bout en bout. Plus jeune mais intéressant si le pur peer-to-peer est ce que tu cherches.

Si on a oublié ton préféré : ouvre une PR sur cette page. Sincèrement.

---

## Le vrai combat n'est pas entre nous

La question n'est pas "Nodyx vs Matrix" ni "Fluxer vs Stoat". La question est : *est-ce que tu possèdes ta communauté, ou est-ce qu'une boîte du Delaware la possède* ?

Chaque personne qui quitte un silo fermé pour une alternative ouverte est une victoire, peu importe quelle alternative. Si quelqu'un lit cette page et choisit Matrix parce que Matrix lui va mieux : **bien**. Si Discord change ses pratiques parce que les alternatives ouvertes créent une vraie pression : **encore mieux**. On est tous dans la même équipe sans le savoir.

> « Je ne crois pas à la guéguerre. Chacun apporte sa pierre. Si toi aussi tu veux participer à une alternative, même modestement, viens jeter un œil. Et si tu préfères une autre solution, très bien aussi. L'important, c'est qu'on arrête de se faire enfermer. Soutenons-nous les uns les autres. »
>
> *— Extrait d'un [thread Reddit sur les alternatives à Discord](https://www.reddit.com/r/BannedFromDiscord/comments/1swnq9b/), d'où cette page est partie.*

---

## Voir aussi

- [Le manifeste Nodyx](MANIFESTO.md) — le cadre philosophique complet
- [Guide d'installation](INSTALL.md) — si tu décides de tenter
- [Vue d'ensemble de l'architecture](ARCHITECTURE.md) — ce qu'il y a sous le capot
- [Roadmap](ROADMAP.md) — où on va

---

<div align="center">
  <em>Choisis l'outil qui te va. On t'applaudira dans les deux cas.</em>
</div>
