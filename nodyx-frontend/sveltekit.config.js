import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Options de SvelteKit, passées au plugin sveltekit() de vite.config.ts : depuis kit 3,
// svelte.config.js n'existe plus (config_file_unsupported). Fichier séparé pour garder
// la CSP lisible et commentée.
//
// Protection CSRF des formulaires ACTIVE (défaut de SvelteKit). Jusqu'à la 2.13, le frontend
// portait csrf.trustedOrigins: ['*'], qui la COUPAIT entièrement (« '*' » désactive la
// vérification, kit 2 comme kit 3) : un formulaire envoyé depuis n'importe quel site était
// accepté, et le cookie SameSite=lax n'arrête pas un sous-domaine voisin (*.nodyx.org).
// Posé « pour le dev multi-hôte », il n'y servait à rien : kit ne vérifie jamais en dev.
//
// L'origine de référence est reconstruite par adapter-node 6 (ORIGIN n'est plus lu) :
// https:// + en-tête Host. Juste pour toutes les installs officielles (https, Host transmis).
// Install manuelle servie en http : poser PROTOCOL_HEADER=x-forwarded-proto, sinon chaque
// formulaire (connexion comprise) répond 403.
//
// alias : garde $lib (remplacé par #lib dans kit 3) sans réécrire les centaines d'imports.

/** @type {import('@sveltejs/kit/vite').Config} */
const config = {
    preprocess: vitePreprocess(),
    alias: { $lib: 'src/lib' },
    adapter: adapter(),

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
            'script-src':   ['self', 'https://player.twitch.tv', 'https://www.youtube.com'],   // 'nonce-xyz' ajouté automatiquement — plus d'unsafe-inline. Twitch.Player SDK pour clips overlay ; YouTube IFrame Player API pour le lecteur de la page /musique/playlists (volume, avance auto).
            'style-src':    ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
            'style-src-attr': ['unsafe-inline'], // attributs style="" dynamiques (185 occurrences)
            'img-src':      ['self', 'data:', 'blob:', 'https:'],
            'media-src':    ['self', 'blob:', 'https:'],
            'font-src':     ['self', 'data:', 'https://fonts.gstatic.com'],
            'connect-src':  ['self', 'wss:', 'https:'],
            'frame-src':    [
                'self',   // requis pour le canvas Scènes admin qui embarque les /overlay/<type>/<token> en iframe preview
                'https://www.youtube.com',
                'https://youtube.com',
                'https://www.youtube-nocookie.com',
                'https://player.vimeo.com',
                'https://www.openstreetmap.org',
                // Plateformes du lecteur multimédia. Ces six hôtes sont DEJA autorisés par la
                // politique servie en production (posée par le proxy en mode set, qui remplace
                // celle-ci) : sans eux ici, un rapprochement de la config du proxy avec le disque
                // casserait Twitch, Dailymotion, SoundCloud et Spotify. Alignement sur l'existant,
                // pas un élargissement. cf SPECS/NODYX_SDK_CDC.md §13.1
                'https://player.twitch.tv',
                'https://www.twitch.tv',
                'https://clips.twitch.tv',
                'https://geo.dailymotion.com',
                'https://w.soundcloud.com',
                'https://open.spotify.com',
                // Nodyx Activities : le bundle d'une activité (jeu dans un
                // canal vocal) est servi PAR l'instance elle-même sous
                // /api/v1/extensions/.../app/ → `'self'` suffit, rien à
                // ajouter. SPECS/NODYX_ACTIVITIES_CDC.md §2.
            ],
            'object-src':   ['none'],
            'base-uri':     ['self'],
            'form-action':  ['self'],
        },
    },
};

export default config;
