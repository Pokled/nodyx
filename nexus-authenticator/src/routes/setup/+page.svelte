<script lang="ts">
	import { goto } from '$app/navigation'
	import { onMount } from 'svelte'
	import { generateKeyPair, exportPublicKey, encryptPrivateKey } from '$lib/crypto'
	import { saveDevice, generateDeviceId } from '$lib/storage'
	import { registerDevice, pingHub } from '$lib/hub'

	type Step = 'welcome' | 'hub' | 'passphrase' | 'generating' | 'done'

	let step: Step = $state('welcome')
	let hubUrl = $state('')
	let hubName = $state('')
	let deviceLabel = $state('Mon téléphone')
	let enrollmentToken = $state('')
	let passphrase = $state('')
	let passphraseConfirm = $state('')
	let error = $state('')
	let loading = $state(false)

	// Pré-remplissage depuis le QR code (?hub=...&token=...)
	onMount(async () => {
		const params = new URLSearchParams(window.location.search)
		const hub   = params.get('hub')
		const token = params.get('token')
		if (hub && token) {
			hubUrl = hub
			enrollmentToken = token
			// Vérification automatique du hub puis passage direct à la passphrase
			loading = true
			step = 'hub'
			try {
				const info = await pingHub(hub)
				if (!info.authenticator) throw new Error('Cette communauté ne supporte pas encore Nexus Signet.')
				hubName = info.name
				step = 'passphrase'
			} catch (e: unknown) {
				error = e instanceof Error ? e.message : 'Communauté inaccessible — vérifiez l\'URL'
			} finally {
				loading = false
			}
		}
	})

	async function checkHub() {
		error = ''
		loading = true
		try {
			const url = hubUrl.trim().replace(/\/$/, '')
			if (!url.startsWith('https://')) throw new Error('L\'URL doit commencer par https://')
			const info = await pingHub(url)
			if (!info.authenticator) throw new Error('Cette communauté ne supporte pas encore Nexus Signet.')
			hubUrl = url
			hubName = info.name
			step = 'passphrase'
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Communauté inaccessible — vérifiez l\'URL'
		} finally {
			loading = false
		}
	}

	async function generateAndRegister() {
		if (!enrollmentToken.trim()) {
			error = 'Le token d\'enregistrement est requis.'
			return
		}
		if (passphrase.length < 8) {
			error = 'La passphrase doit faire au moins 8 caractères.'
			return
		}
		if (passphrase !== passphraseConfirm) {
			error = 'Les deux passphrases ne correspondent pas.'
			return
		}

		error = ''
		step = 'generating'

		try {
			// 1. Générer la paire de clés
			const keyPair = await generateKeyPair()
			const exportedPublicKey = await exportPublicKey(keyPair.publicKey)
			const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, passphrase)

			// 2. Enregistrer sur Hub
			const deviceId = generateDeviceId()
			const res = await registerDevice(hubUrl, {
				deviceId,
				deviceLabel,
				publicKey: exportedPublicKey,
				enrollmentToken: enrollmentToken.trim()
			})

			// 3. Sauvegarder localement
			await saveDevice({
				id: deviceId,
				label: deviceLabel,
				publicKey: exportedPublicKey,
				encryptedPrivateKey,
				createdAt: Date.now(),
				hubUrl,
				deviceToken: res.deviceToken
			})

			step = 'done'
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement'
			step = 'passphrase'
		}
	}
</script>

