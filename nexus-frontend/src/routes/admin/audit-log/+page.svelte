<script lang="ts">
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	// Action labels + colors
	const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
		ban_user:             { label: 'Ban',           color: 'text-red-400    bg-red-900/40    border-red-800/50',    icon: '🔨' },
		unban_user:           { label: 'Unban',         color: 'text-green-400  bg-green-900/40  border-green-800/50',  icon: '✅' },
		kick_member:          { label: 'Kick',          color: 'text-orange-400 bg-orange-900/40 border-orange-800/50', icon: '👢' },
		change_role:          { label: 'Rôle changé',   color: 'text-indigo-400 bg-indigo-900/40 border-indigo-800/50', icon: '🏅' },
		delete_thread:        { label: 'Fil supprimé',  color: 'text-red-400    bg-red-900/40    border-red-800/50',    icon: '🗑️' },
		pin_thread:           { label: 'Épinglé',       color: 'text-yellow-400 bg-yellow-900/40 border-yellow-800/50', icon: '📌' },
		unpin_thread:         { label: 'Désépinglé',    color: 'text-gray-400   bg-gray-800      border-gray-700',      icon: '📌' },
		lock_thread:          { label: 'Verrouillé',    color: 'text-red-400    bg-red-900/40    border-red-800/50',    icon: '🔒' },
		unlock_thread:        { label: 'Déverrouillé',  color: 'text-green-400  bg-green-900/40  border-green-800/50',  icon: '🔓' },
		create_announcement:  { label: 'Annonce créée', color: 'text-sky-400    bg-sky-900/40    border-sky-800/50',    icon: '📢' },
		delete_announcement:  { label: 'Annonce supprimée', color: 'text-gray-400 bg-gray-800  border-gray-700',        icon: '📢' },
	}

	const ACTIONS = Object.keys(ACTION_META)

	function meta(action: string) {
		return ACTION_META[action] ?? { label: action, color: 'text-gray-400 bg-gray-800 border-gray-700', icon: '⚙️' }
	}

	function timeAgo(d: string) {
		const diff = Date.now() - new Date(d).getTime()
		const m = Math.floor(diff / 60000)
		const h = Math.floor(m / 60)
		const day = Math.floor(h / 24)
		if (m < 1)   return 'à l\'instant'
		if (m < 60)  return `${m}min`
		if (h < 24)  return `${h}h`
		if (day < 7) return `${day}j`
		return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
	}

	function formatDate(d: string) {
		return new Date(d).toLocaleString('fr-FR', {
			day: '2-digit', month: '2-digit', year: 'numeric',
			hour: '2-digit', minute: '2-digit',
		})
	}

	function metaDesc(entry: any): string {
		const m = entry.metadata ?? {}
		if (entry.action === 'ban_user') {
			const parts = []
			if (m.reason) parts.push(`raison : ${m.reason}`)
			if (m.ban_ip) parts.push('IP bannie')
			if (m.ban_email) parts.push('email banni')
			return parts.join(' · ') || ''
		}
		if (entry.action === 'change_role') {
			return `${m.old_role} → ${m.new_role}`
		}
		return ''
	}
</script>

<svelte:head><title>Journal de modération — Admin Nexus</title></svelte:head>

<div class="space-y-5">
	<div class="flex items-start justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-2xl font-bold text-white">Journal de modération</h1>
			<p class="text-sm text-gray-500 mt-0.5">{data.total} action{data.total > 1 ? 's' : ''} enregistrée{data.total > 1 ? 's' : ''}</p>
		</div>

		<!-- Filters -->
		<form method="GET" class="flex flex-wrap gap-2">
			<select name="action" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.submit()}
				class="rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-700">
				<option value="">Toutes les actions</option>
				{#each ACTIONS as a}
					<option value={a} selected={a === data.filterAction}>{ACTION_META[a]?.label ?? a}</option>
				{/each}
			</select>
			<input
				type="text"
				name="actor"
				placeholder="Filtrer par admin..."
				value={data.filterActor}
				class="rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-200
				       placeholder-gray-600 focus:outline-none focus:border-indigo-700 w-44"
			/>
			<button type="submit"
				class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
				Filtrer
			</button>
			{#if data.filterAction || data.filterActor}
				<a href="/admin/audit-log"
					class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-500 transition-colors">
					Réinitialiser
				</a>
			{/if}
		</form>
	</div>

	<!-- Table -->
	<div class="rounded-xl border border-gray-800 overflow-hidden">
		{#if data.entries.length === 0}
			<div class="px-6 py-12 text-center text-sm text-gray-600">
				Aucune action enregistrée pour le moment.
			</div>
		{:else}
			<table class="w-full text-sm">
				<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left w-40">Date</th>
						<th class="px-4 py-3 text-left w-32">Admin</th>
						<th class="px-4 py-3 text-left w-36">Action</th>
						<th class="px-4 py-3 text-left">Cible</th>
						<th class="px-4 py-3 text-left">Détail</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800/60">
					{#each data.entries as entry}
						{@const m = meta(entry.action)}
						<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
							<!-- Date -->
							<td class="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap" title={formatDate(entry.created_at)}>
								{timeAgo(entry.created_at)}
							</td>

							<!-- Actor -->
							<td class="px-4 py-3">
								<a href="/users/{entry.actor_username}"
									class="text-sm font-medium text-gray-200 hover:text-indigo-300 transition-colors">
									{entry.actor_username}
								</a>
							</td>

							<!-- Action badge -->
							<td class="px-4 py-3">
								<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border {m.color}">
									<span class="text-[11px]">{m.icon}</span>
									{m.label}
								</span>
							</td>

							<!-- Target -->
							<td class="px-4 py-3 max-w-[200px]">
								{#if entry.target_label}
									<div class="flex items-center gap-1.5">
										<span class="text-xs text-gray-500 capitalize">{entry.target_type}</span>
										<span class="text-gray-600">·</span>
										{#if entry.target_type === 'user' && entry.target_label}
											<a href="/users/{entry.target_label}"
												class="text-sm text-gray-300 hover:text-white transition-colors truncate">
												{entry.target_label}
											</a>
										{:else}
											<span class="text-sm text-gray-300 line-clamp-1">{entry.target_label}</span>
										{/if}
									</div>
								{:else}
									<span class="text-gray-700 text-xs">—</span>
								{/if}
							</td>

							<!-- Detail -->
							<td class="px-4 py-3 text-xs text-gray-500">
								{metaDesc(entry)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<!-- Pagination -->
	{#if data.total > data.limit}
		<div class="flex items-center justify-between">
			<span class="text-sm text-gray-500">
				{data.offset + 1}–{Math.min(data.offset + data.limit, data.total)} sur {data.total}
			</span>
			<div class="flex gap-2">
				{#if data.offset > 0}
					<a href="?offset={data.offset - data.limit}{data.filterAction ? `&action=${data.filterAction}` : ''}{data.filterActor ? `&actor=${data.filterActor}` : ''}"
						class="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
						← Précédent
					</a>
				{/if}
				{#if data.offset + data.limit < data.total}
					<a href="?offset={data.offset + data.limit}{data.filterAction ? `&action=${data.filterAction}` : ''}{data.filterActor ? `&actor=${data.filterActor}` : ''}"
						class="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
						Suivant →
					</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
