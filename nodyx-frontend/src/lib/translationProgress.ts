/**
 * État des traductions, calculé à partir des fichiers de locale eux-mêmes.
 *
 * Source unique pour la page /translate et l'endpoint /translate/progress.json
 * (consommé par nodyx.dev et start.nodyx.org). Aucun chiffre n'est saisi à la
 * main : la page ne peut donc pas mentir sur l'état réel du dépôt.
 *
 * Le français est la langue source : c'est lui qui définit le jeu de clés de
 * référence. Une clé absente ou vide compte comme non traduite (à l'exécution
 * elle retombe sur l'anglais, donc elle est invisible mais bien manquante).
 */
import { LOCALES, type Locale } from './i18n'
import twemoji from './icons/twemoji-bundled.json'
import fr   from './locales/fr.json'
import en   from './locales/en.json'
import es   from './locales/es.json'
import de   from './locales/de.json'
import ru   from './locales/ru.json'
import ptPT from './locales/pt-PT.json'
import ptBR from './locales/pt-BR.json'
import vi   from './locales/vi.json'

const messages: Record<Locale, Record<string, string>> = { fr, en, es, de, ru, 'pt-PT': ptPT, 'pt-BR': ptBR, vi }

const SOURCE: Locale = 'fr'

/** Le cœur d'UI : navigation + libellés partagés, ce qu'un visiteur voit sur chaque page. */
const isCoreKey = (key: string) => key.startsWith('common.') || key.startsWith('nav.')

/**
 * Drapeau en SVG inline, résolu depuis le bundle Twemoji au moment du rendu.
 *
 * ChannelIcon enregistre la collection dans un $effect (navigateur uniquement) :
 * les drapeaux n'apparaîtraient donc qu'après hydratation. Ici on les sort du
 * bundle directement, ils sont dans le HTML rendu par le serveur.
 */
const bundle = twemoji as { width?: number; height?: number; icons: Record<string, { body: string; width?: number; height?: number }> }

function flagSvg(flagIcon: string): string {
	const icon = bundle.icons[flagIcon.replace(/^twemoji:/, '')]
	if (!icon) return ''
	const w = icon.width ?? bundle.width ?? 36
	const h = icon.height ?? bundle.height ?? 36
	return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${icon.body}</svg>`
}

export interface LocaleProgress {
	code:           Locale
	label:          string
	flagIcon:       string
	/** SVG inline du drapeau, prêt à poser via {@html} (source : bundle Twemoji local). */
	flagSvg:        string
	translated:     number
	missing:        number
	pct:            number
	isSource:       boolean
	isComplete:     boolean
	isCoreComplete: boolean
}

export interface TranslationProgress {
	/** Nombre de clés à traduire par langue (le jeu de clés du français). */
	total:          number
	coreTotal:      number
	languages:      LocaleProgress[]
	/** Chaînes traduites toutes langues confondues, et le total visé. */
	translatedAll:  number
	grandTotal:     number
	overallPct:     number
	completeCount:  number
}

const isFilled = (dict: Record<string, string>, key: string) =>
	typeof dict[key] === 'string' && dict[key].trim() !== ''

export function getTranslationProgress(): TranslationProgress {
	const keys     = Object.keys(messages[SOURCE])
	const coreKeys = keys.filter(isCoreKey)

	const languages: LocaleProgress[] = LOCALES.map(({ code, label, flagIcon }) => {
		const dict       = messages[code] ?? {}
		const translated = keys.filter((k) => isFilled(dict, k)).length
		const core       = coreKeys.filter((k) => isFilled(dict, k)).length

		return {
			code,
			label,
			flagIcon,
			flagSvg: flagSvg(flagIcon),
			translated,
			missing:        keys.length - translated,
			// Arrondi vers le bas : on n'affiche jamais 100 % tant qu'il reste une chaîne.
			pct:            keys.length ? Math.floor((translated / keys.length) * 100) : 0,
			isSource:       code === SOURCE,
			isComplete:     translated === keys.length,
			isCoreComplete: core === coreKeys.length,
		}
	})

	const translatedAll = languages.reduce((sum, l) => sum + l.translated, 0)
	const grandTotal    = keys.length * languages.length

	return {
		total:         keys.length,
		coreTotal:     coreKeys.length,
		languages,
		translatedAll,
		grandTotal,
		overallPct:    grandTotal ? Math.floor((translatedAll / grandTotal) * 100) : 0,
		completeCount: languages.filter((l) => l.isComplete).length,
	}
}
