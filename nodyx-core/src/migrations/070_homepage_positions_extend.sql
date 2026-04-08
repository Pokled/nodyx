-- 070 — Extend homepage positions with 2-col and 3-col body zones
-- Adds half-1/half-2 (2-col) between wide-1 and wide-2
-- Adds trio-1/trio-2/trio-3 (3-col) between wide-2 and footer

INSERT INTO homepage_positions (id, label, layout, sort_order) VALUES
  ('half-1', 'Section 2 col — Gauche',  'grid-2', 53),
  ('half-2', 'Section 2 col — Droite',  'grid-2', 54),
  ('trio-1', 'Section 3 col — 1',       'grid-3', 63),
  ('trio-2', 'Section 3 col — 2',       'grid-3', 64),
  ('trio-3', 'Section 3 col — 3',       'grid-3', 65)
ON CONFLICT (id) DO NOTHING;
