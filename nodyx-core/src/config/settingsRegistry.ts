// ─── Registry des settings éditables depuis l'admin (spec 017) ────────────────
// Source unique de vérité : décrit chaque variable configurable. Pilote à la
// fois la validation backend (settings.ts) ET le rendu du formulaire frontend
// (renvoyé par GET /api/v1/admin/settings).
//
// Tier :
//   1 = vital/bootstrap (reste dans .env, édition Phase 3 avec redémarrage)
//   2 = redémarrage requis (lu au module-init)
//   3 = hot-applicable (relu à chaque appel → effet immédiat via process.env)
//
// Phase 1 ne déclare que des réglages tier 3 non-secrets : identité de
// l'instance + indexing. Zéro secret, zéro redémarrage, zéro risque de brick.

export type SettingGroup = 'identity' | 'federation' | 'email' | 'integrations' | 'streamer' | 'security' | 'advanced'
export type SettingType  = 'string' | 'multiline' | 'number' | 'boolean' | 'enum' | 'secret' | 'url'
export type SettingTier  = 1 | 2 | 3

export interface SettingDescriptor {
  key:          string
  group:        SettingGroup
  type:         SettingType
  tier:         SettingTier
  secret:       boolean
  labelFr:      string
  labelEn:      string
  helpFr?:      string
  helpEn?:      string
  enumValues?:  string[]
  placeholder?: string
  // Retourne un message d'erreur (FR) si invalide, sinon null. Reçoit la valeur
  // brute (string) telle que saisie. Une valeur vide est gérée par `optional`.
  optional?:    boolean
  validate?:    (raw: string) => string | null
}

function maxLen(n: number) {
  return (raw: string): string | null =>
    raw.length > n ? `Trop long (max ${n} caractères)` : null
}

const ISO_LANGS = ['fr', 'en', 'de', 'es', 'it', 'pt', 'nl']

