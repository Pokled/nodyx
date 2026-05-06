<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface AuditEntry {
		id:         number;
		backup_id:  string | null;
		user_id:    string | null;
		username:   string | null;
		action:     string;
		ip_address: string | null;
		user_agent: string | null;
		metadata:   Record<string, unknown> | null;
		status:     'success' | 'failed';
		error:      string | null;
		created_at: string;
	}
	const entries = data.entries as AuditEntry[];

	function fmtDate(s: string): string {
		return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
	}
	function actionLabel(a: string): string {
		return ({
			create:          'Création',
			restore:         'Restauration',
			delete:          'Suppression',
			download:        'Téléchargement',
			verify:          'Vérification',
			settings_change: 'Paramètres',
		} as Record<string, string>)[a] || a;
	}
	function actionColor(a: string): string {
		return ({
			create:          '#a78bfa',
			restore:         '#fb923c',
			delete:          '#ef4444',
			download:        '#06b6d4',
			verify:          '#4ade80',
			settings_change: '#9ca3af',
		} as Record<string, string>)[a] || '#9ca3af';
	}
</script>

<svelte:head><title>Audit sauvegardes — Admin</title></svelte:head>

<div class="min-h-screen p-6" style="background:#05050a; color:#e2e8f0">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-black" style="font-family:'Space Grotesk',sans-serif">
				Journal d'audit — Sauvegardes
			</h1>
			<p class="text-sm mt-1" style="color:#6b7280">
				Toutes les actions sensibles sur les sauvegardes (création, restauration, téléchargement, suppression). Conservé indéfiniment.
			</p>
		</div>
		<a href="/admin/backups"
		   class="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-wider"
		   style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:#9ca3af">
			← Retour aux sauvegardes
		</a>
	</div>

	<div style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">
		<div class="px-4 py-3 flex items-center gap-2" style="border-bottom:1px solid rgba(255,255,255,.05)">
			<span class="text-base">🔎</span>
			<span class="font-bold text-sm">{data.total} entrée{data.total > 1 ? 's' : ''}</span>
		</div>

		{#if entries.length === 0}
			<div class="px-4 py-12 text-center text-sm" style="color:#374151">
				Aucune action enregistrée pour l'instant.
			</div>
		{:else}
			<div class="divide-y" style="border-color:rgba(255,255,255,.04)">
				{#each entries as e (e.id)}
					<div class="px-4 py-2.5 flex items-center gap-3 text-xs">
						<span class="font-mono shrink-0" style="color:#6b7280; min-width:130px">{fmtDate(e.created_at)}</span>

						<span class="font-bold uppercase shrink-0 px-1.5 py-0.5"
						      style="color:{actionColor(e.action)}; border:1px solid rgba(255,255,255,.05); background:rgba(255,255,255,.02); min-width:90px; text-align:center">
							{actionLabel(e.action)}
						</span>

						<span class="shrink-0" style="color:#9ca3af; min-width:90px">
							{e.username ?? (e.user_id ? e.user_id.slice(0, 8) : 'system')}
						</span>

						<span class="font-mono truncate" style="color:#6b7280; flex:1">
							{#if e.metadata}
								{JSON.stringify(e.metadata).slice(0, 120)}
							{/if}
						</span>

						<span class="font-mono shrink-0" style="color:#374151">
							{e.ip_address ?? '—'}
						</span>

						<span class="shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase"
						      style="color:{e.status === 'success' ? '#4ade80' : '#ef4444'}; border:1px solid rgba({e.status === 'success' ? '74,222,128' : '239,68,68'},.2); min-width:55px; text-align:center">
							{e.status === 'success' ? 'OK' : 'Échec'}
						</span>
					</div>
					{#if e.error}
						<div class="px-4 pb-2 text-[11px]" style="color:#fca5a5">
							→ {e.error}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>
