# Manuel du SDK Nodyx, référence développeur

Statut : **normatif, écrit avant l'implémentation.** Ce document est la spécification que P0 doit satisfaire, et il deviendra la documentation publiée sur `nodyx.dev` quand P0-C sera livré. Toute divergence entre le code et ce document est un bogue du code, pas une évolution du contrat.
Version du contrat : `api: 1`, protocole de messagerie `p: 1`
Document parent : `NODYX_SDK_CDC.md`. Modèle de menace : `NODYX_SDK_SECURITY.md`.

---

## 1. En cinq minutes

Une extension Nodyx est un dossier zippé. Voici la plus petite qui existe, deux fichiers.

`manifest.json`

```json
{
  "api": 1,
  "id": "hello",
  "version": "1.0.0",
  "license": "MIT",
  "default_locale": "en",
  "label": "@label",
  "description": "@description",
  "surfaces": [
    { "type": "widget", "id": "main", "entry": "ui/widget.js", "label": "@label" }
  ]
}
```

`i18n/en.json`

```json
{ "label": "Hello", "description": "Says hello." }
```

`ui/widget.js`

```js
export function mount({ root, nodyx }) {
  root.textContent = nodyx.t('label')
}
```

Zippez le contenu, renommez en `hello-1.0.0.nyx`, déposez le dans **Administration, Extensions, Installer un fichier**. C'est tout : pas de build, pas de npm, pas de framework.

Trois choses à retenir dès maintenant, elles expliquent tout le reste du document :

1. **Votre code tourne dans une iframe isolée**, sans accès à la page Nodyx, à ses cookies, ni à sa session. Ce n'est pas une gêne à contourner, c'est le contrat qui permet à un admin d'installer votre travail sans vous connaître.
2. **Tout ce qui sort de cette iframe passe par l'objet `nodyx`.** Il n'y a pas d'autre porte.
3. **Tout ce que voit un humain est une clé de traduction.** Une chaîne écrite en dur dans le manifeste fait échouer l'installation.

---

## 2. Anatomie d'un paquet

```
mon-extension-1.0.0.nyx        (une archive zip, extension .nyx)
├── manifest.json              obligatoire, à la racine de l'archive
├── icon.svg                   recommandé, 1:1, assaini à l'installation
├── preview.png                recommandé pour la fiche du magasin
├── LICENSE                    obligatoire au registre officiel
├── README.md                  facultatif
├── i18n/
│   ├── en.json                obligatoire si default_locale vaut en
│   └── fr.json                autant de locales que vous voulez
├── ui/
│   ├── widget.js              un point d'entrée par surface
│   ├── page.js
│   └── style.css              facultatif, chargé par vous
└── data/
    └── catalogue.json         jeu de données livré avec l'extension
```

**Le manifeste est à la racine**, pas dans un sous-dossier. C'est l'erreur d'empaquetage la plus fréquente.

Types de fichiers acceptés à l'extraction : `.js .css .json .svg .png .jpg .jpeg .webp .woff2 .md`. Tout le reste est ignoré silencieusement à l'extraction, sauf le point d'entrée déclaré, dont l'absence fait échouer l'installation.

| Plafond | Valeur |
|---|---|
| taille de l'archive | 20 Mo |
| taille décompressée | 60 Mo |
| nombre de fichiers | 2 000 |
| profondeur de répertoires | 6 |
| taille d'un fichier | 8 Mo |

Les liens symboliques, les chemins absolus et les chemins remontants (`../`) font échouer l'installation. Ce n'est pas négociable, voir `NODYX_SDK_SECURITY.md` §4.6.

---

## 3. Le manifeste, champ par champ

### 3.1 Racine

| Champ | Type | Requis | Contrainte |
|---|---|---|---|
| `api` | entier | oui | vaut `1`. Un manifeste sans `api` est refusé. |
| `id` | chaîne | oui | `^[a-z][a-z0-9-]{2,38}$`. Unique sur l'instance. Refusé s'il appartient au domaine réservé natif (§3.6). |
| `version` | chaîne | oui | semver strict `MAJEUR.MINEUR.CORRECTIF`. Une version publiée est immuable. |
| `nodyx_min` | chaîne | non | version minimale de Nodyx. Installation refusée en dessous. |
| `license` | chaîne | oui | identifiant SPDX. Le registre officiel exige une licence OSI. |
| `author` | objet | non | `{ name, url? }` |
| `source` | URL | non | dépôt public. **Exigé au registre officiel.** |
| `default_locale` | chaîne | oui | code de langue dont le bundle doit être complet. |
| `label` | clé | oui | commence par `@`, résolue dans les bundles. |
| `description` | clé | oui | idem. |
| `icon` | chemin | non | SVG ou PNG carré, assaini à l'installation. |
| `family` | énum | non | `media` `gaming` `community` `esport` `social` `content`. Défaut `content`. |
| `surfaces` | tableau | oui | au moins une entrée. |
| `permissions` | objet | non | absent vaut aucune permission. |

Il n'existe **aucun champ `type`**. Ce qu'est votre extension se déduit de ses surfaces : le magasin range une extension qui expose une page dans Modules, une qui expose des widgets dans Widgets, et une qui fait les deux apparaît dans les deux.

