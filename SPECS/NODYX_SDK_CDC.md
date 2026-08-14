# CDC, SDK Nodyx et place de marché d'extensions

Statut : **VALIDÉ par Jonathan le 2026-08-14, révision 3, prêt à implémenter (P0-A)**
Date : 2026-08-14 (r1 le matin, r2 après revue croisée cf §16, r3 après validation)
Auteur : session Nodyx
Préalable au code (règle maison : CDC formel avant tout module critique)

---

## 0. Ce que ce document tranche

| # | Question | Décision proposée |
|---|---|---|
| D1 | Réconcilier les deux systèmes de widgets ? | **Un seul contrat, deux étages** : natif compilé (dans le dépôt, plein pouvoir) et extension tierce (paquet, bac à sable). Le catalogue, le builder et la doc ne connaissent qu'un vocabulaire. |
| D2 | Isolation du code tiers | **iframe à origine opaque** (`sandbox="allow-scripts"`, sans `allow-same-origin`), pont `postMessage`. Frontière garantie par le navigateur, zéro moteur d'isolation à écrire. |
| D3 | Une extension peut-elle livrer du code serveur ? | **Non, jamais.** Elle obtient du stockage clé/valeur cloisonné, un proxy réseau sur liste blanche, et des lectures cadrées du core. Aucune migration, aucune route, aucun process tiers. |
| D4 | Points d'accroche v1 | **page pleine** (entre les sidebars) et **widget** (grille d'accueil). Le reste plus tard. |
| D5 | i18n d'une extension | Les chaînes du manifeste sont des **clés**, résolues dans les bundles livrés avec le paquet. `default_locale` obligatoire, refus à l'installation sinon. |
| D6 | Distribution | **Une vitrine et un tuyau** : satellite `nodyx-store` sur `extensions.nodyx.org` (site public façon extensions.joomla.org) qui sert aussi l'index JSON signé consommé par les instances. Publication par PR GitHub assistée, zéro infra à opérer, **zéro monétisation, zéro étoile**. La vitrine est une surface de visibilité durable, donc soumise aux exigences de fabrication de §9.9 (i18n, design, référencement). |
| D7 | Compatibilité | `api: 1` dans le manifeste. Le format actuel (sans `api`) est **cassé volontairement** : un seul widget existe et il est à nous. `video-player` est **repaqueté en extension v1**, pas passé en natif (révisé le 2026-08-14, cf §12). |
| D9 | Embarquement de fournisseurs tiers | **Primitive rendue par l'hôte, en v1.** Une extension ne peut pas encadrer un tiers depuis le bac à sable, c'est mesuré (§12). Elle appelle `nodyx.ui.embed()`, l'hôte pose la frame du fournisseur depuis une liste livrée avec Nodyx. |
| D8 | Vocabulaire | **Extension** = le paquet distribué. Deux types : **Widget** (bloc du frontpage editor) et **Module** (application avec ses pages, ex la médiathèque). Les 35 interrupteurs natifs de `/admin/modules` deviennent les **Fonctionnalités**. Le mot « plugin » sort du vocabulaire. |

Le banc d'essai qui valide tout : **la médiathèque devient une extension**. Si le bac à sable ne la porte pas, le bac à sable est faux.

---

## 1. Déclencheur

