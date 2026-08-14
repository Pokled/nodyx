# nodyx-store

La vitrine des extensions Nodyx, `extensions.nodyx.org`.

**Deux faces sur la même base**, comme le prévoit `SPECS/NODYX_SDK_CDC.md` §9.2 :

- le site public, où l'on flâne, où l'on lit une fiche, où l'on décide d'installer ;
- `/index.json`, l'index signé que l'administration de chaque instance consomme.

## Ce que ce dépôt n'est pas

Ce n'est **pas** un service dont dépend Nodyx. Si `extensions.nodyx.org` tombe, une
instance perd la découverte, jamais l'installation ni ses extensions installées :
l'installation par fichier reste toujours disponible, et l'admin rend le catalogue
nativement plutôt que d'embarquer ce site en iframe.

## Le registre

Un dossier de fichiers JSON, un par extension. Pas de base de données : l'index est
statique, il se régénère, il se signe, il se sert. Une version publiée est **immuable**,
un correctif est une nouvelle version.

## Règles de fabrication

Elles sont normatives, `SPECS/NODYX_SDK_CDC.md` §9.9 :

- **i18n dès le premier commit**, FR et EN, aucune chaîne en dur ;
- design sobre, aucun effet de verre, aucun halo, rayons bornés ;
- **zéro ressource tierce** : ni police, ni script, ni mesure d'audience. Un site qui
  vend l'auto-hébergement sans traqueur ne peut pas en poser un ;
- aucune étoile. Le classement par défaut est éditorial et explicite.