### 3.2 Les surfaces

Une surface est un endroit de Nodyx où votre code s'affiche. Chacune a son point d'entrée, son cycle de vie, sa configuration.

```json
"surfaces": [
  {
    "type": "widget",
    "id": "tonight",
    "entry": "ui/tonight.js",
    "label": "@widget.tonight.label",
    "description": "@widget.tonight.desc",
    "schema": [ /* §3.3 */ ],
    "default_height": 320
  },
  {
    "type": "page",
    "path": "library",
    "entry": "ui/page.js",
    "nav": { "label": "@nav.label", "icon": "twemoji:clapper-board", "position": "main" }
  }
]
```

| Champ | `widget` | `page` |
|---|---|---|
| `id` | obligatoire, unique dans l'extension | interdit |
| `path` | interdit | obligatoire, `^[a-z][a-z0-9-]{1,30}$`, monte sous `/x/<ext-id>/<path>` |
| `entry` | obligatoire | obligatoire |
| `label` | obligatoire, affiché dans le builder | facultatif |
| `schema` | facultatif, formulaire du builder | interdit, une page se configure par son stockage |
| `nav` | interdit | facultatif, ajoute une entrée de navigation |
| `default_height` | facultatif, hauteur initiale en pixels | ignoré, une page occupe la zone de contenu |

Deux surfaces peuvent partager un même fichier d'entrée. Chaque surface est montée dans **sa propre iframe**, avec son propre jeton : elles ne partagent ni mémoire ni variables. Ce qu'elles partagent, c'est le stockage de l'extension.

### 3.3 Le schéma de configuration

Il décrit le formulaire que l'admin remplit dans le builder d'accueil. Le SDK vous rend le résultat dans `nodyx.config`.

```json
{
  "key": "mood",
  "type": "select",
  "label": "@field.mood",
  "hint": "@field.mood.hint",
  "details": "@field.mood.details",
  "required": true,
  "default": "learn",
  "options": [
    { "value": "learn", "label": "@mood.learn" },
    { "value": "laugh", "label": "@mood.laugh" }
  ]
}
```

| `type` | Rendu | Type reçu dans `config` | Champs additionnels |
|---|---|---|---|
| `text` | champ une ligne | `string` | `placeholder`, `max` |
| `textarea` | champ multiligne | `string` | `placeholder`, `max` |
| `url` | champ URL validé | `string` | `placeholder` |
| `number` | champ numérique | `number` | `min`, `max` |
| `boolean` | interrupteur | `boolean` | |
| `select` | liste déroulante | `string` | `options` obligatoire |
| `color` | sélecteur de couleur | `string` (`#rrggbb`) | |
| `image` | téléversement ou URL | `string` (URL) | |

Champs communs : `key` (obligatoire, `^[a-z][a-z0-9_]{0,39}$`), `label` (clé, obligatoire), `hint` (clé, une ligne sous le champ), `details` (clé, panneau dépliable derrière une icône), `required`, `default`.

**`checkbox` n'existe pas.** L'ancien format le tolérait, le SDK v1 le refuse à l'installation. Utilisez `boolean`.

Ne considérez jamais une valeur comme garantie : un admin peut vider un champ facultatif, et une configuration enregistrée par une version antérieure de votre extension peut manquer une clé que vous venez d'ajouter. Toujours une valeur de repli côté code.

### 3.4 Les permissions

Absentes, votre extension n'a rien : elle s'affiche, elle lit sa configuration, elle parle sa langue. C'est déjà suffisant pour beaucoup de widgets, et c'est le cas le plus facile à faire installer.

```json
"permissions": {
  "identity": ["id", "username", "avatar", "locale"],
  "storage":  { "user": "1mb", "instance": "8mb" },
  "core":     ["members:read"],
  "network": {
    "api.themoviedb.org": {
      "methods": ["GET"],
      "paths":   ["/3/movie/*", "/3/search/movie"],
      "secret":  "TMDB_API_KEY",
      "rate":    "60/min"
    }
  }
}
```

| Permission | Ce qu'elle ouvre | Ce que l'admin voit |
|---|---|---|
| `identity` | les champs listés de l'utilisateur courant, et eux seuls | « peut voir votre pseudo et votre avatar » |
| `storage.user` | lecture et écriture par utilisateur | « peut stocker 1 Mo par membre » |
| `storage.instance.read` | lecture des données partagées | « peut lire les données partagées de l'extension » |
| `storage.instance.write` | écriture des données partagées | « peut modifier les données partagées » |
| `core` | lectures cadrées, avec les droits de l'utilisateur | « peut lire la liste des membres » |
| `network` | appels sortants, par hôte, méthode et chemin | « peut lire les fiches TMDB (GET /3/movie/...) » |

Règles d'or, elles décident souvent de votre taux d'installation :

- **Demandez le minimum.** Chaque ligne est affichée à l'admin avant l'installation et à chaque mise à jour.
- **Un hôte réseau nu est refusé.** Déclarez méthodes et préfixes de chemin, sinon l'écran de permissions devient illisible et l'installation échoue.
- **Une permission ajoutée en cours de vie est un événement.** Elle apparaît dans le diff de capacités de la mise à jour, en évidence. Prévoyez-la, ne la glissez pas.

