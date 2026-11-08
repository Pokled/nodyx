-- Une exclusion temporaire qui reste temporaire (CDC E4i, lot 4a, D32).
-- Une exclusion supprime la ligne de membre : on garde ici son rôle, son grade
-- et sa date d'arrivée, pour les lui rendre à l'échéance (ou à un débannissement
-- manuel). Pas de clé étrangère sur prev_grade_id : le grade peut disparaître
-- pendant l'exclusion, il n'est rendu que s'il existe encore.
ALTER TABLE community_bans ADD COLUMN IF NOT EXISTS prev_role       VARCHAR(20);
ALTER TABLE community_bans ADD COLUMN IF NOT EXISTS prev_grade_id   UUID;
ALTER TABLE community_bans ADD COLUMN IF NOT EXISTS prev_joined_at  TIMESTAMP;
