# Olympus — CDC observabilité et analyse de sécurité

> État : **proposition**, rédigée le 2026-08-17.
> Préalable bloquant : la PR #587 (identification des visiteurs) doit être déployée.

## 1. Pourquoi

Demande : « qu'il soit plus observateur, plus de détails, meilleure analyse, et nous
permettre d'avoir de véritables logs afin de nous aider à sécuriser ».

Olympus (`olympus.nodyx.org`, servi par `nodyx-hub` sur le port 7777) fonctionne. Le
problème n'est pas qu'il soit cassé, c'est qu'il **regarde peu de choses, et mal**.

### Le préalable, non négociable

Depuis le 2026-08-08, toutes les adresses de visiteurs valaient `127.0.0.1` : le tunnel
Cloudflare envoie `CF-Connecting-IP` et non `X-Forwarded-For`. Tant que #587 n'est pas
déployée, **toute analyse fine porterait sur une donnée aveugle**. Un tableau de bord
plus riche afficherait simplement une seule ligne, plus joliment.

Ce CDC suppose donc #587 livrée.

## 2. État des lieux, mesuré

### Ce qui est collecté

| table | lignes | remarque |
|---|---|---|
| `honeypot_hits` | 18 460 | **100 % enrichies** : pays, ville, FAI, organisation, agent, en-têtes complets |
| `admin_audit_log` | 1 874 | riche, **jamais affiché par Olympus** |
| `bot_signup_attempts` | 1 629 | motif de blocage, e-mail, agent, métadonnées |
| `email_bans` | 492 | |
| `community_bans` | 49 | |
| `reported_ips` | 118 → 16 après #587 | blocage fédéré entre instances |

### Ce qui est instrumenté et ne produit rien

| table | colonnes | lignes |
|---|---|---|
| `honeypot_fingerprints` | **20** | 0 |
| `honeypot_credential_attempts` | 11 | 0 |
| `honeypot_pixel_hits` | 6 | 0 |
| `honeypot_cert_reports` | 5 | 0 |

Les routes existent bien (`/_hp_login`, `/_hp_fp`, `/_hp_rtc` en POST, `/_hp_px/:id` en
GET). **Elles ne sont pas cassées** : elles exigent que l'attaquant exécute du
JavaScript ou soumette un formulaire. Les scanners automatisés, qui constituent
l'essentiel du trafic hostile observé, ne font ni l'un ni l'autre.

C'est donc un choix de conception à trancher, pas un bug à corriger.

### Ce qu'Olympus expose aujourd'hui

Cinq pages : `/security`, `/instances`, `/logs`, `/newsletter`, `/auth/login`.
La page sécurité (1063 lignes) agrège `honeypot_hits` et `reported_ips` : total, timeline
48 h, top 20 IP, top chemins, méthodes, répartition par instance.

## 3. Ce qui manque

Trois manques, par ordre de valeur.

### A. On voit des événements, pas des comportements

Le tableau liste des coups. Il ne dit pas **qui insiste**, **qui revient**, **qui
change de tactique**. Les données pour le faire sont déjà là et inexploitées :

- `user_agent` : jamais agrégé, alors qu'il sépare un scanner d'un navigateur ;
- `headers` : conservés intégralement, jamais analysés (c'est eux qui ont permis de
  récupérer 1201 adresses perdues) ;
- `isp` / `org` : présents sur les 18 460 lignes, jamais regroupés — or « 40 IP du même
  hébergeur » est un signal bien plus fort que 40 IP isolées.

### B. Aucun journal d'action, alors qu'il existe

`admin_audit_log` contient 1 874 actions d'administration et n'apparaît nulle part dans
Olympus. Pour « nous aider à sécuriser », savoir **qui a fait quoi** vaut autant que
savoir qui nous attaque.

### C. Aucune alerte, aucun seuil

Tout est passif : il faut ouvrir la page et regarder. Rien ne signale une rafale
inhabituelle, une première visite d'un réseau connu pour l'abus, ou un pic
d'inscriptions après une diffusion publique — exactement le cas du 2026-08-17, où deux
comptes sont apparus après un direct Twitch sans qu'aucun signal ne le remonte.

## 4. Proposition, en trois lots

### Lot 1 — Exploiter ce qui dort *(le meilleur rapport valeur/risque)*

