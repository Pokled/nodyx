-- ─── Rattrapage des adresses perdues derrière le tunnel Cloudflare ───────────
--
-- Contexte, mesuré le 2026-08-17. Depuis le 2026-08-08 le trafic arrive par un
-- tunnel Cloudflare, qui envoie `CF-Connecting-IP` mais pas `X-Forwarded-For`.
-- Fastify dérivant `request.ip` de X-Forwarded-For, il se rabattait sur
-- l'adresse de la socket : `127.0.0.1` pour tous les visiteurs externes.
--
--     jour        total  loopback  ips distinctes
--     2026-08-07    135         0             16   <- normal
--     2026-08-08    102        84              8   <- bascule
--     2026-08-17    120       120              1   <- 100 % depuis
--
-- Les attaques n'ont jamais cessé : les chemins visés restent /wp-admin/,
-- /.env, /xmlrpc.php. Seule leur origine manquait. Or `honeypot_hits.headers`
-- conserve l'en-tête d'origine, donc la donnée est récupérable : 1447 lignes
-- sur 1461, soit 122 attaquants distincts.
--
-- PRUDENCE 1 — ORDRE D'ÉVALUATION. PostgreSQL n'ordonne pas les conditions d'un
-- WHERE. Écrire `... AND (h->>'x') ~ '...' AND (h->>'x')::inet << ...` peut donc
-- exécuter le cast AVANT le filtre, et une seule valeur mal formée ferait échouer
-- toute la migration, donc le démarrage du cœur. On isole la validation dans une
-- CTE `MATERIALIZED`, qui force son exécution complète avant la suite, et on
-- valide avec `pg_input_is_valid` (PostgreSQL 16) qui ne lève jamais.
--
-- PRUDENCE 2 — CE QU'ON ACCEPTE. Uniquement des adresses réellement publiques.
-- Sont refusées les plages privées, le loopback, la documentation RFC 5737, et
-- les plages Cloudflare : une adresse Cloudflare (`2a06:98c0:3600::103`) a été
-- vue remontée comme si c'était un client. Mêmes règles que `utils/clientIp.ts`.

-- Plages qui ne désignent jamais un visiteur d'Internet.
CREATE OR REPLACE FUNCTION nodyx_ip_non_publique(a inet) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT a << ANY (ARRAY[
    -- Privées, loopback, lien-local, CGNAT, documentation RFC 5737.
    '10.0.0.0/8'::inet, '172.16.0.0/12'::inet, '192.168.0.0/16'::inet,
    '127.0.0.0/8'::inet, '169.254.0.0/16'::inet, '100.64.0.0/10'::inet,
    '192.0.2.0/24'::inet, '198.51.100.0/24'::inet, '203.0.113.0/24'::inet,
    '::1/128'::inet, 'fc00::/7'::inet, 'fe80::/10'::inet,
    -- Cloudflare : notre propre infrastructure.
    '173.245.48.0/20'::inet, '103.21.244.0/22'::inet, '103.22.200.0/22'::inet,
    '103.31.4.0/22'::inet, '141.101.64.0/18'::inet, '108.162.192.0/18'::inet,
    '190.93.240.0/20'::inet, '188.114.96.0/20'::inet, '197.234.240.0/22'::inet,
    '198.41.128.0/17'::inet, '162.158.0.0/15'::inet, '104.16.0.0/13'::inet,
    '104.24.0.0/14'::inet, '172.64.0.0/13'::inet, '131.0.72.0/22'::inet,
    '2400:cb00::/32'::inet, '2606:4700::/32'::inet, '2803:f800::/32'::inet,
    '2405:b500::/32'::inet, '2405:8100::/32'::inet, '2a06:98c0::/29'::inet,
    '2c0f:f248::/32'::inet
  ])
$$;

-- ── 1. Pot de miel : restituer l'adresse depuis l'en-tête conservé ───────────
WITH brut AS MATERIALIZED (
  SELECT id, trim(split_part(headers ->> 'cf-connecting-ip', ',', 1)) AS valeur
  FROM honeypot_hits
  -- NB : `honeypot_hits.ip` est de type TEXT (contrairement a `reported_ips.ip`
  -- qui est INET). D'ou la comparaison textuelle ici, et le `::text` au SET.
  WHERE ip IN ('127.0.0.1', '::1', '::ffff:127.0.0.1')
    AND headers ? 'cf-connecting-ip'
),
valide AS MATERIALIZED (
  SELECT id, valeur
  FROM brut
  WHERE valeur <> '' AND pg_input_is_valid(valeur, 'inet')
),
retenu AS (
  SELECT id, valeur
  FROM valide
  WHERE NOT nodyx_ip_non_publique(valeur::inet)
)
UPDATE honeypot_hits h
SET ip = r.valeur
FROM retenu r
WHERE h.id = r.id;

-- ── 2. Blocage fédéré : ne plus distribuer de bruit aux autres instances ─────
--
-- `reported_ips` alimente le blocage partagé entre instances. Il contenait 102
-- entrées en 127.0.0.1 sur 118, envoyées par 4 instances : du bruit distribué à
-- tout le réseau. On purge, puis on interdit à l'écriture.
DELETE FROM reported_ips WHERE nodyx_ip_non_publique(ip);

-- Verrou permanent : une adresse privée, loopback ou Cloudflare n'a aucun sens
-- comme signalement fédéré. Vaut aussi pour une instance tierce mal configurée.
ALTER TABLE reported_ips DROP CONSTRAINT IF EXISTS reported_ips_ip_publique;
ALTER TABLE reported_ips
  ADD CONSTRAINT reported_ips_ip_publique CHECK (NOT nodyx_ip_non_publique(ip));
