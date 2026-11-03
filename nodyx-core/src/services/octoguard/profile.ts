/**
 * OctoGuard 2 : le profil de base et les profils partageables (CDC OctoGuard 2, E4b).
 *
 * - Le profil « Base » : 8 modèles livrés avec Nodyx, versionnés avec lui.
 * - Semis UNE fois par instance (un admin qui supprime une règle ne la voit pas
 *   revenir). D12 : sur une instance existante, rien ne dépasse « signaler »
 *   sans décision de l'admin ; un modèle « avertir » ou « supprimer » est posé
 *   en observation de ce cran.
 * - Mise à jour du profil : les règles issues d'un modèle et non personnalisées
 *   suivent ; une règle personnalisée n'est plus touchée.
 * - Export / aperçu / import d'un profil en JSON (« nodyx-octoguard-profile »).
 */

import { z } from 'zod'
import { checkRuleParams } from './params'
import { db } from '../../config/database'
import { assessPatternSafety, hasRE2 } from './matchers'
import type { AutomodAction, AutomodRuleParams, Duration, Escalation, RuleConditions, Surface } from './types'

export const BASE_PROFILE_VERSION = 1
const SEED_KEY = 'octoguard_base_profile'
/** Au-delà de ce nombre de comptes, l'instance est « existante » (D12). */
const EXISTING_INSTANCE_USERS = 5

export interface Preset {
  key:        string
  name:       { fr: string; en: string }
  type:       string
  params:     AutomodRuleParams
  action:     AutomodAction
  scopes:     Surface[]
  conditions?: RuleConditions
  escalation?: Escalation | null
  action_duration?: Duration | null
  enabled?:   boolean
}

const ALL: Surface[] = ['chat', 'forum', 'profile', 'poll', 'wiki']

export const BASE_PRESETS: Preset[] = [
  { key: 'base.link_spam', name: { fr: 'Spam de liens', en: 'Link spam' }, type: 'link_spam',
    params: { max_links: 3 }, action: 'report_only', scopes: ['chat', 'forum'] },
  { key: 'base.invites', name: { fr: 'Invitations vers d’autres serveurs', en: 'Invites to other servers' }, type: 'link_domain',
    params: { mode: 'blacklist', domains: ['discord.gg', 'discord.com/invite', 'discordapp.com/invite', 't.me', 'chat.whatsapp.com'] },
    action: 'report_only', scopes: ['chat', 'forum', 'profile'] },
  { key: 'base.mention_spam', name: { fr: 'Mentions en masse', en: 'Mass mentions' }, type: 'mention_spam',
    params: { max_mentions: 5 }, action: 'warn', scopes: ['chat', 'forum'],
    escalation: { warns_threshold: 3, window_days: 7, action: 'mute', duration: { value: 1, unit: 'h' } } },
  { key: 'base.flood', name: { fr: 'Inondation', en: 'Flooding' }, type: 'flood',
    params: { max_repeats: 4, repeat_window_s: 60, max_messages: 8, burst_window_s: 10 }, action: 'warn', scopes: ['chat'],
    escalation: { warns_threshold: 3, window_days: 1, action: 'mute', duration: { value: 10, unit: 'm' } } },
  { key: 'base.caps', name: { fr: 'Majuscules', en: 'All caps' }, type: 'caps',
    params: { min_length: 15, threshold_percent: 70 }, action: 'report_only', scopes: ['chat', 'forum'] },
  { key: 'base.new_account_links', name: { fr: 'Liens des comptes tout neufs', en: 'Links from brand-new accounts' }, type: 'link_spam',
    params: { max_links: 0 }, conditions: { account_max_age_days: 2 }, action: 'report_only', scopes: ['chat', 'forum', 'profile'] },
  { key: 'base.zalgo', name: { fr: 'Texte corrompu', en: 'Corrupted text' }, type: 'zalgo',
    params: { max_combining: 3 }, action: 'report_only', scopes: ALL },
  { key: 'base.bad_words', name: { fr: 'Mots interdits', en: 'Banned words' }, type: 'keywords',
    params: { words: [], exceptions: [] }, action: 'delete', scopes: ALL, enabled: false },
]

/** Crans « doux » de départ du profil de base (D12 sur les instances existantes). */
const OBSERVED_BY_DEFAULT = new Set(['base.invites', 'base.caps', 'base.new_account_links'])

