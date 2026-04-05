<script lang="ts">
	import { t } from '$lib/i18n'
	import { page } from '$app/stores';

	const tFn = $derived($t)

	const email = $derived($page.url.searchParams.get('email') ?? '');

	let resending   = $state(false);
	let resendDone  = $state(false);
	let resendError = $state('');

	async function resend() {
		if (!email || resending) return;
		resending   = true;
		resendError = '';
		try {
			const res = await fetch('/api/v1/auth/resend-verification', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ email }),
			});
			if (res.ok) {
				resendDone = true;
			} else {
				const j = await res.json();
				resendError = j.error ?? 'Erreur lors du renvoi.';
			}
		} catch {
			resendError = 'Impossible de contacter le serveur.';
		} finally {
			resending = false;
		}
	}
</script>

<svelte:head>
	<title>{tFn('auth.verify_email.title')} — Nodyx</title>
</svelte:head>

<div class="mx-auto max-w-md pt-16 px-4 text-center">

	<!-- Icône enveloppe -->
	<div class="mx-auto mb-6 w-20 h-20 rounded-2xl flex items-center justify-center text-4xl"
		style="background: rgba(200,145,74,0.1); border: 1px solid rgba(200,145,74,0.3);">
		✉
	</div>

	<h1 class="text-2xl font-bold text-white mb-3">{tFn('auth.verify_email.title')}</h1>

	<p class="text-gray-400 text-sm leading-relaxed mb-2">
		{tFn('auth.verify_email.activation_link_sent_to')}
	</p>
	{#if email}
		<p class="font-semibold mb-6" style="color: #c8914a;">{email}</p>
	{/if}

	<p class="text-gray-500 text-sm leading-relaxed mb-8">
		{tFn('auth.verify_email.click_link_instructions')}
	</p>

	<!-- Renvoi -->
	<div class="border border-gray-800 rounded-xl p-5 text-left">
		<p class="text-sm text-gray-400 mb-3">{tFn('auth.verify_email.nothing_received')}</p>

		{#if resendDone}
			<p class="text-sm text-green-400">{tFn('auth.verify_email.email_resent')}</p>
		{:else}
			{#if resendError}
				<p class="text-sm text-red-400 mb-2">{resendError}</p>
			{/if}
			<button
				onclick={resend}
				disabled={resending || !email}
				class="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors
				       disabled:opacity-50 disabled:cursor-not-allowed"
				style="background: rgba(200,145,74,0.15); border: 1px solid rgba(200,145,74,0.4); color: #c8914a;"
			>
				{resending ? tFn('auth.verify_email.resending') : tFn('auth.verify_email.resend_email_button')}
			</button>
		{/if}
	</div>

	<p class="mt-6 text-sm text-gray-600">
		<a href="/auth/login" class="text-indigo-400 hover:text-indigo-300">{tFn('auth.back_to_login')}</a>
	</p>
</div>
