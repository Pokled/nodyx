import type { WidgetPlugin } from './_types'
import Vitrine from '../widgets/Vitrine.svelte'
import { K, VITRINE_SCHEMA } from './vitrineSchema'

const plugin: WidgetPlugin = {
	id:        'vitrine',
	label:     `${K}label`,
	icon:      '🖼️',
	desc:      `${K}desc`,
	family:    'community',
	phase:     1,
	component: Vitrine,
	schema:    VITRINE_SCHEMA,
}

export default plugin
