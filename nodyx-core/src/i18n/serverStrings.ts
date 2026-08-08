// ── i18n backend : le strict nécessaire ─────────────────────────────────────
//
// Contrairement à une erreur API (le frontend peut toujours la retraduire, ou
// afficher son propre message de repli), un email ou une notification push
// partent définitivement dans la langue choisie ici : une fois envoyés, ils ne
// sont plus rattrapables. C'est le seul texte que le core doit traduire
// lui-même — tout le reste (erreurs API, notifications in-app, logs d'audit)
// reste du texte technique ou du structuré traduit côté frontend.
//
// FR + EN seulement, comme le frontend : les autres langues de la communauté
// (de/es/it/pt/nl) retombent sur EN, cf i18n:parity:check côté nodyx-frontend.

export type ServerLocale = 'fr' | 'en'

const SUPPORTED: readonly ServerLocale[] = ['fr', 'en']

// Résout la langue effective d'un envoi serveur.
// Ordre : locale de l'utilisateur (si connue et supportée) -> langue de
// l'instance (si supportée) -> français (comportement historique, zéro
// régression pour les instances qui n'ont rien configuré).
export function resolveServerLocale(
  userLocale?: string | null,
  instanceLanguage?: string | null
): ServerLocale {
  const u = normalize(userLocale)
  if (u) return u
  const i = normalize(instanceLanguage)
  if (i) return i
  return 'fr'
}

function normalize(raw?: string | null): ServerLocale | null {
  if (!raw) return null
  const short = raw.slice(0, 2).toLowerCase() as ServerLocale
  return SUPPORTED.includes(short) ? short : null
}

interface VerifyEmailStrings {
  subject:      (community: string) => string
  textBody:     (username: string, community: string, verifyUrl: string) => string
  htmlTitle:    string
  htmlGreeting: (username: string) => string
  htmlIntro:    (community: string) => string
  htmlCta:      string
  htmlInfoLabel: string
  htmlInfoExpiry: string
  htmlInfoOnce:   string
  htmlIgnore:     string
  htmlFallback:   string
}

interface ResetEmailStrings {
  subject:        (community: string) => string
  textBody:       (username: string, community: string, resetUrl: string) => string
  htmlTitle:      string
  htmlGreeting:   (username: string) => string
  htmlIntro:      string
  htmlCta:        string
  htmlSecurityLabel: string
  htmlInfoExpiry:    string
  htmlInfoOnce:      string
  htmlInfoSessions:  string
  htmlIgnore:        string
  htmlFallback:      string
}

interface PushStrings {
  mentionTitle: (username: string) => string
}

const VERIFY_EMAIL: Record<ServerLocale, VerifyEmailStrings> = {
  fr: {
    subject:  (c) => `Confirmez votre adresse email — ${c}`,
    textBody: (u, c, url) => `Bonjour ${u},\n\nMerci de vous être inscrit sur ${c} !\n\nCliquez sur ce lien pour activer votre compte (valable 24 heures) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez cet email.\n\n— L'équipe ${c}`,
    htmlTitle:    'Confirmez votre adresse email',
    htmlGreeting: (u) => `Bonjour <strong style="color:#c8c4bc;">${u}</strong>,`,
    htmlIntro:    (c) => `Merci de rejoindre <strong style="color:#c8c4bc;">${c}</strong> ! Cliquez sur le bouton ci-dessous pour activer votre compte.`,
    htmlCta:      'Activer mon compte',
    htmlInfoLabel:  'Informations',
    htmlInfoExpiry: 'Ce lien expire dans <strong style="color:#c8c4bc;">24 heures</strong>',
    htmlInfoOnce:   'Il ne peut être utilisé <strong style="color:#c8c4bc;">qu\'une seule fois</strong>',
    htmlIgnore:     'Si vous n\'êtes pas à l\'origine de cette inscription, ignorez simplement cet email.',
    htmlFallback:   'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
  },
  en: {
    subject:  (c) => `Confirm your email address — ${c}`,
    textBody: (u, c, url) => `Hi ${u},\n\nThanks for signing up on ${c}!\n\nClick this link to activate your account (valid for 24 hours):\n${url}\n\nIf you didn't sign up for this, just ignore this email.\n\n— The ${c} team`,
    htmlTitle:    'Confirm your email address',
    htmlGreeting: (u) => `Hi <strong style="color:#c8c4bc;">${u}</strong>,`,
    htmlIntro:    (c) => `Thanks for joining <strong style="color:#c8c4bc;">${c}</strong>! Click the button below to activate your account.`,
    htmlCta:      'Activate my account',
    htmlInfoLabel:  'Details',
    htmlInfoExpiry: 'This link expires in <strong style="color:#c8c4bc;">24 hours</strong>',
    htmlInfoOnce:   'It can only be used <strong style="color:#c8c4bc;">once</strong>',
    htmlIgnore:     'If you didn\'t sign up for this, just ignore this email.',
    htmlFallback:   'If the button doesn\'t work, copy this link into your browser:',
  },
}

