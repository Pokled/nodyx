<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);

	// ── Nexus Signet ──────────────────────────────────────────────────────────
	type SignetState = 'idle' | 'waiting' | 'approved' | 'rejected' | 'expired' | 'error'

	let signetState   = $state<SignetState>('idle')
	let signetUsername = $state('')
	let signetError   = $state('')
	let signetToken   = $state('')
	let signetChallengeId = $state('')
	let signetPollInterval: ReturnType<typeof setInterval> | null = null
	let signetFormRef = $state<HTMLFormElement | null>(null)

	$effect(() => {
		if (signetState === 'approved' && signetFormRef) {
			signetFormRef.submit()
		}
	})

	function signetReset() {
		if (signetPollInterval) clearInterval(signetPollInterval)
		signetPollInterval = null
		signetState = 'idle'
		signetError = ''
		signetToken = ''
		signetChallengeId = ''
	}

	async function signetStart() {
		if (!signetUsername.trim()) { signetError = 'Entrez votre identifiant.'; return }
		signetError = ''
		signetState = 'waiting'

		try {
			const res = await fetch('/api/auth/challenges/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: signetUsername.trim(),
					hubUrl: window.location.origin
				})
			})
			if (!res.ok) {
				const j = await res.json()
				const msg = j.code === 'NO_DEVICE'
					? 'Aucun appareil Nexus Signet enregistré pour cet utilisateur.'
					: (j.error ?? 'Erreur lors de la création du challenge.')
				signetError = msg
				signetState = 'error'
				return
			}
			const { challengeId } = await res.json()
			signetChallengeId = challengeId

			// Poll toutes les 2 secondes
			signetPollInterval = setInterval(async () => {
				try {
					const poll = await fetch(`/api/auth/challenges/status/${challengeId}`)
					if (!poll.ok) return
					const j = await poll.json()
					if (j.status === 'approved' && j.token) {
						clearInterval(signetPollInterval!)
						signetToken = j.token
						signetState = 'approved'
					} else if (j.status === 'rejected') {
						clearInterval(signetPollInterval!)
						signetState = 'rejected'
					} else if (j.status === 'expired') {
						clearInterval(signetPollInterval!)
						signetState = 'expired'
					}
				} catch {}
			}, 2000)

		} catch {
			signetError = 'Impossible de contacter le serveur.'
			signetState = 'error'
		}
	}
</script>

<svelte:head>
	<title>Connexion — Nexus</title>
</svelte:head>

