/**
 * OctoGuard types DB + runtime.
 * Spec : docs/specs/016-Octoguard/016-OctoGuard.md v2.1.1
 *
 * Ces types correspondent strictement aux migrations 088 + 089.
 * Pas de logique ici, juste les contrats.
 */

// ─── Auto-mod rules ───────────────────────────────────────────────────────────

export type AutomodRuleType =
  | 'regex'
  | 'caps'
  | 'link_domain'
  | 'mention_spam'
  | 'link_spam'
  | 'keywords'   // liste de mots interdits, sans expression régulière (OctoGuard 2)
  | 'flood'      // même message répété, ou rafale (OctoGuard 2)
  | 'zalgo'      // texte corrompu (OctoGuard 2)

export type AutomodAction =
  | 'delete'
  | 'warn'
  | 'mute'
  | 'ban_temp'
  | 'notify_only'
  | 'report_only'
  | 'hold'         // Retenir : le contenu attend une relecture de l'équipe (lot 2, CDC E4h)

export type DurationUnit = 'm' | 'h' | 'd' | 'w' | 'M'

/**
 * Durée libre choisie par l'admin (pas d'enum strict).
 * { value: 15, unit: 'm' }  → 15 minutes
 * { value: 2,  unit: 'd' }  → 2 jours
 * null                       → permanent
 */
export interface Duration {
  value: number
  unit:  DurationUnit
}

export interface AutomodRuleParams {
  // regex
  pattern?: string
  flags?:   string
  // caps
  min_length?:        number
  threshold_percent?: number
  // link_domain
  mode?:    'whitelist' | 'blacklist'
  domains?: string[]
  // mention_spam
  max_mentions?: number
  // link_spam
  max_links?: number
  // keywords : « mot » (mot entier), « *mot* » (n'importe où), « mot* » (début)
  words?:      string[]
  exceptions?: string[]
  // flood
  max_repeats?:     number   // même message N fois…
  repeat_window_s?: number   // …en X secondes
  max_messages?:    number   // ou plus de N messages…
  burst_window_s?:  number   // …en X secondes
  // zalgo
  max_combining?:   number   // caractères combinés tolérés par lettre
}

/** Restrictions d'une règle (OctoGuard 2, migration 130). */
export interface RuleConditions {
  /** La règle ne vise que les comptes créés il y a moins de N jours. */
  account_max_age_days?: number
}

export interface Escalation {
  warns_threshold: number
  window_days:     number
  action:          AutomodAction
  duration?:       Duration | null
}

export interface AutomodRuleRow {
  id:                    string
  name:                  string
  type:                  AutomodRuleType
  params:                AutomodRuleParams
  action:                AutomodAction
  action_duration:       Duration | null
  escalation:            Escalation | null
  /** Au cran Avertir : suivre le barème au lieu de l'escalade propre (D28). */
  follow_ladder?:        boolean
  immunized_role_types:  string[]
  immunized_grade_ids:   string[]
  dry_run:               boolean
  enabled:               boolean
  /** Où la règle s'applique (migration 129). */
  scopes:                Surface[]
  /** Restrictions (migration 130) : comptes récents seulement, etc. */
  conditions?:           RuleConditions
  /** Modèle du profil de base d'où vient la règle, null si écrite à la main. */
  preset_key:            string | null
  /** Règle issue d'un modèle mais modifiée par l'admin : les mises à jour du profil ne la touchent plus. */
  customized:            boolean
  created_at:            string
  updated_at:            string
}

/** Les endroits du site que surveille OctoGuard. */
export type Surface = 'chat' | 'forum' | 'profile' | 'poll' | 'wiki'
export const SURFACES: readonly Surface[] = ['chat', 'forum', 'profile', 'poll', 'wiki']

// ─── Welcome (singleton) ──────────────────────────────────────────────────────

export interface WelcomeRow {
  id:              1
  channel_id:      string | null
  public_message:  string | null
  dm_message:      string | null
  dm_enabled:      boolean
  auto_grade_id:   string | null
  enabled:         boolean
  updated_at:      string
}

// ─── Commands custom ──────────────────────────────────────────────────────────

