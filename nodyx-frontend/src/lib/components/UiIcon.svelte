<!--
  Une icône d'interface, tirée du jeu HugeIcons bundlé localement.

  Remplace les emojis qui remplissaient une FONCTION : fermer, valider, avertir.
  Pas ceux que l'utilisateur choisit lui-même, ni les statuts expressifs, ni les
  drapeaux : voir l'en-tête de `$lib/uiIcons.ts` pour la frontière.

  Accessibilité, et ce n'est pas un détail : une icône est muette par défaut.
  - décorative, doublée d'un texte à côté  -> ne rien passer, elle sera masquée
    aux lecteurs d'écran, qui liraient sinon deux fois la même chose ;
  - seule dans un bouton                    -> passer `label`, sinon le bouton
    n'a aucun nom accessible et devient inutilisable au lecteur d'écran.

  Le `label` doit être une chaîne DÉJÀ traduite : `label={tFn('common.close')}`.
  Jamais de texte en dur ici, c'est une chaîne vue par l'utilisateur comme une
  autre.
-->
<script lang="ts">
	import Icon from '@iconify/svelte'
	import { registerUiIcons } from '$lib/uiIcons'

	type Props = {
		/** Nom complet, ex: 'hugeicons:cancel-01'. Voir la table `UI_ICONS`. */
		name:   string
		/** Côté en pixels. Suit la taille du texte voisin par défaut. */
		size?:  number
		/** Nom accessible. À passer dès que l'icône n'est PAS doublée d'un texte. */
		label?: string | null
		/** Classes utilitaires, pour la couleur notamment. */
		class?: string
	}

	let { name, size = 16, label = null, class: klass = '' }: Props = $props()

	// Enregistré au premier rendu plutôt qu'à l'import : un module importé par
	// le rendu serveur ne doit pas avoir d'effet de bord au chargement.
	registerUiIcons()
</script>

{#if label}
	<Icon icon={name} width={size} height={size} class={klass} role="img" aria-label={label} />
{:else}
	<Icon icon={name} width={size} height={size} class={klass} aria-hidden="true" />
{/if}
