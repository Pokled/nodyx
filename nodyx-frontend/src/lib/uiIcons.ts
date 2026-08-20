// Correspondance emoji -> icône HugeIcons, pour l'habillage de l'interface.
//
// Pourquoi une table plutôt que de choisir au cas par cas dans chaque fichier :
// le même symbole revient partout. `✕` apparaît 34 fois, `✓` 20, `⚠` 12. Sans
// table, dix fichiers finiraient avec dix fermetures différentes, et la
// cohérence visuelle se perdrait fichier après fichier.
//
// Cette table est aussi la source de vérité du bundle : `bundle-hugeicons.mjs`
// la lit pour n'embarquer QUE ces icônes, jamais les 5091 du jeu complet.
//
// ─────────────────────────────────────────────────────────────────────────────
// CE QUI NE DOIT PAS ÊTRE REMPLACÉ
//
// Un emoji n'est pas toujours de la décoration. Trois cas restent des emojis :
//
//   - le sélecteur d'emojis et la palette de l'éditeur : l'emoji EST le contenu,
//     c'est ce que l'utilisateur choisit et envoie ;
//   - les statuts (« 💼 au travail », « 🎮 je joue ») : ce sont des états
//     expressifs, choisis par la personne. Les rendre monochromes appauvrirait ;
//   - les drapeaux, déjà traités en SVG Twemoji par `ChannelIcon`, jamais en
//     emoji brut, parce que Chrome sous Windows ne sait pas les dessiner.
//
// Ne remplacer que ce qui remplit une FONCTION : fermer, valider, avertir.
// ─────────────────────────────────────────────────────────────────────────────

import { addCollection } from '@iconify/svelte'
import bundle from './icons/hugeicons-bundled.json'

let _enregistre = false

/** Enregistre le jeu bundlé. Idempotent, appelé par `UiIcon` au premier rendu. */
export function registerUiIcons() {
	if (_enregistre) return
	addCollection(bundle as never)
	_enregistre = true
}

/**
 * Le symbole fonctionnel, et son icône.
 *
 * La clé est l'emoji qu'on remplace, pour que la migration se fasse au grep :
 * on cherche l'emoji dans le code, on lit ici son remplaçant.
 */
export const UI_ICONS = {
	// Actions
	'✕': 'hugeicons:cancel-01',        // fermer, retirer
	'✓': 'hugeicons:tick-02',          // valider, terminé
	'⚙': 'hugeicons:settings-01',      // réglages
	'🔍': 'hugeicons:search-01',        // rechercher
	'🗑': 'hugeicons:delete-02',        // supprimer
	'✏': 'hugeicons:edit-02',          // modifier
	'📋': 'hugeicons:copy-01',          // copier
	'🔗': 'hugeicons:link-02',          // lien

	// États
	'⚠': 'hugeicons:alert-02',         // avertissement
	'🔒': 'hugeicons:lock',             // verrouillé, privé
	'🔓': 'hugeicons:lock-key',         // déverrouillé
	'⏳': 'hugeicons:time-quarter',     // en attente
	'⭐': 'hugeicons:star',             // épinglé, favori

	// Domaines
	'💬': 'hugeicons:message-01',       // discussion
	'📅': 'hugeicons:calendar-01',      // calendrier
	'📦': 'hugeicons:package',          // module, extension
	'🌐': 'hugeicons:globe',            // langue, réseau
	'🎨': 'hugeicons:paint-board',      // thème, apparence
	'🎵': 'hugeicons:music-note-01',    // audio
	'🔊': 'hugeicons:volume-high',      // son actif
	'🔇': 'hugeicons:volume-off',       // son coupé
	'📁': 'hugeicons:folder-01',        // dossier
	'👤': 'hugeicons:user',             // profil
	'👥': 'hugeicons:user-multiple',    // membres
	'🔥': 'hugeicons:fire',             // tendance
	'⚡': 'hugeicons:flash',            // rapide, temps réel
	'❤': 'hugeicons:favourite',        // aimé
	'📊': 'hugeicons:chart-01',         // statistiques
	'🏠': 'hugeicons:home-01',          // accueil
	'🔔': 'hugeicons:notification-01',  // notifications
} as const

export type UiIconKey = keyof typeof UI_ICONS

/** Le nom d'icône correspondant à un emoji, ou `null` s'il n'est pas dans la table. */
export function iconePour(emoji: string): string | null {
	return (UI_ICONS as Record<string, string>)[emoji] ?? null
}
