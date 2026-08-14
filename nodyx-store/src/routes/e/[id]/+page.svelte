<script lang="ts">
	// La fiche.
	//
	// Sa signature, celle que ni Joomla ni WordPress n'offrent : elle dit ce que
	// l'extension peut TOUCHER, pas seulement ce qu'elle fait. C'est la question
	// a laquelle un admin doit repondre avant d'installer.

	import { translator, type Locale } from '$lib/i18n'
	import type { RegistryEntry, RegistryVersion } from '$lib/registry'

	let { data } = $props<{ data: { locale: Locale; entry: RegistryEntry & { categories: string[] }; latest: RegistryVersion | null } }>()
	const t = $derived(translator(data.locale))

	let domain = $state('')

	/** Libelle lisible d'une capacite, sans jargon de code. */
	function capability(cap: string): string {
		if (cap === 'identity')               return t('cap.identity')
		if (cap.startsWith('identity:'))      return t('cap.identity_field', { field: cap.slice(9) })
		if (cap === 'storage.user')           return t('cap.storage_user')
		if (cap === 'storage.instance.read')  return t('cap.storage_read')
		if (cap === 'storage.instance.write') return t('cap.storage_write')
		if (cap.startsWith('core:'))          return t('cap.core', { scope: cap.slice(5) })
		if (cap.startsWith('net:'))           return t('cap.net', { host: cap.slice(4) })
		return cap
	}

	// Le magasin ne pousse JAMAIS rien : il envoie l'admin vers SON instance,
	// qui telechargera elle meme apres avoir montre les permissions.
	const installUrl = $derived(() => {
		const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
		if (!clean) return ''
		const v = data.latest?.version ?? ''
		return `https://${clean}/admin/extensions/install?src=extensions.nodyx.org&id=${encodeURIComponent(data.entry.id)}&v=${encodeURIComponent(v)}`
	})

	function fmt(iso: string): string {
		return new Date(iso).toISOString().slice(0, 10)
	}
</script>

<a class="back" href="/">← {t('fiche.back')}</a>

<article>
	<header class="head">
		<h1>{data.entry.label}</h1>
		{#if data.entry.official}<span class="tag">{t('card.official')}</span>{/if}
		<span class="ver">{data.latest?.version ?? ''}</span>
	</header>
	<p class="desc">{data.entry.description}</p>
	<p class="by">{t('card.by', { author: data.entry.author.name })}</p>

	<!-- Ce que l'extension peut TOUCHER -->
	<section class="block">
		<h2>{t('fiche.what_it_touches')}</h2>
		{#if !data.latest || data.latest.permissions.length === 0}
			<p class="muted">{t('fiche.nothing_touched')}</p>
		{:else}
			<ul class="caps">
				{#each data.latest.permissions as cap (cap)}
					<li class:sensitive={data.latest.sensitive?.includes(cap)}>
						{capability(cap)}
						{#if data.latest.sensitive?.includes(cap)}<span class="flag">{t('fiche.sensitive')}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Installation : le magasin ne pousse rien, il redirige -->
	<section class="block install">
		<h2>{t('fiche.install')}</h2>
		<p class="muted">{t('fiche.install_hint')}</p>
		<div class="row">
			<label class="sr" for="dom">{t('fiche.domain_label')}</label>
			<input id="dom" type="text" bind:value={domain} placeholder={t('fiche.domain_placeholder')} />
			<a class="go" class:off={!installUrl()} href={installUrl() || '#'} rel="noreferrer">{t('fiche.go')}</a>
		</div>
	</section>

	<section class="block facts">
		<dl>
			<dt>{t('fiche.surfaces')}</dt>
			<dd>{data.entry.surfaces.map((s: string) => s === 'page' ? t('fiche.surface_page') : t('fiche.surface_widget')).join(' · ')}</dd>

			<dt>{t('fiche.license')}</dt>
			<dd>{data.entry.license}</dd>

			<dt>{t('fiche.source')}</dt>
			<dd><a href={data.entry.source} rel="noreferrer">{t('fiche.source_link')}</a></dd>

			<dt>{t('fiche.languages')}</dt>
			<dd>{data.entry.locales.join(', ')}</dd>

			{#if data.latest?.nodyxMin}
				<dt>Nodyx</dt>
				<dd>{t('fiche.requires', { version: data.latest.nodyxMin })}</dd>
			{/if}
		</dl>
	</section>

	<section class="block">
		<h2>{t('fiche.versions')}</h2>
		<ul class="versions">
			{#each data.entry.versions as v (v.version)}
				<li>
					<strong>{v.version}</strong>
					<span class="muted">{t('fiche.published_on', { date: fmt(v.publishedAt) })}</span>
					{#if v.changelog}<p class="chg">{v.changelog}</p>{/if}
				</li>
			{/each}
		</ul>
	</section>
</article>

<style>
	.back { font-size: 13px; text-decoration: none; }
	.head { display: flex; align-items: baseline; gap: 10px; margin: 16px 0 4px; flex-wrap: wrap; }
	.head h1 { margin: 0; }
	.ver { font-size: 12px; color: var(--fg-muted); font-family: ui-monospace, monospace; }
	.tag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); background: var(--accent-soft); padding: 2px 6px; border-radius: var(--radius-sm); }
	.desc { margin: 0 0 4px; max-width: 65ch; }
	.by   { margin: 0 0 24px; font-size: 13px; color: var(--fg-muted); }

	.block { border-top: 1px solid var(--line); padding: 20px 0; }
	.muted { color: var(--fg-muted); font-size: 14px; margin: 0 0 10px; }

	.caps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.caps li { font-size: 14px; padding: 8px 12px; background: var(--bg-soft); border: 1px solid var(--line); border-radius: var(--radius-sm); }
	.caps li.sensitive { border-left: 2px solid var(--warn); }
	.flag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--warn); margin-left: 8px; }

	.install .row { display: flex; gap: 8px; flex-wrap: wrap; }
	.install input { flex: 1; min-width: 220px; padding: 8px 12px; font: inherit; font-size: 14px; background: var(--bg-soft); color: var(--fg); border: 1px solid var(--line); border-radius: var(--radius-sm); }
	.go { padding: 8px 16px; font-size: 14px; text-decoration: none; border: 1px solid var(--accent); border-radius: var(--radius-sm); color: var(--accent); }
	.go.off { opacity: .4; pointer-events: none; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

	.facts dl { display: grid; grid-template-columns: 160px 1fr; gap: 6px 16px; margin: 0; font-size: 14px; }
	.facts dt { color: var(--fg-muted); }
	.facts dd { margin: 0; }

	.versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
	.versions li { font-size: 14px; }
	.versions strong { font-family: ui-monospace, monospace; margin-right: 8px; }
	.chg { margin: 2px 0 0; font-size: 13px; color: var(--fg-muted); }
</style>
