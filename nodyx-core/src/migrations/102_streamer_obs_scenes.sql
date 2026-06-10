-- ─── Streamer Hub — Scènes OBS pilotées depuis Nodyx ────────────────────────
-- Permet au streamer de composer ses scènes (Dev, Discussion, Chill...) dans
-- un canvas WYSIWYG Nodyx au lieu de configurer OBS directement. Une scène
-- Nodyx = un layout 1920x1080 contenant N "sources" (overlays Nodyx ou URLs
-- Browser libres) positionnées et redimensionnées.
--
-- Phase A (cette migration) : les scènes sont stockées côté Nodyx. Le streamer
-- les compose visuellement, génère les URLs d'overlay et les colle dans OBS.
-- Phase B/C plus tard : un bridge OBS WebSocket synchronisera ces scènes
-- automatiquement dans OBS (Add Browser Source, Set Transform, Switch Scene).
--
-- Format de layout (JSONB) :
--   {
--     "sources": [
--       {
--         "id":       "src_xxx",
--         "type":     "alert_box" | "ticker" | "playlist" | "soundboard_osd"
--                   | "goal_bar" | "leaderboard" | "clips_player"
--                   | "browser_source" | "placeholder_video",
--         "label":    "Alerte follow",
--         "x":        0..1920,
--         "y":        0..1080,
--         "w":        1..1920,
--         "h":        1..1080,
--         "z":        ordre de stack (0 = fond, N = devant),
--         "visible":  bool,
--         "locked":   bool,
--         "config":   {} (varie par type : overlayToken, playlistId, url, etc.)
--       }
--     ]
--   }
--
-- `placeholder_video` représente les sources vidéo OBS (webcam, capture jeu)
-- qu'on ne pilote pas en Phase A : on les laisse manipulables en position/taille
-- pour la maquette, et plus tard OBS-bridge les liera aux vraies sources.

CREATE TABLE IF NOT EXISTS streamer_obs_scenes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(80) NOT NULL,
  color         VARCHAR(7) CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  layout        JSONB NOT NULL DEFAULT '{"sources":[]}'::jsonb,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, name)
);

-- Sidebar admin : liste des scènes d'un owner, triées par position. Pas
-- d'unique sur position : un réordonnage peut temporairement créer des
-- doublons avant la mise à jour finale par lots (cf. reorderScenes service).
CREATE INDEX IF NOT EXISTS idx_streamer_obs_scenes_owner
  ON streamer_obs_scenes (owner_user_id, position ASC);