function lang(): 'fr' | 'en' {
  return (process.env.NODYX_COMMUNITY_LANGUAGE ?? 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

/** Cran de départ d'un modèle : action + observation (dry_run). */
export function startingLevel(p: Preset, existingInstance: boolean): { action: AutomodAction; dry_run: boolean } {
  if (OBSERVED_BY_DEFAULT.has(p.key)) return { action: p.action, dry_run: true }
  const strong = p.action !== 'report_only' && p.action !== 'notify_only'
  // D12 : jamais plus que « signaler » sans décision ; on observe le cran visé
  if (existingInstance && strong) return { action: p.action, dry_run: true }
  return { action: p.action, dry_run: false }
}

async function insertPreset(p: Preset, existingInstance: boolean): Promise<boolean> {
  const lvl = startingLevel(p, existingInstance)
  const { rowCount } = await db.query(
    `INSERT INTO octoguard_automod_rules
       (name, type, params, action, action_duration, escalation, immunized_role_types,
        dry_run, enabled, scopes, conditions, preset_key, customized)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, ARRAY['owner','admin','moderator'],
             $7, $8, $9::text[], $10::jsonb, $11, false)
     ON CONFLICT (preset_key) WHERE preset_key IS NOT NULL DO NOTHING`,
    [p.name[lang()], p.type, JSON.stringify(p.params), lvl.action, JSON.stringify(p.action_duration ?? null),
     JSON.stringify(p.escalation ?? null), lvl.dry_run, p.enabled ?? true, p.scopes, JSON.stringify(p.conditions ?? {}), p.key]
  )
  return (rowCount ?? 0) > 0
}

async function readSeed(): Promise<number | null> {
  const { rows } = await db.query<{ value: string | null }>(`SELECT value FROM instance_settings WHERE key = $1`, [SEED_KEY])
  return rows[0]?.value ? Number(rows[0].value) : null
}
async function writeSeed(version: number): Promise<void> {
  await db.query(
    `INSERT INTO instance_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [SEED_KEY, String(version)])
}

/**
 * Au démarrage : sème le profil de base une fois, puis le met à jour quand
 * sa version change. Ne lève jamais.
 */
export async function ensureBaseProfile(): Promise<{ seeded: number; updated: number }> {
  try {
    const seeded = await readSeed()
    if (seeded === null) {
      const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE is_system = false`)
      const existing = (rows[0]?.n ?? 0) > EXISTING_INSTANCE_USERS
      let n = 0
      for (const p of BASE_PRESETS) if (await insertPreset(p, existing)) n++
      await writeSeed(BASE_PROFILE_VERSION)
      return { seeded: n, updated: 0 }
    }
    if (seeded < BASE_PROFILE_VERSION) {
      let n = 0
      for (const p of BASE_PRESETS) {
        // Le fond suit le profil ; le cran, l'interrupteur et les immunités restent à l'admin
        const { rowCount } = await db.query(
          `UPDATE octoguard_automod_rules
              SET type = $2, params = $3::jsonb, scopes = $4::text[], conditions = $5::jsonb,
                  escalation = $6::jsonb, updated_at = NOW()
            WHERE preset_key = $1 AND customized = false`,
          [p.key, p.type, JSON.stringify(p.params), p.scopes, JSON.stringify(p.conditions ?? {}), JSON.stringify(p.escalation ?? null)]
        )
        n += rowCount ?? 0
      }
      await writeSeed(BASE_PROFILE_VERSION)
      return { seeded: 0, updated: n }
    }
    return { seeded: 0, updated: 0 }
  } catch (err) {
    console.warn('[octoguard:profile] ensureBaseProfile failed (non-fatal):', err)
    return { seeded: 0, updated: 0 }
  }
}

// ─── Export / aperçu / import ────────────────────────────────────────────────

const SurfaceZ = z.enum(['chat', 'forum', 'profile', 'poll', 'wiki'])
const DurationZ = z.object({ value: z.number().int().positive().max(10_000), unit: z.enum(['m', 'h', 'd', 'w', 'M']) }).nullable()
const ActionZ = z.enum(['delete', 'warn', 'mute', 'ban_temp', 'notify_only', 'report_only'])

export const ProfileRuleZ = z.object({
  name:            z.string().min(1).max(100),
  type:            z.enum(['regex', 'caps', 'link_domain', 'mention_spam', 'link_spam', 'keywords', 'flood', 'zalgo']),
  params:          z.record(z.string(), z.unknown()),
  action:          ActionZ,
  action_duration: DurationZ.optional(),
  escalation:      z.object({
    warns_threshold: z.number().int().min(1).max(100),
    window_days:     z.number().int().min(1).max(365),
    action:          ActionZ,
    duration:        DurationZ.optional(),
  }).nullable().optional(),
  scopes:          z.array(SurfaceZ).min(1).max(5),
  conditions:      z.object({ account_max_age_days: z.number().int().min(1).max(365).optional() }).optional(),
  immunized_role_types: z.array(z.enum(['owner', 'admin', 'moderator', 'member'])).optional(),
  dry_run:         z.boolean().optional(),
  enabled:         z.boolean().optional(),
  preset_key:      z.string().max(100).nullable().optional(),
})

export const ProfileZ = z.object({
  format:   z.literal('nodyx-octoguard-profile'),
  version:  z.literal(1),
  name:     z.string().min(1).max(100),
  exported_at: z.string().optional(),
  rules:    z.array(ProfileRuleZ).max(200),
})
export type Profile = z.infer<typeof ProfileZ>

