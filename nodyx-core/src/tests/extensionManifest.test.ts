import { describe, it, expect } from 'vitest'
import {
  validateManifest, collectMessageKeys, parseSize, isSafePackagePath,
  type ExtensionManifest,
} from '../extensions/manifest'
import { requestedCapabilities, sensitiveCapabilities } from '../extensions/capabilities'

// Manifeste minimal valide : le socle de tous les cas négatifs ci dessous.
function base(): Record<string, unknown> {
  return {
    api: 1,
    id: 'my-widget',
    version: '1.0.0',
    license: 'MIT',
    default_locale: 'en',
    label: '@label',
    description: '@description',
    surfaces: [
      { type: 'widget', id: 'main', entry: 'ui/widget.js', label: '@label' },
    ],
  }
}

function issues(raw: unknown): string[] {
  const r = validateManifest(raw)
  return r.ok ? [] : r.issues.map(i => i.code)
}

describe('validateManifest, cas nominal', () => {
  it('accepte le manifeste minimal', () => {
    const r = validateManifest(base())
    expect(r.ok).toBe(true)
  })

  it('accepte un manifeste complet, deux surfaces et toutes les permissions', () => {
    const m = {
      ...base(),
      id: 'library',
      nodyx_min: '2.13.0',
      author: { name: 'Nodyx', url: 'https://nodyx.org' },
      source: 'https://github.com/Pokled/nodyx',
      icon: 'icon.svg',
      family: 'content',
      surfaces: [
        {
          type: 'page', path: 'library', entry: 'ui/page.js',
          nav: { label: '@nav.label', icon: 'twemoji:clapper-board', position: 'main' },
        },
        {
          type: 'widget', id: 'tonight', entry: 'ui/tonight.js', label: '@widget.tonight',
          default_height: 320,
          schema: [
            { key: 'mood', type: 'select', label: '@field.mood', options: [{ value: 'learn', label: '@mood.learn' }] },
            { key: 'compact', type: 'boolean', label: '@field.compact', default: true },
          ],
        },
      ],
      permissions: {
        identity: ['id', 'username'],
        storage: { user: '1mb', instance: '8mb', instance_write: true },
        core: ['members:read'],
        network: {
          'api.themoviedb.org': { methods: ['GET'], paths: ['/3/movie/*'], secret: 'TMDB_API_KEY', rate: '60/min' },
        },
      },
    }
    const r = validateManifest(m)
    if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues, null, 2))
    expect(r.manifest.id).toBe('library')
  })
})

describe('rupture avec le format antérieur', () => {
  it('refuse un manifeste sans api, avec un code dédié', () => {
    const { api, ...noApi } = base()
    expect(issues(noApi)).toContain('API_VERSION_MISSING')
  })

  it('refuse une version d api que cette instance n implémente pas', () => {
    expect(issues({ ...base(), api: 2 })).toContain('API_VERSION_UNSUPPORTED')
  })

  it('refuse le type de champ checkbox et nomme le remplacement', () => {
    const m = base()
    ;(m.surfaces as Record<string, unknown>[])[0].schema = [{ key: 'on', type: 'checkbox', label: '@f' }]
    const r = validateManifest(m)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const issue = r.issues.find(i => i.code === 'FIELD_TYPE_CHECKBOX')
    expect(issue).toBeDefined()
    expect(issue!.message).toContain('boolean')
  })
})

describe('domaine réservé', () => {
  it.each(['hero-banner', 'twitch-stream', 'stats-bar', 'nodyx', 'nodyx-quoi-que-ce-soit'])(
    'refuse l identifiant réservé %s', (id) => {
      expect(issues({ ...base(), id })).toContain('RESERVED_ID')
    })

  it('laisse passer video-player, qui reste une extension', () => {
    // D7 révisé le 2026-08-14 : le lecteur est l'exemple de référence du SDK,
    // il n'est pas passé natif, donc son identifiant n'est PAS réservé.
    const r = validateManifest({ ...base(), id: 'video-player' })
    expect(r.ok).toBe(true)
  })
})

describe('rien n est nettoyé en silence', () => {
  it('refuse un champ racine inconnu', () => {
    expect(issues({ ...base(), permision: {} })).toContain('UNKNOWN_FIELD')
  })

  it('refuse une permission inconnue plutôt que de l ignorer', () => {
    expect(issues({ ...base(), permissions: { filesystem: true } })).toContain('UNKNOWN_FIELD')
  })

  it('refuse une portée core hors de la liste', () => {
    expect(issues({ ...base(), permissions: { core: ['members:write'] } }).length).toBeGreaterThan(0)
  })

  it('refuse un champ de surface inconnu', () => {
    const m = base()
    ;(m.surfaces as Record<string, unknown>[])[0].height = 300
    expect(issues(m).length).toBeGreaterThan(0)
  })
})

