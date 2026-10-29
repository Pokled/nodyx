import adapter from '@sveltejs/adapter-node'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

// SvelteKit 3 : la configuration passe au plugin, svelte.config.js n'existe plus.
export default defineConfig({
  // alias : garde $lib (remplacé par #lib dans kit 3) sans réécrire les imports.
  plugins: [sveltekit({ adapter: adapter({ out: 'build' }), alias: { $lib: 'src/lib' } })],
  server: { port: 5175 },
})
