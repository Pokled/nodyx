# CDC — Nodyx Musique : playlists multiples ("Spotify Nodyx")

> Statut : brouillon pour discussion. Décision explicite de Jonathan le 19/09
> de reprendre ce chantier malgré le gel du 16/09 (audit sécurité en cours),
> puis fenêtre autonome de 8h accordée le 19/09 vers 00h30 pour la partie
> frontend — voir §8.
>
> **Ce qui a ete livre pendant cette fenetre (tout frontend, rien dans
> nodyx-core), un PR par etape, CI verte + verifie en prod a chaque fois :**
> - #737-739 : panneau fixe au scroll (bug reel, `position:sticky` inefficace
>   sur cette page), volume plus lisible, recherche reinitialisee au
>   changement de playlist, onglet "Tous les titres" par defaut (le lien
>   d'entree annoncait 50 titres, la page n'en montrait que 20).
> - #738 : lecteur extrait en composant reutilisable (`PlaylistPlayer.svelte`),
>   cles localStorage namespacees par playlist. Zero regression verifiee.
> - #735 : Media Session (ecran verrouille / casque / touches multimedia),
>   mini-lecteur mobile persistant au scroll, preferences memorisees.
> - #740 : vraie page d'accueil musique (section Playlists mise en avant,
>   cartes avec survol type Spotify), recherche remontee a cote de "Retour a
>   la musique".
> - #741 : polish visuel des 8 categories existantes (Twisted Reality /
>   Sleem Studio), zero lien casse, zero changement de logique.
>
> **Ce qui reste dans le CDC, ecrit, non execute, en attente de validation
> explicite de Jonathan a son reveil (§4, §5 : migration + routes admin,
> regle SANCTUAIRE de CLAUDE.md).** Rien dans `nodyx-core` n'a ete touche.

## 1. Contexte

Le 18-19/09, une playlist personnelle statique (`/musique/playlists/rock-alternatif-2000s`,
50 liens YouTube codés en dur dans un fichier `.svelte`) a été construite et
enrichie sur plusieurs sessions : lecteur avec API IFrame YouTube, favoris et
historique en localStorage, file d'attente, genres, recherche. Cette page a
servi de vrai prototype grandeur nature, validé en production.

