<script lang="ts">
    // ── Chat du salon, DANS la scène ──────────────────────────────────────────
    //
    // Autonome par nécessité : les messages de la page chat sont un état LOCAL de
    // cette page. La scène vit au-dessus des pages (VoicePanel → +layout) et doit
    // donc pouvoir suivre le fil du salon même quand la page chat n'est pas montée
    // (fenêtre flottante, navigation ailleurs). Ce panneau rejoint donc lui-même la
    // room et écoute le live.
    //
    // ⚠ On n'émet JAMAIS `chat:leave` : la page chat gère son propre cycle de vie,
    // un leave émis d'ici la sortirait de la room et lui couperait ses messages.

    import { socket } from '$lib/socket'
    import { linkifyHtml } from '$lib/linkify'
    import { renderCustomEmojis, customEmojisStore } from '$lib/customEmojis'

    let { channelId, channelName = '' }: { channelId: string; channelName?: string } = $props()

    type StageMessage = {
        id:              string
        channel_id:      string
        author_username: string
        author_avatar:   string | null
        content:         string | null
        created_at:      string
        is_deleted?:     boolean
    }

    let messages = $state<StageMessage[]>([])
    let draft    = $state('')
    let listEl   = $state<HTMLDivElement | null>(null)

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
        sock.on('chat:history', onHistory)
        sock.on('chat:message', onMessage)

        return () => {
            sock.off('chat:history', onHistory)
            sock.off('chat:message', onMessage)
        }
    })

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
    </div>

    <!-- Fil -->
    <div bind:this={listEl} class="flex-1 space-y-3 overflow-y-auto px-4 py-3" style="scrollbar-width: thin">
        {#if messages.length === 0}
            <p class="pt-6 text-center text-xs" style="color: rgba(255,255,255,0.25)">
                Aucun message pour l'instant.
            </p>
        {/if}
        {#each messages as msg (msg.id)}
            {#if !msg.is_deleted && msg.content}
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
        <div class="flex items-end gap-2 rounded-lg px-3 py-2"
             style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07)">
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

<style>
    /* Le contenu vient de l'éditeur (HTML assaini côté serveur) : on borne juste
       ce qui pourrait casser la colonne étroite du panneau. */
    .stage-msg :global(p)   { margin: 0; }
    .stage-msg :global(img) { max-width: 100%; height: auto; }
    .stage-msg :global(a)   { color: rgb(129,140,248); text-decoration: underline; }
    .stage-msg :global(pre) { overflow-x: auto; }
</style>
