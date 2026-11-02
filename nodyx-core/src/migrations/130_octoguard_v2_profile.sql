-- 130 : OctoGuard 2, le profil de base (CDC SPECS/NODYX_OCTOGUARD_V2_CDC.md, E4b).
--
-- Trois nouveaux types de règles :
--   keywords : liste de mots interdits, sans expression régulière, qui déjoue
--              les contournements (accents, casse, chiffres, séparateurs) ;
--   flood    : même message répété, ou rafale de messages ;
--   zalgo    : texte corrompu (caractères combinés empilés).
-- conditions : restrictions de la règle, par exemple { "account_max_age_days": 2 }
--   pour ne viser que les comptes récents.
ALTER TABLE octoguard_automod_rules DROP CONSTRAINT IF EXISTS octoguard_automod_rules_type_check;
ALTER TABLE octoguard_automod_rules ADD CONSTRAINT octoguard_automod_rules_type_check
  CHECK (type IN ('regex', 'caps', 'link_domain', 'mention_spam', 'link_spam', 'keywords', 'flood', 'zalgo'));

ALTER TABLE octoguard_automod_rules ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb;
