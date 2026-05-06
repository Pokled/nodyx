<script lang="ts">
	// Polls /api/v1/instance/maintenance every 15s. When maintenance is active
	// (set by backup create / restore on the server side), shows a sticky amber
	// banner so users understand why their writes are temporarily refused.
	//
	// Self-managing: starts polling on mount, cleans up on destroy. Server-side
	// import path is bypassed because Svelte's onMount only fires in the browser.

	import { onMount, onDestroy } from 'svelte';

	interface MaintenanceStatus {
		active: boolean;
		reason?: 'backup_create' | 'backup_restore' | 'manual';
		since?:  string;
		label?:  string;
	}

	let status = $state<MaintenanceStatus>({ active: false });
	let timer:  ReturnType<typeof setInterval> | null = null;

	const REASON_LABEL: Record<string, string> = {
		backup_create:  'Sauvegarde en cours',
		backup_restore: 'Restauration en cours',
		manual:         'Maintenance en cours',
	};

	async function poll() {
		try {
			const res = await fetch('/api/v1/instance/maintenance');
			if (res.ok) status = await res.json();
		} catch {
			// Network blip — keep last known state, don't flap
		}
	}

	onMount(() => {
		poll();                                  // immediate first read
		timer = setInterval(poll, 15_000);        // then every 15s
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const reasonText = $derived(
		status.label
			|| (status.reason ? REASON_LABEL[status.reason] : 'Maintenance en cours'),
	);
</script>

{#if status.active}
	<div class="maint-banner" role="status" aria-live="polite">
		<span class="maint-banner-icon" aria-hidden="true">🛠️</span>
		<span class="maint-banner-text">
			<strong>{reasonText}</strong>
			<span class="maint-banner-detail">
				· les nouvelles inscriptions et publications sont temporairement désactivées. Réessaye dans quelques instants.
			</span>
		</span>
	</div>
{/if}

<style>
	.maint-banner {
		position: sticky;
		top: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		background: linear-gradient(90deg, rgba(251,146,60,.18), rgba(251,146,60,.08));
		border-bottom: 1px solid rgba(251,146,60,.4);
		color: #fed7aa;
		font-size: 13px;
		font-weight: 500;
		line-height: 1.4;
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.maint-banner-icon {
		flex-shrink: 0;
		font-size: 16px;
		filter: drop-shadow(0 0 4px rgba(251,146,60,.4));
	}

	.maint-banner-text {
		flex: 1;
		min-width: 0;
	}

	.maint-banner-text strong {
		color: #fdba74;
		font-weight: 700;
	}

	.maint-banner-detail {
		color: #fbbf24;
		opacity: .85;
	}

	@media (max-width: 640px) {
		.maint-banner-detail {
			display: none;
		}
	}
</style>
