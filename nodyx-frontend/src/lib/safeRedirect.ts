// L'adresse de retour après une connexion (?redirectTo=…) vient de l'URL : n'importe
// qui peut la fabriquer et l'envoyer dans un lien. On ne la suit que si c'est un
// chemin de CETTE instance.
//
// Liste fermée de caractères plutôt que liste de pièges : « /\site.fr » (les
// navigateurs lisent l'antislash comme un « / »), « javascript:… », une tabulation
// ou un retour à la ligne (que le navigateur efface avant de lire l'adresse) sont
// refusés parce qu'ils ne sont pas dans la liste, pas parce qu'on y a pensé.
// Même principe que safeAdminNext (lib/charter/teamDoor.ts), pour tout le site.

const CHEMIN = /^\/(?![/\\])[A-Za-z0-9\-._~%/?=&+,#!$'()*;@]*$/

/** Un chemin interne sûr à suivre, ou `fallback`. */
export function safeInternalPath(raw: unknown, fallback = '/'): string {
	if (typeof raw !== 'string' || raw.length > 2048) return fallback
	return CHEMIN.test(raw) ? raw : fallback
}
