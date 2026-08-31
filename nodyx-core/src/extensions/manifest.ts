// Validation du manifeste d'extension, contrat `api: 1`.
//
// Référence normative : SPECS/NODYX_SDK_REFERENCE.md §3.
// Ce module est PUR : pas de base, pas de disque, pas de réseau. Il sert au
// même endroit trois fois, et c'est voulu :
//   1. l'installation côté core,
//   2. la commande `nodyx-ext check` des développeurs,
//   3. la CI du dépôt de registre.
// Un paquet accepté ici est accepté partout, sans surprise à l'upload.
//
// Deux principes de conduite :
//   - Un manifeste inconnu est REFUSÉ, jamais nettoyé. Une faute de frappe sur
//     `permissions` ne doit pas produire une extension qui tourne avec moins de
//     droits que prévu et échoue à l'usage.
//   - Chaque refus porte un code stable en majuscules. Le message est pour
//     l'humain, le code est pour la machine.

import { z } from 'zod'
import { API_VERSION, STORAGE, APP_BUNDLE } from './limits'
import { isReservedExtensionId } from './reserved'

// ── Formes ────────────────────────────────────────────────────────────────────

export const RE_EXTENSION_ID = /^[a-z][a-z0-9-]{2,38}$/
export const RE_SURFACE_ID   = /^[a-z][a-z0-9-]{0,30}$/
export const RE_PAGE_PATH    = /^[a-z][a-z0-9-]{1,30}$/
export const RE_FIELD_KEY    = /^[a-z][a-z0-9_]{0,39}$/
export const RE_SEMVER       = /^\d+\.\d+\.\d+$/
export const RE_LOCALE       = /^[a-z]{2}(-[A-Za-z]{2})?$/
export const RE_MESSAGE_KEY  = /^@[A-Za-z0-9_][A-Za-z0-9_.-]*$/
export const RE_HOST         = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export type HostClass = 'public' | 'private' | 'forbidden' | 'invalid'

const RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Classe un hôte déclarable au manifeste. Trois niveaux, pas un interdit.
 *
 * Une instance Nodyx peut très bien vivre sur un intranet d'entreprise, sur un
 * réseau domestique, ou sur une simple adresse IP sans nom de domaine. Refuser
 * en bloc les adresses privées reviendrait à interdire les extensions qui
 * servent justement à parler aux services de cette maison. L'admin est la
 * racine de confiance de son instance : à lui de décider, en connaissance de
 * cause.
 *
 *   public     déclarable librement
 *   private    déclarable, mais exige un accord EXPLICITE de l'admin (§6.4)
 *   forbidden  jamais : ces cibles sont la machine de l'instance elle même,
 *              donc sa base, son cache, son API interne, ses identifiants de
 *              plateforme d'hébergement. Un admin n'y gagne rien de légitime.
 *   invalid    forme inacceptable
 *
 * Attention à ne pas confondre les deux couches : cette classification porte
 * sur la LISIBILITÉ de la déclaration. L'application réelle se fait à la
 * connexion, après résolution DNS et sur l'adresse obtenue, parce qu'un nom
 * public peut pointer vers une adresse privée (NODYX_SDK_SECURITY.md §4.4).
 */
export function classifyHost(host: string): HostClass {
  if (!host || host.includes(':') || host.includes('/')) return 'invalid'

  const lower = host.toLowerCase()
  const ip = RE_IPV4.exec(lower)

  if (ip) {
    const o = ip.slice(1).map(Number)
    if (o.some(n => n > 255)) return 'invalid'
    const [a, b] = o
    if (a === 127) return 'forbidden'                        // boucle locale
    if (a === 169 && b === 254) return 'forbidden'           // lien local, métadonnées d'hébergeur
    if (a === 0 || a >= 224) return 'forbidden'              // réservé, multicast, diffusion
    if (a === 10) return 'private'
    if (a === 172 && b >= 16 && b <= 31) return 'private'
    if (a === 192 && b === 168) return 'private'
    if (a === 100 && b >= 64 && b <= 127) return 'private'   // partage d'adresse opérateur
    return 'public'
  }

  if (!RE_HOST.test(lower) && lower !== 'localhost') return 'invalid'
  if (lower === 'localhost' || lower.endsWith('.localhost')) return 'forbidden'
  if (/\.(local|internal|lan|intranet)$/.test(lower) || lower.endsWith('.home.arpa')) return 'private'
  return 'public'
}
export const RE_RATE         = /^\d+\/(s|min|h)$/
export const RE_SIZE         = /^\d+(kb|mb)$/

