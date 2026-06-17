<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte'
	import { page } from '$app/stores'
	import { apiFetch } from '$lib/api'
	import { t } from '$lib/i18n'
	import { TextSelection } from '@tiptap/pm/state'

	let {
		name       = 'content',
		placeholder = '',
		initialContent = '',
		compact    = false,
		onchange   = (_html: string) => {},
	}: {
		name?:           string
		placeholder?:    string
		initialContent?: string
		compact?:        boolean
		onchange?:       (html: string) => void
	} = $props()

	// ── i18n ─────────────────────────────────────────────────────────────────
	const tFn = $derived($t)

	// ── Auth token (used for authenticated uploads) ─────────────────────────
	const token = $derived(($page.data as any)?.token as string | undefined)

	// ── Placeholder (i18n fallback) ─────────────────────────────────────────
	const resolvedPlaceholder = $derived(placeholder || tFn('editor.default_placeholder'))

	// ── DOM refs ──────────────────────────────────────────────────────────────
	let editorEl    = $state<HTMLElement | undefined>(undefined)
	let wrapperEl   = $state<HTMLElement | undefined>(undefined)
	let editor: any = $state(null)

	// ── Synced HTML (for the hidden form input) ───────────────────────────────
	let html        = $state(untrack(() => initialContent))
	let charCount   = $state(0)

	// ── Toolbar UI state ──────────────────────────────────────────────────────
	let showColor   = $state(false)
	let showEmoji   = $state(false)
	let showLink    = $state(false)
	let showImage   = $state(false)
	let showVideo   = $state(false)
	let showAudio   = $state(false)
	let showTable   = $state(false)

	let linkUrl     = $state('')
	let imageUrl    = $state('')
	let imageAlt    = $state('')
	let imageAlign  = $state<'left'|'center'|'right'|'full'>('center')
	// Position du noeud image sélectionné quand on ouvre le menu image : permet
	// de REMPLACER l'image au lieu d'en insérer une nouvelle (la sélection se
	// perd dès qu'on tape dans le champ URL, on la capture donc à l'ouverture).
	let replaceImagePos = $state<number | null>(null)
	let videoUrl    = $state('')

	// ── Barre flottante (quickbar) sur la sélection ───────────────────────────
	// Apparaît au-dessus du texte surligné, avec le bouton Ancre (pilote le
	// sommaire) + formatage rapide. Positionnée à la main (zéro dépendance).
	let bubbleEl       = $state<HTMLElement | undefined>(undefined)
	let bubbleVisible  = $state(false)
	let bubbleTop      = $state(0)
	let bubbleLeft     = $state(0)
	let bubbleBelow    = $state(false)    // affichée SOUS la sélection (anti-débord haut)
	let blockIsAnchored = $state(false)   // état du bloc courant (titre ancré ?)

	// Audio upload state
	let audioFileEl       = $state<HTMLInputElement | undefined>(undefined)
	let audioCoverFileEl  = $state<HTMLInputElement | undefined>(undefined)
	let audioUploading    = $state(false)
	let audioError        = $state('')
	let audioUrlExternal  = $state('')
	let audioPickedFile   = $state<File | null>(null)
	let audioTitle        = $state('')
	let audioArtist       = $state('')
	let audioAllowDownload= $state(false)
	let audioCoverFile    = $state<File | null>(null)
	let audioCoverPreview = $state<string | null>(null)  // blob: URL for popup preview
	let audioCoverDetected= $state<{ mime: string; bytes: Uint8Array } | null>(null)
	let audioStaged       = $state<Array<{ src: string; title: string; artist: string; cover: string }>>([])

	// ── Media picker ──────────────────────────────────────────────────────────
	let showMediaPicker = $state(false)
	let mediaImages     = $state<any[]>([])
	let mediaLoading    = $state(false)

	async function openMediaPicker() {
		showMediaPicker = true
		if (mediaImages.length > 0) return
		mediaLoading = true
		try {
			const res = await fetch('/api/v1/assets?type=image&limit=100')
			if (res.ok) { const j = await res.json(); mediaImages = j.assets ?? [] }
		} finally { mediaLoading = false }
	}

	function pickMedia(asset: { file_path: string; name: string }) {
		imageUrl = `/uploads/${asset.file_path}`
		imageAlt = asset.name
		showMediaPicker = false
	}

	// ── Active state (updated on every editor transaction) ────────────────────
	let a = $state({
		bold: false, italic: false, underline: false, strike: false, code: false,
		h1: false, h2: false, h3: false,
		bullet: false, ordered: false,
		quote: false, codeBlock: false, link: false,
		left: false, center: false, right: false, justify: false,
		table: false,
	})

	function syncActive() {
		if (!editor) return
		a = {
			bold:     editor.isActive('bold'),
			italic:   editor.isActive('italic'),
			underline:editor.isActive('underline'),
			strike:   editor.isActive('strike'),
			code:     editor.isActive('code'),
			h1:       editor.isActive('heading', { level: 1 }),
			h2:       editor.isActive('heading', { level: 2 }),
			h3:       editor.isActive('heading', { level: 3 }),
			bullet:   editor.isActive('bulletList'),
			ordered:  editor.isActive('orderedList'),
			quote:    editor.isActive('blockquote'),
			codeBlock:editor.isActive('codeBlock'),
			link:     editor.isActive('link'),
			left:     editor.isActive({ textAlign: 'left' }),
			center:   editor.isActive({ textAlign: 'center' }),
			right:    editor.isActive({ textAlign: 'right' }),
			justify:  editor.isActive({ textAlign: 'justify' }),
			table:    editor.isActive('table'),
		}
	}

	// ── Initialise Tiptap (browser-only) ──────────────────────────────────────
	onMount(async () => {
		const { Editor, Node, Extension, mergeAttributes } = await import('@tiptap/core')
		const { default: StarterKit }            = await import('@tiptap/starter-kit')
		const { default: Underline }             = await import('@tiptap/extension-underline')
		const { default: TextAlign }             = await import('@tiptap/extension-text-align')
		const { default: Link }                  = await import('@tiptap/extension-link')
		const { default: Image }                 = await import('@tiptap/extension-image')
		const { default: Youtube }               = await import('@tiptap/extension-youtube')
		const { Table }                          = await import('@tiptap/extension-table')
		const { default: TableRow }              = await import('@tiptap/extension-table-row')
		const { default: TableCell }             = await import('@tiptap/extension-table-cell')
		const { default: TableHeader }           = await import('@tiptap/extension-table-header')
		const { default: Color }                 = await import('@tiptap/extension-color')
		const { TextStyle }                      = await import('@tiptap/extension-text-style')
		const { default: Placeholder }           = await import('@tiptap/extension-placeholder')
		const { default: CharacterCount }        = await import('@tiptap/extension-character-count')
		const { CodeBlockLowlight }              = await import('@tiptap/extension-code-block-lowlight')
		const { common, createLowlight }         = await import('lowlight')

		const lowlight = createLowlight(common)

		// ── Custom Image with alignment ──────────────────────────────────────
		const AlignableImage = Image.extend({
			addAttributes() {
				return {
					...this.parent?.(),
					align: { default: 'center', parseHTML: el => el.getAttribute('data-align'), renderHTML: attrs => ({ 'data-align': attrs.align }) },
					width: { default: null, parseHTML: el => el.getAttribute('width'), renderHTML: attrs => attrs.width ? { width: attrs.width } : {} },
				}
			},
		})

		// ── Youtube robuste au round-trip ───────────────────────────────────
		// TipTap sérialise une vidéo en <div data-youtube-video><iframe…/></div>.
		// Le sanitizer backend ne garde pas `data-youtube-video` sur le <div>,
		// donc au rechargement l'extension ne reconnaissait plus son wrapper et
		// JETAIT l'iframe (vidéos qui disparaissent à la réédition). On ajoute
		// une règle parseHTML qui reparse aussi un <iframe> nu d'origine YouTube.
		const RobustYoutube = Youtube.extend({
			parseHTML() {
				return [
					...(this.parent?.() ?? []),
					{
						tag: 'iframe[src]',
						getAttrs: (el: any) => {
							const src = el?.getAttribute?.('src') ?? ''
							return /(?:youtube(?:-nocookie)?\.com|youtu\.be)/.test(src) ? {} : false
						},
					},
				]
			},
		})

		// ── Heading anchors ──────────────────────────────────────────────────
		// Attribut id sur les titres : posé automatiquement par le bouton
		// Sommaire, préservé au round-trip HTML. Le sanitizer backend ne
		// l'accepte que sur h2/h3/h4 (cf forums.ts), le bouton ne cible que
		// les niveaux 2-3.
		const HeadingIds = Extension.create({
			name: 'headingIds',
			addGlobalAttributes() {
				return [{
					types: ['heading'],
					attributes: {
						id: {
							default: null,
							parseHTML: (el: HTMLElement) => el.getAttribute('id'),
							renderHTML: (attrs: Record<string, any>) => attrs.id ? { id: attrs.id } : {},
						},
					},
				}]
			},
		})

		// ── Boîte sommaire façon wiki ────────────────────────────────────────
		// <div class="toc"> flottant à droite (style .toc dans app.css).
		// Contenu libre : le bouton Sommaire la pré-remplit avec les liens
		// d'ancres, mais l'auteur peut l'éditer comme n'importe quel bloc.
		const TocBox = Node.create({
			name: 'tocBox',
			group: 'block',
			// paragraph+ uniquement : le sommaire ne contient que du texte (titre +
			// liens d'ancres). Interdit aux images/vidéos/blocs de s'y faire aspirer
			// au backspace (ProseMirror joignait un bloc image dans cette boîte
			// isolante, l'image disparaissait alors dans un conteneur invisible).
			content: 'paragraph+',
			isolating: true,
			selectable: true,
			draggable: true,
			parseHTML()  { return [{ tag: 'div.toc' }] },
			renderHTML({ HTMLAttributes }) {
				return ['div', mergeAttributes(HTMLAttributes, { class: 'toc' }), 0]
			},
		})

		// ── Console SSH (.nodyx-term) : bloc HTML protégé ────────────────────
		// Les tutos d'installation contiennent des consoles stylées (div.nodyx-term
		// avec barre/corps/spans colorés). Ce n'est PAS éditable inline : on en
		// fait un nœud ATOMIQUE qui capture son HTML interne au chargement et le
		// ré-émet tel quel à la sauvegarde. Sans ça, l'éditeur déstructurait la
		// console à la réédition (perte de données).
		const NodyxTerm = Node.create({
			name: 'nodyxTerm',
			group: 'block',
			atom: true,
			selectable: true,
			draggable: true,
			addAttributes() {
				return {
					html: { default: '', parseHTML: (el: HTMLElement) => el.innerHTML, renderHTML: () => ({}) },
				}
			},
			parseHTML() { return [{ tag: 'div.nodyx-term' }] },
			renderHTML({ node }: any) {
				const dom = document.createElement('div')
				dom.className = 'nodyx-term'
				dom.innerHTML = node.attrs.html
				return dom
			},
			addNodeView() {
				return ({ node, editor, getPos }: any) => {
					// Wrapper non éditable : barre d'outils (label + toggle Rendu/Code)
					// + zone d'affichage. Le code source du bloc se modifie via le
					// bouton « Code » (façon CMS), jamais au clavier directement.
					const dom = document.createElement('div')
					dom.className = 'nodyx-term-wrap'
					dom.setAttribute('contenteditable', 'false')

					const bar = document.createElement('div')
					bar.className = 'nodyx-term-tools'
					const label = document.createElement('span')
					label.className = 'ntt-label'
					label.textContent = 'Console SSH'
					const btn = document.createElement('button')
					btn.type = 'button'
					btn.className = 'ntt-btn'
					btn.textContent = '</> Code'
					bar.appendChild(label)
					bar.appendChild(btn)

					const render = document.createElement('div')
					render.className = 'nodyx-term'
					render.innerHTML = node.attrs.html

					dom.appendChild(bar)
					dom.appendChild(render)

					let editing = false
					let textarea: HTMLTextAreaElement | null = null

					// Commit immédiat de la source vers l'attribut du nœud : la
					// modification est prise en compte EN CONTINU pendant la frappe,
					// sans dépendre du bouton « Rendu » (qui ne fait que rebasculer
					// la vue). À l'enregistrement, getHTML a toujours la dernière
					// version. addToHistory:false pour ne pas saturer le ctrl-z.
					const commit = (val: string) => {
						if (typeof getPos !== 'function') return
						const pos = getPos()
						if (pos == null) return
						editor.view.dispatch(
							editor.state.tr.setNodeMarkup(pos, undefined, { html: val }).setMeta('addToHistory', false),
						)
					}

					btn.addEventListener('mousedown', (e) => e.preventDefault())
					btn.addEventListener('click', () => {
						if (!editing) {
							editing = true
							btn.textContent = '✓ Rendu'
							btn.classList.add('active')
							textarea = document.createElement('textarea')
							textarea.className = 'nodyx-term-code'
							textarea.value = render.innerHTML
							textarea.addEventListener('input', () => { if (textarea) commit(textarea.value) })
							render.style.display = 'none'
							dom.appendChild(textarea)
							textarea.focus()
						} else {
							editing = false
							btn.textContent = '</> Code'
							btn.classList.remove('active')
							const newHtml = textarea ? textarea.value : render.innerHTML
							render.innerHTML = newHtml
							render.style.display = ''
							if (textarea) { textarea.remove(); textarea = null }
							commit(newHtml)
						}
					})

					return {
						dom,
						update(updated: any) {
							if (updated.type.name !== 'nodyxTerm') return false
							if (!editing) render.innerHTML = updated.attrs.html
							return true
						},
						stopEvent: () => true,
						ignoreMutation: () => true,
					}
				}
			},
		})

		// ── Two-Column layout extension ───────────────────────────────────────
		// PRINCIPE round-trip : on parse sur la CLASSE (que le sanitizer conserve
		// toujours), pas sur data-col/data-two-cols (que le sanitizer supprime des
		// <div>). Sans ça, les colonnes étaient méconnues à la réédition et leur
		// contenu était aplati. On garde aussi la règle data-* pour le contenu
		// jamais passé par le sanitizer (insertion fraîche, copier/coller interne).
		const NodyxColumn = Node.create({
			name: 'nodyxColumn',
			group: 'nodyxColumn',
			content: 'block+',
			isolating: true,
			parseHTML()  { return [{ tag: 'div.nodyx-col' }, { tag: 'div[data-col]' }] },
			renderHTML({ HTMLAttributes }) {
				return ['div', mergeAttributes(HTMLAttributes, { 'data-col': '', class: 'nodyx-col' }), 0]
			},
		})

		const NodyxTwoCols = Node.create({
			name: 'nodyxTwoCols',
			group: 'block',
			content: 'nodyxColumn nodyxColumn',
			isolating: true,
			parseHTML()  { return [{ tag: 'div.nodyx-two-cols' }, { tag: 'div[data-two-cols]' }] },
			renderHTML({ HTMLAttributes }) {
				return ['div', mergeAttributes(HTMLAttributes, { 'data-two-cols': '', class: 'nodyx-two-cols' }), 0]
			},
			addCommands(): any {
				return {
					insertTwoCols: () => ({ commands }: any) =>
						commands.insertContent({
							type: 'nodyxTwoCols',
							content: [
								{ type: 'nodyxColumn', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Contenu colonne gauche…' }] }] },
								{ type: 'nodyxColumn', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Contenu colonne droite…' }] }] },
							],
						}),
				}
			},
		})

		// ── Audio nodes ──────────────────────────────────────────────────────
		// nodyxAudio (the player) contains zero-or-more nodyxTrack children.
		// Legacy single-track posts have the src directly on <nodyx-audio-player>
		// (no children). The Web Component handles both shapes.
		const passthrough = (name: string) => ({
			default: null as any,
			parseHTML: (el: HTMLElement) => el.getAttribute(name),
			renderHTML: (attrs: Record<string, any>) => attrs[name] ? { [name]: attrs[name] } : {},
		})

		const NodyxTrack = Node.create({
			name: 'nodyxTrack',
			group: 'block',
			atom: true,
			selectable: false,
			addAttributes() {
				return {
					src:           passthrough('src'),
					'track-title': passthrough('track-title'),
					artist:        passthrough('artist'),
					cover:         passthrough('cover'),
				}
			},
			parseHTML() { return [{ tag: 'nodyx-track[src]' }] },
			renderHTML({ HTMLAttributes }) {
				return ['nodyx-track', mergeAttributes(HTMLAttributes)]
			},
		})

		const NodyxAudio = Node.create({
			name: 'nodyxAudio',
			group: 'block',
			content: 'nodyxTrack*',
			selectable: true,
			draggable: true,
			addAttributes() {
				return {
					src:           passthrough('src'),
					'track-title': passthrough('track-title'),
					artist:        passthrough('artist'),
					cover:         passthrough('cover'),
					download:      passthrough('download'),
				}
			},
			parseHTML() {
				return [
					{ tag: 'nodyx-audio-player' },
					{ tag: 'audio[src]' },  // legacy
				]
			},
			renderHTML({ HTMLAttributes }) {
				return ['nodyx-audio-player', mergeAttributes(HTMLAttributes), 0]
			},
			addCommands(): any {
				return {
					// Single-track convenience: { src, 'track-title', artist, cover, download }
					setNodyxAudio: (attrs: Record<string, string>) => ({ commands }: any) => {
						if (!attrs.src) return false
						return commands.insertContent({
							type: 'nodyxAudio',
							attrs: { download: attrs.download || null },
							content: [{
								type: 'nodyxTrack',
								attrs: {
									src:           attrs.src,
									'track-title': attrs['track-title'] || null,
									artist:        attrs.artist        || null,
									cover:         attrs.cover         || null,
								},
							}],
						})
					},
					// Multi-track: { tracks: [{src, title, artist, cover}], download? }
					setNodyxPlaylist: (opts: { tracks: Array<{src: string, title?: string, artist?: string, cover?: string}>, download?: boolean }) => ({ commands }: any) => {
						if (!opts.tracks || opts.tracks.length === 0) return false
						return commands.insertContent({
							type: 'nodyxAudio',
							attrs: { download: opts.download ? '1' : null },
							content: opts.tracks.map(t => ({
								type: 'nodyxTrack',
								attrs: {
									src:           t.src,
									'track-title': t.title  || null,
									artist:        t.artist || null,
									cover:         t.cover  || null,
								},
							})),
						})
					},
				}
			},
		})

		editor = new Editor({
			element: editorEl!,
			extensions: [
				StarterKit.configure({ codeBlock: false, link: false, underline: false }),
				Underline,
				TextAlign.configure({ types: ['heading', 'paragraph', 'image'] }),
				Link.configure({ openOnClick: false, autolink: true }),
				AlignableImage,
				RobustYoutube.configure({ nocookie: true }),
				Table.configure({ resizable: false }),
				TableRow, TableCell, TableHeader,
				Color, TextStyle,
				Placeholder.configure({ placeholder: resolvedPlaceholder }),
				CharacterCount,
				CodeBlockLowlight.configure({ lowlight }),
				HeadingIds, TocBox,
				NodyxTwoCols, NodyxColumn,
				NodyxAudio, NodyxTrack,
				NodyxTerm,
			],
			content: initialContent,
			onTransaction() { syncActive(); syncBubble() },
			onUpdate({ editor: e }) {
				html = e.getHTML()
				charCount = e.storage.characterCount.characters()
				onchange(html)
			},
		})

		syncActive()
	})

	// ── Close popups when clicking outside the editor ─────────────────────────
	function onDocClick(e: MouseEvent) {
		if (wrapperEl && !wrapperEl.contains(e.target as Node)) {
			showColor = showEmoji = showLink = showImage = showVideo = showAudio = showTable = false
			bubbleVisible = false
		}
	}

	// ── Auto-flip popups that would overflow their scroll container ──────────
	function autoFlip(node: HTMLElement) {
		function findScrollContainer(): HTMLElement {
			let p = node.parentElement
			while (p && p !== document.body) {
				const o = getComputedStyle(p).overflow
				if (o !== 'visible' && o !== '') return p
				p = p.parentElement
			}
			return document.body
		}
		function adjust() {
			node.style.left = '0px'
			node.style.right = 'auto'
			const rect = node.getBoundingClientRect()
			const container = findScrollContainer()
			const cRect = container.getBoundingClientRect()
			const boundary = Math.min(window.innerWidth, cRect.right) - 8
			if (rect.right > boundary) {
				node.style.left = 'auto'
				node.style.right = '0px'
			}
		}
		adjust()
		const ro = new ResizeObserver(adjust)
		ro.observe(node)
		window.addEventListener('resize', adjust)
		return {
			destroy() {
				ro.disconnect()
				window.removeEventListener('resize', adjust)
			},
		}
	}

	$effect(() => {
		document.addEventListener('click', onDocClick)
		// Repositionne la barre flottante au scroll/resize tant qu'elle est
		// visible (sinon, position: fixed, elle « décrochait » de la sélection).
		const reposition = () => { if (bubbleVisible) syncBubble() }
		window.addEventListener('scroll', reposition, true)
		window.addEventListener('resize', reposition)
		return () => {
			document.removeEventListener('click', onDocClick)
			window.removeEventListener('scroll', reposition, true)
			window.removeEventListener('resize', reposition)
		}
	})

	onDestroy(() => editor?.destroy())

	// ── Toolbar commands (shortcuts to editor chain) ──────────────────────────
	const run = (fn: () => void) => { fn(); showColor = showEmoji = showLink = showImage = showVideo = showAudio = showTable = false }

	function insertLink() {
		if (!linkUrl.trim()) return
		editor?.chain().focus().setLink({ href: linkUrl }).run()
		linkUrl = ''; showLink = false
	}

	// Ouvre/ferme le menu image. À l'ouverture, si une image est sélectionnée
	// (NodeSelection), on capture sa position et on pré-remplit le formulaire :
	// valider remplacera cette image au lieu d'en insérer une nouvelle.
	function toggleImagePopup() {
		const opening = !showImage
		showColor = showEmoji = showLink = showVideo = showAudio = showTable = false
		showImage = opening
		replaceImagePos = null
		if (opening && editor) {
			const sel = editor.state.selection as any
			const node = sel?.node
			if (node && node.type.name === 'image') {
				replaceImagePos = sel.from
				imageUrl   = node.attrs.src ?? ''
				imageAlt   = node.attrs.alt ?? ''
				imageAlign = (node.attrs['data-align'] ?? node.attrs.align ?? 'center') as any
			}
		}
	}

	function insertImage() {
		if (!imageUrl.trim()) return
		const alignClass = { left: 'float-left mr-4', right: 'float-right ml-4', center: 'mx-auto block', full: 'w-full block' }[imageAlign]
		const attrs = { src: imageUrl, alt: imageAlt || '', class: alignClass, 'data-align': imageAlign, align: imageAlign }
		if (replaceImagePos !== null) {
			// Remplace l'image existante à sa position (conserve le noeud, change
			// src/alt/alignement) plutôt que d'en insérer une à côté.
			const pos = replaceImagePos
			editor?.chain().focus().command(({ tr, state }: any) => {
				const node = state.doc.nodeAt(pos)
				if (!node || node.type.name !== 'image') return false
				tr.setNodeMarkup(pos, undefined, attrs)
				return true
			}).run()
		} else {
			editor?.chain().focus().setImage(attrs).run()
		}
		imageUrl = ''; imageAlt = ''; showImage = false; replaceImagePos = null
	}

	function insertVideo() {
		if (!videoUrl.trim()) return
		editor?.chain().focus().setYoutubeVideo({ src: videoUrl }).run()
		videoUrl = ''; showVideo = false
	}

	function resetAudioForm() {
		audioPickedFile = null
		audioTitle = ''
		audioArtist = ''
		audioAllowDownload = false
		audioCoverFile = null
		audioCoverDetected = null
		if (audioCoverPreview) { try { URL.revokeObjectURL(audioCoverPreview) } catch {} }
		audioCoverPreview = null
		audioError = ''
		audioUrlExternal = ''
		audioStaged = []
		if (audioFileEl) audioFileEl.value = ''
		if (audioCoverFileEl) audioCoverFileEl.value = ''
	}

	async function uploadBlobToPosts(blob: Blob, filename: string): Promise<string | null> {
		const fd = new FormData()
		fd.append('file', new File([blob], filename, { type: blob.type }))
		const res = await apiFetch(fetch, '/social/upload', {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    fd,
		})
		if (!res.ok) {
			const j = await res.json().catch(() => ({}))
			audioError = j.error ?? `Erreur upload (${res.status})`
			return null
		}
		return (await res.json()).url as string
	}

	async function onAudioFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		audioError = ''
		if (!file.type.startsWith('audio/')) {
			audioError = 'Format non supporté (mp3, ogg, wav, m4a, webm).'
			audioPickedFile = null
			return
		}
		if (file.size > 8 * 1024 * 1024) {
			audioError = 'Fichier trop lourd (max 8 Mo).'
			audioPickedFile = null
			return
		}
		audioPickedFile = file
		// Default title = filename without extension
		if (!audioTitle) audioTitle = file.name.replace(/\.[^.]+$/, '')

		// Best-effort ID3 parse — only meaningful for mp3, gracefully no-op for others
		try {
			const { parseAudioMetadata } = await import('$lib/components/audio/id3')
			const meta = await parseAudioMetadata(file)
			if (meta.title  && !audioArtist) audioTitle  = meta.title
			if (meta.artist) audioArtist = meta.artist
			if (meta.cover && !audioCoverFile) {
				audioCoverDetected = meta.cover
				const blob = new Blob([meta.cover.bytes as BlobPart], { type: meta.cover.mime })
				if (audioCoverPreview) { try { URL.revokeObjectURL(audioCoverPreview) } catch {} }
				audioCoverPreview = URL.createObjectURL(blob)
			}
		} catch (err) {
			// Silent: metadata extraction is best-effort, not a hard requirement
			console.warn('[nodyx-audio] ID3 parse failed', err)
		}
	}

	function onCoverFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		if (!file.type.startsWith('image/')) {
			audioError = 'Cover : formats acceptés jpg, png, webp, gif.'
			return
		}
		if (file.size > 8 * 1024 * 1024) {
			audioError = 'Cover trop lourde (max 8 Mo).'
			return
		}
		audioCoverFile = file
		audioCoverDetected = null  // manual file overrides detected
		if (audioCoverPreview) { try { URL.revokeObjectURL(audioCoverPreview) } catch {} }
		audioCoverPreview = URL.createObjectURL(file)
	}

	function clearCover() {
		audioCoverFile = null
		audioCoverDetected = null
		if (audioCoverPreview) { try { URL.revokeObjectURL(audioCoverPreview) } catch {} }
		audioCoverPreview = null
		if (audioCoverFileEl) audioCoverFileEl.value = ''
	}

	async function stageAudio() {
		audioError = ''
		if (!audioPickedFile) {
			audioError = 'Choisis un fichier audio.'
			return
		}
		if (!token) {
			audioError = 'Session expirée, recharge la page.'
			return
		}
		audioUploading = true
		try {
			const audioUrl = await uploadBlobToPosts(audioPickedFile, audioPickedFile.name)
			if (!audioUrl) return

			let coverUrl = ''
			if (audioCoverFile) {
				const u = await uploadBlobToPosts(audioCoverFile, audioCoverFile.name)
				if (u) coverUrl = u
			} else if (audioCoverDetected) {
				const ext = audioCoverDetected.mime === 'image/png' ? 'png' : 'jpg'
				const blob = new Blob([audioCoverDetected.bytes as BlobPart], { type: audioCoverDetected.mime })
				const u = await uploadBlobToPosts(blob, `cover.${ext}`)
				if (u) coverUrl = u
			}

			audioStaged = [...audioStaged, {
				src:    audioUrl,
				title:  audioTitle.trim(),
				artist: audioArtist.trim(),
				cover:  coverUrl,
			}]

			// Clear current track form but keep the staged queue and download flag
			audioPickedFile = null
			audioTitle = ''
			audioArtist = ''
			audioCoverFile = null
			audioCoverDetected = null
			if (audioCoverPreview) { try { URL.revokeObjectURL(audioCoverPreview) } catch {} }
			audioCoverPreview = null
			if (audioFileEl) audioFileEl.value = ''
			if (audioCoverFileEl) audioCoverFileEl.value = ''
		} catch (err) {
			audioError = 'Erreur réseau pendant l’upload.'
		} finally {
			audioUploading = false
		}
	}

	function removeStaged(idx: number) {
		audioStaged = audioStaged.filter((_, i) => i !== idx)
	}

	function insertStaged() {
		if (audioStaged.length === 0) return
		if (audioStaged.length === 1) {
			const t = audioStaged[0]
			const attrs: Record<string, string> = { src: t.src }
			if (t.title)  attrs['track-title'] = t.title
			if (t.artist) attrs.artist        = t.artist
			if (t.cover)  attrs.cover         = t.cover
			if (audioAllowDownload) attrs.download = '1'
			;(editor?.chain().focus() as any).setNodyxAudio(attrs).run()
		} else {
			;(editor?.chain().focus() as any).setNodyxPlaylist({
				tracks: audioStaged.map(t => ({ src: t.src, title: t.title, artist: t.artist, cover: t.cover })),
				download: audioAllowDownload,
			}).run()
		}
		audioStaged = []
		showAudio = false
		resetAudioForm()
	}

	function insertAudioFromUrl() {
		const src = audioUrlExternal.trim()
		if (!src) return
		if (!src.startsWith('/uploads/')) {
			audioError = 'Seuls les fichiers hébergés sur cette instance sont acceptés (uploade-le via le bouton ci-dessus).'
			return
		}
		const attrs: Record<string, string> = { src }
		if (audioTitle.trim())  attrs['track-title'] = audioTitle.trim()
		if (audioArtist.trim()) attrs.artist        = audioArtist.trim()
		if (audioAllowDownload) attrs.download      = '1'
		;(editor?.chain().focus() as any).setNodyxAudio(attrs).run()
		showAudio = false
		resetAudioForm()
	}

	function insertEmoji(e: string) {
		editor?.chain().focus().insertContent(e).run()
		showEmoji = false
	}

	function setColor(c: string) {
		editor?.chain().focus().setColor(c).run()
		showColor = false
	}

	function toggleAny(key: string) {
		if (!editor) return
		const chain = editor.chain().focus()
		const actions: Record<string, () => any> = {
			bold:      () => chain.toggleBold().run(),
			italic:    () => chain.toggleItalic().run(),
			underline: () => chain.toggleUnderline().run(),
			strike:    () => chain.toggleStrike().run(),
			code:      () => chain.toggleCode().run(),
			h1:        () => chain.toggleHeading({ level: 1 }).run(),
			h2:        () => chain.toggleHeading({ level: 2 }).run(),
			h3:        () => chain.toggleHeading({ level: 3 }).run(),
			bullet:    () => chain.toggleBulletList().run(),
			ordered:   () => chain.toggleOrderedList().run(),
			quote:     () => chain.toggleBlockquote().run(),
			codeBlock: () => chain.toggleCodeBlock().run(),
			left:      () => chain.setTextAlign('left').run(),
			center:    () => chain.setTextAlign('center').run(),
			right:     () => chain.setTextAlign('right').run(),
			justify:   () => chain.setTextAlign('justify').run(),
			hr:        () => chain.setHorizontalRule().run(),
			twoCols:   () => (chain as any).insertTwoCols().run(),
			// Table
			insertTable:  () => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
			addRowAfter:  () => chain.addRowAfter().run(),
			addRowBefore: () => chain.addRowBefore().run(),
			delRow:       () => chain.deleteRow().run(),
			addColAfter:  () => chain.addColumnAfter().run(),
			addColBefore: () => chain.addColumnBefore().run(),
			delCol:       () => chain.deleteColumn().run(),
			delTable:     () => chain.deleteTable().run(),
		}
		actions[key]?.()
	}

	// ── Sommaire automatique ──────────────────────────────────────────────────
	// Scanne les titres h2/h3 du document, pose une ancre (id slugifié) sur
	// ceux qui n'en ont pas, puis insère au curseur une boîte .toc (façon
	// wiki, flottante à droite côté rendu) avec les liens vers chaque titre.
	function slugifyHeading(s: string): string {
		const slug = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
			.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
		return slug || 'section'
	}

	// id unique dans le document (évite les collisions d'ancres).
	function uniqueHeadingId(text: string): string {
		const base = slugifyHeading(text)
		const used = new Set<string>()
		editor.state.doc.descendants((node: any) => {
			if (node.type.name === 'heading' && node.attrs.id) used.add(node.attrs.id)
		})
		if (!used.has(base)) return base
		let i = 2
		while (used.has(`${base}-${i}`)) i++
		return `${base}-${i}`
	}

	// Bloc (titre ou paragraphe) qui contient la sélection.
	function currentBlock(): { node: any; isAnchored: boolean } | null {
		if (!editor) return null
		const selFrom = editor.state.selection.$from
		for (let d = selFrom.depth; d > 0; d--) {
			const node = selFrom.node(d)
			if (node.type.name === 'heading' || node.type.name === 'paragraph') {
				return { node, isAnchored: node.type.name === 'heading' && !!node.attrs.id }
			}
		}
		return null
	}

	// Action du bouton « Ancre » : la ligne devient un titre de section ancré
	// (paragraphe -> h2 ; niveau h2/h3 conservé), et le menu est reconstruit.
	function toggleAnchor(): void {
		if (!editor) return
		const info = currentBlock()
		if (!info) return
		const { node, isAnchored } = info
		if (isAnchored) {
			editor.chain().focus().updateAttributes('heading', { id: null }).run()
		} else {
			const text = node.textContent.trim() || 'section'
			const id = uniqueHeadingId(text)
			if (node.type.name === 'paragraph') {
				editor.chain().focus().setNode('heading', { level: 2, id }).run()
			} else {
				editor.chain().focus().updateAttributes('heading', { id }).run()
			}
		}
		rebuildToc()
		syncBubble()
	}

	// Reconstruit la boîte .toc à partir des titres ancrés (id présent), dans
	// l'ordre du document. Crée la boîte si besoin, la supprime s'il n'y a plus
	// d'ancre. La boîte est dérivée : on ne la saisit pas à la main.
	function rebuildToc(): void {
		if (!editor) return
		const entries: Array<{ id: string; text: string; level: number }> = []
		editor.state.doc.descendants((node: any) => {
			if (node.type.name !== 'heading') return
			const level = node.attrs.level
			if ((level !== 2 && level !== 3) || !node.attrs.id) return
			const text = node.textContent.trim()
			if (text) entries.push({ id: node.attrs.id, text, level })
		})
		let tocPos: number | null = null
		let tocSize = 0
		editor.state.doc.descendants((node: any, pos: number) => {
			if (node.type.name === 'tocBox') { tocPos = pos; tocSize = node.nodeSize; return false }
			return true
		})
		if (entries.length === 0) {
			if (tocPos !== null) {
				editor.chain().command(({ tr }: any) => { tr.delete(tocPos!, tocPos! + tocSize); return true }).run()
			}
			return
		}
		const links: any[] = []
		entries.forEach((e, i) => {
			if (i > 0) links.push({ type: 'hardBreak' })
			links.push({ type: 'text', text: e.level === 3 ? '   ▸ ' : '▸ ' })
			links.push({ type: 'text', text: e.text, marks: [{ type: 'link', attrs: { href: `#${e.id}`, target: null } }] })
		})
		const tocContent = {
			type: 'tocBox',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Sommaire', marks: [{ type: 'bold' }] }] },
				{ type: 'paragraph', content: links },
			],
		}

		// API haut-niveau (robuste) : on retire l'ancienne boîte, puis on insère
		// la nouvelle en tête (après le hero si présent).
		try {
			if (tocPos !== null) {
				editor.chain().deleteRange({ from: tocPos, to: tocPos + tocSize }).run()
			}
			let insertPos = 0
			const first = editor.state.doc.firstChild
			if (first && first.type.name === 'image') insertPos = first.nodeSize
			editor.chain().insertContentAt(insertPos, tocContent).run()
		} catch (err) {
			console.warn('[nodyx-editor] rebuildToc', err)
			return
		}
		flashToc()
	}

	// Petit flash visuel sur la boîte sommaire après une mise à jour : montre
	// clairement à l'auteur que son ancre a été prise en compte.
	function flashToc(): void {
		requestAnimationFrame(() => {
			const el = editorEl?.querySelector('.toc') as HTMLElement | null
			if (!el) return
			el.classList.remove('toc-flash')
			void el.offsetWidth   // reflow pour rejouer l'animation
			el.classList.add('toc-flash')
			setTimeout(() => el.classList.remove('toc-flash'), 1000)
		})
	}

	// Position/visibilité de la barre flottante selon la sélection.
	// Repositionnée aussi au scroll/resize (cf. effet plus bas) pour rester
	// collée à la sélection, et basculée sous le texte si elle déborderait en
	// haut (sinon elle passait sous la barre d'outils — effet « buggé »).
	function syncBubble(): void {
		if (!editor) { bubbleVisible = false; return }
		const sel = editor.state.selection
		const isTextSel = sel instanceof TextSelection
		const parentIsTextblock = sel.$from.parent?.isTextblock
		if (sel.empty || !isTextSel || !parentIsTextblock) { bubbleVisible = false; return }
		const info = currentBlock()
		blockIsAnchored = !!info?.isAnchored
		try {
			const a = editor.view.coordsAtPos(sel.from)
			const b = editor.view.coordsAtPos(sel.to)
			const topY = Math.min(a.top, b.top)
			const botY = Math.max(a.bottom, b.bottom)
			// Si trop près du haut de la fenêtre, on passe la barre sous la sélection.
			bubbleBelow = topY < 64
			bubbleTop  = bubbleBelow ? botY : topY
			bubbleLeft = (a.left + b.left) / 2
			bubbleVisible = true
		} catch {
			bubbleVisible = false
		}
	}

	// ── Preset colours & emoji ────────────────────────────────────────────────
	const COLORS = [
		'#ffffff','#d1d5db','#9ca3af','#6b7280','#374151','#111827',
		'#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#10b981',
		'#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899','#f43f5e',
	]

	const EMOJIS = [
		// Visages
		'😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🥰','😍','🤩','😎','🥳','😏',
		'😢','😭','😤','😡','🤔','🤨','😐','😑','😬','🙄','😴','🥱','🤯','😳',
		// Mains & gestes
		'👍','👎','👋','🙌','👏','🤝','🙏','💪','✌️','🤙','👌','🤞','☝️','👆','🫶',
		// Symboles courants
		'❤️','🔥','⭐','💯','✅','❌','⚠️','💡','📌','🎉','🏆','💎','🚀','💻','📱',
		// Nature & animaux
		'🐱','🐶','🦊','🦁','🐸','🐧','🦋','🌸','🌿','🍀','☀️','🌙','⛅','🌈','❄️',
		// Divers
		'🎮','🎵','🎨','📚','⚙️','🔧','🔮','🌍','🍕','☕','🍺','🎂','🎁','🏠','✈️',
	]
