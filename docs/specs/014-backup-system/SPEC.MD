# Nodyx Backup System

**Statut** : validée — Phase 1 (MVP) en cours d'implémentation sur la branche `feat/backup-system`
**Numéro de spec** : 014
**Date initiale** : 2026-04-27
**Date de validation** : 2026-05-06
**Auteur** : Pokled + Claude
**Phase cible** : v2.4

---

## 1. Vision & principes

Un admin Nodyx doit pouvoir, en moins de 30 secondes, créer une sauvegarde complète de son instance et la restaurer sans toucher à la ligne de commande. Le système est :

- **Self-hosted** : zéro dépendance externe, tout reste sur le VPS de l'admin
- **Topology-agnostic** : fonctionne identiquement en VPS direct, Docker, Cloudflare Tunnel, Pangolin, ou sous-domaine `*.nodyx.org`
- **Sûr par défaut** : le restore ne s'exécute jamais sans confirmation explicite, et un snapshot automatique pré-restore est créé en filet de sécurité
- **Transparent** : l'admin voit toujours quelle taille fait la sauvegarde, où elle est stockée, ce qu'elle contient

**Tradeoff principal accepté** : un backup full peut peser plusieurs Go. On affiche la taille au-dessus du tableau et on offre la rétention rotative (10 max par défaut) pour ne pas saturer le disque.

---

## 2. Contenu d'une archive

Format : `nodyx-backup-{instance_slug}-{ISO_timestamp}.tar.gz`

```
nodyx-backup-monclan-2026-04-27T14-30-00Z.tar.gz
├── manifest.json          ← métadonnées
├── database.sql.gz        ← pg_dump --custom --compress=9
├── uploads/               ← assets utilisateurs
│   ├── avatars/
│   ├── covers/
│   ├── messages/
│   └── library/
├── config/
│   ├── instance.json      ← settings instance (nom, langue, etc.)
│   └── modules.json       ← modules activés et leur config
└── checksum.sha256        ← intégrité de tout le reste
```

**Contenu de `manifest.json`** :

```json
{
  "format_version": 1,
  "nodyx_version": "1.7.0",
  "created_at": "2026-04-27T14:30:00Z",
  "instance": {
    "name": "Mon Clan",
    "slug": "monclan",
    "language": "fr"
  },
  "contents": {
    "database": true,
    "uploads": true,
    "config": true
  },
  "stats": {
    "users": 142,
    "threads": 1287,
    "messages": 45302,
    "uploads_count": 3421,
    "uploads_size_bytes": 458934821
  },
  "encryption": "none",
  "label": "avant migration v1.8",
  "checksum_algo": "sha256"
}
```

**Pourquoi `tar.gz` et pas `zip`** : meilleure compression, natif unix, restore scriptable, supporte le streaming pour les gros fichiers.

---

## 3. Database schema

Migration `077_backups.sql` :