export const FIELD_TYPES = ['text', 'textarea', 'url', 'number', 'boolean', 'select', 'color', 'image'] as const
export const IDENTITY_FIELDS = ['id', 'username', 'avatar', 'locale'] as const
export const CORE_SCOPES = ['members:read', 'forum:read', 'instance:read'] as const
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** Un chemin de paquet sûr : relatif, sans remontée, sans antislash. */
export function isSafePackagePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false
  if (/(^|\/)\.\.(\/|$)/.test(p)) return false
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(p)
}

/** "512kb" | "8mb" -> octets. Rend null si la forme est invalide. */
export function parseSize(raw: string): number | null {
  const m = RE_SIZE.exec(raw)
  if (!m) return null
  const n = parseInt(raw, 10)
  return raw.endsWith('mb') ? n * 1024 * 1024 : n * 1024
}

/**
 * URL de récupération d'un bundle applicatif (`app.url`).
 *
 * Le bundle est téléchargé UNE seule fois à l'installation, vérifié par
 * empreinte, puis servi par l'instance elle-même : `app.url` ne sert jamais au
 * runtime. On exige quand même https + hôte public (jamais la machine de
 * l'instance). En dev, `http://localhost` / `http://127.0.0.1` sont tolérés.
 */
export function isAppBundleUrl(u: string): boolean {
  let url: URL
  try { url = new URL(u) } catch { return false }
  if (url.protocol === 'http:' && process.env.NODE_ENV !== 'production'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return true
  }
  return url.protocol === 'https:' && classifyHost(url.hostname) === 'public'
}

// ── Schéma ────────────────────────────────────────────────────────────────────

const messageKey = z.string().regex(RE_MESSAGE_KEY, 'doit être une clé de traduction commençant par @')
const entryPath  = z.string().refine(p => isSafePackagePath(p) && p.endsWith('.js'), 'chemin de paquet invalide, ou ne finit pas par .js')

const fieldOption = z.object({
  value: z.string().min(1),
  label: messageKey,
}).strict()

const fieldSchema = z.object({
  key:         z.string().regex(RE_FIELD_KEY),
  type:        z.enum(FIELD_TYPES),
  label:       messageKey,
  hint:        messageKey.optional(),
  details:     messageKey.optional(),
  placeholder: z.string().optional(),
  required:    z.boolean().optional(),
  default:     z.unknown().optional(),
  options:     z.array(fieldOption).min(1).optional(),
  min:         z.number().optional(),
  max:         z.number().optional(),
}).strict().superRefine((f, ctx) => {
  if (f.type === 'select' && !f.options) {
    ctx.addIssue({ code: 'custom', message: 'un champ select exige `options`', params: { nodyx: 'SELECT_WITHOUT_OPTIONS' } })
  }
  if (f.type !== 'select' && f.options) {
    ctx.addIssue({ code: 'custom', message: '`options` n\'a de sens que sur un champ select', params: { nodyx: 'OPTIONS_ON_NON_SELECT' } })
  }
})

const navSchema = z.object({
  label:    messageKey,
  icon:     z.string().min(1).optional(),
  position: z.enum(['main', 'community']).optional(),
}).strict()

const widgetSurface = z.object({
  type:           z.literal('widget'),
  id:             z.string().regex(RE_SURFACE_ID),
  entry:          entryPath,
  label:          messageKey,
  description:    messageKey.optional(),
  schema:         z.array(fieldSchema).optional(),
  default_height: z.number().int().positive().max(2000).optional(),
}).strict()

const pageSurface = z.object({
  type:        z.literal('page'),
  path:        z.string().regex(RE_PAGE_PATH),
  entry:       entryPath,
  label:       messageKey.optional(),
  description: messageKey.optional(),
  nav:         navSchema.optional(),
}).strict()

// Une activité (cf SPECS/NODYX_ACTIVITIES_CDC.md) : une app interactive qui
// tourne dans un canal vocal. Le build (ex. wasm Godot 54 Mo) ne rentre pas
// dans un `.nyx` : il vit dans un bundle applicatif (champ `app` du manifeste),
// que l'instance télécharge une fois et sert elle-même. `entry` est le chemin
// du document HTML DANS ce bundle.
const appEntryPath = z.string().refine(
  p => isSafePackagePath(p) && /\.html?$/i.test(p),
  'doit être un chemin de bundle sûr se terminant par .html',
)

