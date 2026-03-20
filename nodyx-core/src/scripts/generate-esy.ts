/**
 * NODYX — Générateur de clé ESY (instance.esy)
 *
 * Ce script génère une clé ESY unique par instance Nodyx.
 * La clé est stockée dans un fichier JSON sur le serveur.
 * Elle ne doit jamais être committée dans Git.
 *
 * Usage :
 *   npx ts-node src/scripts/generate-esy.ts
 *   ou après build : node dist/scripts/generate-esy.js
 *
 * Idempotent : si le fichier existe déjà, le script s'arrête.
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// ── Configuration ─────────────────────────────────────────────────────────────

const ESY_VERSION = 1
const ESY_ROUNDS  = 3   // Nombre de passes de permutation/bruit

const ESY_FILE_PATH = process.env.ESY_KEY_PATH
  ?? path.resolve(process.cwd(), '..', 'instance.esy')

// ── Glyph pool ────────────────────────────────────────────────────────────────
// Pool de 128 glyphes visuellement chaotiques parmi lesquels l'instance
// tire aléatoirement un sous-ensemble de 64.

const GLYPH_POOL: string[] = [
  // Caractères combinants Unicode (s'appliquent au caractère précédent → effet Zalgo)
  '\u0300','\u0301','\u0302','\u0303','\u0304','\u0305','\u0306','\u0307',
  '\u0308','\u0309','\u030A','\u030B','\u030C','\u030D','\u030E','\u030F',
  '\u0310','\u0311','\u0312','\u0313','\u0316','\u0317','\u0318','\u0319',
  '\u031A','\u031B','\u031C','\u031D','\u031E','\u031F','\u0320','\u0321',
  '\u0322','\u0323','\u0324','\u0325','\u0326','\u0327','\u0328','\u0329',
  '\u032A','\u032B','\u032C','\u032D','\u032E','\u032F','\u0330','\u0331',
  '\u0332','\u0333','\u0334','\u0335','\u0336','\u0337','\u0338','\u0339',
  '\u033A','\u033B','\u033C','\u033D','\u033E','\u033F',
  '\u0489',  // Combining Cyrillic Millions Sign (҉) — le classique Zalgo
  '\u20D2','\u20D3','\u20D6','\u20D7','\u20DB','\u20DC',
  // Lettres latines modifiées (base pour les mots chiffrés)
  'Ŧ','ħ','ĸ','ŋ','Ŋ','ş','Ş','ź','Ź','ż','Ż','ž','Ž',
  'Ā','ā','Ă','ă','Ą','ą','Ć','ć','Ĉ','ĉ','Ċ','ċ','Č','č',
  'ĝ','ğ','ġ','ģ','ĥ','Ĥ','ĩ','Ĩ','ĵ','Ĵ','ķ','Ķ','ĺ','Ĺ',
  'ļ','Ļ','ľ','Ľ','ŀ','Ŀ','ń','Ń','ņ','Ņ','ň','Ň','ŏ','Ŏ',
  'ő','Ő','ŕ','Ŕ','ŗ','Ŗ','ř','Ř','ś','Ś','ŝ','Ŝ','š','Š',
  'ţ','Ţ','ť','Ť','ũ','Ũ','ū','Ū','ŭ','Ŭ','ů','Ů',
]

// ── Algorithmes ───────────────────────────────────────────────────────────────

/** Génère une permutation bijective de [0..255] via Fisher-Yates sur des bytes crypto. */
function generatePermutation(): number[] {
  const perm = Array.from({ length: 256 }, (_, i) => i)
  // On utilise crypto.randomBytes pour l'entropie réelle
  const rand = crypto.randomBytes(512) // sur-provision volontaire
  let rIdx = 0

  for (let i = 255; i > 0; i--) {
    // Rejection sampling sur 1 byte pour éviter le biais modulo
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

/** Calcule la permutation inverse. invPerm[perm[i]] = i. */
function inversePermutation(perm: number[]): number[] {
  const inv = new Array<number>(256)
  for (let i = 0; i < 256; i++) inv[perm[i]] = i
  return inv
}

/** Sélectionne 64 glyphes aléatoires dans le pool. */
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

// ── Clé ESY ───────────────────────────────────────────────────────────────────

export interface EsyKeyFile {
  version:             number
  generated_at:        string
  permutation:         number[]  // 256 valeurs — bijection
  inverse_permutation: number[]  // inverse de permutation
  noise_seed:          number    // uint32 — graine PRNG déterministe
  rounds:              number    // nombre de passes
  glyphs:              string[]  // 64 glyphes — rendu visuel seulement
  fingerprint:         string    // SHA-256 (hex, 8 chars) du fichier sans ce champ
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`
  const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`
  const red   = (s: string) => `\x1b[31m${s}\x1b[0m`

  console.log()
  console.log(bold(cyan('  ╔══════════════════════════════════════╗')))
  console.log(bold(cyan('  ║   NODYX — Générateur de clé ESY v1   ║')))
  console.log(bold(cyan('  ╚══════════════════════════════════════╝')))
  console.log()

  // Idempotent : on ne régénère pas si le fichier existe
  if (fs.existsSync(ESY_FILE_PATH)) {
    console.log(green('  ✓ instance.esy existe déjà — aucune action.'))
    console.log(`  → ${ESY_FILE_PATH}`)
    console.log()
    return
  }

  console.log('  Génération de la permutation de bytes (Fisher-Yates, crypto)...')
  const perm    = generatePermutation()
  const invPerm = inversePermutation(perm)

  // Validation : invPerm[perm[i]] === i pour tout i
  for (let i = 0; i < 256; i++) {
    if (invPerm[perm[i]] !== i) {
      console.error(red('  ERREUR : La permutation inverse est incorrecte.'))
      process.exit(1)
    }
  }

  console.log('  Génération du facteur de bruit (seed PRNG xorshift32)...')
  const noiseBuf   = crypto.randomBytes(4)
  const noise_seed = (noiseBuf.readUInt32BE(0) | 1) >>> 0 // toujours impair (meilleur xorshift)

  console.log('  Sélection des 64 glyphes visuels...')
  const glyphs = selectGlyphs()

  // Construction de la clé sans fingerprint
  const key: Omit<EsyKeyFile, 'fingerprint'> = {
    version:             ESY_VERSION,
    generated_at:        new Date().toISOString(),
    permutation:         perm,
    inverse_permutation: invPerm,
    noise_seed,
    rounds:              ESY_ROUNDS,
    glyphs,
  }

  // Fingerprint = SHA-256 du JSON canonique (sans le champ fingerprint lui-même)
  const canonical   = JSON.stringify(key, null, 0)
  const fingerprint = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)

  const fullKey: EsyKeyFile = { ...key, fingerprint }

  // Écriture
  const dir = path.dirname(ESY_FILE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(ESY_FILE_PATH, JSON.stringify(fullKey, null, 2), 'utf8')
  fs.chmodSync(ESY_FILE_PATH, 0o600) // lecture seule par le owner

  console.log()
  console.log(green('  ✓ instance.esy généré avec succès !'))
  console.log()
  console.log(`  Chemin      : ${bold(ESY_FILE_PATH)}`)
  console.log(`  Fingerprint : ${bold(fingerprint)}`)
  console.log(`  Rounds      : ${bold(String(ESY_ROUNDS))}`)
  console.log(`  Noise seed  : ${bold(String(noise_seed))} (0x${noise_seed.toString(16).toUpperCase()})`)
  console.log(`  Glyphes     : ${glyphs.slice(0, 8).join('')} ... (64 au total)`)
  console.log()
  console.log(red('  ⚠  IMPORTANT : ne jamais committer instance.esy dans Git !'))
  console.log(red('  ⚠  Sauvegarder ce fichier — si perdu, les DMs chiffrés deviennent'))
  console.log(red('     illisibles (la couche ESY ne peut plus être inversée).'))
  console.log()
}

main()
