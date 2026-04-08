-- 071 — Widget Store : widgets installables via .zip
-- Chaque widget installé est stocké ici avec son manifest JSON
-- Les fichiers JS sont servis depuis uploads/widgets/:id/

CREATE TABLE IF NOT EXISTS installed_widgets (
  id            TEXT        PRIMARY KEY,          -- slugifié depuis manifest.id
  manifest      JSONB       NOT NULL,             -- manifest.json complet
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  installed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS installed_widgets_enabled_idx ON installed_widgets (enabled);
