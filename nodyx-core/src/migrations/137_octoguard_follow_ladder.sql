-- Migration 137 : une règle peut « suivre le barème » (OctoGuard 2, lot 4b, D28).
-- Au cran Avertir, au lieu de son escalade propre, OctoGuard applique au membre sa
-- prochaine marche du barème : jamais une exclusion (il prévient l'équipe), et une
-- marche par 24 heures au plus.
ALTER TABLE octoguard_automod_rules ADD COLUMN IF NOT EXISTS follow_ladder BOOLEAN NOT NULL DEFAULT FALSE;
