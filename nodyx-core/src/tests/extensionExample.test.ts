import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import fs from 'fs'
import path from 'path'
import { readExtensionPackage } from '../extensions/package'
import { requestedCapabilities, sensitiveCapabilities } from '../extensions/capabilities'

// L'extension de reference du manuel, empaquetee et passee par la MEME chaine
// que n'importe quel paquet tiers.
//
// Ce test existe pour une raison precise : une documentation dont personne ne
// verifie qu'elle marche encore est pire qu'une absence de documentation. Si
// l'exemple du manuel cesse d'etre installable, la suite echoue ici, pas chez
// le premier developpeur qui le recopie.

const DIR = path.join(process.cwd(), 'examples', 'next-event')

function packExample(): Buffer {
  const zip = new AdmZip()
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(DIR, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(child)
      else zip.addFile(child, fs.readFileSync(path.join(DIR, child)))
    }
  }
  walk('')
  return zip.toBuffer()
}

describe('exemple de reference : next-event', () => {
  it('s installe par la chaine complete, sans une seule remarque', () => {
    const r = readExtensionPackage(packExample())
    if (!r.ok) throw new Error('exemple du manuel REFUSE : ' + JSON.stringify(r.issues, null, 2))
    expect(r.pkg.manifest.id).toBe('next-event')
    expect(r.pkg.manifest.version).toBe('1.0.0')
  })

  it('ne demande AUCUNE permission, ce qui en fait le cas le plus facile a installer', () => {
    const r = readExtensionPackage(packExample())
    if (!r.ok) throw new Error('refuse a tort')
    expect(requestedCapabilities(r.pkg.manifest)).toEqual([])
    expect(sensitiveCapabilities(r.pkg.manifest)).toEqual([])
    expect(r.pkg.privateNetworkHosts).toEqual([])
  })

  it('livre le francais ET l anglais, a parite de cles', () => {
    const r = readExtensionPackage(packExample())
    if (!r.ok) throw new Error('refuse a tort')
    const en = Object.keys(r.pkg.messages.en).sort()
    const fr = Object.keys(r.pkg.messages.fr).sort()
    expect(fr).toEqual(en)
    expect(en.length).toBeGreaterThan(8)
  })

  it('ne reference aucune cle absente du dictionnaire par defaut', () => {
    // Le lecteur le verifie deja, mais on le dit explicitement : c'est LA
    // regle maison qui devient executoire pour une extension tierce.
    const r = readExtensionPackage(packExample())
    expect(r.ok).toBe(true)
  })

  it('son icone survit a l assainissement sans rien perdre', () => {
    const r = readExtensionPackage(packExample())
    if (!r.ok) throw new Error('refuse a tort')
    expect(r.pkg.sanitized['icon.svg']).toBeUndefined()   // rien n'a du etre retire
    const icon = r.pkg.files.find(f => f.path === 'icon.svg')!
    expect(icon.content.toString('utf8')).toContain('<circle')
  })

  it('son point d entree exporte mount, et rien d autre n est exige', () => {
    const src = fs.readFileSync(path.join(DIR, 'ui', 'widget.js'), 'utf8')
    expect(src).toMatch(/export function mount\(\{ root, nodyx \}\)/)
    expect(src).not.toContain('customElements.define')   // l'ancien format est mort
  })

  it('n utilise que les jetons de theme du SDK, jamais les variables internes', () => {
    // Une extension cablee sur les palettes internes de Nodyx semblerait
    // ignorer le theme : elles ne sont pas un contrat, les --nodyx-* si.
    const src = fs.readFileSync(path.join(DIR, 'ui', 'widget.js'), 'utf8')
    const vars = [...src.matchAll(/var\((--[a-z0-9-]+)/gi)].map(m => m[1])
    expect(vars.length).toBeGreaterThan(0)
    for (const v of vars) expect(v.startsWith('--nodyx-')).toBe(true)
  })

  // Les assertions sur du texte source doivent porter sur le CODE, jamais sur
  // les commentaires : trois faux positifs d'affilee ont suffi a le rappeler.
  const code = () => fs.readFileSync(path.join(DIR, 'ui', 'widget.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('reference toutes les cles que le widget affiche lui meme', () => {
    // Les cles du manifeste (label, field.*) sont resolues par l'hote ; celles
    // ci sont affichees par le widget, donc elles doivent etre dans son code.
    for (const key of ['days', 'hours', 'minutes', 'past', 'invalid']) {
      expect(code()).toMatch(new RegExp(`['"]${key}['"]`))
    }
    expect(code()).toContain('nodyx.t(')
  })

  it('protege l affichage d une valeur de configuration', () => {
    // Le bac a sable protege Nodyx de l'extension, il ne protege pas
    // l'extension d'elle meme : un admin qui colle du HTML dans un champ texte
    // ne doit pas se retrouver avec du script execute dans la frame.
    expect(code()).toContain('el.textContent = value')
    // Viser l'AFFECTATION, pas le mot : `innerHTML` cite dans une phrase de
    // commentaire n'est pas un danger, `.innerHTML =` en est un.
    expect(code()).not.toMatch(/\.innerHTML\s*=/)
  })
})
