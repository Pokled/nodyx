-- 091_octoguard_bot_user.sql
-- Marker pour les utilisateurs système (bots techniques tels qu'OctoGuard).
-- Permet de distinguer un user humain d'un user fantôme bot dans les
-- listes, les rate-limit, la modération, etc.
--
-- Convention : is_system=true → utilisateur technique, ne peut pas se
-- connecter via /auth/login, n'apparaît pas dans les listes publiques
-- de membres. Référencé par author_id dans channel_messages quand
-- OctoGuard envoie un welcome ou une réponse de commande.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS + index conditionnel.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Index partiel : retrouver les utilisateurs système rapidement.
CREATE INDEX IF NOT EXISTS idx_users_is_system
  ON users(id) WHERE is_system = true;

COMMIT;
