export interface NavItem {
  title: string
  slug:  string
  badge?: string
}

export interface NavSection {
  title: string
  icon:  string
  items: NavItem[]
}

export const nav: NavSection[] = [
  {
    title: 'Get Started',
    icon:  'rocket',
    items: [
      { title: 'Introduction',   slug: 'readme'         },
      { title: 'Installation',   slug: 'install'        },
      { title: 'Tunnel Install', slug: 'install-tunnel', badge: 'New' },
      { title: 'Domain & DNS',   slug: 'domain'         },
      { title: 'Email (SMTP)',   slug: 'email'          },
    ],
  },
  {
    title: 'Architecture',
    icon:  'layers',
    items: [
      { title: 'Overview',       slug: 'architecture'   },
      { title: 'Relay & P2P',    slug: 'relay'          },
      { title: 'Audio & Voice',  slug: 'audio'          },
      { title: 'Neural Engine',  slug: 'neural-engine'  },
    ],
  },
  {
    title: 'Module System',
    icon:  'layers',
    items: [
      { title: 'Module System Overview', slug: 'module-system', badge: 'v2.2' },
    ],
  },
  {
    title: 'Widget SDK',
    icon:  'puzzle',
    items: [
      { title: 'Create Your First Widget', slug: 'create-widget', badge: 'New' },
    ],
  },
  {
    title: 'Community',
    icon:  'users',
    items: [
      { title: 'Manifesto',      slug: 'manifesto'    },
      { title: 'Contributing',   slug: 'contributing' },
      { title: 'Thanks',         slug: 'thanks'       },
      { title: 'AI Usage',       slug: 'ai-usage'     },
    ],
  },
  {
    title: 'Roadmap',
    icon:  'map',
    items: [
      { title: 'Roadmap',                  slug: 'roadmap'                           },
      { title: 'User Profiles',            slug: 'specs/002-user-profiles'           },
      { title: 'Grades & Roles',           slug: 'specs/003-grades'                  },
      { title: 'Social Widgets',           slug: 'specs/004-social-widgets'          },
      { title: 'Salon Audio',              slug: 'specs/005-salon-audio'             },
      { title: 'Global Search',            slug: 'specs/010-nodyx-global-search'     },
      { title: 'Event Calendar',           slug: 'specs/011-nodyx-event-calendar'    },
      { title: 'Galaxy Bar',               slug: 'specs/012-nodyx-galaxy-bar'        },
      { title: 'Node Genesis',             slug: 'specs/013-node'                    },
    ],
  },
]

// Flat list for search + prev/next
export const allPages: NavItem[] = nav.flatMap(s => s.items)

export function findPage(slug: string): NavItem | undefined {
  return allPages.find(p => p.slug === slug)
}

export function prevNext(slug: string): { prev?: NavItem; next?: NavItem } {
  const idx = allPages.findIndex(p => p.slug === slug)
  if (idx < 0) return {}
  return {
    prev: idx > 0              ? allPages[idx - 1] : undefined,
    next: idx < allPages.length - 1 ? allPages[idx + 1] : undefined,
  }
}

// Map slug → actual filename in /docs/en/
export function slugToFile(slug: string): string {
  if (slug.startsWith('specs/')) {
    const parts = slug.split('/')
    return `specs/${parts[1]}/SPEC.md`
  }
  return `${slug.toUpperCase().replace(/-/g, '-')}.md`
}
