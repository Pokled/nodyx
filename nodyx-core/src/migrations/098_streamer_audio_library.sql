-- ─── Streamer Hub — Soundboard / bibliothèque audio (Phase A) ──────────────
-- Stocke les pistes audio que le streamer veut pouvoir déclencher depuis le
-- Stream Deck ou directement depuis l'admin. Chaque entrée référence un asset
-- (système d'uploads existant, type 'sound') et y ajoute les métadonnées
-- spécifiques au soundboard : titre, artiste, durée, vignette, volume,
-- options de fade, tag.
--
-- Visibilité :
--   - 'private' : visible uniquement par le propriétaire (V1, défaut)
--   - 'public'  : V2, partagé entre admins/mods ou exposé via channel points
--
-- royalty_free : indication informative pour aider à éviter les DMCA strikes
-- Twitch. NULL = inconnu (défaut). false = piste à risque (alerte UI).
-- true = streamer a coché "c'est libre de droits".

CREATE TABLE IF NOT EXISTS streamer_audio_library (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id          UUID NOT NULL REFERENCES community_assets(id) ON DELETE CASCADE,
  visibility        TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  title             TEXT NOT NULL,
  artist            TEXT,
  album             TEXT,
  duration_ms       INTEGER,                                   -- nullable si extraction échoue
  thumbnail_url     TEXT,                                      -- vignette extraite (APIC ID3 ou upload manuel)
  volume_default    REAL NOT NULL DEFAULT 1.0 CHECK (volume_default BETWEEN 0 AND 2),
  fade_in_ms        INTEGER NOT NULL DEFAULT 0 CHECK (fade_in_ms BETWEEN 0 AND 10000),
  fade_out_ms       INTEGER NOT NULL DEFAULT 0 CHECK (fade_out_ms BETWEEN 0 AND 10000),
  loop              BOOLEAN NOT NULL DEFAULT FALSE,
  royalty_free      BOOLEAN,                                   -- NULL inconnu, false risqué, true OK
  tags              TEXT[] NOT NULL DEFAULT '{}',              -- libre, ex: {chill, electro, ambiance}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, asset_id)                              -- un asset n'apparait qu'une fois par owner
);

CREATE INDEX IF NOT EXISTS idx_streamer_audio_library_owner
  ON streamer_audio_library(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_streamer_audio_library_public
  ON streamer_audio_library(visibility, created_at DESC)
  WHERE visibility = 'public';
