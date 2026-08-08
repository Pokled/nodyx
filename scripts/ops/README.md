# Scripts d'exploitation

Ces scripts pilotent le serveur de production. Ils vivaient auparavant
**uniquement sur le disque du VPS**, hors de tout dépôt : ni relus, ni
sauvegardés, ni restaurables si la machine disparaissait. Ils sont versionnés
ici pour la même raison que le reste du code.

| fichier | rôle | installation |
|---|---|---|
| `../deploy-all.sh` | déploie et **vérifie** les 9 applications du serveur | exécuté par le lanceur ci-dessous |
| `opt-deploy-wrapper.sh` | lanceur hors dépôt : fait le `git pull` puis passe la main | `sudo install -m 755 scripts/ops/opt-deploy-wrapper.sh /opt/deploy-all.sh` |
| `nodyx-demo-reset.sh` | remise à zéro quotidienne de demo.nodyx.org | `sudo install -m 755 scripts/ops/nodyx-demo-reset.sh /usr/local/bin/nodyx-demo-reset` |
| `nodyx-backup.sh` | sauvegarde **vérifiée** des 3 bases + uploads | `sudo install -m 755 scripts/ops/nodyx-backup.sh /usr/local/bin/nodyx-backup` |
| `nodyx-recover.sh` (via `src/scripts/recover.ts`) | reprendre la main sur un compte owner/admin perdu | `sudo install -m 755 scripts/ops/nodyx-recover-wrapper.sh /usr/local/bin/nodyx-recover` |
| `nodyx-backup.{timer,service}` | la déclenche chaque nuit | `sudo install -m 644 scripts/ops/nodyx-backup.{timer,service} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now nodyx-backup.timer` |

## Le principe qui a motivé la réécriture du déploiement

Un script d'exploitation **ne déclare jamais un succès qu'il n'a pas constaté**.

L'ancien `deploy-all.sh` couvrait 4 applications sur 9 et se terminait par
« ✓ Les deux instances sont à jour », quoi qu'il se soit passé. Trois
conséquences réelles : `demo.nodyx.org` n'était jamais déployée, `nodyx.dev`,
`start.nodyx.org` et le hub ne l'étaient jamais non plus, et un build en échec
n'empêchait pas le message de succès.

C'est le même défaut que le bug `pm2-logrotate` : une étape qui annonce avoir
réussi sans avoir vérifié. La version actuelle compte ses échecs, ne redémarre
un groupe que si tous ses builds ont réussi, interroge les six domaines à la
fin, vérifie qu'aucune application PM2 n'est hors ligne, et **sort en code 1**
s'il reste le moindre problème.


## Les sauvegardes

**Le produit ne sauvegarde pas tout seul.** Le panneau « Sauvegardes » de
l'administration crée des archives à la demande, mais rien ne le déclenche :
`'scheduled'` n'existe que comme valeur de type dans `backupService.ts`, aucun
code ne la produit, et aucun installeur ne pose de tâche planifiée. Sur
nodyx.org, la dernière sauvegarde datait de **48 jours** quand on s'en est
aperçu, et elle vivait sur le même disque que les données.

`nodyx-backup.sh` comble ce trou côté exploitation, **indépendamment du
produit** : il n'a besoin ni de l'API ni que l'application tourne, ce qui compte
précisément le jour où tout est cassé.

Il applique la règle de la maison : **une archive qu'on ne sait pas relire ne
compte pas comme une sauvegarde**. Chaque dump est relu par `pg_restore --list`
et chaque archive d'uploads par `tar -t` juste après écriture. Si une seule
relecture échoue, le script sort en erreur *et* annule la purge des anciennes
archives : mieux vaut du vieux que rien.

### Restaurer

```bash
sudo -u postgres createdb ma_restauration
sudo -u postgres pg_restore -d ma_restauration --no-owner --no-privileges \
  /var/backups/nodyx/nexus-<horodatage>.dump
tar xzf /var/backups/nodyx/nexus-uploads-<horodatage>.tar.gz -C /destination
```

Cette procédure a été **exécutée pour de vrai** le 2026-08-07, dans une base
jetable : 0 erreur, 94 tables, et des comptages identiques à la production
(106 utilisateurs, 160 posts, 58 fils, 569 messages). Une sauvegarde jamais
restaurée n'est pas une sauvegarde.

### Ce qui manque encore

Les archives restent **sur la même machine que les données**. Elles protègent
d'une bêtise (suppression, migration ratée, restauration à blanc), pas de la
perte du serveur. Une copie hors-site reste à mettre en place, et elle demande
un choix de destination et des accès.


## Récupération d'accès (compte owner perdu)

Le scénario : l'owner a perdu son mot de passe ET son e-mail (le lien de
réinitialisation par mail ne sert donc à rien). Sur un auto-hébergement, le seul
point d'ancrage de confiance qui survit à ça est **l'accès à la machine** : qui
peut lancer une commande sur le serveur EST le propriétaire.

`nodyx-recover` ne demande donc aucune authentification en ligne, ne démarre pas
l'application (ni Redis, ni Socket.IO), se connecte juste à la base, et génère le
**même jeton** qu'un e-mail « mot de passe oublié » aurait envoyé. On obtient un
lien à ouvrir dans un navigateur : le formulaire de réinitialisation habituel
fait le reste.

```bash
sudo nodyx-recover                 # interactif : liste les owners/admins, génère un lien
sudo nodyx-recover --list          # juste lister
sudo nodyx-recover --reset <qui>   # lien direct pour un username ou email
sudo nodyx-recover --promote <qui> # désigner un owner (cas « plus aucun owner »)
# autre instance :
NODYX_DIR=/opt/sleemstudio sudo -E nodyx-recover
```

**Pourquoi pas Nodyx Signet ?** Signet est une méthode d'authentification (un
appareil). La récupération sert précisément quand les moyens d'auth sont perdus,
y compris l'appareil : on ne bâtit pas le frein de secours avec la pièce qui peut
manquer. Le secours doit dépendre du minimum de pièces et être le plus robuste ;
l'accès machine l'est. Une fois Signet prouvé stable, il pourra devenir un
facteur EN PLUS, jamais l'ancrage unique.
