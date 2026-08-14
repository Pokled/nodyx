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
import { API_VERSION, STORAGE } from './limits'
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

/**
 * Un hôte déclarable : un nom de domaine, jamais une adresse IP littérale.
 *
 * Le proxy refuse déjà les adresses privées au moment de la connexion, après
 * résolution (NODYX_SDK_SECURITY.md §4.4). Mais une IP littérale n'a aucune
 * raison d'apparaître dans un manifeste : elle ne veut rien dire pour l'admin
 * qui lit l'écran de permissions, et elle ne sert qu'à viser une machine
 * précise. On la refuse à la déclaration, pas seulement à l'usage.
 */
export function isDeclarableHost(host: string): boolean {
  if (!RE_HOST.test(host)) return false
  const last = host.slice(host.lastIndexOf('.') + 1)
  return /[a-z]/.test(last)          // un TLD tout en chiffres = adresse IPv4
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

const surface = z.discriminatedUnion('type', [widgetSurface, pageSurface])

const networkRule = z.object({
  methods: z.array(z.enum(HTTP_METHODS)).min(1),
  paths:   z.array(z.string().startsWith('/')).min(1),
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
  icon:           z.string().refine(isSafePackagePath, 'chemin de paquet invalide').optional(),
  family:         z.enum(['media', 'gaming', 'community', 'esport', 'social', 'content']).optional(),
  surfaces:       z.array(surface).min(1),
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
  | { ok: true;  manifest: ExtensionManifest; messageKeys: string[] }
  | { ok: false; issues: ValidationIssue[] }

/** Toutes les clés de traduction référencées par le manifeste, sans le @. */
export function collectMessageKeys(m: ExtensionManifest): string[] {
  const keys = new Set<string>()
  const add = (v?: string) => { if (v) keys.add(v.slice(1)) }
  add(m.label); add(m.description)
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
      if (!isDeclarableHost(host)) {
        issues.push({
          code: 'NETWORK_HOST_INVALID', path: `permissions.network.${host}`,
          message: 'hôte invalide : nom de domaine attendu, sans schéma, sans port, sans chemin, et jamais une adresse IP',
        })
      }
    }
  }

  return issues
}

function postflight(m: ExtensionManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const widgetIds = new Set<string>()
  const pagePaths = new Set<string>()
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
    } else {
      if (pagePaths.has(s.path)) {
        issues.push({ code: 'DUPLICATE_PAGE_PATH', path: `surfaces[${i}].path`, message: `deux surfaces page portent le chemin "${s.path}"` })
      }
      pagePaths.add(s.path)
    }
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

  return { ok: true, manifest: parsed.data, messageKeys: collectMessageKeys(parsed.data) }
}
