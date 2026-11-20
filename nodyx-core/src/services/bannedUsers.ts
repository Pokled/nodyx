// « Bannir cache tout » (20/11/2026) : un compte banni de l'instance n'a plus de
// vitrine. Son profil public, ses publications du fil et ses repartages disparaissent
// pour les visiteurs et les membres ; l'équipe continue de tout voir (elle modère).
// Trouvé avec rajasthanroutecabs : banni à 13:28, ses 13 « micro-articles » à liens
// et son profil (lien vers son site) restaient en ligne, même sans connexion.
import { db } from '../config/database'
import { getInstanceAccess } from './permissions'

/**
 * Fragment SQL : la colonne `userCol` désigne un compte sous bannissement ACTIF (sans
 * fin, ou dont la fin n'est pas passée). `userCol` est toujours une colonne écrite dans
 * le code (jamais une valeur reçue), le fragment ne prend aucun paramètre.
 */
export const ACTIVE_BAN = (userCol: string): string =>
  `EXISTS (SELECT 1 FROM community_bans cb WHERE cb.user_id = ${userCol} AND (cb.expires_at IS NULL OR cb.expires_at > NOW()))`

/** La personne qui regarde fait-elle partie de l'équipe (au moins un droit) ? */
export async function viewerIsTeam(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  try { return (await getInstanceAccess(userId)).permissions.length > 0 } catch { return false }
}

export type ActiveBan = { reason: string | null; banned_at: string; expires_at: string | null }

/** Le bannissement actif d'un compte, ou null. */
export async function activeBanOf(userId: string): Promise<ActiveBan | null> {
  const { rows } = await db.query<ActiveBan>(
    `SELECT reason, banned_at, expires_at FROM community_bans
      WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY banned_at DESC LIMIT 1`, [userId])
  return rows[0] ?? null
}
