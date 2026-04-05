<script lang="ts">
	import { t } from '$lib/i18n'
	import type { ActionData } from './$types';
	import { enhance } from '$app/forms';

	const tFn = $derived($t)

	let { form }: { form: ActionData } = $props();

	let submitting    = $state(false);
	let username      = $state('');
	let email         = $state('');
	let password      = $state('');
	let confirmPwd    = $state('');
	let focusedField      = $state<string | null>(null);
	let emailTouched      = $state(false);
	let usernameTouched   = $state(false);

	// Username validation
	const usernameShort = $derived(usernameTouched && username.length > 0 && username.length < 3)

	// Email validation
	const validEmail  = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
	const emailNoAt   = $derived(email.length > 3 && !email.includes('@'))
	const emailNoDot  = $derived(email.length > 5 && email.includes('@') && !/\.[^\s@]{2,}$/.test(email.split('@')[1] ?? ''))
	const emailError  = $derived(emailTouched && email.length > 0 && !validEmail)

	// Password
	const pwdOk       = $derived(password.length >= 8)
	const pwdMismatch = $derived(confirmPwd !== '' && password !== confirmPwd)

	const canSubmit = $derived(
		!submitting && !pwdMismatch && validEmail &&
		pwdOk && confirmPwd !== '' && username.length >= 3
	)

	const mood = $derived(
		submitting                                         ? 'loading' :
		pwdMismatch                                        ? 'error'   :
		(emailTouched && !validEmail && email.length > 0)  ? 'warning' :
		canSubmit                                          ? 'happy'   :
		focusedField                                       ? 'typing'  :
		'idle'
	)

	// Messages courts pour tenir sur 2 lignes dans la bulle (~33 cars/ligne)
	const message = $derived(
		mood === 'loading'                                         ? tFn('auth.register.creating')              :
		mood === 'error'                                           ? tFn('auth.register.password_mismatch')     :
		focusedField === 'email' && emailNoAt                      ? tFn('auth.register.missing_at')                  :
		focusedField === 'email' && emailNoDot                     ? tFn('auth.register.missing_dot_after_at')     :
		mood === 'warning'                                         ? tFn('auth.register.invalid_email')                   :
		mood === 'happy'                                           ? tFn('auth.register.all_good_message')    :
		focusedField === 'username' && usernameShort               ? tFn('auth.register.username_min_3')            :
		focusedField === 'username'                                ? tFn('auth.register.username_hint')    :
		focusedField === 'email'                                   ? tFn('auth.register.email_hint')         :
		focusedField === 'password' && !pwdOk && password.length   ? tFn('auth.register.password_chars_remaining', { n: String(8 - password.length), s: 8 - password.length > 1 ? 's' : '' }) :
		focusedField === 'password'                                ? tFn('auth.register.password_min_8')            :
		focusedField === 'confirm_password'                        ? tFn('auth.register.repeat_password_message')      :
		tFn('auth.register.welcome_message')
	)

	const isError = $derived(mood === 'error' || mood === 'warning')

	const accentColor = $derived(
		mood === 'error' || mood === 'warning' ? '#ef4444' :
		mood === 'happy'                       ? '#10b981' :
		mood === 'loading'                     ? '#f59e0b' :
		'#6366f1'
	)

	const eyeColor = $derived(
		mood === 'typing'  ? '#818cf8' :
		mood === 'happy'   ? '#10b981' :
		'#6366f1'
	)

	const emailInlineError = $derived(
		emailError ? (
			!email.includes('@')            ? tFn('auth.register.email_inline_missing_at') :
			emailNoDot                      ? tFn('auth.register.missing_dot_after_at') :
			tFn('auth.register.email_inline_invalid')
		) : null
	)
</script>

