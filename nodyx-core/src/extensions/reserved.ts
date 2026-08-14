// Identifiants réservés au domaine natif.
//
// Une extension portant l'un de ces identifiants est REFUSÉE à l'installation.
// Ce n'est pas « le natif gagne à l'affichage » (comportement actuel de
// catalog.ts, qui masque la collision sans l'empêcher) : c'est un refus net,
// pour qu'un widget installé ne puisse jamais prendre l'identité d'un widget
// livré avec Nodyx.
//
// Miroir de PLUGIN_REGISTRY côté frontend
// (nodyx-frontend/src/lib/components/homepage/plugins/index.ts).
// Toute addition là bas doit être répercutée ici.

export const RESERVED_EXTENSION_IDS: ReadonlySet<string> = new Set([
  'hero-banner',
  'header',
  'stats-bar',
  'join-card',
  'announcement-banner',
  'article-slideshow',
  'articles-showcase',
  'recent-threads',
  'social-links-bar',
  'twitch-stream',
  // Préfixes de service, réservés pour éviter toute confusion d'origine
  'nodyx',
  'core',
  'admin',
])

export function isReservedExtensionId(id: string): boolean {
  return RESERVED_EXTENSION_IDS.has(id) || id.startsWith('nodyx-')
}
