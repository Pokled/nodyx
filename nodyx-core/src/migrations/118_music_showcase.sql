-- ─── Vitrine musique (bandes originales composées pour des jeux vidéo) ───────
--
-- Catégories éditoriales (une ambiance = une catégorie) contenant des morceaux
-- ordonnés. Gérée par l'admin de l'instance uniquement (adminOnly), affichée
-- publiquement sur /musique. Remplace l'approche "catalogue JSON édité à la
-- main" du premier jet : upload réel via /admin/music, stocké comme les
-- autres médias de l'instance (community_assets, cf assetService.ts), même
-- pattern que streamer_audio_library (098) qui référence déjà des assets
-- 'sound' au lieu de dupliquer le stockage de fichiers.

CREATE TABLE IF NOT EXISTS music_categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  slug           VARCHAR(100) NOT NULL,
  title          VARCHAR(120) NOT NULL,
  description    TEXT,
  image_asset_id UUID REFERENCES community_assets(id) ON DELETE SET NULL,
  position       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (community_id, slug)
);

CREATE TABLE IF NOT EXISTS music_tracks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES music_categories(id) ON DELETE CASCADE,
  title          VARCHAR(150) NOT NULL,
  description    TEXT,
  audio_asset_id UUID NOT NULL REFERENCES community_assets(id) ON DELETE CASCADE,
  image_asset_id UUID REFERENCES community_assets(id) ON DELETE SET NULL,
  position       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_categories_community ON music_categories(community_id, position);
CREATE INDEX IF NOT EXISTS idx_music_tracks_category       ON music_tracks(category_id, position);