Aucune collecte nouvelle, aucune donnée personnelle supplémentaire. Uniquement de
l'agrégation sur l'existant :

1. **Regroupement par réseau** : agréger par `isp` / `org` et par préfixe /24 et /48.
   Fait ressortir les campagnes distribuées que la vue par IP masque.
2. **Familles d'agents** : classer les `user_agent` (scanner connu, bibliothèque HTTP,
   navigateur, vide). Un agent absent ou exotique est un signal en soi.
3. **Profil d'attaquant** : par IP, première et dernière vue, chemins tentés dans
   l'ordre, cadence. Distingue le passage opportuniste de la reconnaissance ciblée.
4. **Journal d'administration** : exposer `admin_audit_log`, filtrable par acteur,
   action et période.
5. **Corrélation inscriptions ↔ attaques** : superposer `users.created_at` et
   `bot_signup_attempts` à l'activité du pot de miel sur la même frise. C'est
   précisément ce qui manquait le 17/08.

### Lot 2 — Alerter

6. **Seuils configurables** : rafale par IP, par réseau, par chemin. Notification par
   le canal déjà en place (`octoguard_webhook` existe, table présente).
7. **Première apparition d'un réseau** : signaler la première visite depuis un `org`
   jamais vu, plutôt que la n-ième depuis un habitué.
8. **Rapport quotidien** : un résumé écrit, pas un graphe à interpréter.

### Lot 3 — Collecter vraiment *(DÉCIDÉ le 2026-08-17)*

> **Décision du porteur du projet.** « On doit faire de l'analytique interne, mais que
> dans Olympus, pour moi, pour la sécu. Je ne veux pas me mettre une balle dans le pied
> en n'affichant rien, c'est vital pour la suite du projet. C'est comme si on
> construisait une voiture sans faire de crash test. »
>
> La distinction qui tranche : **un journal de sécurité que l'exploitant lit sur sa
> propre instance n'est pas de l'analytique de profilage.** L'un sert à défendre le
> service, l'autre à exploiter ses utilisateurs. Nodyx refuse le second, pas le premier.

Ce que ça implique concrètement, et qui manque aujourd'hui :

- **`users`** ne garde que `registration_ip`. Ajouter adresse et agent de dernière
  connexion, et l'historique des connexions (date, adresse, agent, issue). Sans ça, un
  compte compromis est indétectable et une enquête impossible — cas vécu le 17/08 avec
  `test` / `testtt`.
- **Échecs d'authentification** : aujourd'hui écrits dans un fichier texte et poussés
  sur un webhook (`auth.ts`), donc ni requêtables ni corrélables. À mettre en table.
- **Anomalies de requête** : chemins inexistants en rafale, méthodes exotiques,
  en-têtes absents — les signaux d'une reconnaissance avant exploitation.

Garde-fous qui rendent la chose tenable, et défendable :

1. **Rien ne sort de l'instance.** Aucun service tiers, aucune télémétrie vers
   nodyx.org. Une instance auto-hébergée garde ses journaux chez elle.
2. **Rétention bornée et configurable**, purge automatique. Un journal de sécurité qui
   grossit sans fin devient un passif, pas un atout — et 18 460 lignes de pot de miel
   montrent que le volume arrive vite.
