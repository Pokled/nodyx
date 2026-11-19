-- Images de profil restées sur l'ANCIEN domaine de nodyx.org (nexusnode.app, avant le
-- changement de nom). Elles s'affichaient encore, via une redirection 301, mais en taille
-- d'origine : vues comme des images « d'ailleurs », elles échappaient aux vignettes
-- (relevé du 19/11/2026 : un avatar de 370 Ko affiché en 34 px, 12 fois sur l'accueil,
-- une bannière de 9,8 Mo). Les fichiers sont bien sur l'instance, seul le domaine change.
--
-- Ne touche QUE les adresses « https://nexusnode.app/uploads/… » : aucune autre instance
-- n'en possède, la migration n'y fait rien. Le contenu des messages n'est pas réécrit.
UPDATE users
   SET avatar = 'https://nodyx.org' || substr(avatar, length('https://nexusnode.app') + 1)
 WHERE avatar LIKE 'https://nexusnode.app/uploads/%';

UPDATE user_profiles
   SET avatar_url = 'https://nodyx.org' || substr(avatar_url, length('https://nexusnode.app') + 1)
 WHERE avatar_url LIKE 'https://nexusnode.app/uploads/%';

UPDATE user_profiles
   SET banner_url = 'https://nodyx.org' || substr(banner_url, length('https://nexusnode.app') + 1)
 WHERE banner_url LIKE 'https://nexusnode.app/uploads/%';

UPDATE events
   SET cover_url = 'https://nodyx.org' || substr(cover_url, length('https://nexusnode.app') + 1)
 WHERE cover_url LIKE 'https://nexusnode.app/uploads/%';