```sql
CREATE TABLE backups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename        TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  nodyx_version   TEXT NOT NULL,
  format_version  INTEGER NOT NULL DEFAULT 1,
  contents        JSONB NOT NULL,                  -- { db: true, uploads: true, ... }
  stats           JSONB NOT NULL,                  -- snapshot stats au moment du backup
  label           TEXT,                            -- libre, ex: "avant migration"
  encrypted       BOOLEAN NOT NULL DEFAULT FALSE,
  checksum        TEXT NOT NULL,                   -- sha256 hex
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'scheduled' | 'pre-restore'
  protected       BOOLEAN NOT NULL DEFAULT FALSE   -- snapshots pre-restore = protected 24h
);

CREATE INDEX idx_backups_created_at ON backups(created_at DESC);

CREATE TABLE backup_settings (
  id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  auto_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  auto_frequency           TEXT NOT NULL DEFAULT 'daily',                 -- 'daily' | 'weekly' | 'monthly'
  auto_hour_utc            INTEGER NOT NULL DEFAULT 3,                    -- 0-23
  auto_day_of_week         INTEGER,                                       -- 0-6 si weekly
  auto_day_of_month        INTEGER,                                       -- 1-28 si monthly
  retention_count          INTEGER NOT NULL DEFAULT 10 CHECK (retention_count BETWEEN 1 AND 50),
  include_uploads_default  BOOLEAN NOT NULL DEFAULT TRUE,
  encryption_passphrase    TEXT,                                          -- argon2 hash si défini
  notify_email             TEXT,                                          -- email pour alertes
  notify_on_success        BOOLEAN NOT NULL DEFAULT FALSE,
  notify_on_failure        BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_failures     INTEGER NOT NULL DEFAULT 0,                    -- compteur pour alertes répétées
  low_disk_threshold_gb    INTEGER NOT NULL DEFAULT 5,                    -- alerte proactive
  low_disk_alerted_at      TIMESTAMPTZ,                                   -- anti-spam alertes disque
  auto_minute_utc          INTEGER NOT NULL DEFAULT 0 CHECK (auto_minute_utc BETWEEN 0 AND 59),
  passphrase_acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,                -- admin a confirmé avoir noté la passphrase
  last_auto_run_at         TIMESTAMPTZ,
  last_auto_status         TEXT,                                          -- 'success' | 'failed'
  last_auto_error          TEXT
);

INSERT INTO backup_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE backup_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  backup_id   UUID REFERENCES backups(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                       -- 'create' | 'restore' | 'delete' | 'download' | 'verify' | 'settings_change'
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB,                               -- contexte action (label, dry_run, etc.)
  status      TEXT NOT NULL,                       -- 'success' | 'failed'
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backup_audit_created_at ON backup_audit_log(created_at DESC);
CREATE INDEX idx_backup_audit_user ON backup_audit_log(user_id, created_at DESC);
```

---

## 4. API endpoints

Tous prefixés `/api/v1/admin/backups`, protégés par `requireAuth` + `adminOnly`.

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Liste des backups (paginée, triée DESC par date) |
| `POST` | `/` | Crée un backup (body : `{ include_uploads, label }`) |
| `GET` | `/:id` | Détails d'un backup |
| `GET` | `/:id/download` | Stream l'archive. Param optionnel `?passphrase=xxx` chiffre à la volée même si backup stocké en clair |
| `DELETE` | `/:id` | Supprime un backup (refusé si `protected = true`) |
| `POST` | `/:id/restore` | Lance un restore (body : `{ confirm_slug, dry_run }`) |
| `GET` | `/settings` | Lit les settings auto-backup |
| `PUT` | `/settings` | Maj des settings auto-backup |
| `GET` | `/storage` | Espace disque utilisé/disponible (`{ used, available, total }`) |
| `POST` | `/upload` | Upload d'un backup externe (drag & drop d'un .tar.gz) |
| `POST` | `/:id/verify` | Vérifie l'intégrité d'un backup sans le restaurer |
| `GET` | `/:id/diff` | Compare le backup à l'état actuel (preview avant restore) |
| `GET` | `/audit` | Journal d'audit (paginé, filtres action/user/date) |

**Streaming** : `POST /` et `POST /:id/restore` retournent immédiatement un `job_id` et émettent les progrès via Socket.IO sur le canal admin (`backup:progress`, `backup:done`, `backup:error`). Le job tourne côté serveur, l'admin peut fermer la page sans interrompre.

**Topology detection** : le service backup détecte automatiquement :
- Docker via `/.dockerenv`
- Postgres distant vs local via `DB_HOST`
- Path uploads via `UPLOADS_DIR` env (default `/var/www/nexus/nodyx-core/uploads`)

---

## 5. UI Admin

