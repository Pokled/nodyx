// ─── Les sous-domaines que personne ne doit pouvoir réserver ─────────────────
//
// Une instance inscrite au slug `x` revendique `x.nodyx.org`. Or plusieurs
// sous-domaines portent déjà de l'infrastructure : le panneau d'administration,
// la documentation, la médiathèque, le relais lui-même.
//
// Mesuré le 2026-08-20 : la validation du slug était **purement formelle**
// (`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`), sans aucune liste de réservation.
// N'importe qui pouvait donc inscrire `olympus`, `relay` ou `tunnel`.
//
// CE QUE ÇA NE PERMETTAIT PAS. Caddy évalue ses routes dans l'ordre et les hôtes
// explicites précèdent le générique `*.nodyx.org` : une inscription ne
// détournait donc aucun trafic. Vérifié sur la configuration vivante.
//
// CE QUE ÇA PERMETTAIT QUAND MÊME, et qui suffit à justifier cette liste :
//   - une entrée trompeuse dans l'annuaire PUBLIC, annonçant une communauté à
//     une adresse qui est en réalité notre panneau d'administration ;
//   - une instance qui ne fonctionnerait jamais, sans que son propriétaire
//     puisse comprendre pourquoi, puisque Caddy l'ignore silencieusement.
//
// Les noms déjà inscrits (`demo`, `sleemstudio`, `vieuxlooters`) sont de toute
// façon protégés par le conflit de slug existant, qui répond 409. Cette liste
// s'applique AVANT lui, pour donner un message qui explique au lieu de laisser
// croire à une course perdue.

/** Sous-domaines portant de l'infrastructure, ou qui en porteront. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Routes explicites servies par Caddy aujourd'hui.
  'code', 'demo', 'extensions', 'library', 'olympus', 'signet',
  'sleemstudio', 'start', 'vieuxlooters',

  // Le relais et ses portes. `tunnel` est réservé AVANT que l'endpoint
  // n'existe : le contraire serait une course.
  'relay', 'relay6', 'tunnel',

  // Noms d'infrastructure usuels, qu'une communauté ne doit jamais porter.
  'admin', 'api', 'assets', 'cdn', 'mail', 'ns1', 'ns2', 'static', 'status',
  'support', 'www',
])

/** Le slug est-il réservé ? La comparaison est insensible à la casse. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase())
}
