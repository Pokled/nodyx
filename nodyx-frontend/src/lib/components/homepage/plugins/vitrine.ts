import type { WidgetPlugin } from './_types'
import Vitrine from '../widgets/Vitrine.svelte'
import { K, VITRINE_SCHEMA, vitrineAnatomy, normalizeVitrine } from './vitrineSchema'

const plugin: WidgetPlugin = {
	id:        'vitrine',
	label:     `${K}label`,
	icon:      '🖼️',
	desc:      `${K}desc`,
	family:    'community',
	phase:     1,
	component: Vitrine,
	schema:    VITRINE_SCHEMA,
	anatomy:   vitrineAnatomy,
	normalize: normalizeVitrine,
}

export default plugin
