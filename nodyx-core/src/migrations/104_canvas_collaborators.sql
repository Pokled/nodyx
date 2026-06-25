-- Migration 104 — NodyxCanvas Lot 2b : collaborateurs / demandes d'accès
-- Un viewer d'un board public peut demander l'accès en édition → ligne 'pending'.
-- Le proprio valide → 'active' (role 'editor' = droit d'écriture).
CREATE TABLE IF NOT EXISTS canvas_board_collaborators (
  board_id   UUID NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'editor',   -- 'editor' (Lot 2b) ; 'viewer' réservé futur
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active'
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS canvas_collab_user_idx        ON canvas_board_collaborators(user_id);
CREATE INDEX IF NOT EXISTS canvas_collab_board_status_idx ON canvas_board_collaborators(board_id, status);
