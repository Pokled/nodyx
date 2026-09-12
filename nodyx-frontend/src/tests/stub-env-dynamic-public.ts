// Stub vitest du module virtuel SvelteKit $env/dynamic/public (env node).
// Vide par défaut : chaque test qui a besoin d'une valeur précise la pose
// lui-même sur process.env avant d'importer le module testé, ou mocke ce
// stub directement (vi.mock('$env/dynamic/public', ...)).
export const env: Record<string, string | undefined> = {}
