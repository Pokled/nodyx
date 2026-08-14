import { describe, it, expect } from 'vitest'
import {
  checkTarget, pathAllowed, addressAllowed, isPrivateAddress, isPrivateIPv4, isPrivateIPv6,
  filterRequestHeaders, filterResponseHeaders, applySecret, declaredTooLarge,
  type GrantedNetwork,
} from '../extensions/net'

const GRANTED: GrantedNetwork = {
  'api.themoviedb.org': { methods: ['GET'], paths: ['/3/movie/*', '/3/search/movie'], secret: 'TMDB_API_KEY' },
  'inventaire.local':   { methods: ['GET', 'POST'], paths: ['/api/*'] },
}

const check = (url: string, method = 'GET') => checkTarget(url, method, GRANTED)
const code  = (url: string, method = 'GET') => { const r = check(url, method); return r.ok ? null : r.code }

describe('ce qui a ete accorde, et rien d autre', () => {
  it('laisse passer une cible declaree', () => {
    const r = check('https://api.themoviedb.org/3/movie/603')
    if (!r.ok) throw new Error('refuse a tort : ' + r.code)
    expect(r.value.host).toBe('api.themoviedb.org')
    expect(r.value.method).toBe('GET')
  })

  it('refuse un hote non accorde', () => {
    expect(code('https://evil.example/collecte')).toBe('HOST_NOT_ALLOWED')
  })

  it('refuse une methode non declaree', () => {
    expect(code('https://api.themoviedb.org/3/movie/603', 'DELETE')).toBe('METHOD_NOT_ALLOWED')
  })

  it('refuse un chemin hors des prefixes declares', () => {
    expect(code('https://api.themoviedb.org/3/account/secret')).toBe('PATH_NOT_ALLOWED')
    expect(code('https://api.themoviedb.org/4/list')).toBe('PATH_NOT_ALLOWED')
  })

  it('accepte un descendant d un prefixe en etoile', () => {
    expect(code('https://api.themoviedb.org/3/movie/603/credits')).toBeNull()
  })

  it('exige le chemin EXACT quand il n y a pas d etoile', () => {
    expect(code('https://api.themoviedb.org/3/search/movie')).toBeNull()
    expect(code('https://api.themoviedb.org/3/search/movie/extra')).toBe('PATH_NOT_ALLOWED')
  })

  it('declarer un hote n ouvre pas toutes ses portes', () => {
    // Un service d'administration vit souvent sur un port voisin.
    expect(code('https://api.themoviedb.org:8443/3/movie/1')).toBe('PORT_NOT_ALLOWED')
    expect(code('https://api.themoviedb.org:443/3/movie/1')).toBeNull()   // port par defaut, explicite
  })

  it('mais un port PEUT se declarer, sinon l intranet serait injoignable', () => {
    // Un service maison vit rarement sur 443. Le port declare reste visible
    // sur l'ecran de permissions.
    const g = { 'inventaire.local': { methods: ['GET'], paths: ['/api/*'], port: 8080 } }
    const ok = checkTarget('http://inventaire.local:8080/api/stock', 'GET', g)
    expect(ok.ok).toBe(true)
    const ko = checkTarget('http://inventaire.local:9090/api/stock', 'GET', g)
    expect(ko.ok).toBe(false)
    if (!ko.ok) expect(ko.code).toBe('PORT_NOT_ALLOWED')
    // Le port par defaut ne passe plus si un autre est declare.
    expect(checkTarget('http://inventaire.local/api/stock', 'GET', g).ok).toBe(false)
  })

  it.each(['file:///etc/passwd', 'ftp://a.example/x', 'javascript:alert(1)', 'data:text/html,x'])(
    'refuse le schema de %s', (url) => {
      expect(['SCHEME_NOT_ALLOWED', 'INVALID_ARGUMENT', 'HOST_NOT_ALLOWED']).toContain(code(url))
    })

  it('refuse la machine de l instance meme si quelqu un l accordait', () => {
    const granted = { localhost: { methods: ['GET'], paths: ['/'] } } as GrantedNetwork
    const r = checkTarget('http://localhost/admin', 'GET', granted)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('HOST_FORBIDDEN')
  })

  it.each([null, 42, '', 'pas-une-url', 'x'.repeat(3000)])('refuse l URL %p', (url) => {
    const r = checkTarget(url, 'GET', GRANTED)
    expect(r.ok).toBe(false)
  })
})

describe('prefixes de chemin', () => {
  it('etoile finale, sinon egalite stricte', () => {
    expect(pathAllowed('/a/b', ['/a/*'])).toBe(true)
    expect(pathAllowed('/a', ['/a'])).toBe(true)
    expect(pathAllowed('/ab', ['/a'])).toBe(false)
    expect(pathAllowed('/b', ['/a/*'])).toBe(false)
  })
})

