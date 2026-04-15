<script lang="ts">
	import type { PageData } from './$types'
	import { page } from '$app/stores'
	import GridRenderer from '$lib/components/homepage/GridRenderer.svelte'
	import { PLUGIN_REGISTRY, PLUGIN_LIST } from '$lib/components/homepage/plugins'
	import type { WidgetPlugin, WidgetFamily } from '$lib/components/homepage/plugins'
	import type {
		GridLayout, GridRow, GridColumn, GridTheme,
	} from '$lib/types/homepage'
	import {
		DEFAULT_THEME, genId, makeRow, makeRowFromSpans
	} from '$lib/types/homepage'
	import { untrack } from 'svelte'

	let { data }: { data: PageData } = $props()

	// ── State principal ───────────────────────────────────────────────────────
	let draft   = $state<GridLayout>(untrack(() =>
		(data.draft as GridLayout | null) ?? { rows: [] }
	))
	let theme   = $state<GridTheme>(untrack(() => ({ ...DEFAULT_THEME, ...(data.theme as Partial<GridTheme> ?? {}) })))
	let unsaved = $state(false)
	let saving  = $state(false)
	let publishing = $state(false)
	let toasts  = $state<{ id: number; text: string; ok: boolean }[]>([])
	let toastId = 0

	// ── UI state ──────────────────────────────────────────────────────────────
	type Panel = 'rows' | 'theme' | 'config' | 'rowsettings'
	let activePanel   = $state<Panel>('rows')
	let previewMode   = $state<'desktop' | 'tablet' | 'mobile'>('desktop')
	let selectedCol   = $state<{ rowId: string; colId: string } | null>(null)
	let editRowId     = $state<string | null>(null) // édition paramètres ligne
	let showPicker    = $state<{ rowId: string; colId: string } | null>(null)
	let showAddRow    = $state(false)
	let searchWidget  = $state('')
	let pickerFamily  = $state<WidgetFamily | ''>('')

	// ── Drag & Drop lignes ────────────────────────────────────────────────────
	let dragRowId     = $state<string | null>(null)
	let dragOverIdx   = $state<number | null>(null)
	let dragStartIdx  = $state<number | null>(null)

	// ── Resize colonnes ───────────────────────────────────────────────────────
	interface ResizeState {
		rowId:      string
		colIdx:     number   // index de la colonne gauche
		startX:     number
		startSpans: number[] // spans au début du drag
		containerW: number
	}
	let resizing = $state<ResizeState | null>(null)

	// ── Helpers ───────────────────────────────────────────────────────────────
	function toast(text: string, ok = true) {
		const id = ++toastId
		toasts = [...toasts, { id, text, ok }]
		setTimeout(() => { toasts = toasts.filter(t => t.id !== id) }, 3000)
	}
	function getToken() { return ($page.data as any).token as string ?? '' }

	function markUnsaved() { unsaved = true }

	const selectedColKey = $derived(
		selectedCol ? `${selectedCol.rowId}:${selectedCol.colId}` : null
	)

	// Ligne sélectionnée (pour édition paramètres)
	const editRow = $derived(
		editRowId ? draft.rows.find(r => r.id === editRowId) ?? null : null
	)

	// Colonne + plugin sélectionnés
	const selRow = $derived(selectedCol ? draft.rows.find(r => r.id === selectedCol!.rowId) ?? null : null)
	const selCol = $derived(selectedCol && selRow ? selRow.columns.find(c => c.id === selectedCol!.colId) ?? null : null)
	const selPlugin = $derived(selCol?.widget ? (PLUGIN_REGISTRY[selCol.widget] ?? null) : null)

	// Formulaire config widget
	let configFields = $state<Record<string, unknown>>({})

	function openColConfig(rowId: string, colId: string) {
		selectedCol = { rowId, colId }
		activePanel = 'config'
		const row = draft.rows.find(r => r.id === rowId)
		const col = row?.columns.find(c => c.id === colId)
		if (col) {
			const plugin = col.widget ? PLUGIN_REGISTRY[col.widget] : null
			const fields: Record<string, unknown> = {}
			for (const f of (plugin?.schema ?? [])) {
				fields[f.key] = col.config[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '')
			}
			configFields = { ...col.config, ...fields }
		}
	}

	function applyConfig() {
		if (!selectedCol) return
		draft = {
			...draft,
			rows: draft.rows.map(r => r.id !== selectedCol!.rowId ? r : {
				...r,
				columns: r.columns.map(c => c.id !== selectedCol!.colId ? c : {
					...c,
					config: { ...configFields }
				})
			})
		}
		markUnsaved()
		toast('Config appliquée')
	}

	function clearWidget(rowId: string, colId: string) {
		draft = {
			...draft,
			rows: draft.rows.map(r => r.id !== rowId ? r : {
				...r,
				columns: r.columns.map(c => c.id !== colId ? c : { ...c, widget: null, config: {} })
			})
		}
		selectedCol = null
		activePanel = 'rows'
		markUnsaved()
	}

	// ── Widget picker ─────────────────────────────────────────────────────────
	const pickerPlugins = $derived(
		PLUGIN_LIST.filter(p => {
			const matchSearch = !searchWidget || p.label.toLowerCase().includes(searchWidget.toLowerCase()) || p.id.toLowerCase().includes(searchWidget.toLowerCase())
			const matchFamily = !pickerFamily || p.family === pickerFamily
			return matchSearch && matchFamily
		})
	)
	const FAMILIES: { id: WidgetFamily | ''; label: string; icon: string }[] = [
		{ id: '',          label: 'Tous',      icon: '⬛' },
		{ id: 'media',     label: 'Média',     icon: '📺' },
		{ id: 'gaming',    label: 'Gaming',    icon: '🎮' },
		{ id: 'community', label: 'Community', icon: '🏘️' },
		{ id: 'esport',    label: 'Esport',    icon: '🏆' },
		{ id: 'social',    label: 'Social',    icon: '🌐' },
		{ id: 'content',   label: 'Contenu',   icon: '📰' },
	]
	const FAMILY_COLOR: Record<string, string> = {
		media: '#a78bfa', gaming: '#06b6d4', community: '#4ade80',
		esport: '#f97316', social: '#3b82f6', content: '#94a3b8',
	}

	function placeWidget(plugin: WidgetPlugin) {
		if (!showPicker) return
		const { rowId, colId } = showPicker
		// Initialise config avec les defaults du schema
		const config: Record<string, unknown> = {}
		for (const f of plugin.schema) {
			if (f.default !== undefined) config[f.key] = f.default
		}
		draft = {
			...draft,
			rows: draft.rows.map(r => r.id !== rowId ? r : {
				...r,
				columns: r.columns.map(c => c.id !== colId ? c : {
					...c, widget: plugin.id, config
				})
			})
		}
		showPicker = null
		markUnsaved()
		openColConfig(rowId, colId)
	}

	// ── Gestion lignes ────────────────────────────────────────────────────────
	function addRow(structure: number[] | number) {
		const newRow = Array.isArray(structure)
			? makeRowFromSpans(structure)
			: makeRow(structure)
		draft = { ...draft, rows: [...draft.rows, newRow] }
		showAddRow = false
		markUnsaved()
	}

	function deleteRow(rowId: string) {
		if (!confirm('Supprimer cette ligne ?')) return
		draft = { ...draft, rows: draft.rows.filter(r => r.id !== rowId) }
		if (editRowId === rowId) { editRowId = null; activePanel = 'rows' }
		if (selectedCol?.rowId === rowId) { selectedCol = null; activePanel = 'rows' }
		markUnsaved()
	}

	function addColumn(rowId: string) {
		const row = draft.rows.find(r => r.id === rowId)
		if (!row) return
		const currentSum = row.columns.reduce((s, c) => s + c.span, 0)
		if (currentSum >= 12) { toast('La ligne est déjà à 12/12', false); return }
		const newSpan = Math.min(2, 12 - currentSum)
		const lastCol = row.columns[row.columns.length - 1]
		if (lastCol && lastCol.span > newSpan) {
			// Réduire la dernière colonne pour faire de la place
			const newCols = row.columns.map((c, i) =>
				i === row.columns.length - 1 ? { ...c, span: c.span - newSpan } : c
			)
			newCols.push({ id: genId(), span: newSpan, widget: null, config: {} })
			draft = { ...draft, rows: draft.rows.map(r => r.id !== rowId ? r : { ...r, columns: newCols }) }
		} else {
			toast('Pas assez de place (span restant < 2)', false)
			return
		}
		markUnsaved()
	}

	function removeColumn(rowId: string, colId: string) {
		const row = draft.rows.find(r => r.id === rowId)
		if (!row || row.columns.length <= 1) return
		const removedSpan = row.columns.find(c => c.id === colId)?.span ?? 0
		const remaining = row.columns.filter(c => c.id !== colId)
		// Distribue le span supprimé à la colonne précédente (ou suivante)
		if (remaining.length > 0) remaining[remaining.length - 1].span += removedSpan
		draft = { ...draft, rows: draft.rows.map(r => r.id !== rowId ? r : { ...r, columns: remaining }) }
		if (selectedCol?.colId === colId) { selectedCol = null; activePanel = 'rows' }
		markUnsaved()
	}

	// Mise à jour paramètres ligne (gap, padding_y, bg_override)
	function updateRowParam(rowId: string, key: keyof GridRow, value: string) {
		draft = {
			...draft,
			rows: draft.rows.map(r => r.id !== rowId ? r : { ...r, [key]: value })
		}
		markUnsaved()
	}

	// ── Drag & Drop lignes ────────────────────────────────────────────────────
	function onRowDragStart(e: PointerEvent, rowId: string) {
		e.preventDefault()
		const idx = draft.rows.findIndex(r => r.id === rowId)
		dragRowId    = rowId
		dragStartIdx = idx
		dragOverIdx  = idx
		window.addEventListener('pointermove', onDragGlobalMove)
		window.addEventListener('pointerup',   onDragGlobalEnd)
	}

	function onDragGlobalMove(e: PointerEvent) {
		if (!dragRowId) return
		// Trouve la row sous le curseur via data-row-id (panel ou canvas)
		const el    = document.elementFromPoint(e.clientX, e.clientY)
		const rowEl = el?.closest('[data-row-id]') as HTMLElement | null
		if (rowEl?.dataset.rowId) {
			const idx = draft.rows.findIndex(r => r.id === rowEl.dataset.rowId)
			if (idx >= 0) dragOverIdx = idx
		}
	}

	function onDragGlobalEnd() {
		if (dragOverIdx !== null) onRowDrop(dragOverIdx)
		window.removeEventListener('pointermove', onDragGlobalMove)
		window.removeEventListener('pointerup',   onDragGlobalEnd)
	}

	function onRowDrop(targetIdx: number) {
		if (dragRowId === null || dragStartIdx === null) return
		if (dragStartIdx !== targetIdx) {
			const rows = [...draft.rows]
			const [moved] = rows.splice(dragStartIdx, 1)
			rows.splice(targetIdx, 0, moved)
			draft = { ...draft, rows }
			markUnsaved()
		}
		dragRowId    = null
		dragStartIdx = null
		dragOverIdx  = null
	}

	// ── Resize colonnes (pointer events natifs) ───────────────────────────────
	function onResizeStart(e: PointerEvent, rowId: string, colIdx: number) {
		e.preventDefault()
		const row = draft.rows.find(r => r.id === rowId)
		if (!row) return
		const container = (e.currentTarget as HTMLElement).closest('.gr-row') as HTMLElement | null
		const containerW = container?.getBoundingClientRect().width ?? 1200
		resizing = {
			rowId, colIdx,
			startX:     e.clientX,
			startSpans: row.columns.map(c => c.span),
			containerW,
		}
		window.addEventListener('pointermove', onResizeMove)
		window.addEventListener('pointerup',   onResizeEnd)
	}

	function onResizeMove(e: PointerEvent) {
		if (!resizing) return
		const dx    = e.clientX - resizing.startX
		const colW  = resizing.containerW / 12
		const delta = Math.round(dx / colW)
		if (delta === 0) return

		const spans    = [...resizing.startSpans]
		const ci       = resizing.colIdx
		const newLeft  = Math.max(2, spans[ci] + delta)
		const newRight = Math.max(2, spans[ci + 1] - delta)

		// Vérifie que la somme reste 12
		const otherSum = spans.reduce((s, v, i) => (i === ci || i === ci + 1) ? s : s + v, 0)
		if (newLeft + newRight + otherSum !== 12) return

		draft = {
			...draft,
			rows: draft.rows.map(r => r.id !== resizing!.rowId ? r : {
				...r,
				columns: r.columns.map((c, i) => {
					if (i === ci)     return { ...c, span: newLeft }
					if (i === ci + 1) return { ...c, span: newRight }
					return c
				})
			})
		}
	}

	function onResizeEnd() {
		if (resizing) markUnsaved()
		resizing = null
		window.removeEventListener('pointermove', onResizeMove)
		window.removeEventListener('pointerup',   onResizeEnd)
	}

	// ── Theme editor ──────────────────────────────────────────────────────────
	const FONTS = [
		'Space Grotesk', 'Inter', 'DM Sans', 'Sora', 'Outfit',
		'Nunito', 'Poppins', 'Raleway', 'Rubik', 'Manrope',
	]

	function updateTheme<K extends keyof GridTheme>(key: K, value: GridTheme[K]) {
		theme = { ...theme, [key]: value }
		markUnsaved()
	}

	// ── Save / Publish ────────────────────────────────────────────────────────
	async function saveDraft() {
		saving = true
		try {
			const res = await fetch('/api/v1/admin/homepage/grid/draft', {
				method:  'PUT',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
				body:    JSON.stringify({ layout: draft, theme }),
			})
			if (!res.ok) throw new Error()
			unsaved = false
			toast('Brouillon sauvegardé')
		} catch {
			toast('Erreur de sauvegarde', false)
		} finally {
			saving = false
		}
	}

	async function publish() {
		// Sauvegarde d'abord le draft si nécessaire
		if (unsaved) await saveDraft()
		publishing = true
		try {
			const res = await fetch('/api/v1/admin/homepage/grid/publish', {
				method:  'POST',
				headers: { Authorization: `Bearer ${getToken()}` },
			})
			if (!res.ok) throw new Error()
			toast('Publié — la homepage est mise à jour')
		} catch {
			toast('Erreur lors de la publication', false)
		} finally {
			publishing = false
		}
	}

	async function revert() {
		if (!confirm('Annuler les modifications et revenir à la version publiée ?')) return
		try {
			await fetch('/api/v1/admin/homepage/grid/revert', {
				method:  'POST',
				headers: { Authorization: `Bearer ${getToken()}` },
			})
			draft   = (data.published as GridLayout | null) ?? { rows: [] }
			unsaved = false
			toast('Revenu à la version publiée')
		} catch {
			toast('Erreur', false)
		}
	}

	// ── Panel config custom : Diaporama ──────────────────────────────────────
	type SlideshowSource =
		| { type: 'articles';  limit?: number; category_id?: string }
		| { type: 'video';     title: string; url: string; excerpt?: string; thumbnail?: string; cta_url?: string; cta_text?: string; label?: string }
		| { type: 'custom';    title: string; image_url?: string; excerpt?: string; category_label?: string; cta_url?: string; cta_text?: string }

	// State local du panel diaporama (synchronisé avec configFields)
	let ssShowJson    = $state(false)
	let ssJsonRaw     = $state('')
	let ssJsonError   = $state('')
	let ssEditIdx     = $state<number | null>(null)  // index de la source en cours d'édition
	let ssEditBuf     = $state<Partial<SlideshowSource>>({})  // buffer formulaire édition

	function ssSources(): SlideshowSource[] {
		return (configFields.sources as SlideshowSource[] | undefined) ?? []
	}
	function ssSlideMs(): number  { return (configFields.slide_ms      as number  | undefined) ?? 6000 }
	function ssHeight():  string  { return (configFields.height         as string  | undefined) ?? '420px' }
	function ssExcerpt(): boolean { return (configFields.show_excerpt   as boolean | undefined) ?? true }

	function ssApply(sources: SlideshowSource[], opts?: { slide_ms?: number; height?: string; show_excerpt?: boolean }) {
		configFields = {
			...configFields,
			sources,
			slide_ms:     opts?.slide_ms     ?? ssSlideMs(),
			height:       opts?.height       ?? ssHeight(),
			show_excerpt: opts?.show_excerpt  ?? ssExcerpt(),
		}
		applyConfig()
	}

	function ssAddSource(type: SlideshowSource['type']) {
		const src: SlideshowSource =
			type === 'articles' ? { type: 'articles', limit: 5 } :
			type === 'video'    ? { type: 'video',    title: 'Ma vidéo', url: '' } :
			                      { type: 'custom',   title: 'Mon slide', cta_url: '', cta_text: 'Voir' }
		const sources = [...ssSources(), src]
		ssApply(sources as SlideshowSource[])
		ssEditIdx = sources.length - 1
		ssEditBuf = { ...src }
	}

	function ssRemoveSource(i: number) {
		const sources = ssSources().filter((_, idx) => idx !== i)
		if (ssEditIdx === i) { ssEditIdx = null; ssEditBuf = {} }
		ssApply(sources)
	}

	function ssMoveSource(i: number, dir: -1 | 1) {
		const sources = [...ssSources()]
		const j = i + dir
		if (j < 0 || j >= sources.length) return
		;[sources[i], sources[j]] = [sources[j], sources[i]]
		ssApply(sources)
		if (ssEditIdx === i) ssEditIdx = j
		else if (ssEditIdx === j) ssEditIdx = i
	}

	function ssOpenEdit(i: number) {
		ssEditIdx = i
		ssEditBuf = { ...ssSources()[i] }
	}

	function ssApplyEdit() {
		if (ssEditIdx === null) return
		const sources = ssSources().map((s, i) =>
			i === ssEditIdx ? (ssEditBuf as SlideshowSource) : s
		)
		ssApply(sources)
		ssEditIdx = null
		ssEditBuf = {}
	}

	function ssOpenJson() {
		ssJsonRaw   = JSON.stringify(configFields, null, 2)
		ssJsonError = ''
		ssShowJson  = true
	}

	function ssApplyJson() {
		try {
			const parsed = JSON.parse(ssJsonRaw)
			configFields = parsed
			applyConfig()
			ssShowJson  = false
			ssJsonError = ''
		} catch {
			ssJsonError = 'JSON invalide'
		}
	}

	const SS_SOURCE_LABELS: Record<string, string> = {
		articles: '📰 Articles',
		video:    '▶ Vidéo',
		custom:   '✎ Slide custom',
	}

	// ── Panel config custom : Liens sociaux ──────────────────────────────────
	const SOCIAL_NETWORKS = [
		// Social
		{ id: 'discord',     label: 'Discord'      },
		{ id: 'twitter',     label: 'X / Twitter'  },
		{ id: 'threads',     label: 'Threads'      },
		{ id: 'facebook',    label: 'Facebook'     },
		{ id: 'instagram',   label: 'Instagram'    },
		{ id: 'snapchat',    label: 'Snapchat'     },
		{ id: 'reddit',      label: 'Reddit'       },
		{ id: 'pinterest',   label: 'Pinterest'    },
		{ id: 'mastodon',    label: 'Mastodon'     },
		{ id: 'bluesky',     label: 'Bluesky'      },
		{ id: 'linkedin',    label: 'LinkedIn'     },
		// Streaming & Vidéo
		{ id: 'twitch',      label: 'Twitch'       },
		{ id: 'youtube',     label: 'YouTube'      },
		{ id: 'kick',        label: 'Kick'         },
		{ id: 'rumble',      label: 'Rumble'       },
		{ id: 'tiktok',      label: 'TikTok'       },
		{ id: 'odysee',      label: 'Odysee'       },
		// Gaming
		{ id: 'steam',       label: 'Steam'        },
		{ id: 'epic_games',  label: 'Epic Games'   },
		{ id: 'gog',         label: 'GOG'          },
		{ id: 'itch_io',     label: 'itch.io'      },
		{ id: 'battle_net',  label: 'Battle.net'   },
		{ id: 'ea',          label: 'EA'           },
		{ id: 'ubisoft',     label: 'Ubisoft'      },
		// Art & Créa
		{ id: 'artstation',  label: 'ArtStation'   },
		{ id: 'deviantart',  label: 'DeviantArt'   },
		{ id: 'behance',     label: 'Behance'      },
		{ id: 'dribbble',    label: 'Dribbble'     },
		{ id: 'pixiv',       label: 'Pixiv'        },
		{ id: 'sketchfab',   label: 'Sketchfab'    },
		// Musique
		{ id: 'spotify',     label: 'Spotify'      },
		{ id: 'soundcloud',  label: 'SoundCloud'   },
		{ id: 'bandcamp',    label: 'Bandcamp'     },
		// Créateur / Financement
		{ id: 'patreon',     label: 'Patreon'      },
		{ id: 'ko_fi',       label: 'Ko-fi'        },
		{ id: 'kickstarter', label: 'Kickstarter'  },
		{ id: 'substack',    label: 'Substack'     },
		{ id: 'medium',      label: 'Medium'       },
		// Dev
		{ id: 'github',      label: 'GitHub'       },
		{ id: 'gitlab',      label: 'GitLab'       },
		{ id: 'npm',         label: 'npm'          },
		{ id: 'bitbucket',   label: 'Bitbucket'    },
		// Autre
		{ id: 'custom',      label: 'Lien custom'  },
	]

	function slLinks(): { type: string; url: string; label?: string }[] {
		return (configFields.links as any[] | undefined) ?? []
	}
	function slApply(links: { type: string; url: string; label?: string }[], extra?: Record<string, unknown>) {
		configFields = { ...configFields, links, ...(extra ?? {}) }
		applyConfig()
	}
	function slAddLink() {
		slApply([...slLinks(), { type: 'discord', url: '' }])
	}
	function slRemoveLink(i: number) {
		slApply(slLinks().filter((_, idx) => idx !== i))
	}
	function slUpdateLink(i: number, field: string, value: string) {
		const links = slLinks().map((l, idx) => idx === i ? { ...l, [field]: value } : l)
		slApply(links)
	}
	function slMoveLink(i: number, dir: -1 | 1) {
		const links = [...slLinks()]
		const j = i + dir
		if (j < 0 || j >= links.length) return
		;[links[i], links[j]] = [links[j], links[i]]
		slApply(links)
	}

	// ── Preview width ─────────────────────────────────────────────────────────
	const PREVIEW_W: Record<string, string> = {
		desktop: '100%',
		tablet:  '768px',
		mobile:  '390px',
	}

	// ── Add row presets ───────────────────────────────────────────────────────
	const ROW_PRESETS: { label: string; spans: number[] | number; preview: string }[] = [
		{ label: '1 colonne',   spans: 1,        preview: '████████████' },
		{ label: '2 égales',    spans: 2,        preview: '██████ ██████' },
		{ label: '3 égales',    spans: 3,        preview: '████ ████ ████' },
		{ label: '4 égales',    spans: 4,        preview: '███ ███ ███ ███' },
		{ label: '8 + 4',       spans: [8,4],    preview: '████████ ████' },
		{ label: '4 + 8',       spans: [4,8],    preview: '████ ████████' },
		{ label: '6 + 3 + 3',   spans: [6,3,3],  preview: '██████ ███ ███' },
		{ label: '3 + 6 + 3',   spans: [3,6,3],  preview: '███ ██████ ███' },
		{ label: '4 + 4 + 4',   spans: [4,4,4],  preview: '████ ████ ████' },
		{ label: '7 + 5',       spans: [7,5],    preview: '███████ █████' },
		{ label: '5 + 7',       spans: [5,7],    preview: '█████ ███████' },
		{ label: '2 + 8 + 2',   spans: [2,8,2],  preview: '██ ████████ ██' },
	]
