-- Le jeu d'un événement (SPECS/NODYX_MENTIONS_CDC.md §10, D66, validée le 17/11/2026) :
-- comme les catégories de Twitch, une jaquette qui suit l'événement partout.
-- Un CATALOGUE propre à chaque communauté : l'équipe y ajoute un jeu une fois, avec
-- une jaquette téléversée ou trouvée sur Steam puis COPIÉE sur l'instance (Steam
-- n'est contacté qu'à l'ajout, jamais à l'affichage ni par les membres).
-- Ce n'est pas un jeu : une icône dessinée par Nodyx et une couleur (listes fermées).
CREATE TABLE IF NOT EXISTS event_games (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  cover_path   TEXT NOT NULL CHECK (cover_path ~ '^/uploads/games/[0-9a-f-]{36}\.webp$'),
  source       TEXT NOT NULL CHECK (source IN ('upload', 'steam')),
  steam_appid  INTEGER CHECK (steam_appid > 0),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Un nom par communauté (« Valorant » et « valorant » sont le même jeu)
CREATE UNIQUE INDEX IF NOT EXISTS event_games_name_uq ON event_games (community_id, lower(btrim(name)));

ALTER TABLE events ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES event_games(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS icon TEXT
  CHECK (icon IN ('pad', 'aim', 'sword', 'shield', 'dice', 'cards', 'trophy', 'crown', 'head', 'rocket', 'film', 'music', 'ball'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS icon_color TEXT
  CHECK (icon_color IN ('red', 'violet', 'blue', 'green', 'orange', 'grey'));
