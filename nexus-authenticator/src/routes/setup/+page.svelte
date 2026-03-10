<script lang="ts">
	import { goto } from '$app/navigation'
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

	async function checkHub() {
		error = ''
		loading = true
		try {
			const url = hubUrl.trim().replace(/\/$/, '')
			if (!url.startsWith('https://')) throw new Error('L\'URL doit commencer par https://')
			const info = await pingHub(url)
			if (!info.authenticator) throw new Error('Ce Hub ne supporte pas Nexus Authenticator.')
			hubUrl = url
			hubName = info.name
			step = 'passphrase'
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Hub inaccessible'
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
				<h1 class="text-2xl font-bold tracking-tight">Nexus Authenticator</h1>
				<p class="text-center text-sm leading-relaxed" style="color: var(--color-text-muted)">
					Authentification cryptographique pour vos instances Nexus.<br/>
					Zéro dépendance. Votre clé ne quitte jamais cet appareil.
				</p>
			</div>

			<div class="w-full rounded-xl p-4 flex flex-col gap-3 text-sm" style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<div class="flex items-start gap-3">
					<span style="color: var(--color-accent)">①</span>
					<span>Connexion à votre Hub Nexus</span>
				</div>
				<div class="flex items-start gap-3">
					<span style="color: var(--color-accent)">②</span>
					<span>Création d'une paire de clés ECDSA P-256</span>
				</div>
				<div class="flex items-start gap-3">
					<span style="color: var(--color-accent)">③</span>
					<span>Clé privée chiffrée localement avec votre passphrase</span>
				</div>
			</div>

			<button
				onclick={() => step = 'hub'}
				class="w-full py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
				style="background: var(--color-accent)">
				Commencer la configuration
			</button>
		</div>

	{:else if step === 'hub'}
		<!-- ── URL du Hub ──────────────────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-xl font-bold">Votre Hub Nexus</h2>
				<p class="text-sm" style="color: var(--color-text-muted)">Entrez l'URL de votre instance Hub</p>
			</div>

			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						URL du Hub
					</label>
					<input
						type="url"
						bind:value={hubUrl}
						placeholder="https://hub.mondomaine.fr"
						class="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
						onkeydown={(e) => e.key === 'Enter' && checkHub()}
					/>
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
				<h2 class="text-xl font-bold">Passphrase</h2>
				<p class="text-sm" style="color: var(--color-text-muted)">
					Hub détecté : <span style="color: var(--color-accent)">{hubName || hubUrl}</span>
				</p>
			</div>

			<div class="rounded-xl p-4 text-sm" style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<p style="color: var(--color-text-muted)">
					Cette passphrase chiffre votre clé privée sur cet appareil.<br/>
					Elle <strong style="color: var(--color-text)">n'est jamais envoyée</strong> au Hub.<br/>
					Vous la saisirez à chaque approbation.
				</p>
			</div>

			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Token d'enregistrement
					</label>
					<input
						type="text"
						bind:value={enrollmentToken}
						placeholder="Généré depuis les paramètres du Hub"
						class="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
					/>
					<p class="text-xs" style="color: var(--color-text-muted)">
						Connectez-vous à votre Hub → Paramètres → Sécurité → Générer un token Authenticator
					</p>
				</div>
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Passphrase (min. 8 caractères)
					</label>
					<input
						type="password"
						bind:value={passphrase}
						placeholder="••••••••••••"
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
				<p style="color: var(--color-text-muted)">La prochaine fois que vous vous connecterez à Hub, une notification apparaîtra ici pour approbation.</p>
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
