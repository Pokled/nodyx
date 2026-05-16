-- 087_channel_icon_id.sql
-- Élargit icon_emoji pour accepter aussi des identifiants d'icônes
-- bibliothèque (ex: "lucide:hash", "twemoji:flag-france") en plus de
-- l'emoji brut. 64 chars = marge confortable pour les noms longs type
-- "twemoji:flag-saint-vincent-and-the-grenadines".

BEGIN;

ALTER TABLE channels
  ALTER COLUMN icon_emoji TYPE VARCHAR(64);

COMMIT;
