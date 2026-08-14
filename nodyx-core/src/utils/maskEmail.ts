// Masquage des adresses de courriel dans l'administration.
//
// Pourquoi ce module existe : le tableau de bord et la liste des membres
// affichaient les adresses en clair. Ouvrir le panneau d'administration
// pendant un direct, ou simplement montrer son ecran, diffusait les adresses
// des membres. Le proprietaire de l'instance a cesse de diffuser son propre
// projet pour cette raison, ce qui est le signe qu'un defaut de conception
// coute plus cher qu'il n'en a l'air.
//
// Le choix est le MASQUAGE PAR DEFAUT, et pas un « mode discret » a activer :
// un mode qu'on oublie d'allumer ne protege personne, et c'est precisement le
// soir ou on l'oublie que ca se voit. L'adresse complete reste accessible, mais
// par un geste explicite, et ce geste laisse une trace.

/**
 * `jonathan@gmail.com` -> `j••••••@g••••.com`
 *
 * On garde la premiere lettre de chaque cote et l'extension : assez pour
 * reconnaitre une adresse qu'on connait deja, pas assez pour la lire a
 * quelqu'un qui la decouvre.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return ''

  const at = email.lastIndexOf('@')
  if (at <= 0) {
    // Pas une adresse : on masque tout sauf la premiere lettre plutot que de
    // rendre la valeur telle quelle.
    return email.length > 1 ? email[0] + '•'.repeat(Math.min(email.length - 1, 8)) : '•'
  }

  const local  = email.slice(0, at)
  const domain = email.slice(at + 1)

  const dot   = domain.lastIndexOf('.')
  const host  = dot > 0 ? domain.slice(0, dot) : domain
  const tld   = dot > 0 ? domain.slice(dot) : ''

  const hide = (s: string) => (s.length <= 1 ? s : s[0] + '•'.repeat(Math.min(s.length - 1, 6)))

  return `${hide(local)}@${hide(host)}${tld}`
}

/** Applique le masquage sur une ligne qui porte un champ `email`. */
export function maskEmailIn<T extends { email?: string | null }>(row: T): T & { email: string } {
  return { ...row, email: maskEmail(row.email) }
}
