import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Config dediee, environnement node : le coeur du registre est pur, il se
// teste sans navigateur ni SvelteKit.
export default defineConfig({
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
