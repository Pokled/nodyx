/// Email service — mirrors nodyx-core/src/services/emailService.ts
///
/// Only active when SMTP_HOST + SMTP_USER + SMTP_PASS env vars are set.
/// Uses lettre with STARTTLS (port 587) or implicit TLS (SMTP_SECURE=true → port 465).

use lettre::{
    message::{header::ContentType, MultiPart, SinglePart},
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};

#[derive(Clone)]
pub struct EmailService {
    host:           String,
    port:           u16,
    user:           String,
    pass:           String,
    from:           String,
    community_name: String,
    use_implicit_tls: bool,
}

impl EmailService {
    /// Returns `None` when SMTP env vars are not configured.
    pub fn from_env() -> Option<Self> {
        let host = std::env::var("SMTP_HOST").ok()?;
        let user = std::env::var("SMTP_USER").ok()?;
        let pass = std::env::var("SMTP_PASS").ok()?;

        let port: u16 = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(587);

        let use_implicit_tls = std::env::var("SMTP_SECURE")
            .map(|v| v == "true")
            .unwrap_or(false);

        let community_name = std::env::var("NODYX_COMMUNITY_NAME")
            .unwrap_or_else(|_| "Nodyx".into());

        let from = std::env::var("SMTP_FROM").unwrap_or_else(|_| user.clone());

        Some(Self { host, port, user, pass, from, community_name, use_implicit_tls })
    }

    fn build_transport(&self) -> anyhow::Result<AsyncSmtpTransport<Tokio1Executor>> {
        let creds = Credentials::new(self.user.clone(), self.pass.clone());

        let transport = if self.use_implicit_tls {
            let tls_params = TlsParameters::new(self.host.clone())?;
            AsyncSmtpTransport::<Tokio1Executor>::relay(&self.host)?
                .credentials(creds)
                .tls(Tls::Wrapper(tls_params))
                .port(self.port)
                .build()
        } else {
            let tls_params = TlsParameters::new(self.host.clone())?;
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.host)?
                .credentials(creds)
                .tls(Tls::Required(tls_params))
                .port(self.port)
                .build()
        };

        Ok(transport)
    }

    pub async fn send_verification_email(
        &self,
        to: &str,
        username: &str,
        verify_url: &str,
    ) -> anyhow::Result<()> {
        let community = &self.community_name;
        let from_addr = format!("\"{}\" <{}>", community, self.from);

        let text_body = format!(
            "Bonjour {},\n\nMerci de vous être inscrit sur {} !\n\n\
             Cliquez sur ce lien pour activer votre compte (valable 24 heures) :\n{}\n\n\
             Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email.\n\n\
             — L'équipe {}",
            username, community, verify_url, community
        );

        let html_body = format!(
            r#"<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0b08;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0d0b08;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;width:100%;">
        <tr><td style="background:#161310;border:1px solid rgba(200,145,74,0.25);border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
          <span style="font-size:28px;font-weight:800;color:#c8914a;letter-spacing:-0.5px;">{community}</span>
        </td></tr>
        <tr><td style="background:#0f0d0a;border-left:1px solid rgba(200,145,74,0.15);border-right:1px solid rgba(200,145,74,0.15);padding:36px 40px;">
          <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f5f0e8;">Confirmez votre adresse email</p>
          <p style="margin:0 0 24px;font-size:14px;color:#8a8279;">Bonjour <strong style="color:#c8c4bc;">{username}</strong>,</p>
          <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#8a8279;">
            Merci de rejoindre <strong style="color:#c8c4bc;">{community}</strong> ! Cliquez sur le bouton ci-dessous pour activer votre compte.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding-bottom:28px;">
            <a href="{verify_url}" style="display:inline-block;background:#c8914a;color:#0d0b08;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">
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
          <p style="margin:0;font-size:13px;color:#5a5550;line-height:1.6;">Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet email.</p>
        </td></tr>
        <tr><td style="background:#0a0906;border:1px solid rgba(200,145,74,0.15);border-top:none;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
          <p style="margin:0 0 8px;font-size:11px;color:#4a4540;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
          <p style="margin:0;font-size:11px;word-break:break-all;"><a href="{verify_url}" style="color:#c8914a;text-decoration:none;">{verify_url}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"#,
            community = community,
            username = username,
            verify_url = verify_url,
        );

        let message = Message::builder()
            .from(from_addr.parse()?)
            .to(to.parse()?)
            .subject(format!("Confirmez votre adresse email — {}", community))
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(text_body),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html_body),
                    ),
            )?;

        let transport = self.build_transport()?;
        transport.send(message).await?;
        Ok(())
    }

    pub async fn send_password_reset_email(
        &self,
        to: &str,
        username: &str,
        reset_url: &str,
    ) -> anyhow::Result<()> {
        let community = &self.community_name;
        let from_addr = format!("\"{}\" <{}>", community, self.from);

        let text_body = format!(
            "Bonjour {},\n\nVous avez demandé la réinitialisation de votre mot de passe sur {}.\n\n\
             Cliquez sur ce lien pour choisir un nouveau mot de passe (valable 1 heure) :\n{}\n\n\
             Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe restera inchangé.\n\n\
             Ce lien ne peut être utilisé qu'une seule fois.\n\n— L'équipe {}",
            username, community, reset_url, community
        );

        let html_body = format!(
            r#"<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0b08;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0d0b08;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;width:100%;">
        <tr><td style="background:#161310;border:1px solid rgba(200,145,74,0.25);border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
          <span style="font-size:28px;font-weight:800;color:#c8914a;letter-spacing:-0.5px;">{community}</span>
        </td></tr>
        <tr><td style="background:#0f0d0a;border-left:1px solid rgba(200,145,74,0.15);border-right:1px solid rgba(200,145,74,0.15);padding:36px 40px;">
          <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f5f0e8;">Réinitialisation du mot de passe</p>
          <p style="margin:0 0 24px;font-size:14px;color:#8a8279;">Bonjour <strong style="color:#c8c4bc;">{username}</strong>,</p>
          <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#8a8279;">
            Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding-bottom:28px;">
            <a href="{reset_url}" style="display:inline-block;background:#c8914a;color:#0d0b08;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">
              Réinitialiser mon mot de passe
            </a>
          </td></tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(200,145,74,0.06);border:1px solid rgba(200,145,74,0.18);border-radius:8px;margin-bottom:20px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#c8914a;text-transform:uppercase;letter-spacing:0.5px;">Informations de securite</p>
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
        <tr><td style="background:#0a0906;border:1px solid rgba(200,145,74,0.15);border-top:none;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
          <p style="margin:0 0 8px;font-size:11px;color:#4a4540;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
          <p style="margin:0;font-size:11px;word-break:break-all;"><a href="{reset_url}" style="color:#c8914a;text-decoration:none;">{reset_url}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"#,
            community = community,
            username = username,
            reset_url = reset_url,
        );

        let message = Message::builder()
            .from(from_addr.parse()?)
            .to(to.parse()?)
            .subject(format!("Réinitialisation de votre mot de passe — {}", community))
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(text_body),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html_body),
                    ),
            )?;

        let transport = self.build_transport()?;
        transport.send(message).await?;
        Ok(())
    }
}
