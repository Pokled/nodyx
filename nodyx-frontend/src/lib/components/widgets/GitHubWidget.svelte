<script lang="ts">

	import { t } from '$lib/i18n'
	const tFn = $derived($t)
	import { API_URL } from '$lib/api'

	interface GhRepo {
		name: string
		description: string | null
		language: string | null
		stars: number
		url: string
	}

	interface GitHubData {
		login: string
		name: string | null
		avatar_url: string
		bio: string | null
		public_repos: number
		followers: number
		pinned_repos: GhRepo[]
	}

	let { nodyxUsername }: { nodyxUsername: string } = $props()

	// Language color map (subset of github-colors)
	const LANG_COLORS: Record<string, string> = {
		TypeScript:  '#3178c6',
		JavaScript:  '#f1e05a',
		Python:      '#3572A5',
		Rust:        '#dea584',
		Go:          '#00ADD8',
		Java:        '#b07219',
		'C++':       '#f34b7d',
		C:           '#555555',
		Ruby:        '#701516',
		PHP:         '#4F5D95',
		Swift:       '#F05138',
		Kotlin:      '#A97BFF',
		Shell:       '#89e051',
		HTML:        '#e34c26',
		CSS:         '#563d7c',
		Vue:         '#41b883',
		Svelte:      '#ff3e00',
	}

	// Fetch GitHub data from our backend (which caches it in Redis)
	async function fetchGitHub(): Promise<GitHubData | null> {
		try {
			const res = await fetch(`${API_URL}/users/${nodyxUsername}/github`)
			if (!res.ok) return null
			return await res.json()
		} catch {
			return null
		}
	}

	const githubPromise = $derived(fetchGitHub())
</script>

{#await githubPromise}
	<!-- Loading skeleton -->
	<div class="border border-[var(--p-card-border)] bg-[var(--p-card-bg)] p-4 animate-pulse">
		<div class="h-4 bg-[var(--p-card-border)] rounded w-32 mb-3"></div>
		<div class="flex items-center gap-3 mb-3">
			<div class="w-10 h-10 bg-[var(--p-card-border)] rounded-full"></div>
			<div class="space-y-1.5 flex-1">
				<div class="h-3 bg-[var(--p-card-border)] rounded w-24"></div>
				<div class="h-3 bg-[var(--p-card-border)] rounded w-40"></div>
			</div>
		</div>
		<div class="space-y-2">
			<div class="h-12 bg-[var(--p-card-border)] rounded"></div>
			<div class="h-12 bg-[var(--p-card-border)] rounded"></div>
		</div>
	</div>

{:then data}
	{#if data}
		<div class="border border-[var(--p-card-border)] bg-[var(--p-card-bg)] overflow-hidden">
			<!-- Header -->
			<div class="flex items-center gap-2 px-4 py-3 bg-[var(--p-card-bg)] border-b border-[var(--p-card-border)]">
				<svg viewBox="0 0 16 16" class="w-4 h-4 text-[var(--p-text)] fill-current" aria-hidden="true">
					<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
					0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
					1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
					0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27
					2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
					1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01
					2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
				</svg>
				<a
					href="https://github.com/{data.login}"
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm font-semibold text-[var(--p-text)] hover:text-[var(--p-text)]"
				>
					GitHub · {data.login}
				</a>
			</div>

			<!-- User info -->
			<div class="flex items-start gap-3 px-4 py-3 border-b border-[var(--p-card-border)]">
				<img
					src={data.avatar_url}
					alt={tFn('gh.avatar_alt', { login: data.login })}
					class="w-10 h-10 rounded-full border border-[var(--p-card-border)] shrink-0"
				/>
				<div class="flex-1 min-w-0">
					{#if data.name}
						<p class="text-sm font-semibold text-[var(--p-text)]">{data.name}</p>
					{/if}
					{#if data.bio}
						<p class="text-xs text-[var(--p-text-muted)] line-clamp-2">{data.bio}</p>
					{/if}
					<p class="text-xs text-[var(--p-text-muted)] mt-1">
						<span class="mr-3">📦 {data.public_repos} repos</span>
						<span>👥 {data.followers} followers</span>
					</p>
				</div>
			</div>

			<!-- Repos (max 3) -->
			{#if data.pinned_repos.length > 0}
				<div class="px-4 py-3">
					<p class="text-xs text-[var(--p-text-muted)] uppercase tracking-wider mb-2">{tFn('gh.recent_repos')}</p>
					<ul class="space-y-2">
						{#each data.pinned_repos as repo}
							<li>
								<a
									href={repo.url}
									target="_blank"
									rel="noopener noreferrer"
									class="block rounded border border-[var(--p-card-border)] px-3 py-2 hover:border-[var(--p-text-muted)] hover:bg-[color-mix(in_srgb,var(--p-text)_5%,transparent)] transition-colors"
								>
									<div class="flex items-center justify-between gap-2">
										<span class="text-sm font-medium text-[var(--p-accent)] truncate">{repo.name}</span>
										<span class="text-xs text-[var(--nx-warn)] shrink-0">⭐ {repo.stars}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										{#if repo.description}
											<span class="text-xs text-[var(--p-text-muted)] truncate">{repo.description}</span>
										{/if}
										{#if repo.language}
											<span
												class="text-xs shrink-0 font-medium"
												style="color: {LANG_COLORS[repo.language] ?? '#8b949e'}"
											>
												{repo.language}
											</span>
										{/if}
									</div>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
	<!-- If data is null (error or no GitHub linked), render nothing — per spec -->

{:catch}
	<!-- Silent failure — no visible error per spec -->
{/await}
