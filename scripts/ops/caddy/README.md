# Modifier Caddy en production sans perdre le domaine

Ces scripts existent pour une raison précise : sur ce serveur, la configuration
Caddy **vivante ne vient pas de `/etc/caddy/Caddyfile`**. Elle est chargée depuis
`/var/lib/caddy/.config/caddy/autosave.json`, que Caddy restaure au démarrage. Le
Caddyfile sur disque est un vestige minimal de l'installateur de tunnel, sans bloc
HTTPS pour `nodyx.org`.

Conséquence : `systemctl reload caddy` ou `caddy reload` bascule Caddy sur le
fichier disque et **fait tomber le HTTPS de nodyx.org instantanément**. Toute
modification passe donc par l'API d'administration, jamais par un rechargement.

## Les quatre scripts

| script | rôle |
|---|---|
| `sauvegarder.sh` | photographie l'état avant toute modification |
| `verifier.sh` | dit si le domaine va bien, en comparant à un relevé |
| `verifier-identification.sh` | dit si un visiteur légitime est encore identifié |
| `poser-route-tunnel.sh` | pose la route du tunnel WebSocket, avec repli automatique |
| `annuler-route-tunnel.sh` | retire cette route |
| `poser-filtre-entetes.sh` | empêche un inconnu de se faire passer pour quelqu'un d'autre |
| `annuler-filtre-entetes.sh` | retire ce filtre |
| `plages-de-confiance.py` | lit les plages Cloudflare depuis `client_ip.rs` |
| `restaurer.sh` | remet un état sauvegardé |

## Le filtre des en-têtes de transfert

Le VPS accepte les connexions directes sur 443 : `ufw` autorise
`443 ALLOW IN Anywhere`, et rien n'oblige à passer par Cloudflare. Caddy
transmettait les en-têtes de transfert tels quels, quelle que soit leur
provenance. Comme le pair TCP vu par les applications est toujours Caddy
lui-même, donc du loopback, donc de confiance, l'en-tête était cru sur parole.

Mesuré depuis Internet le 20 août 2026, pas supposé :

- le bannissement anti-force-brute du relais était contournable, il suffisait de
  changer de `CF-Connecting-IP` à chaque tentative ;
- la limitation de débit de **toute l'API** l'était de la même façon : une
  adresse fabriquée mais routable obtenait son propre seau Redis.

`poser-filtre-entetes.sh` insère en tête une route **non terminale** qui retire
`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP` et
`CF-IPCountry` quand la source n'est pas l'une des nôtres. Caddy repose ensuite
lui-même un `X-Forwarded-For` contenant le vrai pair : l'usurpateur se retrouve
désigné par sa propre adresse.

**Aucun visiteur légitime ne perd quoi que ce soit.** Pour qui arrive en direct,
on retire ce qu'il prétendait être et Caddy repose sa vraie adresse.

Les plages de confiance sont **lues depuis `client_ip.rs`**, jamais recopiées :
le relais et Caddy doivent avoir une seule notion de « nos propres portes ». Deux
listes qui divergent, c'est une faille qui s'ouvre le jour où l'une est mise à
jour sans l'autre. `plages-de-confiance.py` refuse de produire une liste
tronquée, parce qu'un ensemble vide ferait correspondre le filtre à **tout** le
trafic, Cloudflare compris.

`verifier-identification.sh` surveille exactement cette panne, que `verifier.sh`
ne verrait pas : le site répondrait 200 partout pendant que tous les visiteurs
tomberaient dans le même seau sous `127.0.0.1`.

## Le retour arrière, à trois niveaux

**Niveau 1, chirurgical.** `annuler-route-tunnel.sh` retrouve la route par son
contenu (hôte et destination), jamais par un index noté quelque part, et la
supprime. C'est le retour arrière normal.

**Niveau 2, les routes.** `restaurer.sh <sauvegarde.json>` réécrit le tableau de
routes complet de `srv1` depuis une sauvegarde. À employer si le niveau 1 ne
suffit pas.

**Niveau 3, l'état initial.** `etat-initial.json` est écrit **une seule fois**, à
la première sauvegarde, et n'est jamais réécrit. C'est le point de retour quand
plus rien d'autre n'est sûr :

```bash
./restaurer.sh /var/backups/nodyx/caddy/etat-initial.json
```

> **Pourquoi pas simplement « la dernière sauvegarde »** : `poser-route-tunnel.sh`
> sauvegarde au début de son exécution. Un second passage photographierait donc
> l'état **déjà modifié** et le déposerait parmi les points de retour, où il
> serait pris pour l'état d'avant. Le piège s'est produit pendant la mise au
> point de ces scripts, sur maquette.

## Le piège du rechargement complet

`restaurer.sh --complet` fait un `POST /load`, qui remplace la configuration
**entière**, bloc `admin` compris.

La configuration vivante de cette production **ne contient aucun bloc `admin`** :
Caddy écoute sur l'endpoint par défaut, `localhost:2019`, de façon implicite.
Recharger une sauvegarde qui déplacerait cet endpoint reviendrait à se couper la
seule porte par où passer pour revenir en arrière. `restaurer.sh` refuse ce cas
plutôt que de faire confiance.

C'est pour cela que le mode par défaut est chirurgical, et `--complet` un
dernier recours.

## Critères d'arrêt

Faire machine arrière **immédiatement**, sans chercher à comprendre d'abord, si
l'un de ces points est constaté :

- un hôte du relevé change de code de retour, quel qu'il soit ;
- `localhost:2019` ne répond plus, l'API d'administration étant la seule porte
  de retour ;
- le port 7443 se ferme, une instance tunnelisée sur trois continents en dépend ;
- la route `*.nodyx.org` disparaît, elle sert **toutes** les instances
  tunnelisées d'un coup.

`poser-route-tunnel.sh` applique lui-même le premier critère : si le contrôle
détecte un écart après la pose, il annule sans attendre et sort en erreur.

## Comment ces scripts ont été éprouvés

Sept essais sur un Caddy factice reproduisant la forme de la production, hors
production, avant tout usage réel :

1. pose complète, du relevé au contrôle final ;
2. `PUT` sur un index : **insère**, ne remplace pas. 4 routes deviennent 5, le
   joker `*.nodyx.org` survit et glisse d'un rang. C'était l'inconnue qui
   pouvait tout détruire ;
3. seconde pose : refusée avant toute sauvegarde ;
4. annulation : route retrouvée par contenu, retirée, compte revenu à 4 ;
5. restauration après suppression volontaire d'une route : rétablie ;
6. `etat-initial.json` : créé une fois, non contaminé par un second passage ;
7. contrôle en échec après la pose : repli automatique, joker intact, sortie
   non nulle.
