-- 148 : trois index qui manquaient (point de vérification du 20/11/2026).
--
-- pg_stat_user_tables sur nodyx.org : security_events (1 298 lignes) lue EN ENTIER
-- 2,9 millions de fois (1,8 milliard de lignes lues, 19 lectures par index). Le collecteur
-- CrowdSec (scripts/ops/security/collector.mjs, toutes les 2 minutes) vérifie pour CHAQUE
-- alerte et CHAQUE décision qu'elle n'est pas déjà là (NOT EXISTS ... WHERE raw_ref = $1,
-- ... WHERE correlation_id = $1), sans index sur ces colonnes. Le pot de miel cherche un
-- incident (honeypot_hits.incident_id) dans 48 000 lignes, 40 Mo : 19 ms par recherche en
-- prod, 90 millions de lignes lues. Tables qui grossissent chaque jour.
--
-- Mesuré au banc (mêmes volumes) : les trois requêtes passent en Index Scan ; le pot de
-- miel 13,9 ms -> 0,19 ms. Tables petites : la création est instantanée.

CREATE INDEX IF NOT EXISTS idx_sec_events_raw_ref     ON security_events (raw_ref);
CREATE INDEX IF NOT EXISTS idx_sec_dec_correlation    ON security_decisions (correlation_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_hits_incident ON honeypot_hits (incident_id);
