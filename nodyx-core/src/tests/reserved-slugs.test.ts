// ─── Personne ne doit pouvoir réserver un sous-domaine d'infrastructure ──────
//
// Mesuré le 2026-08-20. La validation du slug à l'inscription était PUREMENT
// formelle : `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`, et rien d'autre. `olympus`,
// `relay` ou `tunnel` étaient donc inscriptibles par n'importe qui.
//
// CE QUE ÇA NE PERMETTAIT PAS. Caddy évalue ses routes dans l'ordre, et les
// hôtes explicites précèdent le générique `*.nodyx.org` : aucun trafic n'aurait
// été détourné. Vérifié sur la configuration vivante, 18 routes, générique en
// avant-dernier.
//
// CE QUE ÇA PERMETTAIT QUAND MÊME :
//   - une entrée trompeuse dans l'annuaire PUBLIC, annonçant une communauté à
//     l'adresse de notre panneau d'administration ;
//   - une instance muette, que Caddy ignore, sans que son propriétaire puisse
//     comprendre pourquoi ;
//   - et surtout, le jour où `CF_TOKEN` sera configuré : l'inscription appelle
//     `createCloudflareSubdomain`, qui créerait un enregistrement DNS MANDATÉ
//     pour ce nom. Un `tunnel` inscrit masquerait alors l'endpoint du relais.

import { describe, it, expect } from 'vitest'
import { isReservedSlug, RESERVED_SLUGS } from '../utils/reservedSlugs'

describe('slugs réservés : ce qui doit être refusé', () => {
  it("refuse les sous-domaines servis aujourd'hui par Caddy", () => {
    // Relevés sur la configuration vivante, pas de mémoire.
    for (const s of ['olympus', 'library', 'extensions', 'start', 'code', 'signet']) {
      expect(isReservedSlug(s), s).toBe(true)
    }
  })

  it('refuse le relais et ses portes', () => {
    // `relay` et `relay6` portent des enregistrements DNS explicites, et
    // `tunnel` portera l'endpoint WebSocket. Il est réservé AVANT d'exister :
    // l'inverse serait une course.
    for (const s of ['relay', 'relay6', 'tunnel']) {
      expect(isReservedSlug(s), s).toBe(true)
    }
  })

  it("refuse les noms d'infrastructure usuels", () => {
    for (const s of ['www', 'api', 'admin', 'mail', 'cdn', 'static']) {
      expect(isReservedSlug(s), s).toBe(true)
    }
  })

  it('ignore la casse et les espaces autour', () => {
    // Le slug arrive du corps de la requête : on ne fait pas confiance à sa forme.
    for (const s of ['TUNNEL', ' relay ', 'OlYmPuS']) {
      expect(isReservedSlug(s), s).toBe(true)
    }
  })
})

describe('slugs réservés : ce qui doit rester libre', () => {
  it("n'empêche pas une vraie communauté de s'inscrire", () => {
    // Noms réels ou plausibles : la liste ne doit pas mordre sur le légitime.
    for (const s of ['waazaa', 'trik-teste', 'instituto-kairos', 'agora',
                     'french-godot', 'ma-communaute', 'relais', 'tunnelier']) {
      expect(isReservedSlug(s), s).toBe(false)
    }
  })

  it('ne réserve pas par simple ressemblance', () => {
    // `relay6` est réservé, `relay60` ne l'est pas : la comparaison est exacte,
    // pas un préfixe. Une règle par préfixe volerait des noms légitimes.
    expect(isReservedSlug('relay60')).toBe(false)
    expect(isReservedSlug('apiculture')).toBe(false)
    expect(isReservedSlug('wwwx')).toBe(false)
  })
})

describe('la liste elle-même', () => {
  it('couvre les instances maison déjà inscrites', () => {
    // `demo`, `sleemstudio` et `vieuxlooters` sont déjà protégés par le conflit
    // de slug (409). Les lister ne change rien pour eux, mais évite qu'un nom
    // libéré un jour soit repris par quelqu'un d'autre.
    for (const s of ['demo', 'sleemstudio', 'vieuxlooters']) {
      expect(RESERVED_SLUGS.has(s), s).toBe(true)
    }
  })

  it('ne contient que des noms en minuscules, sans espace', () => {
    // Une entrée mal formée serait silencieusement inefficace, puisque la
    // comparaison passe le slug en minuscules.
    for (const s of RESERVED_SLUGS) {
      expect(s, s).toBe(s.trim().toLowerCase())
      expect(s.length, s).toBeGreaterThan(1)
    }
  })
})
