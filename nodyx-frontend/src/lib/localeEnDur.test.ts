// ─── Aucune date ni aucun nombre formaté en français en dur ────────────────────
//
// 49 appels `toLocale…('fr-FR')` / `Intl.…('fr-FR')` dans 26 fichiers : un membre
// anglais ou chinois lisait « 13 oct. » dans le chat, des nombres à la
// française dans l'administration. Les dates et nombres suivent la langue
// active (`$locale`). Ce garde-fou échoue si un `'fr-FR'` revient dans le code
// (les commentaires, qui peuvent en parler, ne comptent pas).

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(__dirname, '..')

function fichiers(dir: string, out: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom)
    if (statSync(p).isDirectory()) fichiers(p, out)
    else if (/\.(svelte|ts)$/.test(nom) && !/\.(test|spec)\.ts$/.test(nom)) out.push(p)
  }
  return out
}

describe('formats de date et de nombre', () => {
  it("aucun 'fr-FR' en dur hors commentaires", () => {
    const fautifs: string[] = []
    for (const f of fichiers(RACINE)) {
      readFileSync(f, 'utf8').split('\n').forEach((ligne, i) => {
        const code = ligne.replace(/\/\/.*$/, '')
        if (/^\s*(\*|<!--)/.test(ligne) || /^\s*\*/.test(code)) return
        if (/['"]fr-FR['"]/.test(code)) fautifs.push(`${f.slice(RACINE.length + 1)}:${i + 1}`)
      })
    }
    expect(fautifs).toEqual([])
  })
})
