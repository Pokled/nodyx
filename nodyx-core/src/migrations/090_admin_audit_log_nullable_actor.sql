-- 090_admin_audit_log_nullable_actor.sql
-- Rend admin_audit_log.actor_id nullable pour permettre les actions
-- automatiques (OctoGuard et futures sources non-humaines).
--
-- Convention : actor_id IS NULL  → action automatique
--              actor_id IS NOT NULL → action humaine
--              actor_username distingue toujours la source via préfixe
--              ('octoguard:auto', 'scheduler:auto', etc.)
--
-- Découvert pendant le test e2e Session B-bis du chantier OctoGuard
-- (le pipeline ne pouvait pas logger ses actions à cause de cette
-- contrainte NOT NULL). Idempotent : PostgreSQL accepte DROP NOT NULL
-- même si la colonne est déjà nullable, pas de side-effect.

BEGIN;

ALTER TABLE admin_audit_log
  ALTER COLUMN actor_id DROP NOT NULL;

COMMIT;
