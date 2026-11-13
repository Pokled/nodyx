// Les origines sous lesquelles cette instance est joignable : FRONTEND_URL (le site),
// SELF_URL, et PUBLIC_API_URL quand l'API répond sur un autre domaine que le site.
// Sert à reconnaître une adresse « de chez nous » : un fichier envoyé sur l'instance
// (couverture d'événement), un lien interne (cartes de liens, « Nodyx relié »).
export function ownOrigins(): Set<string> {
  const out = new Set<string>()
  for (const v of [process.env.FRONTEND_URL, process.env.SELF_URL, process.env.PUBLIC_API_URL]) {
    if (!v) continue
    try { out.add(new URL(v).origin) } catch { /* variable mal formée : ignorée */ }
  }
  return out
}
