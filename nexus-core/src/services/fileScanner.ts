/**
 * fileScanner.ts — Analyse les fichiers uploadés pour détecter les contenus malveillants.
 *
 * Protections :
 *  1. Shebang (#!) — bloque scripts shell, Python, Perl, Ruby…
 *  2. Magic bytes exécutables — EXE/DLL (MZ), ELF, Mach-O, Java .class, WASM, Python .pyc
 *  3. Archives — ZIP (dont bombs), RAR, 7z, GZIP, BZIP2, XZ, TAR
 *  4. Validation magic bytes vs MIME déclaré — un EXE renommé en .ttf se fait détecter
 *
 * Note : les images passent toutes par sharp (réencodage complet) qui neutralise
 * tout payload dissimulé. Le scanner reste appelé en amont pour échouer vite.
 */

export interface ScanResult {
  ok:      boolean
  reason?: string
}

// ── Signatures bloquées (exécutables + archives) ─────────────────────────────

interface Sig {
  label:  string
  offset: number
  bytes:  readonly number[]
}

const BLOCKED: readonly Sig[] = [
  // Exécutables
  { label: 'Windows PE / DLL (MZ)',    offset: 0,   bytes: [0x4D, 0x5A] },
  { label: 'ELF (Linux/Android)',      offset: 0,   bytes: [0x7F, 0x45, 0x4C, 0x46] },
  { label: 'Mach-O 32-bit',           offset: 0,   bytes: [0xFE, 0xED, 0xFA, 0xCE] },
  { label: 'Mach-O 64-bit',           offset: 0,   bytes: [0xFE, 0xED, 0xFA, 0xCF] },
  { label: 'Mach-O 32-bit LE',        offset: 0,   bytes: [0xCE, 0xFA, 0xED, 0xFE] },
  { label: 'Mach-O 64-bit LE',        offset: 0,   bytes: [0xCF, 0xFA, 0xED, 0xFE] },
  { label: 'Java .class',             offset: 0,   bytes: [0xCA, 0xFE, 0xBA, 0xBE] },
  { label: 'WebAssembly module',      offset: 0,   bytes: [0x00, 0x61, 0x73, 0x6D] },
  { label: 'Python bytecode (.pyc)',  offset: 0,   bytes: [0x6F, 0x0D, 0x0D, 0x0A] },
  { label: 'Python bytecode (.pyc)',  offset: 0,   bytes: [0x55, 0x0D, 0x0D, 0x0A] },

  // Archives (zip bombs, contenus cachés)
  { label: 'ZIP / archive bomb',      offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
  { label: 'ZIP vide',                offset: 0,   bytes: [0x50, 0x4B, 0x05, 0x06] },
  { label: 'ZIP multi-disk',          offset: 0,   bytes: [0x50, 0x4B, 0x07, 0x08] },
  { label: 'RAR archive',             offset: 0,   bytes: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07] },
  { label: '7-Zip archive',           offset: 0,   bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
  { label: 'GZIP archive',            offset: 0,   bytes: [0x1F, 0x8B] },
  { label: 'BZIP2 archive',           offset: 0,   bytes: [0x42, 0x5A, 0x68] },
  { label: 'XZ archive',              offset: 0,   bytes: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00] },
  { label: 'TAR archive (ustar)',     offset: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72] },
  { label: 'LZ4 archive',             offset: 0,   bytes: [0x04, 0x22, 0x4D, 0x18] },
  { label: 'Zstandard archive',       offset: 0,   bytes: [0x28, 0xB5, 0x2F, 0xFD] },
]

// ── Magic bytes attendus par famille MIME ─────────────────────────────────────

type MagicGroup = { bytes: readonly number[]; offset?: number }[]

