<script lang="ts">
	import { t } from '$lib/i18n'
	import type { ActionData } from './$types'
	import { enhance } from '$app/forms'
	import GlassOrbs from '$lib/components/GlassOrbs.svelte'

	const tFn = $derived($t)

	let { form }: { form: ActionData } = $props()
	let submitting = $state(false)
</script>

<svelte:head>
	<title>{tFn('auth.forgot_password.title')} — Nodyx</title>
</svelte:head>

<div class="w-full h-full min-h-0 p-6 sm:p-8 overflow-hidden bg-[#06060a]">

	<div class="w-full h-full min-h-0 grid grid-cols-1 md:grid-cols-[1fr_minmax(420px,35%)] gap-4 bg-[#06060a]">

		<!-- ════════ Left: Glass orbs + community text ════════ -->
		<div class="relative overflow-hidden hidden md:flex flex-col justify-start min-h-0 p-6 sm:p-8 bg-[#06060a]">
			<div class="absolute inset-0 pointer-events-none"
				style="background:
					radial-gradient(circle at 15% 40%, rgba(124,58,237,0.12) 0%, transparent 45%),
					radial-gradient(circle at 85% 15%, rgba(6,182,212,0.06) 0%, transparent 35%),
					radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px);
					background-size: 100%, 100%, 28px 28px">
			</div>
			<GlassOrbs />
			<div class="relative z-10 max-w-md mt-2">
				<div class="text-[11px] uppercase tracking-[0.15em] mb-3"
					style="color: var(--nx-cyan-soft, #67e8f9); font-family: ui-monospace, monospace">
					{tFn('auth.hero.forgot_tagline')}
				</div>
				<h2 class="text-4xl font-bold leading-tight mb-3 text-white" style="letter-spacing: -0.02em">
					{tFn('auth.hero.forgot_title_1')} <span style="color: var(--nx-accent-2-soft, #a78bfa)">{tFn('auth.hero.forgot_title_2')}</span>
				</h2>
				<p class="text-sm leading-relaxed text-gray-400">
					{tFn('auth.hero.forgot_desc')}
				</p>
			</div>
		</div>

		<!-- ════════ Right: Forgot password form ════════ -->
		<div class="relative flex items-center justify-center min-h-0 h-full overflow-y-auto bg-[#06060a] p-6 sm:p-8">
			<div class="absolute inset-0 pointer-events-none opacity-50"
				style="background: radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px); background-size: 28px 28px">
			</div>

			<div class="relative z-10 w-full max-w-md">

				<!-- Header Brand Badge -->
				<div class="flex items-center gap-2.5 mb-6">
					<span class="text-lg font-bold text-white tracking-tight">Nodyx</span>
				</div>

				<!-- Icon & Title -->
				<div class="flex items-center gap-3 mb-3">
					<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
						</svg>
					</div>
					<div>
						<h1 class="text-2xl font-bold text-white tracking-tight">{tFn('auth.forgot_password.title')}</h1>
					</div>
				</div>

				<p class="text-sm text-gray-400 mb-6 leading-relaxed">
					{tFn('auth.forgot_password.description')}
				</p>

				{#if (form as any)?.sent}
					<!-- Succès — même message que le compte existe ou non -->
					<div class="rounded-xl border border-green-500/30 bg-green-500/10 p-5 text-sm text-green-300 space-y-2 backdrop-blur-sm">
						<div class="flex items-center gap-2 text-green-400 font-semibold">
							<svg class="w-4 h-4 shrink-0 text-green-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							<p>{tFn('auth.forgot_password.email_sent')}</p>
						</div>
						<p class="text-green-300/80 leading-relaxed text-xs pl-6">
							{tFn('auth.forgot_password.check_inbox')}
						</p>
					</div>
					<p class="mt-6 text-center text-sm">
						<a href="/auth/login" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-gray-300 bg-white/[0.03] border border-white/10 hover:text-white hover:bg-white/[0.08] hover:border-white/20 transition-colors active:scale-[0.97] group">
							<svg class="w-3.5 h-3.5 text-gray-400 group-hover:text-white transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
							</svg>
							<span>{tFn('auth.back_to_login')}</span>
						</a>
					</p>
				{:else}
					{#if (form as any)?.error}
						<div class="mb-4 rounded-lg bg-red-950/60 border border-red-800/60 px-4 py-2.5 text-sm text-red-300">
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
						<div>
							<label for="email" class="block text-xs font-medium text-gray-300 mb-1.5 uppercase tracking-wider">{tFn('common.email_address')}</label>
							<input
								id="email"
								name="email"
								type="email"
								required
								autocomplete="email"
								placeholder={tFn('auth.forgot_password.email_placeholder')}
								class="w-full rounded-lg bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-gray-500
								       focus:outline-none focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
							/>
						</div>

						<!-- Bandeau sécurité -->
						<div class="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-xs text-amber-300/90 space-y-2 backdrop-blur-sm">
							<div class="flex items-center gap-2 font-semibold text-amber-400">
								<svg class="w-4 h-4 shrink-0 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751A11.959 11.959 0 0112 2.714z" />
								</svg>
								<span>{tFn('auth.forgot_password.how_it_works')}</span>
							</div>
							<ul class="space-y-1 pl-1 text-amber-200/80">
								<li class="flex items-start gap-1.5"><span class="text-amber-400/60">•</span><span>{tFn('auth.forgot_password.link_expires_1h')}</span></li>
								<li class="flex items-start gap-1.5"><span class="text-amber-400/60">•</span><span>{tFn('auth.forgot_password.one_time_only')}</span></li>
								<li class="flex items-start gap-1.5"><span class="text-amber-400/60">•</span><span>{tFn('auth.forgot_password.all_sessions_disconnect')}</span></li>
								<li class="flex items-start gap-1.5"><span class="text-amber-400/60">•</span><span>{tFn('auth.forgot_password.same_response_all_cases')}</span></li>
							</ul>
						</div>

						<div class="flex items-center gap-3 pt-2">
							<a href="/auth/login" class="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-gray-300 bg-white/[0.03] border border-white/10 hover:text-white hover:bg-white/[0.08] hover:border-white/20 transition-colors active:scale-[0.97] group whitespace-nowrap">
								<svg class="w-3.5 h-3.5 text-gray-400 group-hover:text-white transition-transform group-hover:-translate-x-1 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
								</svg>
								<span>{tFn('auth.back_to_login')}</span>
							</a>

							<button
								type="submit"
								disabled={submitting}
								style="transition: transform 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))"
								class="nx-login-btn flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold text-white shadow-lg shadow-purple-900/20 hover:shadow-purple-700/30 transition-colors active:scale-[0.97]
								       disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
							>
								{submitting ? tFn('auth.forgot_password.sending') : tFn('auth.forgot_password.send_button')}
							</button>
						</div>
					</form>
				{/if}
			</div>
		</div>

	</div>
</div>

<style>
	:global(:root) {
		--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
	}
	.nx-login-btn {
		background: var(--nx-accent-2, #a855f7);
	}
	.nx-login-btn:hover:not(:disabled) {
		background: var(--nx-accent-2-strong, #7c3aed);
	}
</style>