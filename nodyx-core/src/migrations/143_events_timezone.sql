-- Le fuseau de l'organisateur (identifiant IANA, ex. « Europe/Paris »), donné par son
-- navigateur à la création. L'heure, elle, reste un instant universel (starts_at) :
-- chaque lecteur la voit dans SON fuseau ; ce champ sert à dire aussi « 20:00 à Paris,
-- heure de l'organisateur » quand le lecteur est ailleurs, et aux annonces (webhooks).
-- NULL pour les événements d'avant : on n'invente pas un fuseau.
ALTER TABLE events ADD COLUMN IF NOT EXISTS timezone TEXT NULL;
