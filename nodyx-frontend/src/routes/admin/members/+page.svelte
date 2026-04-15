<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData } from './$types'
	import { page } from '$app/stores'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { untrack } from 'svelte'

	let { data }: { data: PageData } = $props()

	// ── Reset link génération ────────────────────────────────────────────────
	let resetLinkResult = $state<{ username: string; reset_url: string; expires_at: string } | null>(null)
	let resetLinkError  = $state('')
	let generatingFor   = $state<string | null>(null)

	async function generateResetLink(userId: string) {
		generatingFor = userId
		resetLinkError = ''
		resetLinkResult = null
		try {
			const token = ($page.data as any).token as string | null
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/admin/members/${userId}/reset-link`, {
				method:  'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			})
			if (!res.ok) {
				const j = await res.json().catch(() => ({}))
				resetLinkError = j.error ?? 'Erreur lors de la génération du lien.'
			} else {
				resetLinkResult = await res.json()
			}
		} catch {
			resetLinkError = 'Erreur réseau.'
		} finally {
			generatingFor = null
		}
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text)
	}

	let search  = $state('')
	let members = $state(untrack(() => data.members.map((m: any) => ({ ...m }))))

	const filtered = $derived(
		members.filter((m: any) =>
			!search || m.username.toLowerCase().includes(search.toLowerCase())
		)
	)

	const bans: Array<{ user_id: string; username: string; email: string; reason: string | null; banned_at: string; banned_by_username: string | null }> = untrack(() => data.bans ?? [])
	const ipBans: Array<{ ip: string; reason: string | null; banned_at: string; banned_by_username: string | null }> = untrack(() => data.ipBans ?? [])
	const emailBans: Array<{ email: string; reason: string | null; banned_at: string; banned_by_username: string | null }> = untrack(() => data.emailBans ?? [])

	// ── Ban modal ─────────────────────────────────────────────────────────────
	let banTarget  = $state<{ userId: string; username: string } | null>(null)
	let banReason  = $state('')
	let banIp      = $state(false)
	let banEmail   = $state(false)

	const ROLE_COLORS: Record<string, string> = {
		owner:     'bg-yellow-900/50 text-yellow-400 border-yellow-800/50',
		admin:     'bg-red-900/50 text-red-400 border-red-800/50',
		moderator: 'bg-blue-900/50 text-blue-400 border-blue-800/50',
		member:    'bg-gray-800 text-gray-400 border-gray-700',
	}

	function luminance(hex: string): number {
		const r = parseInt(hex.slice(1,3), 16)
		const g = parseInt(hex.slice(3,5), 16)
		const b = parseInt(hex.slice(5,7), 16)
		return (0.299*r + 0.587*g + 0.114*b) / 255
	}
</script>

<svelte:head><title>Membres — Admin Nodyx</title></svelte:head>

<div>
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">Membres</h1>
			<p class="text-sm text-gray-500 mt-0.5">{data.members.length} membre{data.members.length > 1 ? 's' : ''} au total</p>
		</div>
		<input
			type="text"
			placeholder="Rechercher..."
			bind:value={search}
			class="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-200
			       placeholder-gray-600 focus:outline-none focus:border-indigo-700 w-48"
		/>
	</div>

	<div class="rounded-xl border border-gray-800 overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
				<tr>
					<th class="px-4 py-3 text-left">Membre</th>
					<th class="px-4 py-3 text-left">Rôle</th>
					<th class="px-4 py-3 text-left">Grade</th>
					<th class="px-4 py-3 text-center">Fils</th>
					<th class="px-4 py-3 text-center">Messages</th>
					<th class="px-4 py-3 text-left">Inscrit le</th>
					<th class="px-4 py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800/60">
				{#each filtered as member}
					<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
						<!-- Member -->
						<td class="px-4 py-3">
							<div class="flex items-center gap-2.5">
								<div class="w-8 h-8 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold text-indigo-200 shrink-0">
									{member.username.charAt(0).toUpperCase()}
								</div>
								<div>
									<a href="/users/{member.username}" class="font-medium text-white hover:text-indigo-300 transition-colors">
										{member.username}
									</a>
									<div class="text-xs text-gray-600">{member.email}</div>
								</div>
							</div>
						</td>

						<!-- Role (editable) -->
						<td class="px-4 py-3">
							{#if member.role === 'owner'}
								<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border {ROLE_COLORS.owner}">
									owner
								</span>
							{:else}
								<form method="POST" action="?/changeRole" use:enhance={() => {
									return async ({ update }) => { await update({ reset: false }) }
								}} class="inline">
									<input type="hidden" name="user_id" value={member.user_id} />
									<select
										name="role"
										onchange={(e) => {
											const newRole = (e.currentTarget as HTMLSelectElement).value
											const m = members.find((x: any) => x.user_id === member.user_id)
											if (m) m.role = newRole;
											(e.currentTarget as HTMLSelectElement).form?.submit()
										}}
										class="rounded border px-2 py-0.5 text-xs font-medium cursor-pointer bg-transparent
										       focus:outline-none {ROLE_COLORS[member.role]}"
									>
										{#each ['admin','moderator','member'] as r}
											<option value={r} selected={r === member.role} class="bg-gray-900 text-white">
												{r}
											</option>
										{/each}
									</select>
								</form>
							{/if}
						</td>

						<!-- Grade -->
						<td class="px-4 py-3">
							{#if member.grade_name && member.grade_color}
								<span
									class="inline-block rounded px-2 py-0.5 text-xs font-medium"
									style="background-color:{member.grade_color}; color:{luminance(member.grade_color)>0.5?'#111':'#fff'}"
								>
									{member.grade_name}
								</span>
							{:else}
								<span class="text-gray-700 text-xs">—</span>
							{/if}
						</td>

						<!-- Counts -->
						<td class="px-4 py-3 text-center text-gray-400 tabular-nums">{member.thread_count}</td>
						<td class="px-4 py-3 text-center text-gray-400 tabular-nums">{member.post_count}</td>

						<!-- Date -->
						<td class="px-4 py-3 text-xs text-gray-500">
							{new Date(member.joined_at).toLocaleDateString('fr-FR')}
						</td>

						<!-- Actions -->
						<td class="px-4 py-3 text-right">
							{#if member.role !== 'owner'}
								<div class="flex items-center justify-end gap-2">
									<a href="/admin/grades" class="text-xs text-indigo-400 hover:text-indigo-300">
										Grade
									</a>
									<button
										onclick={() => generateResetLink(member.user_id)}
										disabled={generatingFor === member.user_id}
										title="Générer un lien de réinitialisation de mot de passe"
										class="text-xs text-amber-500 hover:text-amber-400 disabled:opacity-50"
									>
										{generatingFor === member.user_id ? '…' : '🔑 Reset'}
									</button>
									<form method="POST" action="?/kick" use:enhance class="inline">
										<input type="hidden" name="user_id" value={member.user_id} />
										<button
											type="submit"
											onclick={(e) => { if (!confirm(`Exclure ${member.username} de la communauté ?`)) e.preventDefault() }}
											class="text-xs text-orange-500 hover:text-orange-400"
										>
											Exclure
										</button>
									</form>
									<button
										onclick={() => { banTarget = { userId: member.user_id, username: member.username }; banReason = ''; banIp = false; banEmail = false }}
										class="text-xs text-red-500 hover:text-red-400 font-medium"
									>
										Bannir
									</button>
								</div>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="px-4 py-8 text-center text-gray-600">
							Aucun membre trouvé.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- ── Membres bannis ──────────────────────────────────────────────────── -->
	{#if bans.length > 0}
		<div class="mt-10">
			<h2 class="text-base font-semibold text-white mb-1">Membres bannis <span class="text-gray-600 font-normal text-sm">({bans.length})</span></h2>
			<p class="text-xs text-gray-600 mb-4">Ces utilisateurs ne peuvent pas rejoindre la communauté.</p>
			<div class="rounded-xl border border-red-900/40 overflow-hidden">
				<table class="w-full text-sm">
					<thead class="bg-red-950/30 border-b border-red-900/40 text-xs text-red-400/70 uppercase tracking-wider">
						<tr>
							<th class="px-4 py-3 text-left">Membre</th>
							<th class="px-4 py-3 text-left">Raison</th>
							<th class="px-4 py-3 text-left">Banni par</th>
							<th class="px-4 py-3 text-left">Date</th>
							<th class="px-4 py-3 text-right">Action</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-red-900/20">
						{#each bans as ban}
							<tr class="bg-red-950/10 hover:bg-red-950/20 transition-colors">
								<td class="px-4 py-3">
									<div class="flex items-center gap-2.5">
										<div class="w-8 h-8 rounded-full bg-red-900/50 flex items-center justify-center text-xs font-bold text-red-400 shrink-0">
											{ban.username.charAt(0).toUpperCase()}
										</div>
										<div>
											<p class="font-medium text-gray-300">{ban.username}</p>
											<p class="text-xs text-gray-600">{ban.email}</p>
										</div>
									</div>
								</td>
								<td class="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={ban.reason ?? ''}>
									{#if ban.reason}{ban.reason}{:else}<span class="text-gray-700 italic">—</span>{/if}
								</td>
								<td class="px-4 py-3 text-xs text-gray-500">{ban.banned_by_username ?? '—'}</td>
								<td class="px-4 py-3 text-xs text-gray-500">{new Date(ban.banned_at).toLocaleDateString('fr-FR')}</td>
								<td class="px-4 py-3 text-right">
									<form method="POST" action="?/unban" use:enhance class="inline">
										<input type="hidden" name="user_id" value={ban.user_id} />
										<button
											type="submit"
											onclick={(e) => { if (!confirm(`Lever le ban de ${ban.username} ?`)) e.preventDefault() }}
											class="text-xs text-green-500 hover:text-green-400"
										>
											Débannir
										</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<!-- ── IPs bannies ─────────────────────────────────────────────────────── -->
	{#if ipBans.length > 0}
		<div class="mt-8">
			<h2 class="text-base font-semibold text-white mb-1">IPs bannies <span class="text-gray-600 font-normal text-sm">({ipBans.length})</span></h2>
			<p class="text-xs text-gray-600 mb-4">Aucune inscription ni connexion possible depuis ces adresses IP.</p>
			<div class="rounded-xl border border-orange-900/40 overflow-hidden">
				<table class="w-full text-sm">
					<thead class="bg-orange-950/20 border-b border-orange-900/40 text-xs text-orange-400/70 uppercase tracking-wider">
						<tr>
							<th class="px-4 py-3 text-left">IP</th>
							<th class="px-4 py-3 text-left">Raison</th>
							<th class="px-4 py-3 text-left">Banni par</th>
							<th class="px-4 py-3 text-left">Date</th>
							<th class="px-4 py-3 text-right">Action</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-orange-900/20">
						{#each ipBans as ban}
							<tr class="bg-orange-950/10 hover:bg-orange-950/20 transition-colors">
								<td class="px-4 py-3 font-mono text-sm text-orange-300">{ban.ip}</td>
								<td class="px-4 py-3 text-xs text-gray-500">
									{#if ban.reason}{ban.reason}{:else}<span class="text-gray-700 italic">—</span>{/if}
								</td>
								<td class="px-4 py-3 text-xs text-gray-500">{ban.banned_by_username ?? '—'}</td>
								<td class="px-4 py-3 text-xs text-gray-500">{new Date(ban.banned_at).toLocaleDateString('fr-FR')}</td>
								<td class="px-4 py-3 text-right">
									<form method="POST" action="?/unbanIp" use:enhance class="inline">
										<input type="hidden" name="ip" value={ban.ip} />
										<button
											type="submit"
											onclick={(e) => { if (!confirm(`Lever le ban IP ${ban.ip} ?`)) e.preventDefault() }}
											class="text-xs text-green-500 hover:text-green-400"
										>
											Retirer
										</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<!-- ── Emails bannis ───────────────────────────────────────────────────── -->
	{#if emailBans.length > 0}
		<div class="mt-8">
			<h2 class="text-base font-semibold text-white mb-1">Emails bannis <span class="text-gray-600 font-normal text-sm">({emailBans.length})</span></h2>
			<p class="text-xs text-gray-600 mb-4">Impossible de s'inscrire avec ces adresses ou domaines email.</p>
			<div class="rounded-xl border border-yellow-900/40 overflow-hidden">
				<table class="w-full text-sm">
					<thead class="bg-yellow-950/20 border-b border-yellow-900/40 text-xs text-yellow-400/70 uppercase tracking-wider">
						<tr>
							<th class="px-4 py-3 text-left">Email / Domaine</th>
							<th class="px-4 py-3 text-left">Raison</th>
							<th class="px-4 py-3 text-left">Banni par</th>
							<th class="px-4 py-3 text-left">Date</th>
							<th class="px-4 py-3 text-right">Action</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-yellow-900/20">
						{#each emailBans as ban}
							<tr class="bg-yellow-950/10 hover:bg-yellow-950/20 transition-colors">
								<td class="px-4 py-3 font-mono text-sm text-yellow-300">{ban.email}</td>
								<td class="px-4 py-3 text-xs text-gray-500">
									{#if ban.reason}{ban.reason}{:else}<span class="text-gray-700 italic">—</span>{/if}
								</td>
								<td class="px-4 py-3 text-xs text-gray-500">{ban.banned_by_username ?? '—'}</td>
								<td class="px-4 py-3 text-xs text-gray-500">{new Date(ban.banned_at).toLocaleDateString('fr-FR')}</td>
								<td class="px-4 py-3 text-right">
									<form method="POST" action="?/unbanEmail" use:enhance class="inline">
										<input type="hidden" name="email" value={ban.email} />
										<button
											type="submit"
											onclick={(e) => { if (!confirm(`Lever le ban email ${ban.email} ?`)) e.preventDefault() }}
											class="text-xs text-green-500 hover:text-green-400"
										>
											Retirer
										</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<!-- Ban confirmation modal -->
{#if banTarget}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		role="presentation"
		onclick={() => banTarget = null}
		onkeydown={(e) => { if (e.key === 'Escape') banTarget = null }}
	>
		<div
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			class="bg-gray-900 border border-red-900/60 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-base font-semibold text-white">Bannir <span class="text-red-400">{banTarget.username}</span></h2>
				<button onclick={() => banTarget = null} class="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
			</div>
			<p class="text-sm text-gray-400 mb-4">
				L'utilisateur sera exclu de la communauté et ne pourra plus la rejoindre.
			</p>
			<form method="POST" action="?/ban" use:enhance={({ cancel }) => {
					return async ({ result, update }) => {
						await update()
						if (result.type !== 'failure') banTarget = null
					}
				}}>
				<input type="hidden" name="user_id" value={banTarget.userId} />
				<input type="hidden" name="ban_ip" value={banIp ? 'true' : 'false'} />
				<input type="hidden" name="ban_email" value={banEmail ? 'true' : 'false'} />
				<div class="mb-4">
					<label for="ban-reason" class="block text-xs text-gray-500 mb-1.5">Raison <span class="text-gray-700">(optionnel)</span></label>
					<input
						id="ban-reason"
						type="text"
						name="reason"
						bind:value={banReason}
						placeholder="Raison du bannissement..."
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200
						       placeholder-gray-600 focus:outline-none focus:border-red-700 transition-colors"
					/>
				</div>
				<div class="flex flex-col gap-2 mb-5">
					<label class="flex items-center gap-2.5 cursor-pointer group">
						<input type="checkbox" bind:checked={banIp}
							class="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-orange-600 cursor-pointer" />
						<span class="text-sm text-gray-300 group-hover:text-white transition-colors">
							Bannir l'adresse IP d'inscription
						</span>
					</label>
					<label class="flex items-center gap-2.5 cursor-pointer group">
						<input type="checkbox" bind:checked={banEmail}
							class="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-yellow-600 cursor-pointer" />
						<span class="text-sm text-gray-300 group-hover:text-white transition-colors">
							Bannir l'adresse email
						</span>
					</label>
				</div>
				<div class="flex gap-2 justify-end">
					<button type="button" onclick={() => banTarget = null}
						class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
						Annuler
					</button>
					<button type="submit"
						class="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-sm font-semibold text-white transition-colors">
						Confirmer le ban
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Reset link result modal -->
{#if resetLinkResult || resetLinkError}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		role="presentation"
		onclick={() => { resetLinkResult = null; resetLinkError = '' }}
		onkeydown={(e) => { if (e.key === 'Escape') { resetLinkResult = null; resetLinkError = '' } }}
	>
		<div
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			{#if resetLinkResult}
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-base font-semibold text-white">Lien de réinitialisation</h2>
					<button
						onclick={() => resetLinkResult = null}
						class="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
					>✕</button>
				</div>

				<p class="text-sm text-gray-400 mb-4">
					Transmettez ce lien à <strong class="text-gray-200">{resetLinkResult.username}</strong> par un canal sécurisé. Il expire dans <strong class="text-amber-400">1 heure</strong> et ne peut être utilisé qu'une seule fois.
				</p>

				<div class="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-4 flex items-center gap-2">
					<code class="text-xs text-amber-300 break-all flex-1 select-all">{resetLinkResult.reset_url}</code>
					<button
						onclick={() => copyToClipboard(resetLinkResult!.reset_url)}
						class="shrink-0 px-3 py-1.5 rounded bg-amber-700/40 hover:bg-amber-700/60 text-amber-300 text-xs font-medium transition-colors"
					>
						Copier
					</button>
				</div>

				<p class="text-xs text-gray-600">
					🔒 Expire le {new Date(resetLinkResult.expires_at).toLocaleString('fr-FR')}
				</p>
			{:else if resetLinkError}
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-base font-semibold text-white">Erreur</h2>
					<button
						onclick={() => resetLinkError = ''}
						class="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
					>✕</button>
				</div>
				<p class="text-sm text-red-400">{resetLinkError}</p>
			{/if}
		</div>
	</div>
{/if}
