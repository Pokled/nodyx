import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// SvelteKit 3 : la configuration passe au plugin, svelte.config.js n'existe plus.
// alias : garde $lib (remplacé par #lib dans kit 3) sans réécrire les imports.
export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: false
			}),
			serviceWorker: { register: true },
			alias: { $lib: 'src/lib' }
		})
	]
});