describe('adresses : c est l adresse RESOLUE qui decide', () => {
  it.each(['10.0.0.5', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '0.0.0.0'])(
    '%s est privee ou reservee', (ip) => {
      expect(isPrivateIPv4(ip)).toBe(true)
      expect(isPrivateAddress(ip)).toBe(true)
    })

  it.each(['8.8.8.8', '1.1.1.1', '203.0.113.10'])('%s est publique', (ip) => {
    expect(isPrivateIPv4(ip)).toBe(false)
  })

  it.each(['::1', 'fe80::1', 'fc00::1', 'fd12::3', 'ff02::1'])('%s est privee en v6', (ip) => {
    expect(isPrivateIPv6(ip)).toBe(true)
  })

  it('demasque une IPv4 privee cachee derriere une ecriture v6', () => {
    // ::ffff:10.0.0.5 est une adresse privee deguisee.
    expect(isPrivateIPv6('::ffff:10.0.0.5')).toBe(true)
    expect(isPrivateIPv6('::ffff:8.8.8.8')).toBe(false)
  })

  it('une adresse publique passe', () => {
    expect(addressAllowed('8.8.8.8', false)).toMatchObject({ ok: true })
  })

  it('une adresse privee passe SEULEMENT avec l accord explicite', () => {
    // Une instance en intranet est un usage normal, pas une anomalie.
    expect(addressAllowed('10.0.0.5', false)).toMatchObject({ ok: false, code: 'PRIVATE_ADDRESS' })
    expect(addressAllowed('10.0.0.5', true)).toMatchObject({ ok: true })
  })

  it.each(['127.0.0.1', '127.1.2.3', '169.254.169.254', '::1', 'fe80::1', '0.0.0.0'])(
    '%s reste refusee MEME avec l accord de l admin', (ip) => {
      // Ces cibles sont la machine de l'instance et ses identifiants
      // d'hebergeur : un admin n'y gagne rien de legitime.
      const r = addressAllowed(ip, true)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('PRIVATE_ADDRESS')
    })
})

describe('en-tetes', () => {
  it('ne laisse sortir qu une liste courte', () => {
    const out = filterRequestHeaders({
      'Accept': 'application/json',
      'Cookie': 'session=vole',
      'Authorization': 'Bearer vole',
      'X-Forwarded-For': '1.2.3.4',
      'content-type': 'application/json',
    })
    expect(Object.keys(out).sort()).toEqual(['accept', 'content-type'])
  })

  it('refuse une valeur demesuree', () => {
    expect(filterRequestHeaders({ accept: 'x'.repeat(600) })).toEqual({})
  })

  it('ne rend jamais un Set-Cookie', () => {
    const out = filterResponseHeaders([
      ['content-type', 'application/json'],
      ['set-cookie', 'a=b'],
      ['x-powered-by', 'php'],
      ['cache-control', 'max-age=60'],
    ])
    expect(Object.keys(out).sort()).toEqual(['cache-control', 'content-type'])
  })

  it('supporte une entree vide', () => {
    expect(filterRequestHeaders(null)).toEqual({})
    expect(filterRequestHeaders('texte')).toEqual({})
  })
})

describe('secrets : le serveur possede la recette', () => {
  it('injecte en en-tete par defaut', () => {
    const url = new URL('https://api.themoviedb.org/3/movie/1')
    const h: Record<string, string> = {}
    applySecret(url, h, 'SECRET')
    expect(h.authorization).toBe('Bearer SECRET')
    expect(url.search).toBe('')
  })

  it('injecte en parametre quand la recette le dit', () => {
    const url = new URL('https://api.themoviedb.org/3/movie/1')
    const h: Record<string, string> = {}
    applySecret(url, h, 'SECRET', { mode: 'query', param: 'api_key' })
    expect(url.searchParams.get('api_key')).toBe('SECRET')
    expect(h.authorization).toBeUndefined()
  })

  it('ne fait rien sans secret', () => {
    const url = new URL('https://a.example/')
    const h: Record<string, string> = {}
    applySecret(url, h, undefined)
    expect(h).toEqual({})
  })

  it('l extension ne peut pas choisir la destination du secret', () => {
    // Elle nomme le secret au manifeste, elle n'ecrit ni l'en-tete ni le
    // parametre : sinon elle le ferait envoyer vers un hote qu'elle controle.
    const h = filterRequestHeaders({ 'X-Peu-Importe': 'donne-moi-le-secret', authorization: 'a-moi' })
    expect(h).toEqual({})
  })
})

describe('taille de reponse', () => {
  it('refuse ce qui s annonce deja trop gros', () => {
    expect(declaredTooLarge(String(6 * 1024 * 1024))).toBe(true)
    expect(declaredTooLarge('1024')).toBe(false)
    expect(declaredTooLarge(null)).toBe(false)
    expect(declaredTooLarge('pas-un-nombre')).toBe(false)
  })
})
