# CDC, Nodyx Activities — une application interactive dans un canal vocal

Statut : **VALIDÉ (r1 + r2 livrés sur nodyx.org)** — nodyx-core = SANCTUAIRE
Date : 2026-08-30 (r1) · **r2 2026-08-30 : l'activité s'auto-héberge, plus de dépendance runtime à nodyx.org** · **r3 2026-08-30 : records par joueur + classement d'instance (§10), valide A7/A8 amendés**
Auteur : session Nodyx
Préalable au code (règle maison : CDC formel avant tout module critique)
Banc d'essai : **NodyxBattle** (`Pokled/nodyx-battle`) devient la première activité installable.

---

## 0. Ce que ce document tranche

| # | Question | Décision |
|---|---|---|
| A1 | Comment une app interactive tourne-t-elle dans un canal vocal ? | Nouveau type de surface d'extension **`activity`**, monté par le frontend en **overlay plein écran** dans `VoiceRoom` (patron `NodyxCanvas`). |
| A2 | Où vit le code de l'activité ? | **L'instance l'héberge elle-même.** Le build (54 Mo de wasm Godot) ne rentre pas dans un `.nyx` (types de fichiers + plafond 20 Mo de `package.ts`). Le manifeste déclare donc un **bundle applicatif** `app: {url, sha256, bytes}` : à l'installation, nodyx-core le récupère **une seule fois** (ou l'admin le téléverse à côté du `.nyx`), vérifie l'empreinte, le décompresse dans `uploads/extensions/<id>/<version>/app/`. Ensuite l'instance sert le jeu depuis **sa propre adresse**. **nodyx.org peut disparaître, chaque instance installée continue de tourner.** L'URL externe ne sert QU'à la première récupération. |
| A3 | Isolation | iframe servie depuis l'API de l'instance : `GET /api/v1/extensions/:id/:version/app/<entry>` — **même origine que le frontend**. `sandbox="allow-scripts allow-same-origin"` (Godot exige `allow-same-origin` pour IndexedDB) + `frame-ancestors 'self'` sur le document servi. Le `sandbox` reste utile (bloque nav du top, popups, `alert()`, formulaires, téléchargements). Confiance : le contenu est **épinglé par sha256** et l'admin **valide explicitement** à l'installation — c'est du contenu de confiance de l'instance elle-même, pas un tiers arbitraire. |
| A4 | Transport temps-réel | Nouveau handler `socket/activity.ts`, **calqué verbatim sur `jukebox:update`** (`voice.ts:371-378`). L'hôte (le composant Svelte) relaie pour l'activité via le **socket déjà authentifié de la page**, uniquement dans `voice:<channelId>`. L'activité n'a **ni socket ni token propre**. |
| A5 | Nouvelle capacité | `permissions.realtime` (booléen), marquée **sensible** sur l'écran de permissions (code tiers + diffusion dans le salon). |
| A6 | Qui arbitre (host) ? | Le membre au plus petit `seatIndex` du salon vocal — déterministe sur tous les clients depuis `voice:channel_update`, zéro état backend, promotion auto si le host part. **Pas** le propriétaire de communauté (éviterait un `ownerUserId` de plus dans le roster = surface SANCTUAIRE élargie). |
| A7 | Persistance | ~~Aucune en v1~~ **AMENDÉ r3 (§10)** : la surface `activity:<id>` devient une **surface de stockage de plein droit**. `RE_SURFACE` accepte `activity:<id>`, `/session` frappe un jeton court pour elle, la frame (same-origin) appelle `POST /extensions/:id/storage` directement. `storage.user` (records par joueur) + `storage.instance.*` (classement). Pas de `core`/`network` pour une activité. |
| A8 | Migration | **Aucune.** `installed_extensions.granted` (JSONB) porte `"realtime"` et, si accordées, `"storage.user"` / `"storage.instance.read"` / `"storage.instance.write"`. La table `extension_storage` existe déjà (SDK widget/page). |

---

## 1. Déclencheur

Le bouton « Jeux » de la barre d'outils des canaux vocaux (`VoiceRoom.svelte:302-309`) est un
stub désactivé depuis toujours. NodyxBattle est prêt côté jeu (multi « course aux rois » jalon 1,
testé à distance) mais son multijoueur passe par un relais WebSocket maison + tunnels cloudflared
éphémères. L'objectif : **le jeu vit dans le salon vocal** — membres du salon = lobby, voix native
Nodyx, on ne transporte que l'état de jeu — et sert de **vitrine d'extension installable**.

Le SDK actuel ne peut pas le porter : surfaces `widget`/`page` seulement, iframe `allow-scripts`
strict, CSP `frame-src 'none'` / pas de `wasm-unsafe-eval`, `.nyx` sans `.wasm`/`.pck` et plafonné
à 20 Mo, aucune capacité temps-réel. Cf `NODYX_SDK_CDC.md` (D2, D4) — les activités **étendent**
ce contrat, elles ne le contournent pas.

---

## 2. La surface `activity` et le bundle applicatif

### 2.1 Schéma manifeste — `nodyx-core/src/extensions/manifest.ts`

Troisième membre de la discriminated union `surface` :

```
activitySurface = z.object({
  type:           z.literal('activity'),
  id:             z.string().regex(RE_SURFACE_ID),
  entry:          z.string().regex(RE_APP_ENTRY),   // chemin DANS le bundle, ex. 'index.html'
  label:          messageKey,
  description:    messageKey.optional(),
  default_aspect: z.enum(['16:9', '4:3', 'fill']).optional(),
}).strict()
```

Champ manifeste de premier niveau, le bundle lourd hors `.nyx` :

```
app: z.object({
  url:    z.string().url().refine(isHttpsPublicHost),   // où le récupérer, UNE fois
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes:  z.number().int().positive().max(APP_BUNDLE.maxBytes),   // taille déclarée
}).optional()
```

`isHttpsPublicHost` : `protocol === 'https:'` et `classifyHost(hostname) === 'public'` ; `http://localhost`
toléré si `NODE_ENV !== 'production'`.

- `collectMessageKeys` : `s.label`/`s.description` pour `type === 'activity'`.
- `postflight` :
  - dédup des `id` d'activité → `DUPLICATE_SURFACE_ID`
  - surface `activity` sans `app` → `ACTIVITY_WITHOUT_APP`
  - `app` sans surface `activity` → `APP_WITHOUT_ACTIVITY`
  - `permissions.realtime: true` sans surface `activity` → `REALTIME_WITHOUT_ACTIVITY`
- L'écran de permissions affiche : « héberge et exécute une application téléchargée une fois depuis `<hôte de app.url>` (empreinte vérifiée) ».

### 2.2 `package.ts`

Boucle « points d'entrée » : sauter le contrôle `byPath.has(s.entry)` quand `s.type === 'activity'`
(l'`entry` vit dans le bundle `app/`, pas dans le `.nyx`). Le `.nyx` d'une activité ne contient donc
que `manifest.json` + `icon.svg` + `i18n/*.json`.

**Factoriser** la boucle de sûreté par entrée de `readExtensionPackage` (symlink, zip-slip, `isSafePackagePath`,
profondeur, plafonds) en `extractZipSafely(buf, destDir, { allowedExtensions, maxBytes, maxFiles })` —
réutilisée pour le `.nyx` ET le bundle applicatif.

### 2.3 Le bundle applicatif — NOUVEAU `nodyx-core/src/extensions/appBundle.ts`

`fetchAndUnpackAppBundle(manifest, versionDir, { uploaded? })`:
1. Source : `uploaded` (Buffer téléversé à côté du `.nyx`) si fourni, sinon `fetch(manifest.app.url)`
   via garde SSRF (`guardedLookup` de `netFetch.ts`), en flux, coupé à `APP_BUNDLE.maxBytes`.
2. Vérifier `content-length`/taille réelle ≈ `manifest.app.bytes` (tolérance) ; sinon `APP_SIZE_MISMATCH`.
3. `sha256(bytes) === manifest.app.sha256` ; sinon `APP_CHECKSUM_MISMATCH`.
4. `extractZipSafely(bytes, join(versionDir, 'app'), { allowedExtensions: APP_ALLOWED, maxBytes, maxFiles: 500 })`.
5. `join(versionDir, 'app', s.entry)` doit exister pour chaque surface activity ; sinon `APP_ENTRY_MISSING`.

`APP_ALLOWED` (types servables, jamais exécutables côté serveur) :
`.html .js .mjs .css .json .wasm .pck .data .png .jpg .jpeg .webp .gif .svg .ico .woff2 .ttf .otf
.mp3 .ogg .wav .txt .map`. Pas de `.sh`/`.exe`/`.so`/symlink (déjà couvert par `extractZipSafely`).

`APP_BUNDLE` (`limits.ts`) : `maxBytes: 128 * 1024 * 1024`.

`installer.ts` `installExtension` : après l'écriture atomique des fichiers `.nyx`, si `manifest.app`,
appeler `fetchAndUnpackAppBundle` dans le **même dossier de staging** avant le `rename` final →
l'install est atomique (tout ou rien). `uninstallExtension` fait déjà `fs.rm` du dossier `<id>` : `app/` part avec.

### 2.4 Route de service — `nodyx-core/src/routes/extensionFrame.ts`

`GET /api/v1/extensions/:id/:version/app/*` (public, `rateLimit`), à côté de `assets/*` :
- fichier depuis `uploads/extensions/<id>/<version>/app/<rel>`, double garde `isSafePackagePath` +
  `resolved.startsWith(appDir + sep)`.
- `Content-Type` depuis une table serveur incluant **`application/wasm`** ; `X-Content-Type-Options: nosniff`.
- `Cross-Origin-Resource-Policy: same-origin` (c'est le même hôte que le frontend).
- Sur le **document d'entrée** (`.html`), en-tête CSP :
  `default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval';
   style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:;
   media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; child-src 'self' blob:;
   frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`.
  Un moteur wasm comme Godot **amorce son runtime depuis un `<script>` inline** dans son
  `index.html` : `'unsafe-inline'` est indispensable, sinon le loader s'arrête avant même de
  télécharger le wasm (écran noir). `'unsafe-eval'` par sécurité (runtime emscripten). C'est
  acceptable : le bundle est épinglé sha256 + validé par l'admin, et `connect-src 'self'` +
  `frame-ancestors 'self'` bornent le risque (il ne peut ni appeler l'extérieur ni être encadré
  ailleurs) — équivalent à « l'admin a installé un plugin ».
- `Cache-Control` : `no-cache` sur le `.html` (un ajustement serveur de CSP prend effet sans purge),
  `public, max-age=31536000, immutable` sur le reste (le chemin porte la version).

### 2.5 Rendu — `nodyx-frontend/src/lib/components/ActivitySurface.svelte`

| Aspect | `ExtensionSurface` (widget) | `ActivitySurface` |
|---|---|---|
| `src` | `frameUrl({...})` | `${origin}/api/v1/extensions/<id>/<version>/app/<entry>` (**même origine**) |
| `sandbox` | `allow-scripts` | `allow-scripts allow-same-origin` |
| `allow` | — | `fullscreen` |
| session / token | `openSession()` | **aucune** — identité par props |
| cible du boot | `postMessage(boot, '*', [port2])` | `postMessage(boot, window.location.origin, [port2])` |
| contrôle `window` msg | `e.source === frame.contentWindow` | + `e.origin === window.location.origin` |
| montage | grille d'accueil | **overlay plein écran** dans `VoiceRoom` (chrome + « Quitter » dessinés par l'hôte) |

Réutilisé : poignée de main `nodyx:hello` → `MessageChannel` → transfert du port, `bootTimer`, lifecycle.
Le pont RPC (`createActivityHostHandler`) est identique quelle que soit l'origine.

CSP frontend (`svelte.config.js`) : `frame-src 'self'` suffit (le bundle est servi par l'instance).
**Aucun sous-domaine, aucun patch CSP prod.**

### 2.6 `/extensions/public` (`routes/extensions.ts`)

La surface `activity` renvoie l'URL résolue côté serveur :
`{ type: 'activity', id, appUrl: '/api/v1/extensions/<id>/<version>/app/<entry>', label, description, aspect }`.
Le champ `app` du manifeste (url/sha256/bytes) n'est **pas** exposé (détail d'installation).

---

## 3. Le pont RPC (port privé) et le bus temps-réel

### 3.1 Boot payload (hôte → activité, `nodyx:activity-boot`)

```
{ p: 1, type: 'nodyx:activity-boot',
  activity, version,
  user:    { id, name, avatar },
  members: [ { id, name, avatar_url, seatIndex, speaking } ],
  locale, theme }
```

Le host n'est **pas** transmis : l'activité le calcule (plus petit `seatIndex`). Le `channelId` n'est
**jamais** transmis à l'activité et n'est **jamais** accepté d'elle — l'hôte le lie une fois, depuis
`voiceState.channelId` (le salon rejoint via `voice:join`, déjà contrôlé par `getCommunityRoleForChannel`).

### 3.2 Activité → hôte (sur le port)

| type | effet hôte |
|---|---|
| `room.send`     `{ payload, to, reliable }` | `socket.emit('activity:send', { channelId, to, payload })` |
| `room.snapshot` `{ blob }` | `socket.emit('activity:snapshot', { channelId, blob })` |
| `room.sync`     `{}` | `socket.emit('activity:sync_request', { channelId })` |
| `ui.toast`      `{ message }` | toast hôte (console pour l'instant, comme le SDK widget) |

Gardes ceinture côté hôte avant chaque `emit` : `JSON.stringify(payload).length <= 8192`,
`typeof blob === 'string' && blob.length <= 16384`. Le serveur re-plafonne.

### 3.3 Hôte → activité (sur le port)

| event | source |
|---|---|
| `members` `{ members }` / `member_join` `{ member }` / `member_leave` `{ member: { id } }` | diff de `voice:channel_update` filtré sur `channelId` |
| `speaking` `{ userId, speaking }` | `voice:speaking` (déjà diffusé dans la room, aucun changement core) |
| `msg` `{ from, payload }` | `activity:msg` reçu du socket |
| `snap` `{ from, blob }` | `activity:snap` reçu du socket |
| `sync` `{ from }` | `activity:sync_request` reçu du socket |

### 3.4 Handler `nodyx-core/src/socket/activity.ts` — NOUVEAU

Découpé comme `voiceBascule` pour que la décision de relais soit une **fonction pure testable** :

```
export async function activityRelay(socket, server, kind: 'send'|'snapshot'|'sync', msg): Promise<void> {
  const { userId } = socket.data
  if (checkRateLimit(userId, `activity:${kind}`)) return
  if (!isUuid(msg.channelId)) return
  const room = voiceRoom(msg.channelId)
  if (!socket.rooms.has(room)) return                         // ← l'invariant

  if (kind === 'sync') { socket.to(room).emit('activity:sync_request', { from: userId }); return }

  if (kind === 'snapshot') {
    if (typeof msg.blob !== 'string' || msg.blob.length > ACTIVITY.snapshotMaxBytes) return
    socket.to(room).emit('activity:snap', { from: userId, blob: msg.blob }); return
  }

  // send
  let s: string
  try { s = JSON.stringify(msg.payload ?? null) } catch { return }
  if (s.length > ACTIVITY.msgMaxBytes) return
  if (isUuid(msg.to)) {
    const targets = (await server.in(room).fetchSockets()).filter(x => x.data.userId === msg.to)
    for (const t of targets) server.to(t.id).emit('activity:msg', { from: userId, payload: msg.payload })
  } else {
    socket.to(room).emit('activity:msg', { from: userId, payload: msg.payload })
  }
}

export function registerActivityHandlers(socket, server) {
  socket.on('activity:send',         (m) => void activityRelay(socket, server, 'send', m))
  socket.on('activity:snapshot',     (m) => void activityRelay(socket, server, 'snapshot', m))
  socket.on('activity:sync_request', (m) => void activityRelay(socket, server, 'sync', m))
}
```

- **`from` = `socket.data.userId`**, jamais une valeur fournie par l'invité (pas d'usurpation). Se
  mappe directement sur le roster vocal (`voice:channel_update` membres portent `userId`).
- **Pas de `activity:join`/`activity:leave`** : l'appartenance EST celle de la room vocale.
- Enregistré dans `socket/index.ts` près de `registerVoiceHandlers`.

### 3.5 Plafonds — `nodyx-core/src/extensions/limits.ts`

```
export const ACTIVITY = { msgMaxBytes: 8 * 1024, snapshotMaxBytes: 12 * 1024 } as const
```

### 3.6 Rate-limits — `nodyx-core/src/socket/rateLimiter.ts`

```
'activity:send':         [{ limit: 25, windowMs: 1_000 }, { limit: 120, windowMs: 10_000 }],
'activity:snapshot':     [{ limit: 9,  windowMs: 1_000 }],
'activity:sync_request': [{ limit: 3,  windowMs: 5_000 }],
```

`activity:snapshot` dimensionné pour le `snap` ~6,25 Hz du jeu, avec marge, borné pour un client hostile.

---

## 4. Capacité `realtime`

- `nodyx-core/src/extensions/manifest.ts` : `permissions.realtime: z.boolean().optional()`.
  `postflight` rejette `realtime: true` sans surface `activity` → `REALTIME_WITHOUT_ACTIVITY`.
- `nodyx-core/src/extensions/capabilities.ts` :
  - `requestedCapabilities` : `if (p.realtime) caps.add('realtime')`.
  - `sensitiveCapabilities` : ajouter `realtime` (code tiers + bus salon = consentement distinct).
- `applyGrant` inchangé : `granted` contiendra `"realtime"` si l'admin l'accorde.

---

## 5. Installation et listing

### 5.1 `POST /api/v1/admin/extensions/install` (`routes/extensions.ts`)

Multipart, **deux fichiers** :
- `package` : le `.nyx` (obligatoire).
- `app` : le zip du bundle applicatif (**optionnel**). Si fourni, il est utilisé tel quel (empreinte
  vérifiée contre `manifest.app.sha256`) → **installation 100 % hors-ligne possible**. Sinon, nodyx-core
  récupère `manifest.app.url` (garde SSRF).
- `accept` : JSON `string[]` des capacités accordées (dont `realtime`).

`POST /admin/extensions/inspect` : renvoie aussi `app: { host, bytes }` pour l'écran de permissions.
`from-registry` : le manifeste du `.nyx` porte `app.url` → même chemin de récupération.

### 5.2 Listing public — `routes/extensions.ts` `GET /extensions/public`

La surface `activity` renvoie :
```
{ type: 'activity', id, appUrl: '/api/v1/extensions/<id>/<version>/app/<entry>',
  label, description, aspect }
```
`app` (url/sha256/bytes) n'est pas exposé. Pas de changement d'auth. `/extensions/:id/session` reste
inchangé ; `RE_SURFACE` reste `^(page|widget:...)$` (une activité ne frappe pas de jeton).

---

## 6. Analyse de sécurité

| Menace | Parade | Résiduel |
|---|---|---|
| Une activité atteint un canal où l'utilisateur n'est pas | L'hôte lie un `channelId` fixe depuis `voiceState.channelId` ; le RPC **n'accepte jamais** de `channelId` de l'invité ; le serveur re-vérifie `socket.rooms.has(voiceRoom(channelId))`. L'activité n'a pas de socket. | néant |
| Rejeu / réordonnancement / injection par un pair | Bus fire-and-forget, opaque, plafonné. `MatchDirector` tolère déjà perte/réordre (`snap` latest-wins ; `cmd` a des deadlines + auto-élimination). N'importe quel pair du salon peut déjà injecter `jukebox:update` → `activity:*` = **même niveau de confiance**. | accepté ; conforme au modèle de menace du jeu |
| Bundle applicatif malveillant / altéré en transit | **sha256 épinglé au manifeste**, vérifié à l'installation (téléversé ou récupéré). L'admin valide explicitement à l'écran de permissions (« héberge et exécute `<hôte>` »). `extractZipSafely` : pas de symlink, pas de zip-slip, types de fichiers en liste blanche (aucun exécutable serveur), plafonds. | l'admin fait confiance à ce qu'il installe, comme pour toute extension (`NODYX_SDK_CDC.md` D3) |
| Le bundle servi (same-origin) « s'évade » du sandbox | `sandbox="allow-scripts allow-same-origin"` : l'iframe partage l'origine de l'instance, donc PEUT atteindre `window.parent` — **mais son contenu est épinglé sha256 et validé par l'admin**, c'est du contenu de confiance de l'instance. Le `sandbox` bloque quand même nav du top, popups, `alert()`, formulaires, téléchargements. `frame-ancestors 'self'` sur le document : personne d'autre ne peut l'encadrer. | équivalent à « l'admin a installé un thème/plugin » ; borné par la CSP du document (`connect-src 'self'` : le bundle ne peut appeler QUE l'instance) |
| Le bundle appelle des serveurs tiers (exfiltration) | CSP du document servi : `connect-src 'self'`. Le jeu ne peut joindre que l'API de l'instance (le relais `activity:*` passe par le socket de la page, pas par un `fetch` du bundle). | néant tant que la CSP tient |
| Usurpation d'identité dans le bus | Le serveur estampille `from = socket.data.userId` ; le `from` fourni par l'invité est ignoré. | néant |
| Exfiltration de jeton | Il n'y a pas de jeton. L'identité du boot = celle de l'utilisateur, déjà sur la page. | néant |
| SSRF via `app.url` à l'installation | Récupération sous `guardedLookup` (`netFetch.ts`) : loopback / link-local refusés, privé seulement si `classifyHost` public. `isHttpsPublicHost` au manifeste. Flux coupé à `APP_BUNDLE.maxBytes`. | néant |

**Pas de COEP/COOP** sur l'instance (le build Godot mono-thread n'en a pas besoin ; COEP casserait
les embeds YouTube/Twitch/Vimeo). **Aucun sous-domaine, aucun hébergeur externe au runtime.**

---

## 7. Matrice de tests (Vitest, même session que le code — règle maison)

| Fichier | Cas |
|---|---|
| `src/tests/extensionManifest.test.ts` | activité acceptée ; `entry` requis ; `app` https+public exigé ; `app` sans activité rejeté ; activité sans `app` rejetée ; `id` dupliqué rejeté ; `realtime` sans activité rejeté ; clés de message collectées |
| `src/tests/extensionPackage.test.ts` | archive activité-only (manifest + i18n + icône, **zéro JS**) → `ok: true` ; `extractZipSafely` : symlink / zip-slip / type interdit refusés |
| `src/tests/extensionAppBundle.test.ts` *(nouveau)* | sha256 correct → dépaqueté ; sha256 faux → `APP_CHECKSUM_MISMATCH` ; taille > plafond → coupé ; `entry` absent du bundle → `APP_ENTRY_MISSING` ; zip-slip dans le bundle → refusé |
| `src/tests/extensionRoutes.test.ts` | `/extensions/public` renvoie `appUrl` résolu (pas `app`) ; `GET .../app/*` sert avec `application/wasm` + CSP `wasm-unsafe-eval` + `frame-ancestors 'self'` ; garde de chemin |
| `src/tests/activity-relay.test.ts` | garde d'appartenance au salon ; plafonds ; rate-limits ; `from` estampillé ; `to` ciblé ; fan-out `sync` |

`npm run test` + `npm run build` verts avant tout merge. Aucune régression sur les tests existants.

---

## 8. Hors périmètre (v1)

- Surface `page` (jamais montée aujourd'hui — cf `NODYX_SDK_CDC.md` D4, dette G1).
- `nodyx.ui.embed` : inutile ici, l'activité **est** l'embed.
- `core.get`, renouvellement de jeton, `nodyx.imageUrl` (dettes G4/G5/G6 du SDK).
- ~~Persistance d'activité~~ **livré r3, cf §10** (records par joueur + classement d'instance).
  Reste hors périmètre : validateur anti-triche du classement, historique de match détaillé.
- Sélecteur si plusieurs activités installées (v1 ouvre la première).
- Mise à jour incrémentale du bundle (v1 : nouveau `version` = nouveau dossier `app/` complet).
- Lockstep déterministe, features multi jalon 2 du jeu.

---

## 9. Chemin d'implémentation

0. **Côté jeu (fait, `Pokled/nodyx-battle`)** — shim `nodyx-activity.js`, `mock-parent.html`,
   `test-activity-bridge.mjs` (20 assertions), `title.gd`/`lobby.gd`/`net_nodyx.gd`, `export_presets.cfg`,
   `build_web.sh` cross-plateforme. **r2 : `build_web.sh` produit aussi `dist/kings-race-app-<ver>.zip` + son sha256.**
1. **Ce CDC (r2) validé par le propriétaire.** ✅ (2026-08-30 : auto-hébergement + route API confirmés)
2. **Fait (r1) :** `socket/activity.ts` + rate-limits + enregistrement + `activity-relay.test.ts` (15/15).
3. **Fait (r1), à compléter (r2) :** `manifest.ts` — remplacer `activitySurface.url` par `entry` + champ `app`,
   ajouter `ACTIVITY_WITHOUT_APP` / `APP_WITHOUT_ACTIVITY`. `capabilities.ts` (fait). `package.ts` — factoriser
   `extractZipSafely`. `routes/extensions.ts` — `appUrl` résolu au lieu de `url`.
4. **r2 :** `appBundle.ts` (`fetchAndUnpackAppBundle`) + `limits.ts` `APP_BUNDLE` + `extensionAppBundle.test.ts` ;
   `installer.ts` (fetch/unpack dans le staging) ; `extensionFrame.ts` (`GET .../app/*` + CSP document) ;
   `routes/extensions.ts` `/admin/extensions/install` multipart à 2 fichiers.
5. **Fait (r1), à ajuster (r2) :** `host.ts` (pont identique). `ActivitySurface.svelte` — `src` = URL
   d'instance (`appUrl`), `targetOrigin` = `window.location.origin`. **Retirer** `battle.nodyx.org` de
   `svelte.config.js` (`frame-src 'self'` suffit).
6. **Fait (r1) :** `VoiceRoom.svelte` (bouton + overlay), `chat/+page.server.ts`, i18n fr+en.
7. **Phase infra (simplifiée) :** publier `kings-race-app-<ver>.zip` (GitHub Releases) + son sha256 dans
   le `manifest.json` du `.nyx` ; `pack_widget.sh` ; installer le `.nyx` (+ zip en option hors-ligne) ;
   recette bout-en-bout 2 utilisateurs. **Plus de sous-domaine, plus de route Caddy, plus de patch CSP prod.**

---

## 10. Persistance — records par joueur & classement d'instance (r3)

**Amende A7.** Une activité peut désormais persister. Le stockage clé/valeur du SDK
(`src/extensions/storage.ts`, table `extension_storage`, route `POST /extensions/:id/storage`,
quotas au manifeste, plafonds fins, `writesPerMinute: 30`) est **déjà complet** : il ne connaissait
pas les activités uniquement parce que `RE_SURFACE` ne matchait que `page` / `widget:<id>`.

### 10.1 Changements nodyx-core (minimes, forward-only, AUCUNE migration)

- `src/routes/extensions.ts` — `RE_SURFACE` : `^(page|widget:<id>|activity:<id>)$` (mêmes bornes
  `RE_SURFACE_ID` que `widget:`). Sert `/storage`, `/fetch`, `/session`.
- `src/routes/extensions.ts` — check « surface connue » de `POST /session` : accepte
  `surface === 'activity:' + s.id` quand `s.type === 'activity'`.
- `src/extensions/protocol.ts` — `RE_SURFACE` alignée (cohérence ; l'activité ne passe pas par
  `parseRequest` aujourd'hui, mais un futur pont RPC d'activité le ferait).
- `nodyx-frontend/src/lib/extensions/host.ts` — `RE_SURFACE` alignée.
- `src/extensions/manifest.ts`, `capabilities.ts`, `limits.ts` — **inchangés**.
  `storagePermission` + le mapping `storage.user` / `storage.instance.read` / `storage.instance.write`
  (déjà `sensitive`) fonctionnent tels quels.

### 10.2 Le jeton voyage dans le boot payload

La frame d'activité est **same-origin** avec l'instance (§2.3). Elle appelle `POST /extensions/:id/storage`
**directement** (`connect-src 'self'` de la CSP document l'autorise) — pas de round-trip par le port.

- `ActivitySurface.svelte` : `openSession()` (`POST /session`, `surface: 'activity:<id>'`) →
  ajoute `token` + `storageSurface` au boot payload. Ré-émission ~8 min : `port.postMessage({ event: 'session', token })`.
- `host.ts` : `ActivityBootPayload` gagne `token?`, `storageSurface?`. `createActivityHostHandler`
  inchangé (le stockage ne transite pas par le port).
- Jeton court (`SURFACE.tokenTtlSeconds` = 600 s), `userId` projeté côté serveur depuis la session
  réelle de la page (comme page/widget) → `scope: user` porte le vrai `claims.sub`.

### 10.3 Modèle d'écriture

| Donnée | scope | clé | écrit par |
|---|---|---|---|
| Records perso (parties, victoires, défaites, meilleure vague) | `user` | `stats` | chaque joueur, en fin de partie |
| Classement d'instance (top 20 : id, nom, victoires…) | `instance` | `leaderboard` | **l'arbitre seul** (membre siège 0), une écriture en fin de COURSE AUX ROIS |

`scope: instance` en écriture = `storage.instance.write`, **capacité sensible**, accordée
explicitement par l'admin à l'installation. Compromis assumé : l'activité (code tiers) peut écrire
n'importe quoi dans la clé `leaderboard`. Borné par : bundle épinglé sha256 + validé par l'admin,
`writesPerMinute: 30`, quota `instance` (64 Ko), merge idempotent (`ON CONFLICT DO UPDATE`, tableau
trié + plafonné). Un **validateur de classement** (recoupement des `MatchDirector.cmd_log`) est
renvoyé au jalon 3.

### 10.4 Tests (même session que le code)

| Fichier | Cas |
|---|---|
| `src/tests/extensionRoutes.test.ts` | `/session` frappe un jeton `activity:battle` si le manifeste a la surface ; refuse `activity:inconnu` ; `/storage` avec ce jeton : `set`/`get`/`list` scope `user` ; `set` scope `instance` refusé sans `storage.instance.write`, accepté avec |
| `src/tests/extensionManifest.test.ts` | manifeste `activity` + `permissions.storage` accepté ; `storage.instance.write` dans les capacités sensibles |

### 10.5 Hors périmètre (toujours)

Validateur anti-triche du classement · classement multi-instances · records chiffrés.
