# Webhooks

Les webhooks envoient ce qui se passe dans ta communauté vers d'autres outils, au moment où ça se passe : un nouvel article du forum dans ton salon Discord, une sourdine sur ton téléphone, chaque décision de modération dans ton tableur ou ton automatisation.

Ils se trouvent dans **Administration > Intégrations > Webhooks**. Seuls les admins et le propriétaire ouvrent cette page.

---

## Deux sortes de destinations

Chaque destination est de l'une des deux sortes, choisie en premier, au moment de l'ajouter.

| Sorte | Pour | Reçoit |
|---|---|---|
| **Annonces de la communauté** (publique) | Un salon Discord ou Matrix public, une page d'annonces | Nouveaux articles, morceaux, événements, sondages, pages wiki, lives, arrivées |
| **Alertes de modération** (équipe seulement) | Ton téléphone, un salon privé de l'équipe, ton propre outil | Tout ce qui précède, plus les sanctions, signalements, messages retenus, contestations, le barème, les réglages d'OctoGuard |

Une alerte de modération nomme des membres. Elle ne part **jamais** vers une destination publique : le serveur refuse d'enregistrer une destination publique avec la modération, et la filtre encore au moment de l'envoi. Rendre publique une destination d'équipe demande une confirmation et lui retire la modération.

Seul le contenu que tout le monde peut déjà voir dans ta communauté est annoncé : un événement ou une page wiki privés ne sortent jamais, et un message du forum retenu par OctoGuard n'est annoncé qu'une fois approuvé par un modérateur.

Ne part jamais, quoi que tu coches : les messages privés, les adresses e-mail, les adresses IP, les mots de passe. Le texte d'un message signalé ou retiré ne part que vers une destination d'équipe qui l'a explicitement demandé (« Inclure le texte des messages en cause », éteint par défaut).

---

## Les outils

| Outil | Ce qui arrive | Adresse |
|---|---|---|
| **ntfy** | Une notification sur ton téléphone, en priorité haute pour une sanction | `https://ntfy.sh/ton-sujet` ou ton propre serveur ntfy |
| **Matrix** | Un message dans un salon, par le robot hookshot | L'adresse que hookshot te donne après `!hookshot webhook nodyx` |
| **Discord** | Un message avec une carte de couleur dans un salon | `https://discord.com/api/webhooks/…` (paramètres du salon, Intégrations, Webhooks) |
| **Slack** | Un message dans un canal | `https://hooks.slack.com/services/…` (Incoming Webhooks) |
| **Mon outil** | Du JSON signé, pour n8n, Node-RED ou ton propre code | N'importe quelle adresse `https://` qui répond en moins de 10 secondes |

Les messages sont rédigés par le serveur dans la langue de ta communauté (français ou anglais, les autres langues retombent sur l'anglais). Sur Discord, aucun message ne peut mentionner `@everyone`.

---

## En brancher une

1. Clique sur **Ajouter une destination** et choisis la sorte.
2. Choisis l'outil et suis les trois étapes affichées.
3. Colle l'adresse, puis **Envoyer un test**. La réponse arrive tout de suite (« Reçu en 182 ms »), ou une explication claire de ce qui ne va pas (adresse introuvable, refusée, 404, pas de réponse en 10 secondes…).
4. Coche les événements voulus. Chacun affiche une estimation par semaine, calculée sur les 30 derniers jours de ta communauté.
5. **Enregistrer**.

La page garde les 50 derniers envois de chaque destination. Clique sur une ligne pour voir exactement ce qui est parti et ce que la destination a répondu.

---

## Fiabilité

- **Rien ne ralentit ta communauté.** Les envois partent d'une file d'attente, à côté. Une destination lente ou en panne ne retarde jamais tes membres, ni les autres destinations.
- **Trois essais.** Un envoi raté est réessayé après 1 minute, puis après 10 minutes.
- **Pause après 10 échecs de suite.** La destination se met en pause et les admins reçoivent une notification. Les événements de la pause ne sont pas renvoyés ensuite (personne ne veut 40 alertes d'un coup). **Tester et reprendre** la relance.

---

## Sécurité

- Une adresse qui mène au serveur lui-même ou à son réseau local (`127.0.0.1`, `localhost`, `10.x`, `192.168.x`, adresses de métadonnées des hébergeurs…) est refusée, à l'enregistrement et à chaque envoi. Les redirections ne sont jamais suivies.
- Pour envoyer vers un service de ton propre réseau local, par exemple un ntfy hébergé chez toi, l'admin du serveur peut poser `OCTOGUARD_WEBHOOK_ALLOW_PRIVATE=true` dans l'environnement du cœur. Le local et les adresses de métadonnées restent interdits dans tous les cas.
- Les adresses des destinations ne sont visibles que des admins. Un secret de signature n'est montré qu'une fois, à sa création, et le serveur ne le renvoie jamais.
- Chaque changement (destination ajoutée, modifiée, supprimée, reprise) est inscrit au journal d'administration.

---

## Pour les développeurs : le format JSON

Avec **Mon outil**, chaque envoi est un `POST` avec un corps JSON. Sa forme, ses en-têtes, la vérification de la signature et la liste complète des types d'événements sont décrits dans la [version anglaise de cette page](https://nodyx.dev/en/webhooks), identique pour toutes les langues. En bref :

- `X-Nodyx-Signature` : `sha256=` suivi du HMAC-SHA256 de `timestamp + "." + corps`, avec ton secret ;
- `X-Nodyx-Timestamp` : refuse tout envoi de plus de 5 minutes, personne ne peut rejouer un vieux message ;
- `X-Nodyx-Delivery` : un identifiant unique, gardé quand un envoi est réessayé ;
- le corps porte `"version": 2` : une mise à jour de Nodyx ne cassera pas ton outil.

La page Webhooks montre le code de vérification en Node.js, Python et PHP, prêt à copier.

---

## Si tu utilisais l'ancien webhook d'OctoGuard

L'unique webhook d'OctoGuard est devenu une destination d'équipe nommée « OctoGuard », au format JSON, avec la même adresse, le même secret et toute la modération. L'onglet Webhook d'OctoGuard montre maintenant les destinations qui reçoivent la modération et mène à cette page.
