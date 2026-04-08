-- Migration 069 : Homepage Builder — positions + widgets
-- Système de positions nommées avec widgets configurables
-- N'importe quel widget peut aller dans n'importe quelle position

-- ── Table homepage_positions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS homepage_positions (
  id          TEXT    PRIMARY KEY,
  label       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  layout      TEXT    NOT NULL DEFAULT 'full',  -- 'full'|'sidebar'|'grid-2'|'grid-3'|'grid-4'
  max_widgets INT,                               -- NULL = illimité
  sort_order  INT     NOT NULL DEFAULT 0,
  enabled     BOOLEAN NOT NULL DEFAULT true
);

-- ── Table homepage_widgets ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS homepage_widgets (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id TEXT    NOT NULL REFERENCES homepage_positions(id) ON DELETE CASCADE,
  widget_type TEXT    NOT NULL,
  title       TEXT,
  config      JSONB   NOT NULL DEFAULT '{}',
  sort_order  INT     NOT NULL DEFAULT 0,
  enabled     BOOLEAN NOT NULL DEFAULT true,

  -- Visibilité : { "audience": "all"|"guests"|"members", "roles": [], "start_date": null, "end_date": null }
  visibility  JSONB   NOT NULL DEFAULT '{"audience":"all"}',

  -- Responsive
  width       TEXT    NOT NULL DEFAULT 'full',   -- 'full'|'1/2'|'1/3'|'2/3'|'1/4'|'3/4'
  mobile_height TEXT,
  hide_mobile BOOLEAN NOT NULL DEFAULT false,
  hide_tablet BOOLEAN NOT NULL DEFAULT false,

  -- Multi-page (NULL = homepage uniquement)
  page_path   TEXT    DEFAULT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hw_position ON homepage_widgets(position_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_hw_enabled   ON homepage_widgets(enabled) WHERE enabled = true;

-- ── Seed : 11 positions par défaut ───────────────────────────────────────────
INSERT INTO homepage_positions (id, label, description, layout, max_widgets, sort_order) VALUES
  ('banner',    'Bandeau',          'Barre pleine largeur en haut (annonces)',      'full',    1,    0),
  ('hero',      'Hero',             'Section d''accueil principale',                'full',    1,    10),
  ('stats-bar', 'Barre de stats',   'Ligne de compteurs / badges',                 'full',    NULL, 20),
  ('main',      'Contenu principal','Colonne principale (gauche, large)',           'full',    NULL, 30),
  ('sidebar',   'Sidebar',          'Colonne latérale (droite, étroite)',           'sidebar', NULL, 40),
  ('wide-1',    'Section large 1',  'Section pleine largeur sous main/sidebar',    'full',    NULL, 50),
  ('wide-2',    'Section large 2',  'Deuxième section pleine largeur',             'full',    NULL, 60),
  ('footer-1',  'Pied de page 1',   'Première colonne du pied de page',            'grid-3',  NULL, 70),
  ('footer-2',  'Pied de page 2',   'Deuxième colonne du pied de page',            'grid-3',  NULL, 80),
  ('footer-3',  'Pied de page 3',   'Troisième colonne du pied de page',           'grid-3',  NULL, 90),
  ('footer-bar','Barre de pied',    'Barre copyright / social links (tout en bas)','full',    NULL, 100)
ON CONFLICT (id) DO NOTHING;

-- ── Seed : widgets par défaut (reproduisent la homepage actuelle) ─────────────
-- hero-banner : remplace le hero hardcodé
INSERT INTO homepage_widgets (position_id, widget_type, config, sort_order)
VALUES ('hero', 'hero-banner', '{
  "style": "centered",
  "overlay_opacity": 0.5,
  "enable_variants": true
}', 0)
ON CONFLICT DO NOTHING;

-- stats-bar : remplace les stats hardcodées
INSERT INTO homepage_widgets (position_id, widget_type, config, sort_order)
VALUES ('stats-bar', 'stats-bar', '{
  "stats": ["members", "online", "threads", "posts"],
  "animated_count": true,
  "live_updates": true
}', 0)
ON CONFLICT DO NOTHING;

-- join-card : visible guests seulement par défaut
INSERT INTO homepage_widgets (position_id, widget_type, config, sort_order, visibility)
VALUES ('sidebar', 'join-card', '{
  "show_recent_avatars": true,
  "show_online_count": true
}', 0, '{"audience":"guests"}')
ON CONFLICT DO NOTHING;
