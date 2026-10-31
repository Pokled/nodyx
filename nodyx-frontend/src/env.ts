import { defineEnvVars } from '@sveltejs/kit/env'

// Variables d'environnement du frontend (SvelteKit 3 : remplace $env/static/* et
// $env/dynamic/*). Lues via $app/env/public (navigateur autorisé) ou $app/env/private
// (serveur seulement).
//
// Migration à comportement constant depuis kit 2 :
//  - static: true  = ancien $env/static/*  : valeur lue au BUILD dans .env (ou
//    l'environnement du build), inscrite dans le bundle. Changer de domaine
//    demande donc toujours un rebuild, comme avant.
//  - static: false = ancien $env/dynamic/* : valeur lue au DÉMARRAGE du serveur
//    (process.env, donc ecosystem.config.js sous PM2).
//
// Sans `schema`, kit 3 exige la variable (vide accepté) : c'est le cas de
// PUBLIC_API_URL, sans lequel rien ne marche. Les autres étaient déjà traitées
// comme optionnelles par le code (repli `??` ou test de vacuité) : `optional`
// le dit à kit 3, un .env ancien qui ne les porte pas ne casse plus le build.

const optional = (value: string | undefined) => value

export const variables = defineEnvVars({
	PUBLIC_API_URL: {
		public: true,
		static: true,
		description: 'Public URL of the instance, without /api/v1 (e.g. https://example.org)'
	},
	PUBLIC_SIGNET_URL: {
		public: true,
		static: true,
		schema: optional,
		description: 'Nodyx Signet URL (PWA authenticator), empty when unused'
	},
	PUBLIC_TURN_URL: {
		public: true,
		static: true,
		schema: optional,
		description: 'Build-time TURN fallback; credentials normally come from nodyx-core'
	},
	PUBLIC_TURN_USERNAME: { public: true, static: true, schema: optional },
	PUBLIC_TURN_CREDENTIAL: { public: true, static: true, schema: optional },
	PUBLIC_TENOR_KEY: {
		public: true,
		static: true,
		schema: optional,
		description: 'Tenor key for chat GIF search, empty when unused'
	},
	PUBLIC_GIPHY_KEY: {
		public: true,
		static: true,
		schema: optional,
		description: 'Giphy key for chat GIF search, empty when unused'
	},
	PUBLIC_DIRECTORY_URL: {
		public: true,
		schema: optional,
		description: 'Nodyx directory, https://nodyx.org by default'
	},
	PRIVATE_API_SSR_URL: {
		static: true,
		schema: optional,
		description: 'Direct SSR call to nodyx-core (http://127.0.0.1:3000/api/v1 by default)'
	},
	INTERNAL_API_SECRET: {
		schema: optional,
		description: 'Secret shared with nodyx-core: marks SSR calls as internal (x-nodyx-internal)'
	}
})