### 3.5 Les champs interdits

Un manifeste qui contient une clé inconnue est **refusé**, il n'est pas nettoyé. C'est délibéré : une faute de frappe sur `permissions` ne doit jamais aboutir à une extension qui tourne avec moins de droits que prévu et échoue à l'usage.

### 3.6 Le domaine réservé

Les identifiants des widgets natifs sont réservés et refusés à l'installation : `hero-banner`, `header`, `stats-bar`, `join-card`, `announcement-banner`, `article-slideshow`, `articles-showcase`, `recent-threads`, `social-links-bar`, `twitch-stream`, `video-player`. La liste vit dans le validateur et grandit avec les widgets natifs.

---

## 4. Cycle de vie d'une surface

```
1. l'hôte crée l'iframe et charge le document de frame
2. l'hôte injecte le SDK, puis transfère un port privé avec la charge d'amorçage
3. l'hôte importe votre module d'entrée
4. l'hôte appelle mount({ root, nodyx })
5. votre code vit, réagit aux événements
6. l'hôte appelle unmount() si vous l'exportez, puis détruit l'iframe
```

Votre module d'entrée est un **module ES**. Il exporte `mount`, et facultativement `unmount`.

```js
/** @param {{ root: HTMLElement, nodyx: Nodyx }} ctx */
export function mount({ root, nodyx }) {
  const el = document.createElement('div')
  el.textContent = nodyx.t('greeting', { name: nodyx.user?.username ?? '' })
  root.append(el)

  const off = nodyx.on('locale', () => {
    el.textContent = nodyx.t('greeting', { name: nodyx.user?.username ?? '' })
  })

  return { unmount: () => off() }
}
```

`mount` peut être asynchrone. Tant qu'elle n'a pas résolu, l'hôte affiche son propre indicateur de chargement : n'en dessinez pas un deuxième.

**Délai d'amorçage : 5 secondes.** Au delà, l'hôte affiche une carte d'erreur propre à la place de votre surface et journalise. Ne faites pas dépendre votre `mount` d'un appel réseau lent : montez d'abord la structure, remplissez ensuite.

`root` est un élément de votre document de frame. Vous y faites ce que vous voulez : DOM natif, template littéral, ou un framework que vous embarquez. Le SDK n'impose rien et n'en fournit aucun.

**Redimensionnement.** Pour une surface `widget`, l'hôte observe la hauteur de `root` et ajuste l'iframe automatiquement. Vous n'avez rien à appeler. `nodyx.resize(px)` existe pour les cas où votre contenu sort du flux (une animation, un élément positionné). Une surface `page` occupe toute la zone de contenu et défile à l'intérieur.

---

## 5. L'objet `nodyx`

### 5.1 Obtention

Le SDK est déjà chargé quand votre module est importé, et `nodyx` vous est passé à `mount`. Vous n'avez ni script à inclure, ni dépendance à installer, ni version à suivre : **c'est l'instance qui sert le SDK**, sa version suit toujours celle de Nodyx.

Pour un usage hors `mount` (un module utilitaire) :

```js
import { getNodyx } from 'nodyx:sdk'
```

### 5.2 Lecture seule

| Propriété | Type | Toujours présent |
|---|---|---|
| `nodyx.api` | `1` | oui |
| `nodyx.extension` | `{ id, version }` | oui |
| `nodyx.surface` | `{ type, id? , path? }` | oui |
| `nodyx.config` | objet issu du schéma | oui, vide si aucun schéma |
| `nodyx.locale` | `'fr'`, `'en'`, ... | oui |
| `nodyx.theme` | jetons résolus (§7) | oui |
| `nodyx.instance` | `{ name, memberCount, onlineCount, logoUrl }` | oui |
| `nodyx.user` | champs autorisés, ou `null` | **non, `null` pour un visiteur** |

`nodyx.user` vaut `null` pour un visiteur non connecté, et aussi pour un membre si vous n'avez pas demandé `identity`. **Une extension qui plante quand `user` est `null` est cassée** : les pages publiques d'une instance sont vues par des gens qui n'ont pas de compte, et c'est souvent leur premier contact avec la communauté.

### 5.3 Traduction

```js
nodyx.t('key')                          // "Bonjour"
nodyx.t('greeting', { name: 'Ada' })    // "Bonjour Ada"
nodyx.t('inconnue')                     // "inconnue", la clé elle-même
```

Interpolation `{{nom}}`, pas de pluriel, clés plates. Résolution en cascade : locale courante, puis `default_locale`, puis la clé brute. Voir §8.

### 5.4 Stockage

```js
await nodyx.storage.get('watched')                      // valeur ou undefined
await nodyx.storage.set('watched', [603, 27205])        // remplace
await nodyx.storage.delete('watched')
await nodyx.storage.list()                              // [{ key, bytes, updatedAt }]

await nodyx.storage.get('featured', { scope: 'instance' })
await nodyx.storage.set('featured', {...}, { scope: 'instance' })
```

Portée par défaut : `user`. Les valeurs sont du JSON sérialisable, pas de `Date`, pas de `Map`, pas de référence circulaire.

Sémantique : **dernière écriture gagnante**, pas de transaction, pas de verrou. Si deux onglets du même membre écrivent la même clé, le dernier gagne. Pour un compteur partagé, ne lisez pas puis écrivez : structurez la donnée pour que deux écritures concurrentes ne se détruisent pas.

