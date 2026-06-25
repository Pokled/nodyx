-- Migration 103 — NodyxCanvas : visibilité des projets standalone (Lot 1)
-- 'private' (défaut) : projet perso, visible/éditable par son créateur.
-- 'public'           : destiné à être visible par tous les membres (galerie
--                       publique + vue lecture seule = Lot 2). Stocké dès le Lot 1
--                       pour que le choix à la création soit persistant.
ALTER TABLE canvas_boards
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
