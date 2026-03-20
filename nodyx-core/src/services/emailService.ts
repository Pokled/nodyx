import nodemailer from 'nodemailer'

// ── SMTP detection ────────────────────────────────────────────────────────────
// Tous les champs requis doivent être présents pour activer l'envoi email.

export function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  )
}

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST!,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',      // true = port 465 TLS
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  })
}

// ── Sanitize display strings against SMTP header injection ───────────────────
// Strip CR/LF characters that could be used to inject additional email headers.
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, '')
}

// ── Email verification ────────────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  to:          string
  username:    string
  verifyUrl:   string
}): Promise<void> {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP non configuré sur cette instance')
  }

  const { to, verifyUrl } = opts
  const username      = sanitizeHeader(opts.username)
  const communityName = sanitizeHeader(process.env.NODYX_COMMUNITY_NAME ?? 'Nodyx')
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!

  const transport = createTransport()

  await transport.sendMail({
    from:    `"${communityName}" <${from}>`,
    to,
    subject: `Confirmez votre adresse email — ${communityName}`,
    text: `Bonjour ${username},\n\nMerci de vous être inscrit sur ${communityName} !\n\nCliquez sur ce lien pour activer votre compte (valable 24 heures) :\n${verifyUrl}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez cet email.\n\n— L'équipe ${communityName}`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0b08;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0d0b08;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;width:100%;">

        <tr><td style="background:#161310;border:1px solid rgba(200,145,74,0.25);border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
          <span style="font-size:28px;font-weight:800;color:#c8914a;letter-spacing:-0.5px;">${communityName}</span>
        </td></tr>

        <tr><td style="background:#0f0d0a;border-left:1px solid rgba(200,145,74,0.15);border-right:1px solid rgba(200,145,74,0.15);padding:36px 40px;">
          <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f5f0e8;">Confirmez votre adresse email</p>
          <p style="margin:0 0 24px;font-size:14px;color:#8a8279;">Bonjour <strong style="color:#c8c4bc;">${username}</strong>,</p>
          <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#8a8279;">
            Merci de rejoindre <strong style="color:#c8c4bc;">${communityName}</strong> ! Cliquez sur le bouton ci-dessous pour activer votre compte.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding-bottom:28px;">
            <a href="${verifyUrl}"
               style="display:inline-block;background:#c8914a;color:#0d0b08;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">
              Activer mon compte
            </a>
          </td></tr></table>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(200,145,74,0.06);border:1px solid rgba(200,145,74,0.18);border-radius:8px;margin-bottom:20px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#c8914a;text-transform:uppercase;letter-spacing:0.5px;">Informations</p>
              <ul style="margin:0;padding-left:16px;font-size:13px;color:#8a8279;line-height:1.7;">
                <li>Ce lien expire dans <strong style="color:#c8c4bc;">24 heures</strong></li>
                <li>Il ne peut être utilisé <strong style="color:#c8c4bc;">qu'une seule fois</strong></li>
              </ul>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;color:#5a5550;line-height:1.6;">
            Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet email.
          </p>
        </td></tr>

        <tr><td style="background:#0a0906;border:1px solid rgba(200,145,74,0.15);border-top:none;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
          <p style="margin:0 0 8px;font-size:11px;color:#4a4540;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
          <p style="margin:0;font-size:11px;word-break:break-all;"><a href="${verifyUrl}" style="color:#c8914a;text-decoration:none;">${verifyUrl}</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

// ── Reset password email ──────────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  to:       string
  username: string
  resetUrl: string
}): Promise<void> {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP non configuré sur cette instance')
  }

  const { to, resetUrl } = opts
  const username      = sanitizeHeader(opts.username)
  const communityName = sanitizeHeader(process.env.NODYX_COMMUNITY_NAME ?? 'Nodyx')
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!

  const transport = createTransport()

  await transport.sendMail({
    from:    `"${communityName}" <${from}>`,
    to,
    subject: `Réinitialisation de votre mot de passe — ${communityName}`,
    text: `Bonjour ${username},\n\nVous avez demandé la réinitialisation de votre mot de passe sur ${communityName}.\n\nCliquez sur ce lien pour choisir un nouveau mot de passe (valable 1 heure) :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe restera inchangé.\n\nCe lien ne peut être utilisé qu'une seule fois.\n\n— L'équipe ${communityName}`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0b08;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0d0b08;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;width:100%;">

        <!-- En-tête -->
        <tr><td style="background:#161310;border:1px solid rgba(200,145,74,0.25);border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
          <span style="font-size:28px;font-weight:800;color:#c8914a;letter-spacing:-0.5px;">${communityName}</span>
        </td></tr>

        <!-- Corps -->
        <tr><td style="background:#0f0d0a;border-left:1px solid rgba(200,145,74,0.15);border-right:1px solid rgba(200,145,74,0.15);padding:36px 40px;">
          <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f5f0e8;">Réinitialisation du mot de passe</p>
          <p style="margin:0 0 24px;font-size:14px;color:#8a8279;">Bonjour <strong style="color:#c8c4bc;">${username}</strong>,</p>
          <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#8a8279;">
            Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
          </p>

          <!-- CTA -->
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding-bottom:28px;">
            <a href="${resetUrl}"
               style="display:inline-block;background:#c8914a;color:#0d0b08;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">
              Réinitialiser mon mot de passe
            </a>
          </td></tr></table>

          <!-- Avertissements sécurité -->
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(200,145,74,0.06);border:1px solid rgba(200,145,74,0.18);border-radius:8px;margin-bottom:20px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#c8914a;text-transform:uppercase;letter-spacing:0.5px;">🔒 Informations de sécurité</p>
              <ul style="margin:0;padding-left:16px;font-size:13px;color:#8a8279;line-height:1.7;">
                <li>Ce lien expire dans <strong style="color:#c8c4bc;">1 heure</strong></li>
                <li>Il ne peut être utilisé <strong style="color:#c8c4bc;">qu'une seule fois</strong></li>
                <li>Toutes vos sessions seront déconnectées après le changement</li>
              </ul>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;color:#5a5550;line-height:1.6;">
            Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe restera inchangé.
          </p>
        </td></tr>

        <!-- Pied de page -->
        <tr><td style="background:#0a0906;border:1px solid rgba(200,145,74,0.15);border-top:none;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
          <p style="margin:0 0 8px;font-size:11px;color:#4a4540;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
          <p style="margin:0;font-size:11px;word-break:break-all;"><a href="${resetUrl}" style="color:#c8914a;text-decoration:none;">${resetUrl}</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
