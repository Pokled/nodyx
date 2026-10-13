# Installer Nodyx

Une commande, quelques questions, et votre communauté a une maison. Ce guide vous accompagne du choix de la machine jusqu'à votre première soirée avec vos membres.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

C'est vraiment tout. La suite de cette page explique ce qui se passe, les choix qu'on vous propose, et quoi faire si quelque chose coince.

---

## En bref

| Étape | Ce que vous faites | Durée |
|---|---|---|
| 1. Une machine | Un petit VPS, un Raspberry Pi, un vieux portable | 10 minutes pour en louer un |
| 2. La commande | Lancer la ligne ci-dessus en root | Quelques secondes |
| 3. Les questions | Le nom, le compte administrateur, comment on vous rejoint | Environ 2 minutes |
| 4. L'attente | L'installeur construit et démarre tout | Quelques minutes, plus sur un Raspberry Pi |
| 5. Votre communauté | Vous connecter, choisir une ambiance, inviter du monde | Autant que vous voudrez |

---

## 1. Choisir une machine

Nodyx tourne sur **Ubuntu 22.04 ou 24.04**, ou **Debian 11, 12 ou 13**, en 64 bits (x86 ou ARM64). Il vous faut `curl` et un accès root (`sudo` n'est même pas nécessaire).

| Machine | Mémoire | Pour qui |
|---|---|---|
| Raspberry Pi 4 ou 5, vieux portable | 1 à 2 Go | Une petite communauté, à la maison |
| Petit VPS | 2 à 4 Go | La plupart des communautés |
| VPS plus costaud | 4 Go et plus | Des salons vocaux animés, beaucoup de membres |

Sous 1,5 Go de mémoire, l'installeur passe tout seul en mode économique : des limites de mémoire réduites, et un fichier d'échange s'il n'y en a pas assez. Sur un Raspberry Pi, prenez un système **64 bits** (Raspberry Pi OS 64 bits ou Ubuntu ARM64).

> **Astuce.** Un serveur neuf, c'est le plus simple. Nodyx installe son propre serveur web (Caddy), sa base de données (PostgreSQL) et son cache (Redis) ; si un serveur web comme nginx ou Apache tourne déjà sur la machine, l'installeur vous prévient et vous demande avant de toucher à quoi que ce soit.

---

## 2. Comment on vous rejoint

C'est le seul vrai choix. L'installeur vous le pose, mais autant connaître la réponse avant de commencer.

| Si... | Choisissez | Vous obtenez |
|---|---|---|
| La machine est chez vous, derrière une box | **Relais Nodyx** (recommandé) | `votreclub.nodyx.org`, aucun port à ouvrir, aucun domaine à acheter |
| Vous avez un domaine et un serveur avec les ports 80 et 443 ouverts | **Votre propre domaine** | `votrecommunaute.fr`, HTTPS par Let's Encrypt, contrôle total |
| Les ports 80 et 443 sont ouverts mais vous n'avez pas de domaine | **sslip.io** | Une adresse automatique et gratuite, tirée de votre IP |
| Vous utilisez déjà Cloudflare Tunnel ou Pangolin | L'**installeur tunnel** | Votre domaine, par votre tunnel, aucun port ouvert |

Le **relais Nodyx**, écrit en Rust, relie votre serveur au relais par des connexions sortantes seulement : rien à régler sur votre box. Le site, le chat et le vocal à quelques-uns fonctionnent. Les grands salons vocaux et le partage d'écran devant beaucoup de monde passent par un serveur de diffusion (SFU) qui doit encore être joignable depuis Internet ; le faire fonctionner depuis la maison aussi, c'est le prochain grand chantier de la feuille de route.

Pour un tunnel, suivez plutôt le guide dédié : **[Installer derrière un tunnel](./INSTALL-TUNNEL.md)**.

---

## 3. Lancer l'installeur

En root, ou avec `sudo` :

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Vous préférez lire le script avant ? Clonez le dépôt et lancez-le depuis là :

```bash
git clone https://github.com/Pokled/nodyx.git
cd nodyx
sudo bash install.sh
```

### Les questions qu'il pose

| Question | Quoi répondre |
|---|---|
| Nom de la communauté | Ce que verront vos membres, par exemple *Les Oiseaux de nuit* |
| Identifiant (slug) | Court, en minuscules, utilisé dans les adresses, par exemple `oiseaux`. En mode relais il devient `oiseaux.nodyx.org`, et l'installeur vérifie qu'il est libre avant d'aller plus loin |
| Langue, description, pays | La langue de la communauté ; description et pays sont facultatifs, Entrée pour passer |
| Mode réseau | Relais, votre propre domaine ou sslip.io (voir plus haut) |
| Domaine | Seulement pour « votre propre domaine » |
| Compte administrateur | Pseudo, e-mail, et un mot de passe d'au moins 8 caractères |
| E-mail (SMTP) | Facultatif. Sans lui, Nodyx fonctionne, il n'envoie simplement pas d'e-mails (un mot de passe perdu se récupère avec `nodyx-recover`, voir plus bas) |
| Annuaire public | Facultatif. Répondez oui pour apparaître sur [nodyx.org/discover](https://nodyx.org/discover) et être trouvé depuis les autres communautés |

Chaque confirmation comprend oui et non (`o/n`, `y/n`, `oui/non`, `yes/no`) et repose la question si la réponse n'est pas claire. Un appui malheureux sur Entrée ne détruit jamais rien.

### Puis il se met au travail

Il installe Node.js, PostgreSQL, Redis, Caddy, PM2 et les composants vocaux en Rust, génère tous les secrets, crée la base, construit Nodyx, crée votre compte administrateur et règle le pare-feu. La règle qui autorise SSH est posée **avant** d'allumer le pare-feu, sur le port que votre SSH utilise vraiment : impossible de vous enfermer dehors.

À la fin, un récapitulatif affiche votre adresse et l'état de chaque service. Bandeau vert : tout a répondu. Bandeau rouge : quelque chose mérite un coup d'œil, avec la commande exacte à lancer.

> **À savoir.** Votre mot de passe administrateur n'est **pas** écrit sur le disque. Gardez-le en lieu sûr. Si vous le perdez, `sudo nodyx-recover` vous redonne l'accès.

---

## 4. Votre première soirée

Ouvrez votre adresse, connectez-vous avec le compte administrateur, et faites de l'endroit le vôtre :

1. **Choisissez une ambiance.** Administration → Apparence : quatorze ambiances toutes prêtes, ou vos propres couleurs. Personne ne voit rien tant que vous n'avez pas publié.
2. **Composez la page d'accueil.** Administration → Homepage : lignes, colonnes et widgets, avec un aperçu sur ordinateur, tablette et mobile.
3. **Ouvrez les portes.** Quelques catégories de forum, un salon texte, un salon vocal.
4. **Écrivez le premier message.** Une annonce qui dit à quoi sert cet endroit.
5. **Invitez du monde.** Partagez l'adresse. C'est le moment où un serveur devient une communauté.

---

## Installer sans surveillance

Pour un script, Ansible ou une CI, chaque question a son option :

```bash
sudo bash install.sh --yes \
  --network=relay \
  --name="Les Oiseaux de nuit" --slug=oiseaux \
  --admin-user=admin --admin-email=admin@exemple.fr \
  --admin-password-file=/root/mot-de-passe-admin.txt
```

- `--yes` accepte les réponses par défaut ; une question sans défaut ni option arrête l'installeur proprement, en la nommant.
- `--network=direct|relay|sslip` ; `--domain=...` seul implique `direct`.
- Donnez les secrets par fichier (`--admin-password-file`), pas dans la ligne de commande, où n'importe quel utilisateur du serveur pourrait les lire.
- `--no-turn`, `--no-sfu`, `--no-subdomain`, `--lang=en|fr` : la liste complète avec `bash install.sh --help`.

---

## Vivre avec son instance

Trois commandes couvrent presque tout :

```bash
sudo nodyx-update    # passer à la dernière version
sudo nodyx-doctor    # vérifier que chaque service va bien
sudo nodyx-recover   # retrouver l'accès à un compte administrateur perdu
```

**La mise à jour** sauvegarde et vérifie d'abord la base, puis construit la nouvelle version à côté de celle qui tourne. Le site ne bascule qu'une fois tout construit ; si quelque chose échoue, il continue de tourner sur la version précédente, intacte. Deux mises à jour ne peuvent pas tourner en même temps. Les cinq sauvegardes de mise à jour les plus récentes sont gardées dans `/root/nodyx-db-backup-upgrade-*.sql.gz`.

**Les journaux**, quand vous voulez voir ce qui se passe :

```bash
sudo -u nodyx pm2 logs nodyx-core       # l'API
sudo -u nodyx pm2 logs nodyx-frontend   # l'application web
sudo journalctl -u caddy -n 50          # HTTPS et le proxy
sudo systemctl status nodyx-turn nodyx-sfud nodyx-relay-client
```

Nodyx tourne sous son propre utilisateur système, `nodyx` : utilisez `sudo -u nodyx pm2 ...`, pas `pm2` en root.

**La désinstallation** enlève Nodyx, et seulement Nodyx : un Caddyfile qui sert aussi d'autres sites n'est pas modifié, les clés Redis des autres applications et vos règles de pare-feu ne sont pas touchées. Elle propose d'abord de sauvegarder la base, les fichiers envoyés et la configuration, et s'arrête sans rien supprimer si cette sauvegarde échoue. Essayez-la d'abord à blanc :

```bash
sudo bash /opt/nodyx/uninstall.sh --dry-run
```

---

## Les ports, si vous gérez votre pare-feu

Avec le **relais Nodyx**, rien n'est ouvert : l'installeur s'assure seulement que SSH reste autorisé.

Avec **votre propre domaine** ou **sslip.io**, l'installeur ouvre :

| Port | Protocole | Pour |
|---|---|---|
| 80, 443 | TCP | Le site (HTTPS) |
| 3478, 5349 | TCP et UDP | Le relais vocal (TURN), pour les membres derrière des réseaux stricts |
| 49152 à 65535 | UDP | Le média du relais vocal |
| 40000 à 40999 | UDP et TCP | Le SFU : grands salons vocaux et partage d'écran |

Si votre serveur est derrière un pare-feu d'hébergeur (Hetzner, OVH, groupes de sécurité AWS…), ouvrez aussi ces ports là-bas.

---

## Quand quelque chose coince

Commencez par `sudo nodyx-doctor` : il vérifie chaque service et vous dit lequel ne va pas. Ensuite :

**« Address already in use » sur le port 80 ou 443.** Un autre serveur web occupe le port. L'installeur repère nginx et Apache et vous demande avant de les arrêter ; si vous avez dit non, arrêtez-le vous-même, ou choisissez le relais Nodyx, qui n'a besoin d'aucun des deux ports.

**Le certificat HTTPS n'arrive pas.** Vérifiez que votre domaine pointe vers le serveur (`getent hosts votredomaine.fr` doit afficher son IP), puis lisez `sudo journalctl -u caddy -n 50`. Un domaine acheté il y a quelques minutes peut mettre un peu de temps à être connu partout.

**Le nom du relais est déjà pris.** L'installeur le vérifie avant de commencer et vous en demande un autre : choisissez un autre identifiant.

**Le site affiche une erreur après une mise à jour.** Ça ne devrait pas arriver : une mise à jour ratée garde la version précédente en ligne. Lancez `sudo nodyx-doctor`, puis regardez `sudo -u nodyx pm2 logs nodyx-core`.

**Certains membres n'arrivent pas à rejoindre le vocal.** Le vocal passe d'abord en direct entre les participants, puis par le relais TURN. Avec votre propre domaine, vérifiez que les ports TURN et SFU ci-dessus sont ouverts, y compris chez votre hébergeur.

**Une Debian minimale (sans `sudo`, sans `curl`).** Installez d'abord `curl` (`apt install curl` en root) ; l'installeur s'occupe du reste.

---

## Toujours coincé ?

Ouvrez un ticket sur [GitHub](https://github.com/Pokled/nodyx/issues) avec la sortie de `sudo nodyx-doctor`, ou venez demander sur [nodyx.org](https://nodyx.org). Les personnes qui ont signalé des bugs de l'installeur sont dans notre [galerie des contributeurs](https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md) : un bon signalement, c'est une contribution.
