# Le gardien des cœurs PM2

## Ce qu'il corrige

Le 22 août 2026, `unattended-upgrade` a redémarré PostgreSQL (coupure de
5 secondes). `demo-core`, `sleemstudio-core` et `vieuxlooters-core` s'y sont
pris juste au mauvais moment pendant leurs migrations de démarrage. Aucun n'a
planté : ils sont restés **bloqués avant `server.listen()`**. PM2 les affichait
« online » sans discontinuer, rien ne les a jamais relancés.

Injoignables pendant près de 5 heures, sans la moindre alerte. C'est ce
symptôme précis, processus vivant mais port muet, que `nodyx-core` (le
principal) n'a pas eu ce jour-là, et que rien ne surveillait.

## Le mécanisme

`verifier-ecoute.sh` sonde en local les quatre ports des cœurs (3000 à 3003).
**Deux passages consécutifs en échec** avant d'agir, jamais un seul : un
redémarrage légitime laisse aussi le port muet une poignée de secondes, et ne
doit pas déclencher d'intervention.

Au second échec : `pm2 restart`, vérification que le port répond de nouveau,
puis une alerte Discord sur `SECURITY_DISCORD_WEBHOOK`, le canal déjà utilisé
par les alertes de sécurité existantes (`auth.ts`), pas un nouveau créé pour
l'occasion.

Un minuteur `systemd` le lance toutes les deux minutes, la même cadence que
`nodyx-security-collector` déjà en place. Dans le pire cas, une instance muette
est détectée et relancée en moins de 5 minutes, au lieu de 5 heures.

## Vérifié, pas supposé

Testé en coupant volontairement `demo-core` :

```
premier passage  : constat, aucune action
second passage   : relance, port de nouveau joignable
demo.nodyx.org   : 200 depuis l'extérieur
```

Et sur l'état sain : aucune sortie, aucun fichier d'état créé, aucune instance
touchée.

## Limites, assumées

Ce script traite le **symptôme**, pas la cause. Il ne dit pas pourquoi la
migration de démarrage peut se bloquer indéfiniment sur une erreur de connexion
transitoire au lieu d'échouer proprement ou de réessayer avec un délai. Cette
question touche au code de `nodyx-core`, qui est sanctuarisé : elle attend une
décision séparée, pas un correctif d'infrastructure.

Si une instance a besoin d'être relancée à répétition, ce script continuera de
le faire à chaque fois, sans jamais renoncer ni alerter différemment. C'est
volontaire : mieux vaut relancer inutilement de temps en temps que rater une
vraie panne parce qu'un compteur de suppression l'a fait taire.