Pour un visiteur non connecté, la portée `user` **échoue** avec `NOT_AUTHENTICATED`. C'est volontaire : il n'y a personne à qui rattacher la donnée. Gardez l'état local en mémoire dans ce cas, et proposez la connexion.

### 5.5 Réseau

```js
const res = await nodyx.fetch('https://api.themoviedb.org/3/movie/603')
if (!res.ok) { /* ... */ }
const data = await res.json()
```

L'objet rendu ressemble à une `Response` : `ok`, `status`, `headers` (filtrés), `json()`, `text()`, `arrayBuffer()`.

Ce qui se passe réellement : la requête part vers votre instance, qui vérifie l'hôte, la méthode et le chemin contre ce que le manifeste a déclaré et que l'admin a accepté, injecte les secrets si vous en avez, appelle le service distant, et vous rend la réponse. **Vous ne verrez jamais la clé d'API**, et le navigateur du visiteur ne parle jamais au service tiers. C'est un choix de doctrine : une communauté ne doit pas fuiter chez un tiers parce qu'elle affiche une affiche de film.

Pour les images, n'appelez pas `fetch`, utilisez l'aide dédiée qui rend une URL utilisable dans un `src` et met en cache côté instance :

```js
img.src = nodyx.imageUrl('https://image.tmdb.org/t/p/w500/abc.jpg')
```

L'hôte ne suit que 3 redirections, revalide chaque saut, refuse les adresses privées, plafonne la taille et le temps de réponse. Un service lent ou hostile ne peut pas geler votre extension, mais il peut vous rendre `UPSTREAM_TIMEOUT` : traitez ce cas.

### 5.6 Lectures Nodyx

```js
await nodyx.core.get('instance')                       // toujours autorisé
await nodyx.core.get('members', { limit: 20, page: 1 }) // permission members:read
await nodyx.core.get('forum.threads', { limit: 10 })    // permission forum:read
```

Les lectures s'exécutent **avec les droits de l'utilisateur courant**, jamais élevés. Un visiteur ne voit que le public, exactement comme dans l'interface. Aucune écriture en v1.

### 5.7 Interface rendue par l'hôte

Votre iframe ne peut pas dessiner par dessus la page, et c'est voulu. Pour tout ce qui doit sortir de votre cadre, demandez à l'hôte :

```js
nodyx.ui.toast('Ajouté à ta liste')
const ok = await nodyx.ui.confirm({ title: '@confirm.title', body: '@confirm.body' })
await nodyx.ui.modal({ title: '@modal.title', surface: 'detail', props: { id: 42 } })
```

Bénéfice pour vous : ces éléments ont l'apparence de l'instance, y compris son thème et sa langue, sans une ligne de CSS.

### 5.8 Navigation

Pour une surface `page`, l'hôte reflète votre chemin interne dans l'URL du navigateur, ce qui rend vos vues partageables et compatibles avec le bouton retour.

```js
nodyx.router.push('/film/603')      // devient /x/library/film/603
nodyx.router.replace('/')
nodyx.router.current                // '/film/603'
nodyx.on('route', ({ path }) => render(path))
```

Vous ne pouvez naviguer que **dans votre propre espace**. Pour envoyer l'utilisateur ailleurs dans Nodyx, passez par l'hôte, qui applique ses propres règles :

```js
nodyx.navigate('/forum')            // navigation hôte, vérifiée
nodyx.openExternal('https://...')   // lien externe, confirmation utilisateur
```

### 5.9 Événements

```js
const off = nodyx.on('theme', (theme) => { /* ... */ })
off()
```

| Événement | Quand | Charge |
|---|---|---|
| `theme` | l'instance change de thème | jetons résolus |
| `locale` | l'utilisateur change de langue | `{ locale }` |
| `config` | l'admin modifie la config dans le builder (aperçu direct) | nouvelle config |
| `route` | l'URL change, surface `page` | `{ path }` |
| `visible` | la surface entre ou sort du viewport | `{ visible }` |
| `session` | le jeton a été renouvelé, ou la session a expiré | `{ state }` |

`visible` mérite votre attention : les widgets hors écran sont montés paresseusement et peuvent être suspendus. Arrêtez vos animations et vos sondages quand `visible` est faux, c'est ce qui fait la différence entre une page d'accueil vive et une page qui rame.

### 5.10 Les erreurs

Tout appel asynchrone du SDK peut rejeter avec une `NodyxError` portant un `code` stable, en majuscules. Testez le code, jamais le message : le message est traduit et peut changer.

| Code | Cause |
|---|---|
| `PERMISSION_DENIED` | capacité non déclarée ou non accordée |
| `NOT_AUTHENTICATED` | portée `user` sans utilisateur connecté |
| `QUOTA_EXCEEDED` | quota d'octets de l'extension atteint |
| `KEY_TOO_LONG`, `VALUE_TOO_LARGE`, `TOO_MANY_KEYS`, `JSON_TOO_DEEP` | limites de stockage (§9) |
| `RATE_LIMITED` | trop d'appels, en écriture ou en réseau |
| `HOST_NOT_ALLOWED`, `METHOD_NOT_ALLOWED`, `PATH_NOT_ALLOWED` | l'appel sort de ce que le manifeste déclare |
| `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT`, `RESPONSE_TOO_LARGE` | le service distant |
| `SESSION_EXPIRED` | jeton périmé, le SDK renouvelle et rejoue une fois, puis remonte |
| `INVALID_ARGUMENT` | mauvais usage de l'API |
| `NOT_FOUND` | ressource absente |

