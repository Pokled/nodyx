<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { decryptPrivateKey, signChallenge } from '$lib/crypto'
	import { getAllDevices, isSetupDone } from '$lib/storage'
	import type { DeviceRecord } from '$lib/storage'

	// Params passés via QR : ?instance=https://...&challengeId=xxx&challenge=xxx&nonce=xxx
	let instanceUrl  = $state('')
	let instanceName = $state('')
	let challengeId  = $state('')
	let challenge    = $state('')
	let pollNonce    = $state('')

	let devices      = $state<DeviceRecord[]>([])
	let selectedDevice = $state<DeviceRecord | null>(null)
	let passphrase   = $state('')
	let error        = $state('')
	let loading      = $state(false)
	let result: 'approved' | 'error' | null = $state(null)
	let isNewUser    = $state(false)
	let createdUsername = $state('')

	// Si l'utilisateur n'a pas de clé configurée → proposer le setup
	let noDevice     = $state(false)

	onMount(async () => {
		const params = new URLSearchParams(window.location.search)
		instanceUrl = params.get('instance') ?? ''
		challengeId = params.get('challengeId') ?? ''
		challenge   = params.get('challenge') ?? ''
		pollNonce   = params.get('nonce') ?? ''

		if (!instanceUrl || !challengeId || !challenge) {
			error = 'Lien invalide — paramètres manquants.'
			return
		}

		// Charger les appareils enregistrés
		devices = await getAllDevices()

		if (devices.length === 0) {
			noDevice = true
			return
		}

		// Sélectionner le premier appareil par défaut
		selectedDevice = devices[0]

		// Récupérer le nom de l'instance
		try {
			const res = await fetch(`${instanceUrl}/api/auth/info`, { signal: AbortSignal.timeout(5000) })
			if (res.ok) {
				const info = await res.json()
				instanceName = info.name ?? instanceUrl
			}
		} catch {
			instanceName = instanceUrl.replace(/^https?:\/\//, '')
		}
	})

	async function approve() {
		if (!selectedDevice || !passphrase) return
		error = ''
		loading = true

		try {
			// Déchiffrer la clé privée
			const privateKey = await decryptPrivateKey(selectedDevice.encryptedPrivateKey, passphrase)

			// Signer le challenge
			const signed = await signChallenge(privateKey, challenge)

			// Envoyer à l'instance via approve-cross
			const res = await fetch(`${instanceUrl}/api/auth/challenges/approve-cross`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					signature:   signed.signature,
					challenge:   signed.challenge,
					pubkey:      selectedDevice.publicKey,
					deviceId:    selectedDevice.id,
					deviceLabel: selectedDevice.label
				})
			})

			const json = await res.json()

			if (!res.ok) {
				throw new Error(json.error ?? `Erreur ${res.status}`)
			}

			isNewUser       = json.isNewUser ?? false
			createdUsername = json.username  ?? ''
			result = 'approved'

		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Erreur lors de la connexion'
		} finally {
			loading = false
		}
	}
</script>

