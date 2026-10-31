// Stub vitest du module virtuel SvelteKit $app/env/public (env node).
// Lu sur process.env au chargement : un test qui a besoin d'une valeur précise
// la pose sur process.env avant d'importer le module testé.
export const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? ''
export const PUBLIC_SIGNET_URL = process.env.PUBLIC_SIGNET_URL
export const PUBLIC_TURN_URL = process.env.PUBLIC_TURN_URL
export const PUBLIC_TURN_USERNAME = process.env.PUBLIC_TURN_USERNAME
export const PUBLIC_TURN_CREDENTIAL = process.env.PUBLIC_TURN_CREDENTIAL
export const PUBLIC_TENOR_KEY = process.env.PUBLIC_TENOR_KEY
export const PUBLIC_GIPHY_KEY = process.env.PUBLIC_GIPHY_KEY
export const PUBLIC_DIRECTORY_URL = process.env.PUBLIC_DIRECTORY_URL
