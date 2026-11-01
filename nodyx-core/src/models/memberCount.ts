import { db } from '../config/database'

// Une seule définition du « nombre de membres » pour toute l'instance.
//
// Avant, cinq requêtes différentes répondaient à la même question et donnaient
// cinq chiffres (sur nodyx.org le 01/11/2026 : 158, 155, 106, 105 et 104) :
// le tableau de bord admin comptait tous les comptes, bannis et inscriptions
// jamais validées comprises, la page publique ignorait les bannissements,
// l'annuaire comptait des comptes jamais entrés dans la communauté...
//
// Un membre, c'est :
//   - un compte humain (users.is_system = false : le bot OctoGuard n'en est pas un),
//   - inscrit dans la communauté (community_members, posé à la validation du compte),
//   - et pas banni de cette communauté (community_bans).
//
// Les comptes en attente de validation d'email, les bannis et les bots ne sont
// donc PAS des membres. Ce chiffre est celui que voient le tableau de bord, la
// page publique de l'instance, l'annuaire, et celui que plafonne la limite
// d'inscriptions (NODYX_MAX_MEMBERS).
//
// Une instance = une communauté : on compte quand même les utilisateurs DISTINCTS
// pour rester juste si une base historique en contient plusieurs.
export const ACTIVE_MEMBERS_FROM = `
  FROM community_members cm
  JOIN users u ON u.id = cm.user_id
  WHERE u.is_system = false
    AND NOT EXISTS (
      SELECT 1 FROM community_bans cb
      WHERE cb.community_id = cm.community_id AND cb.user_id = cm.user_id
    )`

export interface MemberCount {
  total: number
  new_this_week: number
}

// « Nouveaux cette semaine » se mesure à l'entrée dans la communauté (joined_at),
// pas à la création du compte : un compte créé il y a un mois et validé hier est
// un nouveau membre de cette semaine.
export async function countActiveMembers(): Promise<MemberCount> {
  const { rows } = await db.query<MemberCount>(
    `SELECT COUNT(DISTINCT cm.user_id)::int AS total,
            COUNT(DISTINCT cm.user_id) FILTER (WHERE cm.joined_at > NOW() - INTERVAL '7 days')::int AS new_this_week
     ${ACTIVE_MEMBERS_FROM}`
  )
  return {
    total:         rows[0]?.total ?? 0,
    new_this_week: rows[0]?.new_this_week ?? 0,
  }
}