```js
try {
  await nodyx.storage.set('big', payload)
} catch (e) {
  if (e.code === 'QUOTA_EXCEEDED') showCleanupHint()
  else throw e
}
```

---

## 6. Le protocole, pour ceux qui n'utilisent pas le SDK

Le SDK est une commodité, pas une obligation. Le contrat réel est le protocole. Il est versionné par `p`, indépendamment de `api`.

L'hôte n'envoie **qu'un seul message** sur `window`, celui d'amorçage, qui transfère un `MessagePort`. Tout le reste passe par ce port privé.

```jsonc
// requête, dans les deux sens
{ "p": 1, "id": "c3f1", "ext": "library", "surface": "page",
  "type": "storage.get", "payload": { "key": "watched" } }

// réponse, toujours corrélée par id
{ "p": 1, "id": "c3f1", "ok": true,  "result": [603, 27205] }
{ "p": 1, "id": "c3f1", "ok": false, "error": { "code": "QUOTA_EXCEEDED", "message": "..." } }

// notification de l'hôte, sans réponse attendue
{ "p": 1, "event": "theme", "payload": { /* jetons */ } }
```

Un `id` inconnu, déjà consommé, ou reçu avant la fin de la poignée de main est rejeté et journalisé côté hôte. Un message envoyé sur `window` après l'amorçage est ignoré.

Types de requête : `session.renew`, `storage.get|set|delete|list`, `net.fetch`, `core.get`, `ui.toast|confirm|modal`, `router.push|replace`, `nav.go`, `nav.external`, `surface.resize`.

---

## 7. Le thème

L'hôte injecte dans votre frame un jeu de variables CSS **stables**, et les met à jour quand l'instance change de thème. Ce sont les seuls noms sur lesquels vous devez vous appuyer.

| Jeton | Rôle |
|---|---|
| `--nodyx-bg`, `--nodyx-bg-elevated` | fond de page, fond de carte |
| `--nodyx-fg`, `--nodyx-fg-muted` | texte principal, texte secondaire |
| `--nodyx-accent`, `--nodyx-accent-fg` | accent de l'instance, texte sur accent |
| `--nodyx-border` | bordure discrète |
| `--nodyx-danger`, `--nodyx-success`, `--nodyx-warning` | états |
| `--nodyx-radius-sm`, `--nodyx-radius-md`, `--nodyx-radius-lg` | rayons de la maison |
| `--nodyx-space-1` à `--nodyx-space-6` | échelle d'espacement |
| `--nodyx-font`, `--nodyx-font-mono` | piles typographiques |

```css
.card {
  background: var(--nodyx-bg-elevated);
  color: var(--nodyx-fg);
  border: 1px solid var(--nodyx-border);
  border-radius: var(--nodyx-radius-md);
  padding: var(--nodyx-space-4);
}
```

Nodyx possède plusieurs systèmes de palette internes qui ont évolué avec le temps. **Ne les utilisez jamais depuis une extension** : ils ne sont pas un contrat, ils changent, et une extension câblée dessus semblera ignorer le thème. Les jetons `--nodyx-*` existent précisément pour vous en isoler.

Ne chargez aucune police depuis un tiers. La pile de l'instance est dans `--nodyx-font`, et une requête vers un CDN de polices est de toute façon bloquée par la politique de sécurité de votre frame.

---

## 8. i18n

**Règle dure, non négociable, appliquée à l'installation** : toute chaîne visible par un humain est une clé. Dans le manifeste, une clé commence par `@`. Dans votre code, elle passe par `nodyx.t()`.

```
i18n/
├── en.json     complet si default_locale vaut "en", sinon l'installation échoue
├── fr.json
└── de.json
```

```json
{
  "label": "Médiathèque",
  "nav.label": "Films",
  "greeting": "Bonjour {{name}}",
  "field.mood": "Humeur"
}
```

Clés plates avec des points, interpolation `{{}}`, aucune gestion du pluriel. Si vous en avez besoin, gérez-le avec deux clés et une condition dans votre code.

Ce qui doit être traduit : l'interface. Ce qui ne doit pas l'être : le contenu éditorial que vous publiez avec l'extension. Une note écrite à la main dans un jeu de données n'est pas une chaîne d'interface, la traduire est un travail de rédaction, pas d'extraction. Déclarez la langue de votre contenu dans la description, le magasin l'affiche.

Une clé absente rend la clé elle-même, visiblement moche. C'est voulu : un trou de traduction doit se voir en développement, pas se cacher derrière un texte anglais plausible.

---

## 9. Limites et quotas

Toutes appliquées côté serveur. Aucune n'est contournable, aucune n'est négociable par extension.

