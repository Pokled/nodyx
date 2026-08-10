-- Migration 111: Fond d'image personnalisable pour la sidebar membres
-- (#members-c, visible sur toutes les pages). Un seul JSONB plutôt que
-- 4 colonnes scalaires : même convention que homepage_grid.theme et que
-- le widget Header (background_image_url/offset_x/offset_y/scale).

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS sidebar_bg JSONB;

INSERT INTO schema_migrations (version) VALUES ('111') ON CONFLICT DO NOTHING;
