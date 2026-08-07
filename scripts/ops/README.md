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
