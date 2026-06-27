<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()

	const w = $derived(data.welcome ?? {})
	let enabled       = $state(false)
	let channelId     = $state('')
	let publicMessage = $state('')
	let autoGradeId   = $state('')

	$effect(() => {
		enabled       = !!w.enabled
		channelId     = w.channel_id ?? ''
		publicMessage = w.public_message ?? ''
		autoGradeId   = w.auto_grade_id ?? ''
	})
</script>

<svelte:head><title>Bienvenue — OctoGuard</title></svelte:head>

<header class="og-h">
	<h2>Message de bienvenue</h2>
	<p>Configuré globalement. Posté par le bot fantôme <code>OctoGuard</code> à chaque nouvelle inscription.</p>
</header>

{#if form?.error}<div class="og-err">⚠ {form.error}</div>{/if}
{#if form?.ok}<div class="og-ok">✓ Sauvegardé</div>{/if}

<form method="POST" action="?/save" use:enhance class="og-form">
	<label class="og-label og-checkbox">
		<input type="checkbox" name="enabled" bind:checked={enabled} value="1" />
		<span>Activer le message de bienvenue</span>
	</label>

	<label class="og-label">
		<span>Channel cible (UUID)</span>
		<input name="channel_id" type="text" bind:value={channelId} placeholder="uuid-du-channel-général" />
	</label>

	<label class="og-label">
		<span>Message public (variables : <code>{`{user}`}</code> <code>{`{userMention}`}</code> <code>{`{communityName}`}</code>)</span>
		<textarea name="public_message" rows="4" bind:value={publicMessage}
			placeholder={'Bienvenue {userMention} sur {communityName} !'}></textarea>
	</label>

	<label class="og-label">
		<span>Auto-grade à l'inscription (UUID, optionnel)</span>
		<input name="auto_grade_id" type="text" bind:value={autoGradeId} placeholder="uuid-grade-newcomer" />
	</label>

	<div class="og-info">
		<strong>Note</strong> : le DM système de bienvenue n'est pas encore disponible (touche au flux DM E2E chiffré). À venir dans la spec 019.
	</div>

	<div class="og-actions">
		<button type="submit" class="og-btn-primary">Enregistrer</button>
	</div>
</form>

<style>
	.og-h h2 { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; }
	.og-h p { font-size: 12px; color: #94a3b8; margin: 4px 0 16px; }
	.og-h code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 2px; font-size: 11px; }
	.og-err, .og-ok { padding: 10px 14px; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
	.og-err { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }
	.og-ok { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #86efac; }
	.og-form { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid rgba(255,255,255,0.06); border-radius: 4px; background: rgba(255,255,255,0.01); }
	.og-label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #94a3b8; }
	.og-label code { font-size: 10px; }
	.og-label input, .og-label textarea {
		padding: 6px 8px; font-size: 12px; background: #1f2937;
		border: 1px solid #374151; border-radius: 3px; color: #e2e8f0;
		font-family: ui-monospace, monospace;
	}
	.og-label textarea { resize: vertical; }
	.og-checkbox { flex-direction: row; align-items: center; color: #cbd5e1; font-size: 12px; }
	.og-info {
		padding: 10px 12px;
		background: rgb(var(--nx-accent-rgb) / 0.05);
		border: 1px solid rgb(var(--nx-accent-rgb) / 0.2);
		border-radius: 3px;
		font-size: 11px;
		color: #c7d2fe;
	}
	.og-actions { display: flex; justify-content: flex-end; }
	.og-btn-primary {
		padding: 6px 12px; font-size: 12px; color: #fff;
		background: var(--nx-accent); border: none; border-radius: 3px; cursor: pointer;
	}
</style>
