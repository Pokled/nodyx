-- OctoGuard 2, lot 3 (CDC E4h, D18) : l'historique des modifications.
-- Chaque modification d'un message du chat ou du forum garde l'ancien texte,
-- écrit dans la MÊME requête que la modification (rien ne peut y échapper).
-- Lu par l'équipe seulement (Signalements : « ce que l'auteur a modifié »).
-- Effacé après 90 jours. Les modifications antérieures à cette migration
-- ne sont pas récupérables.

CREATE TABLE IF NOT EXISTS message_edits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  VARCHAR(10) NOT NULL CHECK (target_type IN ('message', 'post')),
  target_id    UUID NOT NULL,
  editor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  old_content  TEXT NOT NULL,
  edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_edits_target ON message_edits (target_type, target_id, edited_at);
CREATE INDEX IF NOT EXISTS idx_message_edits_age ON message_edits (edited_at);