const EXPECTED_MAGIC: Record<string, MagicGroup> = {
  // Images
  'image/jpeg':  [{ bytes: [0xFF, 0xD8, 0xFF] }],
  'image/png':   [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  'image/gif':   [{ bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },   // GIF87a
                  { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }],  // GIF89a
  'image/webp':  [{ bytes: [0x52, 0x49, 0x46, 0x46] }],              // RIFF (+ "WEBP" à offset 8)

  // Fonts
  'font/woff':                       [{ bytes: [0x77, 0x4F, 0x46, 0x46] }],
  'font/woff2':                      [{ bytes: [0x77, 0x4F, 0x46, 0x32] }],
  'application/font-woff':           [{ bytes: [0x77, 0x4F, 0x46, 0x46] }],
  'application/font-woff2':          [{ bytes: [0x77, 0x4F, 0x46, 0x32] }],
  'font/ttf':                        [{ bytes: [0x00, 0x01, 0x00, 0x00] },
                                      { bytes: [0x74, 0x72, 0x75, 0x65] }],  // true
  'font/otf':                        [{ bytes: [0x4F, 0x54, 0x54, 0x4F] }],  // OTTO
  'application/x-font-ttf':         [{ bytes: [0x00, 0x01, 0x00, 0x00] },
                                      { bytes: [0x74, 0x72, 0x75, 0x65] }],
  'application/x-font-opentype':     [{ bytes: [0x4F, 0x54, 0x54, 0x4F] }],

  // Audio
  'audio/mpeg':  [{ bytes: [0xFF, 0xFB] },   // MPEG sync (MP3 sans ID3)
                  { bytes: [0xFF, 0xF3] },
                  { bytes: [0xFF, 0xF2] },
                  { bytes: [0x49, 0x44, 0x33] }],  // ID3 tag
  'audio/ogg':   [{ bytes: [0x4F, 0x67, 0x67, 0x53] }],  // OggS
  'audio/wav':   [{ bytes: [0x52, 0x49, 0x46, 0x46] }],  // RIFF
  'audio/webm':  [{ bytes: [0x1A, 0x45, 0xDF, 0xA3] }],  // EBML
  'audio/mp4':   [{ bytes: [0x00, 0x00, 0x00], offset: 0 }],  // ftyp box (variable length prefix)
  'audio/flac':  [{ bytes: [0x66, 0x4C, 0x61, 0x43] }],  // fLaC

  // Thèmes — texte uniquement, pas de magic bytes fixes
  'application/json': [],
  'text/plain':       [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesSig(buf: Buffer, sig: Sig): boolean {
  const off = sig.offset ?? 0
  if (buf.length < off + sig.bytes.length) return false
  return sig.bytes.every((b, i) => buf[off + i] === b)
}

function hasShebang(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21  // #!
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Scanne un buffer binaire pour détecter les contenus malveillants.
 *
 * @param buf       Le contenu brut du fichier
 * @param mimeType  Le MIME type déclaré par l'upload (ex. "image/jpeg")
 * @returns { ok: true } ou { ok: false, reason: "..." }
 */
export function scanBuffer(buf: Buffer, mimeType: string): ScanResult {
  // 1 — Shebang (#!) → script shell/Python/Perl/Ruby…
  if (hasShebang(buf)) {
    const firstLine = buf.slice(0, 64).toString('ascii').split('\n')[0]
    return { ok: false, reason: `Script exécutable détecté : "${firstLine.trim()}"` }
  }

  // 2 — Magic bytes exécutables ou archives
  for (const sig of BLOCKED) {
    if (matchesSig(buf, sig)) {
      return { ok: false, reason: `Fichier dangereux détecté : ${sig.label}` }
    }
  }

  // 3 — Validation magic bytes vs MIME déclaré
  //     (ex. un .exe renommé en .ttf aura MZ mais pas les bytes WOFF)
  const expected = EXPECTED_MAGIC[mimeType]
  if (expected && expected.length > 0) {
    const valid = expected.some(group => {
      const off = group.offset ?? 0
      if (buf.length < off + group.bytes.length) return false
      return group.bytes.every((b, i) => buf[off + i] === b)
    })
    if (!valid) {
      return {
        ok:     false,
        reason: `Le contenu du fichier ne correspond pas au type déclaré (${mimeType})`,
      }
    }
  }

  // 4 — Validation JSON (thèmes)
  if (mimeType === 'application/json' || mimeType === 'text/plain') {
    try {
      const text = buf.toString('utf8')
      if (mimeType === 'application/json') JSON.parse(text)
      // Pas de balises HTML/script dans les thèmes texte
      if (/<script|<iframe|javascript:/i.test(text)) {
        return { ok: false, reason: 'Contenu de script détecté dans le fichier texte' }
      }
    } catch {
      return { ok: false, reason: 'Fichier JSON invalide' }
    }
  }

  return { ok: true }
}
