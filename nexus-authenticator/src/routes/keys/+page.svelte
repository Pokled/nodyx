<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { getAllDevices, deleteDevice, savePendingChallenge } from '$lib/storage'
	import { revokeDevice, pollChallenges } from '$lib/hub'
	import type { DeviceRecord } from '$lib/storage'

	let devices: DeviceRecord[] = $state([])
	let loading = $state(true)
	let polling = $state(false)
	let pendingCount = $state(0)
	let confirmRevoke: string | null = $state(null)

	onMount(async () => {
		await refresh()
		await checkForChallenges()
	})

	async function refresh() {
		loading = true
		devices = await getAllDevices()
		loading = false
	}

	async function checkForChallenges() {
		polling = true
		let count = 0
		for (const device of devices) {
			if (!device.deviceToken) continue
			try {
				const challenges = await pollChallenges(device.hubUrl, device.deviceToken)
				count += challenges.length
				if (challenges.length > 0) {
					await savePendingChallenge(challenges[0])
					goto(`/approve?challengeId=${challenges[0].id}&deviceId=${device.id}`)
					return
				}
			} catch {
				// Hub inaccessible
			}
		}
		pendingCount = count
		polling = false
	}

	async function revoke(device: DeviceRecord) {
		try {
			if (device.deviceToken) {
				await revokeDevice(device.hubUrl, device.deviceToken, device.id)
			}
		} catch {
			// Révocation locale même si le hub ne répond pas
		}
		await deleteDevice(device.id)
		await refresh()
		confirmRevoke = null
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString('fr-FR', {
			day: 'numeric', month: 'long', year: 'numeric'
		})
	}
</script>

<div class="flex flex-col min-h-screen px-6 py-8 gap-6 max-w-sm mx-auto w-full">

	<!-- Header -->
	<div class="flex items-center justify-between">
		<div class="flex flex-col gap-0.5">
			<h1 class="text-xl font-bold">◈ Nexus Signet</h1>
			<p class="text-xs" style="color: var(--color-text-muted)">Appareils enregistrés</p>
		</div>
		<button
			onclick={checkForChallenges}
			disabled={polling}
			class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-opacity disabled:opacity-50"
			style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-accent)">
			{polling ? '↻' : '⟳'} Actualiser
		</button>
	</div>

	<!-- Notification challenge en attente -->
	{#if pendingCount > 0}
		<button
			onclick={checkForChallenges}
			class="w-full rounded-2xl p-4 flex items-center gap-3 text-left transition-opacity hover:opacity-90"
			style="background: var(--color-accent-glow); border: 1px solid var(--color-accent)">
			<span class="text-2xl">🔔</span>
			<div>
				<p class="font-semibold text-sm">Demande de connexion en attente</p>
				<p class="text-xs" style="color: var(--color-text-muted)">Appuyez pour approuver</p>
			</div>
		</button>
	{/if}

	<!-- Liste des appareils -->
	{#if loading}
		<div class="flex justify-center py-8">
			<div class="w-6 h-6 border-2 rounded-full animate-spin" style="border-color: var(--color-accent); border-top-color: transparent"></div>
		</div>
	{:else if devices.length === 0}
		<div class="flex flex-col items-center gap-4 py-12 text-center">
			<p class="text-4xl">🔑</p>
			<p class="font-semibold">Aucun appareil enregistré</p>
			<p class="text-sm" style="color: var(--color-text-muted)">Configurez votre premier appareil pour commencer.</p>
			<button
				onclick={() => goto('/setup')}
				class="px-6 py-2.5 rounded-xl font-semibold text-sm text-white"
				style="background: var(--color-accent)">
				Ajouter un appareil
			</button>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each devices as device (device.id)}
				<div class="rounded-2xl p-4 flex flex-col gap-3" style="background: var(--color-surface); border: 1px solid var(--color-border)">
					<div class="flex items-start justify-between gap-2">
						<div class="flex flex-col gap-1">
							<p class="font-semibold">{device.label}</p>
							<p class="text-xs font-mono" style="color: var(--color-accent)">
								{device.hubUrl.replace(/^https?:\/\//, '')}
							</p>
						</div>
						<div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style="background: var(--color-success)"></div>
					</div>
					<div class="flex items-center justify-between text-xs" style="color: var(--color-text-muted)">
						<span>Enregistré le {formatDate(device.createdAt)}</span>
						<button
							onclick={() => confirmRevoke = device.id}
							class="px-2 py-1 rounded-lg transition-opacity hover:opacity-70"
							style="color: var(--color-danger); background: rgba(248,113,113,0.1)">
							Révoquer
						</button>
					</div>
				</div>
			{/each}
		</div>

		<button
			onclick={() => goto('/setup')}
			class="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium"
			style="background: var(--color-surface); border: 1px dashed var(--color-border); color: var(--color-text-muted)">
			+ Ajouter un autre appareil
		</button>
	{/if}

</div>

<!-- Modal confirmation révocation -->
{#if confirmRevoke}
	{@const target = devices.find((d) => d.id === confirmRevoke)}
	<div class="fixed inset-0 flex items-end justify-center pb-8 px-6"
		style="background: rgba(0,0,0,0.7); backdrop-filter: blur(4px)">
		<div class="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
			style="background: var(--color-surface); border: 1px solid var(--color-border)">
			<div class="flex flex-col gap-1">
				<p class="font-bold text-lg">Révoquer cet appareil ?</p>
				<p class="text-sm" style="color: var(--color-text-muted)">
					<strong style="color: var(--color-text)">{target?.label}</strong> sera supprimé
					localement et révoqué sur <span style="color: var(--color-accent)">{target?.hubUrl.replace(/^https?:\/\//, '')}</span>.
				</p>
			</div>
			<p class="text-xs p-3 rounded-xl" style="color: var(--color-danger); background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2)">
				Cette action est irréversible. Vous ne pourrez plus utiliser cet appareil pour vous authentifier.
			</p>
			<div class="flex gap-3">
				<button
					onclick={() => confirmRevoke = null}
					class="flex-1 py-3 rounded-xl font-semibold text-sm"
					style="background: var(--color-surface-2); color: var(--color-text)">
					Annuler
				</button>
				<button
					onclick={() => target && revoke(target)}
					class="flex-1 py-3 rounded-xl font-semibold text-sm text-white"
					style="background: var(--color-danger)">
					Révoquer
				</button>
			</div>
		</div>
	</div>
{/if}
