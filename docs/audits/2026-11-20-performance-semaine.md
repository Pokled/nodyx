# Audit de performance : la semaine du 15 au 20 novembre 2026

Date : 2026-11-20
Périmètre : le frontend de nodyx.org, version par version, sur les PR fusionnées du 15 au 20 novembre (#1027 à #1046).
Point de départ : des saccades au défilement signalées par deux personnes, avec le sentiment que « c'est récent » et qu'une PR de la semaine en était la cause.

---

## 1. Résumé

**Aucune PR de la semaine n'a alourdi une page.** Mesurées sur les mêmes données, à machine égale, les pages coûtent moins cher aujourd'hui que le 15 novembre :

- au repos, cinq pages sur sept passent de 1 800 à 3 400 ms de calcul (sur 3 s) à moins de 100 ;
- au défilement, le coût baisse d'environ 30 % ;
- le poids des pages est divisé par 3 à 5.

Les saccades ressenties venaient du poste de l'utilisateur : après un plantage du pilote graphique, le navigateur était passé en **composition logicielle** (tout l'affichage calculé par le processeur) et y était resté. Un redémarrage complet a rétabli la carte graphique et fait disparaître les saccades.

L'audit a tout de même trouvé une chose à corriger : l'accueil travaillait en permanence au repos (barre de progression du diaporama). Corrigé par #1047.

---

## 2. Méthode

Pour chacune des 12 versions (du commit du 15/11 à celui du 20/11) :

1. le frontend est construit en mode production, dans un dossier jetable ;
2. il est servi derrière un relais local qui envoie les appels d'API au cœur de prod : **les vraies données de nodyx.org**, connecté avec un compte de test ;
3. un Chromium sans interface charge 7 pages : `/`, `/forum`, `/chat`, un profil, `/members`, `/calendar`, `/admin/octoguard` ;
4. sur chaque page, deux passages de mesure, moyennés :
   - **repos** : 3 s sans rien toucher, après 8 s de chargement ;
   - **défilement** : 3 s de défilement aller-retour ;
5. on relève aussi les erreurs JavaScript, les appels en échec (4xx/5xx), le poids transféré, les tâches longues et les animations en cours.

L'unité est le **temps de calcul cumulé du navigateur** (tous fils confondus) pendant les 3 s, tiré d'une trace de performance. Plus c'est bas, mieux c'est.

**Limite à garder en tête** : le banc n'a pas de carte graphique. Il mesure donc ce que coûte Nodyx pour un membre en composition logicielle (vieux portable, machine virtuelle, pilote cassé), le pire cas. Avec une carte graphique, tout est nettement moins cher. Le banc ne peut pas, à lui seul, distinguer « Nodyx est lourd » de « la machine affiche sans carte graphique ».

---

## 3. Résultats

### Au repos (ms de calcul sur 3 s)

