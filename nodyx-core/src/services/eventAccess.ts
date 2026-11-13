// Qui peut LIRE un événement. Une seule règle, partagée par la page de l'événement,
// l'inscription (RSVP) et, demain, la carte d'un lien vers l'événement (« Nodyx relié ») :
// - public : tout le monde, même sans compte ;
// - privé (« Privé » dans l'interface) : les membres de la communauté seulement.
// C'est la règle que la LISTE appliquait déjà (GET /events). La lecture par identifiant,
// elle, ne vérifiait rien jusqu'au 13/11/2026 : un événement privé s'ouvrait sans compte.
import { db } from '../config/database'

export async function canReadEvent(
  ev: { is_public: boolean; community_id: string },
  viewerId: string | null | undefined,
): Promise<boolean> {
  if (ev.is_public) return true
  if (!viewerId) return false
  const { rows } = await db.query(
    `SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
    [ev.community_id, viewerId],
  )
  return rows.length > 0
}
