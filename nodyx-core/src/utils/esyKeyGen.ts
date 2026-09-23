/**
 * esyKeyGen.ts — génération de la clé ESY (instance.esy)
 *
 * Logique extraite de `src/scripts/generate-esy.ts` (jusqu'ici le SEUL point
 * d'entrée : une commande manuelle `npm run generate-esy` que rien n'appelait
 * automatiquement, ni un postinstall ni le démarrage du serveur). Résultat en
 * prod : nodyx.org avait sa clé (générée à la main en mars), mais toutes les
 * instances installées depuis (vieuxlooters, sleemstudio, demo) tournaient
 * sans — DM chiffrés cassés en silence sur les 3 (issue #752).
 *
 * `ensureEsyKeyExists()` est appelée au boot (src/index.ts, après les
 * migrations) : idempotente, ne régénère jamais une clé existante, log
 * clairement la première génération. Auto-répare toute instance déjà
 * installée dès son prochain redémarrage, sans intervention manuelle.
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const ESY_VERSION = 1
const ESY_ROUNDS  = 3

export function resolveEsyKeyPath(): string {
  return process.env.ESY_KEY_PATH ?? path.resolve(process.cwd(), '..', 'instance.esy')
}

// Pool de 128 glyphes visuellement chaotiques parmi lesquels l'instance
// tire aléatoirement un sous-ensemble de 64.
const GLYPH_POOL: string[] = [
  '̀','́','̂','̃','̄','̅','̆','̇',
  '̈','̉','̊','̋','̌','̍','̎','̏',
  '̐','̑','̒','̓','̖','̗','̘','̙',
  '̚','̛','̜','̝','̞','̟','̠','̡',
  '̢','̣','̤','̥','̦','̧','̨','̩',
  '̪','̫','̬','̭','̮','̯','̰','̱',
  '̲','̳','̴','̵','̶','̷','̸','̹',
  '̺','̻','̼','̽','̾','̿',
  '҉',
  '⃒','⃓','⃖','⃗','⃛','⃜',
  'Ŧ','ħ','ĸ','ŋ','Ŋ','ş','Ş','ź','Ź','ż','Ż','ž','Ž',
  'Ā','ā','Ă','ă','Ą','ą','Ć','ć','Ĉ','ĉ','Ċ','ċ','Č','č',
  'ĝ','ğ','ġ','ģ','ĥ','Ĥ','ĩ','Ĩ','ĵ','Ĵ','ķ','Ķ','ĺ','Ĺ',
  'ļ','Ļ','ľ','Ľ','ŀ','Ŀ','ń','Ń','ņ','Ņ','ň','Ň','ŏ','Ŏ',
  'ő','Ő','ŕ','Ŕ','ŗ','Ŗ','ř','Ř','ś','Ś','ŝ','Ŝ','š','Š',
  'ţ','Ţ','ť','Ť','ũ','Ũ','ū','Ū','ŭ','Ŭ','ů','Ů',
]

export interface EsyKeyFile {
  version:             number
  generated_at:        string
  permutation:         number[]
  inverse_permutation: number[]
  noise_seed:          number
  rounds:              number
  glyphs:              string[]
  fingerprint:         string
}

/** Génère une permutation bijective de [0..255] via Fisher-Yates sur des bytes crypto. */
function generatePermutation(): number[] {
  const perm = Array.from({ length: 256 }, (_, i) => i)
  const rand = crypto.randomBytes(512)
  let rIdx = 0
  for (let i = 255; i > 0; i--) {
    let j: number
    const max = 256 - (256 % (i + 1))
    do {
      j = rand[rIdx++ % rand.length]
    } while (j >= max)
    j = j % (i + 1)
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  return perm
}

function inversePermutation(perm: number[]): number[] {
  const inv = new Array<number>(256)
  for (let i = 0; i < 256; i++) inv[perm[i]] = i
  return inv
}

function selectGlyphs(): string[] {
  const pool = [...GLYPH_POOL]
  const selected: string[] = []
  const randBytes = crypto.randomBytes(128)
  let idx = 0
  while (selected.length < 64 && pool.length > 0) {
    const r = randBytes[idx++ % randBytes.length] % pool.length
    selected.push(...pool.splice(r, 1))
  }
  return selected
}

function generateEsyKeyFile(): EsyKeyFile {
  const perm    = generatePermutation()
  const invPerm = inversePermutation(perm)
  for (let i = 0; i < 256; i++) {
    if (invPerm[perm[i]] !== i) {
      throw new Error('Permutation inverse incorrecte (bug generatePermutation/inversePermutation)')
    }
  }
  const noiseBuf   = crypto.randomBytes(4)
  const noise_seed = (noiseBuf.readUInt32BE(0) | 1) >>> 0
  const glyphs = selectGlyphs()

  const key: Omit<EsyKeyFile, 'fingerprint'> = {
    version: ESY_VERSION,
    generated_at: new Date().toISOString(),
    permutation: perm,
    inverse_permutation: invPerm,
    noise_seed,
    rounds: ESY_ROUNDS,
    glyphs,
  }
  const canonical   = JSON.stringify(key, null, 0)
  const fingerprint = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)
  return { ...key, fingerprint }
}

/**
 * Génère `instance.esy` s'il n'existe pas encore. Idempotente : ne touche
 * jamais une clé existante (une régénération changerait le brouillage et
 * rendrait tout l'historique DM chiffré existant illisible).
 */
export function ensureEsyKeyExists(): { created: boolean; path: string; fingerprint?: string } {
  const esyPath = resolveEsyKeyPath()
  if (fs.existsSync(esyPath)) {
    return { created: false, path: esyPath }
  }

  const key = generateEsyKeyFile()
  const dir = path.dirname(esyPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(esyPath, JSON.stringify(key, null, 2), 'utf8')
  fs.chmodSync(esyPath, 0o600)

  return { created: true, path: esyPath, fingerprint: key.fingerprint }
}