Jonathan veut maintenant généraliser : plusieurs playlists (« va falloir en
faire d'autre »), pour plusieurs personnes (la première était pour lui, il en
faut une pour @lapersonne, potentiellement d'autres ensuite), gérées comme un
vrai outil et pas comme des fichiers codés à la main un par un.

Nodyx a **déjà** un module musique en production (`/musique`, `/admin/music`,
migrations 118 à 124) : catégories par communauté, morceaux uploadés
(`audio_asset_id` obligatoire), vues, likes, commentaires, durée, note de
licence par catégorie avec PDF téléchargeable. Ce module a été pensé pour des
bandes originales composées pour des studios (Sleem Studio via Suno). Ce CDC
ne construit pas un second système parallèle : il **étend** celui-là pour
qu'une catégorie puisse contenir des morceaux **YouTube** en plus des morceaux
uploadés.

## 2. Question légale posée par Jonathan (tranchée ici, pas une "faille")

> « on propose de la musique, ok, mais on est pas proprio, on rediffuse ce que
> YouTube propose ? »
>
> Confirmation de Jonathan (19/09) : « on ne triche pas, du tout. On ne fait
> que réitérer / mettre en avant ce qu'ils font. » — c'est exactement le cadre
> ci-dessous, pas une reformulation a posteriori.

Réponse nette : **on n'a pas besoin de faille**, parce qu'on n'est pas dans une
zone grise. On ne rediffuse rien : on **encadre** (« embed ») un contenu qui
reste, du premier au dernier octet, sur les serveurs de YouTube.

- Le lecteur utilisé est l'**IFrame Player API officielle de YouTube**
  (`youtube.com/iframe_api`), le même mécanisme que n'importe quel blog, site
  de presse ou plateforme communautaire utilise pour intégrer une vidéo. C'est
  un usage **explicitement prévu et documenté** par YouTube pour les sites
  tiers, pas un contournement — YouTube fournit ce mécanisme précisément pour
  qu'on l'utilise.
- La vidéo reste **hébergée et diffusée depuis les serveurs de YouTube**, avec
  ses propres publicités, sa marque, ses boutons ("Watch on YouTube"), son
  compteur de vues à lui. Nodyx ne stocke, ne copie, ni ne retransmet aucun
  fichier audio ou vidéo, à aucun moment, sur aucun serveur : il affiche un
  cadre qui pointe vers YouTube. Zéro octet de média ne transite ni ne reste
  sur l'infrastructure Nodyx.
- Chaque morceau reste **traçable jusqu'à sa source** : l'URL YouTube
  d'origine est conservée en base (`youtube_id`) et affichée publiquement
  ("Watch on YouTube" déjà présent dans le lecteur), pas seulement dans
  l'admin. Rien n'est caché, rien n'est présenté comme si Nodyx en était
  l'auteur.
- Ce qui **serait** illégal et qu'on ne fait pas, explicitement exclu de ce
  chantier (cf. §9, hors périmètre) : extraire l'audio d'une vidéo YouTube
  pour le réhéberger sur Nodyx, contourner les publicités, télécharger les
  fichiers, proposer un mode "audio seul sans la vidéo" qui masquerait la
  source, ou modifier/recadrer le lecteur pour cacher la marque YouTube.
- Le mécanisme de `license_note` par catégorie (migration 119) **existe déjà**
  pour documenter la provenance et les droits. Pour une catégorie composée de
  liens YouTube, la note par défaut sera un texte du type : *« Playlist
  composée de vidéos publiques YouTube, intégrées via le lecteur officiel de
  YouTube (IFrame Player API). Nodyx n'héberge, ne copie, ne possède ni ne
  distribue aucun contenu audio ou vidéo : chaque morceau reste diffusé
  depuis YouTube, avec un lien direct vers la vidéo d'origine, et les droits
  restent entièrement ceux des ayants droit YouTube. »* Même mécanisme, même
  PDF téléchargeable, contenu adapté à la source — donc une preuve écrite,
  datée, exportable, pas juste une explication orale si jamais la question
  revient.

Ce cadre est documenté ici pour que Jonathan (et quiconque relit ce fichier
plus tard) ait la réponse écrite, pas pour clore la discussion : si un doute
subsiste, c'est le moment de le dire avant qu'une seule ligne de migration
soit écrite.

## 3. Ce qui existe déjà (à ne pas dupliquer)

| Élément | Où | Statut |
|---|---|---|
| Catégories par communauté (slug, titre, description, image, position, vues) | `music_categories` | en prod |
| Morceaux uploadés (titre, description, `audio_asset_id` **NOT NULL**, image, position, likes, durée) | `music_tracks` | en prod |
| Commentaires publics par morceau | `music_track_comments` | en prod |
| Note de licence par catégorie + PDF public | `license_note`, `generateLicensePdf` | en prod |
| Note de licence par défaut (instance) | `communities.music_default_license_note` | en prod |
| En-tête de page éditable (titre/sous-titre/bannière) | `communities.music_page_*` | en prod |
| Écran admin (`/admin/music`) : créer/éditer catégorie et morceau, upload fichier | `admin/music/+page.svelte` (915 lignes) | en prod |
| API publique + admin (`adminOnly` en écriture, lecture libre) | `nodyx-core/src/routes/music.ts` (408 lignes) | en prod |
| Lecteur avancé (play/pause, progression, repeat, shuffle figé par contexte, recherche, genres, favoris/historique locaux, file d'attente, Media Session, mini-lecteur mobile) | `routes/musique/playlists/rock-alternatif-2000s/+page.svelte` | en prod, **prototype à généraliser** |

Rien ici n'est à refaire. La question est : comment brancher le lecteur déjà
prouvé sur le module déjà en prod, sans construire un troisième système.

## 4. Modèle de données (migration 125)

`music_tracks.audio_asset_id` est aujourd'hui `NOT NULL` : un morceau *doit*
être un fichier uploadé. Pour accepter un lien YouTube, la piste devient une
alternative, pas un remplacement.

```sql
ALTER TABLE music_tracks ALTER COLUMN audio_asset_id DROP NOT NULL;
ALTER TABLE music_tracks ADD COLUMN source_type VARCHAR(10) NOT NULL DEFAULT 'upload';
ALTER TABLE music_tracks ADD COLUMN youtube_id  VARCHAR(20);
ALTER TABLE music_tracks ADD COLUMN artist      VARCHAR(120);
ALTER TABLE music_tracks ADD COLUMN genre       VARCHAR(20);

ALTER TABLE music_tracks ADD CONSTRAINT music_tracks_source_check CHECK (
  (source_type = 'upload'  AND audio_asset_id IS NOT NULL AND youtube_id IS NULL) OR
  (source_type = 'youtube' AND youtube_id IS NOT NULL AND audio_asset_id IS NULL)
);
```

Points tranchés par défaut le 19/09 (fenêtre autonome de 8h, aucune reponse
disponible en temps réel — à corriger au reveil de Jonathan si desaccord) :
- **`genre`** : **liste fermée**, les 7 valeurs déjà utilisées dans le
  prototype (post-grunge, pop punk, rock alternatif, nu metal, metal
  alternatif, metalcore, post-hardcore). Évite les doublons style "Nu Metal" /
  "nu-metal" / "numetal", extensible par migration si un genre manque plus
  tard — cohérent avec "pas de surcharge inutile".
- **`artist`** : absent aujourd'hui car un morceau original n'a pas d'artiste
  distinct de la catégorie/du studio. Nullable, obligatoire seulement pour
  `source_type = 'youtube'` (contrainte applicative, pas SQL — un morceau
  uploadé peut légitimement ne pas en avoir).
- Numéro de migration à revérifier au moment de coder (`124` est la dernière
  connue au 19/09, prendre `max + 1` réel).

## 5. Écran admin (`/admin/music`)

Le formulaire d'ajout de morceau gagne un choix de source :

- **Upload** (comportement actuel, inchangé) : fichier audio + image + durée
  extraite automatiquement.
- **YouTube** : coller une URL. Extraction de l'ID côté serveur (regex sur les
  formats `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/embed/` — jamais
  un appel réseau non nécessaire côté serveur). Appel à l'API oEmbed de
  YouTube (`youtube.com/oembed?url=...`) pour pré-remplir titre suggéré et
  miniature — **toujours modifiable**, l'admin reste responsable de ce qu'il
  publie (le nom du champ oEmbed `author_name` est celui de la chaîne
  YouTube, pas forcément l'artiste réel : jamais copié tel quel dans `artist`
  sans confirmation).
- Champs communs : titre, **artiste** (nouveau), **genre** (liste fermée,
  nouveau), position dans la catégorie.
- La note de licence par défaut de la catégorie doit être adaptée si la
  catégorie mélange uploads et liens YouTube (texte combiné, ou une note par
  morceau plutôt que par catégorie — **à trancher**, actuellement le champ est
  au niveau catégorie).

## 6. Page publique — généraliser le prototype

Aujourd'hui `/musique/playlists/rock-alternatif-2000s` est un fichier unique
avec les 50 pistes codées en dur. Cible : une route générique
`/musique/[slug]` **existe déjà** pour les catégories du module actuel — le
lecteur avancé (play/pause, progression, repeat, shuffle, recherche, genres,
file d'attente, favoris/historique, Media Session, mini-lecteur mobile)
devient un **composant réutilisable** (`PlaylistPlayer.svelte` ou équivalent)
monté sur cette route existante, alimenté par les morceaux réels de la
catégorie (uploadés et/ou YouTube mélangés) au lieu d'un tableau statique.

Ce qui **reste local** (pas de compte, pas de tracking, cohérent avec le
principe déjà en place sur ce module — vues et likes sont "publics, anonymes,
aucune identité stockée", cf. migration 121) :
- Favoris (localStorage)
- Historique récent (localStorage)
- Volume / shuffle / repeat (localStorage)

Ce qui **doit devenir réel** (actuellement un artefact du prototype statique,
n'a plus de sens une fois les catégories dynamiques) :
- Les "onglets" (Tes morceaux / 30 nouveaux / genres) deviennent la
  **navigation entre catégories déjà existante** du module (`/musique` liste
  les catégories, chacune a sa page). Les genres restent une sous-navigation
  **à l'intérieur** d'une catégorie si elle mélange plusieurs styles.
- Les bios d'artistes vérifiées à la main (WebSearch) étaient spécifiques à
  cette playlist précise et ne passent pas à l'échelle pour un système
  générique où l'admin ajoute librement des morceaux. **Proposition : les
  retirer du composant générique** (pas de fait inventé, jamais), garder la
  possibilité d'un champ `description` libre par morceau (déjà supporté par
  le schéma actuel) si l'admin veut écrire un mot sur l'artiste.

## 7. Qui peut créer une playlist ?

Aujourd'hui : `adminOnly` en écriture, cohérent avec "une instance = une
communauté" et la responsabilité éditoriale d'un admin unique. Pour que
@lapersonne ait "sa" playlist sans que ce soit Jonathan qui tape chaque lien à
sa place, deux options :

1. **Jonathan reste le seul à écrire**, @lapersonne lui envoie sa liste de
   morceaux (comme pour la playlist rock alternatif), Jonathan (ou moi) la
   saisit dans l'admin. Zéro changement de permissions, le plus simple, le
   plus proche de l'existant.
2. **Un rôle "contributeur musique"** capable de créer/éditer ses propres
   catégories sans passer par `adminOnly` complet. Plus proche de "chacun sa
   playlist", mais nouvelle surface de permissions à durcir (qui peut modérer
   un contributeur qui abuse, qui peut supprimer, etc.) — un vrai sous-chantier
   sécurité, pas neutre pendant un audit en cours.

**Tranché par défaut le 19/09 (meme fenetre autonome) : option 1 pour ce
chantier**, l'option 2 reste une idée notée mais hors périmètre tant que
l'audit sécurité n'est pas clos.

## 8. Rapport avec le gel d'audit sécurité (16/09) et avec la règle SANCTUAIRE

Le 16/09, Jonathan a posé un gel explicite de tout nouveau chantier pendant
l'audit sécurité module par module en cours (modules 1, 2, 4 faits ; 3, 5, 6,
7, 8, 9 restants). Ce chantier — nouvelle colonne nullable, nouvelle
contrainte, formulaire admin étendu, composant lecteur généralisé — est un
**nouveau chantier** au sens de ce gel.

Le 19/09, invité à choisir entre "pousser la page statique encore plus loin"
et "vrai système avec CDC", Jonathan a choisi explicitement la seconde option
en toute connaissance du gel (rappelé au moment de la question), puis a
confirmé la vision ("Spotify premium luxe mais en mieux") et accordé une
fenêtre autonome de 8h.

Cela dit : `CLAUDE.md` pose une règle séparée, permanente, et non liée à
l'audit — **nodyx-core = SANCTUAIRE, toute modification exige une validation
explicite de Jonathan**, précisément parce que les migrations de
`src/migrations/` s'appliquent **automatiquement au démarrage**. Un simple
redémarrage pendant son absence appliquerait une migration qu'il n'a jamais
vue. Une autorisation générale ("libre", "8 heures") ne lève pas cette règle
specifique : elle demande un geste explicite, par changement, pas un blanc-
seing implicite.

Décision prise pour cette fenêtre autonome : le §4 (migration), le §5 (routes
admin) restent un **plan écrit, prêt à exécuter, non exécuté** — aucun fichier
n'est ajouté à `nodyx-core/src/migrations/`, aucun modèle ni route de
`nodyx-core` n'est modifié. Le temps disponible est utilisé sur ce qui est
sans risque et réversible : affiner ce CDC, et généraliser le lecteur côté
`nodyx-frontend` (composant réutilisable, encore alimenté par les données
statiques existantes le temps que le backend suive) — livré et déployé
normalement, car le frontend n'est pas sous la règle SANCTUAIRE. La partie
core attend un feu vert explicite au réveil de Jonathan.

## 9. Hors périmètre (pour l'instant)

- Comptes/rôles multi-contributeurs (cf §7, option 2).
- Playlists collaboratives, abonnement à la playlist d'un autre membre,
  fonctionnalités sociales.
- Import automatique depuis une playlist YouTube existante (l'admin colle un
  lien de playlist YouTube et tout se remplit seul) — techniquement faisable
  plus tard, mais un vrai sous-chantier (pagination de l'API YouTube Data,
  quotas, clé API à gérer) : pas dans ce lot.
- Suggestions "plus dans le même genre" inter-catégories (actuellement propre
  à une seule playlist) : à revoir une fois plusieurs catégories réelles
  existent, pas avant.

## 10. Prochaines étapes

1. Valider ce document section par section avec Jonathan (comme pour le CDC
   du contenant : plusieurs passes attendues, pas un one-shot).
2. Trancher les points ouverts : taxonomie des genres (fermée vs libre),
   licence par morceau vs par catégorie pour les catégories mixtes, option 1
   vs 2 du §7.
3. Confirmation explicite sur le §8 avant tout code.
4. Une fois validé : migration 125 (ou le numéro réel à ce moment), extension
   de l'admin, extraction du composant lecteur, branchement sur `/musique/[slug]`.