<div class="mx-auto max-w-sm">
	<h1 class="text-2xl font-bold text-white mb-6">Connexion</h1>

	{#if data.passwordReset}
		<div class="mb-4 rounded border border-green-700/50 bg-green-900/20 px-4 py-2.5 text-sm text-green-300">
			✓ Mot de passe réinitialisé. Connectez-vous avec votre nouveau mot de passe.
		</div>
	{/if}

	{#if form?.error}
		<p class="mb-4 rounded bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
			{form.error}
		</p>
	{/if}

	<form
		method="POST"
		action="?/login"
		use:enhance={() => {
			submitting = true;
			return async ({ result }) => {
				if (result.type === 'redirect') {
					// Force full page navigation so the cookie is sent in the next request
					window.location.href = result.location;
				} else {
					submitting = false;
					// Re-run the default update for error results
					const { applyAction } = await import('$app/forms');
					await applyAction(result);
				}
			};
		}}
		class="space-y-4"
	>
		<input type="hidden" name="redirectTo" value={form?.redirectTo ?? data.redirectTo} />

		<div>
			<label for="email" class="block text-sm text-gray-400 mb-1">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				required
				autocomplete="email"
				class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<div>
			<div class="flex items-center justify-between mb-1">
				<label for="password" class="text-sm text-gray-400">Mot de passe</label>
				<a href="/auth/forgot-password" class="text-xs text-indigo-400 hover:text-indigo-300">
					Mot de passe oublié ?
				</a>
			</div>
			<input
				id="password"
				name="password"
				type="password"
				required
				autocomplete="current-password"
				class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<button
			type="submit"
			disabled={submitting}
			class="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
		>
			{submitting ? 'Connexion...' : 'Se connecter'}
		</button>
	</form>

	<p class="mt-4 text-center text-sm text-gray-500">
		Pas de compte ?
		<a href="/auth/register" class="text-indigo-400 hover:text-indigo-300">S'inscrire</a>
	</p>

	<!-- ── Nexus Signet ───────────────────────────────────────────────────── -->
	<div class="mt-8">
		<div class="flex items-center gap-3 mb-4">
			<div class="flex-1 h-px bg-gray-800"></div>
			<span class="text-xs text-gray-600 uppercase tracking-widest">ou</span>
			<div class="flex-1 h-px bg-gray-800"></div>
		</div>

		<div class="rounded-xl border p-5 transition-colors"
			style="border-color: rgba(251,191,36,0.25); background: rgba(251,191,36,0.03)">

			<!-- En-tête -->
			<div class="flex items-center gap-3 mb-4">
				<div class="w-9 h-9 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
					style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); color: #fbbf24">
					◈
				</div>
				<div>
					<p class="text-sm font-semibold text-white">Nexus Signet</p>
					<p class="text-xs" style="color: rgb(156,163,175)">Connexion sans mot de passe · ECDSA P-256</p>
				</div>
				<a href="https://signet.nexusnode.app" target="_blank" rel="noopener"
					class="ml-auto text-xs px-2 py-1 rounded-lg shrink-0 transition-opacity hover:opacity-80"
					style="color: #fbbf24; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2)">
					Obtenir l'app →
				</a>
			</div>

			{#if signetState === 'idle' || signetState === 'error'}
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={signetUsername}
						placeholder="Votre identifiant"
						onkeydown={(e) => e.key === 'Enter' && signetStart()}
						class="flex-1 rounded-lg px-3 py-2 text-sm text-white focus:outline-none transition-colors"
						style="background: rgba(0,0,0,0.3); border: 1px solid rgba(251,191,36,0.2); focus-border-color: rgba(251,191,36,0.5)"
					/>
					<button
						onclick={signetStart}
						disabled={!signetUsername.trim()}
						class="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition-all shrink-0"
						style="background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.4); color: #fbbf24">
						Signer →
					</button>
				</div>
				{#if signetError}
					<p class="mt-2 text-xs" style="color: rgb(248,113,113)">{signetError}</p>
				{/if}

			{:else if signetState === 'waiting'}
				<div class="flex flex-col items-center gap-4 py-3">
					<!-- Icône pulsante -->
					<div class="relative">
						<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
							style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.4); color: #fbbf24">
							◈
						</div>
						<div class="absolute inset-0 rounded-2xl animate-ping opacity-20"
							style="background: rgba(251,191,36,0.3)"></div>
					</div>
					<div class="text-center">
						<p class="text-sm font-semibold text-white">En attente d'approbation</p>
						<p class="text-xs mt-1" style="color: rgb(156,163,175)">Ouvrez Nexus Signet sur votre téléphone et approuvez la demande</p>
					</div>
					<button onclick={signetReset} class="text-xs" style="color: rgb(107,114,128)">
						Annuler
					</button>
				</div>

			{:else if signetState === 'approved'}
				<!-- Soumission automatique via $effect -->
				<form bind:this={signetFormRef} method="POST" action="?/signet">
					<input type="hidden" name="token" value={signetToken} />
					<input type="hidden" name="redirectTo" value={form?.redirectTo ?? data.redirectTo} />
				</form>
				<div class="flex flex-col items-center gap-3 py-3">
					<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
						style="background: rgba(74,222,128,0.1); border: 2px solid rgb(74,222,128)">
						✓
					</div>
					<p class="text-sm font-semibold" style="color: rgb(74,222,128)">Approuvé — connexion en cours…</p>
				</div>

			{:else if signetState === 'rejected'}
				<div class="flex flex-col items-center gap-3 py-3">
					<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
						style="background: rgba(248,113,113,0.1); border: 2px solid rgb(248,113,113)">
						✕
					</div>
					<p class="text-sm font-semibold" style="color: rgb(248,113,113)">Demande refusée</p>
					<button onclick={signetReset} class="text-xs underline" style="color: rgb(156,163,175)">Réessayer</button>
				</div>

			{:else if signetState === 'expired'}
				<div class="flex flex-col items-center gap-3 py-3">
					<p class="text-sm" style="color: rgb(156,163,175)">Challenge expiré (90 secondes).</p>
					<button onclick={signetReset} class="text-xs underline" style="color: #fbbf24">Réessayer</button>
				</div>
			{/if}
		</div>
	</div>
</div>
