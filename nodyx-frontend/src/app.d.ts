/// <reference types="@sveltejs/kit" />
/// <reference path="../.svelte-kit/ambient.d.ts" />

// LES DEUX REFERENCES CI-DESSUS SONT LA POUR L'EDITEUR, pas pour la CI.
//
// Le probleme (17/08) : chaque fichier important `$app/state`, `$app/environment`,
// `$app/forms`, `$app/navigation` ou `$env/static/public` affichait
// « Cannot find module ». Soit 130 fichiers pour `$app/*` et 38 pour `$env/*`.
//
// La CI, `npm run check` et le build ne voyaient RIEN, parce qu'ils passent par
// `tsconfig.json`, qui etend `.svelte-kit/tsconfig.json`, dont l'`include`
// contient `ambient.d.ts`, lequel porte deja la reference aux types de SvelteKit.
// Un serveur TypeScript d'editeur qui ouvre un fichier sans charger ce tsconfig
// n'a lui aucune de ces declarations, d'ou l'alerte permanente.
//
// Mesure, sur un programme volontairement prive de `ambient.d.ts` pour imiter
// l'editeur :
//
//     avant : $app/state, $app/environment, $app/forms, $app/navigation
//             et $env/static/public  -> tous non resolus
//     apres : tous resolus
//
// La seconde reference pointe vers un fichier GENERE et ignore par git. C'est
// assume : les types de `$env/*` listent les vraies variables du projet, ils ne
// peuvent pas etre ecrits a la main. La degradation est propre, verifie en
// supprimant le fichier : TypeScript ignore la reference au lieu d'echouer, et on
// retombe simplement sur l'alerte d'origine.

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
