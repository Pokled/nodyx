import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),

    kit: {
        adapter: adapter(),

        // Désactive le check d'origine CSRF (dev multi-host : 192.168.x.x, DDNS, etc.)
        csrf: {
            checkOrigin: false,
        },

        serviceWorker: {
            register: true,
        },
    }
};

export default config;