Route : `/admin/backups`

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Sauvegardes & Restauration                          (?)    │
│  Crée des points de restauration de ton instance.           │
├─────────────────────────────────────────────────────────────┤
│  Espace utilisé : 1.2 Go / 47 Go disponibles    [▓▓░░░░░]   │
│  Backups stockés : 4 / 10 max                                │
├─────────────────────────────────────────────────────────────┤
│  [+ Créer une sauvegarde maintenant]   [⚙ Sauvegardes auto] │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 📦 nodyx-backup-monclan-2026-04-27T14-30Z.tar.gz    │  │
│  │ Manuel · 342 MB · il y a 2 heures · v1.7.0          │  │
│  │ "avant migration v1.8"                              │  │
│  │ [Télécharger] [Restaurer] [Supprimer]               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 🔒 nodyx-backup-monclan-2026-04-26T03-00Z.tar.gz    │  │
│  │ Pre-restore · 339 MB · hier · v1.7.0                │  │
│  │ Protégé pendant encore 22h                          │  │
│  │ [Télécharger]                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

### Composants Svelte

- `BackupCard.svelte` : une ligne de sauvegarde
- `BackupCreateModal.svelte` : formulaire création (label, include_uploads, encryption optionnelle)
- `BackupProgressModal.svelte` : progression live d'un job en cours
- `BackupRestoreModal.svelte` : flow restore avec confirmation type-to-confirm
- `BackupScheduleModal.svelte` : config auto-backup
- `BackupUploadDropzone.svelte` : drag & drop d'un backup externe

### Modale de progression (création + restore)

Pendant un job actif :

```
┌─ Sauvegarde en cours ───────────────────────────────────────┐
│                                                              │
│  Compression base de données...                              │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  62%                      │
│                                                              │
│  Étape 2/4 · Temps restant estimé : ~45s                    │
│                                                              │
│  ℹ Le backup tourne côté serveur. Tu peux fermer cette      │
│    fenêtre, le job continuera et tu recevras une            │
│    notification dès qu'il sera terminé.                      │
│                                                              │
│                          [Réduire]  [Fermer la fenêtre]      │
└──────────────────────────────────────────────────────────────┘
```

**Comportement** :
- Barre de progression alimentée par les events Socket.IO `backup:progress` (`{ job_id, step, percent, eta_seconds }`)
- Étapes affichées en clair :
  - **Création** : "Préparation" → "Dump base de données" → "Compression uploads" → "Finalisation archive"
  - **Restore** : "Vérification archive" → "Snapshot pré-restore" → "Restauration base" → "Restauration fichiers" → "Redémarrage"
- Bouton **Réduire** : modale collapse en pill flottant en bas-droite "Backup en cours · 62%" cliquable pour rouvrir
- Bouton **Fermer la fenêtre** : ferme la modale, job continue, toast au retour

### beforeunload guard

Si un job est actif et l'admin tente de fermer l'onglet ou de refresh :

```javascript
window.addEventListener('beforeunload', (e) => {
  if (activeBackupJob) {
    e.preventDefault()
    e.returnValue = 'Un backup est en cours. Il continuera en arrière-plan, mais tu perdras la barre de progression. Continuer ?'
  }
})
```

Le warning navigateur est **non-bloquant** : l'admin peut confirmer le départ. Le job continue côté serveur et la notif d'achèvement le rattrapera au prochain login (badge cloche + toast).

### Notification d'achèvement

À la réception de `backup:done` ou `backup:error` :
- Si l'admin est sur la page : toast vert/rouge avec lien "Voir le backup" / "Voir l'erreur"
- Sinon : insertion d'une notif admin (table `notifications` existante, type `backup_done` / `backup_failed`), badge cloche s'incrémente, toast au prochain chargement de page admin

### Tooltips (icones (?) partout)

Chaque libellé technique a un `(?)` qui ouvre un panneau details (réutiliser le composant `details` du Homepage Builder) :

- "Que contient une sauvegarde" → liste détaillée
- "Combien de temps prend une sauvegarde" → estimation basée sur la taille DB
- "Que se passe-t-il pendant un restore" → étapes + warning
- "Sauvegardes automatiques" → fréquences possibles + horaires UTC
- "Encryption" → quand l'utiliser, comment retrouver son passphrase
- "Espace disque" → comment libérer de la place

