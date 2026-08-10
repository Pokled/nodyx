// PLUGIN_REGISTRY — source de vérité unique pour tous les widgets homepage
// Pour ajouter un widget : créer son fichier plugin + l'importer ici. C'est tout.

import type { WidgetPlugin } from './_types'

// Phase 1 — disponibles
import heroBanner         from './hero-banner'
import header             from './header'
import statsBar           from './stats-bar'
import joinCard           from './join-card'
import announcementBanner from './announcement-banner'
import articleSlideshow   from './article-slideshow'
import articlesShowcase   from './articles-showcase'
import recentThreads      from './recent-threads'
import socialLinksBar     from './social-links-bar'
import twitchStream       from './twitch-stream'

export const PLUGIN_REGISTRY: Record<string, WidgetPlugin> = {
	[heroBanner.id]:         heroBanner,
	[header.id]:             header,
	[statsBar.id]:           statsBar,
	[joinCard.id]:           joinCard,
	[announcementBanner.id]: announcementBanner,
	[articleSlideshow.id]:   articleSlideshow,
	[articlesShowcase.id]:   articlesShowcase,
	[recentThreads.id]:      recentThreads,
	[socialLinksBar.id]:     socialLinksBar,
	[twitchStream.id]:       twitchStream,
}

// Liste ordonnée pour le catalogue admin (phases croissantes, puis alphabétique)
export const PLUGIN_LIST: WidgetPlugin[] = Object.values(PLUGIN_REGISTRY)
	.sort((a, b) => a.phase - b.phase || a.label.localeCompare(b.label))

export type { WidgetPlugin, FieldSchema, WidgetFamily, WidgetPhase } from './_types'
