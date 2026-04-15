<script lang="ts">
    import { onDestroy } from 'svelte'
    import {
        localScreenStore,
        remoteScreenStore,
        stopScreenShare,
        voiceStore,
    } from '$lib/voice'

    let { onclose }: { onclose: () => void } = $props()

    const localStream   = $derived($localScreenStore)
    const remoteScreens = $derived($remoteScreenStore)
    const peers         = $derived($voiceStore.peers)

    // ── Unified stream list ────────────────────────────────────────
    type StreamEntry = {
        id:       string
        username: string
        avatar:   string | null
        stream:   MediaStream
        isLocal:  boolean
    }

    const allStreams = $derived<StreamEntry[]>([
        ...[...remoteScreens.entries()].map(([socketId, stream]) => {
            const peer = peers.find(p => p.socketId === socketId)
            return {
                id:      socketId,
                username: peer?.username ?? 'Participant',
                avatar:   peer?.avatar ?? null,
                stream,
                isLocal:  false,
            }
        }),
        ...(localStream ? [{
            id:       'local',
            username: 'Vous',
            avatar:   null,
            stream:   localStream,
            isLocal:  true,
        }] : []),
    ])

    // Auto-close when stage becomes empty
    $effect(() => {
        if (allStreams.length === 0) onclose()
    })

    // ── Focus management ───────────────────────────────────────────
    let focusedId = $state<string | null>(null)

    $effect(() => {
        if (!focusedId || !allStreams.find(s => s.id === focusedId)) {
            // Prefer first remote stream over own local share
            const first = allStreams.find(s => !s.isLocal) ?? allStreams[0] ?? null
            focusedId = first?.id ?? null
        }
    })

    const focusedEntry = $derived(allStreams.find(s => s.id === focusedId) ?? null)
    const thumbnails   = $derived(allStreams.filter(s => s.id !== focusedId))

    // ── PiP mode ──────────────────────────────────────────────────
    let isPiP       = $state(false)
    let pipX        = $state(typeof window !== 'undefined' ? window.innerWidth - 344 : 16)
    let pipY        = $state(typeof window !== 'undefined' ? window.innerHeight - 224 : 16)
    let pipDragging = $state(false)
    let pipDragOffX = 0
    let pipDragOffY = 0

    function startPipDrag(e: MouseEvent) {
        pipDragging = true
        pipDragOffX = e.clientX - pipX
        pipDragOffY = e.clientY - pipY
        e.preventDefault()
    }
    function onWindowMouseMove(e: MouseEvent) {
        if (!pipDragging) return
        pipX = Math.max(0, Math.min(window.innerWidth  - 320, e.clientX - pipDragOffX))
        pipY = Math.max(0, Math.min(window.innerHeight - 190, e.clientY - pipDragOffY))
    }
    function onWindowMouseUp() { pipDragging = false }

    // ── Stream → <video> Svelte action ────────────────────────────
    function streamSrc(node: HTMLVideoElement, stream: MediaStream) {
        node.srcObject = stream
        return {
            update(s: MediaStream) { node.srcObject = s },
            destroy()             { node.srcObject = null },
        }
    }

    // ── Clip buffer (rolling 60s) ──────────────────────────────────
    let recorder:    MediaRecorder | null = null
    let clipsBuffer: Blob[]               = []
    let bufferSecs   = 0

    $effect(() => {
        if (localStream) _startRecording(localStream)
        else _stopRecording()
    })

    function _startRecording(stream: MediaStream) {
        _stopRecording()
        try {
            recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
            recorder.ondataavailable = (e: BlobEvent) => {
                if (e.data.size === 0) return
                clipsBuffer.push(e.data)
                bufferSecs += 5
                if (bufferSecs > 60) { clipsBuffer.shift(); bufferSecs -= 5 }
            }
            recorder.start(5000)
        } catch { /* codec not supported, skip */ }
    }

    function _stopRecording() {
        if (recorder?.state !== 'inactive') recorder?.stop()
        recorder = null; clipsBuffer = []; bufferSecs = 0
    }

    onDestroy(_stopRecording)

    // ── Actions ───────────────────────────────────────────────────
    let focusVideoElem: HTMLVideoElement | undefined = $state(undefined)

    function saveClip() {
        if (!clipsBuffer.length) return
        const blob = new Blob(clipsBuffer, { type: 'video/webm' })
        const url  = URL.createObjectURL(blob)
        const a    = Object.assign(document.createElement('a'), {
            href: url, download: `nodyx-clip-${Date.now()}.webm`, style: 'display:none'
        })
        document.body.appendChild(a)
        a.click()
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 100)
    }

    function takeSnapshot() {
        if (!focusVideoElem || !focusedEntry) return
        const canvas = document.createElement('canvas')
        canvas.width  = focusVideoElem.videoWidth
        canvas.height = focusVideoElem.videoHeight
        canvas.getContext('2d')?.drawImage(focusVideoElem, 0, 0)
        Object.assign(document.createElement('a'), {
            download: `nodyx-snap-${Date.now()}.png`,
            href:     canvas.toDataURL('image/png'),
        }).click()
    }

    function requestFullscreen() {
        focusVideoElem?.requestFullscreen?.()
    }

    function onKeydown(e: KeyboardEvent) {
        if (isPiP) return
        if (e.key === 'Escape') { e.stopPropagation(); onclose() }
        if (e.key === 'f' || e.key === 'F') requestFullscreen()
        if (e.key === 'p' || e.key === 'P') isPiP = true
    }
