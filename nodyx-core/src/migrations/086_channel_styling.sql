-- 086_channel_styling.sql
-- Personnalisation visuelle des canaux par l'admin (Nodyx = liberté max)
-- Couleur du nom (hex), bold, italic, underline, emoji icon.
-- Garde-fous : format hex strict, emoji max 8 chars. Pas de contrainte
-- de contraste : c'est l'instance de l'admin, il décide.

BEGIN;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS name_color     VARCHAR(7),
  ADD COLUMN IF NOT EXISTS name_bold      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name_italic    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name_underline BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS icon_emoji     VARCHAR(8);

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channels_name_color_hex'
  ) THEN
    ALTER TABLE channels
      ADD CONSTRAINT channels_name_color_hex
      CHECK (name_color IS NULL OR name_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END
$mig$;

COMMIT;
