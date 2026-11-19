-- Charte des membres et messages de bienvenue (décidé par Jonathan le 19/11/2026,
-- CDC §E4j) : quand la charte est allumée, le message de bienvenue et le grade
-- automatique partent À LA SIGNATURE, plus à l'inscription. Sinon le nouveau ne peut
-- pas lire le salon où on l'accueille (la porte le bloque), son message est enterré
-- quand il arrive enfin, et un robot arrêté à la porte aurait été salué publiquement.
-- Seuls les NOUVEAUX inscrits sont mis en attente : un membre déjà là qui signe à sa
-- prochaine visite n'est pas accueilli comme un nouveau (ni rétrogradé « Nouveau »).
CREATE TABLE IF NOT EXISTS charter_welcome_pending (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
