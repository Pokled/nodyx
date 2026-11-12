<script lang="ts">
	// Le webhook d'OctoGuard a déménagé dans Administration > Intégrations > Webhooks
	// (D38-D39) : ici, le raccourci, avec les destinations qui reçoivent la modération.
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	type Dest = { id: string; name: string; format: string; enabled: boolean; paused_at: string | null }
	const dests = $derived(((data.webhook as any)?.destinations ?? []) as Dest[])
</script>

<svelte:head><title>{tFn('og2.nav_webhook')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.wh_moved_title')}</h1>
				<p class="adm-desc">{tFn('og2.wh_moved')}</p>
			</div>
		</div>
		<a class="adm-btn adm-btn--primary" href="/admin/webhooks">{tFn('og2.wh_moved_go')}</a>
	</header>

	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}

	<section class="adm-card" aria-labelledby="og-wh-list">
		<h2 id="og-wh-list" class="adm-title" style="font-size:0.9375rem">{tFn('og2.wh_moved_list')}</h2>
		{#if dests.length === 0}
			<p class="og-help" style="margin-top:0.5rem">{tFn('og2.wh_moved_none')}</p>
		{:else}
			<div class="og-rows" style="margin-top:0.75rem">
				{#each dests as d (d.id)}
					<a class="og-row" href="/admin/webhooks" style="text-decoration:none;color:inherit">
						<span class="og-ic og-k-hold"><Icon d="M5 11h14v10H5z M8 11V7a4 4 0 018 0v4" /></span>
						<div class="og-row-body"><b style="font-weight:600">{d.name}</b><div class="og-meta">{tFn(`wh.fmt_${d.format}`)} · {tFn(d.paused_at ? 'wh.st_paused' : d.enabled ? 'wh.st_on' : 'wh.st_off')}</div></div>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>