<div class="flex flex-col items-center justify-center min-h-screen px-6 py-12">

	{#if step === 'welcome'}
		<!-- ── Accueil ─────────────────────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col items-center gap-8">
			<div class="flex flex-col items-center gap-3">
				<div class="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-bold"
					style="background: var(--color-accent-glow); color: var(--color-accent); border: 1px solid var(--color-accent)">
					◈
				</div>
				<h1 class="text-2xl font-bold tracking-tight">Nexus Signet</h1>
				<p class="text-center text-sm leading-relaxed" style="color: var(--color-text-muted)">
					Connectez-vous à votre communauté Nexus<br/>
					sans mot de passe, depuis votre téléphone.
				</p>
			</div>

			<div class="w-full rounded-xl p-4 flex flex-col gap-3 text-sm" style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<div class="flex items-start gap-3">
					<span style="color: var(--color-accent)">①</span>
					<span>Entrez l'adresse de votre communauté Nexus</span>
				</div>
				<div class="flex items-start gap-3">
					<span style="color: var(--color-accent)">②</span>
					<span>Collez le token généré depuis vos paramètres</span>
				</div>
				<div class="flex items-start gap-3">
					<span style="color: var(--color-accent)">③</span>
					<span>Choisissez une passphrase — votre clé reste sur cet appareil</span>
				</div>
			</div>

			<button
				onclick={() => step = 'hub'}
				class="w-full py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
				style="background: var(--color-accent)">
				Commencer
			</button>
		</div>

	{:else if step === 'hub'}
		<!-- ── URL de la communauté ────────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-xl font-bold">Votre communauté Nexus</h2>
				<p class="text-sm" style="color: var(--color-text-muted)">
					C'est l'adresse du site Nexus où vous avez votre compte.
				</p>
			</div>

			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Adresse de votre communauté
					</label>
					<input
						type="url"
						bind:value={hubUrl}
						placeholder="https://ma-communaute.nexusnode.app"
						class="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
						onkeydown={(e) => e.key === 'Enter' && checkHub()}
					/>
					<p class="text-xs" style="color: var(--color-text-muted)">
						Exemple : <span style="color: var(--color-accent)">https://french-godot.nexusnode.app</span><br/>
						C'est l'URL que vous utilisez pour vous connecter d'habitude.
					</p>
				</div>

				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Nom de cet appareil
					</label>
					<input
						type="text"
						bind:value={deviceLabel}
						placeholder="Mon téléphone"
						class="w-full px-4 py-3 rounded-xl text-sm outline-none"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
					/>
				</div>
			</div>

			{#if error}
				<p class="text-sm rounded-xl px-4 py-3" style="background: rgba(248,113,113,0.1); color: var(--color-danger); border: 1px solid rgba(248,113,113,0.3)">{error}</p>
			{/if}

			<button
				onclick={checkHub}
				disabled={loading || !hubUrl.trim()}
				class="w-full py-3 rounded-xl font-semibold text-white transition-opacity disabled:opacity-50"
				style="background: var(--color-accent)">
				{loading ? 'Vérification…' : 'Continuer →'}
			</button>

			<button onclick={() => step = 'welcome'} class="text-sm text-center" style="color: var(--color-text-muted)">
				← Retour
			</button>
		</div>

	{:else if step === 'passphrase'}
		<!-- ── Passphrase ──────────────────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-xl font-bold">Choisissez une passphrase</h2>
				<p class="text-sm" style="color: var(--color-text-muted)">
					Communauté : <span style="color: var(--color-accent)">{hubName || hubUrl}</span>
				</p>
			</div>

			<div class="rounded-xl p-4 text-sm flex flex-col gap-2" style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<p style="color: var(--color-text)">
					<strong>Ce n'est pas votre mot de passe Nexus.</strong>
				</p>
				<p style="color: var(--color-text-muted)">
					C'est un code secret propre à cet appareil, qui protège votre clé de connexion stockée ici.<br/>
					Vous le saisirez chaque fois que vous approuverez une connexion depuis ce téléphone.
				</p>
				<p class="text-xs" style="color: var(--color-text-muted); opacity: 0.6">
					Il n'est jamais envoyé à votre communauté. Notez-le — il est impossible à récupérer.
				</p>
			</div>

			<div class="flex flex-col gap-3">
				{#if !enrollmentToken}
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Token d'enregistrement
					</label>
					<input
						type="text"
						bind:value={enrollmentToken}
						placeholder="Token généré dans vos paramètres Nexus"
						class="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
					/>
					<p class="text-xs" style="color: var(--color-text-muted)">
						Sur votre communauté Nexus → Paramètres → Nexus Signet → "+ Générer"
					</p>
				</div>
				{/if}
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Votre passphrase (min. 8 caractères)
					</label>
					<input
						type="password"
						bind:value={passphrase}
						placeholder="Choisissez un code secret pour cet appareil"
						class="w-full px-4 py-3 rounded-xl text-sm outline-none"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
					/>
				</div>
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Confirmer la passphrase
					</label>
					<input
						type="password"
						bind:value={passphraseConfirm}
						placeholder="••••••••••••"
						class="w-full px-4 py-3 rounded-xl text-sm outline-none"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
						onkeydown={(e) => e.key === 'Enter' && generateAndRegister()}
					/>
				</div>
			</div>

			{#if error}
				<p class="text-sm rounded-xl px-4 py-3" style="background: rgba(248,113,113,0.1); color: var(--color-danger); border: 1px solid rgba(248,113,113,0.3)">{error}</p>
			{/if}

			<button
				onclick={generateAndRegister}
				disabled={!passphrase || !passphraseConfirm}
				class="w-full py-3 rounded-xl font-semibold text-white transition-opacity disabled:opacity-50"
				style="background: var(--color-accent)">
				Générer mes clés et m'enregistrer
			</button>

			<button onclick={() => step = 'hub'} class="text-sm text-center" style="color: var(--color-text-muted)">
				← Retour
			</button>
		</div>

	{:else if step === 'generating'}
		<!-- ── Génération en cours ─────────────────────────────────────────────── -->
		<div class="flex flex-col items-center gap-6">
			<div class="w-12 h-12 border-2 rounded-full animate-spin"
				style="border-color: var(--color-accent); border-top-color: transparent"></div>
			<div class="flex flex-col items-center gap-1">
				<p class="font-semibold">Génération des clés…</p>
				<p class="text-sm" style="color: var(--color-text-muted)">ECDSA P-256 via Web Crypto API</p>
			</div>
		</div>

	{:else if step === 'done'}
		<!-- ── Succès ──────────────────────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col items-center gap-8">
			<div class="flex flex-col items-center gap-3">
				<div class="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
					style="background: rgba(74, 222, 128, 0.1); border: 2px solid var(--color-success)">
					✓
				</div>
				<h2 class="text-xl font-bold">Appareil enregistré</h2>
				<p class="text-center text-sm" style="color: var(--color-text-muted)">
					<span style="color: var(--color-text)">{deviceLabel}</span> est maintenant associé à<br/>
					<span style="color: var(--color-accent)">{hubName || hubUrl}</span>
				</p>
			</div>

			<div class="w-full rounded-xl p-4 text-sm flex flex-col gap-2" style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<p style="color: var(--color-text-muted)">La prochaine fois que vous vous connecterez à votre communauté, une notification apparaîtra ici pour approbation.</p>
			</div>

			<button
				onclick={() => goto('/keys')}
				class="w-full py-3 rounded-xl font-semibold text-white"
				style="background: var(--color-accent)">
				Voir mes appareils →
			</button>
		</div>
	{/if}

</div>
