# Pages statiques servies par Caddy

Ces fichiers vivent en production dans `/etc/caddy/pages/` et n'etaient **pas**
versionnes : ils auraient disparu a la premiere reinstallation.

Caddy les sert en statique apres reecriture. **Les modifier prend effet
immediatement**, sans `reload` — ce qui compte sur cette machine, ou la
configuration vivante vient de `autosave.json` et ou un rechargement fait tomber
le HTTPS (cf `CLAUDE.md`).

## instance-offline.html

Affichee quand le tunnel d'une instance auto-hebergee n'est pas connecte au
relais.

**Pourquoi elle a ete reecrite le 2026-08-17.** Elle listait trois causes vagues
et ne donnait aucune piste. Or le cas le plus frequent est precis et
diagnosticable : le reseau de l'auto-hebergeur bloque les connexions **sortantes**
vers le port `7443`, ce que font beaucoup de reseaux d'entreprise, d'universite
ou d'institut qui n'autorisent que le 443.

Constate le jour meme sur `Instituto Kairos` (Bresil) : leur instance joignait
l'annuaire sur 443 sans probleme — 25 requetes, toutes en 200 — et **aucun paquet
n'arrivait sur 7443**, pas meme refuse. Un pare-feu qui jette produit ce silence.

La page donne desormais la cause probable en premier, trois commandes a copier, et
la phrase qui compte pour quelqu'un qui se sent demuni : **aucun port a ouvrir en
entree**. Traduite en anglais et en portugais.

⚠️ Defaut connu, PREEXISTANT a cette reecriture (verifie : 539px avant comme
apres, sur un ecran de 390) : la page deborde horizontalement d'environ 150px. La
cause n'est aucun element du DOM — probablement un pseudo-element decoratif. A
corriger, sans urgence.