<svelte:head>
	<title>{tFn('auth.register.title')} — Nodyx</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<div class="flex flex-col lg:flex-row gap-8 lg:gap-12 items-start">

		<!-- ── Form ─────────────────────────────────────────────────────── -->
		<div class="w-full max-w-sm order-2 lg:order-1">
			<h1 class="text-2xl font-bold text-white mb-6">{tFn('auth.register.title')}</h1>

			{#if form?.error}
				<p class="mb-4 rounded bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
					{form.error}
				</p>
			{/if}

			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ result }) => {
						if (result.type === 'redirect') {
							window.location.href = result.location;
						} else {
							submitting = false;
							const { applyAction } = await import('$app/forms');
							await applyAction(result);
						}
					};
				}}
				class="space-y-4"
			>
				<div>
					<label for="username" class="block text-sm text-gray-400 mb-1">{tFn('auth.register.username_label')}</label>
					<input
						id="username" name="username" type="text"
						required minlength="3" maxlength="50" autocomplete="username"
						bind:value={username}
						onfocus={() => focusedField = 'username'}
						onblur={() => { focusedField = null; usernameTouched = true; }}
						class="w-full rounded px-3 py-2 text-white focus:outline-none transition-colors bg-gray-800
						       {usernameShort ? 'border border-red-600' : 'border border-gray-700 focus:border-indigo-500'}"
					/>
					<div class="mt-1.5 h-4 flex items-center justify-between text-xs">
						{#if usernameShort}
							<span class="text-red-400">{tFn('auth.register.username_min_3_error')}</span>
						{:else}
							<span class="text-gray-600">{tFn('auth.register.username_hint_text')}</span>
						{/if}
						<span class="{username.length < 3 ? 'text-gray-700' : 'text-gray-500'}">{username.length}/50</span>
					</div>
				</div>

				<div>
					<label for="email" class="block text-sm text-gray-400 mb-1">{tFn('common.email')}</label>
					<input
						id="email" name="email" type="email"
						required autocomplete="email"
						bind:value={email}
						onfocus={() => focusedField = 'email'}
						onblur={() => { focusedField = null; emailTouched = true; }}
						class="w-full rounded px-3 py-2 text-white focus:outline-none transition-colors bg-gray-800
						       {emailError ? 'border border-red-600' : 'border border-gray-700 focus:border-indigo-500'}"
					/>
					<p class="mt-1 h-4 text-xs text-red-400">{emailInlineError ?? ''}</p>
				</div>

				<div>
					<label for="password" class="block text-sm text-gray-400 mb-1">{tFn('common.password')}</label>
					<input
						id="password" name="password" type="password"
						required minlength="8" autocomplete="new-password"
						bind:value={password}
						onfocus={() => focusedField = 'password'}
						onblur={() => focusedField = null}
						class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white
						       focus:outline-none focus:border-indigo-500"
					/>
					<div class="mt-1.5 h-4 flex items-center gap-1.5 text-xs">
						<span class="{pwdOk ? 'text-green-400' : 'text-gray-500'}">{pwdOk ? '✓' : '○'}</span>
						<span class="{pwdOk ? 'text-green-400' : 'text-gray-500'}">
							{tFn('auth.register.password_min_chars_label')}{!pwdOk && password.length > 0 ? ' (' + password.length + '/8)' : ''}
						</span>
					</div>
				</div>

				<div>
					<label for="confirm_password" class="block text-sm text-gray-400 mb-1">
						{tFn('auth.register.confirm_password_label')}
					</label>
					<input
						id="confirm_password" name="confirm_password" type="password"
						required autocomplete="new-password"
						bind:value={confirmPwd}
						onfocus={() => focusedField = 'confirm_password'}
						onblur={() => focusedField = null}
						class="w-full rounded px-3 py-2 text-white focus:outline-none transition-colors bg-gray-800
						       {pwdMismatch ? 'border border-red-600' : 'border border-gray-700 focus:border-indigo-500'}"
					/>
					<p class="mt-1 h-4 text-xs text-red-400">
						{pwdMismatch ? tFn('auth.register.password_mismatch_error') : ''}
					</p>
				</div>

				<button
					type="submit"
					disabled={!canSubmit}
					class="w-full rounded px-4 py-2 text-sm font-semibold text-white transition-colors
					       disabled:opacity-50 disabled:cursor-not-allowed
					       {canSubmit ? 'bg-green-600 hover:bg-green-500' : 'bg-indigo-600 hover:bg-indigo-500'}"
				>
					{submitting ? tFn('auth.register.submitting') : tFn('auth.register.button')}
				</button>
			</form>

			<p class="mt-4 text-center text-sm text-gray-500">
				{tFn('auth.register.already_has_account')}
				<a href="/auth/login" class="text-indigo-400 hover:text-indigo-300">{tFn('auth.login_link')}</a>
			</p>
		</div>

		<!-- ── Robot ─────────────────────────────────────────────────────── -->
		<div class="w-full lg:w-[230px] shrink-0 flex flex-col items-center order-1 lg:order-2 lg:sticky lg:top-24 pt-2">

			<!-- Speech bubble -->
			<div class="relative mb-2 w-full">
				<div class="rounded-2xl px-4 shadow-md text-center w-full border
				            h-[50px] flex items-center justify-center
				            transition-colors duration-300
				            {isError ? 'bg-red-950/60 border-red-800/60' :
				             mood === 'happy' ? 'bg-green-950/60 border-green-800/60' :
				             'bg-gray-800/90 border-gray-700'}">
					<p class="text-xs leading-snug transition-colors duration-200
					          {isError ? 'text-red-300' : mood === 'happy' ? 'text-green-300' : 'text-gray-300'}">
						{message}
					</p>
				</div>
				<div class="absolute -bottom-[7px] left-1/2 -translate-x-1/2 w-0 h-0
				            border-l-[7px] border-r-[7px] border-t-[8px] border-l-transparent border-r-transparent
				            {isError ? 'border-t-red-800/60' : mood === 'happy' ? 'border-t-green-800/60' : 'border-t-gray-700'}">
				</div>
			</div>

			<!-- Robot SVG -->
			<svg
				width="110" height="181" viewBox="0 0 80 132"
				class="transition-all duration-300 mt-1 drop-shadow-lg"
				class:robot-shake={isError}
			>
				<!-- ── Antenna ── -->
				<line x1="40" y1="14" x2="40" y2="6" stroke={accentColor} stroke-width="2" stroke-linecap="round"/>
				<circle
					cx="40" cy="4.5" r="3.5" fill={accentColor}
					class:antenna-bounce={mood === 'typing' || mood === 'loading'}
				/>

				<!-- ── Head ── -->
				<rect x="8" y="14" width="64" height="44" rx="9" fill="#0f172a"/>
				<rect x="8" y="14" width="64" height="44" rx="9" fill="none" stroke="#1e293b" stroke-width="2"/>

				<!-- ── Eyes ── -->
				{#if isError}
					<line x1="18" y1="28" x2="32" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
					<line x1="32" y1="28" x2="18" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
					<line x1="48" y1="28" x2="62" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
					<line x1="62" y1="28" x2="48" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
				{:else if mood === 'happy'}
					<path d="M 16 38 Q 25 27 34 38" stroke="#10b981" stroke-width="3" fill="none" stroke-linecap="round"/>
					<path d="M 46 38 Q 55 27 64 38" stroke="#10b981" stroke-width="3" fill="none" stroke-linecap="round"/>
				{:else if mood === 'loading'}
					<circle cx="25" cy="35" r="8" fill="#0f172a"/>
					<circle cx="25" cy="35" r="5" fill="none" stroke="#1e293b" stroke-width="2"/>
					<circle cx="25" cy="30" r="2" fill="#f59e0b">
						<animateTransform attributeName="transform" type="rotate"
							from="0 25 35" to="360 25 35" dur="0.9s" repeatCount="indefinite"/>
					</circle>
					<circle cx="55" cy="35" r="8" fill="#0f172a"/>
					<circle cx="55" cy="35" r="5" fill="none" stroke="#1e293b" stroke-width="2"/>
					<circle cx="55" cy="30" r="2" fill="#f59e0b">
						<animateTransform attributeName="transform" type="rotate"
							from="0 55 35" to="360 55 35" dur="0.9s" repeatCount="indefinite"/>
					</circle>
				{:else}
					<circle cx="25" cy="35" r="8" fill="#0f172a"/>
					<circle cx="25" cy="35" r="4.5" fill={eyeColor}/>
					<circle cx="22.5" cy="32" r="1.5" fill="white" opacity="0.5"/>
					<circle cx="55" cy="35" r="8" fill="#0f172a"/>
					<circle cx="55" cy="35" r="4.5" fill={eyeColor}/>
					<circle cx="52.5" cy="32" r="1.5" fill="white" opacity="0.5"/>
				{/if}

				<!-- ── Mouth ── -->
				{#if isError}
					<path d="M 27 54 Q 40 49 53 54" stroke="#ef4444" stroke-width="2" fill="none" stroke-linecap="round"/>
				{:else if mood === 'happy'}
					<path d="M 23 49 Q 40 59 57 49" stroke="#10b981" stroke-width="2.5" fill="none" stroke-linecap="round"/>
					<circle cx="18" cy="51" r="4" fill="#10b981" opacity="0.2"/>
					<circle cx="62" cy="51" r="4" fill="#10b981" opacity="0.2"/>
				{:else if mood === 'loading'}
					<circle cx="40" cy="52" r="3.5" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3.5 2">
						<animateTransform attributeName="transform" type="rotate"
							from="0 40 52" to="360 40 52" dur="1.5s" repeatCount="indefinite"/>
					</circle>
				{:else if mood === 'typing'}
					<ellipse cx="40" cy="52" rx="5" ry="3.5" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
				{:else}
					<path d="M 29 51 Q 40 54 51 51" stroke="#334155" stroke-width="2" fill="none" stroke-linecap="round"/>
				{/if}

				<!-- ── Body ── -->
				<rect x="13" y="62" width="54" height="32" rx="8" fill="#0f172a"/>
				<rect x="13" y="62" width="54" height="32" rx="8" fill="none" stroke="#1e293b" stroke-width="2"/>
				<rect x="21" y="69" width="38" height="18" rx="4" fill="#020617"/>
				<!-- LEDs -->
				<circle cx="30" cy="78" r="3.5"
					fill={isError ? '#ef4444' : mood === 'happy' ? '#10b981' : '#6366f1'}
					opacity={mood === 'idle' ? '0.4' : '0.9'}/>
				<circle cx="40" cy="78" r="3.5"
					fill={mood === 'loading' ? '#f59e0b' : mood === 'happy' ? '#10b981' : '#6366f1'}
					opacity={mood === 'idle' ? '0.25' : '0.7'}/>
				<circle cx="50" cy="78" r="3.5"
					fill={mood === 'happy' ? '#10b981' : '#334155'}
					opacity={mood === 'happy' ? '0.9' : '0.4'}/>

				<!-- ── Legs + Feet ── -->
				{#if mood === 'typing' || mood === 'loading'}
					<!-- Left leg walking -->
					<g>
						<animateTransform attributeName="transform" type="translate"
							values="0,0; 0,-5; 0,0; 0,4; 0,0" dur="0.65s" repeatCount="indefinite"/>
						<rect x="20" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
						<ellipse cx="26" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					</g>
					<!-- Right leg walking (opposite phase) -->
					<g>
						<animateTransform attributeName="transform" type="translate"
							values="0,4; 0,0; 0,-5; 0,0; 0,4" dur="0.65s" repeatCount="indefinite"/>
						<rect x="44" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
						<ellipse cx="54" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					</g>
				{:else if mood === 'happy'}
					<!-- Happy jump — both legs up -->
					<g>
						<animateTransform attributeName="transform" type="translate"
							values="0,0; 0,-6; 0,0; 0,-6; 0,0" dur="0.8s" repeatCount="indefinite"/>
						<rect x="20" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
						<ellipse cx="26" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
						<rect x="44" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
						<ellipse cx="54" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					</g>
				{:else if isError}
					<!-- Error — feet shuffle nervously -->
					<rect x="20" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					<rect x="44" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					<ellipse cx="26" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#ef4444" stroke-width="1.5">
						<animateTransform attributeName="transform" type="translate"
							values="-3,0; 3,0; -3,0; 3,0; -3,0" dur="0.25s" repeatCount="indefinite"/>
					</ellipse>
					<ellipse cx="54" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#ef4444" stroke-width="1.5">
						<animateTransform attributeName="transform" type="translate"
							values="3,0; -3,0; 3,0; -3,0; 3,0" dur="0.25s" repeatCount="indefinite"/>
					</ellipse>
				{:else}
					<!-- Static legs -->
					<rect x="20" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					<ellipse cx="26" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					<rect x="44" y="93" width="16" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
					<ellipse cx="54" cy="120" rx="13" ry="7" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
				{/if}
			</svg>
		</div>

	</div>
</div>

<style>
	@keyframes antennaBounce {
		0%, 100% { transform: translateY(0); }
		50%       { transform: translateY(-5px); }
	}
	.antenna-bounce { animation: antennaBounce 0.5s ease-in-out infinite; }

	@keyframes robotShake {
		0%, 100% { transform: translateX(0)    rotate(0deg);    }
		15%      { transform: translateX(-6px) rotate(-2deg);   }
		30%      { transform: translateX(6px)  rotate(2deg);    }
		45%      { transform: translateX(-5px) rotate(-1.5deg); }
		60%      { transform: translateX(5px)  rotate(1.5deg);  }
		75%      { transform: translateX(-3px) rotate(-0.8deg); }
		90%      { transform: translateX(3px)  rotate(0.8deg);  }
	}
	.robot-shake { animation: robotShake 0.45s ease-in-out infinite; }
</style>
