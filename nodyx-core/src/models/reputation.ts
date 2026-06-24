import { db } from '../config/database'

// Points de réputation (colonne users.points). Le niveau/badge est dérivé côté
// front : level = floor(sqrt(points/10)) + 1.
//   +10 créer un thread/article · +2 répondre · +5 recevoir un Merci
// On déduit à la suppression (anti-farming create/delete). points >= 0 garanti.
export const REPUTATION = {
  THREAD: 10,
  REPLY:  2,
  THANKS: 5,
} as const

export async function awardPoints(userId: string, delta: number): Promise<void> {
  if (!userId || !delta) return
  await db.query(
    `UPDATE users SET points = GREATEST(0, points + $1) WHERE id = $2`,
    [delta, userId],
  ).catch(() => {})   // jamais bloquer l'action principale sur l'attribution de points
}
