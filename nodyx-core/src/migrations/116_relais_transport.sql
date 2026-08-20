-- ─── Savoir quand le port 7443 pourra être retiré ───────────────────────────
--
-- Le chantier relais ajoute une seconde porte, en WebSocket sur 443, sans
-- toucher au port 7443 hérité dont dépendent les instances déjà installées.
-- Le CDC prévoit de retirer 7443 « quand la télémétrie montre que plus personne
-- ne l'utilise ».
--
-- Cette télémétrie n'existait pas. Rien ne distinguait une instance connectée en
-- TCP brut d'une instance en WebSocket : la dépréciation aurait été un pari, et
-- fermer le port aurait pu couper quelqu'un sans qu'on le sache jamais.
--
-- CE QU'ON ENREGISTRE, ET RIEN DE PLUS. Le nom du transport et la date. Pas
-- d'adresse, pas de compteur d'usage, pas d'horodatage de requête. Nodyx
-- revendique zéro analytique : la seule question à laquelle ces colonnes servent
-- à répondre est « reste-t-il quelqu'un sur 7443 ? ».
--
-- La colonne reste NULL tant qu'une instance ne s'est pas connectée depuis la
-- mise en service : NULL veut dire « on ne sait pas », jamais « migré ».

ALTER TABLE directory_instances
  ADD COLUMN IF NOT EXISTS relay_transport    TEXT,
  ADD COLUMN IF NOT EXISTS relay_transport_at TIMESTAMPTZ;

-- Deux valeurs seulement, et la contrainte les fige : une faute de frappe côté
-- relais ferait croire à tort que personne n'est resté sur l'ancien port.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'directory_instances_relay_transport'
  ) THEN
    ALTER TABLE directory_instances
      ADD CONSTRAINT directory_instances_relay_transport
      CHECK (relay_transport IS NULL OR relay_transport IN ('tcp7443', 'wss'));
  END IF;
END $$;

-- L'index sert l'unique requête de décision : qui est encore sur l'ancien port,
-- et quand l'a-t-on vu pour la dernière fois.
CREATE INDEX IF NOT EXISTS idx_directory_relay_transport
  ON directory_instances (relay_transport, relay_transport_at DESC)
  WHERE relay_transport IS NOT NULL;

COMMENT ON COLUMN directory_instances.relay_transport IS
  'Transport utilisé au dernier rattachement au relais : tcp7443 (hérité) ou wss. '
  'NULL = jamais observé depuis la mise en service, ce qui ne veut PAS dire migré.';

COMMENT ON COLUMN directory_instances.relay_transport_at IS
  'Date du dernier rattachement observé. Sert à ne pas conclure sur une instance '
  'dormante depuis des mois.';
