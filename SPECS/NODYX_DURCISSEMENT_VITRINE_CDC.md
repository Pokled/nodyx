# CDC — Durcissement de la vitrine publique et des catégories d'annonce

> Statut : **PROPOSITION, en attente de validation** (module critique : `auth` / `forums` / `permissions` + annuaire fédéré).
> Déclencheur : incident « nerti » du 2026-09-01. Rédigé le 2026-09-02.

## 1. Contexte

Le 2026-09-01, un compte fraîchement inscrit (`nerti` / `bwtywdshmt@gmail.com`, spam SEO
depuis une IP Etisalat AE) a réussi à faire apparaître un fil « Alsouq Alshabi » :

- **en tête de la page d'accueil** (widgets « fils récents » et « vitrine articles ») ;
- **dans l'index de recherche global `nodyx.org`** (`network_index`), donc propageable
  aux instances pairs via gossip.

**Aucune faille d'authentification, aucune élévation de privilège.** Le compte était un
`member` standard. Il a simplement exploité le fait que :

1. **N'importe quel membre peut ouvrir un fil dans `📣 Annonces`.** La table `categories`
   n'a aucune notion de permission ; `POST /api/v1/forums/threads` ne vérifie que le
   bannissement communautaire.
2. **Trois surfaces publiques affichent les fils sans filtre de rôle ni de curation**,
   sur la seule fraîcheur :
   - `GET /api/v1/instance/threads/recent` (10 derniers fils, tous auteurs) ;
   - `GET /api/v1/instance/threads/showcase` (ne filtre `is_pinned` que si
     `pinned_only=true`, jamais passé par les widgets par défaut) ;
   - `scheduler.ts › announceThreadsToDirectory()` pousse **tout** fil
     `threads.is_indexed = true` (valeur par défaut de la colonne) vers
     `POST /api/directory/search/announce`.
3. **Un fil supprimé reste indéfiniment dans `network_index`** (aucun mécanisme de
   rétractation). Nettoyé à la main cette fois.
