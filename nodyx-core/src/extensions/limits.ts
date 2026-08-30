// Limites du SDK d'extensions, source unique.
//
// Toute valeur ici est normative : elle est documentée dans
// SPECS/NODYX_SDK_REFERENCE.md §9, appliquée par le validateur à
// l'installation, et par le runtime à l'exécution. Un chiffre qui change ici
// doit changer dans le manuel, jamais l'inverse.

/** Version du contrat portée par `api` dans le manifeste. */
export const API_VERSION = 1

/** Version du protocole de messagerie hôte <-> frame (`p`). */
export const PROTOCOL_VERSION = 1

/** Paquet .nyx */
export const PACKAGE = {
  maxArchiveBytes:     20 * 1024 * 1024,
  maxUnpackedBytes:    60 * 1024 * 1024,
  maxFileBytes:         8 * 1024 * 1024,
  maxFiles:            2_000,
  maxDepth:            6,
  /** Ratio de décompression au delà duquel on refuse (bombe zip). */
  maxCompressionRatio: 100,
  allowedExtensions: [
    '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff2', '.md',
  ] as const,
} as const

/** Stockage clé/valeur */
export const STORAGE = {
  maxKeyLength:     128,
  maxValueBytes:    64 * 1024,
  maxKeysPerScope:  500,
  maxJsonDepth:     16,
  writesPerMinute:  30,
  /** Plafond absolu d'un quota déclarable au manifeste, par portée. */
  maxQuotaBytes:    64 * 1024 * 1024,
} as const

/**
 * Bundle applicatif d'une activité (cf SPECS/NODYX_ACTIVITIES_CDC.md §2).
 * Le runtime lourd (wasm, etc.) qui ne rentre pas dans le `.nyx`, téléchargé
 * une fois à l'installation, servi ensuite par l'instance.
 */
export const APP_BUNDLE = {
  maxBytes:    128 * 1024 * 1024,
  maxFiles:    500,
  maxFileBytes: 96 * 1024 * 1024,   // un .wasm de moteur peut être gros
  /** Types servables, jamais exécutables côté serveur. */
  allowedExtensions: [
    '.html', '.htm', '.js', '.mjs', '.css', '.json', '.wasm', '.pck', '.data',
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico',
    '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav', '.txt', '.map',
  ] as const,
} as const

/** Proxy réseau */
export const NETWORK = {
  maxRedirects:      3,
  timeoutMs:         10_000,
  maxResponseBytes:  5 * 1024 * 1024,
} as const

/** Surfaces */
export const SURFACE = {
  bootTimeoutMs:      5_000,
  maxFramesPerPage:   8,
  tokenTtlSeconds:    600,
} as const
