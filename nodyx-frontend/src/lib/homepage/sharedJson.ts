// Les widgets de l'accueil chargent leurs données eux-mêmes. Deux widgets identiques
// (deux « derniers sujets », deux vitrines de 6 articles) faisaient chacun leur appel :
// 11 appels sur la page d'accueil de nodyx.org, dont 2 doublons exacts (20/11).
// Une adresse identique ne part qu'UNE fois pour la page ; chaque widget reçoit sa propre
// copie (aucun ne modifie les données d'un autre) ; un échec n'est pas gardé (on réessaie).
// Le partage ne couvre qu'UN affichage de la page : 10 s, pas plus. Sans cette limite, un
// membre qui revient sur l'accueil après avoir posté verrait les anciens « derniers sujets ».
export const SHARE_MS = 10_000
const pending = new Map<string, { at: number; p: Promise<unknown> }>()

export async function sharedJson<T>(url: string, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<T | null> {
	let e = pending.get(url)
	if (!e || now() - e.at > SHARE_MS) {
		const p = fetcher(url).then(async (res) => {
			if (!res.ok) throw new Error(String(res.status))
			return res.json()
		})
		e = { at: now(), p }
		pending.set(url, e)
		p.catch(() => { if (pending.get(url)?.p === p) pending.delete(url) })
	}
	try { return structuredClone(await e.p) as T } catch { return null }
}

/** Tests seulement. */
export function _resetSharedJson(): void { pending.clear() }
