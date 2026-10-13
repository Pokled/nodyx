/**
 * Fil du chat : un message supprimé disparaît de l'affichage.
 *
 * Il reste dans la liste en mémoire, marqué `is_deleted` : le chargement de
 * l'historique demande la page précédente à partir du plus ancien message
 * connu, et une page entière de messages supprimés retirés de la liste le
 * ferait redemander la même page à l'infini. On le masque donc au rendu.
 *
 * Seule trace gardée : la citation d'une réponse qui lui était adressée, vidée
 * pour afficher « message supprimé » (sans quoi la réponse ne voudrait plus rien dire).
 */

interface MessageDuFil {
  id: string
  is_deleted?: boolean | null
  content?: string | null
  reply_to_id?: string | null
  reply_to_content?: string | null
}

export function messagesVisibles<T extends { is_deleted?: boolean | null }>(messages: T[]): T[] {
  return messages.filter((m) => !m.is_deleted)
}

export function marquerSupprime<T extends MessageDuFil>(messages: T[], id: string): T[] {
  return messages.map((m) => {
    if (m.id === id) return { ...m, is_deleted: true, content: null }
    if (m.reply_to_id === id) return { ...m, reply_to_content: null }
    return m
  })
}