describe('identité et forme', () => {
  it.each(['A-widget', 'ab', 'my_widget', '1widget', 'x'.repeat(40)])('refuse l identifiant %s', (id) => {
    expect(issues({ ...base(), id })).not.toHaveLength(0)
  })

  it.each(['1.0', 'v1.0.0', '1.0.0-beta'])('refuse la version %s', (version) => {
    expect(issues({ ...base(), version })).not.toHaveLength(0)
  })

  it('exige une licence', () => {
    const { license, ...noLicense } = base()
    expect(issues(noLicense).length).toBeGreaterThan(0)
  })

  it('exige au moins une surface', () => {
    expect(issues({ ...base(), surfaces: [] }).length).toBeGreaterThan(0)
  })
})

describe('vitrine : tagline + captures', () => {
  it('accepte tagline + jusqu à 6 captures empaquetées', () => {
    const r = validateManifest({
      ...base(),
      tagline: '@tagline',
      screenshots: ['media/1.png', 'media/2.webp', 'shots/3.jpg'],
    })
    expect(r.ok).toBe(true)
  })

  it('collecte la tagline comme clé de message', () => {
    const r = validateManifest({ ...base(), tagline: '@game.tagline' })
    if (!r.ok) throw new Error('refusé')
    expect(collectMessageKeys(r.manifest)).toContain('game.tagline')
  })

  it('refuse une capture qui remonte hors du paquet', () => {
    expect(issues({ ...base(), screenshots: ['../secret.png'] }).length).toBeGreaterThan(0)
  })

  it('refuse plus de 6 captures', () => {
    expect(issues({ ...base(), screenshots: Array(7).fill('media/x.png') }).length).toBeGreaterThan(0)
  })
})

describe('i18n : toute chaîne visible est une clé', () => {
  it('refuse un libellé écrit en dur', () => {
    expect(issues({ ...base(), label: 'Mon widget' }).length).toBeGreaterThan(0)
  })

  it('refuse un libellé de champ écrit en dur', () => {
    const m = base()
    ;(m.surfaces as Record<string, unknown>[])[0].schema = [{ key: 'a', type: 'text', label: 'Titre' }]
    expect(issues(m).length).toBeGreaterThan(0)
  })

  it('exige une locale par défaut bien formée', () => {
    expect(issues({ ...base(), default_locale: 'anglais' }).length).toBeGreaterThan(0)
  })

  it('collecte toutes les clés référencées, sans le @, dédoublonnées et triées', () => {
    const m = base()
    ;(m.surfaces as Record<string, unknown>[])[0].schema = [
      { key: 'mood', type: 'select', label: '@field.mood', hint: '@field.mood.hint', options: [{ value: 'a', label: '@mood.a' }] },
    ]
    const r = validateManifest(m)
    if (!r.ok) throw new Error('refusé à tort')
    expect(r.messageKeys).toEqual(['description', 'field.mood', 'field.mood.hint', 'label', 'mood.a'])
  })
})

describe('surfaces', () => {
  it('refuse un widget sans identifiant', () => {
    expect(issues({ ...base(), surfaces: [{ type: 'widget', entry: 'ui/w.js', label: '@l' }] }).length).toBeGreaterThan(0)
  })

  it('refuse une page sans chemin', () => {
    expect(issues({ ...base(), surfaces: [{ type: 'page', entry: 'ui/p.js' }] }).length).toBeGreaterThan(0)
  })

  it('refuse un schéma de configuration sur une page', () => {
    expect(issues({ ...base(), surfaces: [{ type: 'page', path: 'x', entry: 'ui/p.js', schema: [] }] }).length).toBeGreaterThan(0)
  })

  it('refuse deux widgets de même identifiant', () => {
    const s = { type: 'widget', id: 'main', entry: 'ui/w.js', label: '@l' }
    expect(issues({ ...base(), surfaces: [s, { ...s }] })).toContain('DUPLICATE_SURFACE_ID')
  })

  it('refuse deux clés de configuration identiques', () => {
    const m = base()
    ;(m.surfaces as Record<string, unknown>[])[0].schema = [
      { key: 'a', type: 'text', label: '@a' },
      { key: 'a', type: 'text', label: '@b' },
    ]
    expect(issues(m)).toContain('DUPLICATE_FIELD_KEY')
  })

  it('refuse un select sans options', () => {
    const m = base()
    ;(m.surfaces as Record<string, unknown>[])[0].schema = [{ key: 'a', type: 'select', label: '@a' }]
    expect(issues(m)).toContain('SELECT_WITHOUT_OPTIONS')
  })
})

