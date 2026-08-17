// ─── Trafic web : les agregats GoAccess, rendus par Olympus ──────────────────
//
// POURQUOI PAS LE RAPPORT HTML DE GOACCESS. Il se rend entierement en
// JavaScript et utilise `new Function`, que la CSP d'Olympus interdit
// (`script-src 'self' 'unsafe-inline'`, sans `unsafe-eval`).
//
// Mesure : 6052 caracteres rendus sans CSP, ZERO avec celle de production.
// C'etait la page blanche constatee.
//
// Plutot que d'affaiblir la CSP d'une page qui affiche des adresses de
// visiteurs, on laisse GoAccess faire l'agregation et Olympus le rendu. Aucun
// `eval`, aucune CSP a toucher, et un affichage coherent avec le reste du hub.
//
// L'authentification vient du `+layout.server.ts` : contrairement a un
// `+server.ts`, une page la traverse bien.

import { readFileSync, statSync } from 'node:fs'
import type { PageServerLoad } from './$types'

const RAPPORT = '/var/lib/nodyx-goaccess/rapport.json'

/** Un panneau GoAccess : on ne garde que ce qu'on affiche. */
function panneau(src: unknown, max = 15) {
  const data = (src as { data?: unknown[] })?.data
  if (!Array.isArray(data)) return []
  return data.slice(0, max).map((e) => {
    const x = e as Record<string, { count?: number; percent?: number } | string | number>
    return {
      nom: String(x.data ?? '—').slice(0, 120),
      coups: (x.hits as { count?: number })?.count ?? 0,
      visiteurs: (x.visitors as { count?: number })?.count ?? 0,
      // GoAccess renvoie le pourcentage en CHAINE ('34.08').
      pourcent: Number((x.hits as { percent?: string })?.percent ?? 0) || 0,
    }
  })
}

export const load: PageServerLoad = async () => {
  let brut: Record<string, unknown>
  let genereIlYA: number | null = null
  try {
    brut = JSON.parse(readFileSync(RAPPORT, 'utf-8'))
    genereIlYA = Math.round((Date.now() - statSync(RAPPORT).mtimeMs) / 1000)
  } catch {
    // Le minuteur n'a peut-etre pas encore tourne. On le dit, plutot que
    // d'afficher une page vide — c'est exactement le defaut qu'on corrige ici.
    return { indisponible: true, genereIlYA: null, general: null, panneaux: {} }
  }

  const g = (brut.general ?? {}) as Record<string, number | string>

  return {
    indisponible: false,
    genereIlYA,
    general: {
      requetes: Number(g.total_requests ?? 0),
      echecs: Number(g.failed_requests ?? 0),
      visiteurs: Number(g.unique_visitors ?? 0),
      introuvables: Number(g.unique_not_found ?? 0),
      fichiers: Number(g.unique_files ?? 0),
      debut: String(g.start_date ?? ''),
      fin: String(g.end_date ?? ''),
    },
    panneaux: {
      requetes: panneau(brut.requests),
      hotes: panneau(brut.hosts),
      introuvables: panneau(brut.not_found),
      statuts: panneau(brut.status_codes, 10),
      navigateurs: panneau(brut.browsers, 10),
      systemes: panneau(brut.os, 10),
      heures: panneau(brut.visit_time, 24),
    },
  }
}
