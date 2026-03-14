-- Migration 047: Système de tâches léger (Kanban)
-- Tableaux par communauté, colonnes configurables, cartes avec assignation et priorité

CREATE TABLE IF NOT EXISTS task_boards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL,
  name         VARCHAR(100) NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_by   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_columns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  color      VARCHAR(20)  NOT NULL DEFAULT 'gray',
  position   SMALLINT     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id   UUID NOT NULL REFERENCES task_columns(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id UUID,
  due_date    DATE,
  priority    VARCHAR(10)  NOT NULL DEFAULT 'normal',
  position    SMALLINT     NOT NULL DEFAULT 0,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_boards_community_idx ON task_boards (community_id);
CREATE INDEX IF NOT EXISTS task_columns_board_idx    ON task_columns (board_id, position);
CREATE INDEX IF NOT EXISTS task_cards_column_idx     ON task_cards (column_id, position);