describe('surface activity + bundle applicatif', () => {
  const SHA = 'a'.repeat(64)
  const APP = { url: 'https://github.com/Pokled/nodyx-battle/releases/download/v0.3.0/app.zip', sha256: SHA, bytes: 54_000_000 }
  const activity = (over: Record<string, unknown> = {}, appOver: Record<string, unknown> | null = {}) => {
    const m: Record<string, unknown> = {
      ...base(),
      surfaces: [{ type: 'activity', id: 'battle', entry: 'index.html', label: '@label', ...over }],
    }
    if (appOver !== null) m.app = { ...APP, ...appOver }
    return m
  }

  it('accepte une activité avec un bundle app https/public', () => {
    const r = validateManifest(activity())
    if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues, null, 2))
    expect(r.manifest.surfaces[0].type).toBe('activity')
    expect(r.manifest.app?.sha256).toBe(SHA)
  })

  it('refuse un entry qui ne finit pas par .html', () => {
    expect(issues(activity({ entry: 'main.js' })).length).toBeGreaterThan(0)
  })

  it('refuse un entry remontant', () => {
    expect(issues(activity({ entry: '../escape.html' })).length).toBeGreaterThan(0)
  })

  it('refuse une activité SANS champ app', () => {
    expect(issues(activity({}, null))).toContain('ACTIVITY_WITHOUT_APP')
  })

  it('refuse un champ app SANS surface activity', () => {
    expect(issues({ ...base(), app: APP })).toContain('APP_WITHOUT_ACTIVITY')
  })

  it('refuse app.url non-https', () => {
    expect(issues(activity({}, { url: 'http://evil.example/app.zip' })).length).toBeGreaterThan(0)
  })

  it('refuse app.url loopback', () => {
    expect(issues(activity({}, { url: 'https://127.0.0.1/app.zip' })).length).toBeGreaterThan(0)
  })

  it('refuse une empreinte sha256 mal formée', () => {
    expect(issues(activity({}, { sha256: 'pas-hex' })).length).toBeGreaterThan(0)
  })

  it('refuse deux activités de même identifiant', () => {
    const s = { type: 'activity', id: 'battle', entry: 'index.html', label: '@label' }
    expect(issues({ ...base(), app: APP, surfaces: [s, { ...s }] })).toContain('DUPLICATE_SURFACE_ID')
  })

  it('collecte les clés de message de l\'activité', () => {
    const r = validateManifest(activity({ label: '@a.title', description: '@a.blurb' }))
    if (!r.ok) throw new Error('refusé')
    expect(collectMessageKeys(r.manifest)).toEqual(expect.arrayContaining(['a.title', 'a.blurb']))
  })

  it('realtime accepté avec activity, refusé sans', () => {
    expect(validateManifest({ ...activity(), permissions: { realtime: true } }).ok).toBe(true)
    expect(issues({ ...base(), permissions: { realtime: true } })).toContain('REALTIME_WITHOUT_ACTIVITY')
  })

  it('accepte le stockage (records perso + classement) sur une activité', () => {
    const r = validateManifest({
      ...activity(),
      permissions: { storage: { user: '16kb', instance: '64kb', instance_write: true } },
    })
    if (!r.ok) throw new Error('refusé : ' + JSON.stringify(r.issues))
    expect(requestedCapabilities(r.manifest)).toEqual(expect.arrayContaining([
      'storage.user', 'storage.instance.read', 'storage.instance.write',
    ]))
    expect(sensitiveCapabilities(r.manifest)).toContain('storage.instance.write')
  })
})

describe('points d entrée, aucune remontée de chemin', () => {
  it.each([
    '../../etc/passwd.js',
    '/absolute/widget.js',
    'ui\\widget.js',
    'ui/../../escape.js',
    'ui/widget.mjs',
    'widget.js.png',
  ])('refuse le point d entrée %s', (entry) => {
    expect(issues({ ...base(), surfaces: [{ type: 'widget', id: 'a', entry, label: '@l' }] }).length).toBeGreaterThan(0)
  })

  it('accepte un point d entrée sain', () => {
    expect(validateManifest({ ...base(), surfaces: [{ type: 'widget', id: 'a', entry: 'ui/widget.js', label: '@l' }] }).ok).toBe(true)
  })
})

