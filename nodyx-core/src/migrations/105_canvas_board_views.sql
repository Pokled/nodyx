-- Migration 105 — NodyxCanvas : dernière visite par membre/board
-- Permet de surligner les éléments ajoutés depuis le dernier passage de l'utilisateur.
CREATE TABLE IF NOT EXISTS canvas_board_views (
  board_id     UUID NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);
