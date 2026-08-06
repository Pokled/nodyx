<script lang="ts">
	import { t } from '$lib/i18n'
	import type { ActionData } from './$types';
	import { enhance } from '$app/forms';
	import GlassOrbs from '$lib/components/GlassOrbs.svelte';

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

	// Anti-bot couche 2 : timestamp d'affichage du formulaire. Si le submit
	// arrive en < 2s, le backend rejette (humain met >10s pour remplir).
	// Calculé une fois au mount, transmis en hidden input.
	const formMountedAt = Date.now();

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
		mood === 'loading'                                           ? tFn('auth.register.creating')              :
		mood === 'error'                                             ? tFn('auth.register.password_mismatch')     :
		focusedField === 'email' && emailNoAt                        ? tFn('auth.register.missing_at')                  :
		focusedField === 'email' && emailNoDot                       ? tFn('auth.register.missing_dot_after_at')     :
		mood === 'warning'                                           ? tFn('auth.register.invalid_email')                   :
		mood === 'happy'                                             ? tFn('auth.register.all_good_message')    :
		focusedField === 'username' && usernameShort                 ? tFn('auth.register.username_min_3')            :
		focusedField === 'username'                                  ? tFn('auth.register.username_hint')    :
		focusedField === 'email'                                     ? tFn('auth.register.email_hint')         :
		focusedField === 'password' || focusedField === 'confirm_password' ? tFn('auth.bot.password_shy') :
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
					{tFn('auth.hero.tagline')}
				</div>
				<h2 class="text-4xl font-bold leading-tight mb-3 text-white" style="letter-spacing: -0.02em">
					{tFn('auth.hero.register_title_1')} <span style="color: var(--nx-accent-2-soft, #a78bfa)">{tFn('auth.hero.register_title_2')}</span>.
				</h2>
				<p class="text-sm leading-relaxed text-gray-400">
					{tFn('auth.hero.register_desc')}
				</p>
			</div>
			<!-- ── Robot (on canvas, bottom-right) ──────────────────────────── -->
			<div class="absolute bottom-6 right-6 z-10 flex flex-col items-center w-[180px] shrink-0">

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
					{:else if focusedField === 'password' || focusedField === 'confirm_password'}
						<!-- Robot hands covering eyes when entering sensitive password -->
						<path d="M 18 36 Q 25 44 32 36" stroke="#818cf8" stroke-width="3" fill="none" stroke-linecap="round"/>
						<path d="M 48 36 Q 55 44 62 36" stroke="#818cf8" stroke-width="3" fill="none" stroke-linecap="round"/>
						<rect x="15" y="26" width="18" height="14" rx="4" fill="#1e293b" stroke="#818cf8" stroke-width="1.5"/>
						<rect x="47" y="26" width="18" height="14" rx="4" fill="#1e293b" stroke="#818cf8" stroke-width="1.5"/>
					{:else}
						<!-- Open eyes with left-to-right pupil tracking -->
						{@const activeLength = focusedField === 'username' ? username.length : focusedField === 'email' ? email.length : 0}
						<circle cx="25" cy="35" r="8" fill="#0f172a"/>
						<circle cx={22 + Math.min(6, activeLength * 0.25)} cy="35" r="4.5" fill={eyeColor} class="transition-all duration-150"/>
						<circle cx={19.5 + Math.min(6, activeLength * 0.25)} cy="32" r="1.5" fill="white" opacity="0.8" class="transition-all duration-150"/>
						<circle cx="55" cy="35" r="8" fill="#0f172a"/>
						<circle cx={52 + Math.min(6, activeLength * 0.25)} cy="35" r="4.5" fill={eyeColor} class="transition-all duration-150"/>
						<circle cx={49.5 + Math.min(6, activeLength * 0.25)} cy="32" r="1.5" fill="white" opacity="0.8" class="transition-all duration-150"/>
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
						fill={isError ? '#ef4444' : mood === 'happy' ? '#10b981' : 'var(--nx-accent)'}
						opacity={mood === 'idle' ? '0.4' : '0.9'}/>
					<circle cx="40" cy="78" r="3.5"
						fill={mood === 'loading' ? '#f59e0b' : mood === 'happy' ? '#10b981' : 'var(--nx-accent)'}
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

		<!-- ════════ Right: Register form ════════ -->
		<div class="relative flex items-center justify-center min-h-0 h-full overflow-y-auto bg-[#06060a] p-6 sm:p-8">
			<div class="absolute inset-0 pointer-events-none opacity-50"
				style="background: radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px); background-size: 28px 28px">
			</div>

			<div class="relative z-10 w-full max-w-md">

				<!-- Logo -->
				<div class="flex items-center gap-2.5 mb-6">
					<span class="text-lg font-bold text-white tracking-tight">Nodyx</span>
				</div>

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
						<div class="hidden" aria-hidden="true">
							<!-- Anti-bot couche 1 : honeypot field -->
							<label for="website-hp">Site web</label>
							<input id="website-hp" name="website" type="text" tabindex="-1" autocomplete="off" />
							<!-- Anti-bot couche 2 : timestamp -->
							<input type="hidden" name="form_t" value={formMountedAt} />
						</div>

						<div>
							<label for="username" class="block text-xs font-medium text-gray-300 mb-1.5 uppercase tracking-wider">{tFn('auth.register.username_label')}</label>
							<input
								id="username" name="username" type="text"
								required minlength="3" maxlength="50" autocomplete="username"
								bind:value={username}
								onfocus={() => focusedField = 'username'}
								onblur={() => { focusedField = null; usernameTouched = true; }}
								class="w-full rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none transition-colors duration-200 bg-white/[0.04]
								       {usernameShort ? 'border border-red-500/80 focus:ring-2 focus:ring-red-500/20' : 'border border-white/10 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20'}"
							/>
							<div class="mt-1 flex items-center justify-between text-xs">
								{#if usernameShort}
									<span class="text-red-400">{tFn('auth.register.username_min_3_error')}</span>
								{:else}
									<span class="text-gray-500">{tFn('auth.register.username_hint_text')}</span>
								{/if}
								<span class="{username.length < 3 ? 'text-gray-600' : 'text-gray-400'}">{username.length}/50</span>
							</div>
						</div>

						<div>
							<label for="email" class="block text-xs font-medium text-gray-300 mb-1.5 uppercase tracking-wider">{tFn('common.email')}</label>
							<input
								id="email" name="email" type="email"
								required autocomplete="email"
								bind:value={email}
								onfocus={() => focusedField = 'email'}
								onblur={() => { focusedField = null; emailTouched = true; }}
								class="w-full rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none transition-colors duration-200 bg-white/[0.04]
								       {emailError ? 'border border-red-500/80 focus:ring-2 focus:ring-red-500/20' : 'border border-white/10 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20'}"
							/>
							<div class="mt-1 h-4 flex items-center text-xs">
								<span class="text-red-400">{emailInlineError ?? ''}</span>
							</div>
						</div>

						<div>
							<label for="password" class="block text-xs font-medium text-gray-300 mb-1.5 uppercase tracking-wider">{tFn('common.password')}</label>
							<input
								id="password" name="password" type="password"
								required minlength="8" autocomplete="new-password"
								bind:value={password}
								onfocus={() => focusedField = 'password'}
								onblur={() => focusedField = null}
								class="w-full rounded-lg bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white
								       focus:outline-none focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20 transition-colors duration-200"
							/>
							<div class="mt-1 h-4 flex items-center gap-1.5 text-xs">
								<span class="{pwdOk ? 'text-green-400' : 'text-gray-500'}">{pwdOk ? '✓' : '○'}</span>
								<span class="{pwdOk ? 'text-green-400' : 'text-gray-500'}">
									{tFn('auth.register.password_min_chars_label')}{!pwdOk && password.length > 0 ? ' (' + password.length + '/8)' : ''}
								</span>
							</div>
						</div>

						<div>
							<label for="confirm_password" class="block text-xs font-medium text-gray-300 mb-1.5 uppercase tracking-wider">
								{tFn('auth.register.confirm_password_label')}
							</label>
							<input
								id="confirm_password" name="confirm_password" type="password"
								required autocomplete="new-password"
								bind:value={confirmPwd}
								onfocus={() => focusedField = 'confirm_password'}
								onblur={() => focusedField = null}
								class="w-full rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none transition-colors duration-200 bg-white/[0.04]
								       {pwdMismatch ? 'border border-red-500/80 focus:ring-2 focus:ring-red-500/20' : 'border border-white/10 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20'}"
							/>
							<div class="mt-1 h-4 flex items-center text-xs">
								{#if pwdMismatch}
									<span class="text-red-400">{tFn('auth.register.password_mismatch_error')}</span>
								{/if}
							</div>
						</div>

						<button
							type="submit"
							disabled={!canSubmit}
							class="nx-login-btn w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-900/20 hover:shadow-purple-700/30 active:scale-[0.97]
							       disabled:opacity-50 disabled:cursor-not-allowed"
							style="transition: transform 160ms ease-out, box-shadow 160ms ease-out"
						>
							{submitting ? tFn('auth.register.submitting') : tFn('auth.register.button')}
						</button>
					</form>

					<p class="mt-5 text-center text-sm text-gray-400">
						{tFn('auth.register.already_has_account')}
						<a href="/auth/login" class="font-medium text-indigo-400 hover:text-indigo-300 transition-colors">{tFn('auth.login_link')}</a>
					</p>


			</div>
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

	.nx-login-btn {
		background: var(--nx-accent-2, #a855f7);
	}
	.nx-login-btn:hover:not(:disabled) {
		background: var(--nx-accent-2-strong, #7c3aed);
	}
</style>
