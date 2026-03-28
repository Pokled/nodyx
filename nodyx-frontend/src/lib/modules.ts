/**
 * Nodyx — Frontend module registry (display data only).
 * The backend is authoritative for enabled state.
 * This file provides icon, color, name, description and tags for the UI.
 */

export type ModuleFamily = 'core' | 'community' | 'website' | 'integration'

export type ModuleStatus = 'stable' | 'soon'

export interface ModuleDisplay {
  id:            string
  name:          string
  description:   string
  family:        ModuleFamily
  icon:          string    // emoji
  color:         string    // hex accent
  core:          boolean
  hasPublicFace: boolean
  tags:          string[]
  status:        ModuleStatus
  isNew?:        boolean
}

export const MODULE_DISPLAY: Record<string, ModuleDisplay> = {
  // core
  auth:         { id: 'auth',         name: 'Authentification',  description: 'Inscription, connexion et sessions JWT sécurisées.',                  family: 'core',        icon: '🔐', color: '#374151', core: true,  hasPublicFace: true,  tags: [],                                    status: 'stable' },
  members:      { id: 'members',      name: 'Membres',           description: 'Profils membres, rôles, grades et permissions.',                      family: 'core',        icon: '👥', color: '#374151', core: true,  hasPublicFace: false, tags: [],                                    status: 'stable' },
  forum:        { id: 'forum',        name: 'Forum',             description: 'Forum de discussion principal de la communauté.',                      family: 'core',        icon: '💬', color: '#374151', core: true,  hasPublicFace: true,  tags: [],                                    status: 'stable' },
  admin:        { id: 'admin',        name: 'Administration',    description: "Panneau d'administration complet de l'instance.",                      family: 'core',        icon: '⚙️', color: '#374151', core: true,  hasPublicFace: false, tags: [],                                    status: 'stable' },
  settings:     { id: 'settings',     name: 'Paramètres',        description: "Configuration globale de l'instance Nodyx.",                          family: 'core',        icon: '🎛️', color: '#374151', core: true,  hasPublicFace: false, tags: [],                                    status: 'stable' },

  // community — stable (implemented)
  chat:         { id: 'chat',         name: 'Chat',              description: 'Salons de discussion texte en temps réel.',                            family: 'community',   icon: '⚡', color: '#7c3aed', core: false, hasPublicFace: false, tags: ['gaming', 'sport', 'société'],        status: 'stable' },
  voice:        { id: 'voice',        name: 'Salons vocaux',     description: 'Salons vocaux WebRTC P2P — sans serveur central.',                     family: 'community',   icon: '🎤', color: '#7c3aed', core: false, hasPublicFace: false, tags: ['gaming', 'sport', 'société'],        status: 'stable' },
  canvas:       { id: 'canvas',       name: 'Canvas',            description: 'Tableau blanc CRDT partagé en temps réel (dans les salons vocaux).',   family: 'community',   icon: '🎨', color: '#06b6d4', core: false, hasPublicFace: false, tags: ['gaming', 'créatifs', 'makers'],      status: 'stable' },
  jukebox:      { id: 'jukebox',      name: 'Jukebox',           description: 'Musique partagée P2P avec votes (dans les salons vocaux).',             family: 'community',   icon: '🎵', color: '#06b6d4', core: false, hasPublicFace: false, tags: ['gaming', 'événementiel'],            status: 'stable' },
  calendar:     { id: 'calendar',     name: 'Calendrier',        description: 'Événements partagés avec agenda public/privé.',                        family: 'community',   icon: '📅', color: '#10b981', core: false, hasPublicFace: true,  tags: ['sport', 'coopérative', 'société'],   status: 'stable' },
  polls:        { id: 'polls',        name: 'Sondages',          description: 'Sondages et votes pour impliquer la communauté.',                      family: 'community',   icon: '📊', color: '#10b981', core: false, hasPublicFace: false, tags: ['toutes'],                            status: 'stable' },
  wiki:         { id: 'wiki',         name: 'Wiki',              description: 'Base de connaissances interne éditable par les membres.',              family: 'community',   icon: '📖', color: '#f59e0b', core: false, hasPublicFace: false, tags: ['coopérative', 'société', 'makers'],  status: 'stable', isNew: true },
  dm:           { id: 'dm',           name: 'Messages privés',   description: 'Messages directs chiffrés entre membres.',                             family: 'community',   icon: '🔒', color: '#7c3aed', core: false, hasPublicFace: false, tags: ['toutes'],                            status: 'stable' },
  announcements:{ id: 'announcements',name: 'Annonces',          description: "Tableau d'annonces officielles épinglées en haut de l'instance.",      family: 'community',   icon: '📢', color: '#ef4444', core: false, hasPublicFace: true,  tags: ['toutes'],                            status: 'stable' },
  tasks:        { id: 'tasks',        name: 'Tâches',            description: 'Gestion de tâches légère pour organiser les projets internes.',        family: 'community',   icon: '✅', color: '#10b981', core: false, hasPublicFace: false, tags: ['coopérative', 'société', 'makers'],  status: 'stable' },

  // community — soon (not yet implemented)
  files:        { id: 'files',        name: 'Fichiers',          description: 'Bibliothèque de fichiers partagés pour la communauté.',                family: 'community',   icon: '📁', color: '#f59e0b', core: false, hasPublicFace: false, tags: ['coopérative', 'société', 'sport'],   status: 'soon' },
  leaderboard:  { id: 'leaderboard',  name: 'Classements',       description: 'Classements communautaires et scores personnalisés.',                  family: 'community',   icon: '🏆', color: '#f59e0b', core: false, hasPublicFace: true,  tags: ['gaming', 'sport', 'compétitif'],     status: 'soon' },

  // website — all soon (public homepage builder, Phase 2)
  hero:               { id: 'hero',              name: 'Hero',            description: "Bloc d'accueil avec titre, sous-titre et bouton d'action.", family: 'website', icon: '🏠', color: '#ec4899', core: false, hasPublicFace: true, tags: ['toutes'],                         status: 'soon' },
  news:               { id: 'news',              name: 'Actualités',      description: 'Derniers posts du forum sur la page publique.',              family: 'website', icon: '📰', color: '#ec4899', core: false, hasPublicFace: true, tags: ['toutes'],                         status: 'soon' },
  'events-public':    { id: 'events-public',     name: 'Agenda public',   description: "Calendrier d'événements visible sans compte.",              family: 'website', icon: '🗓️', color: '#ec4899', core: false, hasPublicFace: true, tags: ['sport', 'coopérative'],           status: 'soon' },
  gallery:            { id: 'gallery',           name: 'Galerie',         description: 'Galerie photos et médias publique.',                         family: 'website', icon: '🖼️', color: '#ec4899', core: false, hasPublicFace: true, tags: ['sport', 'nature', 'créatifs'],    status: 'soon' },
  'members-showcase': { id: 'members-showcase',  name: 'Vitrine membres', description: "Présente l'équipe ou les membres phares publiquement.",     family: 'website', icon: '🌟', color: '#ec4899', core: false, hasPublicFace: true, tags: ['sport', 'société'],               status: 'soon' },
  newsletter:         { id: 'newsletter',        name: 'Newsletter',      description: "Formulaire d'abonnement à la newsletter communautaire.",    family: 'website', icon: '✉️', color: '#ec4899', core: false, hasPublicFace: true, tags: ['toutes'],                         status: 'soon' },
  map:                { id: 'map',               name: 'Carte',           description: "Carte de localisation de l'instance ou de la communauté.", family: 'website', icon: '🗺️', color: '#ec4899', core: false, hasPublicFace: true, tags: ['chasse', 'sport', 'local'],       status: 'soon' },
  faq:                { id: 'faq',               name: 'FAQ',             description: 'Page de questions fréquentes accessible publiquement.',      family: 'website', icon: '❓', color: '#ec4899', core: false, hasPublicFace: true, tags: ['toutes'],                         status: 'soon' },
  contact:            { id: 'contact',           name: 'Contact',         description: 'Formulaire de contact public pour les visiteurs.',           family: 'website', icon: '📬', color: '#ec4899', core: false, hasPublicFace: true, tags: ['toutes'],                         status: 'soon' },
  sponsors:           { id: 'sponsors',          name: 'Sponsors',        description: 'Bandeau de logos sponsors et partenaires.',                  family: 'website', icon: '🤝', color: '#ec4899', core: false, hasPublicFace: true, tags: ['sport', 'événementiel'],          status: 'soon' },
  stats:              { id: 'stats',             name: 'Statistiques',    description: 'Compteurs publics : membres actifs, posts, événements.',    family: 'website', icon: '📈', color: '#ec4899', core: false, hasPublicFace: true, tags: ['gaming', 'sport'],                status: 'soon' },

  // integration — all soon
  'rss-import': { id: 'rss-import', name: 'Import RSS',  description: 'Importe des fils RSS comme threads de forum automatiquement.', family: 'integration', icon: '📡', color: '#6b7280', core: false, hasPublicFace: false, tags: ['media', 'société'],  status: 'soon' },
  webhook:      { id: 'webhook',    name: 'Webhooks',     description: "Envoie des événements Nodyx vers des services tiers.",          family: 'integration', icon: '🔗', color: '#6b7280', core: false, hasPublicFace: false, tags: ['société', 'makers'],  status: 'soon' },
  'ical-sync':  { id: 'ical-sync',  name: 'Sync iCal',   description: 'Synchronise le calendrier avec Google Calendar, Outlook…',     family: 'integration', icon: '🔄', color: '#6b7280', core: false, hasPublicFace: false, tags: ['sport', 'société'],   status: 'soon' },
}

export const FAMILY_META: Record<ModuleFamily, { label: string; description: string; accent: string }> = {
  core:        { label: 'Core',          description: 'Toujours actifs — fondations de chaque instance.',          accent: '#374151' },
  community:   { label: 'Communauté',    description: 'Outils internes activables selon votre communauté.',        accent: '#7c3aed' },
  website:     { label: 'Site public',   description: 'Widgets pour construire la vitrine publique de l\'instance.', accent: '#ec4899' },
  integration: { label: 'Intégrations',  description: 'Connexions avec des services et protocoles externes.',       accent: '#6b7280' },
}

export const FAMILY_ORDER: ModuleFamily[] = ['core', 'community', 'website', 'integration']