export async function exportProfile(name: string): Promise<Profile> {
  const { rows } = await db.query(
    `SELECT name, type, params, action, action_duration, escalation, scopes, conditions,
            immunized_role_types, dry_run, enabled, preset_key
     FROM octoguard_automod_rules ORDER BY created_at ASC`)
  return {
    format: 'nodyx-octoguard-profile', version: 1, name, exported_at: new Date().toISOString(),
    // Les grades sont propres à chaque instance : jamais exportés
    rules: rows.map((r: any) => ({
      name: r.name, type: r.type, params: r.params ?? {}, action: r.action,
      action_duration: r.action_duration ?? null, escalation: r.escalation ?? null,
      scopes: r.scopes?.length ? r.scopes : ['chat'], conditions: r.conditions ?? {},
      immunized_role_types: r.immunized_role_types ?? [], dry_run: !!r.dry_run, enabled: !!r.enabled,
      preset_key: r.preset_key ?? null,
    })),
  }
}

export interface ImportPreview {
  add:       string[]
  update:    string[]
  unchanged: string[]
  problems:  Array<{ rule: string; reason: string }>
}

// Comparaison insensible à l'ordre des clés : PostgreSQL range lui-même les
// clés d'un jsonb, un profil exporté puis réimporté tel quel doit être
// « inchangé » (avant : « modifié » dès qu'une règle avait une escalade).
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])]))
  }
  return v
}
const comparable = (r: any) => JSON.stringify(canonical([r.type, r.params ?? {}, r.action, r.scopes ?? ['chat'], r.conditions ?? {}, r.escalation ?? null, !!r.dry_run, r.enabled !== false]))

/** Ce que l'import changerait, et ce qui l'empêche. Aucun effet de bord. */
export async function previewImport(profile: Profile): Promise<ImportPreview> {
  const { rows } = await db.query(`SELECT name, type, params, action, scopes, conditions, escalation, dry_run, enabled, preset_key FROM octoguard_automod_rules`)
  const out: ImportPreview = { add: [], update: [], unchanged: [], problems: [] }
  for (const r of profile.rules) {
    if (checkRuleParams(r.type, r.params)) { out.problems.push({ rule: r.name, reason: 'invalid_params' }); continue }
    if (r.type === 'regex') {
      const pattern = (r.params as { pattern?: unknown }).pattern
      if (typeof pattern !== 'string') { out.problems.push({ rule: r.name, reason: 'regex_missing_pattern' }); continue }
      const assess = assessPatternSafety(pattern, String((r.params as { flags?: unknown }).flags ?? 'i'))
      if (!assess.valid) { out.problems.push({ rule: r.name, reason: 'regex_unsafe' }); continue }
      if (!hasRE2() && r.enabled !== false) { out.problems.push({ rule: r.name, reason: 're2_required' }); continue }
    }
    const current = rows.find((x: any) => (r.preset_key && x.preset_key === r.preset_key) || (!r.preset_key && !x.preset_key && x.name === r.name))
    if (!current) out.add.push(r.name)
    else if (comparable(current) === comparable(r)) out.unchanged.push(r.name)
    else out.update.push(r.name)
  }
  return out
}

/** Applique un profil (fusion : ajoute et met à jour, ne supprime rien). */
export async function applyImport(profile: Profile): Promise<ImportPreview> {
  const preview = await previewImport(profile)
  const blocked = new Set(preview.problems.map(p => p.rule))
  for (const r of profile.rules) {
    if (blocked.has(r.name)) continue
    const values = [r.name, r.type, JSON.stringify(r.params), r.action, JSON.stringify(r.action_duration ?? null),
      JSON.stringify(r.escalation ?? null), r.immunized_role_types ?? ['owner', 'admin', 'moderator'], r.dry_run ?? false,
      r.enabled ?? true, r.scopes, JSON.stringify(r.conditions ?? {}), r.preset_key ?? null]
    if (preview.update.includes(r.name)) {
      await db.query(
        `UPDATE octoguard_automod_rules
            SET type = $2, params = $3::jsonb, action = $4, action_duration = $5::jsonb, escalation = $6::jsonb,
                immunized_role_types = $7, dry_run = $8, enabled = $9, scopes = $10::text[], conditions = $11::jsonb,
                customized = ($12::text IS NOT NULL), updated_at = NOW()
          WHERE ($12::text IS NOT NULL AND preset_key = $12) OR ($12::text IS NULL AND preset_key IS NULL AND name = $1)`,
        values)
    } else if (preview.add.includes(r.name)) {
      await db.query(
        `INSERT INTO octoguard_automod_rules
           (name, type, params, action, action_duration, escalation, immunized_role_types,
            dry_run, enabled, scopes, conditions, preset_key, customized)
         VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::text[], $11::jsonb, $12, false)
         ON CONFLICT (preset_key) WHERE preset_key IS NOT NULL DO NOTHING`,
        values)
    }
  }
  return preview
}
