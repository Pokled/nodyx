<script lang="ts">
	// La carte d'une personne au survol (ou au focus clavier) d'une puce de mention
	// (maquette https://nodyx.org/mentions-maquette.html, section 3). Montée dans <body>
	// par l'action mentionChips, jamais coupée par un conteneur.
	import { goto } from '$app/navigation'
	import { t } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import { onlineMembersStore } from '$lib/socket'
	import { voiceChannelMembersStore } from '$lib/voice'
	import { labelOf, type MentionPerson } from '$lib/mentions'

	let { person, x, y, token = null, me = null, onenter, onleave }: {
		person: MentionPerson
		x: number
		y: number
		token?: string | null
		me?: string | null
		onenter?: () => void
		onleave?: () => void
	} = $props()

	const online = $derived($onlineMembersStore.some(m => m.userId === person.id))
	const inVoice = $derived(Object.values($voiceChannelMembersStore).some(list => list?.some(m => m.userId === person.id)))
	let busy = $state(false)
	let muted = $state(false)
	async function setMuted(on: boolean) {
		if (busy || !token) return
		busy = true
		try {
			const r = await apiFetch(fetch, `/mentions/mutes/${person.id}`, { method: on ? 'PUT' : 'DELETE', headers: { Authorization: `Bearer ${token}` } })
			if (r.ok) muted = on
		} finally { busy = false }
	}

	async function write() {
		if (busy || !token) return
		busy = true
		try {
			const r = await apiFetch(fetch, '/dm/conversations', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ userId: person.id }) })
			const j = await r.json().catch(() => ({}))
			if (r.ok && j.conversationId) await goto(`/dm/${j.conversationId}`)
		} finally { busy = false }
	}

	const COLORS = ['#7c3aed', '#0f766e', '#b45309', '#be185d', '#334155', '#1d4ed8', '#15803d']
	const colorOf = (n: string) => COLORS[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]
	const name = $derived(labelOf(person))
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mc" style="left:{x}px; top:{y}px" role="dialog" tabindex="-1" aria-label={name} onmouseenter={onenter} onmouseleave={onleave}>
	<div class="mc-h">
		<span class="mc-av" style={person.avatar ? '' : `background:${colorOf(person.username ?? '')}`}>
			{#if person.avatar}<img src={person.avatar} alt="" />{:else}{name.slice(0, 1).toUpperCase()}{/if}
		</span>
		<span class="mc-id">
			<b>{name}</b>
			<span>@{person.username}{#if person.grade} · <span style={person.grade.color ? `color:${person.grade.color}` : ''}>{person.grade.name}</span>{/if}</span>
		</span>
	</div>
	<div class="mc-st">
		<span class="mc-dot" class:on={online || inVoice}></span>
		{inVoice ? $t('mention.card_in_voice') : online ? $t('mention.card_online') : $t('mention.card_offline')}
	</div>
	{#if token && person.id !== me}
		<p class="mc-mute" role="status" aria-live="polite">
			{#if muted}{$t('mention.card_muted')} <button type="button" onclick={() => setMuted(false)} disabled={busy}>{$t('mention.card_unmute')}</button>
			{:else}<button type="button" onclick={() => setMuted(true)} disabled={busy}>{$t('mention.card_mute')}</button>{/if}
		</p>
	{/if}
	<div class="mc-b">
		<a class="mc-btn" href="/users/{person.username}">{$t('mention.card_profile')}</a>
		{#if token && person.id !== me}
			<button type="button" class="mc-btn mc-primary" onclick={write} disabled={busy}>{$t('mention.card_write')}</button>
		{/if}
	</div>
</div>

<style>
	.mc { position: fixed; z-index: 80; width: 260px; background: var(--nx-surface); color: var(--nx-text); border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,.2); padding: 12px; font-size: 13px; line-height: 1.4; animation: mc-in .12s ease-out; }
	@keyframes mc-in { from { opacity: 0; transform: translateY(-2px); } }
	@media (prefers-reduced-motion: reduce) { .mc { animation: none; } }
	.mc-h { display: flex; gap: 10px; align-items: center; }
	.mc-av { width: 40px; height: 40px; border-radius: 11px; flex: none; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 16px; overflow: hidden; }
	.mc-av img { width: 100%; height: 100%; object-fit: cover; }
	.mc-id { min-width: 0; display: flex; flex-direction: column; }
	.mc-id b { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.mc-id > span { font-size: 12px; color: var(--nx-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.mc-st { margin: 10px 0; display: flex; gap: 7px; align-items: center; font-size: 12.5px; color: var(--nx-text-muted); }
	.mc-dot { width: 8px; height: 8px; border-radius: 99px; background: #9ca3af; flex: none; }
	.mc-dot.on { background: #22c55e; }
	.mc-b { display: flex; gap: 6px; }
	.mc-mute { margin: -4px 0 10px; font-size: 12px; color: var(--nx-text-muted); }
	.mc-mute button { border: 0; background: none; padding: 0; color: var(--nx-text-muted); text-decoration: underline; cursor: pointer; font: inherit; }
	.mc-mute button:hover { color: var(--nx-text); }
	.mc-btn { flex: 1; display: inline-flex; justify-content: center; align-items: center; border-radius: 8px; padding: 5px 10px; font-size: 12.5px; font-weight: 600; border: 1px solid color-mix(in srgb, var(--nx-text) 14%, transparent); background: transparent; color: var(--nx-text); text-decoration: none; cursor: pointer; }
	.mc-btn:hover { background: color-mix(in srgb, var(--nx-text) 6%, transparent); }
	.mc-primary { background: var(--nx-header-accent); color: var(--nx-on-accent, #16120c); border-color: transparent; }
	.mc-primary:hover { background: var(--nx-header-accent); filter: brightness(1.05); }
</style>