export interface CommandRow {
  id:               string
  command:          string
  response:         string
  cooldown_seconds: number
  allowed_channels: string[] | null
  allowed_roles:    string[] | null
  enabled:          boolean
  created_at:       string
  updated_at:       string
}

// ─── Warns ────────────────────────────────────────────────────────────────────

export interface WarnRow {
  id:         string
  user_id:    string
  rule_id:    string | null
  reason:     string | null
  cleared_at: string | null
  created_at: string
}

// ─── Chat mutes (Module 6) ────────────────────────────────────────────────────

export interface ChatMuteRow {
  id:         string
  user_id:    string
  channel_id: string | null
  reason:     string | null
  applied_by: string | null
  applied_at: string
  expires_at: string | null
}

// ─── Reports (Module 7) ───────────────────────────────────────────────────────

export type ReportTargetType = 'message' | 'user' | 'thread' | 'post' | 'dm_message'
export type ReportStatus     = 'open' | 'reviewed' | 'dismissed' | 'actioned'
export type ReportCategory   = 'spam' | 'harassment' | 'hate' | 'illegal' | 'other'

export interface ReportRow {
  id:           string
  reporter_id:  string | null
  target_type:  ReportTargetType
  target_id:    string
  reason:       string
  category:     ReportCategory | null
  status:       ReportStatus
  reviewed_by:  string | null
  reviewed_at:  string | null
  resolution:   string | null
  created_at:   string
}

export interface ReportsSettingsRow {
  id:                        1
  rate_limit_per_hour:       number
  cooldown_per_target_hours: number
  enabled:                   boolean
  updated_at:                string
}

// ─── Webhook out (singleton) ──────────────────────────────────────────────────

export interface WebhookRow {
  id:         1
  url:        string | null
  secret:     string | null
  enabled:    boolean
  updated_at: string
}

// ─── Pipeline runtime ─────────────────────────────────────────────────────────

/**
 * Résultat du pipeline OctoGuard pour un message chat.
 * blocked=true → le message est rejeté (pas de broadcast).
 * command_response → la cmd matchée a généré une réponse à diffuser.
 */
export interface PipelineResult {
  blocked:           boolean
  reason?:           string
  i18n_key?:         string
  event_id?:         string
  command_response?: string
  /** Cran « signaler » : l'appelant crée un dossier dans la file APRÈS avoir
   *  enregistré le contenu (il en connaît alors l'identifiant). D13. */
  report?:           { rule_id: string; rule_name: string; excerpt: string }
  /** Cran « retenir » : l'appelant N'ÉCRIT PAS le contenu, il le confie à
   *  holdContent() ; il ne sera publié qu'à l'approbation (CDC E4h, lot 2). */
  hold?:             { rule_id: string; rule_name: string; excerpt: string }
}

/**
 * Contexte utilisateur passé au pipeline.
 * Évite de re-fetcher role/grades à chaque message.
 */
export interface PipelineUserCtx {
  userId:    string
  role:      'owner' | 'admin' | 'moderator' | 'member' | string
  gradeIds:  string[]
  /** Âge du compte en jours (conditions « comptes récents »). Inconnu = règle ignorée. */
  accountAgeDays?: number
}

/**
 * Logger uniforme pour les actions OctoGuard.
 * Toutes les actions auto vont dans admin_audit_log existant avec
 * actor_id=null et actor_username='octoguard:auto'.
 */
export interface ActionLogEntry {
  action:       string                            // ex: 'octoguard.delete_message'
  target_type:  'message' | 'user' | 'channel' | 'thread' | 'post' | 'dm_message' | 'rule' | 'report' | 'log' | 'welcome' | 'command' | null
  target_id:    string | null
  target_label: string | null
  /** Membre de l'équipe à l'origine de l'action (sourdine posée à la main…).
   *  Absent = OctoGuard lui-même. Le journal attribue alors l'action au bon nom. */
  actor_id?:    string | null
  metadata: {
    rule_id?:    string
    rule_name?:  string
    event_id:    string
    actor:       'octoguard:auto' | string
    undoable?:   boolean
    undo_op?:    Record<string, unknown>
    would_be?:   boolean
    [k: string]: unknown
  }
}
