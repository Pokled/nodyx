/**
 * NODYX — Module Registry
 * Authoritative list of all Nodyx modules with their manifest data.
 * The DB stores enabled state + config; this file stores identity + metadata.
 *
 * Rules:
 *  - `core: true`  → non-disableable, always seeded as enabled
 *  - `core: false` → admin can toggle on/off from the Module Manager
 *  - `tags`        → community types this module is designed for (display only)
 *  - `isNew`       → shows a "NOUVEAU" badge in the Module Manager
 */

export type ModuleFamily = 'core' | 'community' | 'website' | 'integration'

export interface ModuleManifest {
  id:             string
  name:           string
  description:    string
  family:         ModuleFamily
  icon:           string        // emoji
  color:          string        // hex accent for the icon badge
  core:           boolean
  hasPublicFace:  boolean       // exposes public (unauthenticated) routes
  tags:           string[]      // community types ("gaming", "sport", etc.)
  isNew?:         boolean
}

export const MODULE_REGISTRY: Record<string, ModuleManifest> = {

  // ── Core ────────────────────────────────────────────────────────────────────

  auth: {
    id: 'auth', name: 'Authentification',
    description: 'Inscription, connexion et sessions JWT sécurisées.',
    family: 'core', icon: '🔐', color: '#374151',
    core: true, hasPublicFace: true, tags: [],
  },
  members: {
    id: 'members', name: 'Membres',
    description: 'Profils membres, rôles, grades et permissions.',
    family: 'core', icon: '👥', color: '#374151',
    core: true, hasPublicFace: false, tags: [],
  },
  forum: {
    id: 'forum', name: 'Forum',
    description: 'Forum de discussion principal de la communauté.',
    family: 'core', icon: '💬', color: '#374151',
    core: true, hasPublicFace: true, tags: [],
  },
  admin: {
    id: 'admin', name: 'Administration',
    description: "Panneau d'administration complet de l'instance.",
    family: 'core', icon: '⚙️', color: '#374151',
    core: true, hasPublicFace: false, tags: [],
  },
  settings: {
    id: 'settings', name: 'Paramètres',
    description: "Configuration globale de l'instance Nodyx.",
    family: 'core', icon: '🎛️', color: '#374151',
    core: true, hasPublicFace: false, tags: [],
  },

  // ── Community ───────────────────────────────────────────────────────────────

  chat: {
    id: 'chat', name: 'Chat',
    description: 'Salons de discussion texte en temps réel.',
    family: 'community', icon: '⚡', color: '#7c3aed',
    core: false, hasPublicFace: false, tags: ['gaming', 'sport', 'société'],
  },
  voice: {
    id: 'voice', name: 'Salons vocaux',
    description: 'Salons vocaux WebRTC P2P — sans serveur central.',
    family: 'community', icon: '🎤', color: '#7c3aed',
    core: false, hasPublicFace: false, tags: ['gaming', 'sport', 'société'],
  },
  canvas: {
    id: 'canvas', name: 'Canvas collaboratif',
    description: 'Tableau blanc CRDT partagé en temps réel.',
    family: 'community', icon: '🎨', color: '#06b6d4',
    core: false, hasPublicFace: false, tags: ['gaming', 'créatifs', 'makers'],
  },
  jukebox: {
    id: 'jukebox', name: 'Jukebox',
    description: 'Musique partagée P2P avec votes de la communauté.',
    family: 'community', icon: '🎵', color: '#06b6d4',
    core: false, hasPublicFace: false, tags: ['gaming', 'événementiel'],
  },
  calendar: {
    id: 'calendar', name: 'Calendrier',
    description: 'Événements partagés avec agenda public/privé.',
    family: 'community', icon: '📅', color: '#10b981',
    core: false, hasPublicFace: true, tags: ['sport', 'coopérative', 'société'],
  },
  polls: {
    id: 'polls', name: 'Sondages',
    description: 'Sondages et votes pour impliquer la communauté.',
    family: 'community', icon: '📊', color: '#10b981',
    core: false, hasPublicFace: false, tags: ['toutes'],
  },
  wiki: {
    id: 'wiki', name: 'Wiki',
    description: 'Base de connaissances interne éditable par les membres.',
    family: 'community', icon: '📖', color: '#f59e0b',
    core: false, hasPublicFace: false, tags: ['coopérative', 'société', 'makers'],
    isNew: true,
  },
  files: {
    id: 'files', name: 'Fichiers',
    description: 'Bibliothèque de fichiers partagés pour la communauté.',
    family: 'community', icon: '📁', color: '#f59e0b',
    core: false, hasPublicFace: false, tags: ['coopérative', 'société', 'sport'],
  },
  dm: {
    id: 'dm', name: 'Messages privés',
    description: 'Messages directs chiffrés entre membres.',
    family: 'community', icon: '🔒', color: '#7c3aed',
    core: false, hasPublicFace: false, tags: ['toutes'],
  },
  announcements: {
    id: 'announcements', name: 'Annonces',
    description: "Tableau d'annonces officielles épinglées en haut de l'instance.",
    family: 'community', icon: '📢', color: '#ef4444',
    core: false, hasPublicFace: true, tags: ['toutes'],
  },
  leaderboard: {
    id: 'leaderboard', name: 'Classements',
    description: 'Classements communautaires et scores personnalisés.',
    family: 'community', icon: '🏆', color: '#f59e0b',
    core: false, hasPublicFace: true, tags: ['gaming', 'sport', 'compétitif'],
  },
  tasks: {
    id: 'tasks', name: 'Tâches',
    description: 'Gestion de tâches légère pour organiser les projets internes.',
    family: 'community', icon: '✅', color: '#10b981',
    core: false, hasPublicFace: false, tags: ['coopérative', 'société', 'makers'],
  },

  // ── Website (public face) ────────────────────────────────────────────────────

  hero: {
    id: 'hero', name: 'Hero',
    description: "Bloc d'accueil avec titre, sous-titre et bouton d'action.",
    family: 'website', icon: '🏠', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['toutes'],
  },
  news: {
    id: 'news', name: 'Actualités',
    description: 'Derniers posts du forum affichés sur la page publique.',
    family: 'website', icon: '📰', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['toutes'],
  },
  'events-public': {
    id: 'events-public', name: 'Agenda public',
    description: "Calendrier d'événements visible sans compte.",
    family: 'website', icon: '🗓️', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['sport', 'coopérative', 'événementiel'],
  },
  gallery: {
    id: 'gallery', name: 'Galerie',
    description: 'Galerie photos et médias publique.',
    family: 'website', icon: '🖼️', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['sport', 'nature', 'créatifs'],
  },
  'members-showcase': {
    id: 'members-showcase', name: 'Vitrine membres',
    description: "Présente l'équipe ou les membres phares publiquement.",
    family: 'website', icon: '🌟', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['sport', 'société'],
  },
  newsletter: {
    id: 'newsletter', name: 'Newsletter',
    description: "Formulaire d'abonnement à la newsletter communautaire.",
    family: 'website', icon: '✉️', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['toutes'],
  },
  map: {
    id: 'map', name: 'Carte',
    description: "Carte de localisation de l'instance ou de la communauté.",
    family: 'website', icon: '🗺️', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['chasse', 'sport', 'local'],
  },
  faq: {
    id: 'faq', name: 'FAQ',
    description: 'Page de questions fréquentes accessible publiquement.',
    family: 'website', icon: '❓', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['toutes'],
  },
  contact: {
    id: 'contact', name: 'Contact',
    description: 'Formulaire de contact public pour les visiteurs.',
    family: 'website', icon: '📬', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['toutes'],
  },
  sponsors: {
    id: 'sponsors', name: 'Sponsors',
    description: 'Bandeau de logos sponsors et partenaires.',
    family: 'website', icon: '🤝', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['sport', 'événementiel'],
  },
  stats: {
    id: 'stats', name: 'Statistiques',
    description: 'Compteurs publics : membres actifs, posts, événements.',
    family: 'website', icon: '📈', color: '#ec4899',
    core: false, hasPublicFace: true, tags: ['gaming', 'sport'],
  },

  // ── Integration ──────────────────────────────────────────────────────────────

  'rss-import': {
    id: 'rss-import', name: 'Import RSS',
    description: 'Importe des fils RSS comme threads de forum automatiquement.',
    family: 'integration', icon: '📡', color: '#6b7280',
    core: false, hasPublicFace: false, tags: ['media', 'société'],
  },
  webhook: {
    id: 'webhook', name: 'Webhooks',
    description: "Envoie des événements Nodyx vers des services tiers (Zapier, n8n…).",
    family: 'integration', icon: '🔗', color: '#6b7280',
    core: false, hasPublicFace: false, tags: ['société', 'makers'],
  },
  'ical-sync': {
    id: 'ical-sync', name: 'Sync iCal',
    description: 'Synchronise le calendrier avec Google Calendar, Outlook, etc.',
    family: 'integration', icon: '🔄', color: '#6b7280',
    core: false, hasPublicFace: false, tags: ['sport', 'société'],
  },
}

export const MODULE_FAMILIES: { id: ModuleFamily; label: string }[] = [
  { id: 'core',        label: 'Core' },
  { id: 'community',   label: 'Communauté' },
  { id: 'website',     label: 'Site public' },
  { id: 'integration', label: 'Intégrations' },
]
