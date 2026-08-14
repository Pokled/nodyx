// Le registre : modele, validation, et construction de l'index.
//
// Module PUR, sans acces disque ni reseau, pour deux raisons. Il est testable
// tel quel, et il sert aux deux faces du satellite : le site qui affiche, et
// l'index que les instances consomment. Une divergence entre ce qu'un humain
// lit et ce qu'une machine telecharge serait le pire defaut possible pour un
// magasin.
//
// cf SPECS/NODYX_SDK_CDC.md §9

export const INDEX_VERSION = 1

/** Une version publiee. Immuable : un correctif est une NOUVELLE version. */
export interface RegistryVersion {
	version:    string
	/** Empreinte du paquet, ce qui rend le telechargement verifiable. */
	sha256:     string
	url:        string
	/** Capacites demandees, telles que l'instance les affichera avant d'installer. */
	permissions: string[]
	/** Ce qui exige un consentement distinct, mis en avant separement. */
	sensitive:  string[]
	nodyxMin?:  string
	publishedAt: string
	changelog?: string
}

export interface RegistryEntry {
	id:          string
	label:       string
	description: string
	author:      { name: string; url?: string }
	source:      string
	license:     string
	family:      string
	/** Surfaces exposees : c'est d'elles que se deduit le rangement. */
	surfaces:    Array<'widget' | 'page'>
	locales:     string[]
	icon?:       string
	screenshots?: string[]
	/** Publiee par le projet, donc revue de l'interieur. */
	official?:   boolean
	versions:    RegistryVersion[]
}

export const RE_ID      = /^[a-z][a-z0-9-]{2,38}$/
export const RE_SEMVER  = /^\d+\.\d+\.\d+$/
export const RE_SHA256  = /^[a-f0-9]{64}$/

export interface ValidationIssue { path: string; message: string }

/**
 * Valide une entree de registre.
 *
 * Le registre officiel exige une licence et des sources publiques : sans elles
 * personne ne peut verifier ce qu'il installe, et l'ecran de permissions
 * deviendrait la seule barriere.
 */