const RESET_EMAIL: Record<ServerLocale, ResetEmailStrings> = {
  fr: {
    subject:  (c) => `Réinitialisation de votre mot de passe — ${c}`,
    textBody: (u, c, url) => `Bonjour ${u},\n\nVous avez demandé la réinitialisation de votre mot de passe sur ${c}.\n\nCliquez sur ce lien pour choisir un nouveau mot de passe (valable 1 heure) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe restera inchangé.\n\nCe lien ne peut être utilisé qu'une seule fois.\n\n— L'équipe ${c}`,
    htmlTitle:    'Réinitialisation du mot de passe',
    htmlGreeting: (u) => `Bonjour <strong style="color:#c8c4bc;">${u}</strong>,`,
    htmlIntro:    'Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.',
    htmlCta:      'Réinitialiser mon mot de passe',
    htmlSecurityLabel: '🔒 Informations de sécurité',
    htmlInfoExpiry:    'Ce lien expire dans <strong style="color:#c8c4bc;">1 heure</strong>',
    htmlInfoOnce:      'Il ne peut être utilisé <strong style="color:#c8c4bc;">qu\'une seule fois</strong>',
    htmlInfoSessions:  'Toutes vos sessions seront déconnectées après le changement',
    htmlIgnore:        'Si vous n\'êtes pas à l\'origine de cette demande, ignorez simplement cet email — votre mot de passe restera inchangé.',
    htmlFallback:      'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
  },
  en: {
    subject:  (c) => `Reset your password — ${c}`,
    textBody: (u, c, url) => `Hi ${u},\n\nYou requested a password reset on ${c}.\n\nClick this link to choose a new password (valid for 1 hour):\n${url}\n\nIf you didn't request this, just ignore this email — your password stays unchanged.\n\nThis link can only be used once.\n\n— The ${c} team`,
    htmlTitle:    'Password reset',
    htmlGreeting: (u) => `Hi <strong style="color:#c8c4bc;">${u}</strong>,`,
    htmlIntro:    'You requested a password reset. Click the button below to choose a new one.',
    htmlCta:      'Reset my password',
    htmlSecurityLabel: '🔒 Security details',
    htmlInfoExpiry:    'This link expires in <strong style="color:#c8c4bc;">1 hour</strong>',
    htmlInfoOnce:      'It can only be used <strong style="color:#c8c4bc;">once</strong>',
    htmlInfoSessions:  'All your sessions will be signed out after the change',
    htmlIgnore:        'If you didn\'t request this, just ignore this email — your password stays unchanged.',
    htmlFallback:      'If the button doesn\'t work, copy this link into your browser:',
  },
}

const PUSH: Record<ServerLocale, PushStrings> = {
  fr: { mentionTitle: (u) => `@${u} vous a mentionné` },
  en: { mentionTitle: (u) => `@${u} mentioned you` },
}

export function verifyEmailStrings(locale: ServerLocale): VerifyEmailStrings {
  return VERIFY_EMAIL[locale]
}

export function resetEmailStrings(locale: ServerLocale): ResetEmailStrings {
  return RESET_EMAIL[locale]
}

export function pushStrings(locale: ServerLocale): PushStrings {
  return PUSH[locale]
}