</script>

<!-- ── Hidden form field ────────────────────────────────────────────────── -->
<input type="hidden" {name} value={html} />

<!-- ── Editor shell ────────────────────────────────────────────────────── -->
<div bind:this={wrapperEl} class="nodyx-editor rounded-xl border border-gray-700 bg-gray-900 overflow-visible focus-within:border-indigo-600 transition-colors">

	<!-- ── Toolbar ─────────────────────────────────────────────────────── -->
	{#if editor}
	<div class="nodyx-toolbar flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-800 bg-gray-900/95 backdrop-blur relative z-10 rounded-t-xl shrink-0"
		role="toolbar"
		tabindex="0"
		onmousedown={(e) => {
			// Empêche l'éditeur de perdre le focus quand on clique sur la toolbar,
			// SAUF si la cible est un input/textarea (qui ont besoin du focus natif)
			const tag = (e.target as HTMLElement).tagName
			if (tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault()
		}}
	>

		<!-- Inline formatting -->
		<div class="flex items-center gap-0.5">
			<button type="button" onclick={() => toggleAny('bold')}      class="tb-btn {a.bold      ? 'active' : ''}" title={tFn('editor.bold')}>         <b>B</b></button>
			<button type="button" onclick={() => toggleAny('italic')}    class="tb-btn {a.italic    ? 'active' : ''}" title={tFn('editor.italic')}>  <i>I</i></button>
			<button type="button" onclick={() => toggleAny('underline')} class="tb-btn {a.underline ? 'active' : ''}" title={tFn('editor.underline')}>  <u>U</u></button>
			<button type="button" onclick={() => toggleAny('strike')}    class="tb-btn {a.strike    ? 'active' : ''}" title={tFn('editor.strikethrough')}>               <s>S</s></button>
			<button type="button" onclick={() => toggleAny('code')}      class="tb-btn {a.code      ? 'active' : ''}" title={tFn('editor.code_inline')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
			</button>
		</div>

		<div class="tb-sep"></div>

		<!-- Headings -->
		<div class="flex items-center gap-0.5">
			<button type="button" onclick={() => toggleAny('h1')} class="tb-btn text-xs font-bold {a.h1 ? 'active' : ''}" title={tFn('editor.heading_1')}>H1</button>
			<button type="button" onclick={() => toggleAny('h2')} class="tb-btn text-xs font-bold {a.h2 ? 'active' : ''}" title={tFn('editor.heading_2')}>H2</button>
			<button type="button" onclick={() => toggleAny('h3')} class="tb-btn text-xs font-bold {a.h3 ? 'active' : ''}" title={tFn('editor.heading_3')}>H3</button>
		</div>

		<div class="tb-sep"></div>

		<!-- Blocks -->
		<div class="flex items-center gap-0.5">
			<!-- Blockquote -->
			<button type="button" onclick={() => toggleAny('quote')} class="tb-btn {a.quote ? 'active' : ''}" title={tFn('editor.blockquote')}>
				<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>
			</button>
			<!-- Code block -->
			<button type="button" onclick={() => toggleAny('codeBlock')} class="tb-btn {a.codeBlock ? 'active' : ''}" title={tFn('editor.code_block')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" stroke-width="2"/><path d="M9 9l-3 3 3 3M15 9l3 3-3 3M13 7l-2 10" stroke-width="2" stroke-linecap="round"/></svg>
			</button>
			<!-- HR -->
			<button type="button" onclick={() => toggleAny('hr')} class="tb-btn" title={tFn('editor.hr')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2.5" d="M4 12h16"/></svg>
			</button>
		</div>

		<div class="tb-sep"></div>

		<!-- Lists -->
		<div class="flex items-center gap-0.5">
			<button type="button" onclick={() => toggleAny('bullet')}  class="tb-btn {a.bullet  ? 'active' : ''}" title={tFn('editor.bullet_list')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="7" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="17" r="1.5" fill="currentColor"/><path stroke-linecap="round" stroke-width="2" d="M9 7h11M9 12h11M9 17h11"/></svg>
			</button>
			<button type="button" onclick={() => toggleAny('ordered')} class="tb-btn {a.ordered ? 'active' : ''}" title={tFn('editor.ordered_list')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M9 7h11M9 12h11M9 17h11"/><text x="2" y="9" font-size="6" fill="currentColor">1.</text><text x="2" y="14" font-size="6" fill="currentColor">2.</text><text x="2" y="19" font-size="6" fill="currentColor">3.</text></svg>
			</button>
		</div>

		<div class="tb-sep"></div>

		<!-- Alignements -->
		<div class="flex items-center gap-0.5">
			<button type="button" onclick={() => toggleAny('left')}    class="tb-btn {a.left    ? 'active' : ''}" title={tFn('editor.align_left')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M3 6h18M3 10h12M3 14h18M3 18h12"/></svg>
			</button>
			<button type="button" onclick={() => toggleAny('center')}  class="tb-btn {a.center  ? 'active' : ''}" title={tFn('editor.align_center')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M3 6h18M6 10h12M3 14h18M6 18h12"/></svg>
			</button>
			<button type="button" onclick={() => toggleAny('right')}   class="tb-btn {a.right   ? 'active' : ''}" title={tFn('editor.align_right')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M3 6h18M9 10h12M3 14h18M9 18h12"/></svg>
			</button>
			<button type="button" onclick={() => toggleAny('justify')} class="tb-btn {a.justify ? 'active' : ''}" title={tFn('editor.align_justify')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M3 6h18M3 10h18M3 14h18M3 18h18"/></svg>
			</button>
		</div>

		<div class="tb-sep"></div>

		<!-- Couleur texte -->
		<div class="relative">
			<button type="button" onclick={() => { showColor = !showColor; showEmoji = showLink = showImage = showVideo = showAudio = showTable = false }} class="tb-btn" title={tFn('editor.text_color')}>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-width="2" d="M7 20h10M12 4l5 12H7L12 4z"/></svg>
			</button>
			{#if showColor}
			<div class="popup w-48 grid grid-cols-6 gap-1 p-2" use:autoFlip>
				<button type="button" onclick={() => editor?.chain().focus().unsetColor().run()} class="col-span-6 text-xs text-gray-400 hover:text-white text-left mb-1">{tFn('editor.color_reset')}</button>
				{#each COLORS as c}
					<button type="button" onclick={() => setColor(c)} class="w-6 h-6 rounded border border-gray-700 hover:scale-110 transition-transform" style="background:{c}" title={c}></button>
				{/each}
			</div>
			{/if}
		</div>

		<div class="tb-sep"></div>

		<!-- Lien -->
		<div class="relative">
			<button type="button" onclick={() => { showLink = !showLink; showColor = showEmoji = showImage = showVideo = showAudio = showTable = false }} class="tb-btn {a.link ? 'active' : ''}" title={tFn('editor.insert_link')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
			</button>
			{#if showLink}
			<div class="popup w-72 flex flex-col gap-2 p-3" use:autoFlip>
				<input type="url" bind:value={linkUrl} placeholder="https://..." class="popup-input" onkeydown={e => e.key === 'Enter' && insertLink()} />
				<div class="flex gap-2">
					<button type="button" onclick={insertLink} class="flex-1 popup-btn-primary">{tFn('editor.insert')}</button>
					{#if a.link}<button type="button" onclick={() => { editor?.chain().focus().unsetLink().run(); showLink = false }} class="popup-btn-danger">{tFn('editor.delete_link')}</button>{/if}
				</div>
			</div>
			{/if}
		</div>

		<!-- Image -->
		<div class="relative">
			<button type="button" onclick={toggleImagePopup} class="tb-btn" title={tFn('editor.insert_image')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 15l-5-5L5 21"/></svg>
			</button>
			{#if showImage}
			<div class="popup w-80 flex flex-col gap-2 p-3" use:autoFlip>
				{#if replaceImagePos !== null}
					<div class="flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
						<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg>
						Remplacement de l'image sélectionnée
					</div>
				{/if}
				<!-- Bouton médiathèque -->
				<button type="button" onclick={openMediaPicker}
					class="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-indigo-700/60 bg-indigo-950/30 text-indigo-300 text-xs font-medium hover:bg-indigo-900/40 transition-colors">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
					</svg>
					Choisir depuis la médiathèque
				</button>
				<div class="flex items-center gap-2 text-gray-600">
					<span class="flex-1 h-px bg-gray-800"></span>
					<span class="text-[10px]">ou</span>
					<span class="flex-1 h-px bg-gray-800"></span>
				</div>
				<input type="url" bind:value={imageUrl} placeholder={tFn('editor.image_url_placeholder')} class="popup-input" />
				<input type="text" bind:value={imageAlt} placeholder={tFn('editor.image_alt_placeholder')} class="popup-input" />
				<div class="flex gap-1">
					{#each [['left', tFn('editor.img_align_left')],['center', tFn('editor.img_align_center')],['right', tFn('editor.img_align_right')],['full', tFn('editor.img_align_full')]] as [v, label]}
						<button type="button" onclick={() => imageAlign = v as any}
							class="flex-1 text-xs px-2 py-1 rounded border transition-colors {imageAlign === v ? 'border-indigo-500 bg-indigo-900/50 text-indigo-300' : 'border-gray-700 text-gray-500 hover:border-gray-500'}">
							{label}
						</button>
					{/each}
				</div>
				<button type="button" onclick={insertImage} class="popup-btn-primary">{replaceImagePos !== null ? 'Remplacer' : tFn('editor.insert')}</button>
			</div>
			{/if}
		</div>

		<!-- Vidéo YouTube -->
		<div class="relative">
			<button type="button" onclick={() => { showVideo = !showVideo; showColor = showEmoji = showLink = showImage = showAudio = showTable = false }} class="tb-btn" title={tFn('editor.insert_video')}>
				<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
			</button>
			{#if showVideo}
			<div class="popup w-80 flex flex-col gap-2 p-3" use:autoFlip>
				<p class="text-xs text-gray-500">{tFn('editor.video_hint')}</p>
				<input type="url" bind:value={videoUrl} placeholder="https://youtu.be/…" class="popup-input" onkeydown={e => e.key === 'Enter' && insertVideo()} />
				<button type="button" onclick={insertVideo} class="popup-btn-primary">{tFn('editor.embed_video')}</button>
			</div>
			{/if}
		</div>

		<!-- Audio (mp3 / ogg / wav / m4a / webm) -->
		<div class="relative">
			<button type="button" onclick={() => { showAudio = !showAudio; showColor = showEmoji = showLink = showImage = showVideo = showTable = false }} class="tb-btn" title="Insérer un fichier audio">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
			</button>
			{#if showAudio}
			<div class="popup w-96 flex flex-col gap-2 p-3" use:autoFlip>
				<p class="text-xs text-gray-500">Fichier audio (mp3, ogg, wav, m4a, webm) — max 8 Mo. Les métadonnées (titre, artiste, pochette) sont lues automatiquement pour les mp3.</p>
				<input
					bind:this={audioFileEl}
					type="file"
					accept="audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/mp4,audio/webm,.mp3,.ogg,.wav,.m4a,.webm"
					disabled={audioUploading}
					onchange={onAudioFileChange}
					class="popup-input text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-indigo-700 file:text-white file:cursor-pointer disabled:opacity-50"
				/>

				{#if audioPickedFile}
					<div class="flex gap-3 items-start mt-1">
						<div class="shrink-0">
							{#if audioCoverPreview}
								<img src={audioCoverPreview} alt="Pochette" class="w-16 h-16 rounded object-cover border border-indigo-700/40" />
							{:else}
								<div class="w-16 h-16 rounded border border-dashed border-gray-700 flex items-center justify-center text-gray-600 text-xs">aucune</div>
							{/if}
							<div class="flex gap-1 mt-1">
								<button type="button" onclick={() => audioCoverFileEl?.click()} class="flex-1 text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 hover:border-indigo-500 hover:text-indigo-300 transition-colors">choisir</button>
								{#if audioCoverPreview}
									<button type="button" onclick={clearCover} class="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-red-400 hover:border-red-500 transition-colors" title="Retirer la pochette">×</button>
								{/if}
							</div>
							<input bind:this={audioCoverFileEl} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onchange={onCoverFileChange} />
						</div>
						<div class="flex-1 flex flex-col gap-1.5 min-w-0">
							<input type="text" bind:value={audioTitle}  placeholder="Titre" class="popup-input" />
							<input type="text" bind:value={audioArtist} placeholder="Artiste / auteur" class="popup-input" />
						</div>
					</div>

					<button type="button" onclick={stageAudio} class="popup-btn-primary mt-1" disabled={audioUploading}>
						{audioUploading ? 'Upload en cours…' : (audioStaged.length === 0 ? 'Ajouter cette piste' : '+ Ajouter cette piste à la file')}
					</button>
				{/if}

				{#if audioStaged.length > 0}
					<div class="mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto border border-indigo-700/40 rounded p-1.5 bg-indigo-950/30">
						<div class="text-[10px] text-indigo-300 uppercase tracking-wider px-1">File ({audioStaged.length} piste{audioStaged.length > 1 ? 's' : ''})</div>
						{#each audioStaged as t, i}
							<div class="flex items-center gap-2 text-xs px-1 py-0.5 hover:bg-indigo-900/30 rounded">
								<span class="text-indigo-400 font-mono">{i + 1}.</span>
								{#if t.cover}
									<img src={t.cover} alt="" class="w-6 h-6 rounded object-cover shrink-0" />
								{:else}
									<div class="w-6 h-6 rounded bg-indigo-900/40 shrink-0"></div>
								{/if}
								<div class="flex-1 min-w-0">
									<div class="text-gray-200 truncate">{t.title || t.src.split('/').pop()}</div>
									{#if t.artist}<div class="text-gray-500 text-[10px] truncate">{t.artist}</div>{/if}
								</div>
								<button type="button" onclick={() => removeStaged(i)} class="text-red-400 hover:text-red-300 text-base leading-none px-1" title="Retirer">×</button>
							</div>
						{/each}
					</div>

					<label class="flex items-center gap-2 text-xs text-gray-400 mt-1 cursor-pointer select-none">
						<input type="checkbox" bind:checked={audioAllowDownload} class="accent-indigo-500" />
						<span>Autoriser le téléchargement (bouton ⬇ visible)</span>
					</label>

					<button type="button" onclick={insertStaged} class="popup-btn-primary" disabled={audioUploading}>
						Insérer {audioStaged.length === 1 ? 'le morceau' : `la playlist (${audioStaged.length} pistes)`}
					</button>
				{/if}

				{#if audioError}
					<p class="text-xs text-red-400">{audioError}</p>
				{/if}

				<div class="flex items-center gap-2 text-gray-600 mt-1">
					<span class="flex-1 h-px bg-gray-800"></span>
					<span class="text-[10px]">ou URL /uploads/…</span>
					<span class="flex-1 h-px bg-gray-800"></span>
				</div>
				<input type="text" bind:value={audioUrlExternal} placeholder="/uploads/posts/xxx.mp3" class="popup-input" onkeydown={e => e.key === 'Enter' && insertAudioFromUrl()} />
				<button type="button" onclick={insertAudioFromUrl} class="popup-btn-primary" disabled={audioUploading || !audioUrlExternal.trim()}>Insérer depuis l'URL</button>
			</div>
			{/if}
		</div>

		<!-- Emoji -->
		<div class="relative">
			<button type="button" onclick={() => { showEmoji = !showEmoji; showColor = showLink = showImage = showVideo = showAudio = showTable = false }} class="tb-btn text-base" title={tFn('editor.insert_emoji')}>😊</button>
			{#if showEmoji}
			<div class="popup w-72 p-2 grid grid-cols-10 gap-0.5 max-h-48 overflow-y-auto" use:autoFlip>
				{#each EMOJIS as e}
					<button type="button" onclick={() => insertEmoji(e)} class="text-base p-1 rounded hover:bg-gray-700 transition-colors leading-none">{e}</button>
				{/each}
			</div>
			{/if}
		</div>

		<div class="tb-sep"></div>

		<!-- Deux colonnes -->
		<button type="button" onclick={() => toggleAny('twoCols')} class="tb-btn" title={tFn('editor.two_cols')}>
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="9" height="18" rx="1.5" stroke-width="2"/><rect x="13" y="3" width="9" height="18" rx="1.5" stroke-width="2"/></svg>
		</button>

		<div class="tb-sep"></div>

		<!-- Table -->
		<div class="relative">
			<button type="button" onclick={() => { showTable = !showTable; showColor = showEmoji = showLink = showImage = showVideo = showAudio = false }} class="tb-btn {a.table ? 'active' : ''}" title={tFn('editor.table')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/><path stroke-width="1.5" d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
			</button>
			{#if showTable}
			<div class="popup w-52 p-2 flex flex-col gap-1" use:autoFlip>
				{#if !a.table}
					<button type="button" onclick={() => { toggleAny('insertTable'); showTable = false }} class="table-btn">{tFn('editor.insert_table')}</button>
				{:else}
					<p class="text-xs text-gray-500 px-1 mb-1">{tFn('editor.rows')}</p>
					<button type="button" onclick={() => toggleAny('addRowBefore')} class="table-btn">{tFn('editor.add_row_before')}</button>
					<button type="button" onclick={() => toggleAny('addRowAfter')}  class="table-btn">{tFn('editor.add_row_after')}</button>
					<button type="button" onclick={() => toggleAny('delRow')}       class="table-btn danger">{tFn('editor.del_row')}</button>
					<p class="text-xs text-gray-500 px-1 mt-1 mb-1">{tFn('editor.cols')}</p>
					<button type="button" onclick={() => toggleAny('addColBefore')} class="table-btn">{tFn('editor.add_col_before')}</button>
					<button type="button" onclick={() => toggleAny('addColAfter')}  class="table-btn">{tFn('editor.add_col_after')}</button>
					<button type="button" onclick={() => toggleAny('delCol')}       class="table-btn danger">{tFn('editor.del_col')}</button>
					<hr class="border-gray-700 my-1"/>
					<button type="button" onclick={() => { toggleAny('delTable'); showTable = false }} class="table-btn danger">{tFn('editor.del_table')}</button>
				{/if}
			</div>
			{/if}
		</div>

	</div>
	{/if}

	<!-- ── Media picker modal ───────────────────────────────────────────── -->
	{#if showMediaPicker}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm"
	     role="presentation"
	     onclick={(e) => { if (e.target === e.currentTarget) showMediaPicker = false }}>
		<div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden max-h-[80vh]"
		     onclick={(e) => e.stopPropagation()}>
			<!-- Header -->
			<div class="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
				<h3 class="text-sm font-bold text-white">Médiathèque</h3>
				<button type="button" onclick={() => showMediaPicker = false} class="text-gray-500 hover:text-white transition-colors">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
					</svg>
				</button>
			</div>
			<!-- Grid -->
			<div class="overflow-y-auto p-4 flex-1">
				{#if mediaLoading}
					<div class="flex items-center justify-center py-12 text-gray-500 text-sm">Chargement…</div>
				{:else if mediaImages.length === 0}
					<div class="flex flex-col items-center justify-center py-12 gap-2 text-gray-600">
						<svg class="w-8 h-8 opacity-40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909"/>
						</svg>
						<p class="text-sm">Aucune image hébergée.</p>
						<a href="/admin/media" target="_blank" class="text-xs text-indigo-400 hover:underline">Ouvrir la médiathèque →</a>
					</div>
				{:else}
					<div class="grid grid-cols-3 sm:grid-cols-4 gap-3">
						{#each mediaImages as asset (asset.id)}
						<button type="button" onclick={() => pickMedia(asset)}
							class="group relative aspect-square rounded-xl overflow-hidden border-2 border-transparent hover:border-indigo-500 bg-gray-800 transition-all focus:outline-none focus:border-indigo-400">
							<img src="/uploads/{asset.file_path}" alt={asset.name}
							     class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"/>
							<div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end">
								<p class="w-full px-2 py-1.5 text-[10px] text-white font-medium truncate opacity-0 group-hover:opacity-100 transition-opacity"
								   style="background: linear-gradient(transparent, rgba(0,0,0,0.7))">{asset.name}</p>
							</div>
						</button>
						{/each}
					</div>
				{/if}
			</div>
			<!-- Footer -->
			<div class="px-5 py-3 border-t border-gray-800 shrink-0 flex items-center justify-between">
				<a href="/admin/media" target="_blank" class="text-xs text-indigo-400 hover:underline">Gérer la médiathèque</a>
				<button type="button" onclick={() => showMediaPicker = false}
					class="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs hover:bg-gray-700 transition-colors">
					Annuler
				</button>
			</div>
		</div>
	</div>
	{/if}

	<!-- ── Tiptap content area ──────────────────────────────────────────── -->
	<div
		bind:this={editorEl}
		class="nodyx-content px-4 {compact ? 'min-h-[120px] max-h-[55vh]' : 'min-h-[320px] max-h-[65vh]'} overflow-y-auto py-4"
	></div>

	<!-- ── Barre flottante (quickbar) sur la sélection ──────────────────── -->
	{#if bubbleVisible}
	<div bind:this={bubbleEl} class="nodyx-bubble {bubbleBelow ? 'below' : ''}" style="top:{bubbleTop}px; left:{bubbleLeft}px;" role="toolbar" aria-label="Mise en forme rapide">
		<button type="button" class="nb-btn {a.bold ? 'active' : ''}" title={tFn('editor.bold')}
			onmousedown={(e) => e.preventDefault()} onclick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
		<button type="button" class="nb-btn {a.italic ? 'active' : ''}" title={tFn('editor.italic')}
			onmousedown={(e) => e.preventDefault()} onclick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
		<span class="nb-sep"></span>
		<button type="button" class="nb-btn nb-anchor {blockIsAnchored ? 'active' : ''}"
			title={blockIsAnchored ? 'Retirer du sommaire' : 'Ajouter cette ligne au sommaire'}
			onmousedown={(e) => e.preventDefault()} onclick={toggleAnchor}>
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.4"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12a7 7 0 0014 0"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></svg>
			<span>{blockIsAnchored ? 'Ancré' : 'Ancre'}</span>
		</button>
	</div>
	{/if}

	<!-- ── Footer: character count ─────────────────────────────────────── -->
	{#if editor && !compact}
	<div class="px-4 py-1.5 border-t border-gray-800 flex justify-end">
		<span class="text-xs text-gray-600">{tFn(charCount > 1 ? 'editor.char_count_plural' : 'editor.char_count', { n: String(charCount) })}</span>
	</div>
	{/if}
</div>

<style>
	/* ── Barre flottante (quickbar) ────────────────────────────────────── */
	:global(.nodyx-bubble) {
		position: fixed;
		z-index: 60;
		transform: translate(-50%, calc(-100% - 8px));
		display: flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.2rem;
		background: rgb(17 24 39);
		border: 1px solid rgb(55 65 81);
		border-radius: 0.5rem;
		box-shadow: 0 10px 30px -8px rgb(0 0 0 / 0.7);
		animation: nb-pop 120ms ease-out;
	}
	:global(.nodyx-bubble.below) {
		transform: translate(-50%, 8px);
	}
	@keyframes nb-pop {
		from { opacity: 0; }
		to   { opacity: 1; }
	}
	:global(.nb-btn) {
		display: flex; align-items: center; gap: 0.3rem;
		height: 1.6rem; padding: 0 0.45rem;
		border-radius: 0.3rem;
		color: rgb(209 213 219);
		font-size: 0.8rem; cursor: pointer; user-select: none;
		transition: color 120ms, background-color 120ms;
	}
	:global(.nb-btn:hover)  { background: rgb(55 65 81); color: white; }
	:global(.nb-btn.active) { background: rgb(49 46 129 / 0.8); color: rgb(165 180 252); }
	:global(.nb-anchor) {
		font-weight: 600; font-size: 0.72rem; letter-spacing: 0.02em;
		color: rgb(196 181 253);
	}
	:global(.nb-anchor:hover) { background: rgb(76 29 149 / 0.5); color: white; }
	:global(.nb-anchor.active) { background: rgb(124 58 237 / 0.55); color: white; }
	:global(.nb-sep) { width: 1px; height: 1.1rem; background: rgb(55 65 81); margin: 0 0.15rem; }

	/* ── Toolbar button ────────────────────────────────────────────────── */
	:global(.tb-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.25rem;
		color: rgb(156 163 175);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		user-select: none;
		transition: color 150ms, background-color 150ms;
	}
	:global(.tb-btn:hover) {
		color: white;
		background-color: rgb(55 65 81);
	}
	:global(.tb-btn.active) {
		background-color: rgb(49 46 129 / 0.7);
		color: rgb(165 180 252);
	}
	:global(.tb-sep) {
		width: 1px;
		height: 1.25rem;
		background-color: rgb(55 65 81);
		margin-left: 0.25rem;
		margin-right: 0.25rem;
		flex-shrink: 0;
	}

	/* ── Popups ────────────────────────────────────────────────────────── */
	:global(.popup) {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.25rem;
		z-index: 50;
		background-color: rgb(31 41 55);
		border: 1px solid rgb(55 65 81);
		border-radius: 0.75rem;
		box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.4), 0 8px 10px -6px rgb(0 0 0 / 0.4);
	}
	:global(.popup-input) {
		width: 100%;
		border-radius: 0.5rem;
		background-color: rgb(17 24 39);
		border: 1px solid rgb(75 85 99);
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		color: rgb(229 231 235);
		transition: border-color 150ms;
	}
	:global(.popup-input::placeholder) { color: rgb(75 85 99); }
	:global(.popup-input:focus) {
		outline: none;
		border-color: rgb(99 102 241);
	}
	:global(.popup-btn-primary) {
		border-radius: 0.5rem;
		background-color: rgb(79 70 229);
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: white;
		transition: background-color 150ms;
	}
	:global(.popup-btn-primary:hover) { background-color: rgb(99 102 241); }
	:global(.popup-btn-danger) {
		border-radius: 0.5rem;
		background-color: rgb(127 29 29 / 0.6);
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(248 113 113);
		transition: background-color 150ms, color 150ms;
	}
	:global(.popup-btn-danger:hover) {
		background-color: rgb(127 29 29);
		color: rgb(252 165 165);
	}
	:global(.table-btn) {
		display: block;
		width: 100%;
		text-align: left;
		font-size: 0.875rem;
		color: rgb(209 213 219);
		border-radius: 0.5rem;
		padding: 0.375rem 0.5rem;
		transition: color 150ms, background-color 150ms;
	}
	:global(.table-btn:hover) {
		color: white;
		background-color: rgb(55 65 81);
	}
	:global(.table-btn.danger) { color: rgb(239 68 68); }
	:global(.table-btn.danger:hover) {
		color: rgb(248 113 113);
		background-color: rgb(127 29 29 / 0.2);
	}

	/* Styles éditeur spécifiques à la toolbar (boutons, popups)
	   Les styles prose sont dans app.css (.nodyx-prose / .nodyx-content .tiptap) */
</style>
