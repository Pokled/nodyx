-- OctoGuard 2, lot 10 (D25) : « Faux positif » et « C'était normal » ne se
-- comptent qu'UNE fois par entrée du journal, même sur deux clics simultanés.
-- La garantie est portée par la base (vérifier puis écrire laisse passer deux
-- requêtes concurrentes). Limité aux deux actions NOUVELLES de ce lot : aucune
-- ligne existante ne peut violer l'index, la migration ne peut pas échouer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_audit_log_og_marks
  ON admin_audit_log (target_id, action)
  WHERE action IN ('octoguard.false_positive', 'octoguard.observed_normal');