| Version | Accueil | Forum | Chat | Profil | Membres | Calendrier | OctoGuard |
|---|---|---|---|---|---|---|---|
| 15/11 | 3 383 | 1 758 | 2 009 | 3 314 | 1 765 | 2 325 | 1 891 |
| 19/11, avant #1033 | 3 458 | 1 764 | 2 018 | 3 286 | 1 755 | 2 211 | 1 906 |
| 19/11, après #1033 | 619 | 19 | 21 | 3 431 | 89 | 18 | 21 |
| 20/11 (#1046) | 644 | 19 | 25 | 19 | 94 | 20 | 19 |

### Au défilement (ms de calcul sur 3 s)

| Version | Accueil | Forum | Chat | Profil | Membres | Calendrier | OctoGuard |
|---|---|---|---|---|---|---|---|
| 15/11 | 3 821 | 3 221 | 3 443 | 3 555 | 3 178 | 3 269 | 2 867 |
| 20/11 (#1046) | 2 743 | 1 816 | 2 288 | 3 015 | 1 858 | 2 376 | 1 963 |

### Poids transféré (Ko)

| Version | Accueil | Forum | Chat | Profil | Membres | Calendrier | OctoGuard |
|---|---|---|---|---|---|---|---|
| 15/11 | 4 149 | 7 004 | 4 083 | 4 213 | 9 218 | 3 960 | 3 899 |
| 20/11 | 986 | 3 841 | 912 | 1 264 | 6 055 | 838 | 737 |

### Fonctionnel

Sur les 84 chargements de page (12 versions × 7 pages) : **aucune erreur JavaScript, aucun appel en échec.**

### Ce qui a fait bouger les chiffres

- **#1033** (papier peint figé) : le repos tombe presque à zéro sur cinq pages, le défilement baisse d'environ 30 %.
- **#1034** (vignettes à la bonne taille) : les pages deviennent 3 à 5 fois plus légères.
- **#1044 à #1046** (profil) : le profil au repos passe de 3 400 à 19.
- Aucune autre version ne fait monter un chiffre au-delà du bruit de mesure.

---

## 4. La vraie cause des saccades

Les enregistrements de performance pris sur le poste concerné montraient :

- le fil principal de la page presque inactif ;
- le fil de composition (`VizCompositorThread`) saturé ;
- des images perdues (`DroppedFrame`) en continu, **même avec tous les effets visuels coupés**.

C'est la signature d'une composition logicielle. `chrome://gpu` l'a confirmé : « Compositing: Software only », avec le pilote de secours de Windows à la place de la carte graphique, après un plantage du pilote (`DXGI_ERROR_DEVICE_REMOVED`). Chrome reste dans ce mode jusqu'à ce qu'on le quitte entièrement.

Pourquoi « les autres sites marchent » : la plupart sont plus simples à composer (peu de calques, peu de flou, pas de fond animé). Nodyx, avec ses flous et ses calques, est l'un des premiers à le montrer.

**À faire en premier la prochaine fois** qu'un membre signale des saccades : lui demander sa page `chrome://gpu` (lignes « Compositing » et « GL_RENDERER »), et s'il a essayé un redémarrage complet du navigateur. L'audit de Nodyx vient ensuite.

---

## 5. Corrigé pendant l'audit

### #1047 : l'accueil ne travaille plus au repos

La barre de progression des deux diaporamas de l'accueil changeait sa largeur toutes les 100 ms : mise en page et peinture, 10 fois par seconde, même hors de l'écran. L'ancien diaporama (instances sans grille) tournait même quand une grille était publiée, donc sans rien afficher.

La barre est devenue une animation CSS en `transform`. Le choix entre animation continue et animation par crans a été **mesuré**, pas supposé :

| Variante (accueil au repos) | ms de calcul sur 3 s |
|---|---|
| Avant (minuterie à 100 ms) | ≈ 630 |
| Animation continue | ≈ 1 400 |
| Animation en 60 crans (10 par seconde) | ≈ 330 |
| Sans barre ni bandeau (plancher) | ≈ 17 |

Sans carte graphique, une animation continue fait recomposer la page 60 fois par seconde : elle était deux fois pire que l'ancienne minuterie. Les crans gardent la même cadence visuelle pour deux fois moins de calcul.

### En marge : dépendances

Les 26 alertes Dependabot ouvertes ont été traitées dans la foulée (#1048, #1049, #1051), avec la mise à jour de Node sur le serveur (22.22.0 vers 22.23.5) qu'exigeait `re2`. #1053 empêche aussi `/uploads/` de servir des fichiers cachés. Aucune n'avait d'effet sur la performance.

---

## 6. Erreurs de méthode, pour ne pas les refaire

- **Un A/B au banc de développement a désigné #1033 comme coupable.** Mesuré proprement sur des builds de production et les vraies pages, c'est l'inverse : c'est la PR qui a le plus allégé Nodyx. Un serveur de développement (Vite, modules non regroupés, données de banc) ne dit rien de fiable sur le rendu en production.
- **Les premières mesures de cet audit portaient sur des pages d'erreur.** Le cœur refusait l'origine du serveur d'audit (500), et les pages vides semblaient très rapides. Toujours vérifier le code HTTP et le titre de chaque page mesurée avant de lire un chiffre.
- **L'enquête a commencé par Nodyx au lieu du poste.** Une nuit de corrections (#1044 à #1046, utiles mais sans rapport avec la cause) avant de demander `chrome://gpu`.

---

## 7. Ce qui reste

- **Le défilement** coûte encore 1 800 à 3 000 ms sur 3 s en composition logicielle, sur toutes les pages. Les suspects sont les flous d'arrière-plan (`backdrop-filter`) et le nombre de calques. Le chantier se mène page par page, en mesurant chaque retrait. Un essai sur le profil a montré qu'enlever un flou peut déplacer le coût vers la peinture au lieu de le réduire.
- **Le bandeau d'articles défilant** reste une animation continue (environ 100 ms sur 3 s quand il est à l'écran). Il est mis en pause hors écran depuis #1047.
- **Les compteurs de la barre de statistiques** utilisent quatre minuteries à 25 ms pendant 1 s au chargement, puis s'arrêtent. C'est sans effet au repos.
- **Le banc de mesure** (construction par version, relais, script de mesure) n'est pas dans le dépôt. Le versionner permettrait de rejouer cet audit en une commande avant une version majeure.