</script>

<svelte:window
    onkeydown={onKeydown}
    onmousemove={onWindowMouseMove}
    onmouseup={onWindowMouseUp}
/>

{#if !isPiP}

<!-- ═══════════════════════════════════════════════════════════════
     STAGE — plein écran
═══════════════════════════════════════════════════════════════════ -->
<div
    class="fixed inset-0 z-[500] flex flex-col animate-in fade-in duration-150"
    style="background: rgba(4,4,10,0.97)"
>

    <!-- Header ──────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between px-5 py-3 shrink-0"
         style="border-bottom: 1px solid rgba(255,255,255,0.05)">

        <!-- Left — identity + stream selector -->
        <div class="flex items-center gap-4 min-w-0">
            <!-- Brand -->
            <div class="flex items-center gap-2.5 shrink-0">
                <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <span class="text-[11px] font-bold text-white tracking-widest uppercase">Nodyx Stage</span>
            </div>
            <span class="text-[11px] text-gray-600 shrink-0">
                {allStreams.length} partage{allStreams.length > 1 ? 's' : ''} actif{allStreams.length > 1 ? 's' : ''}
            </span>

            <!-- Stream selector chips (2+ streams) -->
            {#if allStreams.length > 1}
                <div class="flex items-center gap-1.5 overflow-x-auto" style="scrollbar-width: none">
                    {#each allStreams as entry (entry.id)}
                        <button
                            onclick={() => focusedId = entry.id}
                            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0 transition-all"
                            style="
                                border: 1px solid {focusedId === entry.id ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.06)'};
                                background: {focusedId === entry.id ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)'};
                                color: {focusedId === entry.id ? 'rgb(165,180,252)' : 'rgb(107,114,128)'};
                            "
                        >
                            {#if entry.avatar}
                                <img src={entry.avatar} alt={entry.username} class="w-3.5 h-3.5 rounded-full object-cover"/>
                            {:else}
                                <div class="w-3.5 h-3.5 rounded-full bg-indigo-700 flex items-center justify-center text-[7px] font-bold text-white shrink-0">
                                    {entry.username[0].toUpperCase()}
                                </div>
                            {/if}
                            <span>{entry.username}</span>
                            {#if entry.isLocal}
                                <span class="text-[9px] font-bold" style="color: rgb(248,113,113)">VOUS</span>
                            {:else}
                                <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                            {/if}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Right — controls -->
        <div class="flex items-center gap-2 shrink-0">
            <button
                onclick={() => isPiP = true}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); color: rgb(156,163,175);"
                title="Mode PiP (P)"
            >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <rect x="12" y="10" width="8" height="5" rx="1"/>
                </svg>
                <span class="hidden sm:inline">PiP</span>
            </button>
            <button
                onclick={onclose}
                aria-label="Fermer le stage"
                class="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); color: rgb(107,114,128);"
            >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
    </div>

    <!-- Main area ───────────────────────────────────────────────── -->
    <div class="flex-1 flex min-h-0">

        <!-- Focus stream -->
        <div class="flex-1 relative flex items-center justify-center bg-black min-w-0">
            {#if focusedEntry}
                <!-- Username badge -->
                <div class="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full"
                     style="background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.07)">
                    {#if focusedEntry.avatar}
                        <img src={focusedEntry.avatar} alt={focusedEntry.username} class="w-5 h-5 rounded-full object-cover"/>
                    {:else}
                        <div class="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                            {focusedEntry.username[0].toUpperCase()}
                        </div>
                    {/if}
                    <span class="text-xs font-semibold text-white">{focusedEntry.username}</span>
                    {#if focusedEntry.isLocal}
                        <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style="background: rgba(239,68,68,0.15); color: rgb(252,165,165); border: 1px solid rgba(239,68,68,0.25)">
                            VOUS
                        </span>
                    {:else}
                        <div class="flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                            <span class="text-[10px] font-bold" style="color: rgb(74,222,128)">LIVE</span>
                        </div>
                    {/if}
                </div>

                <!-- Keyboard hint -->
                <div class="absolute top-4 right-4 z-10 text-[10px] select-none" style="color: rgba(255,255,255,0.12)">
                    F — plein écran · P — PiP · Esc — fermer
                </div>

                <!-- Main video — double-clic = plein écran -->
                <video
                    bind:this={focusVideoElem}
                    use:streamSrc={focusedEntry.stream}
                    autoplay playsinline muted
                    ondblclick={requestFullscreen}
                    class="w-full h-full object-contain cursor-pointer"
                    title="Double-clic pour plein écran"
                ></video>

                <!-- Bouton fullscreen permanent (coin bas-droit) -->
                <button
                    onclick={requestFullscreen}
                    class="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                           opacity-40 hover:opacity-100 transition-opacity duration-150"
                    style="background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.12); color: white; backdrop-filter: blur(4px);"
                    title="Plein écran (F)"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                    </svg>
                    <span class="text-xs font-medium">Plein écran</span>
                </button>

                <!-- Hover controls bar (actions secondaires) -->
                <div class="absolute bottom-0 left-0 right-0 px-6 py-4 flex justify-center gap-2.5
                            opacity-0 hover:opacity-100 transition-opacity duration-200 pointer-events-none"
                     style="background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.2), transparent)">

                    <button onclick={requestFullscreen} class="stage-ctrl" title="Plein écran (F)">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                        </svg>
                        <span>Plein écran</span>
                    </button>

                    {#if focusedEntry.isLocal}
                        <button onclick={takeSnapshot} class="stage-ctrl" title="Capture d'écran">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 10.07 4h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 18.07 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/>
                                <circle cx="12" cy="13" r="3"/>
                            </svg>
                            <span>Capture</span>
                        </button>
                        <button onclick={saveClip} class="stage-ctrl" title="Sauvegarder le dernier clip (60s)">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25z"/>
                            </svg>
                            <span>Clip 60s</span>
                        </button>
                        <button onclick={stopScreenShare} class="stage-ctrl-danger" title="Arrêter mon partage">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <rect x="2" y="3" width="20" height="14" rx="2"/>
                                <path d="M8 21h8M12 17v4"/>
                            </svg>
                            <span>Arrêter mon partage</span>
                        </button>
                    {/if}
                </div>

            {:else}
                <div class="flex flex-col items-center gap-3" style="color: rgba(255,255,255,0.15)">
                    <svg class="w-14 h-14" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
                        <rect x="2" y="3" width="20" height="14" rx="2"/>
                        <path d="M8 21h8M12 17v4"/>
                    </svg>
                    <p class="text-sm">Aucun partage actif</p>
                </div>
            {/if}
        </div>

        <!-- Thumbnail sidebar (shown when 2+ streams) -->
        {#if thumbnails.length > 0}
            <div class="w-48 xl:w-56 shrink-0 flex flex-col overflow-y-auto"
                 style="border-left: 1px solid rgba(255,255,255,0.04); background: rgba(4,4,10,0.6)">
                {#each thumbnails as entry, i (entry.id)}
                    {#if i > 0}
                        <div style="height: 1px; background: rgba(255,255,255,0.03); shrink-0"></div>
                    {/if}
                    <button
                        onclick={() => focusedId = entry.id}
                        class="relative aspect-video group overflow-hidden shrink-0 transition-all"
                        style="background: black;"
                        title="{entry.username} — cliquer pour mettre en avant"
                    >
                        <video
                            use:streamSrc={entry.stream}
                            autoplay playsinline muted
                            class="w-full h-full object-contain"
                        ></video>
                        <!-- Dim overlay -->
                        <div class="absolute inset-0 transition-colors"
                             style="background: rgba(0,0,0,0.45)"></div>
                        <!-- Name badge -->
                        <div class="absolute bottom-0 left-0 right-0 px-2 py-1.5 flex items-center gap-1.5"
                             style="background: linear-gradient(to top, rgba(0,0,0,0.75), transparent)">
                            <div class="w-4 h-4 rounded-full bg-indigo-700 flex items-center justify-center text-[7px] font-bold text-white shrink-0">
                                {entry.username[0].toUpperCase()}
                            </div>
                            <span class="text-[11px] text-white font-medium truncate">{entry.username}</span>
                            {#if !entry.isLocal}
                                <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse ml-auto shrink-0"></span>
                            {/if}
                        </div>
                        <!-- Focus hint on hover -->
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <div class="px-3 py-1 rounded-full text-[10px] text-white font-medium"
                                 style="background: rgba(79,70,229,0.75); backdrop-filter: blur(4px)">
                                Mettre en avant
                            </div>
                        </div>
                    </button>
                {/each}
            </div>
        {/if}

    </div>
</div>

{:else}

<!-- ═══════════════════════════════════════════════════════════════
     PiP — floating draggable card
═══════════════════════════════════════════════════════════════════ -->
<div
    class="fixed z-[500] rounded-xl overflow-hidden shadow-2xl select-none"
    style="
        left: {pipX}px;
        top:  {pipY}px;
        width: 320px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(6,6,12,0.96);
        backdrop-filter: blur(16px);
    "
    role="dialog"
    aria-label="Nodyx Stage — mode PiP"
>
    <!-- Drag handle / header -->
    <div
        class="flex items-center justify-between px-3 py-2.5"
        style="
            border-bottom: 1px solid rgba(255,255,255,0.06);
            cursor: {pipDragging ? 'grabbing' : 'grab'};
        "
        onmousedown={startPipDrag}
        role="toolbar"
        tabindex="0"
        aria-label="Déplacer le Stage"
    >
        <div class="flex items-center gap-2 pointer-events-none">
            <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            <span class="text-[11px] font-bold text-white tracking-wider uppercase">Stage</span>
            {#if allStreams.length > 1}
                <span class="text-[10px]" style="color: rgb(75,85,99)">
                    {focusedEntry?.username ?? ''} + {allStreams.length - 1} autre{allStreams.length > 2 ? 's' : ''}
                </span>
            {:else if focusedEntry}
                <span class="text-[10px]" style="color: rgb(75,85,99)">{focusedEntry.username}</span>
            {/if}
        </div>
        <!-- Prevent drag when clicking buttons -->
        <div class="flex items-center gap-1" role="presentation" onmousedown={(e) => e.stopPropagation()}>
            <button
                onclick={() => isPiP = false}
                class="w-6 h-6 flex items-center justify-center rounded transition-colors"
                style="color: rgb(107,114,128);"
                title="Agrandir"
            >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                </svg>
            </button>
            <button
                onclick={onclose}
                class="w-6 h-6 flex items-center justify-center rounded transition-colors"
                style="color: rgb(107,114,128);"
                aria-label="Fermer"
            >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
    </div>

    <!-- Main video -->
    <div class="relative bg-black" style="aspect-ratio: 16 / 9">
        {#if focusedEntry}
            <video
                use:streamSrc={focusedEntry.stream}
                autoplay playsinline muted
                class="w-full h-full object-contain"
            ></video>
            {#if !focusedEntry.isLocal}
                <div class="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full"
                     style="background: rgba(0,0,0,0.6)">
                    <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    <span class="text-[9px] font-bold text-white">LIVE</span>
                </div>
            {/if}
        {:else}
            <div class="w-full h-full flex items-center justify-center">
                <p class="text-[11px]" style="color: rgba(255,255,255,0.2)">Aucun partage</p>
            </div>
        {/if}
    </div>

    <!-- Thumbnail strip (2+ streams) -->
    {#if thumbnails.length > 0}
        <div class="flex overflow-x-auto" style="gap: 1px; scrollbar-width: none; background: rgba(255,255,255,0.03)">
            {#each thumbnails as entry (entry.id)}
                <button
                    onclick={() => focusedId = entry.id}
                    class="relative shrink-0 overflow-hidden group"
                    style="width: 100px; aspect-ratio: 16/9; background: black"
                    title={entry.username}
                >
                    <video
                        use:streamSrc={entry.stream}
                        autoplay playsinline muted
                        class="w-full h-full object-contain"
                    ></video>
                    <div class="absolute inset-0 transition-colors" style="background: rgba(0,0,0,0.4)"></div>
                    <div class="absolute bottom-0.5 left-1 text-[9px] font-medium drop-shadow truncate" style="color: rgba(255,255,255,0.85)">
                        {entry.username}
                    </div>
                </button>
            {/each}
        </div>
    {/if}
</div>

{/if}

<style>
    .stage-ctrl {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.8);
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 150ms ease;
        white-space: nowrap;
    }
    .stage-ctrl:hover {
        background: rgba(255,255,255,0.13);
        color: white;
        border-color: rgba(255,255,255,0.18);
    }

    .stage-ctrl-danger {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        background: rgba(239,68,68,0.12);
        border: 1px solid rgba(239,68,68,0.22);
        color: rgb(252,165,165);
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 150ms ease;
        white-space: nowrap;
    }
    .stage-ctrl-danger:hover {
        background: rgba(239,68,68,0.22);
        color: white;
    }
</style>