3. **Visible du seul exploitant**, dans Olympus. Jamais exposé via l'API publique, jamais
   dans le fédéré (le fédéré ne transporte que des IP publiques signalées, cf. la
   contrainte `CHECK` posée en #587).
4. **Documenté dans la politique de confidentialité** de l'instance, et désactivable par
   l'administrateur qui l'auto-héberge.

### Lot 4 — Le crash test : éprouver nos propres défenses

L'image de la voiture appelle plus qu'un journal. Observer ne suffit pas : il faut
**vérifier que les protections protègent réellement**, en continu.

Ce qui aurait été attrapé aujourd'hui par un tel banc d'essai :

| protection | ce qu'un test aurait révélé |
|---|---|
| limitation de débit | **une seule clé Redis pour tout Internet** depuis le 8 août |
| pot de miel | 100 % des attaques enregistrées en `127.0.0.1` |
| blocage fédéré | 102 signalements invalides sur 118 diffusés à 4 instances |

Aucun des trois n'était visible depuis une page. Tous les trois se mesurent en une
requête.

Proposition : une page « banc d'essai » dans Olympus qui exécute, à la demande et
périodiquement, des contrôles d'intégrité sur les défenses elles-mêmes :

- deux requêtes depuis deux adresses simulées produisent-elles **deux** compteurs
  distincts ? (le contrôle qui manquait)
- une IP bannie est-elle effectivement rejetée ?
- le pot de miel enregistre-t-il une adresse publique, et non du loopback ?
- le blocage fédéré refuse-t-il une IP privée ?
- les secrets internes (`INTERNAL_API_SECRET`) sont-ils exigés là où ils doivent l'être ?

Chaque contrôle doit pouvoir **échouer** de façon visible. Un banc d'essai toujours vert
ne prouve rien : on vérifie sa capacité à détecter en le confrontant volontairement à
une configuration fautive.

### Lot 3 bis — Éléments antérieurs, conservés pour mémoire

9. **Pièges actifs** : les quatre collecteurs à zéro ne se rempliront que si un leurre
   les embarque (page de connexion factice avec le script d'empreinte). Décision à
   prendre : est-ce qu'on veut réellement empreinter, avec ce que ça implique
   juridiquement sur un service public ?
10. **`users` n'a que `registration_ip`** : ni adresse de dernière connexion, ni agent.
    Pour une enquête comme celle des comptes `test` / `testtt`, c'est une lacune. Mais
    c'est aussi de la donnée personnelle conservée : à arbitrer explicitement, en
    cohérence avec l'AGPL et le RGPD, et à documenter dans la politique de
    confidentialité.

## 5. Ce qu'on ne fait pas

- **Pas de service tiers.** Ni analytics externe, ni SIEM hébergé. Contraire à la
  promesse du projet, et une instance auto-hébergée doit fonctionner sans.
- **Pas de collecte que l'auto-hébergeur ne maîtrise pas.** Tout ce que le lot 3
  ajoute reste désactivable par l'administrateur de l'instance, borné en rétention, et
  ne quitte jamais la machine.
- **Pas de profilage.** La ligne est nette : on journalise ce qui sert à défendre le
  service, pas à caractériser ses utilisateurs.
- **Pas de rechargement de Caddy en production.** `CLAUDE.md` est explicite : la
  configuration vivante vient de `autosave.json`, un rechargement fait tomber le HTTPS.

## 6. Vérification

Chaque lot se prouve par une mesure, pas par une capture d'écran :

- lot 1 : les agrégats sont recalculables en SQL et doivent coïncider avec les totaux
  bruts (`SELECT COUNT(*)` par regroupement = total de la table) ;
- lot 2 : une rafale simulée déclenche l'alerte, et une activité normale ne la déclenche
  pas — les deux moitiés doivent être testées, sinon on livre un détecteur muet ou
  hurlant ;
- lot 3 : un test de non-régression qui **tombe** si la collecte est activée sans le
  réglage de désactivation.

## 7. Décisions attendues

1. Valide-t-on le lot 1 seul pour commencer ? *(recommandé : zéro nouvelle collecte)*
2. ~~Le lot 3 touche à la donnée personnelle : on tranche maintenant ?~~
   **Tranché le 2026-08-17 : oui, journal de sécurité interne, dans Olympus seulement.**
   Reste à fixer la durée de rétention par défaut.
3. Les alertes du lot 2 passent-elles par le webhook OctoGuard existant, ou par un
   canal dédié ?

---

# Partie II — Architecture Host/Network Security

> Ajoutée le 2026-08-17 sur proposition du porteur du projet.
> Principe retenu tel quel : **CrowdSec détecte et décide, nftables applique, Suricata
> observe le réseau, Olympus corrèle et explique.** Olympus n'est ni un pare-feu, ni un
> IDS maison. Aucun `exec()` vers le système depuis l'application.

## II.1 — Trois faits mesurés qui contraignent l'architecture

Vérifiés sur le VPS le 2026-08-17, avant toute décision.

### Fait 1 — Il n'y a PAS de tunnel Cloudflare

Aucun `cloudflared`. Le trafic arrive **en direct sur :80/:443** depuis les serveurs
Cloudflare (`cdn-loop`, `via`, `cf-connecting-ip` présents, `x-forwarded-for` absent).

### Fait 2 — Conséquence : nftables ne peut PAS bloquer un attaquant HTTP

Pour tout le trafic web, l'adresse source au niveau paquet est **toujours un serveur
Cloudflare**. Bannir `45.x.x.x` dans nftables ne bloque rien : cette adresse ne touche
jamais la carte réseau du VPS.

    attaquant 45.x.x.x
        │
        ▼
    Cloudflare edge 162.158.x.x   <- CE QUE VOIT nftables
        │
        ▼
    VPS :443

**Le plan de blocage HTTP est donc Cloudflare, pas nftables.** CrowdSec fournit
exactement ça : le *bouncer Cloudflare*, qui pousse les décisions vers l'API Cloudflare.
nftables reste l'autorité pour tout le reste.

### Fait 3 — La surface hors Cloudflare est grande, et c'est là que Suricata sert

Relevé `ufw` : refus par défaut en entrée, et ces ports ouverts sur Internet **sans
passer par Cloudflare** :

| port | service |
|---|---|
| 22/tcp | SSH |
| 3478, 5349 (UDP+TCP) | TURN |
| 7443/tcp | relais nodyx |
| 40000-40999 (UDP+TCP) | média SFU |
| 49152-65535/udp | relais média TURN |

Sur le HTTP, Suricata ne verrait que du TLS vers l'origine : valeur quasi nulle. Sur
**cette** surface, il voit le trafic réel. C'est un déplacement de son rôle, pas un
rejet : Suricata est justifié, mais pour SSH, TURN, le relais et le média — pas pour le
web.

## II.2 — Répartition des rôles, corrigée

| plan | outil | portée réelle sur CE VPS |
|---|---|---|
| détection applicative | **CrowdSec** | journaux Caddy, SSH, sudo. Voit la vraie IP si Caddy journalise `CF-Connecting-IP` |
| décision | **CrowdSec** | scénarios + réputation, durées, expiration |
| application HTTP | **bouncer Cloudflare** | seul plan capable de bloquer un attaquant web |
| application hors HTTP | **nftables** | SSH, TURN, relais, média. Politique de base + sets dynamiques |
| observation réseau | **Suricata**, en IDS seul | SSH, TURN, relais, média. **Jamais en IPS d'emblée** |
| corrélation | **Olympus** | lecture seule, aucune action système |

## II.3 — Modèle de données

Adopté tel que proposé, avec la séparation qui compte :

- `security_events` — **ce qui s'est passé**. Y entrent, normalisés : `honeypot_hits`,
  `bot_signup_attempts`, `admin_audit_log`, les échecs d'authentification, les alertes
  Suricata, les événements CrowdSec, les compteurs nftables.
- `security_decisions` — **ce que le système a décidé**. Origine, motif, durée,
  expiration, état, et **plan d'application effectif** (`cloudflare` ou `nftables`).

Ce dernier champ n'est pas cosmétique : c'est lui qui empêchera de croire qu'une IP web
est bloquée alors que nftables ne peut rien contre elle.

Les tables existantes ne sont pas remplacées, elles alimentent le modèle. Rétention
agressive sur le brut Suricata (`eve.json`), qui grossit vite ; le normalisé seul va en
PostgreSQL, via un collecteur — jamais d'écriture directe de Suricata dans la base.

## II.4 — Ce qu'on ne fait pas

Repris intégralement de la proposition, tout est retenu :

- Olympus n'appelle jamais nftables ni ne pilote Suricata.
- Suricata n'écrit pas dans la base d'Olympus : un collecteur s'interpose.
- CrowdSec ne porte pas de logique métier Nodyx.
- Pas de brut Suricata en base sans rétention agressive.
- **Et un ajout, tiré du fait 2** : ne jamais laisser croire à Suricata que
  `CF-Connecting-IP` est une adresse réseau source. Vérité paquet et vérité applicative
  sont deux colonnes distinctes, jamais fusionnées.

## II.5 — Défaut de défense en profondeur, à corriger au passage

`nodyx-core` (:3000), `demo-core` (:3001), `nodyx-server` (:3100) et Caddy (:3099)
écoutent sur `0.0.0.0`. Seul `ufw` les protège aujourd'hui. Un `ufw disable`, une règle
mal ordonnée ou une réinstallation exposerait l'API directement sur Internet.

Correctif : écouter sur `127.0.0.1`. Le pare-feu doit être la deuxième ligne, pas la
seule.

## II.6 — Ordre de déploiement

Repris de la proposition, avec les corrections des faits 2 et 3 :

1. ~~#587 — vraie IP visiteur~~ **fait le 2026-08-17**
2. Écoute sur `127.0.0.1` pour les services internes *(II.5)*
3. nftables propre — politique de base, IPv4 **et** IPv6 séparément
4. Caddy journalise `CF-Connecting-IP` — préalable à toute détection CrowdSec
5. CrowdSec + intégration nftables *(SSH, TURN, relais)*
6. **CrowdSec + bouncer Cloudflare** *(le seul plan de blocage HTTP)*
7. `security_events` normalisé dans Olympus, alimenté par l'existant
8. Collecteur CrowdSec → Olympus
9. Suricata en **IDS seul**, sur la surface hors Cloudflare
10. Collecteur Suricata → Olympus
11. Corrélation, puis crash-test automatisé
12. Suricata en IPS — **seulement** après observation des faux positifs

Suricata démarre en IDS, jamais en IPS : on veut d'abord comprendre le trafic réel du
VPS avant de laisser un moteur de signatures couper du média temps réel — sur un service
de voix, un faux positif se traduit par une coupure d'appel.

---

# Partie III — Fichiers et services à ajouter

> Écrite le 2026-08-17 après vérification sur la production. Chaque point ci-dessous
> repose sur une mesure, pas sur une lecture du dépôt : la prod diverge.

## III.0 — Quatre faits vérifiés qui commandent le plan

| vérification | résultat | conséquence |
|---|---|---|
| `cloudflared` | **absent** | pas de tunnel, trafic direct sur :80/:443 depuis les edges Cloudflare |
| journalisation Caddy | **0 handler de log** dans la config vivante | CrowdSec n'a **rien à lire** côté proxy |
| `nodyx-core` pino | actif, mais `remoteAddress: 127.0.0.1` | **les journaux du cœur sont aveugles**, même après #587 |
| `fail2ban` | **actif**, avec jails | cohabitation à trancher, pas un vestige |

### Le déblocage

Fastify sérialise `req.raw.socket.remoteAddress`, pas `request.ip`. En corrigeant le
sérialiseur pour émettre `getClientIp(request)`, les journaux du cœur deviennent la
source de CrowdSec — **et on n'a plus besoin d'activer la journalisation Caddy**, donc
plus besoin de toucher à la configuration vivante (`autosave.json`), dont le
`CLAUDE.md` rappelle qu'un rechargement fait tomber le HTTPS.

C'est la simplification la plus importante de tout ce chantier.

## III.1 — Correction du plan d'application

La proposition indique « Enforcement : CrowdSec → nftables ». C'est juste, mais partiel.
Les deux plans ont des portées **différentes et complémentaires** :

| plan | ce qu'il bloque | ce qu'il ne peut pas bloquer |
|---|---|---|
| **nftables** | attaque directe sur l'IP d'origine (contournement de Cloudflare), SSH, TURN, relais, média SFU | un attaquant web derrière Cloudflare — le paquet vient d'un edge |
| **bouncer Cloudflare** | l'attaquant web, à l'edge | tout ce qui ne passe pas par Cloudflare |

Les deux sont nécessaires. `security_decisions` doit donc porter le **plan effectif**
(`nftables` / `cloudflare`), sinon on croira une IP bloquée alors qu'elle passe.

## III.2 — Fichiers à créer, par lot

### Lot 0 — Déblocage *(petit, immédiat, dans le cœur)*

    nodyx-core/src/config/logger.ts        sérialiseurs pino : req.ip = getClientIp(),
                                           user-agent, route ; JAMAIS le corps de requête
    nodyx-core/src/index.ts                câbler `logger: buildLogger()`
    nodyx-core/src/tests/logger-ip.test.ts un test qui TOMBE si le sérialiseur
                                           réémet socket.remoteAddress

### Lot A — Modèle de données

    nodyx-core/src/migrations/114_security_events.sql
    nodyx-core/src/migrations/115_security_decisions.sql

`security_events` : `id, ts, source, event_type, severity, src_ip, src_port, dst_port,
user_id, user_agent, asn, org, country, action, correlation_id, raw_ref, metadata jsonb`.
Index sur `(src_ip, ts)` et `(source, ts)` — ce sont les deux axes d'interrogation.

`security_decisions` : `id, created_at, src_ip, source, decision, reason, duration,
expires_at, status, **enforcement_plane**`.

Les tables existantes ne sont pas remplacées : des vues d'alimentation les projettent
dans `security_events`.

### Lot B — Détection

    /etc/crowdsec/acquis.d/nodyx.yaml      acquisition des journaux PM2 du cœur
    /etc/crowdsec/parsers/s01-parse/nodyx-core.yaml   parseur du format pino
    /etc/crowdsec/scenarios/nodyx-*.yaml   scan, rafale de 404, chemins sensibles

Décision préalable : **CrowdSec remplace fail2ban, il ne s'y ajoute pas.** Deux moteurs
qui bannissent la même IP dans deux plans différents produisent des états incohérents et
un débogage pénible.

### Lot C — Application

    scripts/ops/nftables/nodyx.nft         politique de base, IPv4 et IPv6 SÉPARÉMENT,
                                           sets pour les bans dynamiques
    scripts/ops/security/bouncer-cloudflare.env   configuration du bouncer

### Lot D — Collecteur

    scripts/ops/security/collector.ts      lit décisions CrowdSec + eve.json Suricata,
                                           normalise, écrit dans security_events
    /etc/systemd/system/nodyx-security-collector.service

Suricata **n'écrit jamais** dans PostgreSQL. Rétention agressive sur `eve.json` brut.

### Lot E — Observation réseau *(après les précédents)*

    /etc/suricata/nodyx.yaml               IDS SEUL, sur la surface hors Cloudflare :
                                           22, 3478, 5349, 7443, 40000-40999, 49152-65535

Jamais en IPS d'emblée : sur un service de voix, un faux positif coupe un appel.

### Lot F — Olympus

    nodyx-hub/src/routes/security/+page.server.ts    quatre vues : Vue d'ensemble,
                                                     Attaquants, Chronologie, Tests
    nodyx-hub/src/routes/api/security/events/+server.ts
    nodyx-hub/src/routes/security/tests/+page.svelte

Olympus **lit et corrèle**. Il n'écrit aucune décision, n'appelle ni nftables ni
Suricata. Cette contrainte est architecturale, pas stylistique.

## III.3 — Défense en profondeur, au passage

`nodyx-core` (:3000), `demo-core` (:3001), `nodyx-server` (:3100) et Caddy (:3099)
écoutent sur `0.0.0.0`. Seul `ufw` les protège. Un `ufw disable` exposerait l'API
directement. Correctif : écouter sur `127.0.0.1`.

## III.4 — Pangolin, évalué

Alternative auto-hébergée au tunnel Cloudflare, alignée avec la promesse du projet
(`install_tunnel.sh` installe aujourd'hui un tunnel **Cloudflare**, service propriétaire
centralisé).

Conséquences si adopté :

- **Même piège d'identification** : Traefik pose `X-Forwarded-For`, mais le pair
  WireGuard doit entrer dans la liste des proxys de confiance, sinon retour à
  `127.0.0.1` partout.
- **Le plan d'application migre** vers le bouncer CrowdSec pour Traefik, au nœud
  Pangolin.
- **Le média ne doit pas transiter** : TURN et SFU restent en direct, latence oblige.
  Pangolin ne couvrirait que le plan web, ce que fait déjà Cloudflare.
- **Coût réel** : le nœud devient une surface qu'on exploite soi-même et un point de
  défaillance unique. Cloudflare absorbe le volumétrique ; un petit VPS non.

**Verdict : à évaluer après le crash test**, jamais avant. Une bascule de topologie est
exactement ce qui a cassé l'identification le 8 août sans que rien ne le signale pendant
dix jours. Le banc d'essai est ce qui rendrait cette migration sûre.

---

# Partie IV — ADN d'attaquant : ce qui est réellement mesurable

> Écrite le 2026-08-17. Principe retenu, et il est juste :
> **ne pas chercher l'IP cachée, chercher la continuité de l'attaquant.**
> Olympus dira « probablement la même campagne », jamais « c'est la même personne ».
> Cette nuance est technique **et** juridique.

## IV.1 — L'empreinte TLS n'est pas disponible

Vérifié sur les en-têtes réellement reçus : aucun `cf-ja3-hash`, aucun
`cf-bot-management`. Cloudflare termine le TLS et ne transmet pas l'empreinte du client
sur ce plan. Caddy ne voit que le TLS de Cloudflare.

**Le « TLS fingerprint » de l'ADN est donc inutilisable pour le HTTP.** Il ne le
deviendrait que sur la surface directe (TURN, relais, SFU), via Suricata.

## IV.2 — Ce qui le remplace avantageusement : l'empreinte d'en-têtes

Mesure sur `honeypot_hits` :

| en-tête injecté | coups | IP |
|---|---|---|
| `x-originating-ip` | 1369 | 14 |
| `x-azure-clientip` | 1369 | 14 |
| `x-azure-socketip` | 1369 | 14 |
| `x-client-ip` | 1369 | 14 |
| `true-client-ip` | 1369 | 14 |
| `x-forwared` *(avec la faute)* | 1369 | 14 |
| `x-host` | 1369 | 14 |

**Sept en-têtes, exactement le même compte : ils arrivent toujours ensemble.** C'est la
signature d'un outil unique, la faute de frappe comprise. Quatorze adresses différentes
l'utilisent : autant d'IP jetables, un seul opérateur ou un seul outillage.

Et la valeur qu'ils annoncent tous : **`127.0.0.1`**. C'est une tentative active
d'usurper l'adresse de bouclage — précisément l'attaque que #494 avait refermée sur le
limiteur de débit. 1369 tentatives.

**Conclusion : l'ensemble ordonné des en-têtes reçus est une empreinte d'outillage.**
Disponible aujourd'hui, plus stable qu'une IP, et qu'un attaquant ne peut modifier sans
changer d'outil. C'est le meilleur signal d'ADN dont on dispose, et il ne coûte aucune
collecte nouvelle : les en-têtes sont déjà stockés sur les 18 460 lignes.

Signaux d'ADN réellement disponibles, mesurés sur 30 jours :

    252 agents distincts · 289 chemins distincts · 120 organisations · 43 pays
    + l'empreinte d'en-têtes ci-dessus
    + la cadence et la séquence des chemins (déductibles de created_at)

## IV.3 — CrowdSec CTI : enrichissement, jamais oracle — et une tension à assumer

Retenu comme **contexte**, pas comme vérité. Le score local doit primer : il repose sur
ce qu'on observe réellement, la CTI sur ce que d'autres ont observé.

**Tension à trancher explicitement** : interroger la CTI, c'est envoyer l'adresse d'un
attaquant à un service tiers. C'est défendable — ce n'est pas une donnée d'utilisateur —
mais ça contredit littéralement « rien ne sort de l'instance » (§ II.4). Donc :

- **désactivé par défaut** pour un auto-hébergeur ;
- activation explicite, documentée dans la politique de confidentialité ;
- Olympus doit fonctionner **entièrement** sans, en dégradé.

## IV.4 — Le risque du score, et comment ne pas le fabriquer

Un score qui ne se décompose pas devient infalsifiable : on finit par lire dedans ce
qu'on soupçonnait déjà. Trois règles :

1. **Tout score est décomposable.** Olympus affiche les signaux contributeurs et leur
   poids, jamais un nombre seul.
2. **Le crash test vérifie les DEUX sens.** Un visiteur légitime ne doit PAS monter en
   score. Un détecteur qui ne se trompe jamais dans un seul sens n'a pas été testé.
3. **Un VPN n'est pas une infraction.** `VPN + comportement normal` reste bas.
   `VPN + pot de miel + échecs d'authentification` monte. La classification réseau est
   un facteur, jamais un verdict.

## IV.5 — Deux tests que cette mesure impose

    TEST — usurpation d'en-tête
      requête directe à l'origine + `x-originating-ip: 127.0.0.1`
      → ne doit JAMAIS devenir l'IP visiteur
      (attaque OBSERVÉE 1369 fois, ce n'est pas hypothétique)

    TEST — continuité de campagne
      deux IP, même empreinte d'en-têtes, mêmes chemins, même cadence
      → doivent être rapprochées
      deux IP, signaux différents
      → ne doivent PAS l'être