export const SETTINGS_REGISTRY: SettingDescriptor[] = [
  // ── Identité de la communauté ──────────────────────────────────────────────
  {
    key: 'NODYX_COMMUNITY_NAME', group: 'identity', type: 'string', tier: 3, secret: false,
    labelFr: "Nom de l'instance", labelEn: 'Instance name',
    helpFr: 'Affiché dans le titre, les balises meta, les emails.',
    helpEn: 'Shown in the title, meta tags, emails.',
    validate: (v) => v.trim().length === 0 ? 'Le nom ne peut pas être vide' : maxLen(100)(v),
  },
  {
    key: 'NODYX_COMMUNITY_DESCRIPTION', group: 'identity', type: 'multiline', tier: 3, secret: false,
    labelFr: 'Description courte', labelEn: 'Short description',
    helpFr: 'Utilisée pour le SEO, la page d’accueil, le RSS.',
    helpEn: 'Used for SEO, the homepage, the RSS feed.',
    optional: true, validate: maxLen(500),
  },
  {
    key: 'NODYX_COMMUNITY_LANGUAGE', group: 'identity', type: 'enum', tier: 3, secret: false,
    enumValues: ISO_LANGS,
    labelFr: 'Langue principale', labelEn: 'Primary language',
    helpFr: 'Recherche full-text PostgreSQL + attribut HTML lang.',
    helpEn: 'PostgreSQL full-text search + HTML lang attribute.',
    validate: (v) => ISO_LANGS.includes(v) ? null : `Langue non supportée (${ISO_LANGS.join(', ')})`,
  },
  {
    key: 'NODYX_COMMUNITY_COUNTRY', group: 'identity', type: 'string', tier: 3, secret: false,
    placeholder: 'FR',
    labelFr: 'Pays', labelEn: 'Country',
    helpFr: 'Code ISO 3166-1 alpha-2 (ex : FR), pour les balises meta geo.',
    helpEn: 'ISO 3166-1 alpha-2 code (e.g. FR), for geo meta tags.',
    optional: true,
    validate: (v) => /^[A-Za-z]{2}$/.test(v) ? null : 'Doit être un code pays à 2 lettres (ex : FR)',
  },
  {
    key: 'NODYX_MAX_MEMBERS', group: 'identity', type: 'number', tier: 3, secret: false,
    placeholder: 'illimité',
    labelFr: 'Limite de membres', labelEn: 'Member limit',
    helpFr: 'Vide = illimité. Les comptes bannis ne sont pas comptés.',
    helpEn: 'Empty = unlimited. Banned accounts are not counted.',
    optional: true,
    validate: (v) => /^\d+$/.test(v) && Number(v) > 0 ? null : 'Doit être un entier positif (ou vide)',
  },

  // ── Fédération ───────────────────────────────────────────────────────────────
  {
    key: 'NODYX_GLOBAL_INDEXING', group: 'federation', type: 'boolean', tier: 3, secret: false,
    labelFr: 'Indexation globale (nodyx.org/discover)', labelEn: 'Global indexing (nodyx.org/discover)',
    helpFr: 'Opt-in : annonce vos sujets publics dans la recherche cross-instances.',
    helpEn: 'Opt-in: announces your public topics in cross-instance search.',
    validate: (v) => v === 'true' || v === 'false' ? null : 'Doit être true ou false',
  },

  // ── Email (SMTP) ─────────────────────────────────────────────────────────────
  {
    key: 'SMTP_HOST', group: 'email', type: 'string', tier: 3, secret: false,
    placeholder: 'smtp.exemple.com', optional: true,
    labelFr: 'Serveur SMTP', labelEn: 'SMTP server',
    helpFr: 'Hôte du serveur d’envoi (Gmail, Mailgun, OVH, etc.).',
    helpEn: 'Outgoing mail server host (Gmail, Mailgun, etc.).',
    validate: maxLen(255),
  },
  {
    key: 'SMTP_PORT', group: 'email', type: 'number', tier: 3, secret: false,
    placeholder: '587', optional: true,
    labelFr: 'Port SMTP', labelEn: 'SMTP port',
    helpFr: '587 (STARTTLS) ou 465 (TLS implicite).',
    helpEn: '587 (STARTTLS) or 465 (implicit TLS).',
    validate: (v) => /^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 65535 ? null : 'Port invalide',
  },
  {
    key: 'SMTP_SECURE', group: 'email', type: 'boolean', tier: 3, secret: false,
    labelFr: 'TLS implicite (port 465)', labelEn: 'Implicit TLS (port 465)',
    helpFr: 'Activer pour le port 465. Laisser désactivé pour le 587 (STARTTLS).',
    helpEn: 'Enable for port 465. Leave off for 587 (STARTTLS).',
    validate: (v) => v === 'true' || v === 'false' ? null : 'Doit être true ou false',
  },
  {
    key: 'SMTP_USER', group: 'email', type: 'string', tier: 3, secret: false,
    placeholder: 'noreply@votre-domaine.com', optional: true,
    labelFr: 'Identifiant SMTP', labelEn: 'SMTP username',
    helpFr: 'Souvent l’adresse email du compte d’envoi.',
    helpEn: 'Usually the sending account email address.',
    validate: maxLen(255),
  },
  {
    key: 'SMTP_PASS', group: 'email', type: 'secret', tier: 3, secret: true,
    optional: true,
    labelFr: 'Mot de passe SMTP', labelEn: 'SMTP password',
    helpFr: 'Stocké chiffré. Pour Gmail, utilisez un mot de passe d’application.',
    helpEn: 'Stored encrypted. For Gmail, use an app password.',
  },
  {
    key: 'SMTP_FROM', group: 'email', type: 'string', tier: 3, secret: false,
    placeholder: 'noreply@votre-domaine.com', optional: true,
    labelFr: 'Adresse expéditeur', labelEn: 'From address',
    helpFr: 'Optionnel : reprend l’identifiant SMTP si vide.',
    helpEn: 'Optional: falls back to SMTP username if empty.',
    validate: maxLen(255),
  },

  // ── Intégrations ─────────────────────────────────────────────────────────────
  {
    key: 'TWITCH_CLIENT_ID', group: 'integrations', type: 'string', tier: 3, secret: false,
    optional: true,
    labelFr: 'Twitch Client ID', labelEn: 'Twitch Client ID',
    helpFr: 'Widget stream de la homepage. App créée sur dev.twitch.tv/console/apps.',
    helpEn: 'Homepage stream widget. App from dev.twitch.tv/console/apps.',
    validate: maxLen(128),
  },
  {
    key: 'TWITCH_CLIENT_SECRET', group: 'integrations', type: 'secret', tier: 3, secret: true,
    optional: true,
    labelFr: 'Twitch Client Secret', labelEn: 'Twitch Client Secret',
    helpFr: 'Stocké chiffré. Généré à côté du Client ID sur la console Twitch.',
    helpEn: 'Stored encrypted. Generated next to the Client ID on the Twitch console.',
  },

  // ── Streamer Hub (app Twitch dédiée, distincte du widget homepage) ────────────
  {
    key: 'STREAMER_TWITCH_CLIENT_ID', group: 'streamer', type: 'string', tier: 3, secret: false,
    optional: true,
    labelFr: 'Streamer Hub : Twitch Client ID', labelEn: 'Streamer Hub: Twitch Client ID',
    helpFr: 'App Twitch DÉDIÉE au Hub (différente du widget homepage). Créée sur dev.twitch.tv/console/apps.',
    helpEn: 'DEDICATED Twitch app for the Hub (different from the homepage widget).',
    validate: maxLen(128),
  },
  {
    key: 'STREAMER_TWITCH_CLIENT_SECRET', group: 'streamer', type: 'secret', tier: 3, secret: true,
    optional: true,
    labelFr: 'Streamer Hub : Twitch Client Secret', labelEn: 'Streamer Hub: Twitch Client Secret',
    helpFr: 'Stocké chiffré. "New Secret" dans la même app Twitch que le Client ID ci-dessus.',
    helpEn: 'Stored encrypted. "New Secret" in the same Twitch app as the Client ID above.',
  },
  {
    key: 'STREAMER_OAUTH_KEY', group: 'streamer', type: 'secret', tier: 3, secret: true,
    optional: true,
    labelFr: 'Streamer Hub : clé de chiffrement des tokens', labelEn: 'Streamer Hub: token encryption key',
    helpFr: 'Chiffre les tokens Twitch en base (AES-256-GCM). 64 caractères hexadécimaux. Utilisez "Générer". À définir AVANT de connecter Twitch : la changer ensuite invalide les tokens stockés.',
    helpEn: 'Encrypts Twitch tokens at rest (AES-256-GCM). 64 hex chars. Use "Generate". Set it BEFORE connecting Twitch.',
    validate: (v) => /^[0-9a-fA-F]{64}$/.test(v) ? null : 'Doit faire 64 caractères hexadécimaux (utilisez Générer)',
  },
  {
    key: 'STREAMER_PUBLIC_BASE', group: 'streamer', type: 'url', tier: 3, secret: false,
    optional: true, placeholder: 'https://votre-instance.nodyx.org',
    labelFr: 'Streamer Hub : base publique (HTTPS)', labelEn: 'Streamer Hub: public base (HTTPS)',
    helpFr: 'URL publique HTTPS de l’instance, pour les webhooks EventSub de Twitch.',
    helpEn: 'Public HTTPS URL of the instance, for Twitch EventSub webhooks.',
    validate: (v) => { try { return new URL(v).protocol === 'https:' ? null : 'Doit être en HTTPS' } catch { return 'URL invalide' } },
  },
  {
    key: 'STREAMER_OAUTH_REDIRECT_URI', group: 'streamer', type: 'url', tier: 3, secret: false,
    optional: true, placeholder: 'https://votre-instance.nodyx.org/api/v1/streamer/twitch/callback',
    labelFr: 'Streamer Hub : Redirect URI OAuth', labelEn: 'Streamer Hub: OAuth Redirect URI',
    helpFr: 'À reporter EXACTEMENT dans l’app Twitch (OAuth Redirect URLs). En général : base publique + /api/v1/streamer/twitch/callback',
    helpEn: 'Must match EXACTLY the Twitch app OAuth Redirect URL.',
    validate: (v) => { try { new URL(v); return null } catch { return 'URL invalide' } },
  },

  // ── Sécurité & modération ──────────────────────────────────────────────────
  // tier 3 : relu via process.env à chaque appel (isOctoGuardEnabled lit déjà
  // process.env.OCTOGUARD_ENABLED) → toggle admin à effet immédiat, zéro modif
  // du code OctoGuard, zéro redémarrage.
  {
    key: 'OCTOGUARD_ENABLED', group: 'security', type: 'boolean', tier: 3, secret: false,
    labelFr: 'Activer OctoGuard (auto-modération)', labelEn: 'Enable OctoGuard (auto-moderation)',
    helpFr: "Active le moteur d'auto-modération du chat. Sans aucune règle configurée, il n'a aucun effet. Effet immédiat, pas de redémarrage. Règles dans /admin/octoguard.",
    helpEn: 'Turns on the chat auto-moderation engine. With no rule configured it does nothing. Applies instantly, no restart. Configure rules in /admin/octoguard.',
    optional: true,
  },
]

const BY_KEY = new Map(SETTINGS_REGISTRY.map(d => [d.key, d]))

export function getDescriptor(key: string): SettingDescriptor | undefined {
  return BY_KEY.get(key)
}

export function isEditableKey(key: string): boolean {
  return BY_KEY.has(key)
}
