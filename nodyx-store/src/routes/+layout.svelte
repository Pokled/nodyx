<script lang="ts">
	import { translator, type Locale } from '$lib/i18n'
	import '../app.css'

	let { data, children } = $props<{ data: { locale: Locale }, children: unknown }>()
	const t = $derived(translator(data.locale))
	const other = $derived(data.locale === 'fr' ? 'en' : 'fr')
</script>

<div class="shell">
	<header class="top">
		<a class="brand" href="/">
			<span class="brand-mark" aria-hidden="true">🧩</span>
			<span>{t('site.title')}</span>
		</a>
		<nav>
			<a href="/">{t('nav.catalog')}</a>
			<a href="/publish">{t('nav.publish')}</a>
			<a href="https://nodyx.dev" rel="noreferrer">{t('nav.docs')}</a>
			<a class="lang" href="/?lang={other}" data-sveltekit-reload>{other.toUpperCase()}</a>
		</nav>
	</header>

	<main>{@render children()}</main>

	<footer class="foot">
		<p>{t('footer.free')}</p>
		<p>{t('footer.no_stars')}</p>
		<p>{t('footer.independent')}</p>
	</footer>
</div>

<style>
	.shell { max-width: 980px; margin: 0 auto; padding: 0 20px; display: flex; flex-direction: column; min-height: 100vh; }

	.top {
		display: flex; align-items: center; justify-content: space-between; gap: 16px;
		padding: 20px 0; border-bottom: 1px solid var(--line);
	}
	.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; text-decoration: none; color: var(--fg); }
	.brand-mark { font-size: 18px; }
	nav { display: flex; align-items: center; gap: 16px; font-size: 14px; }
	nav a { color: var(--fg-muted); text-decoration: none; }
	nav a:hover { color: var(--fg); }
	.lang {
		font-size: 11px; letter-spacing: .06em; padding: 3px 7px;
		border: 1px solid var(--line); border-radius: 6px;
	}

	main { flex: 1; padding: 32px 0 48px; }

	.foot {
		border-top: 1px solid var(--line); padding: 20px 0 32px;
		font-size: 12px; color: var(--fg-muted); display: flex; flex-direction: column; gap: 4px;
	}
	.foot p { margin: 0; }
</style>
