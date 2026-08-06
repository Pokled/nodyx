# NODYX — Contributing Guide
### Bienvenue dans la communaute Nodyx

---

> "Nodyx appartient a sa communaute. Pas a ses createurs."
> Si tu lis ce fichier, tu es potentiellement un batisseur d internet libre.
> Bienvenue.

---

## AVANT DE COMMENCER

Lis ces fichiers dans cet ordre :
1. `ARCHITECTURE.md`, comment Nodyx est construit
2. `MANIFESTO.md`, l ame du projet
3. `ROADMAP.md`, ou on va

Si tu n es pas d accord avec le Manifeste, Nodyx n est peut-etre pas le bon projet pour toi.
Et c est ok.

---

## OÙ CONTRIBUER

### Tu peux contribuer librement dans
```
nodyx-frontend/src/lib/locales/  , Traduis l interface
docs/                            , La documentation, et ses traductions
nodyx-frontend/src/              , Fonctionnalites et corrections du front
nodyx-docs/                      , Le site de documentation nodyx.dev
```

### Tu ne peux PAS modifier sans validation
```
nodyx-core/src/          , Code serveur principal
docs/en/ARCHITECTURE.md
docs/en/MANIFESTO.md
```

Si tu penses que quelque chose dans le core doit changer,
ouvre une Issue et explique pourquoi. La discussion est ouverte.
La modification unilaterale ne l est pas.

---

## CREER UN PLUGIN

### Structure minimale
```
nodyx-plugins/mon-plugin/
├── plugin.json     — Manifeste obligatoire
├── index.ts        — Point d entree
├── README.md       — Documentation
└── LICENSE         — Licence (MIT recommande)
```

### plugin.json minimal
```json
{
  "name": "mon-plugin",
  "version": "1.0.0",
  "description": "Ce que fait mon plugin",
  "author": "Ton nom ou pseudonyme",
  "license": "MIT",
  "nodyxVersion": ">=1.0.0"
}
```

### Regles pour les plugins
1. Un plugin ne modifie jamais les tables core (users, communities, categories, threads, posts)
2. Un plugin peut ajouter ses propres tables avec le prefixe `plugin_{nom}_`
3. Un plugin utilise uniquement les hooks documentes dans ARCHITECTURE.md
4. Un plugin ne peut pas desactiver un autre plugin
5. Un plugin doit fonctionner meme si ses dependances optionnelles sont absentes

---

## CONTRIBUER AU CODE CORE

### Processus
1. Fork le repo
2. Cree une branche : `feat/ma-fonctionnalite` ou `fix/mon-correctif`
3. Code en TypeScript, commentaires en anglais
4. Tests obligatoires pour toute nouvelle route API
5. Ouvre une Pull Request avec description claire

### Format des commits
```
feat: Ajout de la fonctionnalite X
fix: Correction du bug Y
docs: Mise a jour documentation Z
refactor: Reorganisation du module W
test: Tests pour la route V
```

### Ce qu on ne merge pas
- Code sans tests
- Code qui casse les tests existants
- Code avec dependances proprietaires
- Code avec backdoor (evidemment)
- Code qui centralise des donnees utilisateur
- Code qui contredit ARCHITECTURE.md sans discussion prealable

---

## TRADUIRE NODYX

La traduction est la contribution la plus accessible.
Pas besoin de savoir coder, et aucun compte à créer nulle part, sauf sur GitHub.

**État en direct : [nodyx.org/translate](https://nodyx.org/translate)** liste chaque langue, où elle en est, et renvoie directement sur le fichier à éditer.

### L'interface

Toute l'interface de l'application tient dans un fichier JSON par langue :

```
nodyx-frontend/src/lib/locales/
  fr.json          , langue source
  en.json          , référence, maintenue à 100%
  de.json  es.json  pt-PT.json  ru.json  vi.json
```

1. Ouvre [nodyx.org/translate](https://nodyx.org/translate) et trouve ta langue
2. Clique sur « Traduire sur GitHub », le dépôt est copié pour toi
3. Remplis les clés manquantes, en laissant chaque `{{variable}}` exactement telle quelle
4. Ouvre une Pull Request

L'intégration continue vérifie qu'aucune variable n'a bougé : tu ne peux pas casser l'application en traduisant. On relit, on fusionne, ton travail part dans la version suivante.

Ta langue n'est pas dans la liste ? Copie `en.json`, nomme-le avec ton code langue, et ouvre une Issue pour qu'on le branche dans le sélecteur de langue.

### La documentation
1. Va dans `docs/`
2. Copie le dossier `en/` et renomme-le avec ton code langue (`de/`, `es/`, `ja/`, etc.)
3. Traduis les fichiers
4. Ouvre une Pull Request

Fichiers à traduire :
```
MANIFESTO.md    , le texte fondateur
THANKS.md       , les remerciements
README.md       , la présentation du projet
CONTRIBUTING.md , ce guide
```

### Regles de traduction
- Traduis le sens, pas mot a mot
- Garde le ton original (direct, humain, pas corporatif)
- Ne touche jamais à ce qui est entre `{{ }}`, ce sont des valeurs que l'application remplit elle-même
- Si un concept n a pas d equivalent dans ta langue, garde le terme anglais
- Les noms propres (Nodyx, NodyxPoints, etc.) ne se traduisent pas

Les traducteurs reçoivent une étoile et leur place dans [CONTRIBUTORS.md](../../CONTRIBUTORS.md), comme tous les autres contributeurs.

---

## SIGNALER UN BUG

Ouvre une Issue avec :
- La version de Nodyx
- Le systeme d exploitation du serveur
- Les etapes pour reproduire
- Ce que tu as vu vs ce que tu attendais
- Les logs si disponibles

---

## PROPOSER UNE FONCTIONNALITE

Ouvre une Issue avec le tag `[FEATURE]` et explique :
- Quel probleme ca resout
- Pour qui (quel type d utilisateur)
- Comment tu imagines que ca marche
- Est-ce que ca devrait etre dans le core ou un plugin ?

La regle : si ca peut etre un plugin, ca doit etre un plugin.

---

## CODE DE CONDUITE

### On est ici pour
- Construire quelque chose de bien
- Apprendre ensemble
- Respecter le travail des autres
- Critiquer les idees, pas les personnes

### On n est pas ici pour
- Imposer ses opinions techniques
- Denigrer les contributions des autres
- Promouvoir des outils ou services proprietaires
- Contourner les regles du core

---

## QUESTIONS

- Issues GitHub pour les bugs et features
- Discussions GitHub pour les questions generales
- Le forum Nodyx lui-meme pour tout le reste

---

## MERCI

Chaque contribution, aussi petite soit-elle, fait partie de quelque chose de plus grand.
Une correction de faute dans la doc. Une traduction. Un plugin. Un bug reporte.

Tout compte. Tout est grave dans l histoire du projet.

```
git log --oneline
```

Ton nom sera la.

---

*"Le reseau, ce sont les gens."*
*AGPL-3.0 — Le code appartient a sa communaute.*