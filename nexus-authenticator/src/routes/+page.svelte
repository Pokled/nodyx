<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { getAllDevices, savePendingChallenge } from '$lib/storage'
	import { pollChallenges } from '$lib/hub'

	onMount(async () => {
		const devices = await getAllDevices()
		if (devices.length === 0) {
			goto('/setup')
			return
		}

		// Cherche un challenge en attente sur tous les hubs enregistrés
		for (const device of devices) {
			if (!device.deviceToken) continue
			try {
				const challenges = await pollChallenges(device.hubUrl, device.deviceToken)
				if (challenges.length > 0) {
					// Sauvegarder dans IndexedDB avant de rediriger
					await savePendingChallenge(challenges[0])
					goto(`/approve?challengeId=${challenges[0].id}&deviceId=${device.id}`)
					return
				}
			} catch {
				// Hub inaccessible — on continue
			}
		}

		goto('/keys')
	})
</script>

<div class="flex items-center justify-center min-h-screen">
	<div class="flex flex-col items-center gap-4">
		<div class="w-8 h-8 border-2 rounded-full border-t-transparent animate-spin" style="border-color: var(--color-accent); border-top-color: transparent"></div>
		<p style="color: var(--color-text-muted)" class="text-sm">Chargement…</p>
	</div>
</div>
