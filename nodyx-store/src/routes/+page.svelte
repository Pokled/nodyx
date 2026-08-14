<script lang="ts">
	import { translator, type Locale } from '$lib/i18n'
	let { data } = $props<{ data: {
		locale: Locale; q: string; category: string | null; total: number;
		extensions: Array<{ id: string; label: string; description: string; official: boolean;
			author: { name: string }; categories: string[]; permissions: number; version: string }>
	} }>()
	const t = $derived(translator(data.locale))
</script>

<section class="intro">
	<h1>{t('site.title')}</h1>
	<p>{t('site.tagline')}</p>
</section>

<form class="filters" method="GET" action="/">
	<input
		class="q" type="search" name="q" value={data.q}
		placeholder={t('search.placeholder')} aria-label={t('search.placeholder')}
	/>
	<div class="cats">
		<a class="cat" class:on={!data.category} href="/">{t('cat.all')}</a>
		<a class="cat" class:on={data.category === 'widgets'} href="/?c=widgets" title={t('cat.widgets_hint')}>{t('cat.widgets')}</a>
		<a class="cat" class:on={data.category === 'modules'} href="/?c=modules" title={t('cat.modules_hint')}>{t('cat.modules')}</a>
	</div>
</form>

<p class="count">{t('list.count', { n: data.extensions.length })}</p>

{#if data.extensions.length === 0}
	<p class="empty">{t('search.none')}</p>
{:else}
	<ul class="grid">
		{#each data.extensions as ext (ext.id)}
			<li class="card">
				<a href="/e/{ext.id}">
					<div class="card-head">
						<strong>{ext.label}</strong>
						{#if ext.official}<span class="tag">{t('card.official')}</span>{/if}
					</div>
					<p class="desc">{ext.description}</p>
					<div class="meta">
						<span>{t('card.by', { author: ext.author.name })}</span>
						<span class="dot" aria-hidden="true">·</span>
						<span>{ext.permissions === 0 ? t('card.no_permission') : t('card.permissions', { n: ext.permissions })}</span>
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.intro { margin-bottom: 24px; }
	.intro p { color: var(--fg-muted); margin: 0; max-width: 60ch; }

	.filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; }
	.q {
		flex: 1; min-width: 220px; padding: 8px 12px; font: inherit; font-size: 14px;
		background: var(--bg-soft); color: var(--fg);
		border: 1px solid var(--line); border-radius: var(--radius-sm);
	}
	.cats { display: flex; gap: 6px; }
	.cat {
		font-size: 13px; padding: 6px 12px; text-decoration: none;
		color: var(--fg-muted); border: 1px solid var(--line); border-radius: var(--radius-sm);
	}
	.cat.on { color: var(--fg); border-color: var(--accent); }

	.count { font-size: 12px; color: var(--fg-muted); margin: 0 0 12px; }
	.empty { color: var(--fg-muted); }

	.grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
	.card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-soft); }
	.card a { display: block; padding: 16px; text-decoration: none; color: inherit; }
	.card:hover { border-color: var(--accent); }

	.card-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
	.tag {
		font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
		color: var(--accent); background: var(--accent-soft);
		padding: 2px 6px; border-radius: var(--radius-sm);
	}
	.desc { margin: 0 0 10px; font-size: 14px; color: var(--fg-muted); }
	.meta { font-size: 12px; color: var(--fg-muted); display: flex; gap: 6px; flex-wrap: wrap; }
</style>
