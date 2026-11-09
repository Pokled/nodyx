-- Migration 135 : le lien de vérification d'e-mail expire vraiment.
-- L'e-mail promet « valable 24 heures », mais l'échéance n'était jamais enregistrée :
-- le lien (qui ouvre une session) restait valable pour toujours.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

-- Les liens déjà envoyés reçoivent 24 h à partir de maintenant : personne en cours
-- d'inscription n'est bloqué, et le renvoi d'un lien reste possible après.
UPDATE users
   SET email_verification_expires_at = NOW() + INTERVAL '24 hours'
 WHERE email_verification_token IS NOT NULL
   AND email_verification_expires_at IS NULL;
