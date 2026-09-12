-- ─── Attestation de licence par catégorie musique ────────────────────────────
--
-- Une catégorie = une ambiance d'un projet donné, composée pour un studio/jeu
-- avec un outil donné (ex: Suno). license_note est le texte libre (rempli par
-- l'admin) qui documente la provenance et les droits ; il alimente le PDF
-- telechargeable exposé publiquement à côté de chaque morceau de la catégorie
-- (GET /api/v1/music/categories/:id/license.pdf), pour que le développeur
-- destinataire ait une preuve écrite à montrer si on lui demande des comptes.

ALTER TABLE music_categories ADD COLUMN IF NOT EXISTS license_note TEXT;
