<script lang="ts">
	import { t } from '$lib/i18n'
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';
	import { unreadCountStore } from '$lib/socket';
	import { goto } from '$app/navigation';

	const tFn = $derived($t)

	async function markReadAndNavigate(notif: any) {
		if (!notif.is_read) {
			unreadCountStore.update(n => Math.max(0, n - 1))
			fetch(`/api/v1/notifications/${notif.id}/read`, { method: 'PATCH' }).catch(() => {})
		}
		goto(notifLink(notif))
	}

	let { data }: { data: PageData } = $props();

	let notifications = $state((data.notifications ?? []).map((n: any) => ({ ...n })));
	const unread = $derived(notifications.filter((n: any) => !n.is_read).length);
	const readCount = $derived(notifications.filter((n: any) => n.is_read).length);

	const TYPE_ICON: Record<string, string> = {
		thread_reply: '💬',
		post_thanks:  '🙏',
		mention:      '@',
	};

	const TYPE_LABEL: Record<string, string> = {
		thread_reply: tFn('notifications.thread_reply_label'),
		post_thanks:  tFn('notifications.post_thanks_label'),
		mention:      tFn('notifications.mention_label'),
	};

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			day: '2-digit', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit',
		});
	}

	function notifLink(n: any): string {
		if (n.category_id && n.thread_id) {
			const cat    = n.category_slug ?? n.category_id;
			const thread = n.thread_slug   ?? n.thread_id;
			return `/forum/${cat}/${thread}${n.post_id ? `#${n.post_id}` : ''}`;
		}
		return '#';
	}
</script>

<svelte:head>
	<title>{tFn('nav.notifications')} — Nodyx</title>
</svelte:head>

<div class="max-w-2xl">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold text-white">
			Notifications
			{#if unread > 0}
				<span class="ml-2 text-sm font-normal text-indigo-400">{tFn('notifications.unread_count', { n: String(unread), s: unread > 1 ? 's' : '' })}</span>
			{/if}
		</h1>
		<div class="flex items-center gap-2">
			{#if unread > 0}
				<form method="POST" action="?/markAllRead" use:enhance={() => {
					return async ({ update }) => {
						unreadCountStore.set(0)
						notifications = notifications.map((n: any) => ({ ...n, is_read: true }))
						await update({ reset: false })
					}
				}}>
					<button type="submit"
						class="px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
						Tout marquer comme lu
					</button>
				</form>
			{/if}
			{#if readCount > 0}
				<form method="POST" action="?/clearRead" use:enhance={() => {
					return async ({ update }) => {
						notifications = notifications.filter((n: any) => !n.is_read)
						await update({ reset: false })
					}
				}}>
					<button type="submit"
						class="px-3 py-1.5 rounded-lg border border-red-900/50 text-xs text-red-500/70 hover:text-red-400 hover:border-red-700 transition-colors">
						Effacer les lues
					</button>
				</form>
			{/if}
		</div>
	</div>

	<!-- Info purge automatique -->
	<p class="text-xs text-gray-600 mb-4">{tFn('notifications.auto_purge_info')}</p>

	{#if notifications.length === 0}
		<div class="rounded-xl border border-gray-800 bg-gray-900/50 px-6 py-12 text-center">
			<p class="text-gray-500">{tFn('notifications.empty_state')}</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each notifications as notif}
				<div class="flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors
					{notif.is_read
						? 'border-gray-800 bg-gray-900/30'
						: 'border-indigo-900/50 bg-indigo-950/20'}">

					<!-- Icon -->
					<div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base
						{notif.is_read ? 'bg-gray-800' : 'bg-indigo-900/40'}">
						{TYPE_ICON[notif.type] ?? '🔔'}
					</div>

					<!-- Content -->
					<div class="flex-1 min-w-0">
						<p class="text-sm text-gray-300">
							{#if notif.actor_username}
								<span class="font-semibold text-white">{notif.actor_username}</span>
							{/if}
							{TYPE_LABEL[notif.type] ?? notif.type}
							{#if notif.thread_title}
								<span class="text-gray-400"> « {notif.thread_title} »</span>
							{/if}
						</p>
						<p class="text-xs text-gray-600 mt-0.5">{formatDate(notif.created_at)}</p>
					</div>

					<!-- Actions -->
					<div class="flex items-center gap-2 shrink-0">
						{#if notif.category_id && notif.thread_id}
							<button
								onclick={() => markReadAndNavigate(notif)}
								class="text-xs text-indigo-400 hover:text-indigo-300">
								Voir →
							</button>
						{/if}
						{#if !notif.is_read}
							<form method="POST" action="?/markRead" use:enhance={() => {
								return async ({ update }) => {
									unreadCountStore.update(n => Math.max(0, n - 1))
									const n = notifications.find((x: any) => x.id === notif.id)
									if (n) n.is_read = true
									await update({ reset: false })
								}
							}}>
								<input type="hidden" name="id" value={notif.id} />
								<button type="submit" title="Marquer comme lu"
									class="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors bg-gray-800 text-gray-500 hover:bg-indigo-900/40 hover:text-indigo-300">
									✓
								</button>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