4. **Le bannissement d'IP de l'interface admin ment** : il est ignoré quand
   `users.registration_ip` est une adresse loopback, ce qui est **toujours le cas**
   (l'inscription passe par le proxy SSR). L'admin voit « IP bannie », rien n'est fait.
5. Détail : `users.username` n'est pas `trim()` à l'inscription. Le compte s'appelle
   `"nerti "` (espace finale) → sa page profil publique renvoie 404 et les recherches
   par pseudo exact le ratent.

## 2. Objectif

Qu'un compte sans rôle ne puisse **jamais** :
- écrire dans une catégorie marquée « restreinte » ;
- apparaître dans une surface vitrine (homepage, showcase) ou dans l'annuaire fédéré
  sans acte explicite d'un admin/modérateur.

Le tout **sans marathon de rétro-i18n** et **sans casser** les instances tierces
existantes (rétro-compatibilité des valeurs par défaut).

## 3. Périmètre

### Dans le périmètre
- `nodyx-core` : migration, `routes/forums.ts`, `routes/instance.ts`, `routes/admin.ts`,
  `scheduler.ts`, `models/thread.ts`, `models/community.ts`.
- `nodyx-frontend` : sélecteur de catégorie (`forum/[category]/new`), panneau admin
  catégories, widgets `ArticlesShowcase` / `ArticleSlideshow` / `RecentThreads`.
- i18n : `fr.json` + `en.json` (mêmes clés, même PR).
- Tests Vitest.

### Hors périmètre (backlog séparé)
- Rétractation active dans l'annuaire (`network_index` chez les pairs) : nécessite un
  protocole de tombstone gossip. Item noté, pas traité ici.
- Refonte de la capture d'IP à l'inscription (SSR forwarde mal `cf-connecting-ip`).
  Traité partiellement (point 6) : on cesse de **prétendre** bannir.
- CAPTCHA à l'inscription.

## 4. Modèle de données — migration `117_categories_restriction.sql`

```sql
-- 117 — Restriction d'écriture par catégorie + curation vitrine

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS post_min_role TEXT NOT NULL DEFAULT 'member'
    CHECK (post_min_role IN ('member','moderator','admin','owner'));

COMMENT ON COLUMN categories.post_min_role IS
  'Rôle minimum requis pour ouvrir un fil dans cette catégorie. member = tout le monde (défaut).';

-- La vitrine et l'annuaire ne prennent que ce qui est explicitement mis en avant.
-- Rétro-compat : on NE change PAS is_indexed. On introduit un critère additif.
ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS showcased_at TIMESTAMPTZ;

COMMENT ON COLUMN threads.showcased_at IS
  'Posé quand un admin/mod met le fil en avant (is_featured passe à true). NULL = jamais mis en avant.';

-- Backfill : les fils déjà featured gardent leur mise en avant.
UPDATE threads SET showcased_at = COALESCE(showcased_at, updated_at)
  WHERE is_featured = true AND showcased_at IS NULL;

-- L'instance nodyx.org : verrouiller 📣 Annonces en admin.
-- (les autres instances gardent 'member' par défaut, à elles de choisir)
UPDATE categories SET post_min_role = 'admin'
  WHERE slug = 'annonces' AND community_id = (
    SELECT id FROM communities WHERE slug = current_setting('nodyx.community_slug', true)
  );
```

> **Décision à valider (D1)** : la dernière requête (verrouiller `annonces` sur
> l'instance nodyx). Alternative : laisser l'admin le faire à la main depuis le panneau
> après déploiement. Je penche pour l'automatiser mais seulement pour `slug='annonces'`.

## 5. Backend

### 5.1 `routes/forums.ts` — `POST /threads`

Après résolution de `category_id`, avant `ThreadModel.create` :

```ts
const { rows: catRows } = await db.query<{ community_id: string; post_min_role: string }>(
  `SELECT community_id, post_min_role FROM categories WHERE id = $1 LIMIT 1`, [category_id]
)
if (!catRows[0]) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })

if (catRows[0].post_min_role !== 'member') {
  const { rows: r } = await db.query<{ role: string }>(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
    [catRows[0].community_id, request.user!.userId]
  )
  const RANK = { member: 0, moderator: 1, admin: 2, owner: 3 } as const
  const have = RANK[r[0]?.role as keyof typeof RANK] ?? -1
  const need = RANK[catRows[0].post_min_role as keyof typeof RANK]
  if (have < need) {
    return reply.code(403).send({
      error: 'Cette catégorie est réservée à l’équipe.',
      code: 'CATEGORY_RESTRICTED',
    })
  }
}
```

- Nouveau `code` stable : `CATEGORY_RESTRICTED` (règle des codes SCREAMING_SNAKE).
- Le `error` reste le fallback d'affichage (FR ici, cohérent avec la dette existante).

### 5.2 `routes/forums.ts` — `PATCH /threads/:id`

Bug existant : le gate admin ne couvre que `is_pinned` / `is_locked`, **pas
`is_featured`**. Un simple modérateur peut mettre un fil en avant.

```ts
// Pin / lock / featured : réservés owner ou admin (pas modérateur)
if (body.is_pinned !== undefined || body.is_locked !== undefined || body.is_featured !== undefined) {
  if (!await isAdmin(userId, threadId)) {
    return reply.code(403).send({ error: 'Only admins and owners can pin, lock or feature threads', code: 'FORBIDDEN' })
  }
}
```

Et quand `is_featured` passe à `true`, poser `showcased_at = NOW()` ; à `false`, le
remettre à `NULL`. À porter dans `ThreadModel.update`.

> **Décision à valider (D2)** : garder `is_featured` en admin-only, ou l'ouvrir aux
> modérateurs (rôle `moderator`) ? Aujourd'hui c'est de fait ouvert aux mods (bug).
> Je propose admin-only, cohérent avec pin/lock.

### 5.3 `models/thread.ts` — `getFeatured()` et la requête showcase

Les deux branches « par catégorie » (`getFeatured(limit, categoryId)` et
`instance.ts › /threads/showcase` avec `?category=`) doivent cesser de renvoyer
« les fils récents de la catégorie » et ne renvoyer que les fils **mis en avant** :

```sql
WHERE (c.id::text = $2 OR c.slug = $2)
  AND t.showcased_at IS NOT NULL
ORDER BY t.showcased_at DESC
```

Idem la branche sans catégorie : `WHERE t.is_featured = true` reste, mais on trie par
`showcased_at DESC` (plus stable que `created_at`).

`/threads/recent` : **reste tel quel** (c'est un flux d'activité assumé), MAIS on exclut
les catégories `post_min_role <> 'member'` dont le fil n'est pas featured :

```sql
WHERE c.community_id = $1
  AND (c.post_min_role = 'member' OR t.is_featured = true)
```

> **Décision à valider (D3)** : est-ce qu'on veut aussi que `/threads/recent` cache les
> fils des catégories restreintes non-featured, ou seulement les surfaces « éditoriales » ?
> Je propose : `/threads/recent` garde tout SAUF les catégories restreintes (un fil
> d'annonce à moitié rédigé ne doit pas fuiter avant publication).

### 5.4 `scheduler.ts` — `announceThreadsToDirectory()`

```sql
WHERE t.is_indexed = true
  AND t.is_featured = true            -- AJOUT : seul l'éditorialisé part en fédération
  AND (t.last_indexed_at IS NULL OR t.updated_at > t.last_indexed_at)
```

> **Décision à valider (D4)** : critère `is_featured = true` OU un nouveau flag
> `is_federated` distinct ? `is_featured` est le plus simple et couvre 100 % du besoin
> actuel. Un flag distinct = plus de surface UI pour un gain théorique.

Conséquence : après déploiement, `announce` ne poussera plus les ~centaines de fils
non-featured déjà annoncés. Ils **restent** dans `network_index` (pas de rétractation).
Acceptable : ils sont légitimes. Si on veut faire le ménage : script ponctuel séparé
`DELETE FROM network_index WHERE instance_slug='nodyx' AND content_id NOT IN
(SELECT id FROM threads WHERE is_featured)`. **Hors périmètre, à décider après.**

### 5.5 `routes/admin.ts` — panneau catégories

`PatchCategoryBody` + `PATCH /categories/:id` : accepter `post_min_role`.

```ts
const PatchCategoryBody = z.object({
  name:          z.string().min(1).max(100).optional(),
  description:   z.string().max(1000).optional(),
  position:      z.number().int().min(0).optional(),
  parent_id:     z.string().uuid().nullable().optional(),
  post_min_role: z.enum(['member','moderator','admin','owner']).optional(),  // AJOUT
})
```
`logAction(..., 'category_restrict', 'category', id, name, { post_min_role })` quand la
valeur change.

### 5.6 `routes/admin.ts` — bannissement IP honnête

Dans `POST /members/:userId/ban`, quand `body.ban_ip` est demandé mais que
`registration_ip` est loopback/absente :

```ts
let ipBanApplied: string | null = null
const candidateIp = registration_ip && !PROTECTED_IPS.includes(registration_ip)
  ? registration_ip
  : null
if (body.ban_ip && candidateIp) {
  await db.query(`INSERT INTO ip_bans ...`, [candidateIp, ...])
  ipBanApplied = candidateIp
}
// ...
return reply.send({
  ok: true,
  ip_ban_applied: ipBanApplied,          // null => le front affiche "IP indisponible, non bannie"
  registration_ip: registration_ip ?? null,
})
```

Le front (`admin/members`) affiche le résultat réel au lieu d'un succès générique.

> **Décision à valider (D5)** : va-t-on plus loin et on capte la vraie IP
> (`getClientIp`) dans une colonne `users.last_seen_ip` mise à jour à chaque login,
> pour que le ban IP ait une cible utile ? C'est le seul moyen que « bannir l'IP »
> serve vraiment. Migration légère. **Je le recommande** mais c'est un point distinct.

### 5.7 `routes/auth.ts` — `trim()` username

`RegisterBody` : `username: z.string().trim().min(3).max(50)` (Zod `.trim()` avant
`.min`). Migration `117` (ou 118) : `UPDATE users SET username = btrim(username)
WHERE username <> btrim(username)` — après vérif qu'aucune collision n'en résulte
(`SELECT btrim(username), count(*) ... HAVING count(*) > 1`). Le compte `nerti ` est
banni, la collision est nulle, mais le script doit être défensif pour les tierces
instances.

## 6. Frontend

| Fichier | Changement |
|---|---|
| `forum/[category]/new/+page.svelte` | Filtrer le `<select>` : ne proposer que les catégories où `post_min_role` autorise l'utilisateur courant (`data.categories` porte déjà la colonne via `SELECT c.*`). Passer le rôle courant au `load`. Si l'URL pointe une catégorie interdite → message + redirection `/forum`. |
| `forum/[category]/new/+page.server.ts` | Sur `fail(res.status)` : mapper `code === 'CATEGORY_RESTRICTED'` vers `tFn('forum.category_restricted')`. |
| `admin/categories/+page.svelte` | Ajouter un `<select>` « Qui peut poster » (4 valeurs) par catégorie. |
| `lib/components/homepage/widgets/ArticlesShowcase.svelte` | RAS si le back filtre. Vérifier que `pinned_only` n'est plus la seule barrière (le back le garantit). |
| `lib/components/homepage/widgets/ArticleSlideshow.svelte` | Le widget passe `?category=` mais le back lit `?category_id=` : bug muet préexistant. Corriger le nom du param tant qu'on y est. |

### i18n — nouvelles clés (`fr.json` + `en.json`, même PR)

| clé | fr | en |
|---|---|---|
| `forum.category_restricted` | « Cette catégorie est réservée à l’équipe. » | "This category is reserved for the team." |
| `forum.new_topic_no_category` | « Aucune catégorie ouverte à la publication. » | "No category open for posting." |
| `admin.categories.post_min_role_label` | « Qui peut ouvrir un fil » | "Who can start a thread" |
| `admin.categories.role_member` | « Tout le monde » | "Everyone" |
| `admin.categories.role_moderator` | « Modérateurs et + » | "Moderators and up" |
| `admin.categories.role_admin` | « Admins et + » | "Admins and up" |
| `admin.categories.role_owner` | « Propriétaire uniquement » | "Owner only" |
| `admin.members.ip_ban_unavailable` | « IP réelle indisponible, non bannie. » | "Real IP unavailable, not banned." |

Passer `npm run i18n:check i18n:ts:check i18n:keys:check i18n:parity:check
i18n:placeholders:check` avant push.

## 7. Tests (Vitest, `nodyx-core`, même session que le code)

1. `POST /threads` dans une catégorie `post_min_role='admin'` :
   - `member` → **403 `CATEGORY_RESTRICTED`** (le test doit tomber sur le code actuel) ;
   - `admin` → 201.
2. `POST /threads` dans une catégorie `member` → 201 pour un `member` (non-régression).
3. `PATCH /threads/:id { is_featured: true }` :
   - `moderator` → 403 (tombe sur le code actuel qui laisse passer) ;
   - `admin` → 200 + `showcased_at` non nul.
4. `getFeatured(limit, 'annonces')` ne renvoie que les fils `showcased_at IS NOT NULL`.
5. `announceThreadsToDirectory` : un fil non-featured n'est pas dans le payload
   (mock `fetch`, assert body).
6. Ban : `registration_ip = '127.0.0.1'` + `ban_ip: true` → réponse
   `ip_ban_applied: null`, aucune ligne `ip_bans`.
7. `RegisterBody` : `username: 'nerti '` → stocké `'nerti'`.

## 8. Déploiement / rollback

- Migration `117` auto au boot (idempotente, `ADD COLUMN IF NOT EXISTS`).
- Ordre : merge → `npm run build` core + front → `pm2 restart` (voir CLAUDE.md, prod
  sous `sudo -u nodyx`).
- **Rollback** : les colonnes ajoutées sont inertes si le code revient en arrière
  (`post_min_role` ignoré, `showcased_at` ignoré). Pas de `DROP` nécessaire.
- Après déploiement : vérifier `/`, `/forum`, `/forum/annonces/new` (doit rediriger
  pour un non-admin), l'annuaire (`curl .../search?q=...`).

## 9. Points à valider avant code (récap)

| # | Question |
|---|---|
| D1 | Verrouiller `slug='annonces'` sur nodyx.org dans la migration, ou à la main après ? |
| D2 | `is_featured` : admin-only (proposé) ou ouvert aux modérateurs ? |
| D3 | `/threads/recent` : cacher les catégories restreintes non-featured (proposé) ? |
| D4 | Critère fédération : `is_featured` (proposé) ou nouveau flag `is_federated` ? |
| D5 | Ajouter `users.last_seen_ip` (login) pour que le ban IP ait une cible ? |
| D6 | Ménage rétroactif de `network_index` (fils non-featured déjà annoncés) : oui / non / plus tard ? |

## 10. Estimation

- Migration + backend : ~1 séance.
- Frontend + i18n : ~1 séance.
- Tests : inclus dans chaque séance (règle test-first module critique).
- 1 PR unique, CI verte + `npm run check` obligatoires avant merge.
