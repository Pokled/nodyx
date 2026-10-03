/**
 * Un chemin local /uploads/… qui ne peut PAS sortir du dossier des uploads.
 *
 * `startsWith('/uploads/')` ne suffit pas : `/uploads/../../.env` commence
 * bien par /uploads/. Côté disque, un path.join() remonte alors hors du
 * dossier (le frontend lisait ainsi n'importe quel fichier pour la carte de
 * profil, card.png). Côté navigateur, l'URL est normalisée vers une autre
 * adresse du même site.
 *
 * Refusés : tout segment vide, « . » ou « .. », la barre oblique inverse,
 * le caractère nul, et tout « % » (le navigateur décode %2e%2e en « .. »).
 * Les noms de fichiers téléversés sont générés par le serveur : ils n'ont
 * jamais besoin de ces caractères. Une chaîne de requête (?v=…) reste admise
 * pour les contenus existants ; elle n'est pas un chemin.
 */
const PREFIX = '/uploads/'

export function isContainedUploadPath(value: string): boolean {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return false
  const path = value.split(/[?#]/, 1)[0]
  if (/[\\%\0]/.test(path)) return false
  return path
    .slice(PREFIX.length)
    .split('/')
    .every(segment => segment !== '' && segment !== '.' && segment !== '..')
}
