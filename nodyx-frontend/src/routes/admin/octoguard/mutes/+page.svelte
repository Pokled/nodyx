<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()
</script>

<svelte:head><title>Mutes — OctoGuard</title></svelte:head>

<header class="og-h">
	<h2>Mutes actifs</h2>
	<p>Les utilisateurs mutés ne peuvent pas envoyer de message dans le chat (global ou par channel).</p>
</header>

{#if form?.error}<div class="og-err">⚠ {form.error}</div>{/if}

<details class="og-create">
	<summary>+ Appliquer un mute manuel</summary>
	<form method="POST" action="?/create" use:enhance class="og-form">
		<label>UUID utilisateur<input name="user_id" type="text" required /></label>
		<label>UUID channel (optionnel, vide = global)<input name="channel_id" type="text" /></label>
		<div class="og-row">
			<label>Durée<input name="duration_value" type="number" min="1" placeholder="1" /></label>
			<label>Unité
				<select name="duration_unit">
					<option value="m">minutes</option>
					<option value="h" selected>heures</option>
					<option value="d">jours</option>
					<option value="w">semaines</option>
				</select>
			</label>
		</div>
		<label>Raison<input name="reason" type="text" maxlength="500" placeholder="ex: spam" /></label>
		<div class="og-actions"><button type="submit" class="og-btn-primary">Appliquer mute</button></div>
	</form>
</details>

{#if data.mutes.length === 0}
	<div class="og-empty">Aucun mute actif.</div>
{:else}
	<table class="og-table">
		<thead>
			<tr><th>Utilisateur</th><th>Channel</th><th>Raison</th><th>Expire</th><th></th></tr>
		</thead>
		<tbody>
			{#each data.mutes as m (m.id)}
				<tr>
					<td>{m.user_username ?? m.user_id?.slice(0,8)}</td>
					<td>{m.channel_id ? m.channel_id.slice(0,8) : '— global —'}</td>
					<td>{m.reason ?? '—'}</td>
					<td>{m.expires_at ? new Date(m.expires_at).toLocaleString() : '— permanent —'}</td>
					<td>
						<form method="POST" action="?/unmute" use:enhance>
							<input type="hidden" name="id" value={m.id} />
							<button type="submit" class="og-btn-link">Unmute</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.og-h h2 { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; }
	.og-h p { font-size: 12px; color: #94a3b8; margin: 4px 0 16px; }
	.og-err { padding: 10px 14px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
	.og-create { margin-bottom: 16px; }
	.og-create summary { cursor: pointer; padding: 8px 12px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 3px; color: #94a3b8; font-size: 12px; }
	.og-form { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid rgba(255,255,255,0.06); border-radius: 4px; background: rgba(255,255,255,0.01); margin-top: 8px; }
	.og-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #94a3b8; }
	input, select { padding: 6px 8px; font-size: 12px; background: #1f2937; border: 1px solid #374151; border-radius: 3px; color: #e2e8f0; font-family: ui-monospace, monospace; }
	.og-actions { display: flex; justify-content: flex-end; }
	.og-btn-primary { padding: 6px 12px; font-size: 12px; color: #fff; background: var(--nx-accent); border: none; border-radius: 3px; cursor: pointer; }
	.og-btn-link { background: transparent; border: none; color: #94a3b8; font-size: 11px; cursor: pointer; padding: 0; }
	.og-btn-link:hover { color: #e2e8f0; }
	.og-table { width: 100%; border-collapse: collapse; font-size: 12px; }
	.og-table th, .og-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.04); }
	.og-table th { color: #64748b; font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; font-family: ui-monospace, monospace; }
	.og-table td { color: #cbd5e1; font-family: ui-monospace, monospace; font-size: 11px; }
	.og-empty { padding: 24px; text-align: center; color: #64748b; font-size: 13px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 4px; }
</style>