Deux pages jugées trop pauvres : `nodyx.dev/create-widget` (13 Ko de tutoriel honnête mais qui s'arrête au « hello world ») et `nodyx.org/admin/widgets`. Le vrai problème est en dessous : **il n'y a rien à documenter de plus, parce que le SDK n'existe pas.** Un widget reçoit trois attributs JSON et se débrouille.

### 1.1 État réel du code, vérifié le 2026-08-14

Quatre vocabulaires cohabitent aujourd'hui :

| Nom | Où | Quoi | Installable ? |
|---|---|---|---|
| **Modules** | table `modules` (migration 062), `nodyx-frontend/src/lib/modules.ts` | 35 fonctionnalités natives avec un interrupteur | Non, registre figé |
| **Plugins homepage** | descripteurs `homepage/plugins/*.ts` (10 plus `_types.ts` et `index.ts`), composants `homepage/widgets/*.svelte` (10) | Descripteur typé plus composant Svelte compilé dans le frontend | Non, il faut un commit et un build |
| **Widgets installés** | table `installed_widgets` (071), `uploads/widgets/<id>/`, `widgetStore.ts` | Web Component IIFE livré en `.zip` | Oui, et c'est le seul chemin tiers |
| **Templates de table** | `plugins/table-templates/*/template.json` | Thèmes JSON pour le canvas | Sans rapport, mais le mot « plugin » y traîne |

`catalog.ts` préfigure déjà la fusion des deux premiers étages avec son type `CatalogEntry`. C'est la bonne intuition, ce CDC la termine.

### 1.2 Le trou, mesuré

`DynamicWidget.svelte` charge le JS du widget par `document.head.appendChild(<script src="/api/v1/widget-assets/...">)`. Le Shadow DOM isole **les styles**, pas le JavaScript : le code tourne dans le contexte principal de la page, avec tous les droits de la page.

Or `+layout.server.ts` renvoie `token` dans les données de layout, donc le JWT de session est sérialisé dans la charge SSR de chaque page pour un utilisateur connecté. La CSP (`script-src 'self'` avec nonce) ne bloque rien : le script du widget est servi par notre propre origine à travers Caddy.

Conclusion factuelle, sans dramatisation : **installer un widget aujourd'hui, c'est donner son instance à son auteur.** Le widget peut lire le jeton de session de tout visiteur connecté qui charge la page d'accueil, l'owner compris, appeler n'importe quelle route `/api/v1` en son nom, et réécrire la page.

C'est acceptable tant qu'un widget = du code qu'on a écrit ou lu. Ça ne l'est plus une seconde après l'ouverture d'une place de marché. **Le bac à sable n'est pas une option de confort du SDK, c'est sa condition d'existence**, exactement comme l'ICE complet pour l'auto-hébergement.

---

## 2. Principes directeurs

1. **Une extension ne peut pas nuire.** Ce qu'elle n'a pas demandé, elle ne l'a pas. Ce qu'elle a demandé, l'admin l'a vu et accepté.
2. **Le core reste sanctuaire.** Aucun code tiers dans le process API, aucune migration tierce dans la séquence numérotée.
3. **Aucun octet du visiteur ne part chez un tiers.** Tout appel réseau d'une extension passe par l'instance. C'est la traduction technique du « zéro analytics ».
4. **L'instance vit sans nodyx.org.** Le registre par défaut est un service de confort, remplaçable et contournable (installation par fichier).
5. **Gratuit.** Pas de paiement, pas de commission, pas de classement sponsorisé. La monétisation a déjà été refusée, elle reste refusée.
6. **L'i18n part avec la fonctionnalité**, pour les extensions comme pour le reste.
7. **Le plein pouvoir reste accessible** : c'est de l'AGPL auto-hébergé. Qui veut un composant sans limite écrit un widget natif dans son fork. Ce n'est pas un cas dégradé, c'est le chemin prévu.

---

## 3. Les deux étages (D1)

```
                     MEME CONTRAT (manifeste, schéma de config, i18n, thème)
   ┌──────────────────────────────┬──────────────────────────────────────┐
   │  ETAGE 1, NATIF              │  ETAGE 2, EXTENSION                  │
   ├──────────────────────────────┼──────────────────────────────────────┤
   │  Composant Svelte du dépôt   │  Paquet .nyx installé par l'admin    │
   │  Compilé dans le frontend    │  Chargé au runtime dans une iframe   │
   │  Contexte principal          │  Origine opaque, permissions         │
   │  Ajout = une PR relue        │  Ajout = un clic                     │
   │  Ex : hero-banner, header,   │  Ex : médiathèque, et tout ce que    │
   │       video-player           │       la communauté écrira           │
   └──────────────────────────────┴──────────────────────────────────────┘
```

Ce qui est commun : l'identité (`id`, `label`, `icon`, `family`), le schéma de configuration (`FieldSchema`, déjà typé), la résolution i18n, les jetons de thème, la place dans le catalogue du builder, la page de doc générée.

Ce qui diffère : le runtime, et rien d'autre.

**On ne fait pas passer les natifs par le bac à sable** : ils y perdraient Svelte, les stores partagés et la fluidité, contre une sécurité qui n'a pas de sens pour du code du dépôt. **On ne fait pas entrer de code tiers dans le bundle** : c'est le modèle qu'on remplace.

Le fichier `catalog.ts` devient le point de fusion officiel (`CatalogEntry` v2), `PLUGIN_REGISTRY` est renommé `NATIVE_WIDGETS`, le dossier de descripteurs `homepage/plugins/` devient `homepage/natives/`. Attention, `homepage/widgets/` existe déjà et contient les 10 composants Svelte : il ne bouge pas, et `widgets/native/` n'est donc pas une cible de renommage valide. Le mot « plugin » disparaît du code et de la doc.

### 3.1 `CatalogEntry` v2, orienté surfaces

Le `CatalogEntry` actuel est modelé sur le widget d'accueil : `schema`, `entry`, `family`, et une union discriminée `native | installed`. Ça ne suffit plus, parce que `kind` y mélange deux questions distinctes : **ce qu'est l'extension** et **comment on l'exécute**.

```
CatalogEntry v2
├── identity      id, version, author, source, license
├── presentation  label, description, icon, family   (clés i18n résolues)
├── surfaces[]    { type, id, route?, configSchema?, nav? }
├── localization  default_locale, locales livrées
├── capabilities  permissions demandées, telles qu'accordées
└── runtime       'native' | 'sandboxed'
```

**Le catalogue ne décide pas du runtime, il le porte.** Il répond à « qu'est-ce que c'est, et où ça peut vivre ». C'est le renderer qui tranche : surface native, on monte le composant Svelte ; surface tierce, on monte la frame. Cette séparation est ce qui permet, plus tard, de déplacer un widget natif vers un paquet, ou l'inverse, sans toucher au builder.

---

## 4. Le bac à sable (D2)

### 4.1 La frontière

```html
<iframe sandbox="allow-scripts"
        src="/api/v1/extensions/<id>/<version>/frame?surface=<sid>"
        referrerpolicy="no-referrer"
        allow=""></iframe>
```

Drapeaux du bac à sable : **`allow-scripts` et rien d'autre**. Pas de `allow-same-origin`, pas de `allow-top-navigation`, pas de `allow-popups`, pas de `allow-modals`, pas de `allow-forms`, pas de `allow-downloads`. Toute demande d'ajout d'un drapeau se traite comme un changement de modèle de sécurité, pas comme un réglage.

`allow-scripts` sans `allow-same-origin` place le document dans une **origine opaque**. Conséquences, garanties par le navigateur, pas par notre code :

- `document.cookie` inaccessible, `localStorage` et `sessionStorage` lèvent une exception
- `window.parent.document` inaccessible, la messagerie est le seul canal
- aucune requête ne peut porter les cookies de l'instance
- la charge SSR de la page hôte, donc le jeton de session, est hors de portée

**Trois origines à ne jamais confondre**, parce que le raccourci est la source d'erreur classique :

| | Quoi | Valeur |
|---|---|---|
| origine hôte | la page Nodyx qui monte la frame | `https://instance.example` |
| origine du document de frame | ce que voit le code de l'extension | **opaque**, `null` |
| origine qui sert le document | d'où vient l'octet HTML | `https://instance.example` |

Conséquence directe : **`Origin: null` n'est jamais une authentification.** C'est une conséquence du bac à sable, que n'importe qui peut produire. L'identité vient du `ext_token`, uniquement.

### 4.2 Le document d'accueil

Servi par le core, minimal, avec une CSP explicite (on écrit l'origine en clair : dans une origine opaque, `'self'` ne matche rien) :

```
Content-Security-Policy:
  default-src     'none';
  script-src      'nonce-<n>' <origine_instance>;
  style-src       'nonce-<n>' <origine_instance>;
  style-src-attr  'unsafe-inline';
  img-src         <origine_instance> data: blob:;
  media-src       <origine_instance> blob:;
  connect-src     <origine_instance>;
  frame-src       'none';
  form-action     'none';
  base-uri        'none';
```

**Cette politique est servie DEUX FOIS : en en-tête de réponse, et en `<meta http-equiv="Content-Security-Policy">` dans le document lui même.** Ce n'est pas de la ceinture et bretelles décorative, c'est une nécessité vérifiée le 2026-08-14 sur notre propre production :

- le proxy de nodyx.org pose la politique du site avec l'opération **`set`**, donc il **remplace** celle que l'application envoie, y compris sur `/api/v1/*` (constaté : une réponse d'API porte la CSP du site)
- un en-tête seul serait donc effacé, et le document de frame hériterait de la politique permissive du site, ce qui rouvrirait le réseau sortant direct depuis la frame et annulerait le principe 3
- une balise `meta` n'est pas réécrite par un proxy. Quand les deux politiques coexistent, le navigateur applique **l'intersection**, donc la plus stricte l'emporte directive par directive : le résultat est correct avec ou sans proxy réécrivant

Cette contrainte n'est pas propre à notre hébergement. Un produit auto-hébergé tourne derrière le proxy que son administrateur a choisi, et beaucoup de configurations toutes faites imposent des en-têtes de sécurité. **Une frontière de sécurité ne doit jamais dépendre d'un en-tête qu'un intermédiaire peut réécrire.**

À noter, l'isolation elle même ne dépend pas de la CSP : elle vient de l'origine opaque, portée par l'attribut `sandbox`, que rien d'externe ne peut modifier. La CSP est la défense en profondeur, et c'est elle qui interdit le réseau direct.

Trois précisions qui évitent une CSP de façade :

- **pas de `'unsafe-inline'` dans `style-src`.** Un nonce le neutralise de toute façon quand les deux sont présents, donc l'écrire ne fait que masquer l'intention. Les attributs `style=""` dynamiques, eux, sont réels et fréquents : ils passent par `style-src-attr`, exactement comme le frontend principal le fait déjà.
- **le JS d'extension est un asset same-origin**, chargé par balise depuis `<origine_instance>`, jamais inline. Seul l'amorceur injecté par l'hôte porte le nonce. C'est ce qui permet la mise en cache par version.
- `frame-src 'none'` : une extension ne peut pas embarquer d'iframe tierce en v1 (voir §12, limite assumée).

**Deux exigences découvertes en production le 2026-08-14, qui n'étaient dans aucune version antérieure de ce document, et sans lesquelles aucune surface ne démarre.**

**1. Les ressources de la frame doivent accepter `Origin: null`, sans identifiants.** Une frame en origine opaque envoie littéralement `Origin: null`, et un script de module comme tout `import()` est récupéré en mode CORS. Une politique CORS qui refuse cette valeur fait échouer le chargement du SDK, donc tout. L'exigence est bornée et ne relâche rien : elle vaut **uniquement pour `/api/v1/extensions/*`**, et **sans `credentials`**, donc le navigateur n'envoie aucun cookie. Ces routes servent soit des fichiers publics, soit des données protégées par le jeton d'extension passé en en-tête, qu'un tiers n'a pas. L'exposition est celle d'un `Access-Control-Allow-Origin: *` sur un fichier statique public.

   Accepter `Origin: null` **globalement et avec identifiants** serait en revanche dangereux : n'importe quel site ouvrirait une frame en bac à sable et lirait des réponses authentifiées. La distinction est tout le sujet.

**2. La page hôte doit pouvoir encadrer sa propre origine.** Sa politique de sécurité a besoin de `'self'` dans `frame-src`. Une politique qui l'omet interdit à une page d'encadrer une frame venant de son propre domaine, donc aucune extension ne démarre, quoi que fasse le code. Constaté sur trois instances de production dont la configuration de proxy avait divergé du dépôt, et qui cassait déjà, pour la même raison, l'aperçu en iframe du canevas Scènes de l'administration.

### 4.3 Les assets

Servis par `GET /api/v1/extensions/:id/:version/assets/*`, avec la version dans le chemin : une mise à jour invalide le cache d'elle-même, et une frame ouverte ne peut pas se retrouver à mélanger l'ancien et le nouveau code.

Règles : chemin validé et aplati, aucun `..`, aucun lien symbolique, `Content-Type` déterminé par le serveur depuis une table blanche d'extensions (jamais deviné depuis le contenu), `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`.

**La route publique `/api/v1/widget-assets/:id/:file` disparaît avec P0.** Elle sert aujourd'hui du JS tiers en `application/javascript` sur l'origine principale, ce qui est précisément le chemin qu'on supprime. Le JS d'une extension n'est jamais chargeable comme script de la page hôte.

### 4.4 Séquence de démarrage

```
hôte                                        frame (origine opaque)
 │  1. POST /extensions/<id>/session ────────────────────────────►  core
 │     (jeton utilisateur réel)                                     mint jeton d'extension
 │  ◄──── ext_token (10 min, scope = id + user + permissions)
 │
 │  2. monte l'iframe
 │                                          3. charge le SDK hôte (nodyx.js)
 │  ◄──── postMessage { type: 'hello' }
 │  4. postMessage { ext_token, config, user?, instance, locale,
 │                   messages, theme } ────────────────────────►
 │                                          5. Nodyx.connect() résout
 │  ◄──── postMessage { type: 'resize', h } (ResizeObserver)
```

Le SDK (`nodyx.js`) est **servi par l'hôte**, jamais empaqueté par l'auteur. Sa version suit toujours celle de l'instance, donc pas de dérive de contrat.

### 4.5 Le canal : `MessageChannel`, pas `window.postMessage`

Avec une origine opaque, `event.origin` vaut `"null"` et ne prouve rien, et `window` est écoutable par tout ce qui obtient une référence. Filtrer les messages à la main est donc fragile.

**L'hôte n'envoie qu'un seul message sur `window` : le message d'amorçage, qui transfère un `MessagePort`.** Tout le reste passe par ce port privé, non énumérable, propre à cette frame et à cette session. Une autre frame ne peut pas s'y adresser, il n'y a rien à usurper. En complément, l'hôte vérifie `event.source === iframe.contentWindow` sur ce message unique.

### 4.6 Le protocole, versionné et corrélé

```jsonc
// requête, dans les deux sens
{ "p": 1, "id": "c3f1", "ext": "library", "surface": "page",
  "type": "storage.get", "payload": { "key": "watched" } }

// réponse, toujours corrélée
{ "p": 1, "id": "c3f1", "ok": true,  "result": [ ... ] }
{ "p": 1, "id": "c3f1", "ok": false, "error": { "code": "QUOTA_EXCEEDED", "message": "..." } }

// notification hôte vers extension, sans réponse attendue
{ "p": 1, "event": "theme" | "locale" | "config" | "route" | "session", "payload": { ... } }
```

`p` est la version du protocole, indépendante de `api` du manifeste. Un `id` inconnu, déjà consommé, ou reçu avant la fin de la poignée de main est rejeté et journalisé. Les codes d'erreur sont en SCREAMING_SNAKE_CASE, cohérents avec la règle maison des réponses du core.

### 4.7 Le `ext_token`

JWT court signé par le core, lié à tout ce qui doit l'être :

```jsonc
{
  "iss": "https://instance.example",   // l'instance émettrice
  "aud": "nodyx-extension",            // ne vaut que pour les routes extension
  "ins": "<instance_id>",              // pas rejouable sur une autre instance
  "ext": "library",                    // pas rejouable par une autre extension
  "sur": "page",                       // pas rejouable sur une autre surface
  "sub": "<user_id | null>",           // null pour un visiteur
  "prm": ["storage.user", "identity"], // permissions accordées, pas demandées
  "jti": "...", "iat": ..., "exp": ... // 10 minutes
}
```

Les routes `/api/v1/extensions/:id/*` acceptent ce jeton, acceptent `Origin: null`, et **n'acceptent jamais le cookie de session ni le jeton utilisateur**. Un `jti` révoqué (désinstallation, désactivation, retrait de permission) est refusé immédiatement.

**Le jeton ne transite que par le port privé.** Jamais dans une URL, un `src`, un référent, un journal ou un message d'erreur. Le renouvellement est **à la demande de la frame** (`session.renew`), l'hôte re-frappe un jeton auprès du core avec la session utilisateur réelle : il n'y a pas de flux périodique qui pousse des JWT dans la frame.

### 4.8 Le pont, surface exposée au développeur

```js
const nodyx = await Nodyx.connect()

nodyx.config                       // config du builder, typée par le schéma du manifeste
nodyx.user                         // { id, username, avatar, locale } ou null, selon permission
nodyx.instance                     // { name, memberCount, onlineCount, logoUrl }
nodyx.locale                       // 'fr' | 'en' | ...
nodyx.t('key', { count: 3 })       // bundle de l'extension, interpolation {{}}
nodyx.theme                        // jetons résolus, CSS déjà injecté dans la frame

await nodyx.storage.get('watched')            // scope user par défaut
await nodyx.storage.set('watched', [...])
await nodyx.storage.list({ scope: 'instance' })

await nodyx.fetch('https://api.themoviedb.org/3/movie/603')   // proxy, liste blanche
await nodyx.core.get('members', { limit: 20 })                // scopes de lecture

await nodyx.ui.confirm({ title, body })       // rendu par l'HOTE, hors de la frame
nodyx.ui.toast('ok')
nodyx.router.push('/film/42')                 // reflété dans l'URL de l'hôte
nodyx.on('theme' | 'locale' | 'config' | 'route', cb)
```

Les dialogues et toasts sont **rendus par l'hôte** : une frame ne peut pas dessiner par-dessus la page, et on ne veut pas qu'elle le puisse. Bénéfice collatéral, une extension a le look Nodyx sans effort.

### 4.9 Ce qui est refusé, définitivement

Le jeton de session, les cookies, le DOM de l'hôte, le contenu des DM, les e-mails, toute route admin, l'écriture sur les ressources du core en v1, l'exécution serveur, l'accès disque, les iframes tierces (v1).

---

## 5. Le manifeste v1

```json
{
  "api": 1,
  "id": "library",
  "version": "1.0.0",
  "nodyx_min": "2.13.0",
  "license": "AGPL-3.0-or-later",
  "author": { "name": "Nodyx", "url": "https://github.com/Pokled/nodyx" },
  "source": "https://github.com/Pokled/nodyx-library",

  "default_locale": "en",
  "label":       "@ext.label",
  "description": "@ext.description",
  "icon":        "icon.svg",
  "family":      "content",

  "surfaces": [
    {
      "type": "page",
      "path": "library",
      "entry": "ui/page.js",
      "nav": { "label": "@nav.label", "icon": "twemoji:clapper-board" }
    },
    {
      "type": "widget",
      "id": "tonight",
      "entry": "ui/widget.js",
      "label": "@widget.tonight",
      "schema": [
        { "key": "mood", "type": "select", "label": "@widget.mood",
          "options": [{ "value": "learn", "label": "@mood.learn" }] }
      ]
    }
  ],

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
      },
      "image.tmdb.org": { "methods": ["GET"], "paths": ["/t/p/*"] }
    }
  }
}
```

Règles dures, vérifiées à l'installation :

- toute chaîne visible commence par `@` et est une clé, résolue dans `i18n/<locale>.json` ; une clé absente du bundle `default_locale` fait **échouer** l'installation
- `type` de champ : `text | textarea | url | number | boolean | select | color | image`. `checkbox` est refusé (la tolérance actuelle de `catalog.ts` disparaît, le SDK impose `boolean`)
- une permission inconnue fait échouer l'installation, elle n'est pas ignorée
- `id` en minuscules, chiffres et tirets, unique, et **refusé s'il appartient au domaine réservé natif**. Le validateur connaît la liste des identifiants natifs : ce n'est pas « le natif gagne à l'affichage », c'est « l'installation est refusée ». La règle actuelle `filter(m => !PLUGIN_REGISTRY[m.id])` masque une collision, elle ne l'empêche pas.
- une permission `network` déclare **hôte, méthodes et préfixes de chemin**. Un hôte nu, sans méthode ni chemin, est refusé : l'écran de permissions doit pouvoir dire « peut lire les fiches publiques TMDB (GET /3/movie/...) », pas « accès réseau à api.themoviedb.org ».
- taille du paquet plafonnée (proposition : 20 Mo, dataset compris), nombre de fichiers plafonné, profondeur de répertoires plafonnée

Le manifeste a un **JSON Schema versionné dans le dépôt**, et la page de doc est générée à partir de lui. Une seule source de vérité pour le validateur, l'IDE et la documentation.

---

## 6. Permissions et capacités

### 6.1 `storage`

Deux portées : `user` (par utilisateur connecté) et `instance` (partagé). Quatre capacités distinctes, jamais implicites : `storage.user`, `storage.instance.read`, `storage.instance.write`.

**Règle des deux axes.** La permission de l'extension et les droits de l'utilisateur sont deux axes séparés, et le droit effectif est leur **intersection**. Une extension qui détient `storage.instance.write` n'écrit pas parce qu'un membre a ouvert son interface : elle écrit dans le cadre de ce que ce membre a le droit de déclencher. Une capacité accordée par l'admin à l'installation n'est jamais une élévation de privilège pour l'utilisateur courant.

Migration `1xx_extensions.sql`, numéro attribué au moment de l'implémentation. La branche et `origin/main` sont à **111** au 2026-08-14, donc 112 aujourd'hui, mais on ne fige pas un numéro dans une spécification : deux branches qui avancent en parallèle produiraient une collision.

```sql
CREATE TABLE installed_extensions (
  id            TEXT        PRIMARY KEY,
  manifest      JSONB       NOT NULL,
  version       TEXT        NOT NULL,
  origin        TEXT        NOT NULL,          -- 'file' | 'registry:<host>'
  sha256        TEXT        NOT NULL,
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  granted       JSONB       NOT NULL DEFAULT '{}',   -- permissions acceptées par l'admin
  installed_by  UUID        REFERENCES users(id),
  installed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE extension_storage (
  extension_id TEXT        NOT NULL REFERENCES installed_extensions(id) ON DELETE CASCADE,
  scope        TEXT        NOT NULL CHECK (scope IN ('instance','user')),
  user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
  key          TEXT        NOT NULL,
  value        JSONB       NOT NULL,
  bytes        INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (extension_id, scope, user_id, key)
);

CREATE TABLE extension_secrets (
  extension_id TEXT NOT NULL REFERENCES installed_extensions(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        TEXT NOT NULL,          -- jamais renvoyé par l'API, injecté côté serveur
  PRIMARY KEY (extension_id, name)
);
```

`UNIQUE NULLS NOT DISTINCT` exige PostgreSQL 15+, la prod est en 16.14.

**Un quota en octets ne suffit pas.** Une extension peut faire exploser le CPU et la base sans jamais dépasser 1 Mo. Limites appliquées, toutes en dur côté serveur :

| Limite | Valeur proposée |
|---|---|
| longueur d'une clé | 128 caractères |
| taille d'une valeur | 64 Ko |
| nombre de clés par portée | 500 |
| profondeur JSON | 16 niveaux |
| écritures | 30 par minute et par utilisateur, par extension |
| total | le quota déclaré au manifeste, accordé par l'admin |

Dépassement : erreur nette avec un code stable, jamais de purge silencieuse.

### 6.2 `identity`

Liste explicite de champs. Jamais l'e-mail, jamais le rôle admin sans demande. Visiteur non connecté : `nodyx.user === null`, l'extension doit fonctionner quand même (règle de vue invité, déjà apprise à nos dépens côté i18n).

### 6.3 `core`, lectures cadrées

v1 en lecture seule, avec **les droits de l'utilisateur courant**, jamais élevés : `members:read`, `forum:read`, `instance:read`. L'écriture arrive en v2, avec consentement par action. Un visiteur anonyme ne voit que le public, comme partout ailleurs.

### 6.4 `network` et `secrets`, le proxy

Aucune requête sortante depuis la frame. Et le proxy **n'est pas un `fetch` générique derrière une liste blanche** : c'est une API de données bornée par ce que le manifeste a déclaré et que l'admin a accepté. La différence se voit à l'écran de permissions, qui doit rester lisible par un humain.

`nodyx.fetch()` tape `POST /api/v1/extensions/:id/fetch`, qui applique dans l'ordre :

1. **hôte, méthode et préfixe de chemin** vérifiés contre la déclaration accordée. Le port est celui du schéma (443), un port explicite non déclaré est refusé.
2. **résolution DNS puis validation de l'adresse obtenue**, et connexion **à cette adresse** (épinglage). Vérifier le nom avant de résoudre ne protège de rien : un nom public qui résout en adresse privée est le contournement classique.

   **Trois niveaux, pas un interdit** (révisé le 2026-08-14). Une instance Nodyx vit très bien sur un intranet d'entreprise, un réseau domestique, ou une simple adresse IP sans nom de domaine. Refuser en bloc les adresses privées reviendrait à interdire les extensions qui servent justement à parler aux services de cette maison, et à réserver le SDK aux instances publiques. Ce n'est pas notre public.

   | Cible | Traitement |
   |---|---|
   | adresse publique | déclarable, accordée comme tout appel sortant |
   | **réseau privé** : RFC1918, ULA, partage d'adresse opérateur, `.local`, `.internal`, `.lan`, `.home.arpa` | déclarable, mais exige un **accord explicite et distinct de l'admin**, montré à part sur l'écran de permissions : « cette extension veut joindre `10.0.0.5`, une machine de votre réseau interne » |
   | **boucle locale et lien local** : `127.0.0.0/8`, `::1`, `localhost`, `169.254.0.0/16` | **jamais**, même avec l'accord de l'admin |

   La dernière ligne n'est pas une rigidité de principe : ces cibles sont la machine de l'instance elle même, donc sa base, son cache, son API interne et les métadonnées d'identité de l'hébergeur. Un admin n'y gagne rien de légitime qu'il n'obtienne en exposant son service sur l'adresse de son réseau. Pour le développement, une variable d'environnement dédiée lève la restriction sur une instance de développement, jamais en production.

   Restent refusés en toute circonstance : multicast, diffusion, plages réservées, adresses mappées et écritures exotiques d'IP.
3. **redirections limitées à 3, chacune revalidée intégralement** (hôte, chemin, adresse résolue).
4. **secrets injectés par le serveur, selon une recette que le serveur possède** (nom de l'en-tête ou du paramètre, emplacement). L'extension déclare `"secret": "TMDB_API_KEY"` et ne choisit ni le nom de l'en-tête ni sa destination. Sans ça, `nodyx.fetch()` pourrait demander `X-Peu-Importe: <secret>` vers un hôte contrôlé et récupérer indirectement ce qu'il n'a pas le droit de voir.
5. **en-têtes filtrés dans les deux sens** (liste blanche courte à l'aller, `Set-Cookie` et compagnie retirés au retour).
6. **réponse plafonnée** : taille, délai, type de contenu, taux de compression (une archive zip de 10 Ko qui se décompresse en 10 Go est un déni de service).
7. **débit plafonné** par extension et par utilisateur, mis en cache selon les en-têtes.

Les images passent par le même chemin (`/extensions/:id/img?u=...`, réponse mise en cache). Coût : de la bande passante sur l'instance. Contrepartie : **le navigateur du visiteur ne parle à personne d'autre qu'à sa communauté**, et une clé d'API tierce ne fuit jamais.

Le SDK **n'expose jamais l'URL réelle du proxy** au développeur, seulement `nodyx.fetch(url)`. Sinon la première extension venue reconstruira l'appel à la main et le contrat deviendra une convention.

---

## 7. Points d'accroche (D4)

| Surface | v1 | Description |
|---|---|---|
| `widget` | oui | Bloc dans la grille de la page d'accueil, config par le builder, exactement là où vivent les widgets aujourd'hui |
| `page` | oui | Route `/x/<ext-id>/*` dans la coque de l'app, entre les sidebars, avec entrée de navigation optionnelle |
| `panel` | non, v2 | Panneau latéral contextuel |
| `card` | non, v2 | Enrichissement d'un lien cité dans le chat ou le forum, brancherait `services/linkPreview.ts` au-delà du fil social |
| `profile-tab` | non, v3 | Onglet sur la page profil |

La `page` est la nouveauté qui change la nature du système : jusqu'ici une extension ne pouvait qu'orner l'accueil. C'est elle qui permet à une vraie application, la médiathèque, d'exister sans toucher au core.

Correspondance avec les catégories du magasin (D8), corrigée : **une extension n'a pas de type global.** Elle expose des surfaces, et le magasin range par surface. Une extension qui livre une page et deux widgets apparaît dans Modules **et** dans Widgets, et sa fiche annonce « Page plus 2 widgets ». C'est ce que font Joomla et WordPress avec leurs listings multi-catégories, et ça évite une taxonomie artificielle où il faudrait trancher ce qu'« est » une extension mixte.

**Marqueur d'origine.** Toute surface d'extension est identifiée comme telle par l'hôte, **à l'extérieur de la frame** donc non falsifiable : un liseré discret et le nom de l'extension. Un membre doit pouvoir distinguer ce que dit Nodyx de ce que dit une extension, sinon une fausse invite de connexion dessinée dans un widget est indiscernable de la vraie. C'est le pendant visuel des dialogues rendus par l'hôte (§4.8), et la réponse à la non garantie N4 de `NODYX_SDK_SECURITY.md`.

Le manifeste ne porte donc **aucun champ `type`** : le rangement se déduit des surfaces, l'auteur ne déclare rien de plus, et une extension qui gagne une page en v1.1 change de rangement toute seule (ce que le diff de capacités de §9.5 rend visible).

---

## 8. Thème et i18n (D5)

**Thème** : l'hôte injecte dans la frame les jetons CSS résolus et pousse une mise à jour sur changement. Attention au piège maison des trois palettes parallèles (`--nx-*`, `--p-*`, `--n*`) : le SDK expose **un seul jeu de noms stables** (`--nodyx-bg`, `--nodyx-fg`, `--nodyx-accent`, `--nodyx-border`, `--nodyx-radius`, `--nodyx-font`), l'hôte fait la correspondance. Une extension câblée sur ces noms suit le thème de l'instance, quel que soit le système interne du moment.

**i18n** : bundles plats `i18n/<locale>.json` (clés à points, interpolation `{{}}`, pas de pluriel, comme le frontend). `default_locale` obligatoire et complet. Les autres locales sont un bonus, résolution en cascade : locale demandée, puis `default_locale`, puis la clé brute. Le store affiche les langues couvertes.

Pour les extensions **publiées par nous**, les quatre portes CI s'appliquent sans exception, et FR + EN sont livrés ensemble dans la même PR.

---

## 9. Empaquetage et distribution (D6)

### 9.1 Le paquet

```
library-1.0.0.nyx          (zip)
├── manifest.json
├── icon.svg
├── preview.png
├── LICENSE
├── i18n/{en,fr}.json
├── ui/{page.js, widget.js, style.css}
└── data/works.json        (dataset optionnel livré avec l'extension)
```

Extensions autorisées à l'extraction : `.js .css .json .svg .png .jpg .jpeg .webp .woff2 .md`. Aplatissement des chemins (protection zip slip, déjà en place dans `widgetStore.ts`), liens symboliques refusés, plafond de taille, plafond de nombre de fichiers, plafond de profondeur, plafond de ratio de décompression.

**Le SVG n'est pas une image.** `icon.svg` et `preview.png` sont affichés par l'admin et par le magasin, donc **hors du bac à sable**, sur l'origine principale. Un SVG peut porter `<script>`, des gestionnaires d'événements en attribut, des `<foreignObject>`, des références externes. Sans traitement, l'icône d'une extension devient une XSS sur la page d'administration, indépendamment de toute la §4.

Règle : tout SVG est **assaini à l'installation** (réécrit vers un sous-ensemble sûr : pas de script, pas d'attribut `on*`, pas de référence externe, pas de `foreignObject`), servi avec `Content-Type: image/svg+xml`, `nosniff` et `Content-Security-Policy: default-src 'none'`. Un SVG qui ne survit pas à l'assainissement fait échouer l'installation, il n'est pas silencieusement vidé.

### 9.2 La vitrine et le tuyau

Référence assumée : `extensions.joomla.org` et `fr.wordpress.org/plugins`. Un écosystème n'existe pas autour d'un fichier JSON, il existe autour d'un endroit où l'on flâne, où l'on lit une fiche, où l'on voit ce que les autres ont fait.

**Un seul satellite, `nodyx-store`, deux faces sur la même base** (SvelteKit plus SQLite plus PM2, le patron déjà éprouvé de `nodyx-hub` et de la médiathèque) :

| Face | Pour qui | Quoi |
|---|---|---|
| `extensions.nodyx.org` | humains | catalogue, catégories, fiches, guide de publication, formulaire de soumission |
| `/index.json` (+ `.sig`) | instances | index statique signé Ed25519, consommé par l'admin de chaque instance |

**L'admin d'instance n'embarque jamais le site en iframe.** Il consomme l'index et **rend le catalogue nativement**, comme le fait WordPress et contrairement à Joomla. Raisons : thème de l'instance respecté, i18n de l'instance, CSP propre, et surtout la doctrine tenue. Si `extensions.nodyx.org` tombe, une instance perd la découverte, pas l'installation ni ses extensions.

**La chaîne de confiance, en trois maillons qu'il ne faut pas confondre :**

```
clé publique du registre (épinglée dans l'instance)
        ↓  signe
index.json  (liste, versions, permissions, sha256 de chaque paquet)
        ↓  référence
sha256 du paquet
        ↓  vérifie
paquet .nyx téléchargé
```

Le `sha256` prouve l'intégrité du téléchargement, **pas l'authenticité** : si l'index est compromis, un hash cohérent avec un paquet malveillant l'est tout autant. C'est la signature de l'index qui porte l'authenticité, et la clé publique doit donc être livrée avec l'instance, pas récupérée depuis le registre lui-même.

**Une version publiée est immuable.** Un paquet republié sous le même numéro est refusé : un correctif est une nouvelle version. Sans cette règle, un hash épinglé ne veut plus rien dire. La signature par l'auteur, en plus de celle du registre, est un ajout naturel en v2.

### 9.3 Les catégories du magasin

Elles rangent par **surface exposée**, pas par nature de l'extension (§7). Une extension mixte apparaît dans plusieurs catégories, c'est voulu :

- **Widgets** : blocs du frontpage editor
- **Modules** : applications avec leurs pages, la médiathèque en tête
- **Thèmes** : v2, quand les jetons de thème seront stables
- filtres transverses : famille (`media`, `gaming`, `community`, `esport`, `social`, `content`), permissions demandées, langues, compatibilité `nodyx_min`, licence

### 9.4 La fiche

Ce qu'on reprend à Joomla et WordPress : captures, description longue, auteur et ses autres extensions, versions et changelog, compatibilité, licence et lien vers les sources, langues couvertes, nombre d'installations.

Ce qu'ils ne font pas et qui devient notre signature : **la fiche affiche les permissions demandées, en clair, avant l'installation**. « Cette extension peut : lire ton pseudo, stocker 1 Mo par membre, appeler `api.themoviedb.org` ». Leurs fiches disent ce qu'une extension fait, jamais ce qu'elle peut toucher.

**Pas d'étoiles.** Même raisonnement que la médiathèque : une moyenne sur trois votes est du bruit, et 4,2 sur 5 ne dit rien de ce qu'un paquet fait à ton instance. Des avis écrits courts, ou rien en v1.

Compteur d'installations : agrégé au téléchargement du paquet, sans stockage d'IP ni d'identifiant d'instance. Le « zéro analytics » vaut aussi pour nous.

### 9.5 Installer, et où le geste se produit

**Révisé le 2026-08-14, sur proposition de Jonathan, après essai réel du parcours.**

Le premier dessin faisait rebondir l'admin du site vers son instance, avec l'identifiant et le registre en paramètres d'URL. Ça marchait, mais ça créait un lien porteur d'un ordre d'installation, donc une surface d'attaque à défendre (`src` validé contre les registres configurés, POST confirmé, provenance affichée). Défendable, mais c'est une défense qu'on peut simplement ne pas avoir besoin d'écrire.

**Le geste se produit là où l'admin est déjà authentifié, et le passage d'un site à l'autre disparaît.**

| Où | Ce qu'on peut faire |
|---|---|
| `extensions.nodyx.org` | flâner, lire une fiche, voir les permissions, **télécharger** le `.nyx` |
| Administration de l'instance | parcourir le **même catalogue**, rendu nativement depuis l'index, et installer d'un bouton, ou téléverser le fichier qu'on vient de télécharger |

Trois conséquences, toutes bénéfiques :

- **Aucun lien ne porte un ordre d'installation.** La règle sur `src` devient sans objet : l'admin choisit dans une liste que son instance a chargée, il ne suit pas une URL qu'on lui a envoyée.
- **Le bouton d'installation n'existe que dans l'administration**, donc la condition « seulement si connecté en admin » est acquise par construction, sans code de garde supplémentaire.
- **Le site reste utile hors ligne du reste** : télécharger puis téléverser est un chemin complet, qui ne dépend d'aucun registre atteignable.

Le catalogue de l'administration est **redessiné à partir de l'index**, jamais le site embarqué en iframe (§9.2). Les raisons tiennent toujours : thème et langue de l'instance, politique de sécurité propre, et surtout un catalogue qui survit à l'indisponibilité du magasin.

La provenance reste affichée en clair sur l'écran de permissions, et l'installation reste un `POST` authentifié avec confirmation explicite.

**Jamais de mise à jour automatique.** Une mise à jour est une action d'admin, avec le changelog et surtout le **diff de capacités** en évidence. Pas seulement les permissions : ce qui compte, c'est le changement de profil de risque.

```
library  1.0.0 → 1.1.0

+ réseau     api.foo.com  (GET /v2/*)
+ stockage   instance.write
- identité   avatar
+ surface    page  /x/library/settings
```

Une extension qui passe de widget à application complète a changé de nature. Un ajout de surface, une nouvelle route, une nouvelle capacité se lisent au même endroit que les permissions. C'est l'instant précis où une extension honnête devient malveillante, il doit être visible sans effort.

### 9.6 Publier, côté développeur

Le site porte le parcours complet : pourquoi, comment fabriquer, comment tester, comment soumettre. **La documentation technique reste canonique sur `nodyx.dev`**, la vitrine y renvoie et ne la duplique pas (le coût de la doc en double est déjà connu de la maison).

Soumission : un **formulaire guidé qui génère la PR GitHub pré-remplie** sur le dépôt `nodyx-extensions`. La CI valide le paquet contre le JSON Schema du manifeste, un mainteneur relit, l'index se régénère au merge. Zéro service à opérer, zéro compte à gérer, zéro file de modération à héberger, et le développeur garde une trace publique de son travail. Upload direct avec comptes seulement si le volume le justifie un jour.

Modération : le magasin est le **niveau 2** du modèle de liberté à deux étages. Une instance installe ce qu'elle veut par fichier, le registre officiel, lui, est modéré.

### 9.7 Amorçage, le vrai risque

Un magasin vide tue sa propre crédibilité, et aujourd'hui l'écosystème compte **un** widget. Le jour de l'ouverture il faut douze fiches réelles : les 10 widgets natifs de la page d'accueil, `video-player`, la médiathèque. Elles seront marquées « officielles, préinstallées ». C'est aussi le meilleur test du format de fiche : si nos propres widgets y rentrent mal, ceux d'un tiers y rentreront plus mal encore.

### 9.8 Économie

Gratuit. Licence OSI et lien vers les sources exigés au registre officiel. Pas de paiement, pas de commission, pas de classement sponsorisé. Un registre tiers fait ce qu'il veut, c'est le choix de celui qui l'ajoute.

### 9.9 Exigences de fabrication de la vitrine

`extensions.nodyx.org` n'est pas un outil interne, c'est une **surface de visibilité durable** : une page par extension, indexée, partagée, citée, qui vivra des années. Elle se construit donc au niveau du reste, pas en vitesse.

**i18n, non négociable.** FR et EN dès le premier commit, aucune chaîne en dur, même pour un libellé de filtre. Le satellite reprend le patron déjà éprouvé sur la médiathèque (`src/lib/i18n/{fr,en}.json` plus un helper), et **les portes CI sont câblées sur le satellite lui-même** : les scripts de `nodyx-frontend/scripts/i18n/` sont partagés ou portés, pas réécrits. Ce qui est traduit : toute la chrome du site. Ce qui ne l'est pas : le contenu rédigé par un auteur d'extension, qui reste dans la langue qu'il a choisie, avec sa langue affichée sur la fiche.

**Design, la barre.** Références : Linear, Vercel, Stripe. Un catalogue est un **outil de navigation dense**, pas une page d'atterrissage.

| Règle | Détail |
|---|---|
| Rayons | l'échelle de la maison, mesurée : `lg` (8px) pour les surfaces, `sm`/`md` pour les champs, `full` réservé aux pastilles et aux avatars. **`2xl` et au-delà sont interdits** (40 et 1 occurrences dans tout le frontend, ce sont des accidents, pas un style) |
| Pas de gloss | pas de verre dépoli, pas de halo néon, pas de dégradé sur un bouton, pas d'ombre portée par défaut. Des aplats, une bordure discrète, **un seul accent** |
| Densité | la fiche et la liste montrent de l'information réelle (version, licence, langues, permissions), pas des cartes géantes à trois mots |
| Typographie | la pile du frontend, deux graisses, une échelle. Aucune police chargée depuis un tiers |
| Thèmes | clair et sombre, `prefers-color-scheme` respecté, contraste AA vérifié, focus visible, navigation clavier complète |
| Copie | **aucun tiret cadratin**, ni en FR ni en EN. Deux-points ou virgule. Ton factuel, zéro superlatif marketing |
| Captures | ce sont elles le contenu. Le gabarit les sert, il ne se sert pas d'elles |

**Zéro tiers, y compris ici.** Aucune police, aucun script, aucune image chargés depuis un CDN, aucune mesure d'audience. Un site qui vend l'auto-hébergement sans traqueur ne peut pas en poser lui-même : la vitrine est la démonstration de la doctrine, sa page réseau doit être vide.

**Référencement, puisque c'est l'enjeu.** Rendu serveur, une URL stable par extension (`/e/<id>`), titre et description propres, image Open Graph générée par extension (icône, nom, auteur, surfaces), `sitemap.xml`, données structurées `SoftwareApplication`, pages de catégories indexables. Le site doit être lisible et rapide sans JavaScript pour tout ce qui est consultation.

**Zéro étoile, rappel.** Le classement par défaut est éditorial et explicite (officielles, puis récemment mises à jour), jamais une note agrégée déguisée en pertinence.

---

## 10. Outillage développeur

C'est la réponse directe au « les deux pages sont trop pauvres ». Le SDK sans outillage, c'est encore un tutoriel.

- **`npm create nodyx-extension`** : squelette complet (manifeste, i18n fr/en, page, widget, thème câblé, README), qui tourne en 30 secondes.
- **`nodyx-ext dev`** : serveur local qui monte le paquet dans une frame identique à la production, avec un hôte simulé : données bidon, changement de thème, changement de langue, permissions activables une à une pour voir ce que ça casse.
- **`nodyx-ext check`** : le validateur du core, en CLI. Le même code que celui de l'installation, donc pas de surprise à l'upload.
- **`/admin/extensions/lab`** : sur l'instance, charge une URL de dev dans le bac à sable réel, avec le journal du pont (chaque appel, chaque refus, chaque quota). Même esprit que `/admin/sfu-lab`.
- **`@nodyx/sdk`** : types TypeScript pour `Nodyx`, `manifest.json` typé, autocomplétion sur `nodyx.config` dérivée du schéma déclaré.
- **Doc générée** depuis le JSON Schema, plus de table à maintenir à la main dans `CREATE-WIDGET.md`.

---

## 11. La médiathèque, composant de référence

Elle est le critère d'acceptation, pas une démonstration.

| Besoin de la médiathèque | Réponse du SDK |
|---|---|
| 229 œuvres, 67 univers, 60 leçons | `data/works.json` livré dans le paquet, filtré et cherché côté client |
| Statuts vus / à voir par personne | `storage` portée `user`, ce qui règle enfin le point dur mono-utilisateur |
| Favoris, note perso | idem, aucune table dédiée, aucune migration |
| Affiches et fiches TMDB | `network` sur liste blanche, à travers le proxy, clé TMDB en `secrets` |
| 4 écrans (parcours, bibliothèque, film, ce soir) | une surface `page` avec routage interne, `nodyx.router` pour les liens profonds |
| i18n FR / EN, 72 clés à parité | bundles du paquet, déjà écrits le 2026-08-14 |
| Rendu entre les sidebars, au thème de l'instance | surface `page` plus jetons de thème |
| Authentification | héritée, il n'y a rien à écrire, c'était l'argument de départ |

Le corpus éditorial (notes de curation, leçons) **n'est pas traduit**, décision déjà prise et inchangée : c'est du contenu, pas de l'interface.

Ce qui reste franchement à l'épreuve : SQLite disparaît au profit d'un dataset plus du KV. Les recherches et filtres passent côté client sur un JSON d'environ 300 Ko. Si ça tient pour 229 œuvres, ça tient pour l'usage visé.

Mais le critère d'acceptation n'est pas « 300 Ko passent ». C'est : **une extension ne doit jamais avoir besoin d'un privilège supplémentaire simplement parce que son jeu de données grossit.** Le SDK traite donc `data/*.json` comme des assets versionnés, servis par la route d'assets, sans permission associée. Le jour où une médiathèque atteint 30 000 œuvres, on ajoute une API de dataset indexée côté serveur ; le modèle de sécurité, lui, ne bouge pas.

Règles fondatrices intactes : note de curation obligatoire, zéro étoile, zéro recommandation algorithmique.

---

## 12. Ce qu'on casse, assumé (D7)

- **Le format v0 disparaît.** Un manifeste sans `api: 1` est refusé, avec un message qui pointe le guide de migration. Coût réel : un widget, `video-player`, qui est à nous.
- **`video-player` reste une extension, et devient l'exemple de référence** (décision Jonathan, 2026-08-14, qui renverse la position précédente). L'argument est produit, pas technique : *si un simple lecteur vidéo ne passe pas en extension, le SDK ne vaut rien pour tout ce qui est plus ambitieux.* C'est juste. Le lecteur est le plus petit cas réaliste, il doit passer, sinon la place de marché n'a aucun sens.

  **Mesure, banc identique, seule différence l'attribut `sandbox`** (Chromium, 2026-08-14) :

  | Fournisseur | Sans bac à sable | Dans le bac à sable |
  |---|---|---|
  | YouTube | lecteur monté, 6 contrôles | document vide |
  | Vimeo | lecteur monté, 14 contrôles | document vide |
  | Dailymotion | 3 éléments média | quasi rien |
  | Twitch | lecteur monté | **refus net, `frame-ancestors` violé** |
  | SoundCloud | contenu rendu | document vide |
  | Spotify | rendu | rendu, seul survivant |

  Cinq sur six meurent. Le stockage est refusé (`SecurityError`) dans tous les cas, et Twitch va plus loin : sa propre politique `frame-ancestors` **ne peut pas être satisfaite depuis une origine opaque**, donc l'embarquement est refusé avant même de charger. C'est structurel.

  **Conséquence : la primitive d'embarquement rendue par l'hôte (D9) passe de P3 à la v1.** Elle n'est plus un confort, elle est ce qui rend un lecteur possible en extension. Répartition : l'extension fait l'analyse d'URL, la détection de plateforme, l'habillage, la configuration et l'i18n ; l'hôte pose la frame du fournisseur, et lui seul sait renseigner correctement le paramètre `parent=` qu'exige Twitch, qui dépend du domaine de l'instance.
- **`installed_widgets` est remplacée** par `installed_extensions`. Migration 112 : création. La suppression de l'ancienne table attend la release suivante, une fois les 4 instances vérifiées.
- **L'embed tiers dans une extension** (un lecteur YouTube dans une extension de la communauté) est impossible en v1 : les drapeaux du bac à sable se propagent aux frames imbriquées, donc l'embed du fournisseur casse.

  **C'est la limite la plus gênante du modèle, et il faut la nommer** : la catégorie de widget la plus évidente pour une communauté, le lecteur média, est justement celle que la v1 ferme aux tiers. Un contributeur qui voudrait écrire un meilleur lecteur que le nôtre ne le pourra pas en extension, seulement en natif, donc par une PR sur le dépôt.

  **Déverrouillage retenu pour P3 : une primitive d'embarquement rendue par l'hôte.** L'extension déclare `embed: ["youtube", "twitch"]`, appelle `nodyx.ui.embed({ provider, id, rect })`, et l'hôte pose l'iframe du fournisseur **hors du bac à sable**, à l'emplacement indiqué. L'extension ne gagne aucun privilège, le fournisseur tourne en première partie comme aujourd'hui, et la liste des fournisseurs embarquables est **livrée avec Nodyx**, donc identique partout. Coût : le positionnement d'une surface superposée, et une liste à maintenir. Bénéfice secondaire non négligeable : l'ensemble des tiers qui peuvent être encadrés est revu par nous, pas choisi par un auteur d'extension.

  **L'idée d'une origine dédiée `ext.<domaine>` est écartée** (Jonathan, 2026-08-14). L'objection décisive n'est pas la friction DNS, c'est la portabilité : **une extension s'installe sur n'importe quelle instance.** Si les embeds ne fonctionnaient que là où un sous-domaine a été configuré, la même extension se comporterait différemment selon l'hébergeur, un auteur ne pourrait pas savoir si son travail marchera chez ses utilisateurs, et le magasin ne pourrait plus affirmer qu'une extension fonctionne. C'est de la fragmentation du contrat, pas un simple coût d'installation. Le paquet est portable, la capacité doit l'être aussi.

---

## 13. Phasage

**P0, le socle, découpé en trois lots livrables séparément**

Le P0 initial contenait presque tout le système, ce qui rend les régressions impossibles à localiser. Découpage :

- **P0-A, le substrat de sécurité.** Lecteur de paquet, JSON Schema du manifeste, validateur, assainissement SVG, installation par fichier, document de frame et sa CSP (en-tête et balise `meta`), route d'assets versionnée, `MessageChannel` et protocole `p:1`, `ext_token`. Aucun nouveau chemin non isolé n'est créé, mais l'ancien survit jusqu'en P0-C.
  Attention à l'ordre, il a changé avec D7 révisé : `video-player` restant une extension, le chemin non isolé ne peut mourir qu'une fois la surface `widget` isolée disponible. La suppression bascule donc en **fin de P0-C**, et P0-A se contente de ne plus créer de nouveau chemin non isolé. Tant que la bascule n'est pas faite, l'ancien chargeur reste le seul à servir la page d'accueil de nodyx.org.
- **P0-B, l'API de runtime.** `config`, thème, i18n, `identity`, `storage` et ses limites, redimensionnement, routeur, UI rendue par l'hôte.
- **P0-C, les surfaces.** `widget` dans le builder, `page` dans la coque, primitive d'embarquement (D9), `CatalogEntry` v2, écran de permissions, administration des extensions, repaquetage de `video-player`, **puis** suppression de l'ancien chargeur.

Aucun lot ne réintroduit un chemin non isolé, et chacun se déploie seul.

**P1, le banc d'essai**
Proxy réseau plus secrets, `core:read`, médiathèque portée en extension et déployée sur nodyx.org, outillage développeur (`create`, `dev`, `check`, lab).

**Porte d'entrée de P1 : aucune API réseau d'extension n'existe tant que les tests de confinement de §14, point 1, ne sont pas verts.** Le proxy est lui-même une capacité de sécurité, il ne se pose pas sur un bac à sable non prouvé.

**P2, la place de marché**
Satellite `nodyx-store` (site public plus index signé), fiches et catégories, **catalogue rendu nativement dans l'admin avec installation d'un bouton**, téléchargement depuis le site, mises à jour avec diff de permissions, dépôt `nodyx-extensions` et sa CI, formulaire de soumission générateur de PR, amorçage des 12 fiches, réécriture de `CREATE-WIDGET.md` en manuel SDK généré sur `nodyx.dev`. Renommage `/admin/modules` en Fonctionnalités.

### 13.1 Plan de non-régression de P0-A

Ce lot touche le rendu de la page d'accueil des 4 instances de production. Inventaire vérifié le 2026-08-14, pas supposé.

**Ce qui est modifié**

| Fichier | Changement |
|---|---|
| `homepage/DynamicWidget.svelte` | remplacé par un composant de frame isolée |
| `homepage/WidgetZone.svelte` L52 | site d'appel |
| `homepage/GridRenderer.svelte` L154 | site d'appel |
| `homepage/catalog.ts` | `CatalogEntry` v2 |
| `homepage/plugins/index.ts` | `video-player` enregistré comme natif |
| core `widgetStore.ts` | route `/widget-assets` supprimée, store remplacé |
| core `widgetDemo.ts` | démo devenue inutile, `video-player` étant natif |

**État réel de l'existant, relevé le 2026-08-14 sur les quatre instances**

| Instance | Fichiers sur disque | Ligne en base | Présent dans une mise en page |
|---|---|---|---|
| nodyx.org | v1.2.0 | `video-player` v1.2.0 | **oui, brouillon et publié** |
| demo | v1.2.0 | aucune | non |
| sleemstudio | v1.2.0 | aucune | non |
| vieuxlooters | v1.2.0 | aucune | non |

Les fichiers sont identiques partout (même empreinte), et identiques à la source du dépôt `nodyx-core/widget-demos/video-player/`. Trois instances portent donc les fichiers sans que le widget soit installé : **une seule instance est réellement concernée par la bascule, et son widget est le nôtre.**

Configuration réellement enregistrée dans la mise en page publiée de nodyx.org :

```json
{ "url": "https://www.youtube.com/watch?v=...", "title": "",
  "autoplay": false, "show_controls": true }
```

Les quatre clés attendues, et rien d'autre. Le composant natif doit les lire telles quelles, y compris `title` vide (qui doit retomber sur le titre par défaut) et `show_controls` absent traité comme vrai.

**Source du port, vérifiée.** Jonathan a signalé que la copie installée venait d'une démonstration d'installation par `.zip` faite avec une version ancienne, donc possiblement pas la dernière. Recherche menée le 2026-08-14 :

| Piste | Résultat |
|---|---|
| Fichiers des 4 instances | v1.2.0, empreinte identique partout |
| Source du dépôt `widget-demos/` | v1.2.0, même empreinte |
| Manifeste stocké en base | v1.2.0, équivalent au fichier (seul l'ordre des clés diffère, JSONB réordonne) |
| Historique git, toutes branches | deux versions seulement : v1.1.0 le 2026-05-05, v1.2.0 le 2026-05-06 |
| Sauvegardes, 10 jours de rétention | v1.2.0, même empreinte sur toutes |
| Archives `.zip` ou `.nyx` sur la machine | aucune |

**Aucune trace d'une version supérieure à 1.2.0.** L'installation de démonstration a donc soit utilisé la 1.1.0 puis été réécrite, soit utilisé la 1.2.0. La référence du port est **v1.2.0**, et c'est aussi ce que rend la page d'accueil aujourd'hui. Si une version plus récente existe sur une machine de développement, le port en composant Svelte reste trivial à mettre à jour, mais rien ici ne l'atteste.

**Ce qui ne doit pas bouger, et pourquoi ça tient**

1. **Les mises en page enregistrées.** La grille stocke `widget_type: 'video-player'` avec sa configuration. Le widget restant une extension (D7 révisé), la continuité ne passe plus par le registre natif mais par un **repaquetage en extension v1, réinstallé sous le même `id`**. La mise en page n'est pas touchée : elle référence un identifiant et une configuration, que le nouveau format conserve à l'identique (`url`, `title`, `autoplay`, `show_controls`). C'est plus exigeant que la bascule en natif, et c'est le prix de la décision : **la continuité de la page d'accueil de nodyx.org devient la première preuve que le bac à sable tient en vrai.**

   Filet pendant la bascule : la seule instance concernée est nodyx.org, et le repli est le retour arrière du frontend, la table `installed_widgets` et les fichiers restant en place une release entière.
2. **Les deux chargements serveur** qui appellent `/widget-store-public` (`routes/+page.server.ts` L14 et `admin/homepage/builder/+page.server.ts` L11) doivent être migrés **en même temps** que la route, sinon l'accueil et le builder cassent ensemble.
3. **La table `installed_widgets` et les dossiers `uploads/widgets/`** restent en place le temps d'une release. Aucune suppression dans le même lot que la bascule.

**Preuves exigées avant merge**

- captures avant et après de la page d'accueil des 4 instances, à 375, 768 et 1366 pixels, comparées
- `video-player` rendu par le chemin natif, avec une configuration existante non modifiée
- `npm run check` et `tsc` propres, suite core verte, portes i18n vertes
- aucune requête vers `/api/v1/widget-assets` dans le journal réseau d'un chargement d'accueil
- l'extension hostile de §14 échoue sur toutes ses tentatives

**Preuves exigées après déploiement**

- les 4 instances en 200, version attendue, `pm2 list` propre
- une page d'accueil chargée sur chaque instance, sans erreur console, sans violation de politique de sécurité
- `sidebar_bg` et les autres réglages d'instance inchangés (le déploiement touche le frontend, pas la configuration)

**Repli** : le lot est réversible par retour arrière du frontend seul tant que la table `installed_widgets` n'est pas supprimée. C'est la raison pour laquelle sa suppression est repoussée d'une release.

**Mine découverte le 2026-08-14, antérieure à ce chantier, à désamorcer avant le port de `video-player`.** La politique de sécurité servie en production **ne vient pas de l'application** : le proxy la pose en mode `set` sur tous les hôtes, et elle **diverge de celle du dépôt**.

| | `frame-src` en production | `frame-src` dans `svelte.config.js` |
|---|---|---|
| YouTube, Vimeo, OpenStreetMap | présents | présents |
| `player.twitch.tv`, `www.twitch.tv`, `clips.twitch.tv` | présents | **absents** |
| `geo.dailymotion.com`, `w.soundcloud.com`, `open.spotify.com` | présents | **absents** |

Conséquence directe : `video-player` annonce sept plateformes, quatre d'entre elles ne fonctionnent en production **que** parce que le proxy est plus permissif que le dépôt. Le jour où la configuration du proxy est réconciliée avec le disque, ces embarquements cassent, et le coupable désigné sera le port en natif alors que la cause lui est antérieure.

Action, dans P0-A, avant le port : **aligner `svelte.config.js` sur ce que la production sert déjà** pour ces six hôtes. C'est un alignement du dépôt sur la réalité, pas un élargissement de la politique en vigueur. En revanche, le `'unsafe-inline'` présent dans le `script-src` du proxy et volontairement retiré du dépôt **n'est pas réintroduit** : c'est un durcissement voulu, et il devra être vérifié au moment où la configuration du proxy sera réconciliée.

Le rapprochement de la configuration du proxy avec le disque reste hors de ce lot, et soumis au danger déjà documenté dans `CLAUDE.md`.

**P3, l'ouverture**
Surfaces `panel` et `card` (enrichissement chat et forum, l'étagère de la communauté), écritures core avec consentement, primitive d'embarquement rendue par l'hôte pour les lecteurs tiers (§12).

---

## 14. Critères d'acceptation

Prouvés par des tests exécutables en CI, pas par du raisonnement.

1. **Extension hostile en fixture** (`tests/fixtures/evil-extension`). Chaque tentative échoue, test Playwright vert. Le catalogue d'attaques, par famille :

| Famille | Tentatives |
|---|---|
| DOM et fenêtres | `window.parent.document`, `window.top`, `window.frames`, `document.cookie`, `localStorage`, lecture de la charge SSR de l'hôte |
| Navigation | `window.top.location`, `window.open`, sortie de la surface autorisée, soumission de formulaire |
| Messagerie | message forgé depuis une autre frame, message sur `window` après la poignée de main, `requestId` inconnu, `requestId` rejoué, réponse non sollicitée, message adressé au port d'une autre extension |
| Jeton | rejeu sur une autre extension, une autre surface, une autre instance, après expiration, après désinstallation |
| Réseau | hors liste blanche, méthode non déclarée, chemin non déclaré, port explicite, redirection vers `127.0.0.1`, vers RFC1918, vers `::1`, **DNS rebinding** (nom public résolvant en adresse privée), écriture exotique d'IP, exfiltration de secret par en-tête choisi, bombe de décompression |
| Stockage | hors quota d'octets, clé trop longue, valeur trop grosse, trop de clés, JSON trop profond, martèlement en écriture, écriture dans l'espace d'une autre extension, écriture instance sans la capacité |
| Paquet | zip slip, lien symbolique, fichier géant, 100 000 fichiers minuscules, arborescence profonde, type MIME menti, **SVG porteur de script ou d'attribut `on*`** |

Le SVG mérite sa ligne : c'est la seule attaque de cette liste qui frappe **hors** du bac à sable, sur la page d'administration.
2. **Le jeton de session n'est jamais lisible** depuis une extension, y compris quand un admin est connecté.
3. **Une extension qui boucle ou qui plante** ne fige pas la page hôte, et affiche une carte d'erreur propre.
4. **Zéro régression d'accueil** : les layouts des 4 instances rendent à l'identique après P0 (comparaison de captures).
5. **Installation refusée** pour : zip slip, `entry` absent, permission inconnue, `default_locale` incomplet, dépassement de taille, `api` absent.
6. **La médiathèque tourne comme extension** sur nodyx.org, avec statuts par utilisateur, i18n FR et EN, thème de l'instance, entre les sidebars.
7. **Portes i18n vertes** sur tout ce qu'on livre.
8. **Quotas appliqués** : dépassement de stockage et de débit réseau prouvés par test, erreur nette.

---

## 15. Risques et points à arbitrer

| Risque | Traitement |
|---|---|
| Le bac à sable bride trop, personne n'écrit d'extension | La médiathèque est le juge. Ce qu'elle exige, le SDK le fournit. Si elle passe, une extension de communauté passe. |
| Une iframe par widget sur l'accueil, coût de rendu | Chargement paresseux hors du viewport, frame unique par extension quand plusieurs de ses widgets sont sur la même page. À mesurer, pas à supposer. |
| Le proxy réseau fait de l'instance un relais ouvert | Liste blanche par extension, anti SSRF, quotas, journal. Aucun hôte libre. |
| Le registre par défaut recentralise Nodyx | Index statique signé, remplaçable, cumulable, contournable par fichier. L'admin rend le catalogue nativement, jamais en iframe. Si le magasin tombe, une instance perd la découverte, pas l'installation. |
| Magasin vide à l'ouverture | Amorçage à 12 fiches réelles (§9.7). Un magasin qui s'ouvre à une entrée ne se remplit jamais. |
| Chaîne d'approvisionnement (auteur compromis) | Pas de mise à jour automatique, diff de permissions à chaque montée de version, sha256 épinglé, sources exigées au registre officiel. |
| Deux runtimes à maintenir | C'est le prix, et il est borné : le contrat, l'i18n, le thème et le catalogue sont communs. Seul le rendu diffère. |

**Tranché par Jonathan, 2026-08-14. Plus aucun point ouvert.**

| # | Décision | Statut |
|---|---|---|
| A | Vocabulaire : Extension = le paquet, Widget et Module = ses surfaces, **Fonctionnalités** = les 35 interrupteurs natifs. `/admin/modules` est renommé, `MODULE-SYSTEM.md` et la navigation admin suivent. Le mot « plugin » sort du code et de la doc. | validé |
| A bis | Domaine de la vitrine : **`extensions.nodyx.org`**, la documentation technique restant sur `nodyx.dev`. | validé |
| B | **La médiathèque devient une extension sandboxée**, pas des pages natives. C'est le critère d'acceptation du SDK. | validé |
| C | **Rupture v0** assumée, `video-player` passe natif. | validé |
| D | Registre par défaut sur `extensions.nodyx.org`, remplaçable, cumulable, contournable par fichier. | validé |
| E | P0 découpé en A, B et C. La suppression du chargement non isolé reste dans **P0-A**. | validé |
| F | La vitrine est une surface de visibilité durable : i18n FR et EN dès le premier commit, design sobre sans gloss, rayons bornés, zéro tiret cadratin, référencement soigné. Détail en §9.9. | validé |

Prochain livrable : **P0-A**, le substrat de sécurité (§13).

---

## 16. Revue croisée (2026-08-14)

Le CDC r1 a été soumis à une revue externe. Verdict : direction validée, feu vert refusé sur P0 tant que huit corrections n'étaient pas intégrées. Les huit sont dans la r2.

**Retenu et intégré**

| Point | Où |
|---|---|
| `CatalogEntry` v2 orienté surfaces, le catalogue ne décide pas du runtime | §3.1 |
| Protocole de messagerie versionné, corrélé par `requestId` | §4.6 |
| `Origin: null` n'est pas une authentification, trois origines distinctes | §4.1 |
| `ext_token` lié à l'émetteur, l'audience, l'instance, l'extension, la surface, avec `jti` | §4.7 |
| Renouvellement de jeton à la demande, jamais dans une URL | §4.7 |
| SSRF : rebinding DNS, épinglage de l'adresse résolue, ports, méthodes, chemins, en-têtes, taille, compression | §6.4 |
| Le serveur possède la recette d'injection du secret, pas l'extension | §6.4 |
| Limites fines du stockage : clé, valeur, nombre, profondeur, fréquence | §6.1 |
| Deux axes séparés, capacité d'extension et droits utilisateur, droit effectif = intersection | §6.1 |
| Domaine d'identifiants natifs réservé : refus à l'installation, pas simple masquage | §5 |
| Assainissement SVG (XSS hors bac à sable, sur la page d'administration) | §9.1 |
| Signature de l'index distincte de l'intégrité du paquet, versions immuables | §9.2 |
| Diff de **capacités**, pas seulement de permissions | §9.5 |
| Pas de type global d'extension, rangement par surface, listing multi-catégories | §7, §9.3 |
| Découpage de P0 en trois lots | §13 |
| Catalogue d'attaques étendu (messagerie, navigation, rejeu, paquet, SVG) | §14 |
| Le dataset ne doit jamais coûter un privilège de plus | §11 |

**Ajouté au-delà de la revue**

- `MessageChannel` avec port privé transféré à l'amorçage, plutôt qu'un filtrage manuel sur `window` : la revue proposait de tester le message forgé, le port privé le rend structurellement impossible. §4.5
- Le lien d'installation du magasin est une surface d'attaque : `src` validé contre les registres configurés, installation en `POST` confirmé. Non relevé par la revue, c'était un trou de la r1. §9.5
- Assets versionnés dans le chemin, `nosniff`, CORP, et disparition explicite de `/api/v1/widget-assets`. §4.3

**Écarté, avec raison**

- *« `style-src 'nonce' 'unsafe-inline'` sans raison documentée »* : juste sur le fond, mais la raison existe et elle est connue de la maison. Les attributs `style=""` dynamiques sont réels (185 occurrences dans le frontend principal), donc `style-src-attr 'unsafe-inline'`, exactement le réglage déjà en place dans `svelte.config.js`. Corrigé dans ce sens, pas supprimé.
- *« le parent ne devrait pas rafraîchir le jeton »* : le parent est le seul à détenir la session utilisateur, donc le seul à pouvoir faire frapper un jeton. Le fond du reproche (pas de flux périodique poussé dans la frame) est retenu, le mécanisme reste médié par le parent.
- *« l'écriture instance accordée à l'extension est dangereuse »* : le diagnostic mélangeait capacité et privilège. Traité par la règle des deux axes plutôt que par une restriction supplémentaire.

**Deux affirmations factuelles corrigées**

- *« les migrations vont jusqu'à 097 »* : faux. La branche `spec/mediatheque` et `origin/main` sont toutes deux à **111** (`111_community_sidebar_bg.sql`). La recommandation de ne pas figer le numéro reste bonne et est appliquée, mais pas pour la raison avancée.
- *« l'arborescence frontend a évolué, le CDC est basé sur une photographie obsolète »* : les chemins de la r1 étaient exacts. Ce qui manquait, c'est que `homepage/plugins/` (descripteurs `.ts`) et `homepage/widgets/` (composants `.svelte`) coexistent. La conséquence, elle, est réelle et a été corrigée : le renommage proposé en r1 vers `widgets/native/` entrait en collision avec un dossier existant.

---

## 17. Le chantier suivant : données riches et surface d'administration

Ouvert le 2026-08-14, à partir des scénarios que Jonathan a listés en regardant ce qui naîtra vraiment sur une place de marché : location de voitures, annonces immobilières, partage de fichiers catégorisés, galerie vidéo par membre. Ce ne sont pas des cas limites, c'est le cas normal d'un magasin vivant.

Confrontés au SDK livré, ils révèlent **quatre manques précis**, et un principe qui doit les encadrer.

### 17.1 Les quatre manques

**Les fichiers.** Le plus gros, et il touche tous les scénarios cités. Photos, contrats, tableurs, musique, vidéo. Une extension dispose aujourd'hui de JSON clé-valeur plafonné à 64 Ko par valeur, et d'**aucun moyen de recevoir un téléversement ni de stocker un octet binaire**. Un module de location de voitures n'est pas difficile à écrire, il est impossible.

**Les collections.** Réservations, annonces, catalogues, galeries : il faut lister, filtrer par date, paginer, compter. Cinq cents clés dans un magasin clé-valeur ne rendent pas ce service. Il faut de vraies collections interrogeables.

**La visibilité entre membres.** `storage.user` est strictement l'espace du membre courant, invisible aux autres, par construction. Or une galerie sur un profil suppose que les autres la voient, et une réservation appartient à un membre tout en devant être lue par l'admin. Il manque la notion de donnée **par utilisateur mais visible**, selon une règle.

**La surface d'administration.** Le manifeste connaît `widget` et `page`, rien pour l'écran où un admin règle et **modère**. Une extension qui gère du contenu communautaire n'a nulle part où mettre sa modération, et contrairement à un module natif elle ne peut pas se glisser ailleurs : elle est en bac à sable.

Ce manque a un jumeau côté natif, et c'est le même problème vu de l'autre côté : un module a trois états distincts, **son existence, sa configuration, sa modération**, et seul le premier est aujourd'hui de première classe. Les sondages s'allument mais ne se modèrent pas.

### 17.2 Le principe qui encadre

**Rien de tout cela ne rouvre la porte au code serveur tiers ni aux migrations d'extension.** D3 tient. La réponse n'est pas d'assouplir, c'est d'offrir un service de données plus riche mais **toujours détenu par le cœur** : collections, fichiers, règles de visibilité, avec leurs quotas. L'extension décrit ce qu'elle veut, le cœur l'exécute.

### 17.3 Le garde-fou à surveiller

Plus le SDK devient puissant, plus l'écran de permissions doit rester **lisible**. « Peut stocker 2 Go de fichiers, lire tous les membres, recevoir des téléversements de visiteurs » doit se comprendre d'un coup d'œil. Le jour où cette phrase devient une liste de vingt lignes, on aura reconstruit les permissions que personne ne lit, et le consentement redeviendra décoratif.

### 17.4 Portée

Ce chantier mérite **son propre CDC**, écrit avant la moindre ligne, avec un audit préalable de ce dont les modules natifs ont réellement besoin. Il ne bloque pas la page Extensions, qui se livre avec ses deux onglets.