</script>

<svelte:head><title>Grid Builder — Admin</title></svelte:head>

<!-- ── Toasts ───────────────────────────────────────────────────────────────── -->
<div class="toasts">
	{#each toasts as t (t.id)}
		<div class="toast" class:toast--err={!t.ok}>{t.text}</div>
	{/each}
</div>

<!-- ── Layout principal ──────────────────────────────────────────────────────── -->
<div class="builder">

	<!-- ════════════════════════════════════════════════════════════════
	     PANEL GAUCHE
	═══════════════════════════════════════════════════════════════════ -->
	<aside class="panel">

		<!-- Tabs -->
		<div class="panel-tabs">
			<button class="ptab" class:ptab--active={activePanel === 'rows' || activePanel === 'rowsettings' || activePanel === 'config'} onclick={() => activePanel = 'rows'}>
				Lignes
			</button>
			<button class="ptab" class:ptab--active={activePanel === 'theme'} onclick={() => activePanel = 'theme'}>
				Thème
			</button>
		</div>

		<!-- ── Panel : liste des lignes ─────────────────────────────── -->
		{#if activePanel === 'rows'}
			<div class="panel-body">
				<div class="panel-section-title">Structure de la page</div>

				{#if draft.rows.length === 0}
					<div class="panel-empty">
						Aucune ligne. Cliquez sur <strong>+ Ligne</strong> pour démarrer.
					</div>
				{:else}
					<div class="row-list">
						{#each draft.rows as row, idx (row.id)}
							<div
								class="row-item"
								class:row-item--drag={dragRowId === row.id}
								class:row-item--dragover={dragOverIdx === idx && dragRowId !== row.id}
								data-row-id={row.id}
								role="listitem"
							>
								<!-- Handle drag -->
								<button
									class="row-item-handle"
									onpointerdown={(e) => onRowDragStart(e, row.id)}
									title="Déplacer"
								>⠿</button>

								<!-- Aperçu spans -->
								<div class="row-item-spans">
									{#each row.columns as col}
										<div class="row-item-span" style="flex:{col.span}; background:{col.widget ? '#a78bfa22' : 'rgba(255,255,255,.06)'}; border-color:{col.widget ? '#a78bfa55' : 'rgba(255,255,255,.1)'}">
											{col.span}
											{#if col.widget}<span class="row-item-w">{PLUGIN_REGISTRY[col.widget]?.icon ?? '⬛'}</span>{/if}
										</div>
									{/each}
								</div>

								<!-- Actions -->
								<div class="row-item-actions">
									<button class="riba" title="Paramètres" onclick={() => { editRowId = row.id; activePanel = 'rowsettings' }}>⚙</button>
									<button class="riba riba--del" title="Supprimer" onclick={() => deleteRow(row.id)}>✕</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<button class="btn-add-row" onclick={() => showAddRow = true}>
					+ Ajouter une ligne
				</button>
			</div>

		<!-- ── Panel : paramètres d'une ligne ───────────────────────── -->
		{:else if activePanel === 'rowsettings' && editRow}
			<div class="panel-body">
				<button class="panel-back" onclick={() => { activePanel = 'rows'; editRowId = null }}>← Lignes</button>
				<div class="panel-section-title">Paramètres — ligne</div>

				<label class="pfield">
					<span>Espacement colonnes</span>
					<select value={editRow.gap} onchange={(e) => updateRowParam(editRow!.id, 'gap', (e.target as HTMLSelectElement).value)}>
						<option value="0">Aucun</option>
						<option value="0.5rem">Serré (0.5rem)</option>
						<option value="1rem">Normal (1rem)</option>
						<option value="2rem">Large (2rem)</option>
						<option value="3rem">Très large (3rem)</option>
					</select>
				</label>

				<label class="pfield">
					<span>Padding vertical</span>
					<select value={editRow.padding_y} onchange={(e) => updateRowParam(editRow!.id, 'padding_y', (e.target as HTMLSelectElement).value)}>
						<option value="0">Aucun</option>
						<option value="1rem">Petit (1rem)</option>
						<option value="2rem">Normal (2rem)</option>
						<option value="3rem">Grand (3rem)</option>
						<option value="5rem">Très grand (5rem)</option>
					</select>
				</label>

				<label class="pfield">
					<span>Couleur de fond (override)</span>
					<div class="pfield-color">
						<input type="color" value={editRow.bg_override ?? '#05050a'}
							oninput={(e) => updateRowParam(editRow!.id, 'bg_override', (e.target as HTMLInputElement).value)}
						/>
						<input type="text" value={editRow.bg_override ?? ''}
							placeholder="rgba(…) ou #hex ou vide"
							onchange={(e) => updateRowParam(editRow!.id, 'bg_override', (e.target as HTMLInputElement).value)}
						/>
						{#if editRow.bg_override}
							<button class="pfield-clear" onclick={() => updateRowParam(editRow!.id, 'bg_override', '')}>✕</button>
						{/if}
					</div>
				</label>

				<div class="panel-section-title" style="margin-top:16px">Colonnes</div>
				<div class="col-manager">
					{#each editRow.columns as col, ci}
						<div class="col-mgr-row">
							<span class="col-mgr-widget">{col.widget ? (PLUGIN_REGISTRY[col.widget]?.icon ?? '⬛') + ' ' + col.widget : '(vide)'}</span>
							<span class="col-mgr-span">span {col.span}</span>
							{#if editRow.columns.length > 1}
								<button class="col-mgr-del" onclick={() => removeColumn(editRow!.id, col.id)}>✕</button>
							{/if}
						</div>
					{/each}
					{#if editRow.columns.reduce((s,c)=>s+c.span,0) < 12}
						<button class="btn-add-col" onclick={() => addColumn(editRow!.id)}>+ Colonne</button>
					{/if}
				</div>
			</div>

		<!-- ── Panel : config widget ─────────────────────────────────── -->
		{:else if activePanel === 'config' && selCol}
			<div class="panel-body">
				<button class="panel-back" onclick={() => { activePanel = 'rows'; selectedCol = null }}>← Lignes</button>
				<div class="panel-section-title">
					{selPlugin ? `${selPlugin.icon} ${selPlugin.label}` : selCol.widget ?? 'Widget'}
				</div>

				{#if selPlugin?.customPanel && selPlugin.id === 'social-links-bar'}
					<!-- ══ Panel custom : Liens sociaux ══ -->
					<div class="panel-section-title">Liens</div>

					{#if slLinks().length === 0}
						<div class="panel-empty">Aucun lien. Ajoutez-en un ci-dessous.</div>
					{:else}
						<div class="sl-editor">
							{#each slLinks() as link, i}
								<div class="sl-row">
									<select
										class="sl-select"
										value={link.type}
										onchange={(e) => slUpdateLink(i, 'type', (e.target as HTMLSelectElement).value)}
									>
										{#each SOCIAL_NETWORKS as n}
											<option value={n.id}>{n.label}</option>
										{/each}
									</select>
									<input
										class="sl-input"
										type="url"
										value={link.url}
										placeholder="https://..."
										oninput={(e) => slUpdateLink(i, 'url', (e.target as HTMLInputElement).value)}
									/>
									<div class="ss-src-actions">
										<button class="ss-src-btn" onclick={() => slMoveLink(i, -1)} disabled={i === 0}>↑</button>
										<button class="ss-src-btn" onclick={() => slMoveLink(i, 1)} disabled={i === slLinks().length - 1}>↓</button>
										<button class="ss-src-btn ss-src-btn--del" onclick={() => slRemoveLink(i)}>✕</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<button class="ss-add-btn" style="margin-top:6px" onclick={slAddLink}>+ Ajouter un réseau</button>

					<div class="panel-section-title" style="margin-top:12px">Réglages</div>

					<label class="pfield">
						<span>Style</span>
						<select value={(configFields.style as string) ?? 'icons'}
							onchange={(e) => { configFields = { ...configFields, style: (e.target as HTMLSelectElement).value }; applyConfig() }}
						>
							<option value="icons">Icônes seules</option>
							<option value="pills">Pills avec fond</option>
						</select>
					</label>
					<label class="pfield">
						<span>Alignement</span>
						<select value={(configFields.align as string) ?? 'center'}
							onchange={(e) => { configFields = { ...configFields, align: (e.target as HTMLSelectElement).value }; applyConfig() }}
						>
							<option value="flex-start">Gauche</option>
							<option value="center">Centre</option>
							<option value="flex-end">Droite</option>
						</select>
					</label>
					<label class="pfield">
						<span>Taille icônes</span>
						<select value={(configFields.icon_size as string) ?? '22px'}
							onchange={(e) => { configFields = { ...configFields, icon_size: (e.target as HTMLSelectElement).value }; applyConfig() }}
						>
							<option value="18px">Petite (18px)</option>
							<option value="22px">Normale (22px)</option>
							<option value="28px">Grande (28px)</option>
							<option value="36px">Très grande (36px)</option>
						</select>
					</label>
					<label class="pfield">
						<span>Afficher les labels</span>
						<label class="ptoggle">
							<input type="checkbox" checked={!!(configFields.show_labels)}
								onchange={(e) => { configFields = { ...configFields, show_labels: (e.target as HTMLInputElement).checked }; applyConfig() }}
							/>
							<span class="ptoggle-track"><span class="ptoggle-thumb"></span></span>
						</label>
					</label>

					<div class="config-actions" style="margin-top:8px">
						<button class="btn-secondary" onclick={() => clearWidget(selectedCol!.rowId, selectedCol!.colId)}>Retirer</button>
					</div>

				{:else if selPlugin?.customPanel}
					<!-- ══ Panel custom : Diaporama ══ -->

					{#if ssShowJson}
						<!-- Mode JSON avancé -->
						<div class="panel-section-title">JSON brut</div>
						<textarea
							class="ss-json-area"
							rows="14"
							value={ssJsonRaw}
							oninput={(e) => { ssJsonRaw = (e.target as HTMLTextAreaElement).value; ssJsonError = '' }}
							spellcheck={false}
						></textarea>
						{#if ssJsonError}
							<p class="ss-json-err">{ssJsonError}</p>
						{/if}
						<div class="config-actions">
							<button class="btn-secondary" onclick={() => ssShowJson = false}>Annuler</button>
							<button class="btn-primary" onclick={ssApplyJson}>Appliquer</button>
						</div>

					{:else if ssEditIdx !== null}
						<!-- Formulaire édition d'une source -->
						{@const src = ssSources()[ssEditIdx]}
						<button class="panel-back" onclick={() => { ssEditIdx = null; ssEditBuf = {} }}>← Sources</button>
						<div class="panel-section-title">
							{SS_SOURCE_LABELS[src?.type ?? ''] ?? 'Source'}
						</div>

						{#if ssEditBuf.type === 'articles'}
							<label class="pfield">
								<span>Limite d'articles</span>
								<input type="number" min="1" max="10"
									value={(ssEditBuf as any).limit ?? 5}
									onchange={(e) => ssEditBuf = { ...ssEditBuf, limit: Number((e.target as HTMLInputElement).value) }}
								/>
							</label>
							<label class="pfield">
								<span>Catégorie (slug ou UUID)</span>
								<input type="text"
									value={(ssEditBuf as any).category_id ?? ''}
									placeholder="Vide = tous les articles mis en avant"
									oninput={(e) => ssEditBuf = { ...ssEditBuf, category_id: (e.target as HTMLInputElement).value || undefined }}
								/>
								<span class="pfield-hint">Laissez vide pour afficher les threads marqués "mis en avant"</span>
							</label>

						{:else if ssEditBuf.type === 'video'}
							<label class="pfield">
								<span>Titre *</span>
								<input type="text"
									value={(ssEditBuf as any).title ?? ''}
									placeholder="Titre de la vidéo"
									oninput={(e) => ssEditBuf = { ...ssEditBuf, title: (e.target as HTMLInputElement).value }}
								/>
							</label>
							<label class="pfield">
								<span>URL YouTube *</span>
								<input type="url"
									value={(ssEditBuf as any).url ?? ''}
									placeholder="https://youtube.com/watch?v=..."
									oninput={(e) => ssEditBuf = { ...ssEditBuf, url: (e.target as HTMLInputElement).value }}
								/>
								<span class="pfield-hint">La miniature est extraite automatiquement</span>
							</label>
							<label class="pfield">
								<span>Description</span>
								<input type="text"
									value={(ssEditBuf as any).excerpt ?? ''}
									placeholder="Sous-titre affiché sous le titre"
									oninput={(e) => ssEditBuf = { ...ssEditBuf, excerpt: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>
							<label class="pfield">
								<span>Label catégorie</span>
								<input type="text"
									value={(ssEditBuf as any).label ?? ''}
									placeholder="ex : Vidéo, Trailer, Live..."
									oninput={(e) => ssEditBuf = { ...ssEditBuf, label: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>
							<label class="pfield">
								<span>Miniature custom (URL image)</span>
								<input type="url"
									value={(ssEditBuf as any).thumbnail ?? ''}
									placeholder="Laissez vide = auto depuis YouTube"
									oninput={(e) => ssEditBuf = { ...ssEditBuf, thumbnail: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>

						{:else if ssEditBuf.type === 'custom'}
							<label class="pfield">
								<span>Titre *</span>
								<input type="text"
									value={(ssEditBuf as any).title ?? ''}
									placeholder="Titre du slide"
									oninput={(e) => ssEditBuf = { ...ssEditBuf, title: (e.target as HTMLInputElement).value }}
								/>
							</label>
							<label class="pfield">
								<span>Image de fond (URL)</span>
								<input type="url"
									value={(ssEditBuf as any).image_url ?? ''}
									placeholder="https://..."
									oninput={(e) => ssEditBuf = { ...ssEditBuf, image_url: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>
							<label class="pfield">
								<span>Description</span>
								<input type="text"
									value={(ssEditBuf as any).excerpt ?? ''}
									placeholder="Texte affiché sous le titre"
									oninput={(e) => ssEditBuf = { ...ssEditBuf, excerpt: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>
							<label class="pfield">
								<span>Label catégorie</span>
								<input type="text"
									value={(ssEditBuf as any).category_label ?? ''}
									placeholder="ex : Événement, Annonce..."
									oninput={(e) => ssEditBuf = { ...ssEditBuf, category_label: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>
							<label class="pfield">
								<span>URL du bouton CTA *</span>
								<input type="url"
									value={(ssEditBuf as any).cta_url ?? ''}
									placeholder="/events/... ou https://..."
									oninput={(e) => ssEditBuf = { ...ssEditBuf, cta_url: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>
							<label class="pfield">
								<span>Texte du bouton CTA</span>
								<input type="text"
									value={(ssEditBuf as any).cta_text ?? 'Voir'}
									oninput={(e) => ssEditBuf = { ...ssEditBuf, cta_text: (e.target as HTMLInputElement).value || undefined }}
								/>
							</label>
						{/if}

						<div class="config-actions">
							<button class="btn-secondary" onclick={() => { ssEditIdx = null; ssEditBuf = {} }}>Annuler</button>
							<button class="btn-primary" onclick={ssApplyEdit}>Appliquer</button>
						</div>

					{:else}
						<!-- Vue principale : liste des sources + réglages globaux -->
						<div class="panel-section-title">Sources</div>

						{#if ssSources().length === 0}
							<div class="panel-empty">Aucune source. Ajoutez-en une ci-dessous.</div>
						{:else}
							<div class="ss-sources">
								{#each ssSources() as src, i}
									<div class="ss-src-card">
										<span class="ss-src-label">{SS_SOURCE_LABELS[src.type] ?? src.type}</span>
										<span class="ss-src-desc">
											{#if src.type === 'articles'}
												{src.limit ?? 5} article(s){src.category_id ? ` · cat: ${src.category_id}` : ''}
											{:else if src.type === 'video'}
												{src.title}
											{:else}
												{src.title}
											{/if}
										</span>
										<div class="ss-src-actions">
											<button class="ss-src-btn" onclick={() => ssMoveSource(i, -1)} disabled={i === 0} title="Monter">↑</button>
											<button class="ss-src-btn" onclick={() => ssMoveSource(i, 1)} disabled={i === ssSources().length - 1} title="Descendre">↓</button>
											<button class="ss-src-btn" onclick={() => ssOpenEdit(i)} title="Éditer">⚙</button>
											<button class="ss-src-btn ss-src-btn--del" onclick={() => ssRemoveSource(i)} title="Supprimer">✕</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						<div class="ss-add-btns">
							<button class="ss-add-btn" onclick={() => ssAddSource('articles')}>+ Articles</button>
							<button class="ss-add-btn" onclick={() => ssAddSource('video')}>+ Vidéo</button>
							<button class="ss-add-btn" onclick={() => ssAddSource('custom')}>+ Custom</button>
						</div>

						<div class="panel-section-title" style="margin-top:12px">Réglages</div>

						<label class="pfield">
							<span>Vitesse autoplay (ms)</span>
							<input type="number" min="2000" max="15000" step="500"
								value={ssSlideMs()}
								onchange={(e) => ssApply(ssSources(), { slide_ms: Number((e.target as HTMLInputElement).value) })}
							/>
						</label>
						<label class="pfield">
							<span>Hauteur</span>
							<input type="text"
								value={ssHeight()}
								placeholder="420px"
								onchange={(e) => ssApply(ssSources(), { height: (e.target as HTMLInputElement).value })}
							/>
						</label>
						<label class="pfield">
							<span>Afficher l'excerpt</span>
							<label class="ptoggle">
								<input type="checkbox" checked={ssExcerpt()}
									onchange={(e) => ssApply(ssSources(), { show_excerpt: (e.target as HTMLInputElement).checked })}
								/>
								<span class="ptoggle-track"><span class="ptoggle-thumb"></span></span>
							</label>
						</label>

						<div class="ss-advanced">
							<button class="ss-json-btn" onclick={ssOpenJson}>&#123;&#125; JSON avancé</button>
						</div>

						<div class="config-actions" style="margin-top:8px">
							<button class="btn-secondary" onclick={() => clearWidget(selectedCol!.rowId, selectedCol!.colId)}>Retirer</button>
						</div>
					{/if}

				{:else if selPlugin && selPlugin.schema.length > 0}
					{#each selPlugin.schema as field}
						<label class="pfield">
							<span>{field.label}</span>
							{#if field.hint}<span class="pfield-hint">{field.hint}</span>{/if}

							{#if field.type === 'boolean'}
								<label class="ptoggle">
									<input type="checkbox" checked={!!configFields[field.key]}
										onchange={(e) => { configFields = { ...configFields, [field.key]: (e.target as HTMLInputElement).checked } }}
									/>
									<span class="ptoggle-track"><span class="ptoggle-thumb"></span></span>
								</label>
							{:else if field.type === 'select'}
								<select value={configFields[field.key] as string ?? ''}
									onchange={(e) => { configFields = { ...configFields, [field.key]: (e.target as HTMLSelectElement).value } }}
								>
									{#each field.options ?? [] as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else if field.type === 'textarea'}
								<textarea rows="4" value={configFields[field.key] as string ?? ''}
									oninput={(e) => { configFields = { ...configFields, [field.key]: (e.target as HTMLTextAreaElement).value } }}
									placeholder={field.placeholder}
								></textarea>
							{:else if field.type === 'number'}
								<input type="number"
									value={configFields[field.key] as number ?? field.default ?? 0}
									min={field.min} max={field.max}
									onchange={(e) => { configFields = { ...configFields, [field.key]: Number((e.target as HTMLInputElement).value) } }}
								/>
							{:else if field.type === 'color'}
								<div class="pfield-color">
									<input type="color" value={configFields[field.key] as string ?? '#a78bfa'}
										oninput={(e) => { configFields = { ...configFields, [field.key]: (e.target as HTMLInputElement).value } }}
									/>
									<input type="text" value={configFields[field.key] as string ?? ''}
										onchange={(e) => { configFields = { ...configFields, [field.key]: (e.target as HTMLInputElement).value } }}
									/>
								</div>
							{:else}
								<input type={field.type === 'url' ? 'url' : field.type === 'image' ? 'url' : 'text'}
									value={configFields[field.key] as string ?? ''}
									placeholder={field.placeholder}
									oninput={(e) => { configFields = { ...configFields, [field.key]: (e.target as HTMLInputElement).value } }}
								/>
							{/if}
						</label>
					{/each}

					<div class="config-actions">
						<button class="btn-secondary" onclick={() => clearWidget(selectedCol!.rowId, selectedCol!.colId)}>Retirer le widget</button>
						<button class="btn-primary" onclick={applyConfig}>Appliquer</button>
					</div>
				{:else}
					<div class="panel-empty">Ce widget n'a pas de configuration.</div>
					<button class="btn-secondary" onclick={() => clearWidget(selectedCol!.rowId, selectedCol!.colId)}>Retirer le widget</button>
				{/if}
			</div>

		<!-- ── Panel : thème ─────────────────────────────────────────── -->
		{:else if activePanel === 'theme'}
			<div class="panel-body">
				<div class="panel-section-title">Couleurs</div>

				{#each [
					{ key: 'primary',       label: 'Couleur principale' },
					{ key: 'accent',        label: 'Couleur accent' },
					{ key: 'bg',            label: 'Fond de page' },
					{ key: 'text_primary',  label: 'Texte principal' },
					{ key: 'text_secondary',label: 'Texte secondaire' },
				] as f}
					<label class="pfield">
						<span>{f.label}</span>
						<div class="pfield-color">
							<input type="color" value={theme[f.key as keyof GridTheme] as string}
								oninput={(e) => updateTheme(f.key as keyof GridTheme, (e.target as HTMLInputElement).value as any)}
							/>
							<input type="text" value={theme[f.key as keyof GridTheme] as string}
								onchange={(e) => updateTheme(f.key as keyof GridTheme, (e.target as HTMLInputElement).value as any)}
							/>
						</div>
					</label>
				{/each}

				<div class="panel-section-title" style="margin-top:8px">Fonds & Bordures</div>
				{#each [
					{ key: 'card_bg',      label: 'Fond des cartes' },
					{ key: 'border_color', label: 'Couleur des bordures' },
				] as f}
					<label class="pfield">
						<span>{f.label}</span>
						<input type="text" value={theme[f.key as keyof GridTheme] as string}
							placeholder="rgba(...) ou #hex"
							onchange={(e) => updateTheme(f.key as keyof GridTheme, (e.target as HTMLInputElement).value as any)}
						/>
					</label>
				{/each}

				<div class="panel-section-title" style="margin-top:8px">Typographie</div>

				<label class="pfield">
					<span>Police</span>
					<select value={theme.font_family} onchange={(e) => updateTheme('font_family', (e.target as HTMLSelectElement).value)}>
						{#each FONTS as f}
							<option value={f}>{f}</option>
						{/each}
					</select>
				</label>

				<label class="pfield">
					<span>Taille base ({theme.font_size_base})</span>
					<input type="range" min="13" max="18" step="1"
						value={parseInt(theme.font_size_base)}
						oninput={(e) => updateTheme('font_size_base', `${(e.target as HTMLInputElement).value}px`)}
					/>
				</label>

				<label class="pfield">
					<span>Graisse titres</span>
					<select value={theme.font_weight_heading} onchange={(e) => updateTheme('font_weight_heading', (e.target as HTMLSelectElement).value)}>
						<option value="400">400 — Normal</option>
						<option value="500">500 — Medium</option>
						<option value="600">600 — Semi-bold</option>
						<option value="700">700 — Bold</option>
						<option value="800">800 — Extra-bold</option>
					</select>
				</label>

				<div class="panel-section-title" style="margin-top:8px">Forme</div>

				<label class="pfield">
					<span>Arrondi ({theme.border_radius})</span>
					<input type="range" min="0" max="24" step="1"
						value={parseInt(theme.border_radius)}
						oninput={(e) => updateTheme('border_radius', `${(e.target as HTMLInputElement).value}px`)}
					/>
				</label>

				<label class="pfield">
					<span>Ombre</span>
					<input type="text" value={theme.shadow}
						onchange={(e) => updateTheme('shadow', (e.target as HTMLInputElement).value)}
					/>
				</label>
			</div>
		{/if}

	</aside>

	<!-- ════════════════════════════════════════════════════════════════
	     CANVAS PRINCIPAL
	═══════════════════════════════════════════════════════════════════ -->
	<div class="canvas-wrap">

		<!-- Toolbar -->
		<div class="canvas-toolbar">
			<div class="toolbar-preview">
				{#each (['desktop','tablet','mobile'] as const) as m}
					<button
						class="preview-btn"
						class:preview-btn--active={previewMode === m}
						onclick={() => previewMode = m}
						title={m}
					>
						{m === 'desktop' ? '🖥' : m === 'tablet' ? '▭' : '📱'}
						<span>{m === 'desktop' ? 'Desktop' : m === 'tablet' ? 'Tablette' : 'Mobile'}</span>
					</button>
				{/each}
			</div>

			<div class="toolbar-status">
				{#if unsaved}<span class="unsaved-dot"></span><span class="unsaved-label">Non sauvegardé</span>{/if}
			</div>

			<div class="toolbar-actions">
				<button class="btn-tool" onclick={revert} disabled={saving || publishing}>Annuler</button>
				<button class="btn-tool btn-tool--save" onclick={saveDraft} disabled={saving || publishing}>
					{saving ? 'Sauvegarde…' : 'Sauvegarder'}
				</button>
				<button class="btn-tool btn-tool--publish" onclick={publish} disabled={saving || publishing}>
					{publishing ? 'Publication…' : 'Publier'}
				</button>
			</div>
		</div>

		<!-- Bandeau draft -->
		{#if !data.published}
			<div class="draft-banner">
				Aucune version publiée — cliquez sur <strong>Publier</strong> pour mettre en ligne votre layout.
			</div>
		{/if}

		<!-- Preview container -->
		<div class="canvas-scroll">
			<div
				class="canvas-preview"
				style="max-width: {PREVIEW_W[previewMode]}; margin-left: {previewMode !== 'desktop' ? 'auto' : '0'}; margin-right: {previewMode !== 'desktop' ? 'auto' : '0'}"
			>
				{#if draft.rows.length === 0}
					<div class="canvas-empty">
						<div class="canvas-empty-icon">⬛</div>
						<div class="canvas-empty-title">Page vide</div>
						<div class="canvas-empty-sub">Ajoutez une ligne depuis le panel gauche pour démarrer.</div>
						<button class="btn-primary" style="margin-top:16px" onclick={() => showAddRow = true}>+ Ajouter une ligne</button>
					</div>
				{:else}
					<GridRenderer
						layout={draft}
						{theme}
						instance={{}}
						user={null}
						editMode={true}
						{selectedColKey}
						dragOverRowId={dragOverIdx !== null && dragRowId !== null ? (draft.rows[dragOverIdx]?.id ?? null) : null}
						onRowDragStart={(e, rowId) => onRowDragStart(e as PointerEvent, rowId)}
						onColClick={(rowId, colId) => openColConfig(rowId, colId)}
						onAddWidget={(rowId, colId) => { showPicker = { rowId, colId }; searchWidget = ''; pickerFamily = '' }}
						onRowSettings={(rowId) => { editRowId = rowId; activePanel = 'rowsettings' }}
						onRowDelete={(rowId) => deleteRow(rowId)}
						onResizeStart={(e, rowId, colIdx) => onResizeStart(e as PointerEvent, rowId, colIdx)}
					/>
				{/if}
			</div>
		</div>
	</div>
</div>

<!-- ════════════════════════════════════════════════════════════════════
     MODAL : Ajouter une ligne
═══════════════════════════════════════════════════════════════════════ -->
{#if showAddRow}
	<div class="modal-backdrop" role="presentation"
		onclick={() => showAddRow = false}
		onkeydown={(e) => { if (e.key === 'Escape') showAddRow = false }}>
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<span>Nouvelle ligne — choisissez une structure</span>
				<button class="modal-close" onclick={() => showAddRow = false}>✕</button>
			</div>
			<div class="modal-body">
				<div class="preset-grid">
					{#each ROW_PRESETS as p}
						<button class="preset-btn" onclick={() => addRow(p.spans)}>
							<span class="preset-preview">{p.preview}</span>
							<span class="preset-label">{p.label}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ════════════════════════════════════════════════════════════════════
     MODAL : Widget Picker
═══════════════════════════════════════════════════════════════════════ -->
{#if showPicker}
	<div class="modal-backdrop" role="presentation"
		onclick={() => showPicker = null}
		onkeydown={(e) => { if (e.key === 'Escape') showPicker = null }}>
		<div class="modal modal--wide" role="dialog" aria-modal="true" tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<span>Choisir un widget</span>
				<button class="modal-close" onclick={() => showPicker = null}>✕</button>
			</div>
			<div class="modal-body">
				<!-- Barre recherche -->
				<!-- svelte-ignore a11y_autofocus -->
				<input class="picker-search" type="text" placeholder="Rechercher un widget…"
					bind:value={searchWidget} autofocus
				/>

				<!-- Filtres famille -->
				<div class="picker-families">
					{#each FAMILIES as fam}
						<button
							class="fam-btn"
							class:fam-btn--active={pickerFamily === fam.id}
							onclick={() => pickerFamily = fam.id}
						>{fam.icon} {fam.label}</button>
					{/each}
				</div>

				<!-- Grille widgets -->
				{#if pickerPlugins.length === 0}
					<div class="picker-empty">Aucun widget trouvé.</div>
				{:else}
					<div class="picker-grid">
						{#each pickerPlugins as plugin}
							<button
								class="picker-card"
								style="--fc: {FAMILY_COLOR[plugin.family] ?? '#94a3b8'}"
								onclick={() => placeWidget(plugin)}
							>
								<span class="picker-icon">{plugin.icon}</span>
								<span class="picker-label">{plugin.label}</span>
								<span class="picker-desc">{plugin.desc}</span>
								<span class="picker-family" style="color: var(--fc)">{plugin.family}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Layout ──────────────────────────────────────────────────────────────── */
	.builder {
		display: flex;
		height: calc(100vh - 56px); /* hauteur dispo sous la nav admin */
		overflow: hidden;
		background: #05050a;
		color: #e2e8f0;
		font-family: 'Inter', sans-serif;
		font-size: 13px;
	}

	/* ── Panel gauche ────────────────────────────────────────────────────────── */
	.panel {
		width: 280px;
		min-width: 280px;
		display: flex;
		flex-direction: column;
		background: #0d0d12;
		border-right: 1px solid rgba(255,255,255,.07);
		overflow: hidden;
	}

	.panel-tabs {
		display: flex;
		border-bottom: 1px solid rgba(255,255,255,.07);
	}

	.ptab {
		flex: 1;
		padding: 10px 0;
		font-size: 12px;
		font-weight: 500;
		color: #6b7280;
		background: none;
		border: none;
		cursor: pointer;
		transition: color 0.15s;
		letter-spacing: .03em;
	}
	.ptab:hover { color: #e2e8f0; }
	.ptab--active {
		color: #a78bfa;
		box-shadow: inset 0 -2px 0 #a78bfa;
	}

	.panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.panel-section-title {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: .08em;
		color: #6b7280;
		font-weight: 600;
		padding: 4px 0 2px;
	}

	.panel-back {
		background: none;
		border: none;
		color: #a78bfa;
		cursor: pointer;
		font-size: 12px;
		text-align: left;
		padding: 0 0 4px;
	}
	.panel-back:hover { text-decoration: underline; }

	.panel-empty {
		color: #6b7280;
		font-size: 12px;
		line-height: 1.5;
		padding: 8px 0;
	}

	/* ── Row list ────────────────────────────────────────────────────────────── */
	.row-list { display: flex; flex-direction: column; gap: 4px; }

	.row-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px;
		background: rgba(255,255,255,.04);
		border: 1px solid rgba(255,255,255,.07);
		border-radius: 4px;
		transition: border-color 0.1s, background 0.1s;
	}
	.row-item:hover { border-color: rgba(167,139,250,.3); background: rgba(167,139,250,.05); }
	.row-item--drag { opacity: 0.4; }
	.row-item--dragover { border-color: #a78bfa !important; background: rgba(167,139,250,.12) !important; }

	.row-item-handle {
		font-size: 14px;
		color: #6b7280;
		cursor: grab;
		background: none;
		border: none;
		padding: 2px 4px;
		line-height: 1;
		user-select: none;
	}
	.row-item-handle:hover { color: #a78bfa; }

	.row-item-spans {
		flex: 1;
		display: flex;
		gap: 2px;
		min-width: 0;
		height: 24px;
	}

	.row-item-span {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		color: #9ca3af;
		border: 1px solid;
		border-radius: 2px;
		min-width: 0;
		gap: 2px;
		overflow: hidden;
	}

	.row-item-w { font-size: 10px; }

	.row-item-actions { display: flex; gap: 2px; }
	.riba {
		width: 20px; height: 20px;
		background: none;
		border: 1px solid rgba(255,255,255,.1);
		color: #9ca3af;
		cursor: pointer;
		border-radius: 3px;
		font-size: 10px;
		display: flex; align-items: center; justify-content: center;
	}
	.riba:hover { border-color: #a78bfa; color: #a78bfa; }
	.riba--del:hover { border-color: #f87171; color: #f87171; }

	.btn-add-row {
		margin-top: 4px;
		padding: 8px;
		background: rgba(167,139,250,.1);
		border: 1px dashed rgba(167,139,250,.3);
		color: #a78bfa;
		cursor: pointer;
		border-radius: 4px;
		font-size: 12px;
		width: 100%;
		transition: background 0.15s;
	}
	.btn-add-row:hover { background: rgba(167,139,250,.2); }

	/* ── Column manager ──────────────────────────────────────────────────────── */
	.col-manager { display: flex; flex-direction: column; gap: 4px; }
	.col-mgr-row {
		display: flex; align-items: center; gap: 6px;
		padding: 4px 6px;
		background: rgba(255,255,255,.04);
		border: 1px solid rgba(255,255,255,.07);
		border-radius: 3px;
		font-size: 11px;
	}
	.col-mgr-widget { flex: 1; color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.col-mgr-span { color: #6b7280; white-space: nowrap; }
	.col-mgr-del { background: none; border: none; color: #6b7280; cursor: pointer; font-size: 10px; }
	.col-mgr-del:hover { color: #f87171; }
	.btn-add-col {
		padding: 4px 8px;
		background: rgba(6,182,212,.1);
		border: 1px dashed rgba(6,182,212,.3);
		color: #06b6d4;
		cursor: pointer;
		border-radius: 3px;
		font-size: 11px;
	}

	/* ── Form fields ─────────────────────────────────────────────────────────── */
	.pfield {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.pfield span:first-child { font-size: 11px; color: #9ca3af; }
	.pfield-hint { font-size: 10px; color: #6b7280; line-height: 1.4; }

	.pfield input[type="text"],
	.pfield input[type="url"],
	.pfield input[type="number"],
	.pfield textarea,
	.pfield select {
		background: #1a1a26;
		border: 1px solid rgba(255,255,255,.12);
		color: #e2e8f0;
		color-scheme: dark;
		padding: 6px 8px;
		font-size: 12px;
		border-radius: 4px;
		width: 100%;
		outline: none;
	}
	.pfield input:focus, .pfield select:focus, .pfield textarea:focus {
		border-color: rgba(167,139,250,.5);
	}

	.pfield input[type="range"] {
		width: 100%;
		accent-color: #a78bfa;
	}

	.pfield-color {
		display: flex; align-items: center; gap: 6px;
	}
	.pfield-color input[type="color"] {
		width: 32px; height: 28px;
		padding: 0; border: none;
		background: none;
		cursor: pointer;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.pfield-color input[type="text"] { flex: 1; }
	.pfield-clear {
		background: none; border: none; color: #6b7280;
		cursor: pointer; font-size: 11px;
	}

	/* Toggle */
	.ptoggle { display: flex; align-items: center; gap: 8px; cursor: pointer; }
	.ptoggle input { display: none; }
	.ptoggle-track {
		width: 32px; height: 18px;
		background: rgba(255,255,255,.1);
		border-radius: 9px;
		position: relative;
		transition: background 0.2s;
	}
	.ptoggle input:checked + .ptoggle-track { background: #a78bfa; }
	.ptoggle-thumb {
		position: absolute;
		left: 2px; top: 2px;
		width: 14px; height: 14px;
		background: white;
		border-radius: 50%;
		transition: transform 0.2s;
	}
	.ptoggle input:checked ~ .ptoggle-track .ptoggle-thumb { transform: translateX(14px); }

	/* Config actions */
	.config-actions { display: flex; gap: 8px; margin-top: 8px; }

	/* ── Buttons ─────────────────────────────────────────────────────────────── */
	.btn-primary {
		padding: 7px 16px;
		background: linear-gradient(135deg, #7c3aed, #a78bfa);
		border: none;
		color: white;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		border-radius: 4px;
		transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: .85; }

	.btn-secondary {
		padding: 7px 16px;
		background: rgba(255,255,255,.07);
		border: 1px solid rgba(255,255,255,.12);
		color: #e2e8f0;
		font-size: 12px;
		cursor: pointer;
		border-radius: 4px;
	}
	.btn-secondary:hover { background: rgba(255,255,255,.12); }

	/* ── Canvas ──────────────────────────────────────────────────────────────── */
	.canvas-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
	}

	.canvas-toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
		background: #0d0d12;
		border-bottom: 1px solid rgba(255,255,255,.07);
		flex-shrink: 0;
	}

	.toolbar-preview { display: flex; gap: 2px; }
	.preview-btn {
		display: flex; align-items: center; gap: 5px;
		padding: 5px 10px;
		background: rgba(255,255,255,.05);
		border: 1px solid rgba(255,255,255,.1);
		color: #9ca3af;
		font-size: 11px;
		cursor: pointer;
		border-radius: 4px;
	}
	.preview-btn:hover { border-color: rgba(167,139,250,.4); color: #e2e8f0; }
	.preview-btn--active { background: rgba(167,139,250,.15); border-color: #a78bfa; color: #a78bfa; }

	.toolbar-status { flex: 1; display: flex; align-items: center; gap: 6px; }
	.unsaved-dot { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; animation: pulse 2s infinite; }
	.unsaved-label { font-size: 11px; color: #f59e0b; }
	@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }

	.toolbar-actions { display: flex; gap: 6px; }
	.btn-tool {
		padding: 5px 12px;
		background: rgba(255,255,255,.06);
		border: 1px solid rgba(255,255,255,.1);
		color: #9ca3af;
		font-size: 12px;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.15s;
	}
	.btn-tool:hover:not(:disabled) { color: #e2e8f0; border-color: rgba(255,255,255,.2); }
	.btn-tool:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-tool--save { color: #e2e8f0; border-color: rgba(167,139,250,.3); }
	.btn-tool--save:hover:not(:disabled) { background: rgba(167,139,250,.15); border-color: #a78bfa; color: #a78bfa; }
	.btn-tool--publish {
		background: linear-gradient(135deg, rgba(124,58,237,.3), rgba(167,139,250,.2));
		border-color: rgba(167,139,250,.4);
		color: #a78bfa;
	}
	.btn-tool--publish:hover:not(:disabled) { background: linear-gradient(135deg, rgba(124,58,237,.5), rgba(167,139,250,.35)); }

	.draft-banner {
		padding: 8px 16px;
		background: rgba(245,158,11,.1);
		border-bottom: 1px solid rgba(245,158,11,.2);
		font-size: 12px;
		color: #fbbf24;
		flex-shrink: 0;
	}

	.canvas-scroll {
		flex: 1;
		overflow: auto;
		padding: 24px 32px;
		background: #08080d;
	}

	.canvas-preview {
		background: #05050a;
		min-height: 400px;
		box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 8px 40px rgba(0,0,0,.5);
		transition: max-width 0.3s ease;
		position: relative;
	}

	.canvas-empty {
		padding: 80px 40px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.canvas-empty-icon { font-size: 40px; opacity: .3; }
	.canvas-empty-title { font-size: 18px; font-weight: 600; color: #e2e8f0; }
	.canvas-empty-sub { font-size: 13px; color: #6b7280; }

	/* ── Modals ──────────────────────────────────────────────────────────────── */
	.modal-backdrop {
		position: fixed; inset: 0;
		background: rgba(0,0,0,.7);
		display: flex; align-items: center; justify-content: center;
		z-index: 100;
		backdrop-filter: blur(3px);
	}

	.modal {
		background: #0d0d12;
		border: 1px solid rgba(255,255,255,.1);
		border-radius: 6px;
		width: 520px;
		max-height: 80vh;
		display: flex; flex-direction: column;
		overflow: hidden;
	}
	.modal--wide { width: 780px; }

	.modal-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 14px 20px;
		border-bottom: 1px solid rgba(255,255,255,.07);
		font-size: 14px;
		font-weight: 600;
		color: #e2e8f0;
		flex-shrink: 0;
	}
	.modal-close {
		background: none; border: none;
		color: #6b7280; cursor: pointer; font-size: 14px;
	}
	.modal-close:hover { color: #e2e8f0; }

	.modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }

	/* Presets lignes */
	.preset-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.preset-btn {
		display: flex; flex-direction: column; align-items: center; gap: 6px;
		padding: 12px 8px;
		background: rgba(255,255,255,.04);
		border: 1px solid rgba(255,255,255,.08);
		color: #e2e8f0;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.15s;
	}
	.preset-btn:hover { background: rgba(167,139,250,.12); border-color: #a78bfa; }
	.preset-preview { font-size: 10px; color: #a78bfa; letter-spacing: 1px; font-family: monospace; }
	.preset-label { font-size: 11px; color: #9ca3af; }

	/* Widget picker */
	.picker-search {
		width: 100%;
		background: rgba(255,255,255,.06);
		border: 1px solid rgba(255,255,255,.1);
		color: #e2e8f0;
		padding: 8px 12px;
		font-size: 13px;
		border-radius: 4px;
		outline: none;
		margin-bottom: 10px;
	}
	.picker-search:focus { border-color: rgba(167,139,250,.5); }

	.picker-families { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px; }
	.fam-btn {
		padding: 3px 10px;
		background: rgba(255,255,255,.05);
		border: 1px solid rgba(255,255,255,.1);
		color: #9ca3af;
		cursor: pointer;
		border-radius: 20px;
		font-size: 11px;
		transition: all 0.1s;
	}
	.fam-btn:hover { border-color: rgba(167,139,250,.4); color: #e2e8f0; }
	.fam-btn--active { background: rgba(167,139,250,.15); border-color: #a78bfa; color: #a78bfa; }

	.picker-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.picker-card {
		display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
		padding: 12px;
		background: rgba(255,255,255,.04);
		border: 1px solid rgba(255,255,255,.08);
		border-top: 2px solid var(--fc);
		color: #e2e8f0;
		cursor: pointer;
		border-radius: 4px;
		text-align: left;
		transition: all 0.15s;
	}
	.picker-card:hover { background: rgba(255,255,255,.08); border-color: var(--fc); }
	.picker-icon { font-size: 20px; }
	.picker-label { font-size: 12px; font-weight: 600; }
	.picker-desc { font-size: 10px; color: #6b7280; line-height: 1.4; }
	.picker-family { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }

	.picker-empty { color: #6b7280; font-size: 13px; padding: 16px 0; text-align: center; }

	/* ── Toasts ──────────────────────────────────────────────────────────────── */
	.toasts {
		position: fixed; top: 16px; right: 16px;
		z-index: 200;
		display: flex; flex-direction: column; gap: 6px;
		pointer-events: none;
	}
	.toast {
		padding: 8px 16px;
		background: #166534;
		border: 1px solid #16a34a;
		color: white;
		font-size: 12px;
		border-radius: 4px;
		pointer-events: auto;
	}
	.toast--err { background: #7f1d1d; border-color: #dc2626; }

	/* ── Slideshow custom panel ──────────────────────────────────────────────── */
	.ss-sources {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 8px;
	}
	.ss-src-card {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		background: rgba(255,255,255,.04);
		border: 1px solid rgba(255,255,255,.08);
		border-radius: 4px;
		min-width: 0;
	}
	.ss-src-label {
		font-size: 11px;
		font-weight: 700;
		color: #a78bfa;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.ss-src-desc {
		font-size: 11px;
		color: #6b7280;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ss-src-actions {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}
	.ss-src-btn {
		width: 22px; height: 22px;
		display: flex; align-items: center; justify-content: center;
		background: transparent;
		border: 1px solid rgba(255,255,255,.1);
		color: #6b7280;
		cursor: pointer;
		font-size: 11px;
		border-radius: 3px;
		padding: 0;
		transition: border-color .1s, color .1s;
	}
	.ss-src-btn:hover:not(:disabled) { border-color: #a78bfa; color: #a78bfa; }
	.ss-src-btn:disabled { opacity: .3; cursor: default; }
	.ss-src-btn--del:hover { border-color: #f87171 !important; color: #f87171 !important; }

	.ss-add-btns {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.ss-add-btn {
		padding: 4px 10px;
		font-size: 11px;
		background: rgba(167,139,250,.08);
		border: 1px solid rgba(167,139,250,.25);
		color: #a78bfa;
		cursor: pointer;
		border-radius: 3px;
		transition: background .1s;
	}
	.ss-add-btn:hover { background: rgba(167,139,250,.18); }

	.ss-advanced {
		margin-top: 10px;
		display: flex;
		justify-content: flex-end;
	}
	.ss-json-btn {
		font-size: 11px;
		color: #4b5563;
		background: transparent;
		border: 1px solid rgba(255,255,255,.08);
		padding: 3px 10px;
		cursor: pointer;
		border-radius: 3px;
		transition: color .1s, border-color .1s;
	}
	.ss-json-btn:hover { color: #9ca3af; border-color: rgba(255,255,255,.2); }

	.ss-json-area {
		width: 100%;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 10px;
		background: rgba(0,0,0,.4);
		border: 1px solid rgba(255,255,255,.1);
		color: #d1d5db;
		padding: 10px;
		border-radius: 4px;
		resize: vertical;
		line-height: 1.5;
		margin-bottom: 6px;
	}
	.ss-json-area:focus { outline: none; border-color: rgba(167,139,250,.5); }
	.ss-json-err {
		font-size: 11px;
		color: #f87171;
		margin-bottom: 6px;
	}

	/* ── Social links editor ─────────────────────────────────────────────────── */
	.sl-editor { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
	.sl-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.sl-select {
		width: 100px;
		flex-shrink: 0;
		padding: 3px 4px;
		font-size: 11px;
		background: #1a1a26;
		border: 1px solid rgba(255,255,255,.12);
		color: #e2e8f0;
		color-scheme: dark;
		border-radius: 3px;
	}
	.sl-input {
		flex: 1;
		min-width: 0;
		padding: 3px 6px;
		font-size: 11px;
		background: rgba(255,255,255,.06);
		border: 1px solid rgba(255,255,255,.1);
		color: #e2e8f0;
		border-radius: 3px;
	}
	.sl-input:focus, .sl-select:focus {
		outline: none;
		border-color: rgba(167,139,250,.5);
	}
</style>
