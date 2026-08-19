// ─── /translate ne doit pas défiler horizontalement ──────────────────────────
//
// La page défilait de 337 px sous 727 px de large, sans qu'aucun élément visible
// ne dépasse : la zone à droite était entièrement vide. Le défaut a résisté à
// deux tentatives avant d'être compris.
//
// CAUSE. Les libellés `.sr`, réservés aux lecteurs d'écran, sont en
// `position: absolute`. Sans ancêtre positionné, leur bloc conteneur est le bloc
// conteneur INITIAL et non le conteneur défilant qui les entoure : ils lui
// échappaient et étendaient la zone défilable du document jusqu'à 727 px, là où
// se trouve le dernier d'entre eux dans la table de 800 px.
//
// SIGNATURE, utile ailleurs : `body` ne débordait pas (390 pour 390), seul
// `html` débordait. Quand seul l'élément racine déborde, chercher un élément
// positionné par rapport au bloc conteneur initial, pas un élément trop large.
//
// Une mise en page ne se teste pas sans navigateur. Ce contrôle garde donc la
// DÉCISION, sur le modèle des contrôles de migrations du cœur : si quelqu'un
// retire `position: relative` en le croyant inutile, il saura pourquoi il était
// là.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = new URL('../routes/translate/+page.svelte', import.meta.url).pathname
const src = readFileSync(PAGE, 'utf-8')

/** La règle CSS d'un sélecteur, telle qu'écrite dans le composant. */
function regle(selecteur: string): string {
  const m = new RegExp(`\\${selecteur}\\s*\\{([^}]*)\\}`).exec(src)
  return m ? m[1] : ''
}

describe('/translate : le conteneur de table contient ses absolus', () => {
  it('.tscroll est positionné, sinon les .sr lui échappent', () => {
    expect(regle('.tscroll')).toMatch(/position:\s*relative/)
  })

  it('.tscroll garde son défilement horizontal, la table fait 800 px', () => {
    // Les deux vont ensemble : `overflow-x` sans `position` laissait fuir les
    // absolus, `position` sans `overflow-x` casserait la lecture de la table.
    expect(regle('.tscroll')).toMatch(/overflow-x:\s*auto/)
  })

  it('les libellés lecteurs d écran restent en position absolue', () => {
    // On ne corrige pas le débordement en cassant l'accessibilité : `.sr` doit
    // rester la technique de masquage visuel habituelle.
    const sr = regle('.sr')
    expect(sr).toMatch(/position:\s*absolute/)
    expect(sr).toMatch(/width:\s*1px/)
  })
})
