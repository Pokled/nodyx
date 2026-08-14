import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Zero ressource tierce : ni police, ni script, ni mesure d'audience.
		// Un site qui vend l'auto-hebergement sans traqueur ne peut pas en poser.
		csp: {
			mode: 'nonce',
			directives: {
				'default-src':    ['self'],
				'script-src':     ['self'],
				'style-src':      ['self', 'unsafe-inline'],
				'img-src':        ['self', 'data:'],
				'font-src':       ['self'],
				'connect-src':    ['self'],
				'frame-src':      ['none'],
				'object-src':     ['none'],
				'base-uri':       ['self'],
				'form-action':    ['self'],
			},
		},
	},
};