describe('permissions réseau', () => {
  it('refuse un hôte nu, sans méthodes ni chemins', () => {
    expect(issues({ ...base(), permissions: { network: { 'api.example.com': true } } })).toContain('NETWORK_HOST_WITHOUT_RULE')
  })

  it('refuse une liste d hôtes, forme de l ancien format', () => {
    expect(issues({ ...base(), permissions: { network: ['api.example.com'] } }).length).toBeGreaterThan(0)
  })

  it.each([
    'https://api.example.com',
    'api.example.com:8443',
    'api.example.com/v1',
    '10.0.0.999',
  ])('refuse l hôte mal formé %s', (host) => {
    expect(issues({ ...base(), permissions: { network: { [host]: { methods: ['GET'], paths: ['/'] } } } })).toContain('NETWORK_HOST_INVALID')
  })

  // Une instance peut vivre en intranet, sur un reseau domestique, ou sur une
  // simple adresse IP sans nom de domaine. On ne ferme pas la porte, on
  // demande l'accord de l'admin. Seule la machine de l'instance elle meme
  // reste hors de portee.
  it.each(['10.0.0.5', '192.168.1.50', '172.16.4.4', '100.64.0.9', 'inventaire.local', 'srv.internal', 'nas.lan'])(
    'accepte l hôte privé %s, en le signalant a l admin', (host) => {
      const r = validateManifest({ ...base(), permissions: { network: { [host]: { methods: ['GET'], paths: ['/api'] } } } })
      if (!r.ok) throw new Error('refusé à tort : ' + JSON.stringify(r.issues))
      expect(r.privateNetworkHosts).toEqual([host])
    })

  it.each(['127.0.0.1', '127.1.2.3', 'localhost', 'app.localhost', '169.254.169.254', '0.0.0.0', '224.0.0.1'])(
    'refuse toujours %s, qui vise la machine de l instance', (host) => {
      expect(issues({ ...base(), permissions: { network: { [host]: { methods: ['GET'], paths: ['/'] } } } })).toContain('NETWORK_HOST_FORBIDDEN')
    })

  it('ne signale rien quand tous les hôtes sont publics', () => {
    const r = validateManifest({ ...base(), permissions: { network: { 'api.themoviedb.org': { methods: ['GET'], paths: ['/3/'] } } } })
    if (!r.ok) throw new Error('refusé à tort')
    expect(r.privateNetworkHosts).toEqual([])
  })

  it('refuse une méthode inconnue', () => {
    expect(issues({ ...base(), permissions: { network: { 'a.example.com': { methods: ['FETCH'], paths: ['/'] } } } }).length).toBeGreaterThan(0)
  })

  it('refuse un chemin qui ne commence pas par une barre', () => {
    expect(issues({ ...base(), permissions: { network: { 'a.example.com': { methods: ['GET'], paths: ['v1/x'] } } } }).length).toBeGreaterThan(0)
  })
})

describe('permissions de stockage', () => {
  it('refuse un quota au dessus du plafond de l instance', () => {
    expect(issues({ ...base(), permissions: { storage: { user: '999mb' } } })).toContain('STORAGE_QUOTA_TOO_LARGE')
  })

  it('refuse une taille mal formée', () => {
    expect(issues({ ...base(), permissions: { storage: { user: '1 Mo' } } }).length).toBeGreaterThan(0)
  })

  it('refuse l écriture partagée sans portée partagée déclarée', () => {
    expect(issues({ ...base(), permissions: { storage: { user: '1mb', instance_write: true } } })).toContain('STORAGE_WRITE_WITHOUT_SCOPE')
  })
})

describe('outils', () => {
  it('parseSize comprend kb et mb, et refuse le reste', () => {
    expect(parseSize('512kb')).toBe(524288)
    expect(parseSize('8mb')).toBe(8388608)
    expect(parseSize('8 mb')).toBeNull()
    expect(parseSize('8gb')).toBeNull()
  })

  it('isSafePackagePath refuse les remontées et les chemins absolus', () => {
    expect(isSafePackagePath('ui/widget.js')).toBe(true)
    expect(isSafePackagePath('../x.js')).toBe(false)
    expect(isSafePackagePath('/x.js')).toBe(false)
    expect(isSafePackagePath('a/../../b.js')).toBe(false)
  })
})

describe('le manifeste n est pas un objet', () => {
  it.each([null, 42, 'texte', []])('refuse %p', (raw) => {
    expect(issues(raw)).toContain('MANIFEST_NOT_AN_OBJECT')
  })
})

describe('cumul des refus', () => {
  it('rend plusieurs problèmes d un coup, pour ne pas faire corriger un par un', () => {
    const r = validateManifest({ api: 1, id: 'A', version: 'x', label: 'dur', surfaces: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.length).toBeGreaterThan(3)
  })
})

describe('typage', () => {
  it('rend un manifeste typé après validation', () => {
    const r = validateManifest(base())
    if (!r.ok) throw new Error('refusé à tort')
    const m: ExtensionManifest = r.manifest
    expect(collectMessageKeys(m)).toContain('label')
  })
})