| Domaine | Limite | Valeur |
|---|---|---|
| Stockage | longueur d'une clé | 128 caractères |
| | taille d'une valeur | 64 Ko |
| | nombre de clés par portée | 500 |
| | profondeur JSON | 16 |
| | écritures | 30 par minute et par membre |
| | total | le quota déclaré et accordé |
| Réseau | redirections | 3, chacune revalidée |
| | délai | 10 s |
| | taille de réponse | 5 Mo |
| | débit | ce que déclare `rate`, plafonné par l'instance |
| Surface | délai d'amorçage | 5 s |
| | frames simultanées par page | 8, au delà chargement paresseux forcé |
| Paquet | voir §2 | |

Dépassement : une erreur nette avec un code stable. **Jamais de troncature silencieuse, jamais de purge automatique.** Si votre extension dépasse, elle le sait et peut le dire à l'utilisateur.

---

## 10. Ce que vous ne pouvez pas faire, et par quoi remplacer

| Impossible | Pourquoi | À la place |
|---|---|---|
| Lire les cookies, le stockage local ou la session de Nodyx | frontière du bac à sable | `nodyx.storage`, `nodyx.user` |
| Toucher le DOM de la page hôte | idem | `nodyx.ui.*` pour tout ce qui sort du cadre |
| Appeler `/api/v1` directement | votre frame n'a pas la session | `nodyx.core.get` |
| Écrire dans le forum, le chat, les membres | v1 en lecture seule | attendez les écritures avec consentement, v2 |
| Appeler un service tiers depuis le navigateur | doctrine, aucune fuite chez un tiers | `nodyx.fetch`, déclaré au manifeste |
| Embarquer une iframe tierce (lecteur vidéo externe) | les drapeaux du bac à sable se propagent, l'embed casserait | v1 : non, un lecteur externe reste un widget natif. P3 : `nodyx.ui.embed({ provider, id })`, l'hôte pose l'iframe du fournisseur pour vous, avec la même liste de fournisseurs sur toutes les instances |
| Livrer du code serveur, une table, une migration | le cœur est sanctuarisé | `storage`, jeu de données livré, proxy réseau |
| Ouvrir une popup, naviguer la page du haut, télécharger un fichier | drapeaux non accordés | `nodyx.openExternal`, `nodyx.navigate` |
| Charger une police, un script ou une image depuis un CDN | politique de sécurité de la frame | livrez-les dans le paquet |

Si votre besoin n'entre dans aucune case, ouvrez une discussion sur le dépôt avant d'inventer un contournement. Les capacités du SDK grandissent par demandes réelles, et une extension qui contourne se cassera à la prochaine version.

---

## 11. Tutoriel complet, de zéro à publié

Objectif : un widget « Prochain événement » qui affiche le compte à rebours d'une date configurable, traduit, au thème de l'instance, sans aucune permission.

### 11.1 Créer le squelette

```bash
npm create nodyx-extension next-event
cd next-event
```

Arborescence produite, déjà valide :

```
next-event/
├── manifest.json
├── i18n/{en,fr}.json
├── ui/widget.js
└── icon.svg
```

### 11.2 Le manifeste

```json
{
  "api": 1,
  "id": "next-event",
  "version": "1.0.0",
  "license": "MIT",
  "author": { "name": "Votre nom" },
  "default_locale": "en",
  "label": "@label",
  "description": "@description",
  "icon": "icon.svg",
  "family": "community",
  "surfaces": [
    {
      "type": "widget",
      "id": "countdown",
      "entry": "ui/widget.js",
      "label": "@label",
      "default_height": 160,
      "schema": [
        { "key": "title", "type": "text", "label": "@field.title", "required": true },
        { "key": "date",  "type": "text", "label": "@field.date", "hint": "@field.date.hint", "required": true },
        { "key": "accent", "type": "boolean", "label": "@field.accent", "default": true }
      ]
    }
  ]
}
```

### 11.3 Les traductions

`i18n/en.json`

```json
{
  "label": "Next event",
  "description": "A countdown to your next community event.",
  "field.title": "Event name",
  "field.date": "Date and time",
  "field.date.hint": "ISO format, for example 2026-12-24T20:00",
  "field.accent": "Use the community accent colour",
  "days": "days", "hours": "hours", "minutes": "min",
  "past": "This event has already taken place.",
  "invalid": "Invalid date."
}
```

`i18n/fr.json`

```json
{
  "label": "Prochain événement",
  "description": "Un compte à rebours vers le prochain rendez-vous de la communauté.",
  "field.title": "Nom de l'événement",
  "field.date": "Date et heure",
  "field.date.hint": "Format ISO, par exemple 2026-12-24T20:00",
  "field.accent": "Utiliser la couleur d'accent de la communauté",
  "days": "jours", "hours": "heures", "minutes": "min",
  "past": "Cet événement a déjà eu lieu.",
  "invalid": "Date invalide."
}
```

### 11.4 Le code

```js
// ui/widget.js
const STYLE = `
  .wrap {
    background: var(--nodyx-bg-elevated);
    color: var(--nodyx-fg);
    border: 1px solid var(--nodyx-border);
    border-radius: var(--nodyx-radius-md);
    padding: var(--nodyx-space-4);
    font-family: var(--nodyx-font);
  }
  .title { font-weight: 600; margin-bottom: var(--nodyx-space-2); }
  .row   { display: flex; gap: var(--nodyx-space-4); }
  .n     { font-size: 28px; font-weight: 700; line-height: 1; }
  .n.accent { color: var(--nodyx-accent); }
  .u     { font-size: 12px; color: var(--nodyx-fg-muted); }
  .msg   { color: var(--nodyx-fg-muted); font-size: 14px; }
