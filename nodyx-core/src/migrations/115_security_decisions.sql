-- ─── Ce que le système a DÉCIDÉ, séparé de ce qui s'est passé ────────────────
--
-- `security_events` répond à « qu'est-ce qui est arrivé ».
-- `security_decisions` répond à « qu'est-ce qu'on en a fait ».
--
-- Les mélanger empêcherait la question qui compte vraiment :
--
--     CrowdSec a dit BANNIR — mais est-ce que le paquet a réellement été bloqué ?
--
-- C'est exactement ce que le banc d'essai doit vérifier.
--
-- ── LE CHAMP QUI ÉVITE UNE ILLUSION DE SÉCURITÉ ─────────────────────────────
--
-- `enforcement_plane` n'est pas décoratif. Mesure du 17/08 : le trafic web
-- arrive par Cloudflare, donc l'adresse source au niveau paquet est TOUJOURS un
-- serveur Cloudflare. Bannir un attaquant web dans nftables ne bloque rien : son
-- adresse ne touche jamais la carte réseau.
--
--     nftables   → attaque directe sur l'IP d'origine, SSH, TURN, relais, média
--     cloudflare → l'attaquant web, bloqué à l'edge
--     application→ refus applicatif (limitation de débit, bannissement de compte)
--
-- Sans cette colonne, Olympus afficherait « BLOQUÉ » pour une IP qui continue de
-- passer tranquillement. Une fausse assurance est pire qu'une absence de
-- protection : on cesse de regarder.

CREATE TABLE IF NOT EXISTS security_decisions (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  src_ip            INET        NOT NULL,

  -- Qui a décidé.
  source            TEXT        NOT NULL
                    CHECK (source IN ('crowdsec','application','manual','federation')),

  decision          TEXT        NOT NULL
                    CHECK (decision IN ('ban','captcha','throttle','watch','unban')),

  -- Le motif, lisible : « crowdsec:http-scan », « honeypot:wp-admin ».
  reason            TEXT        NOT NULL,

  duration_seconds  INTEGER,
  expires_at        TIMESTAMPTZ,

  status            TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','expired','revoked','failed')),

  -- OÙ la décision est réellement appliquée. Voir l'explication en tête.
  enforcement_plane TEXT        NOT NULL
                    CHECK (enforcement_plane IN ('nftables','cloudflare','application','none')),

  -- L'application a-t-elle été CONFIRMÉE, ou seulement demandée ? Une décision
  -- prise mais non appliquée doit rester visible comme telle.
  enforced_at       TIMESTAMPTZ,

  correlation_id    TEXT,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- Une adresse privée ou de bouclage ne désigne aucun visiteur : même règle que
  -- la contrainte posée sur `reported_ips` en #587, pour la même raison.
  CONSTRAINT security_decisions_ip_publique CHECK (NOT nodyx_ip_non_publique(src_ip))
);

CREATE INDEX IF NOT EXISTS idx_sec_dec_ip      ON security_decisions (src_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_dec_actives ON security_decisions (status, expires_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sec_dec_plane   ON security_decisions (enforcement_plane, created_at DESC);

COMMENT ON COLUMN security_decisions.enforcement_plane IS
  'Où la décision est réellement appliquée. Un ban nftables ne bloque PAS un '
  'attaquant web derrière Cloudflare : son paquet vient d''un edge.';

COMMENT ON COLUMN security_decisions.enforced_at IS
  'Rempli seulement quand l''application est CONFIRMÉE. NULL = décidé mais non '
  'vérifié : c''est ce que le banc d''essai doit détecter.';

-- ── Ce qui est réellement en vigueur, à un instant donné ────────────────────
CREATE OR REPLACE VIEW security_decisions_actives AS
  SELECT *
  FROM security_decisions
  WHERE status = 'active'
    AND (expires_at IS NULL OR expires_at > NOW());

COMMENT ON VIEW security_decisions_actives IS
  'Décisions en vigueur. Une décision expirée reste en base pour l''historique '
  'et la corrélation de campagne : c''est elle qui dira « déjà banni hier ».';
