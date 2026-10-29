import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// SvelteKit 3 : la configuration passe au plugin, svelte.config.js n'existe plus.
// alias : garde $lib (remplacé par #lib dans kit 3) sans réécrire les imports.
export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({ adapter: adapter({ out: 'build' }), preprocess: vitePreprocess(), alias: { $lib: 'src/lib' } }),
  ],
  server: { port: 7777 }
});
