import adapter from '@sveltejs/adapter-node'
import { sveltekit } from '@sveltejs/kit/vite'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// SvelteKit 3 : la configuration passe au plugin, svelte.config.js n'existe plus.
// alias : garde $lib (remplacé par #lib dans kit 3) sans réécrire les imports.
// csp : reprise à l'identique de l'ancien svelte.config.js.
export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			preprocess: vitePreprocess(),
			alias: { $lib: 'src/lib' },
			csp: {
				"mode": "nonce",
				"directives": {
					"default-src": [
						"self"
					],
					"script-src": [
						"self"
					],
					"style-src": [
						"self",
						"unsafe-inline"
					],
					"img-src": [
						"self",
						"data:"
					],
					"font-src": [
						"self"
					],
					"connect-src": [
						"self"
					],
					"frame-src": [
						"none"
					],
					"object-src": [
						"none"
					],
					"base-uri": [
						"self"
					],
					"form-action": [
						"self"
					]
				}
			},
		}),
	],
})
