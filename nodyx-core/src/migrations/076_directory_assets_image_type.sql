-- Migration 076 — directory_assets: ajout du type 'image' dans la CHECK constraint
-- Fix: le scheduler pushAssetsToDirectory échouait en HTTP 500 car les assets
-- de type 'image' étaient rejetés par la contrainte valid_asset_type.

ALTER TABLE directory_assets DROP CONSTRAINT IF EXISTS valid_asset_type;
ALTER TABLE directory_assets ADD CONSTRAINT valid_asset_type
  CHECK (asset_type = ANY(ARRAY[
    'frame','banner','font','badge','sticker','theme','emoji','sound','image'
  ]));

INSERT INTO schema_migrations (version) VALUES ('076') ON CONFLICT DO NOTHING;
