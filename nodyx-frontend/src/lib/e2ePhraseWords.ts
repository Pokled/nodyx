// Vocabulaire du générateur de phrase de récupération E2E.
// Ce sont des DONNÉES (mots concrets, faciles à mémoriser une fois assemblés),
// pas des libellés d'interface : ils ne passent donc pas par l'i18n. La phrase
// générée est un texte libre que l'utilisateur copie ; la restauration accepte
// n'importe quelle phrase saisie, quelle que soit la langue de l'interface.
export const E2E_PHRASE_WORDS = [
	'soleil', 'montagne', 'rivière', 'tigre', 'guitare', 'orange', 'nuage', 'forêt', 'renard', 'piano',
	'comète', 'volcan', 'dauphin', 'lanterne', 'cerise', 'tornade', 'bambou', 'hibou', 'cascade', 'prairie',
	'saphir', 'vélo', 'château', 'colibri', 'menthe', 'galaxie', 'sirène', 'tonnerre', 'érable', 'panda',
	'horizon', 'boussole', 'flamme', 'noisette', 'baleine', 'origami', 'caramel', 'aurore', 'sentier', 'koala',
	'brume', 'cactus', 'écureuil', 'melon', 'phare', 'quartz', 'ruban', 'tulipe', 'vague', 'zèbre',
	'abricot', 'biscuit', 'citron', 'domino', 'éclair', 'figue', 'girafe', 'igloo', 'jongleur', 'kiwi',
]

/**
 * Génère une phrase de récupération : `count` mots tirés du wordlist, joints
 * par des tirets (ex: "soleil-tigre-piano-melon-phare").
 *
 * Le tirage utilise WebCrypto (`crypto.getRandomValues`) : aléa
 * cryptographiquement sûr, jamais `Math.random`. Chaque mot est indépendant
 * (des répétitions sont possibles, comme un tirage avec remise) ; l'entropie
 * vient du nombre de mots et de la taille du wordlist, pas de l'unicité.
 */
export function generateRecoveryPhrase(count = 5, words = E2E_PHRASE_WORDS): string {
	if (count < 1) throw new Error('count must be >= 1')
	if (words.length === 0) throw new Error('empty wordlist')
	const r = new Uint32Array(count)
	crypto.getRandomValues(r)
	return Array.from(r, (v) => words[v % words.length]).join('-')
}
