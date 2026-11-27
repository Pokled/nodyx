<script lang="ts">
	// Un réglage de bloc dans le nouvel éditeur (lot L1c, SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md §4).
	// Un composant par champ, récursif pour les listes. Chaque type montre ce qu'un admin
	// comprend sans aide : une image de la médiathèque (pas une adresse), une page de Nodyx
	// (pas un chemin), une catégorie avec son nombre de sujets, un curseur avec sa valeur.
	import FieldInput from './FieldInput.svelte'
	import MediaPicker from './MediaPicker.svelte'
	import { ChevronRight, ChevronDown, ArrowUp, ArrowDown, Trash2, Plus, ImagePlus, X } from 'lucide-svelte'
	import type { FieldSchema } from '../plugins/_types'
	import { listAdd, listRemove, listMove, listItemLabel, linkChoices, isListedLink, checkLink, defaultsFor, visibleFields, type CategoryRef } from '$lib/homepage/fields'

	interface Props {
		field: FieldSchema
		value: unknown
		/** `merge` : une frappe continue, qui ne fait qu'une étape d'annulation */
		onchange: (value: unknown, merge?: boolean) => void
		t: (key: string, vars?: Record<string, string>) => string
		tr: (s: string | undefined) => string
		categories: CategoryRef[]
		token: string
		/** identifiant unique, pour relier libellé et champ */
		uid: string
	}
	let { field, value, onchange, t, tr, categories, token, uid }: Props = $props()

	const id = $derived(`f-${uid}`)
	const str = $derived(typeof value === 'string' ? value : '')
	const placeholder = $derived(field.example ? t('hpe.example', { x: tr(field.example) }) : tr(field.placeholder))

	// ── Lien ──
	const choices = $derived(linkChoices(categories))
	let customLink = $state(false)
	$effect(() => { if (field.type === 'link' && !isListedLink(value, choices)) customLink = true })
	const linkBad = $derived(field.type === 'link' && customLink && !!str && !checkLink(str).ok)

	// ── Image ──
	let picking = $state(false)

	// ── Liste ──
	const items = $derived(Array.isArray(value) ? (value as Record<string, unknown>[]) : [])
	let open = $state<number | null>(null)
	function setItem(i: number, key: string, v: unknown, merge = false) {
		onchange(items.map((it, k) => (k === i ? { ...it, [key]: v } : it)), merge)
	}
	function addItem() {
		const fresh = field.newItem ?? defaultsFor(field.fields ?? [])
		const next = listAdd(items, fresh, field.maxItems)
		if (next !== items) { onchange(next); open = next.length - 1 }
	}
</script>

