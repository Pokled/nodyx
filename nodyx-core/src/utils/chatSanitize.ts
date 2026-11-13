// Assainissement d'un message du chat (et d'un message privé non chiffré), partagé
// par le socket (envoi, modification) et par la pré-vérification « Tu es sûr ? »
// (lot 5) : le moteur et l'annonce doivent juger exactement le même texte.
//
// C'est le nettoyeur PARTAGÉ (utils/sanitize), pas une liste à part. Jusqu'au
// 13/11/2026, le chat avait sa propre copie, restée en retard : l'audio, les directs
// Twitch et les morceaux y étaient retirés sans prévenir, et une vidéo refusée
// laissait une boîte vide. Une seule différence, voulue : pas d'id sur les titres
// (voir SanitizeOptions.headingIds).

import { sanitize } from './sanitize'

export function sanitizeChat(raw: string): string {
  return sanitize(raw, { headingIds: false })
}
