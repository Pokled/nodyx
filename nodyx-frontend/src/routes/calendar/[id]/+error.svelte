<script lang="ts">
	// Page d'un événement qui ne s'ouvre pas. Avant : la page d'erreur brute de SvelteKit
	// (« 404 / Evenement introuvable »). Le même message vaut pour un événement supprimé
	// ET pour un événement privé vu sans être membre : on ne révèle pas lequel des deux
	// (voir services/eventAccess.ts). On propose une suite : le calendrier, ou se connecter.
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	const tFn = $derived($t);
	const notFound = $derived(page.status === 404);
	const loggedIn = $derived(!!(page.data as { user?: unknown })?.user);
</script>

<svelte:head><title>{notFound ? tFn('event.unavailable_title') : tFn('event.load_error_title')}</title></svelte:head>

<div class="flex-1 flex items-center justify-center px-4 py-16">
	<div class="max-w-md w-full rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-8 text-center">
		<div class="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center bg-[color-mix(in_srgb,var(--nx-header-accent)_14%,transparent)] text-[var(--nx-header-accent)]" aria-hidden="true">
			<svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path stroke-linecap="round" d="M3 10h18M8 3v4M16 3v4"/><path stroke-linecap="round" d="M10 14l4 4M14 14l-4 4"/></svg>
		</div>
		<h1 class="text-lg font-semibold text-[var(--nx-text)] mb-2">
			{notFound ? tFn('event.unavailable_title') : tFn('event.load_error_title')}
		</h1>
		<p class="text-sm text-[var(--nx-text-muted)] mb-6">
			{notFound ? (loggedIn ? tFn('event.unavailable_text_member') : tFn('event.unavailable_text')) : tFn('event.load_error_text')}
		</p>
		<div class="flex flex-wrap justify-center gap-2">
			<a href="/calendar" class="px-4 py-2 rounded-lg bg-[var(--nx-header-accent)] text-white text-sm font-medium">{tFn('event.unavailable_back')}</a>
			{#if notFound && !loggedIn}
				<a href="/auth/login?redirectTo={encodeURIComponent(page.url.pathname)}" class="px-4 py-2 rounded-lg border border-[var(--nx-border)] text-sm text-[var(--nx-text)]">{tFn('auth.login_link')}</a>
			{/if}
		</div>
	</div>
</div>
