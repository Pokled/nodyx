<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte'
	import { t } from '$lib/i18n'

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
	let showTable   = $state(false)

	let linkUrl     = $state('')
	let imageUrl    = $state('')
	let imageAlt    = $state('')
	let imageAlign  = $state<'left'|'center'|'right'|'full'>('center')
	let videoUrl    = $state('')

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
		const { Editor, Node, mergeAttributes } = await import('@tiptap/core')
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

		// ── Two-Column layout extension ───────────────────────────────────────
		const NodyxColumn = Node.create({
			name: 'nodyxColumn',
			group: 'nodyxColumn',
			content: 'block+',
			isolating: true,
			parseHTML()  { return [{ tag: 'div[data-col]' }] },
			renderHTML({ HTMLAttributes }) {
				return ['div', mergeAttributes(HTMLAttributes, { 'data-col': '', class: 'nodyx-col' }), 0]
			},
		})

		const NodyxTwoCols = Node.create({
			name: 'nodyxTwoCols',
			group: 'block',
			content: 'nodyxColumn nodyxColumn',
			isolating: true,
			parseHTML()  { return [{ tag: 'div[data-two-cols]' }] },
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

		editor = new Editor({
			element: editorEl!,
			extensions: [
				StarterKit.configure({ codeBlock: false, link: false, underline: false }),
				Underline,
				TextAlign.configure({ types: ['heading', 'paragraph', 'image'] }),
				Link.configure({ openOnClick: false, autolink: true }),
				AlignableImage,
				Youtube.configure({ nocookie: true }),
				Table.configure({ resizable: false }),
				TableRow, TableCell, TableHeader,
				Color, TextStyle,
				Placeholder.configure({ placeholder: resolvedPlaceholder }),
				CharacterCount,
				CodeBlockLowlight.configure({ lowlight }),
				NodyxTwoCols, NodyxColumn,
			],
			content: initialContent,
			onTransaction() { syncActive() },
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
			showColor = showEmoji = showLink = showImage = showVideo = showTable = false
		}
	}

	$effect(() => {
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	})

	onDestroy(() => editor?.destroy())

	// ── Toolbar commands (shortcuts to editor chain) ──────────────────────────
	const run = (fn: () => void) => { fn(); showColor = showEmoji = showLink = showImage = showVideo = showTable = false }

	function insertLink() {
		if (!linkUrl.trim()) return
		editor?.chain().focus().setLink({ href: linkUrl }).run()
		linkUrl = ''; showLink = false
	}

	function insertImage() {
		if (!imageUrl.trim()) return
		const alignClass = { left: 'float-left mr-4', right: 'float-right ml-4', center: 'mx-auto block', full: 'w-full block' }[imageAlign]
		editor?.chain().focus().setImage({ src: imageUrl, alt: imageAlt || '', class: alignClass, 'data-align': imageAlign }).run()
		imageUrl = ''; imageAlt = ''; showImage = false
	}

	function insertVideo() {
		if (!videoUrl.trim()) return
		editor?.chain().focus().setYoutubeVideo({ src: videoUrl }).run()
		videoUrl = ''; showVideo = false
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
	<div class="nodyx-toolbar flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-800 bg-gray-900/80 relative z-10 rounded-t-xl"
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
			<button type="button" onclick={() => { showColor = !showColor; showEmoji = showLink = showImage = showVideo = showTable = false }} class="tb-btn" title={tFn('editor.text_color')}>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-width="2" d="M7 20h10M12 4l5 12H7L12 4z"/></svg>
			</button>
			{#if showColor}
			<div class="popup w-48 grid grid-cols-6 gap-1 p-2">
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
			<button type="button" onclick={() => { showLink = !showLink; showColor = showEmoji = showImage = showVideo = showTable = false }} class="tb-btn {a.link ? 'active' : ''}" title={tFn('editor.insert_link')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
			</button>
			{#if showLink}
			<div class="popup w-72 flex flex-col gap-2 p-3">
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
			<button type="button" onclick={() => { showImage = !showImage; showColor = showEmoji = showLink = showVideo = showTable = false }} class="tb-btn" title={tFn('editor.insert_image')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 15l-5-5L5 21"/></svg>
			</button>
			{#if showImage}
			<div class="popup w-80 flex flex-col gap-2 p-3">
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
				<button type="button" onclick={insertImage} class="popup-btn-primary">{tFn('editor.insert')}</button>
			</div>
			{/if}
		</div>

		<!-- Vidéo YouTube -->
		<div class="relative">
			<button type="button" onclick={() => { showVideo = !showVideo; showColor = showEmoji = showLink = showImage = showTable = false }} class="tb-btn" title={tFn('editor.insert_video')}>
				<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
			</button>
			{#if showVideo}
			<div class="popup w-80 flex flex-col gap-2 p-3">
				<p class="text-xs text-gray-500">{tFn('editor.video_hint')}</p>
				<input type="url" bind:value={videoUrl} placeholder="https://youtu.be/…" class="popup-input" onkeydown={e => e.key === 'Enter' && insertVideo()} />
				<button type="button" onclick={insertVideo} class="popup-btn-primary">{tFn('editor.embed_video')}</button>
			</div>
			{/if}
		</div>

		<!-- Emoji -->
		<div class="relative">
			<button type="button" onclick={() => { showEmoji = !showEmoji; showColor = showLink = showImage = showVideo = showTable = false }} class="tb-btn text-base" title={tFn('editor.insert_emoji')}>😊</button>
			{#if showEmoji}
			<div class="popup w-72 p-2 grid grid-cols-10 gap-0.5 max-h-48 overflow-y-auto">
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
			<button type="button" onclick={() => { showTable = !showTable; showColor = showEmoji = showLink = showImage = showVideo = false }} class="tb-btn {a.table ? 'active' : ''}" title={tFn('editor.table')}>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/><path stroke-width="1.5" d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
			</button>
			{#if showTable}
			<div class="popup w-52 p-2 flex flex-col gap-1">
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
		class="nodyx-content px-4 {compact ? 'min-h-[120px]' : 'min-h-[320px]'} py-4"
	></div>

	<!-- ── Footer: character count ─────────────────────────────────────── -->
	{#if editor && !compact}
	<div class="px-4 py-1.5 border-t border-gray-800 flex justify-end">
		<span class="text-xs text-gray-600">{tFn(charCount > 1 ? 'editor.char_count_plural' : 'editor.char_count', { n: String(charCount) })}</span>
	</div>
	{/if}
</div>

<style>
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
