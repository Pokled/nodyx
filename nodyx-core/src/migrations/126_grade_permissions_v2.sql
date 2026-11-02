-- 126 : permissions de grade, deuxième version (CDC SPECS/NODYX_MODERATION_CDC.md, E1).
--
-- Jusqu'ici les permissions de grade étaient enregistrées mais vérifiées par
-- aucune route. Elles deviennent réelles et ADDITIVES (D1) : un grade ajoute des
-- droits au socle du rôle, il n'en retire jamais. D'où :
--   - can_post et can_create_thread disparaissent : tout membre les a, un grade
--     ne peut pas les retirer, les garder ferait croire le contraire ;
--   - les autres clés sont renommées vers les nouvelles permissions, valeur
--     conservée (ce que l'admin avait coché reste coché) ;
--   - les 3 nouvelles (ban_members, view_audit_log, manage_octoguard) partent
--     à false.
-- Idempotente : une ligne déjà migrée (clé manage_categories présente) n'est
-- pas retouchée.

UPDATE community_grades
SET permissions = jsonb_build_object(
  'manage_categories', COALESCE((permissions->>'can_create_category')::boolean, false),
  'moderate_content',  COALESCE((permissions->>'can_moderate')::boolean,        false),
  'moderate_members',  COALESCE((permissions->>'can_manage_members')::boolean,  false),
  'ban_members',       false,
  'manage_grades',     COALESCE((permissions->>'can_manage_grades')::boolean,   false),
  'view_audit_log',    false,
  'manage_octoguard',  false
)
WHERE NOT (permissions ? 'manage_categories');

ALTER TABLE community_grades
  ALTER COLUMN permissions SET DEFAULT '{"manage_categories": false, "moderate_content": false, "moderate_members": false, "ban_members": false, "manage_grades": false, "view_audit_log": false, "manage_octoguard": false}'::jsonb;