const activitySurface = z.object({
  type:           z.literal('activity'),
  id:             z.string().regex(RE_SURFACE_ID),
  entry:          appEntryPath,
  label:          messageKey,
  description:    messageKey.optional(),
  default_aspect: z.enum(['16:9', '4:3', 'fill']).optional(),
}).strict()

const surface = z.discriminatedUnion('type', [widgetSurface, pageSurface, activitySurface])

// Le bundle applicatif : récupéré UNE fois à l'installation (ou téléversé),
// empreinte vérifiée, décompressé dans uploads/extensions/<id>/<version>/app/.
const appBundle = z.object({
  url:    z.string().url().refine(isAppBundleUrl, 'doit être https vers un hôte public (http://localhost en dev)'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'empreinte sha256 hexadécimale (64 caractères)'),
  bytes:  z.number().int().positive().max(APP_BUNDLE.maxBytes),
}).strict()

const networkRule = z.object({
  methods: z.array(z.enum(HTTP_METHODS)).min(1),
  paths:   z.array(z.string().startsWith('/')).min(1),
  // Un service d'intranet vit rarement sur 443. Le port se DECLARE, donc il
  // reste visible sur l'ecran de permissions : declarer un hote n'ouvre pas
  // toutes ses portes, mais on ne rend pas l'intranet indeclarable.
  port:    z.number().int().min(1).max(65535).optional(),
  secret:  z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
  rate:    z.string().regex(RE_RATE).optional(),
}).strict()

const storagePermission = z.object({
  user:           z.string().regex(RE_SIZE).optional(),
  instance:       z.string().regex(RE_SIZE).optional(),
  // L'écriture partagée est une capacité distincte de la lecture partagée, et
  // ne s'obtient jamais par défaut (cf NODYX_SDK_SECURITY.md §4.5).
  instance_write: z.boolean().optional(),
}).strict()

const permissions = z.object({
  identity: z.array(z.enum(IDENTITY_FIELDS)).min(1).optional(),
  storage:  storagePermission.optional(),
  core:     z.array(z.enum(CORE_SCOPES)).min(1).optional(),
  network:  z.record(z.string(), networkRule).optional(),
  // Échange de données temps-réel avec les autres membres du canal vocal
  // (activités seulement). Capacité sensible : cf NODYX_ACTIVITIES_CDC.md §4.
  realtime: z.boolean().optional(),
}).strict()

const manifestSchema = z.object({
  api:            z.literal(API_VERSION),
  id:             z.string().regex(RE_EXTENSION_ID),
  version:        z.string().regex(RE_SEMVER),
  nodyx_min:      z.string().regex(RE_SEMVER).optional(),
  license:        z.string().min(1),
  author:         z.object({ name: z.string().min(1), url: z.string().url().optional() }).strict().optional(),
  source:         z.string().url().optional(),
  default_locale: z.string().regex(RE_LOCALE),
  label:          messageKey,
  description:    messageKey,
  /** Accroche courte pour la galerie (une phrase). `description` reste le texte long. */
  tagline:        messageKey.optional(),
  icon:           z.string().refine(isSafePackagePath, 'chemin de paquet invalide').optional(),
  /** Captures d'écran empaquetées dans le `.nyx`, servies par la route assets. Pour la vitrine. */
  screenshots:    z.array(z.string().refine(isSafePackagePath, 'chemin de paquet invalide')).max(6).optional(),
  family:         z.enum(['media', 'gaming', 'community', 'esport', 'social', 'content']).optional(),
  surfaces:       z.array(surface).min(1),
  app:            appBundle.optional(),
  permissions:    permissions.optional(),
}).strict()

export type ExtensionManifest = z.infer<typeof manifestSchema>

// ── Résultat ──────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  code:    string
  path:    string
  message: string
}

export type ValidationResult =
  | {
      ok: true
      manifest: ExtensionManifest
      messageKeys: string[]
      /**
       * Hôtes déclarés qui visent un réseau privé. Le manifeste est valide,
       * mais ces cibles exigent un accord EXPLICITE et distinct de l'admin à
       * l'installation : l'écran de permissions doit les montrer à part, pas
       * les noyer dans la liste des appels sortants ordinaires.
       */
      privateNetworkHosts: string[]
    }
  | { ok: false; issues: ValidationIssue[] }

