-- Migration 074 — community_assets: ajout du type 'image'
-- Permet l'hébergement d'images pour insertion dans les articles/threads via la médiathèque admin.
ALTER TABLE community_assets DROP CONSTRAINT valid_asset_type;
ALTER TABLE community_assets ADD CONSTRAINT valid_asset_type
  CHECK (asset_type = ANY(ARRAY[
    'frame','banner','font','badge','sticker','theme','emoji','sound','image'
  ]));
