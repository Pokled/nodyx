<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { page } from '$app/stores'
	import { decryptPrivateKey, signChallenge } from '$lib/crypto'
	import { getDevice, getPendingChallenge, deletePendingChallenge } from '$lib/storage'
	import { approveChallenge, rejectChallenge } from '$lib/hub'
	import type { DeviceRecord } from '$lib/storage'
	import type { PendingChallenge } from '$lib/storage'

	let device: DeviceRecord | null = $state(null)
	let challenge: PendingChallenge | null = $state(null)
	let passphrase = $state('')
	let error = $state('')
	let loading = $state(false)
	let result: 'approved' | 'rejected' | null = $state(null)

	onMount(async () => {
		const challengeId = $page.url.searchParams.get('challengeId')
		const deviceId = $page.url.searchParams.get('deviceId')

		if (!challengeId || !deviceId) {
			goto('/keys')
			return
		}

		device = await getDevice(deviceId)
		challenge = await getPendingChallenge(challengeId)

		if (!device || !challenge) {
			goto('/keys')
			return
		}

		// Vérifie que le challenge n'est pas expiré
		if (Date.now() > challenge.issuedAt + challenge.ttl * 1000) {
			await deletePendingChallenge(challengeId)
			error = 'Ce challenge a expiré.'
			challenge = null
		}
	})

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
	}

	function timeLeft(issuedAt: number, ttl: number): string {
		const remaining = Math.max(0, Math.floor((issuedAt + ttl * 1000 - Date.now()) / 1000))
		return `${remaining}s`
	}

	async function approve() {
		if (!passphrase) {
			error = 'Entrez votre passphrase.'
			return
		}
		if (!device || !challenge) return

		error = ''
		loading = true

		try {
			const privateKey = await decryptPrivateKey(device.encryptedPrivateKey, passphrase)
			const signed = await signChallenge(privateKey, challenge.challenge)
			await approveChallenge(device.hubUrl, device.deviceToken!, signed)
			await deletePendingChallenge(challenge.id)
			result = 'approved'
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Erreur lors de l\'approbation'
		} finally {
			loading = false
		}
	}

	async function reject() {
		if (!device || !challenge) return
		loading = true
		try {
			await rejectChallenge(device.hubUrl, device.deviceToken!, challenge.id)
			await deletePendingChallenge(challenge.id)
			result = 'rejected'
		} catch {
			// On supprime localement même si le hub ne répond pas
			await deletePendingChallenge(challenge.id)
			result = 'rejected'
		} finally {
			loading = false
		}
	}
</script>

<div class="flex flex-col items-center justify-center min-h-screen px-6 py-12">

	{#if result === 'approved'}
		<!-- ── Approuvé ────────────────────────────────────────────────────────── -->
		<div class="flex flex-col items-center gap-6">
			<div class="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
				style="background: rgba(74, 222, 128, 0.1); border: 2px solid var(--color-success)">
				✓
			</div>
			<div class="flex flex-col items-center gap-1">
				<p class="text-xl font-bold">Connexion approuvée</p>
				<p class="text-sm" style="color: var(--color-text-muted)">Vous pouvez retourner à Hub.</p>
			</div>
			<button onclick={() => goto('/keys')} class="text-sm" style="color: var(--color-accent)">
				Retour à l'accueil
			</button>
		</div>

	{:else if result === 'rejected'}
		<!-- ── Refusé ──────────────────────────────────────────────────────────── -->
		<div class="flex flex-col items-center gap-6">
			<div class="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
				style="background: rgba(248, 113, 113, 0.1); border: 2px solid var(--color-danger)">
				✕
			</div>
			<div class="flex flex-col items-center gap-1">
				<p class="text-xl font-bold">Connexion refusée</p>
				<p class="text-sm" style="color: var(--color-text-muted)">Demande annulée.</p>
			</div>
			<button onclick={() => goto('/keys')} class="text-sm" style="color: var(--color-text-muted)">
				Retour à l'accueil
			</button>
		</div>

	{:else if !challenge}
		<!-- ── Erreur / Expiré ─────────────────────────────────────────────────── -->
		<div class="flex flex-col items-center gap-4">
			<p class="text-lg font-semibold">Aucune demande en attente</p>
			{#if error}
				<p class="text-sm" style="color: var(--color-danger)">{error}</p>
			{/if}
			<button onclick={() => goto('/keys')} class="text-sm" style="color: var(--color-accent)">
				Retour à l'accueil
			</button>
		</div>

	{:else}
		<!-- ── Écran d'approbation ─────────────────────────────────────────────── -->
		<div class="w-full max-w-sm flex flex-col gap-6">

			<!-- En-tête avec logo -->
			<div class="flex flex-col items-center gap-2">
				<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
					style="background: var(--color-accent-glow); color: var(--color-accent); border: 1px solid var(--color-accent)">
					◈
				</div>
				<p class="font-bold text-lg">Demande de connexion</p>
			</div>

			<!-- Carte d'infos -->
			<div class="rounded-2xl p-5 flex flex-col gap-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
				<div class="flex flex-col gap-3 text-sm">
					<div class="flex justify-between">
						<span style="color: var(--color-text-muted)">Hub</span>
						<span class="font-medium text-right" style="color: var(--color-accent)">
							{challenge.hubUrl.replace(/^https?:\/\//, '')}
						</span>
					</div>
					{#if challenge.sourceIp}
						<div class="flex justify-between">
							<span style="color: var(--color-text-muted)">Depuis</span>
							<span class="font-mono text-xs" style="color: var(--color-text)">{challenge.sourceIp}</span>
						</div>
					{/if}
					<div class="flex justify-between">
						<span style="color: var(--color-text-muted)">À</span>
						<span style="color: var(--color-text)">{formatTime(challenge.issuedAt)}</span>
					</div>
					<div class="flex justify-between">
						<span style="color: var(--color-text-muted)">Expire dans</span>
						<span style="color: var(--color-danger)" class="font-mono text-xs">
							{timeLeft(challenge.issuedAt, challenge.ttl)}
						</span>
					</div>
					<div class="flex justify-between">
						<span style="color: var(--color-text-muted)">Appareil</span>
						<span style="color: var(--color-text)">{device?.label}</span>
					</div>
				</div>
			</div>

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
				<p class="text-sm rounded-xl px-4 py-3" style="background: rgba(248,113,113,0.1); color: var(--color-danger); border: 1px solid rgba(248,113,113,0.3)">{error}</p>
			{/if}

			<!-- Actions -->
			<div class="flex gap-3">
				<button
					onclick={reject}
					disabled={loading}
					class="flex-1 py-3 rounded-xl font-semibold transition-opacity disabled:opacity-50"
					style="background: var(--color-surface-2); color: var(--color-danger); border: 1px solid rgba(248,113,113,0.3)">
					Refuser
				</button>
				<button
					onclick={approve}
					disabled={loading || !passphrase}
					class="flex-2 py-3 px-6 rounded-xl font-semibold text-white transition-opacity disabled:opacity-50"
					style="background: var(--color-accent)">
					{loading ? 'Signature…' : 'Approuver'}
				</button>
			</div>

		</div>
	{/if}

</div>