/** Toutes les clés de traduction référencées par le manifeste, sans le @. */
export function collectMessageKeys(m: ExtensionManifest): string[] {
  const keys = new Set<string>()
  const add = (v?: string) => { if (v) keys.add(v.slice(1)) }
  add(m.label); add(m.description); add(m.tagline)
  for (const s of m.surfaces) {
    add(s.label); add(s.description)
    if (s.type === 'page') { add(s.nav?.label) }
    if (s.type === 'widget') {
      for (const f of s.schema ?? []) {
        add(f.label); add(f.hint); add(f.details)
        for (const o of f.options ?? []) add(o.label)
      }
    }
  }
  return [...keys].sort()
}

// ── Contrôles à message dédié ─────────────────────────────────────────────────
//
// Ces cas passeraient dans le filet générique de zod, mais avec un message
// illisible pour un auteur d'extension. Ils méritent leur propre code, parce
// que ce sont les erreurs que les gens font vraiment.

function preflight(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return [{ code: 'MANIFEST_NOT_AN_OBJECT', path: '', message: 'le manifeste doit être un objet JSON' }]
  }
  const o = raw as Record<string, unknown>

  if (o.api === undefined) {
    issues.push({
      code: 'API_VERSION_MISSING', path: 'api',
      message: `manifeste sans champ "api". Le format antérieur (Web Component, customElements.define) n'est pas supporté : voir le guide de migration, SPECS/NODYX_SDK_REFERENCE.md §16`,
    })
  } else if (o.api !== API_VERSION) {
    issues.push({
      code: 'API_VERSION_UNSUPPORTED', path: 'api',
      message: `cette instance implémente api ${API_VERSION}, le manifeste demande ${JSON.stringify(o.api)}`,
    })
  }

  if (typeof o.id === 'string' && isReservedExtensionId(o.id)) {
    issues.push({
      code: 'RESERVED_ID', path: 'id',
      message: `"${o.id}" appartient au domaine réservé aux composants livrés avec Nodyx`,
    })
  }

  // `checkbox` était toléré par l'ancien catalogue, le SDK v1 impose `boolean`.
  for (const [si, s] of (Array.isArray(o.surfaces) ? o.surfaces : []).entries()) {
    const sch = (s as Record<string, unknown>)?.schema
    for (const [fi, f] of (Array.isArray(sch) ? sch : []).entries()) {
      if ((f as Record<string, unknown>)?.type === 'checkbox') {
        issues.push({
          code: 'FIELD_TYPE_CHECKBOX', path: `surfaces[${si}].schema[${fi}].type`,
          message: 'le type "checkbox" n\'existe pas dans le SDK v1, utiliser "boolean"',
        })
      }
    }
  }

  // Un hôte réseau nu ne dit rien à l'admin : on exige méthodes et chemins.
  const net = (o.permissions as Record<string, unknown> | undefined)?.network
  if (net && typeof net === 'object' && !Array.isArray(net)) {
    for (const [host, rule] of Object.entries(net as Record<string, unknown>)) {
      if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
        issues.push({
          code: 'NETWORK_HOST_WITHOUT_RULE', path: `permissions.network.${host}`,
          message: 'un hôte réseau doit déclarer ses méthodes et ses préfixes de chemin, sinon l\'écran de permissions est illisible',
        })
      }
      const klass = classifyHost(host)
      if (klass === 'invalid') {
        issues.push({
          code: 'NETWORK_HOST_INVALID', path: `permissions.network.${host}`,
          message: 'hôte invalide : nom de domaine ou adresse IPv4 attendu, sans schéma, sans port, sans chemin',
        })
      } else if (klass === 'forbidden') {
        issues.push({
          code: 'NETWORK_HOST_FORBIDDEN', path: `permissions.network.${host}`,
          message: 'cette cible est la machine de l\'instance elle même (boucle locale, lien local, métadonnées d\'hébergeur) : elle n\'est jamais déclarable',
        })
      }
    }
  }

  return issues
}

