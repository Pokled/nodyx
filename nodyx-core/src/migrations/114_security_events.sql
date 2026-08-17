-- ─── Modèle unifié des événements de sécurité ────────────────────────────────
--
-- Objectif : pouvoir répondre à « montre-moi tout ce qui est arrivé à cette IP »
-- sans interroger huit tables différentes.
--
-- CHOIX DE CONCEPTION, ET IL EST STRUCTURANT. On ne recopie PAS l'existant.
-- `honeypot_hits` fait déjà 18 460 lignes ; les dupliquer créerait deux vérités
-- à maintenir et à purger, et le jour où les deux divergent on ne saurait plus
-- laquelle croire.
--
--   `security_events`      table réelle, pour les sources NOUVELLES
--                          (crowdsec, suricata, nftables, ssh)
--   `security_events_all`  vue d'union, qui y projette les tables existantes
--
-- Une seule surface d'interrogation, zéro duplication, et les tables d'origine
-- restent maîtresses de leurs données.

CREATE TABLE IF NOT EXISTS security_events (
  id             BIGSERIAL PRIMARY KEY,
  ts             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- D'où vient l'observation. Pas ce qui s'est passé : QUI l'a vu.
  source         TEXT         NOT NULL
                 CHECK (source IN ('crowdsec','suricata','nftables','ssh','caddy','application')),

  -- Ce qui s'est passé.
  event_type     TEXT         NOT NULL
                 CHECK (event_type IN ('scan','bruteforce','auth_failure','honeypot','waf',
                                       'ids_alert','firewall_block','signup_abuse',
                                       'admin_action','anomaly','request')),

  severity       TEXT         NOT NULL DEFAULT 'info'
                 CHECK (severity IN ('info','low','medium','high','critical')),

  -- L'adresse OBSERVÉE. Peut être un proxy : c'est le rôle de `metadata` de
  -- porter la nuance, jamais de cette colonne de prétendre à l'identité.
  src_ip         INET,
  src_port       INTEGER,
  dst_port       INTEGER,

  user_id        UUID,
  user_agent     TEXT,
  asn            TEXT,
  org            TEXT,
  country        TEXT,

  -- Ce qui a été FAIT de l'événement, distinct de la décision (table 115).
  action         TEXT         NOT NULL DEFAULT 'observed'
                 CHECK (action IN ('observed','challenged','blocked')),

  -- Relie plusieurs événements d'un même épisode, toutes sources confondues.
  correlation_id TEXT,

  -- Référence vers la donnée brute (ligne eve.json, id CrowdSec…), jamais la
  -- donnée elle-même : le brut vit hors PostgreSQL, avec sa propre rétention.
  raw_ref        TEXT,

  metadata       JSONB        NOT NULL DEFAULT '{}'::jsonb
);

-- Les deux axes réels d'interrogation : « cette IP » et « cette source ».
CREATE INDEX IF NOT EXISTS idx_sec_events_ip_ts     ON security_events (src_ip, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_source_ts ON security_events (source, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_type_ts   ON security_events (event_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_corr      ON security_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE security_events IS
  'Événements de sécurité des sources nouvelles. Les tables historiques ne sont pas '
  'recopiées ici : la vue security_events_all les y projette.';

-- ── La vue d'union : une seule surface d'interrogation ──────────────────────
--
-- `honeypot_hits.ip` est de type TEXT (les autres sont INET), d'où le cast et
-- le garde-fou `pg_input_is_valid` : une valeur mal formée ne doit pas faire
-- échouer la vue entière.
CREATE OR REPLACE VIEW security_events_all AS
  SELECT
    id::bigint, ts, source, event_type, severity, src_ip, user_id,
    user_agent, org, country, action, correlation_id, metadata
  FROM security_events

  UNION ALL

  SELECT
    h.id::bigint,
    h.created_at,
    'application',
    'honeypot',
    'medium',
    CASE WHEN pg_input_is_valid(h.ip, 'inet') THEN h.ip::inet END,
    NULL::uuid,
    h.user_agent,
    NULLIF(h.org, '—'),
    NULLIF(h.country, '—'),
    'observed',
    h.incident_id,
    jsonb_build_object('path', h.path, 'method', h.method)
  FROM honeypot_hits h

  UNION ALL

  SELECT
    b.id::bigint,
    b.attempted_at,
    'application',
    'signup_abuse',
    'medium',
    b.ip,
    NULL::uuid,
    b.user_agent,
    NULL, NULL,
    'blocked',
    NULL,
    jsonb_build_object('reason', b.reason, 'username', b.username)
  FROM bot_signup_attempts b;

COMMENT ON VIEW security_events_all IS
  'Union des événements nouveaux et des tables historiques, sans duplication. '
  'C''est la vue qu''Olympus interroge.';
