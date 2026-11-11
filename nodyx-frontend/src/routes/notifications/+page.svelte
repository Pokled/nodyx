<script lang="ts">
	import { t, locale } from '$lib/i18n'
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';
	import { unreadCountStore } from '$lib/socket';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';

	const tFn = $derived($t)

	async function markReadAndNavigate(notif: any) {
		if (!notif.is_read) {
			unreadCountStore.update(n => Math.max(0, n - 1))
			fetch(`/api/v1/notifications/${notif.id}/read`, { method: 'PATCH' }).catch(() => {})
		}
		goto(notifLink(notif))
	}

	let { data }: { data: PageData } = $props();

	let notifications = $state(untrack(() => (data.notifications ?? []).map((n: any) => ({ ...n }))));
	const unread = $derived(notifications.filter((n: any) => !n.is_read).length);
	const readCount = $derived(notifications.filter((n: any) => n.is_read).length);

	const TYPE_ICON: Record<string, string> = {
		thread_reply: '💬',
		post_thanks:  '🙏',
		mention:      '@',
		canvas_access_request: '🎨',
		canvas_access_granted: '🎨',
		report_resolved: '✓',
		moderation_warning: '!',
		held_approved: '✓',
		held_refused: '×',
		ladder_pending: '⚖',
		ladder_expired: '⚖',
		ladder_engine_alert: '⚖',
		appeal_resolved: '⚖',
	};

	const TYPE_LABEL = $derived<Record<string, string>>({
		thread_reply: tFn('notifications.thread_reply_label'),
		post_thanks:  tFn('notifications.post_thanks_label'),
		mention:      tFn('notifications.mention_label'),
		canvas_access_request: tFn('notifications.canvas_access_request_label'),
		canvas_access_granted: tFn('notifications.canvas_access_granted_label'),
		report_resolved: tFn('notifications.report_resolved_label'),
		moderation_warning: tFn('notifications.moderation_warning_label'),
		held_approved: tFn('notifications.held_approved_label'),
		held_refused: tFn('notifications.held_refused_label'),
	});

	// Les étiquettes qui nomment quelqu'un (le barème) ou dépendent d'un motif
	function labelOf(n: any): string {
		if (n.type === 'ladder_pending') return tFn('notifications.ladder_pending_label', { name: n.meta?.username ?? '' })
		if (n.type === 'ladder_expired') return tFn('notifications.ladder_expired_label', { name: n.meta?.username ?? '' })
		if (n.type === 'ladder_engine_alert') return tFn('notifications.ladder_engine_alert_label', { name: n.meta?.username ?? '' })
		if (n.type === 'moderation_warning' && !n.meta?.reason) return tFn('notifications.moderation_warning_plain')
		// Lot 8 : une valeur du cœur, la phrase se construit ici
		if (n.type === 'appeal_resolved') return tFn(n.meta?.outcome === 'overturned' ? 'notifications.appeal_overturned_label' : 'notifications.appeal_upheld_label')
		return TYPE_LABEL[n.type] ?? n.type
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString($locale, {
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
	<title>{tFn('nav.notifications')} · Nodyx</title>
</svelte:head>

<div class="max-w-2xl">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold text-[var(--nx-text)]">
			Notifications
			{#if unread > 0}
				<span class="ml-2 text-sm font-normal text-[var(--nx-header-accent)]">{tFn('notifications.unread_count', { n: String(unread), s: unread > 1 ? 's' : '' })}</span>
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
						class="px-3 py-1.5 rounded-lg border border-[var(--nx-border)] text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] hover:border-[var(--nx-text-muted)] transition-colors">
						{tFn('notifications.mark_all_read')}
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
						class="px-3 py-1.5 rounded-lg border border-red-900/50 text-xs text-red-500/70 hover:text-[var(--nx-bad)] hover:border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] transition-colors">
						{tFn('notifications.clear_read')}
					</button>
				</form>
			{/if}
		</div>
	</div>

	<!-- Info purge automatique -->
	<p class="text-xs text-[var(--nx-text-muted)] mb-4">{tFn('notifications.auto_purge_info')}</p>

	{#if notifications.length === 0}
		<div class="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)]/50 px-6 py-12 text-center">
			<p class="text-[var(--nx-text-muted)]">{tFn('notifications.empty_state')}</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each notifications as notif}
				<div class="flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors
					{notif.is_read
						? 'border-[var(--nx-border)] bg-[var(--nx-surface)]/30'
						: 'border-indigo-900/50 bg-[rgb(var(--nx-accent-rgb)/0.08)]'}">

					<!-- Icon -->
					<div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base
						{notif.is_read ? 'bg-[var(--nx-surface-raised)]' : 'bg-[rgb(var(--nx-accent-rgb)/0.14)]'}">
						{TYPE_ICON[notif.type] ?? '🔔'}
					</div>

					<!-- Content -->
					<div class="flex-1 min-w-0">
						<p class="text-sm text-[var(--nx-text)]">
							{#if notif.actor_username}
								<span class="font-semibold text-[var(--nx-text)]">{notif.actor_username}</span>
							{/if}
							{labelOf(notif)}
							{#if notif.type === 'held_refused' && notif.meta?.expired}
								<span class="block mt-1 text-[var(--nx-text-muted)]">{tFn('notifications.held_expired_hint')}</span>
							{/if}
							{#if (notif.type === 'held_approved' || notif.type === 'held_refused') && notif.meta?.excerpt}
								<span class="block mt-1 text-[var(--nx-text)]">« {notif.meta.excerpt} »</span>
							{/if}
							{#if notif.type === 'moderation_warning' && notif.meta?.reason}
								<span class="block mt-1 text-[var(--nx-text)]">« {notif.meta.reason} »</span>
							{/if}
							{#if notif.type === 'appeal_resolved' && notif.meta?.reply}
								<span class="block mt-1 text-[var(--nx-text)]">« {notif.meta.reply} »</span>
							{/if}
							{#if notif.thread_title}
								<span class="text-[var(--nx-text-muted)]"> « {notif.thread_title} »</span>
							{/if}
						</p>
						<p class="text-xs text-[var(--nx-text-muted)] mt-0.5">{formatDate(notif.created_at)}</p>
					</div>

					<!-- Actions -->
					<div class="flex items-center gap-2 shrink-0">
						{#if notif.type === 'moderation_warning'}
							<!-- Lot 8 : contester, une autre personne de l'équipe relira -->
							<a href={notif.meta?.warn_id ? `/settings/sanctions?decision=${notif.meta.warn_id}&contest=1` : '/settings/sanctions'}
								title={tFn('notifications.contest_hint')}
								class="text-xs px-2 py-1 rounded-md border border-[var(--nx-border)] text-[var(--nx-text)] hover:border-[var(--nx-text-muted)]">{tFn('notifications.contest')}</a>
						{/if}
						{#if notif.type === 'appeal_resolved'}
							<a href="/settings/sanctions" class="text-xs text-[var(--nx-header-accent)] hover:text-[var(--nx-header-accent)]">{tFn('notifications.view')}</a>
						{/if}
						{#if (notif.type === 'ladder_pending' || notif.type === 'ladder_expired' || notif.type === 'ladder_engine_alert') && notif.meta?.user_id}
							<a href="/admin/members/{notif.meta.user_id}" class="text-xs text-[var(--nx-header-accent)] hover:text-[var(--nx-header-accent)]">{tFn('notifications.open_file')}</a>
						{/if}
						{#if notif.category_id && notif.thread_id}
							<button
								onclick={() => markReadAndNavigate(notif)}
								class="text-xs text-[var(--nx-header-accent)] hover:text-[var(--nx-header-accent)]">
								{tFn('notifications.view')}
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
								<button type="submit" title={tFn('notifications.mark_read')}
									class="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors bg-[var(--nx-surface-raised)] text-[var(--nx-text-muted)] hover:bg-[rgb(var(--nx-accent-rgb)/0.14)] hover:text-[var(--nx-header-accent)]">
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