export function validateEntry(raw: unknown): ValidationIssue[] {
	const issues: ValidationIssue[] = []
	const push = (path: string, message: string) => issues.push({ path, message })

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return [{ path: '', message: 'entree absente ou mal formee' }]
	}
	const e = raw as Record<string, unknown>

	if (typeof e.id !== 'string' || !RE_ID.test(e.id))          push('id', 'identifiant invalide')
	if (typeof e.label !== 'string' || !e.label.trim())          push('label', 'libelle requis')
	if (typeof e.description !== 'string' || !e.description.trim()) push('description', 'description requise')
	if (typeof e.license !== 'string' || !e.license.trim())       push('license', 'licence requise au registre officiel')
	if (typeof e.source !== 'string' || !/^https?:\/\//.test(String(e.source)))
		push('source', 'lien vers les sources requis : personne ne doit installer ce qu\'il ne peut pas lire')

	const author = e.author as { name?: unknown } | undefined
	if (!author || typeof author.name !== 'string' || !author.name.trim()) push('author.name', 'auteur requis')

	if (!Array.isArray(e.surfaces) || e.surfaces.length === 0) push('surfaces', 'au moins une surface')
	if (!Array.isArray(e.locales) || e.locales.length === 0)   push('locales', 'au moins une langue livree')

	const versions = Array.isArray(e.versions) ? e.versions : []
	if (versions.length === 0) push('versions', 'au moins une version publiee')

	const seen = new Set<string>()
	for (const [i, v] of versions.entries()) {
		const p = `versions[${i}]`
		const ver = v as Record<string, unknown>
		if (typeof ver.version !== 'string' || !RE_SEMVER.test(ver.version)) push(`${p}.version`, 'version semver requise')
		else if (seen.has(ver.version)) push(`${p}.version`, 'une version publiee est immuable : un correctif est une nouvelle version')
		else seen.add(ver.version)

		if (typeof ver.sha256 !== 'string' || !RE_SHA256.test(ver.sha256)) push(`${p}.sha256`, 'empreinte sha256 requise')
		if (typeof ver.url !== 'string' || !/^https?:\/\//.test(String(ver.url))) push(`${p}.url`, 'URL de telechargement requise')
		if (!Array.isArray(ver.permissions)) push(`${p}.permissions`, 'liste de permissions requise, meme vide')
	}

	return issues
}

/** Compare deux versions semver. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
	}
	return 0
}

/** La derniere version publiee, celle qu'une fiche met en avant. */
export function latestVersion(entry: RegistryEntry): RegistryVersion | null {
	if (!entry.versions.length) return null
	return [...entry.versions].sort((a, b) => compareVersions(b.version, a.version))[0]
}

/**
 * Diff de capacites entre deux versions.
 *
 * C'est ce qu'une instance montre avant une mise a jour, et c'est le moment
 * precis ou une extension honnete peut devenir hostile : ce qui s'AJOUTE
 * compte bien plus que ce qui disparait.
 */
export function capabilityDiff(from: RegistryVersion, to: RegistryVersion): { added: string[]; removed: string[] } {
	const before = new Set(from.permissions)
	const after  = new Set(to.permissions)
	return {
		added:   [...after].filter(c => !before.has(c)).sort(),
		removed: [...before].filter(c => !after.has(c)).sort(),
	}
}

export type Category = 'widgets' | 'modules'

/**
 * Categories d'une extension, deduites de ses SURFACES.
 *
 * Une extension n'a pas de type global : une extension mixte apparait dans
 * plusieurs categories, comme le font Joomla et WordPress avec leurs listings.
 * C'est ce qui evite une taxonomie artificielle ou il faudrait trancher ce
 * qu'« est » une extension qui expose une page et deux widgets.
 */
export function categoriesOf(entry: RegistryEntry): Category[] {
	const out: Category[] = []
	if (entry.surfaces.includes('widget')) out.push('widgets')
	if (entry.surfaces.includes('page'))   out.push('modules')
	return out
}

/**
 * Classement par defaut : editorial et EXPLICITE.
 *
 * Les officielles d'abord, puis les plus recemment mises a jour. Jamais une
 * note agregee deguisee en pertinence : il n'y a pas d'etoiles ici, et une
 * moyenne sur trois votes ne dit rien de ce qu'un paquet fait a une instance.
 */
export function defaultOrder(entries: RegistryEntry[]): RegistryEntry[] {
	return [...entries].sort((a, b) => {
		if (Boolean(b.official) !== Boolean(a.official)) return Number(Boolean(b.official)) - Number(Boolean(a.official))
		const da = latestVersion(a)?.publishedAt ?? ''
		const db = latestVersion(b)?.publishedAt ?? ''
		if (da !== db) return db.localeCompare(da)
		return a.label.localeCompare(b.label)
	})
}

export interface StoreIndex {
	index:       typeof INDEX_VERSION
	generatedAt: string
	extensions:  RegistryEntry[]
}

/** L'index servi aux instances. Meme donnee que le site, par construction. */
export function buildIndex(entries: RegistryEntry[], generatedAt: string): StoreIndex {
	return { index: INDEX_VERSION, generatedAt, extensions: defaultOrder(entries) }
}

export interface SearchFilters {
	q?:        string
	category?: Category
	locale?:   string
	official?: boolean
}

export function filterEntries(entries: RegistryEntry[], f: SearchFilters = {}): RegistryEntry[] {
	const q = f.q?.trim().toLowerCase()
	return defaultOrder(entries).filter((e) => {
		if (f.category && !categoriesOf(e).includes(f.category)) return false
		if (f.locale && !e.locales.includes(f.locale))           return false
		if (f.official !== undefined && Boolean(e.official) !== f.official) return false
		if (q) {
			const hay = `${e.id} ${e.label} ${e.description} ${e.author.name}`.toLowerCase()
			if (!hay.includes(q)) return false
		}
		return true
	})
}
