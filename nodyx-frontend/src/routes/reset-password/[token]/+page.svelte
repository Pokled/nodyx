<script lang="ts">
	import type { PageData, ActionData } from './$types'
	import { enhance } from '$app/forms'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let submitting = $state(false)
	let showPwd    = $state(false)
	let showConfirm = $state(false)
	let password   = $state('')
	let confirm    = $state('')

	// Indicateur de force du mot de passe
	const strength = $derived(() => {
		if (!password) return 0
		let score = 0
		if (password.length >= 8)  score++
		if (password.length >= 12) score++
		if (/[A-Z]/.test(password)) score++
		if (/[0-9]/.test(password)) score++
		if (/[^A-Za-z0-9]/.test(password)) score++
		return score
	})

	const strengthLabel = $derived(() => {
		const s = strength()
		if (s <= 1) return { labelKey: 'reset_pwd.strength_weak',   color: 'bg-red-500' }
		if (s <= 3) return { labelKey: 'reset_pwd.strength_medium', color: 'bg-amber-500' }
		return           { labelKey: 'reset_pwd.strength_strong',  color: 'bg-green-500' }
	})

	const passwordsMatch = $derived(confirm.length > 0 && password === confirm)
	const passwordsMismatch = $derived(confirm.length > 0 && password !== confirm)
</script>

<svelte:head>
	<title>{tFn('reset_pwd.meta_title')}</title>
</svelte:head>

<div class="mx-auto max-w-sm">
	<h1 class="text-2xl font-bold text-white mb-1">{tFn('reset_pwd.title')}</h1>
	<p class="text-sm text-gray-500 mb-6">
		{@html tFn('reset_pwd.greeting', { username: data.username })}
	</p>

	{#if (form as any)?.error}
		<div class="mb-4 rounded border border-red-700 bg-red-900/40 px-4 py-2.5 text-sm text-red-300">
			{(form as any).error}
		</div>
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
		<!-- Nouveau mot de passe -->
		<div>
			<label for="password" class="block text-sm text-gray-400 mb-1">{tFn('reset_pwd.password_label')}</label>
			<div class="relative">
				<input
					id="password"
					name="password"
					type={showPwd ? 'text' : 'password'}
					bind:value={password}
					required
					minlength="8"
					autocomplete="new-password"
					class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 pr-10 text-white
					       focus:outline-none focus:border-indigo-500 transition-colors"
				/>
				<button type="button" onclick={() => showPwd = !showPwd}
					class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs px-1 py-0.5">
					{showPwd ? tFn('reset_pwd.hide') : tFn('reset_pwd.show')}
				</button>
			</div>

			<!-- Indicateur de force -->
			{#if password.length > 0}
				<div class="mt-1.5 space-y-1">
					<div class="flex gap-1">
						{#each [1,2,3,4,5] as step}
							<div class="h-1 flex-1 rounded-full {strength() >= step ? strengthLabel().color : 'bg-gray-700'} transition-colors"></div>
						{/each}
					</div>
					<p class="text-xs text-gray-500">{tFn('reset_pwd.strength_prefix')} <span class="font-medium text-gray-400">{tFn(strengthLabel().labelKey)}</span></p>
				</div>
			{/if}
		</div>

		<!-- Confirmation -->
		<div>
			<label for="confirm" class="block text-sm text-gray-400 mb-1">{tFn('reset_pwd.confirm_label')}</label>
			<div class="relative">
				<input
					id="confirm"
					name="confirm"
					type={showConfirm ? 'text' : 'password'}
					bind:value={confirm}
					required
					autocomplete="new-password"
					class="w-full rounded bg-gray-800 border px-3 py-2 pr-10 text-white
					       focus:outline-none focus:border-indigo-500 transition-colors
					       {passwordsMismatch ? 'border-red-600' : passwordsMatch ? 'border-green-600' : 'border-gray-700'}"
				/>
				<button type="button" onclick={() => showConfirm = !showConfirm}
					class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs px-1 py-0.5">
					{showConfirm ? tFn('reset_pwd.hide') : tFn('reset_pwd.show')}
				</button>
			</div>
			{#if passwordsMismatch}
				<p class="mt-1 text-xs text-red-400">{tFn('reset_pwd.mismatch')}</p>
			{:else if passwordsMatch}
				<p class="mt-1 text-xs text-green-400">{tFn('reset_pwd.match')}</p>
			{/if}
		</div>

		<!-- Info sécurité -->
		<div class="rounded-lg border border-amber-700/25 bg-amber-900/8 px-4 py-3 text-xs text-amber-600/70 space-y-0.5">
			<p class="font-semibold text-amber-500/80 mb-1">🔒 Ce qui va se passer</p>
			<p>{@html tFn('reset_pwd.warn_sessions')}</p>
			<p>{@html tFn('reset_pwd.warn_link')}</p>
		</div>

		<button
			type="submit"
			disabled={submitting || passwordsMismatch || password.length < 8}
			class="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
			       px-4 py-2 text-sm font-semibold text-white transition-colors"
		>
			{submitting ? tFn('reset_pwd.submitting') : tFn('reset_pwd.submit')}
		</button>
	</form>

	<p class="mt-4 text-center text-sm text-gray-500">
		<a href="/auth/forgot-password" class="text-indigo-400 hover:text-indigo-300">{tFn('reset_pwd.new_request')}</a>
	</p>
</div>
