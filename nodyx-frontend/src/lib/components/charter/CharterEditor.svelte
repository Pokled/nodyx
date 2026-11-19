<script lang="ts">
	// L'éditeur de la charte (lot 7b ; maquette v3 validée le 19/11/2026, CDC §E4j).
	// Le moteur de NodyxEditor (TipTap) avec une barre réduite aux blocs de l'aide-mémoire :
	// ce qu'on peut écrire ici est exactement ce que le serveur garde (sanitizeCharter).
	// Les trois vues montrent le MÊME document : le visuel, le code à côté, ou le code seul
	// (modifiable ; le visuel suit, et ce qui n'est pas un bloc est retiré).
	import { onMount, onDestroy, untrack } from 'svelte'
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import '$lib/charter/charter.css'
	import {
		CHARTER_COLORS, COLOR_HEX, PALETTE, GROUPS, BLOCK_ICON, BIOME_PHOTOS, TEMPLATES,
		blockCode, tokens, topLevelBlocks, prettyBlock, highlight, kindOfNode, templateHtml, imgHtml,
		type BlockKind, type CharterColor, type TemplateId,
	} from '$lib/charter/blocks'

	let {
		audience = 'members',
		html = '',
		onchange = (_html: string) => {},
	}: {
		audience?: 'members' | 'team'
		html?: string
		onchange?: (html: string) => void
	} = $props()

	const tFn = $derived($t)
	const tk = $derived(tokens(tFn))
	const token = $derived(((page.data as any)?.token as string | undefined) ?? null)

	let editorEl = $state<HTMLElement | undefined>(undefined)
	let editor: any = $state(null)
	let explainKey: any = null
	let current = $state(untrack(() => html))

	// ── Vues, aides ───────────────────────────────────────────────────────────
	let mode = $state<'visual' | 'split' | 'code'>('visual')
	let explain = $state(false)
	let picked = $state(-1)
	let pickedKind = $state<BlockKind | null>(null)
	let palOpen = $state(false)
	let cheatOpen = $state(false)
	let tplOpen = $state(false)
	let codeText = $state('')
	let codeTimer: ReturnType<typeof setTimeout> | null = null
	let palEl = $state<HTMLElement | undefined>(undefined)

	// ── Image et lien ─────────────────────────────────────────────────────────
	let picker = $state<{ open: boolean; bannerPos: number | null; alt: string }>({ open: false, bannerPos: null, alt: '' })
	let media = $state<Array<{ src: string; name: string }>>([])
	let mediaLoaded = false
	let linkOpen = $state(false)
	let linkUrl = $state('')
	let linkErr = $state('')

	let act = $state({ bold: false, italic: false, underline: false, strike: false, h2: false, list: false, center: false })
	function syncActive() {
		if (!editor) return
		act = {
			bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline'),
			strike: editor.isActive('strike'), h2: editor.isActive('heading', { level: 2 }), list: editor.isActive('bulletList'),
			center: editor.isActive({ textAlign: 'center' }),
		}
	}

	const blocks = $derived(topLevelBlocks(current).map(prettyBlock))

	onMount(async () => {
		const { Editor } = await import('@tiptap/core')
		const { default: StarterKit } = await import('@tiptap/starter-kit')
		const { default: Underline } = await import('@tiptap/extension-underline')
		const { default: TextAlign } = await import('@tiptap/extension-text-align')
		const { default: Link } = await import('@tiptap/extension-link')
		const { default: Image } = await import('@tiptap/extension-image')
		const { default: Color } = await import('@tiptap/extension-color')
		const { TextStyle } = await import('@tiptap/extension-text-style')
		const { default: Placeholder } = await import('@tiptap/extension-placeholder')
		const ext = await import('$lib/charter/extensions')
		explainKey = ext.explainKey

		editor = new Editor({
			element: editorEl,
			extensions: [
				StarterKit.configure({ codeBlock: false, code: false, blockquote: false, link: false, underline: false, heading: { levels: [2, 3] } }),
				Underline,
				TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
				Link.configure({ openOnClick: false, autolink: false, HTMLAttributes: { rel: null, target: null, class: null } }),
				Image.configure({ inline: false, allowBase64: false }),
				TextStyle, Color,
				Placeholder.configure({ placeholder: tFn('chb.placeholder') }),
				ext.CharterBanner.configure({ onPickPhoto: (pos: number) => openPicker(pos) }),
				ext.CharterLead, ext.CharterCallout, ext.HeadingColor,
				ext.CharterExplain.configure({ label: (k: BlockKind) => tFn(`chb.${k}_name`) }),
			],
			content: html || '',
			editorProps: {
				attributes: { class: 'charter-doc ed-visual', 'aria-label': tFn('chb.visual_aria') },
				// « / » au début d'une ligne vide : la palette des blocs
				handleKeyDown: (view: any, event: KeyboardEvent) => {
					if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return false
					const sel = view.state.selection, at = sel.$from
					if (!sel.empty || at.depth !== 1 || at.parent.type.name !== 'paragraph' || at.parent.textContent !== '') return false
					openPalette(); return true
				},
				handleClick: (view: any, pos: number) => {
					if (!explain) return false
					const idx = view.state.doc.resolve(pos).index(0)
					pickBlock(idx)
					return false
				},
			},
			onUpdate: ({ editor: e }: any) => { current = e.getHTML(); onchange(current) },
			onSelectionUpdate: syncActive,
			onTransaction: syncActive,
		})
		current = editor.getHTML()
	})
	onDestroy(() => { editor?.destroy(); if (codeTimer) clearTimeout(codeTimer) })

	// ── Insérer un bloc : à la place d'une ligne vide, sinon juste après le bloc courant ──
	function insertBlock(kind: BlockKind, htmlOverride?: string) {
		if (!editor) return
		if (mode === 'code') setMode('visual')
		const code = htmlOverride ?? blockCode(kind, tFn)
		const { state } = editor
		const here = state.selection.$from
		let at: number | { from: number; to: number } = state.doc.content.size
		if (here.depth >= 1) {
			const node = here.node(1), from = here.before(1), to = here.after(1)
			at = node.type.name === 'paragraph' && node.textContent === '' ? { from, to } : to
		}
		editor.chain().focus().insertContentAt(at, code).run()
		palOpen = false
	}

	function openPalette() {
		palOpen = true
		setTimeout(() => (palEl?.querySelector('button') as HTMLButtonElement | null)?.focus(), 0)
	}
	function palKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { palOpen = false; editor?.commands.focus() }
	}

	// ── La barre ──────────────────────────────────────────────────────────────
	const cmd = (fn: (c: any) => any) => () => { if (editor) fn(editor.chain().focus()).run() }
	function toggleCenter() {
		if (!editor) return
		if (editor.isActive({ textAlign: 'center' })) editor.chain().focus().unsetTextAlign().run()
		else editor.chain().focus().setTextAlign('center').run()
	}
	/** Dans un titre ou un encadré (sans sélection) : sa couleur. Sinon : la couleur du texte choisi. */
	function applyColor(c: CharterColor) {
		if (!editor) return
		const empty = editor.state.selection.empty
		if (empty && editor.isActive('heading')) { editor.chain().focus().updateAttributes('heading', { color: c }).run(); return }
		if (empty && editor.isActive('charterCallout')) { editor.chain().focus().updateAttributes('charterCallout', { color: c }).run(); return }
		editor.chain().focus().setColor(COLOR_HEX[c]).run()
	}
	function insertVar(v: string) { editor?.chain().focus().insertContent(v).run() }

	function openLink() {
		if (!editor) return
		linkErr = ''
		linkUrl = editor.getAttributes('link').href ?? ''
		if (editor.state.selection.empty && !editor.isActive('link')) { linkErr = tFn('chb.link_select_first') }
		linkOpen = true
	}
	function applyLink() {
		const u = linkUrl.trim()
		if (!u) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); linkOpen = false; return }
		if (!/^(https?:\/\/|mailto:|\/(?!\/))/i.test(u)) { linkErr = tFn('chb.link_invalid'); return }
		editor.chain().focus().extendMarkRange('link').setLink({ href: u }).run()
		linkOpen = false
	}

	async function openPicker(bannerPos: number | null = null) {
		picker = { open: true, bannerPos, alt: '' }
		if (mediaLoaded) return
		mediaLoaded = true
		try {
			const res = await apiFetch(fetch, '/assets?type=image&limit=100', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
			if (res.ok) {
				const j = await res.json()
				media = (j.assets ?? []).filter((a: any) => typeof a.file_path === 'string').map((a: any) => ({ src: `/uploads/${a.file_path}`, name: a.name ?? '' }))
			}
		} catch { /* la médiathèque reste vide, les photos de Nodyx suffisent */ }
	}
	function choosePhoto(src: string, name = '') {
		if (!editor) return
		const alt = picker.alt.trim() || name
		if (picker.bannerPos !== null) {
			const pos = picker.bannerPos
			editor.chain().focus().command(({ tr }: any) => {
				const node = tr.doc.nodeAt(pos)
				if (!node || node.type.name !== 'charterBanner') return false
				tr.setNodeMarkup(pos, undefined, { ...node.attrs, src, alt: alt || node.attrs.alt })
				return true
			}).run()
		} else {
			insertBlock('image', imgHtml(src, alt))
		}
		picker = { open: false, bannerPos: null, alt: '' }
	}

	// ── Visuel | Côte à côte | Code source ───────────────────────────────────
	function setMode(m: typeof mode) {
		mode = m
		if (m === 'code') codeText = blocks.join('\n')
	}
	function onCodeInput() {
		if (codeTimer) clearTimeout(codeTimer)
		codeTimer = setTimeout(() => { editor?.commands.setContent(codeText.replace(/\n\s*/g, ''), { emitUpdate: true }) }, 350)
	}

	// ── « Comment c'est fait ? » ─────────────────────────────────────────────
	function setExplain(on: boolean) {
		explain = on
		if (on && mode === 'visual') setMode('split')
		if (!on) { picked = -1; pickedKind = null }
		if (editor && explainKey) editor.view.dispatch(editor.state.tr.setMeta(explainKey, { on, picked: on ? picked : -1 }))
	}
	function pickBlock(idx: number) {
		if (!editor) return
		picked = idx
		const node = editor.state.doc.childCount > idx ? editor.state.doc.child(idx) : null
		pickedKind = node ? kindOfNode(node.type.name) : null
		editor.view.dispatch(editor.state.tr.setMeta(explainKey, { picked: idx }))
		setTimeout(() => document.querySelector('.code-view .blk.lit')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0)
	}

	// ── Les modèles ───────────────────────────────────────────────────────────
	function useTemplate(id: TemplateId) {
		if (!editor) return
		if (!editor.isEmpty && !window.confirm(tFn('chb.tpl_replace_confirm'))) return
		editor.commands.setContent(templateHtml(id, audience, tFn), { emitUpdate: true })
		if (mode === 'code') codeText = blocks.join('\n')
		tplOpen = false
		if (id === 'example') setExplain(true)
	}

	/** Un exemple de l'aide-mémoire, les variables remplacées par un nom et un pseudo d'exemple. */
	// Tout texte traduit est échappé : les traductions arrivent aussi par Weblate.
	const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
	function sample(kind: BlockKind): string {
		const fill = (s: string) => s.split(e(tk.community)).join(e(tFn('chb.sample_community'))).split(e(tk.user)).join(e(tFn('chb.sample_user')))
		if (kind === 'var') return `<p>${e(tFn('chb.var_sample_before'))} <span class="var-chip">${e(tk.community)}</span> → <b>${e(tFn('chb.sample_community'))}</b><br>${e(tFn('chb.var_sample_user'))} <span class="var-chip">${e(tk.user)}</span> → <b>${e(tFn('chb.sample_user'))}</b></p>`
		return fill(blockCode(kind, tFn))
	}
</script>

<p class="ed-same"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>{tFn('chb.same_editor')} <span class="new">{tFn('chb.new')}</span>.</p>

<div class="ed" class:explain>
	<div class="ed-bar" role="toolbar" aria-label={tFn('chb.toolbar_aria')}>
		<button type="button" class="ed-add" aria-haspopup="true" aria-expanded={palOpen} onclick={() => (palOpen ? (palOpen = false) : openPalette())}><b>+</b> {tFn('chb.add_block')}<span class="new">{tFn('chb.new')}</span></button>
		<span class="ed-grp">
			<button type="button" title={tFn('chb.bold')} aria-pressed={act.bold} onmousedown={(e) => e.preventDefault()} onclick={cmd(c => c.toggleBold())}><b>B</b></button>
			<button type="button" title={tFn('chb.italic')} aria-pressed={act.italic} onmousedown={(e) => e.preventDefault()} onclick={cmd(c => c.toggleItalic())}><i>I</i></button>
			<button type="button" title={tFn('chb.underline')} aria-pressed={act.underline} onmousedown={(e) => e.preventDefault()} onclick={cmd(c => c.toggleUnderline())}><u>U</u></button>
			<button type="button" title={tFn('chb.strike')} aria-pressed={act.strike} onmousedown={(e) => e.preventDefault()} onclick={cmd(c => c.toggleStrike())}><s>S</s></button>
		</span>
		<span class="ed-grp">
			<button type="button" title={tFn('chb.title_help')} aria-pressed={act.h2} onmousedown={(e) => e.preventDefault()} onclick={cmd(c => c.toggleHeading({ level: 2 }))}>{tFn('chb.title_btn')}</button>
			<button type="button" title={tFn('chb.list_help')} aria-pressed={act.list} onmousedown={(e) => e.preventDefault()} onclick={cmd(c => c.toggleBulletList())}>{tFn('chb.list_btn')}</button>
			<button type="button" title={tFn('chb.center_btn')} aria-pressed={act.center} onmousedown={(e) => e.preventDefault()} onclick={toggleCenter}>{tFn('chb.center_btn')}</button>
		</span>
		<span class="ed-grp ed-colors" role="group" aria-label={tFn('chb.color_aria')}>
			<span class="ed-lbl">{tFn('chb.color')}</span>
			{#each CHARTER_COLORS as c (c)}
				<button type="button" class="sw" style="--c:{COLOR_HEX[c]}" aria-label={tFn(`chb.color_${c}`)} title={tFn('chb.color_help')} onmousedown={(e) => e.preventDefault()} onclick={() => applyColor(c)}></button>
			{/each}
		</span>
		<span class="ed-grp">
			<button type="button" title={tFn('chb.link')} onmousedown={(e) => e.preventDefault()} onclick={openLink}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>{tFn('chb.link')}</button>
			<button type="button" title={tFn('chb.image')} onmousedown={(e) => e.preventDefault()} onclick={() => openPicker(null)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>{tFn('chb.image')}</button>
		</span>
		<span class="ed-grp">
			<button type="button" class="ed-var" title={tFn('chb.var_community_help')} onmousedown={(e) => e.preventDefault()} onclick={() => insertVar(tk.community)}>{tk.community}</button>
			<button type="button" class="ed-var" title={tFn('chb.var_user_help')} onmousedown={(e) => e.preventDefault()} onclick={() => insertVar(tk.user)}>{tk.user}</button>
			<span class="new">{tFn('chb.new')}</span>
		</span>
		<span class="ed-sp"></span>
		<span class="ed-modes" role="radiogroup" aria-label={tFn('chb.modes_aria')}>
			<button type="button" role="radio" aria-checked={mode === 'visual'} onclick={() => setMode('visual')}>{tFn('chb.mode_visual')}</button>
			<button type="button" role="radio" aria-checked={mode === 'split'} onclick={() => setMode('split')}>{tFn('chb.mode_split')}</button>
			<button type="button" role="radio" aria-checked={mode === 'code'} onclick={() => setMode('code')}>{tFn('chb.mode_code')}</button>
		</span>
	</div>
	<div class="ed-sub">
		<label class="ed-explain"><input type="checkbox" checked={explain} onchange={(e) => setExplain((e.currentTarget as HTMLInputElement).checked)}><span class="tr2"></span>{tFn('chb.explain')}<span class="new">{tFn('chb.new')}</span></label>
		<button type="button" class="ed-help" aria-expanded={cheatOpen} onclick={() => (cheatOpen = !cheatOpen)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5"/></svg>{tFn('chb.cheat_btn')}<span class="new">{tFn('chb.new')}</span></button>
		<span class="ed-tip">{tFn('chb.tip_before')} <kbd>/</kbd> {tFn('chb.tip_after')}</span>
	</div>

	{#if palOpen}
		<div class="pal" role="menu" aria-label={tFn('chb.add_block')} bind:this={palEl} onkeydown={palKey} tabindex="-1">
			{#each PALETTE as k (k)}
				<button type="button" role="menuitem" onclick={() => insertBlock(k)}><span class="pi" aria-hidden="true">{BLOCK_ICON[k]}</span><b>{tFn(`chb.${k}_name`)}</b><small>{tFn(`chb.${k}_what`)}</small></button>
			{/each}
		</div>
	{/if}

	{#if linkOpen}
		<div class="ed-pop" role="dialog" aria-label={tFn('chb.link')}>
			<label class="ed-pop-lbl" for="ch-link">{tFn('chb.link_label')}</label>
			<div class="ed-pop-row">
				<input id="ch-link" class="adm-input" bind:value={linkUrl} placeholder={tFn('chb.link_ph')} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } if (e.key === 'Escape') linkOpen = false }} />
				<button type="button" class="adm-btn adm-btn--primary" onclick={applyLink}>{tFn('chb.apply')}</button>
				<button type="button" class="adm-btn" onclick={() => (linkOpen = false)}>{tFn('chb.cancel')}</button>
			</div>
			{#if linkErr}<p class="ed-pop-err" role="alert">{linkErr}</p>{/if}
		</div>
	{/if}

	{#if picker.open}
		<div class="ed-pop" role="dialog" aria-label={tFn('chb.picker_title')}>
			<div class="ed-pop-head"><b>{picker.bannerPos !== null ? tFn('chb.picker_banner') : tFn('chb.picker_title')}</b><button type="button" class="adm-btn" onclick={() => (picker = { open: false, bannerPos: null, alt: '' })}>{tFn('chb.cancel')}</button></div>
			<label class="ed-pop-lbl" for="ch-alt">{tFn('chb.picker_alt')}</label>
			<input id="ch-alt" class="adm-input" bind:value={picker.alt} maxlength="140" placeholder={tFn('chb.ex_image_alt')} />
			<p class="ed-pop-lbl">{tFn('chb.picker_nodyx')}</p>
			<div class="ed-photos">
				{#each BIOME_PHOTOS as src (src)}
					<button type="button" onclick={() => choosePhoto(src)}><img {src} alt="" loading="lazy" /></button>
				{/each}
			</div>
			<p class="ed-pop-lbl">{tFn('chb.picker_media')}</p>
			{#if media.length}
				<div class="ed-photos">
					{#each media as m (m.src)}
						<button type="button" title={m.name} onclick={() => choosePhoto(m.src, m.name)}><img src={m.src} alt="" loading="lazy" /></button>
					{/each}
				</div>
			{:else}
				<p class="ed-pop-empty">{tFn('chb.picker_media_empty')}</p>
			{/if}
		</div>
	{/if}

	<div class="ed-panes" class:split={mode === 'split'} class:code={mode === 'code'}>
		<div class="ed-visual-wrap" bind:this={editorEl}></div>
		<div class="ed-code">
			<div class="ed-code-head"><span>{tFn('chb.mode_code')}</span><span class="faint">{mode === 'code' ? tFn('chb.code_note_edit') : tFn('chb.code_note')}</span></div>
			{#if mode === 'code'}
				<textarea class="code-edit" spellcheck="false" aria-label={tFn('chb.code_edit_aria')} bind:value={codeText} oninput={onCodeInput}></textarea>
			{:else}
				<pre class="code-view" aria-label={tFn('chb.mode_code')}>{#each blocks as b, i (i)}<span class="blk" class:lit={explain && i === picked}>{@html highlight(b)}</span>{'\n'}{/each}</pre>
			{/if}
		</div>
	</div>
	{#if explain && pickedKind}
		<p class="ed-pick"><b>{tFn(`chb.${pickedKind}_name`)}</b> : {tFn(`chb.${pickedKind}_what`)} {tFn('chb.pick_how')} {tFn(`chb.${pickedKind}_how`).toLowerCase()}.</p>
	{/if}
</div>

{#if cheatOpen}
	<div class="cheat">
		<div class="cheat-head"><b>{tFn('chb.cheat_btn')}</b><span class="small muted">{tFn('chb.cheat_desc')}</span></div>
		<div class="cheat-list">
			{#each GROUPS as [grp, kinds] (grp)}
				<section class="cs-grp">
					<h3>{tFn(`chb.grp_${grp}`)}</h3>
					<div class="cs-row">
						{#each kinds as k (k)}
							<div class="cs" class:lit={explain && pickedKind === k}>
								<div class="cs-prev" aria-hidden="true"><div class="charter-doc">{@html sample(k)}</div></div>
								<div class="cs-body"><b>{tFn(`chb.${k}_name`)}</b><p>{tFn(`chb.${k}_what`)}</p></div>
								<div class="cs-foot">
									{#if k !== 'var'}
										<button type="button" class="adm-btn adm-btn--primary adm-btn--sm" onclick={() => insertBlock(k)}>+ {tFn('chb.add')}</button>
									{:else}
										<span class="small muted">{tFn('chb.var_buttons', { community: tk.community, user: tk.user })}</span>
									{/if}
									<details class="cs-code"><summary>{tFn('chb.see_code')}</summary><span class="how">{tFn(`chb.${k}_how`)}</span><code>{blockCode(k, tFn)}</code></details>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</div>
{/if}

<div class="ed-foot">
	<span class="small muted">{tFn('chb.vars_note', { community: tk.community, user: tk.user })}</span>
	<button type="button" class="adm-btn adm-btn--sm" aria-expanded={tplOpen} onclick={() => (tplOpen = !tplOpen)}>{tFn('chb.tpl_btn')}</button>
</div>
{#if tplOpen}
	<div class="tpls">
		{#each TEMPLATES as id (id)}
			<button type="button" class="tpl" onclick={() => useTemplate(id)}><b>{tFn(`chb.tpl_${id}`)}</b><span>{tFn(`chb.tpl_${id}_desc`)}</span></button>
		{/each}
	</div>
{/if}

<style>
	.new { display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 4px; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; vertical-align: 1px; color: var(--nx-on-accent); background: var(--nx-header-accent); }
	.ed-same { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; font-size: 12px; color: var(--nx-text-muted); }
	.ed-same svg { width: 14px; height: 14px; flex: none; }
	.ed { position: relative; border: 1px solid var(--nx-border); border-radius: 12px; overflow: hidden; background: var(--nx-surface); }
	.ed-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 10px; border-bottom: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-text) 3%, var(--nx-surface)); }
	.ed-add { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 8px; border: 0; background: var(--nx-header-accent); color: var(--nx-on-accent); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
	.ed-add b { font-size: 16px; line-height: 1; }
	.ed-add .new { background: var(--nx-on-accent); color: var(--nx-header-accent); }
	.ed-grp { display: inline-flex; align-items: center; gap: 2px; padding: 0 8px 0 0; border-right: 1px solid var(--nx-border); }
	.ed-grp button { min-height: 30px; min-width: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--nx-text); font: inherit; font-size: 12.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
	.ed-grp button:hover, .ed-grp button[aria-pressed="true"] { background: color-mix(in srgb, var(--nx-text) 8%, transparent); }
	.ed-grp button svg { width: 14px; height: 14px; }
	.ed-lbl { font-size: 12px; color: var(--nx-text-muted); margin-right: 3px; }
	.ed-colors .sw { min-width: 18px; width: 18px; height: 18px; min-height: 18px; padding: 0; border-radius: 99px; background: var(--c); margin: 0 1px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .15); }
	.ed-var { font-family: ui-monospace, Menlo, monospace !important; color: var(--nx-header-accent) !important; }
	.ed-sp { flex: 1; }
	.ed-modes { display: inline-flex; padding: 2px; border-radius: 8px; border: 1px solid var(--nx-border); background: var(--nx-surface); }
	.ed-modes button { min-height: 28px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--nx-text-muted); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
	.ed-modes button[aria-checked="true"] { background: color-mix(in srgb, var(--nx-header-accent) 16%, transparent); color: var(--nx-text); }
	.ed-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 7px 12px; border-bottom: 1px solid var(--nx-border); font-size: 12.5px; }
	.ed-explain { position: relative; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-weight: 600; }
	.ed-explain input { position: absolute; opacity: 0; width: 1px; height: 1px; }
	.tr2 { position: relative; width: 26px; height: 14px; border-radius: 99px; background: color-mix(in srgb, var(--nx-text) 22%, transparent); transition: background .15s; flex: none; }
	.tr2::after { content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 99px; background: #fff; transition: transform .15s; }
	.ed-explain input:checked + .tr2 { background: var(--nx-header-accent); }
	.ed-explain input:checked + .tr2::after { transform: translateX(12px); }
	.ed-explain input:focus-visible + .tr2 { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.ed-help { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 0; color: var(--nx-header-accent); font: inherit; font-weight: 600; cursor: pointer; }
	.ed-help svg { width: 14px; height: 14px; }
	.ed-tip { color: var(--nx-text-muted); margin-left: auto; }
	kbd { font: 11px ui-monospace, Menlo, monospace; padding: 0 5px; border-radius: 4px; border: 1px solid var(--nx-border); background: var(--nx-surface); }

	.pal { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 6px; padding: 10px; border-bottom: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-header-accent) 4%, var(--nx-surface)); outline: none; }
	.pal button { display: grid; grid-template-columns: 30px 1fr; gap: 2px 9px; align-items: center; text-align: left; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font: inherit; cursor: pointer; }
	.pal button:hover, .pal button:focus-visible { border-color: var(--nx-header-accent); outline: none; }
	.pi { grid-row: span 2; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font-weight: 700; font-size: 13px; background: color-mix(in srgb, var(--nx-header-accent) 13%, transparent); color: var(--nx-header-accent); }
	.pal b { font-size: 13px; } .pal small { font-size: 11.5px; color: var(--nx-text-muted); }

	.ed-pop { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-header-accent) 4%, var(--nx-surface)); }
	.ed-pop-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
	.ed-pop-row { display: flex; gap: 6px; flex-wrap: wrap; }
	.ed-pop-row input { flex: 1; min-width: 180px; }
	.ed-pop-lbl { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--nx-text-muted); }
	.ed-pop-err { margin: 0; font-size: 12px; color: var(--nx-bad); }
	.ed-pop-empty { margin: 0; font-size: 12px; color: var(--nx-text-muted); }
	.ed-photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; max-height: 220px; overflow: auto; }
	.ed-photos button { padding: 0; border: 2px solid transparent; border-radius: 8px; overflow: hidden; cursor: pointer; background: none; aspect-ratio: 16 / 10; }
	.ed-photos button:hover, .ed-photos button:focus-visible { border-color: var(--nx-header-accent); outline: none; }
	.ed-photos img { width: 100%; height: 100%; object-fit: cover; display: block; }

	.ed-panes { display: grid; grid-template-columns: 1fr; }
	.ed-panes.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
	.ed-visual-wrap { min-width: 0; }
	.ed-panes.code .ed-visual-wrap { display: none; }
	.ed-visual-wrap :global(.ed-visual) { max-height: 560px; min-height: 220px; overflow: auto; outline: none; }
	.ed-visual-wrap :global(.ed-visual:focus) { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--nx-header-accent) 40%, transparent); }
	.ed-visual-wrap :global(.nx-banner-pick) { cursor: pointer; }
	.ed-visual-wrap :global(p.is-editor-empty:first-child::before) { content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: var(--nx-text-faint); }
	.ed-code { display: none; flex-direction: column; min-width: 0; border-left: 1px solid var(--nx-border); background: #15130f; color: #e9e4da; }
	.ed-panes.split .ed-code, .ed-panes.code .ed-code { display: flex; }
	.ed-panes.code .ed-code { border-left: 0; }
	.ed-code-head { display: flex; justify-content: space-between; gap: 8px; padding: 7px 12px; font-size: 11.5px; font-weight: 650; border-bottom: 1px solid #2c2820; color: #c9c1b2; }
	.ed-code-head .faint { color: #8a8274; font-weight: 500; }
	.code-view, .code-edit { margin: 0; padding: 12px 14px; font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; max-height: 520px; overflow: auto; }
	.code-edit { width: 100%; min-height: 420px; border: 0; outline: none; resize: vertical; background: transparent; color: inherit; }
	.code-view :global(.tg) { color: #7dd3fc; } .code-view :global(.at) { color: #fcd34d; } .code-view :global(.vl) { color: #86efac; } .code-view :global(.vr) { color: #f0abfc; font-weight: 700; }
	.code-view .blk { display: block; border-radius: 4px; transition: background .15s; }
	.code-view .blk.lit { background: rgb(255 176 32 / .2); box-shadow: inset 3px 0 0 #ffb020; }

	/* « Comment c'est fait ? » : chaque bloc montre son nom */
	.explain :global(.charter-doc > *) { position: relative; outline: 1.5px dashed color-mix(in srgb, var(--nx-header-accent) 60%, transparent); outline-offset: 3px; cursor: help; }
	.explain :global(.charter-doc > *::after) { content: attr(data-label); position: absolute; top: -9px; right: 4px; z-index: 2; padding: 0 6px; border-radius: 4px; font: 700 10px/16px system-ui, sans-serif; letter-spacing: .02em; background: var(--nx-header-accent); color: var(--nx-on-accent); pointer-events: none; }
	.explain :global(.charter-doc > .picked) { outline: 2.5px solid var(--nx-header-accent); }
	.ed-pick { margin: 0; padding: 9px 12px; border-top: 1px solid var(--nx-border); font-size: 12.5px; background: color-mix(in srgb, var(--nx-header-accent) 7%, var(--nx-surface)); }

	.cheat { margin-top: 12px; border: 1px solid var(--nx-border); border-radius: 12px; overflow: hidden; }
	.cheat-head { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-bottom: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-text) 3%, var(--nx-surface)); }
	.cheat-list { display: flex; flex-direction: column; gap: 4px; padding: 6px 0 10px; }
	.cs-grp h3 { margin: 10px 14px 8px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--nx-text-muted); }
	.cs-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 10px; padding: 0 14px; }
	.cs { display: flex; flex-direction: column; border: 1px solid var(--nx-border); border-radius: 12px; overflow: hidden; background: var(--nx-surface); }
	.cs.lit { border-color: var(--nx-header-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--nx-header-accent) 30%, transparent); }
	.cs-prev { padding: 12px 14px; height: 118px; overflow: hidden; background: color-mix(in srgb, var(--nx-text) 3%, var(--nx-surface)); border-bottom: 1px solid var(--nx-border); pointer-events: none; }
	.cs-prev :global(.charter-doc) { padding: 0; font-size: 13px; line-height: 1.5; }
	.cs-prev :global(.nx-banner) { margin: -12px -14px 0; height: 118px; }
	.cs-prev :global(.nx-banner figcaption) { font-size: 17px; padding: 0 14px 10px; }
	.cs-prev :global(h2) { margin: 2px 0 4px; font-size: 15px; }
	.cs-prev :global(.nx-callout) { margin: 0; }
	.cs-prev :global(img) { max-width: 100%; height: 86px; object-fit: cover; border-radius: 8px; display: block; }
	.cs-prev :global(.var-chip) { font: 12px ui-monospace, Menlo, monospace; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--nx-header-accent) 14%, transparent); color: var(--nx-header-accent); }
	.cs-body { padding: 10px 14px 4px; display: flex; flex-direction: column; gap: 3px; }
	.cs-body b { font-size: 14px; }
	.cs-body p { margin: 0; font-size: 12.5px; color: var(--nx-text-muted); line-height: 1.45; }
	.cs-foot { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 8px 14px 12px; }
	.cs-code { width: 100%; font-size: 12px; }
	.cs-code summary { cursor: pointer; color: var(--nx-text-muted); font-weight: 600; }
	.cs-code .how { display: block; margin: 6px 0; color: var(--nx-text-faint); font-size: 11.5px; }
	.cs-code code { display: block; font: 11.5px/1.5 ui-monospace, Menlo, monospace; padding: 6px 8px; border-radius: 6px; background: #15130f; color: #e9e4da; white-space: pre-wrap; word-break: break-word; }

	.ed-foot { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
	.small { font-size: 12px; } .muted { color: var(--nx-text-muted); }
	.tpls { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 8px; margin-top: 10px; }
	.tpl { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font: inherit; cursor: pointer; }
	.tpl b { font-size: 13px; } .tpl span { font-size: 12px; color: var(--nx-text-muted); }
	.tpl:hover { border-color: var(--nx-header-accent); }

	@media (max-width: 760px) {
		.ed-panes.split { grid-template-columns: 1fr; }
		.ed-panes.split .ed-code { border-left: 0; border-top: 1px solid var(--nx-border); }
		.ed-tip { display: none; }
	}
</style>
