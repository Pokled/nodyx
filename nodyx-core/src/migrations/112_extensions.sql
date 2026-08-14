-- 112 — Extensions Nodyx (SDK api 1)
--
-- Remplace le systeme `installed_widgets` (071), qui reste en place une
-- release de plus : tant que la bascule n'est pas verifiee sur les quatre
-- instances, le repli est le retour arriere du frontend seul.
-- cf SPECS/NODYX_SDK_CDC.md §6.1 et §13.1

CREATE TABLE IF NOT EXISTS installed_extensions (
  id            TEXT        PRIMARY KEY,          -- manifest.id, valide par le SDK
  manifest      JSONB       NOT NULL,
  messages      JSONB       NOT NULL DEFAULT '{}',-- locale -> dictionnaire plat
  version       TEXT        NOT NULL,
  origin        TEXT        NOT NULL,             -- 'file' | 'registry:<hote>'
  sha256        TEXT        NOT NULL,             -- empreinte de l'archive installee
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  -- Permissions ACCORDEES par l'admin, pas celles demandees au manifeste.
  -- La difference est le coeur du modele : une extension n'obtient que ce que
  -- l'admin a vu et accepte.
  granted       JSONB       NOT NULL DEFAULT '{}',
  installed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  installed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS installed_extensions_enabled_idx
  ON installed_extensions (enabled);

-- Stockage cle/valeur cloisonne par extension.
--
-- L'extension ne nomme jamais son propre espace : la cle d'extension vient du
-- jeton, pas de la requete. Deux portees, `user` et `instance`, l'ecriture
-- partagee etant une capacite distincte de la lecture partagee.
--
-- UNIQUE NULLS NOT DISTINCT exige PostgreSQL 15 ou plus (prod en 16) : sans
-- lui, deux lignes de portee instance avec user_id NULL ne seraient pas
-- dedoublonnees, NULL etant distinct de NULL dans une contrainte d'unicite.
CREATE TABLE IF NOT EXISTS extension_storage (
  extension_id TEXT        NOT NULL REFERENCES installed_extensions(id) ON DELETE CASCADE,
  scope        TEXT        NOT NULL CHECK (scope IN ('instance', 'user')),
  user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
  key          TEXT        NOT NULL,
  value        JSONB       NOT NULL,
  bytes        INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (extension_id, scope, user_id, key),
  -- Une ligne de portee user sans utilisateur, ou de portee instance avec un
  -- utilisateur, serait une donnee orpheline : la base refuse les deux.
  CONSTRAINT extension_storage_scope_coherent CHECK (
    (scope = 'user'     AND user_id IS NOT NULL) OR
    (scope = 'instance' AND user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS extension_storage_lookup_idx
  ON extension_storage (extension_id, scope, user_id);

-- Secrets d'instance utilises par le proxy reseau.
--
-- La valeur n'est JAMAIS renvoyee par une API : elle est injectee cote serveur
-- selon une recette que le serveur possede. L'extension nomme le secret, elle
-- ne choisit ni l'en-tete ni sa destination, sinon elle le recuperait
-- indirectement en le faisant envoyer vers un hote qu'elle controle.
-- cf SPECS/NODYX_SDK_SECURITY.md §4.4
CREATE TABLE IF NOT EXISTS extension_secrets (
  extension_id TEXT        NOT NULL REFERENCES installed_extensions(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  value        TEXT        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (extension_id, name)
);

-- Jetons d'extension revoques avant leur expiration naturelle.
--
-- Un jeton vit dix minutes. Cette table sert la fenetre entre une
-- desactivation, une desinstallation ou un retrait de permission, et
-- l'expiration du dernier jeton emis. Purge par `expires_at`.
CREATE TABLE IF NOT EXISTS extension_revoked_tokens (
  jti        TEXT        PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS extension_revoked_tokens_expiry_idx
  ON extension_revoked_tokens (expires_at);
