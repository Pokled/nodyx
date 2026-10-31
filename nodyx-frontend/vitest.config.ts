import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Config Vitest dédiée (séparée de vite.config.ts pour ne pas toucher au build
// SvelteKit). Environnement node : suffisant pour les modules purs (WebCrypto).
export default defineConfig({
	resolve: {
		alias: {
			// Résout $lib comme SvelteKit (nécessaire aux modules testés qui
			// importent d'autres modules $lib, ex: voiceSfu → $lib/socket).
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			// Modules virtuels SvelteKit indisponibles hors runtime Kit : stubbés.
			// Ordre : $app/env/public avant $app/env, l'alias le plus court l'avalerait.
			'$app/env/public': fileURLToPath(new URL('./src/tests/stub-app-env-public.ts', import.meta.url)),
			'$app/env': fileURLToPath(new URL('./src/tests/stub-app-env.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