<div class="flex flex-col items-center justify-center min-h-screen px-6 py-12">

	{#if error && !instanceUrl}
		<!-- ── Lien invalide ──────────────────────────────────────────────────── -->
		<div class="flex flex-col items-center gap-4 text-center">
			<p class="text-lg font-semibold">Lien invalide</p>
			<p class="text-sm" style="color: var(--color-text-muted)">{error}</p>
			<button onclick={() => goto('/')} class="text-sm" style="color: var(--color-accent)">
				← Retour
			</button>
		</div>

	{:else if noDevice}
		<!-- ── Pas de clé configurée ─────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col items-center gap-6 text-center">
			<div class="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-bold"
				style="background: var(--color-accent-glow); color: var(--color-accent); border: 1px solid var(--color-accent)">
				◈
			</div>
			<div class="flex flex-col gap-2">
				<h2 class="text-xl font-bold">Première connexion</h2>
				<p class="text-sm leading-relaxed" style="color: var(--color-text-muted)">
					Pour vous connecter à <span style="color: var(--color-accent)">{instanceUrl.replace(/^https?:\/\//, '')}</span>,
					vous devez d'abord créer votre identité Nodyx Signet.
				</p>
			</div>
			<div class="w-full rounded-xl p-4 text-sm text-left flex flex-col gap-2"
				style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<p style="color: var(--color-text-muted)">
					Nodyx Signet génère une clé cryptographique sur votre appareil.<br/>
					Elle vous permettra de vous connecter à toutes les instances Nodyx sans mot de passe.
				</p>
			</div>
			<button
				onclick={() => goto(`/setup?hub=${encodeURIComponent(instanceUrl)}&connect=1&challengeId=${challengeId}&challenge=${encodeURIComponent(challenge)}&nonce=${pollNonce}`)}
				class="w-full py-3 rounded-xl font-semibold text-white"
				style="background: var(--color-accent)">
				Créer mon identité Nodyx →
			</button>
		</div>

	{:else if result === 'approved'}
		<!-- ── Succès ─────────────────────────────────────────────────────────── -->
		<div class="flex flex-col items-center gap-6 text-center">
			<div class="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
				style="background: rgba(74, 222, 128, 0.1); border: 2px solid var(--color-success)">
				✓
			</div>
			<div class="flex flex-col gap-1">
				<p class="text-xl font-bold">
					{isNewUser ? 'Compte créé et connecté' : 'Connexion approuvée'}
				</p>
				{#if isNewUser}
					<p class="text-sm" style="color: var(--color-text-muted)">
						Votre compte <span style="color: var(--color-accent)">@{createdUsername}</span>
						a été créé sur <span style="color: var(--color-text)">{instanceName || instanceUrl.replace(/^https?:\/\//, '')}</span>.
					</p>
					<p class="text-xs mt-1" style="color: var(--color-text-muted)">
						Vous pouvez changer votre pseudo dans vos paramètres.
					</p>
				{:else}
					<p class="text-sm" style="color: var(--color-text-muted)">
						Retournez sur <span style="color: var(--color-accent)">{instanceName || instanceUrl.replace(/^https?:\/\//, '')}</span> — vous êtes connecté.
					</p>
				{/if}
			</div>
			<button onclick={() => goto('/')} class="text-sm" style="color: var(--color-text-muted)">
				Retour à l'accueil Signet
			</button>
		</div>

	{:else if selectedDevice}
		<!-- ── Écran d'approbation ────────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col gap-6">

			<div class="flex flex-col items-center gap-2">
				<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
					style="background: var(--color-accent-glow); color: var(--color-accent); border: 1px solid var(--color-accent)">
					◈
				</div>
				<p class="font-bold text-lg">Connexion à</p>
				<p class="text-sm font-medium" style="color: var(--color-accent)">
					{instanceName || instanceUrl.replace(/^https?:\/\//, '')}
				</p>
			</div>

			<!-- Infos -->
			<div class="rounded-2xl p-4 flex flex-col gap-3 text-sm"
				style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<div class="flex justify-between">
					<span style="color: var(--color-text-muted)">Instance</span>
					<span style="color: var(--color-text)">{instanceUrl.replace(/^https?:\/\//, '')}</span>
				</div>
				<div class="flex justify-between">
					<span style="color: var(--color-text-muted)">Appareil</span>
					<span style="color: var(--color-text)">{selectedDevice.label}</span>
				</div>
			</div>

			<!-- Sélection appareil si plusieurs -->
			{#if devices.length > 1}
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
						Appareil
					</label>
					<select
						bind:value={selectedDevice}
						class="w-full px-4 py-3 rounded-xl text-sm outline-none"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)">
						{#each devices as d}
							<option value={d}>{d.label}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Passphrase -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted)">
					Passphrase
				</label>
				<input
					type="password"
					bind:value={passphrase}
					placeholder="Votre passphrase de déverrouillage"
					autofocus
					class="w-full px-4 py-3 rounded-xl text-sm outline-none"
					style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
					onkeydown={(e) => e.key === 'Enter' && approve()}
				/>
			</div>

			{#if error}
				<p class="text-sm rounded-xl px-4 py-3"
					style="background: rgba(248,113,113,0.1); color: var(--color-danger); border: 1px solid rgba(248,113,113,0.3)">
					{error}
				</p>
			{/if}

			<button
				onclick={approve}
				disabled={loading || !passphrase}
				class="w-full py-3 rounded-xl font-semibold text-white transition-opacity disabled:opacity-50"
				style="background: var(--color-accent)">
				{loading ? 'Connexion…' : 'Se connecter →'}
			</button>

			<button onclick={() => goto('/')} class="text-sm text-center" style="color: var(--color-text-muted)">
				← Annuler
			</button>
		</div>
	{/if}

</div>
