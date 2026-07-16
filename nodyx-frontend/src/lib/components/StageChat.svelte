<script lang="ts">
    // ── Chat du salon, DANS la scène ET dans le salon vocal ───────────────────
    //
    // Autonome par nécessité : les messages de la page chat sont un état LOCAL de
    // cette page. La scène vit au-dessus des pages (VoicePanel → +layout) et doit
    // donc pouvoir suivre le fil du salon même quand la page chat n'est pas montée
    // (fenêtre flottante, navigation ailleurs). Ce panneau rejoint donc lui-même la
    // room et écoute le live.
    //
    // ⚠ On n'émet JAMAIS `chat:leave` : la page chat gère son propre cycle de vie,
    // un leave émis d'ici la sortirait de la room et lui couperait ses messages.
    //
    // Parité avec le chat principal : mêmes events (`chat:send/edit/delete`, reçus
    // `chat:message_edited/deleted`), même éditeur Nodyx (TipTap) dans un modal, et
    // la MÊME modération (supprimer le sien ou tout si admin, modifier le sien).
    // Pensé MOBILE D'ABORD : actions au TAP (le survol n'existe pas au doigt), et
    // l'éditeur riche s'ouvre en plein écran sur mobile, en carte sur desktop.

    import { socket } from '$lib/socket'
    import { page } from '$app/stores'
    import { linkifyHtml } from '$lib/linkify'
    import { renderCustomEmojis, customEmojisStore } from '$lib/customEmojis'
    import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'

    let {
        channelId,
        channelName = '',
        oncollapse,
    }: { channelId: string; channelName?: string; oncollapse?: () => void } = $props()

    type StageMessage = {
        id:              string
        channel_id:      string
        author_id:       string
        author_username: string
        author_avatar:   string | null
        content:         string | null
        created_at:      string
        is_deleted?:     boolean
        is_edited?:      boolean
    }

    let messages   = $state<StageMessage[]>([])
    let draft      = $state('')
    let listEl     = $state<HTMLDivElement | null>(null)
    let openMenuId = $state<string | null>(null)   // message dont les actions sont dépliées

    // ── Éditeur riche (modal) ─────────────────────────────────────────────────
    let richOpen    = $state(false)
    let richContent = $state('')
    let richInitial = $state('')
    let editingId   = $state<string | null>(null)  // null = nouveau message ; sinon édition
    let editorKey   = $state(0)                     // remonte l'éditeur à chaque ouverture

    // ── Qui suis-je (pour la modération) ──────────────────────────────────────
    const me      = $derived(($page.data as { user?: { id?: string; role?: string } })?.user)
    const userId  = $derived(me?.id ?? '')
    const isAdmin = $derived(me?.role === 'owner' || me?.role === 'admin')
    const canActOn = (m: StageMessage) => m.author_id === userId || isAdmin

    const emojis = $derived($customEmojisStore)

    function scrollToBottom(): void {
        queueMicrotask(() => { if (listEl) listEl.scrollTop = listEl.scrollHeight })
    }

    $effect(() => {
        const sock = $socket
        const id   = channelId
        if (!sock || !id) return

        sock.emit('chat:join', id)

        const onHistory = (p: { channelId: string; messages: StageMessage[] }) => {
            if (p.channelId !== id) return
            messages = p.messages ?? []
            scrollToBottom()
        }
        const onMessage = (msg: StageMessage) => {
            if (msg.channel_id !== id) return
            messages = [...messages, msg]
            scrollToBottom()
        }
        const onEdited = (p: { messageId: string; content: string }) => {
            messages = messages.map(m => m.id === p.messageId ? { ...m, content: p.content, is_edited: true } : m)
        }
        const onDeleted = (p: { messageId: string }) => {
            messages = messages.map(m => m.id === p.messageId ? { ...m, is_deleted: true, content: null } : m)
        }
        sock.on('chat:history', onHistory)
        sock.on('chat:message', onMessage)
        sock.on('chat:message_edited', onEdited)
        sock.on('chat:message_deleted', onDeleted)

        return () => {
            sock.off('chat:history', onHistory)
            sock.off('chat:message', onMessage)
            sock.off('chat:message_edited', onEdited)
            sock.off('chat:message_deleted', onDeleted)
        }
    })

    // ── Envoi rapide (une ligne, clavier natif) ───────────────────────────────
    function send(): void {
        const content = draft.trim()
        const sock    = $socket
        if (!content || !sock || !channelId) return
        sock.emit('chat:send', { channelId, content })
        draft = ''
    }

    // La scène écoute F / P / Échap sur window : en tapant un message on ne doit
    // PAS déclencher le plein écran. On coupe la propagation à la source.
    function onKeydown(e: KeyboardEvent): void {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    }

    // ── Éditeur riche (Nodyx / TipTap) ────────────────────────────────────────
    function openRich(): void {
        editingId = null
        richInitial = ''
        richContent = ''
        editorKey++
        richOpen = true
    }
    function startEdit(m: StageMessage): void {
        openMenuId = null
        editingId = m.id
        richInitial = m.content ?? ''
        richContent = m.content ?? ''
        editorKey++
        richOpen = true
    }
    function closeRich(): void {
        richOpen = false
        editingId = null
        richContent = ''
    }
    function sendRich(): void {
        const sock = $socket
        const html = richContent.trim()
        if (!sock || !html) return
        if (editingId) {
            sock.emit('chat:edit', { messageId: editingId, content: html })
        } else if (channelId) {
            sock.emit('chat:send', { channelId, content: html })
        }
        closeRich()
    }

    // ── Suppression ───────────────────────────────────────────────────────────
    function confirmDelete(id: string): void {
        openMenuId = null
        const sock = $socket
        if (!sock) return
        if (typeof window !== 'undefined' && !window.confirm('Supprimer ce message ?')) return
        sock.emit('chat:delete', { messageId: id })
    }

    function hhmm(iso: string): string {
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        } catch { return '' }
    }
