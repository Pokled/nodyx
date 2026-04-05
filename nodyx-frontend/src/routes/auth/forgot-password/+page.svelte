<script lang="ts">
	import { t } from '$lib/i18n'
	import type { ActionData } from './$types'
	import { enhance } from '$app/forms'

	const tFn = $derived($t)

	let { form }: { form: ActionData } = $props()
	let submitting = $state(false)
</script>

<svelte:head>
	<title>{tFn('auth.forgot_password.title')} — Nodyx</title>
</svelte:head>

<div class="mx-auto max-w-sm">
	<h1 class="text-2xl font-bold text-white mb-2">{tFn('auth.forgot_password.title')}</h1>
	<p class="text-sm text-gray-500 mb-6">
		{tFn('auth.forgot_password.description')}
	</p>

	{#if (form as any)?.sent}
		<!-- Succès — même message que le compte existe ou non -->
		<div class="rounded-lg border border-green-700/50 bg-green-900/20 px-5 py-4 text-sm text-green-300 space-y-2">
			<p class="font-semibold text-green-200">{tFn('auth.forgot_password.email_sent')}</p>
			<p class="text-green-400/80 leading-relaxed">
				{tFn('auth.forgot_password.check_inbox')}
			</p>
		</div>
		<p class="mt-5 text-center text-sm text-gray-500">
			<a href="/auth/login" class="text-indigo-400 hover:text-indigo-300">{tFn('auth.back_to_login')}</a>
		</p>
	{:else}
		{#if (form as any)?.error}
			<p class="mb-4 rounded bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
				{(form as any).error}
			</p>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				submitting = true
				return async ({ update }) => {
					submitting = false
					await update()
				}
			}}
			class="space-y-4"
		>
			<div>
				<label for="email" class="block text-sm text-gray-400 mb-1">{tFn('common.email_address')}</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					autocomplete="email"
					placeholder={tFn('auth.forgot_password.email_placeholder')}
					class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white placeholder-gray-600
					       focus:outline-none focus:border-indigo-500 transition-colors"
				/>
			</div>

			<!-- Bandeau sécurité -->
			<div class="rounded-lg border border-amber-700/30 bg-amber-900/10 px-4 py-3 text-xs text-amber-600/80 space-y-1">
				<p class="font-semibold text-amber-500/90">{tFn('auth.forgot_password.how_it_works')}</p>
				<ul class="space-y-0.5 pl-1">
					<li>• {tFn('auth.forgot_password.link_expires_1h')}</li>
					<li>• {tFn('auth.forgot_password.one_time_only')}</li>
					<li>• {tFn('auth.forgot_password.all_sessions_disconnect')}</li>
					<li>• {tFn('auth.forgot_password.same_response_all_cases')}</li>
				</ul>
			</div>

			<button
				type="submit"
				disabled={submitting}
				class="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
				       px-4 py-2 text-sm font-semibold text-white transition-colors"
			>
				{submitting ? tFn('auth.forgot_password.sending') : tFn('auth.forgot_password.send_button')}
			</button>
		</form>

		<p class="mt-4 text-center text-sm text-gray-500">
			<a href="/auth/login" class="text-indigo-400 hover:text-indigo-300">{tFn('auth.back_to_login')}</a>
		</p>
	{/if}
</div>
