-- 129 : OctoGuard 2, le moteur (CDC SPECS/NODYX_OCTOGUARD_V2_CDC.md, E4a).
--
-- scopes : où une règle s'applique. 'chat' (seul endroit surveillé jusqu'ici),
--   'forum' (fils et messages, création et modification), 'profile' (pseudo,
--   bio), 'poll' (sondages), 'wiki'. Les règles existantes gardent 'chat'.
-- preset_key : la règle vient d'un modèle du profil de base (« base.link_spam »…),
--   NULL pour une règle écrite à la main.
-- customized : l'admin a modifié une règle issue d'un modèle ; une mise à jour
--   du profil de base ne doit plus y toucher.
ALTER TABLE octoguard_automod_rules ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{chat}';
ALTER TABLE octoguard_automod_rules ADD COLUMN IF NOT EXISTS preset_key TEXT;
ALTER TABLE octoguard_automod_rules ADD COLUMN IF NOT EXISTS customized BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_octoguard_rules_preset ON octoguard_automod_rules (preset_key) WHERE preset_key IS NOT NULL;

-- Bannissements temporaires (escalade, action ban_temp) : retrouver vite ceux
-- qui arrivent à échéance pour les lever.
CREATE INDEX IF NOT EXISTS idx_community_bans_expiry ON community_bans (expires_at) WHERE expires_at IS NOT NULL;

-- D'où vient un signalement : un membre, ou OctoGuard (cran « signaler », D13).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'member' CHECK (source IN ('member', 'octoguard'));