`

export function mount({ root, nodyx }) {
  const style = document.createElement('style')
  style.textContent = STYLE
  root.append(style)

  const wrap = document.createElement('div')
  wrap.className = 'wrap'
  root.append(wrap)

  let timer = null

  function render() {
    const cfg    = nodyx.config
    const target = new Date(cfg.date ?? '')
    const accent = cfg.accent !== false

    if (Number.isNaN(target.getTime())) {
      wrap.replaceChildren(text('msg', nodyx.t('invalid')))
      return
    }

    const left = target.getTime() - Date.now()
    if (left <= 0) {
      wrap.replaceChildren(text('title', cfg.title ?? ''), text('msg', nodyx.t('past')))
      return
    }

    const d = Math.floor(left / 86400000)
    const h = Math.floor(left / 3600000) % 24
    const m = Math.floor(left / 60000) % 60

    const row = document.createElement('div')
    row.className = 'row'
    for (const [value, unit] of [[d, 'days'], [h, 'hours'], [m, 'minutes']]) {
      const cell = document.createElement('div')
      const n    = text('n', String(value))
      if (accent) n.classList.add('accent')
      cell.append(n, text('u', nodyx.t(unit)))
      row.append(cell)
    }
    wrap.replaceChildren(text('title', cfg.title ?? ''), row)
  }

  function text(cls, value) {
    const el = document.createElement('div')
    el.className = cls
    el.textContent = value          // jamais innerHTML avec une valeur de config
    return el
  }

  function start() { stop(); render(); timer = setInterval(render, 30_000) }
  function stop()  { if (timer) clearInterval(timer); timer = null }

  const offs = [
    nodyx.on('config',  render),
    nodyx.on('locale',  render),
    nodyx.on('visible', ({ visible }) => visible ? start() : stop()),
  ]

  start()
  return { unmount() { stop(); offs.forEach(off => off()) } }
}
```

Quatre détails de ce code sont normatifs, pas cosmétiques :

- **`textContent`, jamais `innerHTML`** avec une valeur venant de la configuration. Un admin qui colle du HTML dans un champ texte ne doit pas se retrouver avec du script exécuté dans votre frame. Le bac à sable protège Nodyx de vous, il ne vous protège pas de vous même.
- **Le minuteur s'arrête quand la surface n'est pas visible.** Huit widgets qui battent la seconde sur une page d'accueil, c'est une page qui chauffe.
- **Tout est nettoyé dans `unmount`.** Une extension qui laisse un `setInterval` derrière elle fuit à chaque navigation.
- **Le thème et la langue sont réactifs.** Ils changent sans remontage.

### 11.5 Essayer en local

```bash
nodyx-ext dev
```

Un hôte simulé s'ouvre : votre surface dans une frame identique à la production, un panneau pour éditer la configuration en direct, basculer le thème clair et sombre, changer de langue, **et activer ou couper chaque permission une par une** pour voir ce que votre code fait quand une capacité manque. Le journal du pont affiche chaque appel, chaque refus, chaque quota.

Testez au minimum : visiteur non connecté, langue absente de vos bundles, champ facultatif vide, thème clair, largeur de colonne étroite.

### 11.6 Vérifier

```bash
nodyx-ext check
```

C'est **le validateur du serveur, en ligne de commande** : le même code, donc pas de surprise à l'installation. Il vérifie le manifeste contre le schéma, la parité et la complétude des bundles, les clés `@` orphelines, les chaînes en dur, les tailles, les SVG, et refuse `checkbox`.

### 11.7 Empaqueter

```bash
nodyx-ext pack        # produit next-event-1.0.0.nyx
```

### 11.8 Installer chez soi

Administration, Extensions, Installer un fichier. L'écran de permissions s'affiche même pour une extension qui n'en demande aucune : c'est la même porte pour tout le monde.

### 11.9 Publier

```bash
nodyx-ext publish
```

Ouvre le formulaire guidé de `extensions.nodyx.org`, qui produit une PR pré-remplie sur le dépôt `nodyx-extensions`. La CI valide le paquet, un mainteneur relit, l'index se régénère au merge. Voir §13.

---

## 12. Exemple avancé : la forme de la médiathèque

La médiathèque est l'extension de référence, celle qui a servi à valider que le SDK tient. Sa forme est un bon modèle pour toute application un peu ambitieuse.

```json
{
  "api": 1,
  "id": "library",
  "version": "1.0.0",
  "license": "AGPL-3.0-or-later",
  "default_locale": "en",
  "label": "@label",
  "description": "@description",
  "surfaces": [
    { "type": "page", "path": "library", "entry": "ui/page.js",
      "nav": { "label": "@nav.label", "icon": "twemoji:clapper-board" } },
    { "type": "widget", "id": "tonight", "entry": "ui/tonight.js", "label": "@widget.tonight",
      "schema": [ { "key": "mood", "type": "select", "label": "@field.mood", "options": [ /* ... */ ] } ] }
  ],
  "permissions": {
    "identity": ["id", "username", "locale"],
    "storage":  { "user": "1mb" },
    "network": {
      "api.themoviedb.org": { "methods": ["GET"], "paths": ["/3/movie/*"], "secret": "TMDB_API_KEY" },
      "image.tmdb.org":     { "methods": ["GET"], "paths": ["/t/p/*"] }
    }
  }
}
```

