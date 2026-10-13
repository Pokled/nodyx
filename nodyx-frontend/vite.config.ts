import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Relais du serveur de dev uniquement : le cœur n'autorise que l'origine publique
// de l'instance. Depuis http://127.0.0.1:<port>, le navigateur envoie cette origine
// locale et le cœur répond 500 (« CORS: origin non autorisée ») : chat vide, appels
// refusés. Le relais retire l'en-tête, la requête arrive comme un appel local.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sansOrigine = (proxy: any) => {
	proxy.on('proxyReq', (req: { removeHeader(n: string): void }) => req.removeHeader('origin'))
	proxy.on('proxyReqWs', (req: { removeHeader(n: string): void }) => req.removeHeader('origin'))
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],

	build: {
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					// TipTap (éditeur WYSIWYG) — ~500KB, chargé uniquement sur les pages forum/chat
					if (id.includes('@tiptap')) return 'vendor-tiptap'
					// Socket.IO client — chargé dynamiquement, mais on isole le vendor
					if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'vendor-socket'
					// Lowlight (syntax highlighting code blocks) — rarement utilisé
					if (id.includes('lowlight') || id.includes('highlight.js')) return 'vendor-highlight'
					// QRCode — utilisé uniquement dans settings (Nodyx Signet)
					if (id.includes('qrcode')) return 'vendor-misc'
					// RNNoise WASM (débruitage voix) — très lourd, isolé
					if (id.includes('rnnoise') || id.includes('@jitsi')) return 'vendor-audio'
				},
			},
		},
	},

	server: {
		host: true,
		allowedHosts: true,
		hmr: {
			// Quand Caddy est en frontal (HTTPS port 443), le HMR WebSocket
			// doit se connecter sur le port 443 et non sur le port Vite (5173)
			clientPort: 443,
		},
		proxy: {
			// Toutes les requêtes /api/* et /socket.io/* passent par le backend local
			// → fonctionne depuis n'importe quelle IP (192.168.x.x, domaine DDNS, etc.)
			'/api': {
				target:      'http://127.0.0.1:3000',
				changeOrigin: true,
				configure:   sansOrigine,
			},
			'/socket.io': {
				target:      'http://127.0.0.1:3000',
				changeOrigin: true,
				ws:           true, // WebSocket (Socket.IO)
				configure:   sansOrigine,
			},
			'/uploads': {
				target:      'http://127.0.0.1:3000',
				changeOrigin: true,
				configure:   sansOrigine,
			},
		},
	},
});