function postflight(m: ExtensionManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const widgetIds   = new Set<string>()
  const pagePaths   = new Set<string>()
  const activityIds = new Set<string>()
  let hasActivity   = false
  for (const [i, s] of m.surfaces.entries()) {
    if (s.type === 'widget') {
      if (widgetIds.has(s.id)) {
        issues.push({ code: 'DUPLICATE_SURFACE_ID', path: `surfaces[${i}].id`, message: `deux surfaces widget portent l'identifiant "${s.id}"` })
      }
      widgetIds.add(s.id)
      const keys = new Set<string>()
      for (const [j, f] of (s.schema ?? []).entries()) {
        if (keys.has(f.key)) {
          issues.push({ code: 'DUPLICATE_FIELD_KEY', path: `surfaces[${i}].schema[${j}].key`, message: `la clé de configuration "${f.key}" est déclarée deux fois` })
        }
        keys.add(f.key)
      }
    } else if (s.type === 'activity') {
      hasActivity = true
      if (activityIds.has(s.id)) {
        issues.push({ code: 'DUPLICATE_SURFACE_ID', path: `surfaces[${i}].id`, message: `deux surfaces activity portent l'identifiant "${s.id}"` })
      }
      activityIds.add(s.id)
    } else {
      if (pagePaths.has(s.path)) {
        issues.push({ code: 'DUPLICATE_PAGE_PATH', path: `surfaces[${i}].path`, message: `deux surfaces page portent le chemin "${s.path}"` })
      }
      pagePaths.add(s.path)
    }
  }

  if (m.permissions?.realtime && !hasActivity) {
    issues.push({
      code: 'REALTIME_WITHOUT_ACTIVITY', path: 'permissions.realtime',
      message: 'la capacité `realtime` n\'a de sens que pour une surface `activity`',
    })
  }
  if (hasActivity && !m.app) {
    issues.push({
      code: 'ACTIVITY_WITHOUT_APP', path: 'app',
      message: 'une surface `activity` exige un champ `app` (le bundle applicatif à héberger)',
    })
  }
  if (m.app && !hasActivity) {
    issues.push({
      code: 'APP_WITHOUT_ACTIVITY', path: 'app',
      message: 'le champ `app` n\'a de sens qu\'avec une surface `activity`',
    })
  }

  const st = m.permissions?.storage
  if (st) {
    for (const scope of ['user', 'instance'] as const) {
      const raw = st[scope]
      if (!raw) continue
      const bytes = parseSize(raw)
      if (bytes === null || bytes > STORAGE.maxQuotaBytes) {
        issues.push({
          code: 'STORAGE_QUOTA_TOO_LARGE', path: `permissions.storage.${scope}`,
          message: `quota au dessus du plafond de l'instance (${STORAGE.maxQuotaBytes / 1024 / 1024} Mo)`,
        })
      }
    }
    if (st.instance_write && !st.instance) {
      issues.push({
        code: 'STORAGE_WRITE_WITHOUT_SCOPE', path: 'permissions.storage.instance_write',
        message: 'l\'écriture partagée exige de déclarer aussi un quota `instance`',
      })
    }
  }

  for (const [host, rule] of Object.entries(m.permissions?.network ?? {})) {
    if (rule.secret && !rule.methods.length) {
      issues.push({ code: 'SECRET_WITHOUT_METHOD', path: `permissions.network.${host}.secret`, message: 'un secret exige au moins une méthode déclarée' })
    }
  }

  return issues
}

const ZOD_CODE_MAP: Record<string, string> = {
  unrecognized_keys: 'UNKNOWN_FIELD',
  invalid_type:      'INVALID_TYPE',
  invalid_format:    'INVALID_FORMAT',
  too_small:         'TOO_SMALL',
  too_big:           'TOO_BIG',
  invalid_value:     'INVALID_VALUE',
  invalid_union:     'INVALID_SURFACE',
}

/**
 * Valide un manifeste déjà parsé en JSON.
 * Ne touche ni au disque ni à la base : le contenu des bundles de traduction
 * est vérifié à l'étape paquet, avec `messageKeys` comme entrée.
 */
export function validateManifest(raw: unknown): ValidationResult {
  const early = preflight(raw)
  const parsed = manifestSchema.safeParse(raw)

  if (!parsed.success) {
    const fromZod = parsed.error.issues.map((i): ValidationIssue => {
      const custom = (i as { params?: { nodyx?: string } }).params?.nodyx
      return {
        code:    custom ?? ZOD_CODE_MAP[i.code] ?? 'INVALID_MANIFEST',
        path:    i.path.join('.'),
        message: i.message,
      }
    })
    // Les contrôles dédiés d'abord : ce sont eux qui expliquent vraiment.
    const seen = new Set(early.map(e => e.code + '|' + e.path))
    return { ok: false, issues: [...early, ...fromZod.filter(i => !seen.has(i.code + '|' + i.path))] }
  }

  const late = [...early, ...postflight(parsed.data)]
  if (late.length) return { ok: false, issues: late }

  const privateNetworkHosts = Object.keys(parsed.data.permissions?.network ?? {})
    .filter(h => classifyHost(h) === 'private')
    .sort()

  return {
    ok: true,
    manifest: parsed.data,
    messageKeys: collectMessageKeys(parsed.data),
    privateNetworkHosts,
  }
}
