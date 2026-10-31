/**
 * Neutralisation des portions d'une ligne qui NE SONT PAS de l'interface.
 *
 * Extrait de `scan.mjs` pour être testable : la porte i18n avait un angle mort
 * qu'aucun test ne pouvait attraper tant que cette logique vivait dans un script
 * exécuté au chargement.
 *
 * L'ANGLE MORT, trouvé le 2026-08-19. `scan.mjs` exemptait la ligne ENTIÈRE dès
 * qu'elle contenait `tFn(` :
 *
 *     const frHit = !l.includes('tFn(') && ... // toute la ligne échappe
 *
 * Donc ceci passait, et la porte annonçait « 0 chaîne en dur » :
 *
 *     {cond ? 'Remplacer' : tFn('editor.insert')}
 *
 * On neutralise désormais les appels i18n et on examine ce qui reste.
 */

/**
 * Remplace par des espaces ce qui ne doit pas être analysé, en PRÉSERVANT la
 * longueur pour que les colonnes rapportées restent justes.
 *
 * Deux catégories :
 *   - les appels `tFn(...)` et `$t(...)`, déjà traduits par construction ;
 *   - les tableaux `keywords: [...]`, qui alimentent uniquement la recherche de
 *     la palette de commandes et ne sont jamais affichés. Ces alias sont
 *     volontairement bilingues pour qu'un francophone tape « paramètres » et
 *     trouve Settings : les signaler pousserait à les supprimer, donc à casser
 *     la recherche en français.
 *
 * @param {string} line
 * @returns {string} la ligne, appels i18n et alias de recherche blanchis
 */
export function stripI18n(line) {
  line = line.replace(/\bkeywords\s*:\s*\[[^\]]*\]/g, (m) => ' '.repeat(m.length))

  let out = ''
  for (let i = 0; i < line.length; ) {
    const m = /^(?:tFn|\$t)\s*\(/.exec(line.slice(i))
    if (!m) { out += line[i]; i++; continue }

    // Comptage de parenthèses, en ignorant celles vivant dans une chaîne :
    // `tFn('clé', { n: f(1) })` doit être neutralisé en entier.
    let prof = 0, guill = null
    let j = i + m[0].length - 1
    for (; j < line.length; j++) {
      const c = line[j]
      if (guill) {
        if (c === guill && line[j - 1] !== '\\') guill = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') { guill = c; continue }
      if (c === '(') prof++
      else if (c === ')') { prof--; if (prof === 0) { j++; break } }
    }
    out += ' '.repeat(j - i)
    i = j
  }
  return out
}

/**
 * Mots outils français sans accent. « Tout marquer comme lu » passait entre les
 * règles de `scan.mjs` (accents, liste de mots d'interface, contractions) : aucun
 * accent, aucun mot de la liste (2026-10-31). Un seul de ces mots peut exister en
 * anglais ou dans du code ; DEUX différents sur la même ligne, c'est du français.
 * « sans » est écarté exprès : il collerait à la classe `font-sans`.
 */
const MOTS_OUTILS = /\b(?:pour|avec|dans|comme|tout|tous|toute|toutes|une|des|sur|aux|mais|leur|leurs|ton|tes|ces|sont|est|les|du|au|le|la|un|de|et|ou|ne|pas|plus|ici)\b/gi

/**
 * @param {string} texte
 * @returns {boolean} vrai si le texte porte au moins deux mots outils français différents
 */
export function aDeuxMotsOutils(texte) {
  return new Set((texte.match(MOTS_OUTILS) || []).map((m) => m.toLowerCase())).size >= 2
}

/**
 * Lignes (index à partir de 0) situées dans un bloc `<script>` d'un fichier
 * `.svelte`. La règle des mots outils ne vise que le BALISAGE, où vivait l'angle
 * mort : dans le script, des valeurs par défaut éditables (modèles d'alertes de
 * stream) et des messages de console relèvent d'autres décisions.
 * @param {string} txt
 * @returns {Set<number>}
 */
export function lignesDeScript(txt) {
  const lignes = new Set()
  let dedans = false
  txt.split('\n').forEach((l, i) => {
    if (/<script\b/.test(l)) dedans = true
    if (dedans) lignes.add(i)
    if (/<\/script>/.test(l)) dedans = false
  })
  return lignes
}