{#if field.type === 'boolean'}
	<!-- Interrupteur : le libellé dit ce qui se passe quand c'est allumé -->
	<label class="fi fi--switch" for={id}>
		<span class="fi-text">
			<span class="fi-label">{tr(field.label)}</span>
			{#if field.hint}<span class="fi-help">{tr(field.hint)}</span>{/if}
		</span>
		<input {id} type="checkbox" role="switch" checked={!!value} onchange={e => onchange((e.currentTarget as HTMLInputElement).checked)} />
		<span class="fi-switch" aria-hidden="true"></span>
	</label>
{:else if field.type === 'list'}
	<div class="fi">
		<div class="fi-row">
			<span class="fi-label">{tr(field.label)}</span>
			{#if field.maxItems}<span class="fi-count">{t('hpe.list_count', { n: String(items.length), max: String(field.maxItems) })}</span>{/if}
		</div>
		{#if field.hint}<span class="fi-help">{tr(field.hint)}</span>{/if}
		<ul class="fi-list">
			{#each items as item, i (i)}
				<li class="fi-item" class:on={open === i}>
					<div class="fi-item-head">
						<button type="button" class="fi-item-toggle" aria-expanded={open === i} onclick={() => (open = open === i ? null : i)}>
							{#if open === i}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}
							<span>{listItemLabel(item, field, i, n => t('hpe.list_item', { n: String(n) }))}</span>
						</button>
						<span class="fi-item-tools">
							<button type="button" disabled={i === 0} onclick={() => { onchange(listMove(items, i, i - 1)); if (open === i) open = i - 1 }} aria-label={t('hpe.up')} title={t('hpe.up')}><ArrowUp size={14} /></button>
							<button type="button" disabled={i === items.length - 1} onclick={() => { onchange(listMove(items, i, i + 1)); if (open === i) open = i + 1 }} aria-label={t('hpe.down')} title={t('hpe.down')}><ArrowDown size={14} /></button>
							<button type="button" onclick={() => { onchange(listRemove(items, i)); open = null }} aria-label={t('hpe.remove')} title={t('hpe.remove')}><Trash2 size={14} /></button>
						</span>
					</div>
					{#if open === i}
						<div class="fi-item-body">
							{#each visibleFields(field.fields ?? [], item) as sub (sub.key)}
								<FieldInput field={sub} value={item[sub.key]} onchange={(v, m) => setItem(i, sub.key, v, m)} {t} {tr} {categories} {token} uid={`${uid}-${i}-${sub.key}`} />
							{/each}
							<!-- R2 : le bouton Terminé reste visible dans chaque élément ouvert -->
							<button type="button" class="fi-done" onclick={() => (open = null)}>{t('hpe.done')}</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if !field.maxItems || items.length < field.maxItems}
			<button type="button" class="fi-add" onclick={addItem}><Plus size={15} />{t('hpe.list_add')}</button>
		{/if}
	</div>
{:else}
	<div class="fi">
		<div class="fi-row">
			<label class="fi-label" for={id}>{tr(field.label)}</label>
			{#if field.type === 'slider'}<span class="fi-count">{String(value ?? field.min ?? 0)}</span>{/if}
		</div>
		{#if field.hint}<span class="fi-help">{tr(field.hint)}</span>{/if}

		{#if field.type === 'textarea'}
			<textarea {id} rows="4" value={str} {placeholder} oninput={e => onchange((e.currentTarget as HTMLTextAreaElement).value, true)}></textarea>
		{:else if field.type === 'select'}
			<select {id} value={str || (field.default as string) || ''} onchange={e => onchange((e.currentTarget as HTMLSelectElement).value)}>
				{#each field.options ?? [] as o (o.value)}<option value={o.value}>{tr(o.label)}</option>{/each}
			</select>
		{:else if field.type === 'choice-visual'}
			<div class="fi-choices" role="radiogroup" aria-label={tr(field.label)}>
				{#each field.options ?? [] as o (o.value)}
					<button type="button" role="radio" aria-checked={value === o.value} class:on={value === o.value} onclick={() => onchange(o.value)}>{tr(o.label)}</button>
				{/each}
			</div>
		{:else if field.type === 'number'}
			<input {id} type="number" min={field.min} max={field.max} value={(value as number) ?? field.min ?? 0} oninput={e => onchange(Number((e.currentTarget as HTMLInputElement).value), true)} />
		{:else if field.type === 'slider'}
			<input {id} type="range" min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={(value as number) ?? field.min ?? 0} oninput={e => onchange(Number((e.currentTarget as HTMLInputElement).value), true)} />
		{:else if field.type === 'color'}
			<input {id} type="color" value={str || (field.default as string) || '#1f56c9'} oninput={e => onchange((e.currentTarget as HTMLInputElement).value, true)} />
		{:else if field.type === 'category'}
			<select {id} value={str} onchange={e => onchange((e.currentTarget as HTMLSelectElement).value)}>
				<option value="">{t('hpe.category_pick')}</option>
				{#each categories as c (c.slug)}<option value={c.slug}>{'  '.repeat(c.depth ?? 0)}{c.name} ({t('hpe.topics_n', { n: String(c.thread_count ?? 0) })})</option>{/each}
			</select>
		{:else if field.type === 'link'}
			<select {id} value={customLink ? '__custom' : str} onchange={e => { const v = (e.currentTarget as HTMLSelectElement).value; if (v === '__custom') { customLink = true; onchange('') } else { customLink = false; onchange(v) } }}>
				<option value="">{t('hpe.link_none')}</option>
				<optgroup label={t('hpe.link_pages')}>
					{#each choices.filter(c => c.key) as c (c.value)}<option value={c.value}>{t(c.key!)}</option>{/each}
				</optgroup>
				{#if categories.length}
					<optgroup label={t('hpe.link_categories')}>
						{#each choices.filter(c => !c.key) as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
					</optgroup>
				{/if}
				<option value="__custom">{t('hpe.link_custom')}</option>
			</select>
			{#if !customLink}<span class="fi-help">{t('hpe.link_help')}</span>{/if}
			{#if customLink}
				<input type="text" class="fi-mt" value={str} placeholder={t('hpe.link_custom_ph')} aria-label={t('hpe.link_custom')} oninput={e => onchange((e.currentTarget as HTMLInputElement).value, true)} />
				{#if linkBad}<span class="fi-bad" role="alert">{t('hpe.link_bad')}</span>{/if}
			{/if}
		{:else if field.type === 'media' || field.type === 'image'}
			<div class="fi-media">
				{#if str}
					<img src={str} alt="" class="fi-thumb" />
					<button type="button" class="fi-btn" onclick={() => (picking = true)}>{t('hpe.media_change')}</button>
					<button type="button" class="fi-icon" onclick={() => onchange('')} aria-label={t('hpe.media_remove')} title={t('hpe.media_remove')}><X size={15} /></button>
				{:else}
					<button type="button" class="fi-btn fi-btn--wide" onclick={() => (picking = true)}><ImagePlus size={16} />{t('hpe.media_pick')}</button>
				{/if}
			</div>
			{#if picking}<MediaPicker {t} {token} onpick={url => { onchange(url); picking = false }} onclose={() => (picking = false)} />{/if}
		{:else}
			<input {id} type="text" value={str} {placeholder} oninput={e => onchange((e.currentTarget as HTMLInputElement).value, true)} onkeydown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }} />
		{/if}
	</div>
{/if}

<style>
	.fi { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
	.fi-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
	.fi-label { font-weight: 600; }
	.fi-count { font-size: 12px; color: var(--nx-text-muted); font-variant-numeric: tabular-nums; }
	.fi-help { font-size: 12px; color: var(--nx-text-muted); line-height: 1.4; }
	.fi-bad { font-size: 12px; color: var(--nx-bad); }
	.fi-mt { margin-top: 6px; }
	.fi :is(input[type=text], input[type=number], textarea, select) {
		width: 100%; padding: 8px 10px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px);
		background: var(--nx-surface); color: var(--nx-text); font: inherit;
	}
	.fi :is(input, textarea, select):focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 1px; }
	.fi input[type=range] { width: 100%; accent-color: var(--nx-header-accent); }
	.fi input[type=color] { width: 44px; height: 32px; padding: 2px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-surface); }

	/* Interrupteur */
	.fi--switch { flex-direction: row; align-items: center; gap: 12px; cursor: pointer; position: relative; }
	.fi-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
	.fi--switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
	.fi-switch { flex-shrink: 0; width: 34px; height: 20px; border-radius: 999px; background: var(--nx-border); position: relative; transition: background .15s; }
	.fi-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--nx-surface); box-shadow: 0 1px 2px rgb(0 0 0 / .25); transition: transform .15s var(--ease-out-soft, ease); }
	.fi--switch input:checked + .fi-switch { background: var(--nx-header-accent); }
	.fi--switch input:checked + .fi-switch::after { transform: translateX(14px); }
	.fi--switch input:focus-visible + .fi-switch { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }

	/* Choix visuels */
	.fi-choices { display: flex; flex-wrap: wrap; gap: 6px; }
	.fi-choices button { padding: 6px 10px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-surface); }
	.fi-choices button.on { border-color: var(--nx-header-accent); background: var(--nx-header-accent-soft); font-weight: 600; }

	/* Image */
	.fi-media { display: flex; align-items: center; gap: 8px; }
	.fi-thumb { width: 64px; height: 44px; object-fit: cover; border-radius: var(--nx-r-etiquette, 4px); border: 1px solid var(--nx-border); }
	.fi-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 12px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-surface); font-weight: 600; }
	.fi-btn:hover { border-color: var(--nx-header-accent); }
	.fi-btn--wide { width: 100%; min-height: 56px; border-style: dashed; color: var(--nx-text-muted); }
	.fi-icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--nx-r-controle, 6px); color: var(--nx-text-muted); }
	.fi-icon:hover { background: var(--nx-bg); color: var(--nx-text); }

	/* Liste */
	.fi-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.fi-item { border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-surface); }
	.fi-item.on { border-color: var(--nx-header-accent); box-shadow: 0 0 0 1px var(--nx-header-accent); }
	.fi-item-head { display: flex; align-items: center; }
	.fi-item-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 9px 8px; text-align: left; font-weight: 600; }
	.fi-item-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.fi-item-tools { display: flex; gap: 2px; padding-right: 6px; }
	.fi-item-tools button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--nx-r-etiquette, 4px); color: var(--nx-text-muted); }
	.fi-item-tools button:hover:not(:disabled) { background: var(--nx-bg); color: var(--nx-text); }
	.fi-item-tools button:disabled { opacity: .3; }
	.fi-item-body { padding: 4px 12px 12px; border-top: 1px solid var(--nx-border); }
	.fi-item-body :global(.fi:first-child) { margin-top: 10px; }
	.fi-done { display: block; margin-left: auto; padding: 6px 12px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-controle, 6px); background: var(--nx-surface); font-weight: 600; }
	.fi-done:hover { border-color: var(--nx-header-accent); }
	.fi-add { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 6px; padding: 9px; border: 1px dashed var(--nx-border); border-radius: var(--nx-r-controle, 6px); color: var(--nx-header-accent); font-weight: 600; }
	.fi-add:hover { border-color: var(--nx-header-accent); background: var(--nx-header-accent-soft); }

	button { cursor: pointer; background: none; border: 0; font: inherit; color: inherit; }
	button:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
</style>
