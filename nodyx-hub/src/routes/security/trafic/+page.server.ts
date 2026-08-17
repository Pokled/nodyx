// ─── Trafic web : les agregats GoAccess, rendus par Olympus ──────────────────
//
// POURQUOI PAS LE RAPPORT HTML DE GOACCESS. Il se rend entierement en
// JavaScript et utilise `new Function`, que la CSP d'Olympus interdit
// (`script-src 'self' 'unsafe-inline'`, sans `unsafe-eval`).
//
// Mesure : 6052 caracteres rendus sans CSP, ZERO avec celle de production.
// C'etait la page blanche constatee. Plutot qu'affaiblir la CSP d'une page qui
// affiche des adresses de visiteurs, GoAccess agrege et Olympus rend.
//
// CE QU'ON EXPLOITE, ET QUI DORMAIT. GoAccess fournit bien plus que des totaux :
//   - `method` sur chaque chemin (GET/POST) ;
//   - `visitors` distinct des `hits` — 300 coups d'un seul visiteur n'est pas
//     300 coups de 300 visiteurs, et cette nuance change tout ;
//   - `items`, un detail IMBRIQUE : les agents utilises par une adresse, les
//     versions d'un navigateur, les codes exacts derriere « 4xx ».
//
// L'authentification vient du `+layout.server.ts` : contrairement a un
// `+server.ts`, une page la traverse bien.

import { readFileSync, statSync } from 'node:fs'
import type { PageServerLoad } from './$types'

const RAPPORT = '/var/lib/nodyx-goaccess/rapport.json'

type Compte = { count?: number; percent?: string | number }
type Entree = {
	data?: unknown
	hits?: Compte
	visitors?: Compte
	method?: string
	items?: unknown[]
}

/** GoAccess renvoie les pourcentages en CHAINE ('34.08'), verifie sur la sortie. */
const pct = (c?: Compte) => Number(c?.percent ?? 0) || 0
const nb = (c?: Compte) => c?.count ?? 0

/** Le detail imbrique : versions de navigateur, codes exacts, agents par hote. */
function sousLignes(items: unknown[] | undefined, max = 5) {
	if (!Array.isArray(items)) return []
	return items.slice(0, max).map((i) => {
		// Les `items` sont tantot des objets complets, tantot de simples chaines
		// (les agents d'un hote, par exemple). On absorbe les deux formes.
		if (typeof i === 'string') return { nom: i.slice(0, 150), coups: 0, visiteurs: 0 }
		const e = i as Entree
		return {
			nom: String(e.data ?? '—').slice(0, 150),
			coups: nb(e.hits),
			visiteurs: nb(e.visitors),
		}
	})
}

function panneau(src: unknown, max = 15) {
	const data = (src as { data?: Entree[] })?.data
	if (!Array.isArray(data)) return []
	return data.slice(0, max).map((e) => ({
		nom: String(e.data ?? '—').slice(0, 160),
		methode: e.method && e.method !== '---' ? e.method : null,
		coups: nb(e.hits),
		pourcent: pct(e.hits),
		visiteurs: nb(e.visitors),
		detail: sousLignes(e.items),
	}))
}

export const load: PageServerLoad = async () => {
	let brut: Record<string, unknown>
	let genereIlYA: number | null = null
	try {
		brut = JSON.parse(readFileSync(RAPPORT, 'utf-8'))
		genereIlYA = Math.round((Date.now() - statSync(RAPPORT).mtimeMs) / 1000)
	} catch {
		// Le minuteur n'a peut-etre pas encore tourne. On le DIT, plutot que
		// d'afficher une page vide — c'est le defaut qu'on vient de corriger.
		return { indisponible: true, genereIlYA: null, general: null, panneaux: {} }
	}

	const g = (brut.general ?? {}) as Record<string, number | string>
	const requetes = Number(g.total_requests ?? 0)
	const valides = Number(g.valid_requests ?? 0)

	return {
		indisponible: false,
		genereIlYA,
		general: {
			requetes,
			valides,
			// GoAccess nomme ce champ `unique_not_found`, pas `not_found` :
			// verifie sur la sortie reelle, pas suppose.
			introuvables: Number(g.unique_not_found ?? 0),
			echecs: Number(g.failed_requests ?? 0),
			visiteurs: Number(g.unique_visitors ?? 0),
			fichiers: Number(g.unique_files ?? 0),
			referents: Number(g.unique_referrers ?? 0),
			taille: Number(g.log_size ?? 0),
			debut: String(g.start_date ?? ''),
			fin: String(g.end_date ?? ''),
			// Combien de requetes par visiteur : distingue un pic de trafic
			// legitime d'un unique client qui martele.
			parVisiteur: requetes && Number(g.unique_visitors) ? Math.round(requetes / Number(g.unique_visitors)) : 0,
		},
		panneaux: {
			requetes: panneau(brut.requests, 20),
			introuvables: panneau(brut.not_found, 12),
			hotes: panneau(brut.hosts, 15),
			statuts: panneau(brut.status_codes, 10),
			navigateurs: panneau(brut.browsers, 10),
			systemes: panneau(brut.os, 10),
			sites: panneau(brut.referring_sites, 10),
			referents: panneau(brut.referrers, 10),
			heures: panneau(brut.visit_time, 24),
		},
	}
}