---

## 6. Restore flow (le moment dangereux)

Quand l'admin clique **Restaurer** :

### Étape 1 — Modale d'avertissement avec diff preview

L'endpoint `GET /:id/diff` calcule en temps réel la différence entre l'état actuel et le contenu du backup, et l'admin la voit avant de confirmer :

```
┌─ Restaurer cette sauvegarde ? ──────────────────────────────┐
│                                                              │
│  ⚠ ATTENTION : action irréversible                           │
│                                                              │
│  Cette opération va effacer TOUTES les données actuelles     │
│  et les remplacer par celles du backup du 27 avril 14h30.    │
│                                                              │
│  ─ Ce que tu vas PERDRE depuis le backup ─                   │
│  • 47 nouveaux threads                                       │
│  • 1 203 nouveaux messages                                   │
│  • 12 nouveaux utilisateurs inscrits                         │
│  • 89 nouveaux fichiers uploadés (234 MB)                    │
│  • 3 changements de paramètres instance                      │
│                                                              │
│  ✓ Une sauvegarde de l'état actuel sera créée                │
│    automatiquement avant le restore (protégée 24h).          │
│                                                              │
│  Pour confirmer, tape le nom de ta communauté :              │
│  ┌────────────────────────────────────────────┐              │
│  │ monclan                                     │              │
│  └────────────────────────────────────────────┘              │
│                                                              │
│  [Annuler]                  [Restaurer dans 5s ⏱]            │
└──────────────────────────────────────────────────────────────┘
```

Le diff donne à l'admin une compréhension *concrète* de ce qu'il va perdre. Bien plus efficace qu'un warning abstrait.

- Bouton désactivé tant que slug != tapé exactement
- Bouton désactivé pendant 5s même quand slug correct (anti-clic réflexe)
- Texte du bouton change : "Restaurer dans 5s" → "Restaurer dans 4s" → ... → "Restaurer maintenant"

### Étape 2 — Dry-run automatique

Avant l'écriture, le service parse l'archive et vérifie :
- Checksum SHA-256 OK
- Format version compatible (≤ format_version actuel)
- Nodyx version compatible (≤ version actuelle, sinon BLOQUE)
- Espace disque suffisant pour pré-restore + extraction

Si une vérification échoue : message clair, restore avorté.

### Étape 3 — Pré-restore snapshot

Création automatique d'un backup `source = 'pre-restore'`, `protected = true`, expiration 24h. **Non supprimable manuellement** pendant cette fenêtre.

### Étape 4 — Restore

Phases visibles via Socket.IO :
1. Mise en pause Socket.IO + nouvelle écriture (lock court)
2. `pg_restore` avec `--clean --if-exists`
3. Sync uploads (rsync ou cp)
4. Reload config instance + modules
5. Restart Fastify (PM2 graceful reload)

Progress bar avec étape courante et % global.

### Étape 5 — Confirmation

Toast vert : "Restauration terminée. Tu as été déconnecté." + redirect login (les sessions Redis sont invalidées car DB users restaurée).

---

## 7. Scheduler auto-backup

Réutilisation du scheduler existant (`nodyx-core/src/services/scheduler.ts`).

```typescript
// Tick chaque heure, vérifie si on doit lancer un backup auto
setInterval(async () => {
  const settings = await getBackupSettings()
  if (!settings.auto_enabled) return

  const now = new Date()
  const utcHour = now.getUTCHours()
  if (utcHour !== settings.auto_hour_utc) return

  // ... logique daily/weekly/monthly
  // ... éviter double run dans la même heure
}, 60 * 60 * 1000)
```

**Rotation** : après création d'un backup auto réussi, supprime les `source = 'scheduled'` au-delà de `retention_count`. Les `manual` ne sont jamais auto-supprimés (l'admin les gère).

