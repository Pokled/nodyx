-- OctoGuard 2, cran « Retenir » (CDC E4h, lot 2, D17).
-- Un contenu retenu n'est PAS écrit dans channel_messages / posts / threads :
-- il attend ici, invisible de tous sauf de son auteur et de l'équipe, et n'est
-- publié pour de vrai qu'à l'approbation. Aucune lecture existante (historique,
-- recherche, mentions, aperçus) n'a donc besoin d'être filtrée.

ALTER TABLE octoguard_automod_rules DROP CONSTRAINT IF EXISTS octoguard_automod_rules_action_check;
ALTER TABLE octoguard_automod_rules ADD CONSTRAINT octoguard_automod_rules_action_check
  CHECK (action IN ('delete','warn','mute','ban_temp','notify_only','report_only','hold'));

CREATE TABLE IF NOT EXISTS octoguard_held (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- chat : un message ; post : une réponse ; thread : un nouveau fil ; post_edit : une modification
  kind         VARCHAR(16) NOT NULL CHECK (kind IN ('chat','post','thread','post_edit')),
  author_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   UUID REFERENCES channels(id) ON DELETE CASCADE,
  thread_id    UUID REFERENCES threads(id) ON DELETE CASCADE,
  post_id      UUID REFERENCES posts(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES categories(id) ON DELETE CASCADE,
  -- Ce qu'il faut publier à l'approbation (contenu déjà nettoyé, titre, étiquettes, réponse à…)
  payload      JSONB NOT NULL,
  rule_id      UUID REFERENCES octoguard_automod_rules(id) ON DELETE SET NULL,
  rule_name    TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  status       VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','refused','expired')),
  decided_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  -- Identifiant du contenu publié à l'approbation (message, post ou fil)
  published_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_octoguard_held_pending ON octoguard_held (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_octoguard_held_author  ON octoguard_held (author_id, status);
