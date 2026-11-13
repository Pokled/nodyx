// D40 (« Nodyx relié ») : les messages réduits à leur carte, parce qu'ils ne contiennent
// QUE le lien. Le texte est caché seulement quand LinkCards confirme que la carte est
// affichée (jamais un message vide en attendant).
export function createSoleSet() {
	let ids = $state(new Set<string>())
	return {
		has: (id: string) => ids.has(id),
		set(id: string, sole: boolean) {
			if (ids.has(id) === sole) return
			const next = new Set(ids)
			if (sole) next.add(id); else next.delete(id)
			ids = next
		},
	}
}