**Notif** : émission d'une notif admin in-app (badge cloche) à chaque backup auto, succès ou échec.

**Disk space check pré-backup** : avant chaque backup auto, le scheduler vérifie que `available_bytes > 2.5 * average_backup_size`. Si non, le backup est annulé, `last_auto_status = 'failed'`, raison `disk_full`, et une alerte est envoyée à l'admin (in-app + email si configuré). Évite que l'auto-backup remplisse silencieusement le disque jusqu'à crasher Postgres.

**Alerte proactive espace disque** : un check toutes les 6h compare `available_bytes < low_disk_threshold_gb * 1024^3` (default 5 Go). Si seuil franchi, alerte envoyée UNE FOIS (anti-spam via `low_disk_alerted_at`), réinitialisée quand l'espace remonte au-dessus du seuil. L'admin est prévenu *avant* qu'un backup échoue, pas après.

**Scheduler intelligence** :
- `auto_minute_utc` permet de fixer la minute exacte (ex : 03:17 plutôt que 03:00 pile, évite les conflits avec d'autres jobs cron classiques)
- Avant lancement, le scheduler vérifie un Redis lock global `nodyx:scheduler:heavy_job_running` posé par d'autres tâches lourdes (calcul stats, indexation search). Si pris, le backup retry dans 15 min jusqu'à 3 fois max

**Email alerts** : si `notify_email` est défini dans `backup_settings`, un email est envoyé via le `emailService` existant :
- À chaque échec auto-backup si `notify_on_failure = true` (default)
- À chaque succès si `notify_on_success = true` (off par défaut)
- **Alerte critique** : si `consecutive_failures >= 3`, email avec sujet "ALERTE : 3 sauvegardes auto consécutives ont échoué" — l'admin doit savoir si son backup auto est cassé depuis 3 jours

---

## 8. Audit log & Verify

### Audit log

Chaque action sensible est loggée dans `backup_audit_log` avec IP, user-agent, user_id, metadata. Visible dans `/admin/backups/audit` (page séparée) :

```
27 avr. 14:32 · pokled · CRÉATION   · "avant migration v1.8" · OK · 90.45.x.x
27 avr. 14:30 · pokled · TÉLÉCHARGEMENT · backup-...14-30Z   · OK · 90.45.x.x
26 avr. 09:15 · pokled · RESTORE    · backup-...03-00Z       · OK · 90.45.x.x
26 avr. 09:14 · pokled · VÉRIFICATION · backup-...03-00Z     · OK · 90.45.x.x
25 avr. 03:00 · system · CRÉATION   · auto-daily             · OK · -
24 avr. 03:00 · system · CRÉATION   · auto-daily             · ÉCHEC · disk_full
```

Critique pour la sécurité : si une instance est compromise, l'admin doit pouvoir voir si un attaquant a téléchargé un backup (= exfiltration de toute la DB).

### Verify (sanity check sans restore)

Bouton **Vérifier** sur chaque backup card. Lance un job qui :

1. Recalcule le SHA-256 et compare au manifest
2. Liste les fichiers internes du tar.gz et vérifie la cohérence avec le manifest
3. Tente un parse partiel du `database.sql.gz` pour détecter une corruption
4. (Si encrypted) demande le passphrase et vérifie qu'il déchiffre

Affiche un badge "✓ Vérifié le 27 avril" sur la card pendant 7 jours. Permet à l'admin de tester ses backups *avant* d'en avoir besoin, pas en plein incident.

---

## 9. Topologies supportées

### A. VPS direct (install.sh)

- `BACKUP_DIR=/var/www/nexus/backups` (créé au setup)
- `pg_dump` local via socket
- Tar des uploads depuis le filesystem

### B. Home server via tunnel (install_tunnel.sh)

Identique à A, mais :
- Avertissement UI : "Ton serveur a une connexion résidentielle. Le téléchargement d'un backup volumineux peut être lent."
- Si la taille dépasse 1 Go, suggérer de désactiver `include_uploads` ou de transférer en SSH plutôt qu'HTTPS

### C. Docker (docker-compose.yml)

Détection : `fs.existsSync('/.dockerenv')`.

- `pg_dump` via `PGHOST=postgres` (variable docker-compose)
- `BACKUP_DIR=/data/backups` doit être un volume bind-mount déclaré dans `docker-compose.yml` (à ajouter dans la PR)
- Documentation : indiquer comment ajouter le volume si l'admin a fait son propre `docker-compose.yml`

**Bind-mount uploads obligatoire** : sans bind-mount sur `/app/uploads`, le restore peut écraser un volume Docker non persistant et perdre les données. La doc Docker doit explicitement recommander :

```yaml
services:
  nodyx-core:
    volumes:
      - ./uploads:/app/uploads        # ← bind-mount, PAS un named volume
      - ./backups:/data/backups       # ← bind-mount aussi
```

Au boot, le service backup vérifie que `UPLOADS_DIR` est bien un bind-mount (via `mount` ou en testant `stat` cross-host). Si named volume détecté, warning rouge dans `/admin/backups` : "Tes uploads sont sur un volume Docker, pas un bind-mount. Le restore peut être dangereux. Voir la doc."

### D. Sous-domaine *.nodyx.org

Identique à A. Avertissement UI sur la limite de stockage du shared host (à confirmer selon politique nodyx.org).

---

## 10. Encryption

### Encryption au repos (optionnelle)

Workflow :

1. Admin définit un passphrase dans Settings → Sauvegardes (stocké hashé via argon2 pour vérification, **jamais en clair**)
2. À la création d'un backup, si passphrase défini → `database.sql.gz` et `uploads/` sont chiffrés avec AES-256-GCM, clé dérivée du passphrase via argon2id (sel dans manifest.json)
3. Au restore, l'admin doit ressaisir le passphrase

### Encryption à la volée au téléchargement

Cas d'usage : l'admin stocke ses backups en clair sur le serveur (rapidité), mais veut un fichier chiffré quand il le télécharge sur son laptop ou Google Drive.

`GET /:id/download?passphrase=xxx` chiffre le stream à la volée, même si le backup serveur est en clair. Le filename devient `nodyx-backup-xxx-encrypted.tar.gz.aes`. L'admin restore plus tard avec ce passphrase.

Avantage : si le laptop de l'admin est volé, le backup téléchargé reste illisible.

### Gestion de la passphrase perdue

À l'activation de l'encryption, modale de warning **rouge** avec 3 cases obligatoires :

```
┌─ Activer l'encryption des sauvegardes ──────────────────────┐
│                                                              │
│  ⚠ AVERTISSEMENT IRRÉVERSIBLE                                │
│                                                              │
│  Si tu perds cette passphrase, TOUS tes backups chiffrés     │
│  deviendront DÉFINITIVEMENT INACCESSIBLES. Aucun moyen       │
│  de récupération n'existe, pas même pour Nodyx.              │
│                                                              │
│  Avant de continuer, confirme :                              │
│                                                              │
│  ☐ J'ai noté la passphrase dans un endroit sûr               │
│    (gestionnaire de mots de passe, coffre-fort)              │
│  ☐ Je comprends qu'aucune récupération n'est possible        │
│  ☐ J'accepte la responsabilité totale de cette passphrase    │
│                                                              │
│  [📥 Télécharger un fichier de secours]                      │
│  (TXT contenant la passphrase + hash de vérif, à stocker     │
│   hors-ligne, jamais sur le même serveur)                    │
│                                                              │
│  [Annuler]                              [Activer]            │
└──────────────────────────────────────────────────────────────┘
```

`passphrase_acknowledged = true` est posé à la confirmation. Ensuite, à chaque backup chiffré créé, un mini-rappel discret : "Encryption active, passphrase notée le 27 avril 2026".

**Option clé GPG (V2)** : permettre `gpg_public_key` dans `backup_settings` au lieu d'un passphrase. Le backup est chiffré avec la clé publique GPG fournie. Aucune passphrase à mémoriser, le déchiffrement nécessite la clé privée GPG de l'admin.

---

## 11. Documentation

### Page docs publique : `/docs/admin/backup`

Sections :
1. **Démarrage rapide** : 3 étapes, 30 secondes
2. **Que contient une sauvegarde** : liste exhaustive
3. **Restaurer une sauvegarde** : avec captures
4. **Sauvegardes automatiques** : config, fréquences, rotation
5. **Encryption** : quand l'utiliser, mise en garde passphrase
6. **Migrer vers un autre serveur** : flow download → upload sur nouveau VPS → restore
7. **Cas Docker** : spécificités volumes
8. **Cas Cloudflare Tunnel** : recommandations bandwidth
9. **Dépannage** : erreurs courantes (espace disque, version incompatible)
10. **FAQ**

### Tooltips inline

Composant `<HelpDot>` réutilisable dans tout le panel admin :

```svelte
<HelpDot>
  <strong>Que contient cette sauvegarde ?</strong>
  Une sauvegarde Nodyx contient :
  • Toute la base de données (utilisateurs, posts, messages...)
  • Les fichiers uploadés (avatars, images, vidéos...)
  • La configuration de l'instance et des modules
  <a href="/docs/admin/backup#contenu" target="_blank">En savoir plus →</a>
</HelpDot>
```

---

## 12. Phases d'implémentation

### Phase 1 — MVP fonctionnel (3-4 jours)

- Migration 077 + tables `backups`, `backup_settings`, `backup_audit_log`
- Service `backupService.ts` : create + restore (sans Socket.IO progress)
- Routes API : list, create, download, delete, restore
- UI admin de base : tableau + bouton create + modale restore
- Type-to-confirm + 5s countdown
- Pré-restore snapshot
- **Mode test (`NODE_ENV=test`)** : le service crée une DB temporaire `nexus_test_<random>` pour les tests E2E de restore, drop à la fin. Permet la CI sans toucher à la prod
- Tests vitest sur le service (création, verify, restore en DB temp)

### Phase 2 — UX & confort (2-3 jours)

- Socket.IO progress
- Auto-backup scheduler + UI settings
- Rotation
- Tooltips + page docs
- Storage indicator
- Upload backup externe (drag & drop)

### Phase 3 — Robustesse (2 jours)

- Encryption AES-256-GCM
- Détection topology Docker
- Volume Docker dans docker-compose.yml
- Avertissements bandwidth tunnel

### Phase 4 — Polish (1 jour)

- Animations succès
- Empty state design
- Skeleton loaders
- Error boundary spécifique au panel

---

## 13. Fichiers à créer/modifier

**Backend** :
- `nodyx-core/src/migrations/077_backups.sql` (nouveau)
- `nodyx-core/src/services/backupService.ts` (nouveau)
- `nodyx-core/src/routes/admin_backups.ts` (nouveau)
- `nodyx-core/src/services/scheduler.ts` (extend)
- `nodyx-core/src/index.ts` (register route)

**Frontend** :
- `nodyx-frontend/src/routes/admin/backups/+page.svelte` (nouveau)
- `nodyx-frontend/src/routes/admin/backups/+page.server.ts` (nouveau)
- `nodyx-frontend/src/lib/components/admin/BackupCard.svelte` (nouveau)
- `nodyx-frontend/src/lib/components/admin/BackupCreateModal.svelte` (nouveau)
- `nodyx-frontend/src/lib/components/admin/BackupRestoreModal.svelte` (nouveau)
- `nodyx-frontend/src/lib/components/admin/BackupScheduleModal.svelte` (nouveau)
- `nodyx-frontend/src/lib/components/admin/BackupUploadDropzone.svelte` (nouveau)
- `nodyx-frontend/src/lib/components/ui/HelpDot.svelte` (nouveau)

**Docs** :
- `docs/admin/backup.md` (nouveau, FR)
- `docs/admin/backup.en.md` (nouveau, EN)

**Infra** :
- `docker-compose.yml` (ajouter volume backups)
- `install.sh` (créer `/var/www/nexus/backups` au setup)
- `install_tunnel.sh` (idem)

**Tests** :
- `nodyx-core/tests/backup.test.ts`

---

## 14. Risques & questions ouvertes

1. **Bande passante téléchargement** : un backup de 5 Go via une box résidentielle = 2h+. Doit-on offrir un tarball "DB only" en complément du full ? → oui, via le toggle `include_uploads` dans la modale create.

2. **Restore qui se foire en plein milieu** : que faire si pg_restore crashe à 60% ? Solution : transaction PG complète, ou backup pré-restore récupéré automatiquement. Préférence : auto-rollback via le pre-restore snapshot.

3. **Modules tiers** : si un admin a installé un module avec sa propre table (futur système de modules), comment savoir quoi backup ? → la migration system enregistre toutes les tables Nodyx, on dump tout par défaut. Modules tiers = à voir Phase 5.

4. **Concurrent backups** : empêcher 2 backups simultanés via Redis lock (`SET nodyx:backup:lock NX EX 3600`).

5. **Versioning** : si format_version 2 sort un jour, qu'arrive-t-il aux anciens backups ? → maintenir une fonction de migration de manifest, refus clean des format_version > current sinon.

---

## 15. V2 — évolutions futures (hors scope V1)

À mentionner dans la spec pour ne pas se peindre dans un coin :

- **Storage backends pluggables** : permettre S3/MinIO/B2/R2 en plus du local. Critique pour les grosses instances et le cloud-self-hosted.
- **CLI bootstrap & migration** : `nodyx-cli backup import <fichier> --bootstrap` permet d'amorcer une instance neuve depuis un backup, sans même avoir un admin connecté. Cas d'usage : migration VPS-to-VPS. Aussi : `nodyx-cli backup [create|list|restore|verify]` pour les cas où l'UI est cassée.
- **Webhooks** : URL configurable pingée à chaque event backup. Permet l'intégration Discord/Slack/n8n.
- **Restore partiel** : restaurer uniquement la DB ou uniquement les uploads, ou même un sous-ensemble (ex : "restorer uniquement les threads de la catégorie X"). Cas d'usage : récupérer une image effacée par erreur sans perdre les nouveaux messages.
- **Mode "explorer"** : monter une archive backup en read-only dans `/tmp/nodyx-backup-mount-{id}/` et permettre à l'admin de naviguer/télécharger fichier par fichier sans restorer. Idéal pour récupérer un seul asset effacé par erreur.
- **Backup incrémental** : snapshot full hebdo + incréments quotidiens. Économie d'espace énorme sur les grosses instances.
- **Restore blue/green** : restaurer dans une DB temporaire `nexus_restore_pending`, vérifier l'intégrité, puis basculer atomiquement les connexions. Réduit drastiquement le downtime sur les très grosses instances.
- **Two-person rule** : pour les instances critiques, exiger qu'un 2e admin valide le restore avant exécution.
- **Healthcheck endpoint public** : `GET /api/v1/admin/backups/health` (avec auth) pour monitoring externe (UptimeRobot, etc.).
- **Clé GPG publique** : alternative à la passphrase, pas de mémorisation requise.

---

## 16. Décision finale demandée

OK pour partir sur cette spec ?

Si oui, je commence par la Phase 1 (MVP backend + UI minimale) en branche dédiée `feat/backup-system`.

Si tu veux ajuster quelque chose : rétention par défaut (10 ?), encryption en Phase 1 ou 3 ?, support du DB-only dès le MVP ?, autres topologies ?
