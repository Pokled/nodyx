// Projection de l'identite d'un membre vers une extension.
//
// `nodyx.user` n'est PAS une copie de la session : c'est une projection
// autorisee, champ par champ, de ce que l'admin a accepte de montrer.
//
// La projection se fait ICI, cote serveur, et pas dans la page qui monte la
// surface. C'est deliberе : si le frontend devait filtrer, il suffirait d'un
// composant distrait passant l'objet utilisateur entier pour que l'adresse de
// courriel d'un membre parte dans une extension tierce. Le serveur ne rend que
// ce qui est accorde, et la question ne se pose plus.
//
// cf SPECS/NODYX_SDK_REFERENCE.md §5.2, NODYX_SDK_SECURITY.md §4.2

/** Les seuls champs projetables. L'adresse de courriel n'en fait PAS partie. */
export const PROJECTABLE_FIELDS = ['id', 'username', 'avatar', 'locale'] as const

export type ProjectableField = typeof PROJECTABLE_FIELDS[number]

export interface UserRow {
  id?:       string
  username?: string
  avatar?:   string | null
  locale?:   string | null
  /** Volontairement present dans le type : c'est ce qui NE DOIT PAS sortir. */
  email?:    string
  [k: string]: unknown
}

/**
 * Rend l'objet `user` que verra l'extension, ou null.
 *
 * Trois cas rendent null, et ils sont distincts :
 *   - aucun membre connecte : une vue publique est vue par des gens sans compte ;
 *   - la capacite `identity` n'a pas ete accordee ;
 *   - aucun champ individuel n'a ete accorde.
 * Dans les trois cas l'extension doit fonctionner, et le manuel le dit.
 */
export function projectUser(user: UserRow | null | undefined, granted: string[]): Record<string, unknown> | null {
  if (!user) return null
  if (!granted.includes('identity')) return null

  const out: Record<string, unknown> = {}
  for (const field of PROJECTABLE_FIELDS) {
    if (!granted.includes(`identity:${field}`)) continue
    const value = user[field]
    if (value === undefined) continue
    out[field] = value ?? null
  }

  return Object.keys(out).length ? out : null
}

/**
 * Colonnes a lire en base pour honorer une projection.
 *
 * On ne lit que ce qu'on a le droit de rendre : une requete qui ramene
 * l'adresse de courriel pour la jeter ensuite finit toujours par la laisser
 * fuir dans un journal ou une trace d'erreur.
 */
export function columnsFor(granted: string[]): ProjectableField[] {
  if (!granted.includes('identity')) return []
  return PROJECTABLE_FIELDS.filter(f => granted.includes(`identity:${f}`))
}
