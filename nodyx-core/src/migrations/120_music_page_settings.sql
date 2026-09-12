-- ─── En-tête éditable de la vitrine musique ──────────────────────────────────
--
-- Le titre/sous-titre de /musique étaient des chaînes i18n figées, écrites
-- pour un seul usage ("compositions pour des jeux vidéo indépendants"). La
-- vitrine sert en pratique à n'importe quel contexte (musique, mais aussi
-- d'autres types de médias à l'avenir) : ces champs deviennent éditables par
-- l'admin depuis /admin/music, avec repli sur les clés i18n par défaut si
-- vides (instance fraîche = toujours un texte cohérent).

ALTER TABLE communities ADD COLUMN IF NOT EXISTS music_page_title    VARCHAR(120);
ALTER TABLE communities ADD COLUMN IF NOT EXISTS music_page_subtitle TEXT;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS music_page_banner_asset_id UUID REFERENCES community_assets(id) ON DELETE SET NULL;
