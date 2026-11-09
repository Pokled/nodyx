<script lang="ts">

	import { t } from '$lib/i18n'
	const tFn = $derived($t)
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{tFn('auth.verify_link.page_title')} · Nodyx</title>
</svelte:head>

<div class="mx-auto max-w-md pt-16 px-4 text-center">
	{#if data.code}
		{@const expired = data.code === 'TOKEN_EXPIRED'}
		<!-- Lien invalide ou expiré -->
		<div class="mx-auto mb-6 w-20 h-20 rounded-2xl flex items-center justify-center text-4xl"
			style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);">
			✕
		</div>
		<h1 class="text-2xl font-bold text-white mb-3">{tFn(expired ? 'auth.verify_link.expired_title' : 'auth.verify_link.invalid_title')}</h1>
		<p class="text-gray-400 text-sm mb-6">{tFn(expired ? 'auth.verify_link.expired' : 'auth.verify_link.invalid')}</p>
		<p class="text-sm text-gray-600">
			<a href="/auth/login" class="text-indigo-400 hover:text-indigo-300">{tFn('auth.back_login')}</a>
		</p>
	{/if}
</div>
