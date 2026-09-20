-- ─── Morceaux sources YouTube (playlists) ────────────────────────────────────
--
-- Un morceau devait jusqu'ici obligatoirement etre un fichier uploade
-- (audio_asset_id NOT NULL). Pour accueillir des playlists faites de liens
-- YouTube (cf SPECS/NODYX_MUSIQUE_PLAYLISTS_CDC.md), audio_asset_id devient
-- une alternative parmi deux sources, pas un remplacement : la contrainte
-- CHECK impose l'exclusivite (upload => audio_asset_id seul, youtube =>
-- youtube_id seul), jamais les deux ni aucun des deux.
--
-- Verifie avant application (19-20/09) contre une replique exacte du schema
-- de music_tracks dans une base de test : les lignes existantes (toutes en
-- source_type='upload' par le DEFAULT) passent la contrainte sans erreur, et
-- les quatre combinaisons invalides sont bien rejetees.
--
-- genre : texte libre, pas de liste fermee en base. Une categorie de musique
-- de jeu (ambiances Twisted Reality) n'a rien a voir avec les genres rock
-- utilises par la premiere playlist YouTube ; figer une enumeration cote SQL
-- aurait bloque tout contenu futur qui ne rentre pas dans ces 7 cases-la.
-- Le tri par genre reste possible cote frontend sans contrainte serveur.

ALTER TABLE music_tracks ALTER COLUMN audio_asset_id DROP NOT NULL;

ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS source_type VARCHAR(10) NOT NULL DEFAULT 'upload'
  CHECK (source_type IN ('upload', 'youtube'));
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS youtube_id  VARCHAR(20);
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS artist      VARCHAR(120);
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS genre       VARCHAR(30);

ALTER TABLE music_tracks ADD CONSTRAINT music_tracks_source_check CHECK (
  (source_type = 'upload'  AND audio_asset_id IS NOT NULL AND youtube_id IS NULL) OR
  (source_type = 'youtube' AND youtube_id IS NOT NULL AND audio_asset_id IS NULL)
);
