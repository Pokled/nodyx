# Musique : remplir le catalogue

Ce fichier `musique.json` alimente `nodyx.org/musique`. Il n'est ni dans `src/` ni
dans `static/` : le modifier prend effet au prochain chargement de page, sans
`npm run build` ni redémarrage de PM2.

## Ajouter un morceau

1. Dépose le fichier audio (mp3, ogg, wav, m4a) et une image de couverture (jpg,
   png, webp) sur le serveur, dans :
   `/var/www/nexus/nodyx-core/uploads/ost/<slug-categorie>/`
   (crée le dossier s'il n'existe pas). Ces fichiers sont déjà servis publiquement
   sur `https://nodyx.org/uploads/ost/...` sans rien configurer de plus, et
   sauvegardés avec le reste des uploads.

2. Dans `musique.json`, ajoute une entrée dans le tableau `tracks` de la bonne
   catégorie :

   ```json
   {
     "title": "Nom du morceau",
     "description": "Une phrase sur l'intention, l'instrumentation, la scène.",
     "audio": "/uploads/ost/village/theme-village.mp3",
     "cover": "/uploads/ost/village/theme-village.jpg"
   }
   ```

   `cover` est optionnel : sans lui, l'image de la catégorie est utilisée.

## Ajouter une catégorie

Copie un bloc de `categories`, change `slug` (utilisé dans l'URL de partage
`/musique#<slug>`), `title`, et laisse `tracks: []` en attendant les morceaux.
`image` est l'illustration de catégorie (même dossier `uploads/ost/<slug>/`).

## Ajouter un autre jeu

Copie un bloc de `projects` avec un nouveau `slug`, `title`, `description`, et
ses propres `categories`. La page affiche tous les projets à la suite.

## Ce qui ne change jamais

- Une catégorie sans morceau affiche un état vide honnête, jamais un lecteur
  cassé pointant vers un fichier qui n'existe pas.
- Le titre de projet `"Jeu vidéo (à renommer)"` est un repère : à remplacer par
  le vrai nom du jeu dès qu'il peut être annoncé publiquement.
