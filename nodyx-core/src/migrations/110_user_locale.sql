-- Migration 110 — Langue préférée de l'utilisateur.
-- Sert aux emails transactionnels et aux notifications push : contrairement à une
-- réponse d'erreur API (rattrapable côté frontend à tout moment), un email ou une
-- notification OS envoyés en français restent figés une fois partis. NULL = pas
-- encore renseignée, résolue à la lecture (locale utilisateur -> langue de
-- l'instance -> français), pas de backfill nécessaire.
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale VARCHAR(5);