Les quatre décisions qui la font tenir :

1. **Le corpus est un asset, pas une base.** `data/works.json` est livré avec le paquet, chargé une fois, filtré et cherché en mémoire. Aucune permission n'est nécessaire pour son propre jeu de données, et le jour où il faudra un index côté serveur, ce sera une capacité du SDK, pas un privilège de plus pour l'extension.
2. **L'état personnel est dans `storage.user`.** Les films vus, les favoris, la note personnelle. C'est ce qui règle le point dur de la version satellite, où tout le monde partageait les mêmes cases cochées, et ça ne coûte aucune table.
3. **Les quatre écrans sont une seule surface `page`** avec un routage interne reflété dans l'URL par `nodyx.router`, donc des liens partageables.
4. **TMDB passe par le proxy**, la clé reste sur l'instance, et les affiches passent par `nodyx.imageUrl`. Le navigateur d'un membre ne signale jamais à un tiers ce qu'il regarde.

---

## 13. Publier au registre officiel

Conditions d'entrée :

- licence OSI et `source` pointant vers un dépôt public accessible
- `default_locale` complet, et l'anglais fortement recommandé pour la portée
- `nodyx-ext check` vert
- permissions justifiées dans la description : dites **pourquoi** vous demandez le réseau, pas seulement que vous le demandez
- une capture au minimum, une icône, une description qui n'est pas une phrase marketing

Ce qui fait refuser une soumission : une permission sans usage visible dans le code, du code volontairement illisible, la collecte de données personnelles non annoncée, un appel réseau vers un service de mesure d'audience, une icône SVG porteuse de script, un identifiant réservé.

Après publication, une version est **immuable**. Un correctif est une nouvelle version. C'est ce qui donne du sens au hash épinglé dans l'index.

---

## 14. Versionner

| Vous changez | Vous incrémentez |
|---|---|
| un correctif sans changement de contrat | correctif |
| une fonctionnalité, un champ de schéma facultatif, une locale | mineur |
| **une permission ajoutée**, un champ requis, une surface ajoutée ou retirée, une clé de stockage renommée | majeur |

Une mise à jour n'est jamais automatique. L'admin voit un **diff de capacités** : permissions ajoutées ou retirées, surfaces ajoutées, routes nouvelles. Une extension qui passe de widget à application complète a changé de nature, et ça se lit d'un coup d'œil.

Vos données survivent aux mises à jour : le stockage n'est jamais effacé par une montée de version. Si votre format change, **migrez à la lecture** (détectez l'ancien format, convertissez, réécrivez), jamais au démarrage en masse.

Une extension désinstallée voit ses données supprimées, en cascade. Prévenez l'utilisateur si son travail y vit.

---

## 15. Les dix pièges

1. **`manifest.json` dans un sous-dossier du zip.** Le plus fréquent, et l'installation échoue sans ambiguïté.
2. **Une chaîne en dur dans le manifeste.** Elle doit commencer par `@` et exister dans le bundle de `default_locale`.
3. **`checkbox` au lieu de `boolean`.** L'ancien format le tolérait, le SDK v1 le refuse.
4. **Supposer que `nodyx.user` existe.** Les visiteurs existent, et ils sont votre première impression.
5. **`innerHTML` avec une valeur de configuration ou une réponse réseau.** Le bac à sable protège Nodyx, pas votre propre interface.
6. **Lire puis écrire une clé partagée.** Dernière écriture gagnante, deux onglets suffisent à perdre une donnée.
7. **Un minuteur qui tourne hors écran**, et un `unmount` qui ne nettoie pas.
8. **Un appel réseau bloquant dans `mount`.** Cinq secondes, et l'hôte affiche une erreur à votre place.
9. **S'appuyer sur les variables CSS internes de Nodyx** au lieu des jetons `--nodyx-*`. Elles changent, votre extension aura l'air cassée.
10. **Demander une permission « au cas où ».** Elle s'affiche à l'admin avant l'installation, et elle réapparaît à chaque mise à jour.

---

## 16. Compatibilité

`api: 1` est le contrat décrit ici. Un `api` majeur ultérieur ne cassera pas les extensions existantes : l'hôte continuera de servir le SDK de la génération qu'une extension déclare, tant qu'elle reste supportée. Une dépréciation est annoncée au moins une version mineure de Nodyx à l'avance, visible dans `nodyx-ext check` avant de l'être à l'exécution.

Le format antérieur, celui des widgets `.zip` en Web Component sans champ `api`, **n'est pas supporté**. Il n'a jamais eu de frontière de sécurité, et une seule extension l'utilisait. Migration : remplacez `customElements.define('nodyx-widget-<id>', ...)` par un module qui exporte `mount`, remplacez `this.dataset.config` par `nodyx.config`, ajoutez `api`, `default_locale` et vos bundles.
