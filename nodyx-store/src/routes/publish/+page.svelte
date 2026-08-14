<script lang="ts">
	import { translator, type Locale } from '$lib/i18n'
	let { data } = $props<{ data: { locale: Locale } }>()
	const t = $derived(translator(data.locale))
</script>

<h1>{t('publish.title')}</h1>
<p class="lead">{t('publish.intro')}</p>

<ol class="steps">
	<li>{t('publish.step1')}</li>
	<li>{t('publish.step2')}</li>
	<li>{t('publish.step3')}</li>
</ol>

<section class="block">
	<h2>{t('publish.requirements')}</h2>
	<ul>
		<li>{t('publish.req_license')}</li>
		<li>{t('publish.req_perms')}</li>
		<li>{t('publish.req_i18n')}</li>
		<li>{t('publish.req_immutable')}</li>
	</ul>
</section>

<section class="block">
	<h2>{t('publish.refused')}</h2>
	<ul class="refused">
		<li>{t('publish.ref_tracker')}</li>
		<li>{t('publish.ref_unused')}</li>
		<li>{t('publish.ref_opaque')}</li>
	</ul>
</section>

<style>
	.lead { max-width: 65ch; color: var(--fg-muted); }
	.steps { max-width: 65ch; padding-left: 20px; }
	.steps li { margin-bottom: 6px; }
	.block { border-top: 1px solid var(--line); padding: 20px 0; }
	.block ul { max-width: 65ch; padding-left: 20px; margin: 0; }
	.block li { margin-bottom: 6px; }
	.refused li { color: var(--fg-muted); }
</style>