</script>

<div class="flex h-full flex-col" style="background: rgba(6,6,12,0.75); border-left: 1px solid rgba(255,255,255,0.05)">

    <!-- En-tête -->
    <div class="flex shrink-0 items-center gap-2 px-4 py-3"
         style="border-bottom: 1px solid rgba(255,255,255,0.05)">
        <svg class="h-3.5 w-3.5 shrink-0" style="color: rgb(107,114,128)" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 1 1-4.2-7.6L21 3v9z"/>
        </svg>
        <span class="text-[11px] font-bold uppercase tracking-widest text-white">Chat du salon</span>
        {#if channelName}
            <span class="truncate text-[11px]" style="color: rgb(107,114,128)">{channelName}</span>
        {/if}
        {#if oncollapse}
            <button
                onclick={oncollapse}
                class="ml-auto shrink-0 rounded p-1 transition-colors hover:bg-white/10"
                style="color: rgb(107,114,128)"
                title="Replier le chat"
                aria-label="Replier le chat"
            >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
            </button>
        {/if}
    </div>

    <!-- Fil -->
    <div bind:this={listEl} class="flex-1 space-y-3 overflow-y-auto px-4 py-3" style="scrollbar-width: thin">
        {#if messages.length === 0}
            <p class="pt-6 text-center text-xs" style="color: rgba(255,255,255,0.25)">
                Aucun message pour l'instant.
            </p>
        {/if}
        {#each messages as msg (msg.id)}
            {#if msg.is_deleted}
                <p class="pl-8 text-[11px] italic" style="color: rgba(255,255,255,0.25)">Message supprimé</p>
            {:else if msg.content}
                <div class="flex gap-2.5">
                    {#if msg.author_avatar}
                        <img src={msg.author_avatar} alt={msg.author_username}
                             class="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"/>
                    {:else}
                        <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-700 text-[9px] font-bold text-white">
                            {msg.author_username?.[0]?.toUpperCase() ?? '?'}
                        </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                        <div class="flex items-baseline gap-2">
                            <span class="truncate text-xs font-semibold text-white">{msg.author_username}</span>
                            <span class="shrink-0 text-[10px]" style="color: rgb(75,85,99)">{hhmm(msg.created_at)}</span>
                            {#if msg.is_edited}
                                <span class="shrink-0 text-[9px]" style="color: rgb(75,85,99)">(modifié)</span>
                            {/if}
                            <!-- Actions : au TAP (mobile-first), pas au survol -->
                            {#if canActOn(msg)}
                                <div class="ml-auto flex shrink-0 items-center gap-0.5">
                                    {#if openMenuId === msg.id}
                                        {#if msg.author_id === userId}
                                            <button onclick={() => startEdit(msg)} title="Modifier" aria-label="Modifier"
                                                    class="rounded p-1 transition-colors hover:bg-white/10" style="color: rgb(129,140,248)">
                                                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                                            </button>
                                        {/if}
                                        <button onclick={() => confirmDelete(msg.id)} title="Supprimer" aria-label="Supprimer"
                                                class="rounded p-1 transition-colors hover:bg-white/10" style="color: rgb(248,113,113)">
                                            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                                        </button>
                                        <button onclick={() => openMenuId = null} title="Fermer" aria-label="Fermer"
                                                class="rounded p-1 transition-colors hover:bg-white/10" style="color: rgb(107,114,128)">
                                            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                                        </button>
                                    {:else}
                                        <button onclick={() => openMenuId = msg.id} title="Actions" aria-label="Actions du message"
                                                class="rounded p-1 transition-colors hover:bg-white/10" style="color: rgb(107,114,128)">
                                            <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
                                        </button>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                        <div class="stage-msg break-words text-[13px]" style="color: rgb(209,213,219)">
                            {@html renderCustomEmojis(linkifyHtml(msg.content ?? ''), emojis)}
                        </div>
                    </div>
                </div>
            {/if}
        {/each}
    </div>

    <!-- Composeur -->
    <div class="shrink-0 p-3" style="border-top: 1px solid rgba(255,255,255,0.05)">
        <div class="flex items-center gap-2 rounded-lg px-3 py-2"
             style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07)">
            <button
                onclick={openRich}
                aria-label="Éditeur enrichi"
                title="Éditeur enrichi (mise en forme, liens, images…)"
                class="shrink-0 rounded-md p-1 transition-colors hover:bg-white/10"
                style="color: rgb(107,114,128)"
            >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>
                </svg>
            </button>
            <input
                bind:value={draft}
                onkeydown={onKeydown}
                placeholder="Écrire un message…"
                class="flex-1 bg-transparent text-[13px] text-gray-200 outline-none placeholder:text-gray-600"
            />
            <button
                onclick={send}
                disabled={!draft.trim()}
                aria-label="Envoyer"
                class="shrink-0 rounded-md p-1 transition-colors disabled:opacity-30"
                style="color: rgb(165,180,252)"
            >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12zm0 0h7.5"/>
                </svg>
            </button>
        </div>
    </div>
</div>

<!-- Éditeur riche : plein écran sur mobile, carte centrée sur desktop -->
{#if richOpen}
    <div class="fixed inset-0 z-[400] flex sm:items-center sm:justify-center sm:p-4"
         style="background: rgba(0,0,0,0.7); backdrop-filter: blur(4px)">
        <button class="absolute inset-0 cursor-default" aria-label="Fermer" onclick={closeRich}></button>
        <div class="relative flex h-full w-full flex-col overflow-hidden sm:h-auto sm:max-h-[80vh] sm:max-w-lg sm:rounded-2xl"
             style="background: #0a0a12; border: 1px solid rgb(var(--nx-accent-rgb) / 0.2)">
            <div class="flex shrink-0 items-center justify-between px-5 py-4"
                 style="border-bottom: 1px solid rgba(255,255,255,0.06)">
                <h3 class="text-sm font-bold text-white">{editingId ? 'Modifier le message' : 'Nouveau message'}</h3>
                <button onclick={closeRich} aria-label="Fermer"
                        class="rounded-lg p-1.5 text-gray-500 transition-colors hover:text-white">
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
                {#key editorKey}
                    <NodyxEditor
                        compact={false}
                        initialContent={richInitial}
                        onchange={(v) => { richContent = v }}
                    />
                {/key}
            </div>
            <div class="flex shrink-0 justify-end gap-3 px-5 py-4"
                 style="border-top: 1px solid rgba(255,255,255,0.06)">
                <button onclick={closeRich}
                        class="rounded-lg px-4 py-2 text-sm font-medium text-gray-200 transition-colors"
                        style="background: rgba(255,255,255,0.06)">
                    Annuler
                </button>
                <button onclick={sendRich} disabled={!richContent.trim()}
                        class="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-40"
                        style="background: rgb(79,70,229)">
                    {editingId ? 'Enregistrer' : 'Envoyer'}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Le contenu vient de l'éditeur (HTML assaini côté serveur) : on borne juste
       ce qui pourrait casser la colonne étroite du panneau. */
    .stage-msg :global(p)   { margin: 0; }
    .stage-msg :global(img) { max-width: 100%; height: auto; }
    .stage-msg :global(a)   { color: rgb(129,140,248); text-decoration: underline; }
    .stage-msg :global(pre) { overflow-x: auto; }
</style>
