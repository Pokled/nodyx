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

        // CSP avec nonces — supprime unsafe-inline des scripts
        // SvelteKit injecte automatiquement nonce="{nonce}" sur ses scripts de hydratation
        // et ajoute 'nonce-{nonce}' au header Content-Security-Policy à chaque requête SSR.
        csp: {
            mode: 'nonce',
            directives: {
                'default-src':  ['self'],
                'script-src':   ['self'],   // 'nonce-xyz' ajouté automatiquement — plus d'unsafe-inline
                'style-src':    ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
                'style-src-attr': ['unsafe-inline'], // attributs style="" dynamiques (185 occurrences)
                'img-src':      ['self', 'data:', 'blob:', 'https:'],
                'media-src':    ['self', 'blob:'],
                'font-src':     ['self', 'data:', 'https://fonts.gstatic.com'],
                'connect-src':  ['self', 'wss:', 'https:'],
                'frame-src':    [
                    'https://www.youtube.com',
                    'https://youtube.com',
                    'https://www.youtube-nocookie.com',
                    'https://player.vimeo.com',
                    'https://www.openstreetmap.org',
                ],
                'object-src':   ['none'],
                'base-uri':     ['self'],
                'form-action':  ['self'],
            },
        },
    }
};

export default config;