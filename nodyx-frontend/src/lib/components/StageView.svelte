<script lang="ts">
    import { onDestroy } from 'svelte'
    import { browser } from '$app/environment'
    import {
        localScreenStore,
        remoteScreenStore,
        stopScreenShare,
        voiceStore,
        registerSinkElement,
    } from '$lib/voice'
    import StageChat from './StageChat.svelte'

    let { onclose }: { onclose: () => void } = $props()

    const localStream   = $derived($localScreenStore)
    const remoteScreens = $derived($remoteScreenStore)
    const peers         = $derived($voiceStore.peers)
    const channelId     = $derived($voiceStore.channelId)

    // ── Chat du salon dans la scène ───────────────────────────────────────────
    // OUVERT par défaut : on suit la conversation en regardant, sans avoir à
    // chercher un bouton. Une flèche le replie (et le rouvre). Le choix est
    // mémorisé : on ne le rouvre pas de force à celui qui l'a replié.
    let showChat = $state(
        !browser || localStorage.getItem('nodyx:stage:chat') !== '0',
    )
    $effect(() => {
        if (browser) {
            localStorage.setItem('nodyx:stage:chat', showChat ? '1' : '0')
        }
    })

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
    // ⚠ Réassigner srcObject réinitialise l'élément vidéo (l'algorithme de chargement
    // du média s'exécute MÊME pour le même objet) : image noire jusqu'à la keyframe
    // suivante. Le store étant republié souvent, ça donnait un clignotement rapide.
    function streamSrc(node: HTMLVideoElement, stream: MediaStream) {
        node.srcObject = stream
        return {
            update(s: MediaStream) {
                if (node.srcObject === s) return
                node.srcObject = s
            },
            destroy() { node.srcObject = null },
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

    // ── Son du partage (réglage spectateur) ───────────────────────────────────
    // Le son de l'écran arrive dans le MÊME MediaStream que l'image, mais le lire
    // via la <video autoplay> échoue sur mobile : le navigateur bloque le son d'une
    // vidéo autoplay non-mutée. On le sort donc par un <audio> DÉDIÉ, exactement
    // comme les voix : ce chemin est débloqué dès qu'on a rejoint le vocal (geste
    // utilisateur), donc il joue. La <video> reste muette (image seule) ; volume et
    // coupure visent le <audio>. Ça ne touche jamais aux voix (leurs propres <audio>).
    let screenAudioElem = $state<HTMLAudioElement | undefined>(undefined)
    let screenVolume = $state(100)   // 0..100, volume « maître » du son de l'écran
    let screenMuted  = $state(false)
    let hasScreenAudio = $state(false)   // le partage focalisé diffuse-t-il du son ?

    // Rattache le son de l'écran focalisé au <audio> dédié. Le son peut arriver
    // APRÈS l'image (l'ordre n'est pas garanti), addTrack() programmatique ne
    // déclenche pas l'event 'addtrack', et le miroir SFU dédpublie par référence de
    // stream : rien ne nous réveillerait. On sonde donc brièvement jusqu'à ce que la
    // piste apparaisse, puis on s'arrête (aucun son = on abandonne au bout de ~30 s).
    $effect(() => {
        const el = screenAudioElem
        const entry = focusedEntry
        if (!el) return
        if (!entry || entry.isLocal) { hasScreenAudio = false; try { el.srcObject = null } catch { /* rien */ } return }
        const stream = entry.stream
        const attach = (): boolean => {
            const tracks = stream.getAudioTracks()
            hasScreenAudio = tracks.length > 0
            if (tracks.length === 0) return false
            const cur = el.srcObject as MediaStream | null
            const same = !!cur && cur.getAudioTracks().length === tracks.length
                && tracks.every(t => !!cur.getTrackById(t.id))
            if (!same) {
                el.srcObject = new MediaStream(tracks)
                void el.play().catch(() => {})
            }
            return true
        }
        if (attach()) return
        let tries = 0
        const timer = setInterval(() => {
            if (attach() || ++tries > 60) clearInterval(timer)
        }, 500)
        return () => clearInterval(timer)
    })

    // Volume / coupure → le <audio> du partage.
    $effect(() => {
        const el = screenAudioElem
        if (!el) return
        el.volume = screenVolume / 100
        el.muted  = screenMuted
    })

    // Le son d'écran suit la sortie choisie (écouteur/haut-parleur), comme les voix.
    $effect(() => {
        const el = screenAudioElem
        if (!el) return
        return registerSinkElement(el)
    })

    // Filet de sécurité mobile : un clic sur une commande relance la lecture si le
    // navigateur l'avait bloquée (le clic EST le geste utilisateur qui débloque).
    function nudgeScreenAudio() { void screenAudioElem?.play().catch(() => {}) }

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
        // On tape un message ? Les raccourcis (F/P) ne doivent PAS se déclencher.
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
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
                                border: 1px solid {focusedId === entry.id ? 'rgb(var(--nx-accent-rgb) / 0.5)' : 'rgba(255,255,255,0.06)'};
                                background: {focusedId === entry.id ? 'rgb(var(--nx-accent-rgb) / 0.12)' : 'rgba(255,255,255,0.03)'};
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
                title="Fenêtre flottante (P) : la Scène vous suit quand vous naviguez ailleurs"
            >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <rect x="12" y="10" width="8" height="5" rx="1"/>
                </svg>
                <span class="hidden sm:inline">Fenêtre flottante</span>
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

        <!-- Colonne vidéo : la scène, et les miniatures EN BAS. La droite est
             réservée au chat : mettre les miniatures à droite les ferait se
             disputer la largeur avec lui et rétrécirait la vidéo pour rien. -->
        <div class="flex-1 flex flex-col min-w-0 min-h-0">

        <!-- Focus stream. min-h-0 + object-contain = la vidéo TIENT toujours dans
             la place disponible : jamais de scrollbar pour voir le bas. -->
        <div class="flex-1 relative flex items-center justify-center bg-black min-w-0 min-h-0">
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

                <!-- Raccourcis : ils étaient en opacité 0.12, donc invisibles (on ne
                     pouvait pas deviner « P »). Lisibles, et nommés en clair. -->
                <div class="absolute top-4 right-4 z-10 flex items-center gap-2.5 rounded-full px-3 py-1.5 text-[10px] select-none"
                     style="background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); backdrop-filter: blur(4px)">
                    <span><kbd class="stage-kbd">F</kbd> plein écran</span>
                    <span><kbd class="stage-kbd">P</kbd> fenêtre flottante</span>
                    <span><kbd class="stage-kbd">Échap</kbd> fermer</span>
                </div>

                <!-- Vidéo principale : double-clic = plein écran.
                     Le son de l'écran partagé vit DANS ce flux : c'est donc ici qu'il
                     sort. On coupe le son de SON PROPRE partage (on l'entend déjà en
                     vrai : le rejouer ferait un écho, voire un larsen). -->
                <video
                    bind:this={focusVideoElem}
                    use:streamSrc={focusedEntry.stream}
                    autoplay playsinline muted
                    ondblclick={requestFullscreen}
                    class="w-full h-full object-contain cursor-pointer"
                    title="Double-clic pour plein écran"
                ></video>
                <!-- Son du partage : sorti par un <audio> dédié (fiable sur mobile,
                     contrairement au son porté par la <video autoplay>). -->
                <audio bind:this={screenAudioElem} autoplay class="hidden"></audio>

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

                <!-- Son du partage (coin bas-gauche) : mute + volume, côté spectateur.
                     Pas pour son propre partage (on l'entend déjà en vrai). -->
                {#if !focusedEntry.isLocal}
                    <div class="absolute bottom-4 left-4 z-10 flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                                opacity-40 hover:opacity-100 transition-opacity duration-150"
                         style="background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.12); color: white; backdrop-filter: blur(4px);">
                        {#if hasScreenAudio}
                            <button
                                onclick={() => { screenMuted = !screenMuted; if (!screenMuted) nudgeScreenAudio() }}
                                class="shrink-0 hover:text-indigo-300 transition-colors"
                                title={screenMuted ? 'Réactiver le son du partage' : 'Couper le son du partage'}
                                aria-label={screenMuted ? 'Réactiver le son du partage' : 'Couper le son du partage'}
                            >
                                {#if screenMuted || screenVolume === 0}
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5 6 9H2v6h4l5 4V5z"/>
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M23 9l-6 6M17 9l6 6"/>
                                    </svg>
                                {:else}
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5 6 9H2v6h4l5 4V5z"/>
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                    </svg>
                                {/if}
                            </button>
                            <input
                                type="range" min="0" max="100" step="1"
                                bind:value={screenVolume}
                                oninput={() => { if (screenVolume > 0) { screenMuted = false; nudgeScreenAudio() } }}
                                class="stage-vol"
                                title="Volume du partage ({screenVolume}%)"
                                aria-label="Volume du partage"
                            />
                        {:else}
                            <svg class="w-4 h-4 shrink-0" style="color: rgba(255,255,255,0.5)" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M11 5 6 9H2v6h4l5 4V5z"/>
                                <path stroke-linecap="round" stroke-linejoin="round" d="M23 9l-6 6M17 9l6 6"/>
                            </svg>
                            <span class="text-xs" style="color: rgba(255,255,255,0.7)">Ce partage ne diffuse pas de son</span>
                        {/if}
                    </div>
                {/if}

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

        <!-- Miniatures des AUTRES partages, en bande horizontale. Hauteur FIXE :
             la scène garde toute la place, et 2, 3, 5 ou 10 partages défilent
             horizontalement sans jamais rogner la vidéo. -->
        {#if thumbnails.length > 0}
            <div class="shrink-0 flex gap-2 overflow-x-auto px-3 py-2"
                 style="border-top: 1px solid rgba(255,255,255,0.04); background: rgba(4,4,10,0.6); scrollbar-width: thin">
                {#each thumbnails as entry (entry.id)}
                    <button
                        onclick={() => focusedId = entry.id}
                        class="relative group shrink-0 overflow-hidden rounded-md transition-all"
                        style="height: 5.5rem; aspect-ratio: 16/9; background: black; border: 1px solid rgba(255,255,255,0.08)"
                        title="{entry.username} : mettre en avant"
                    >
                        <video
                            use:streamSrc={entry.stream}
                            autoplay playsinline muted
                            class="w-full h-full object-contain"
                        ></video>
                        <div class="absolute inset-0 transition-colors" style="background: rgba(0,0,0,0.45)"></div>
                        <div class="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-1.5 py-1"
                             style="background: linear-gradient(to top, rgba(0,0,0,0.8), transparent)">
                            <span class="truncate text-[10px] font-medium text-white">{entry.username}</span>
                            {#if !entry.isLocal}
                                <span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-green-400 animate-pulse"></span>
                            {/if}
                        </div>
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                            <span class="rounded-full px-2 py-0.5 text-[9px] font-medium text-white"
                                  style="background: rgba(79,70,229,0.8); backdrop-filter: blur(4px)">Mettre en avant</span>
                        </div>
                    </button>
                {/each}
            </div>
        {/if}

        </div><!-- /colonne vidéo -->

        <!-- Chat du salon : OUVERT par défaut, repliable d'une flèche. Replié, il
             laisse un onglet fin pour le rouvrir (on ne cherche pas un bouton). -->
        {#if channelId}
            {#if showChat}
                <div class="w-80 shrink-0 min-h-0 xl:w-96">
                    <StageChat channelId={channelId} oncollapse={() => showChat = false}/>
                </div>
            {:else}
                <button
                    onclick={() => showChat = true}
                    class="flex w-8 shrink-0 items-center justify-center transition-colors hover:bg-white/5"
                    style="background: rgba(6,6,12,0.75); border-left: 1px solid rgba(255,255,255,0.05); color: rgb(148,163,184)"
                    title="Afficher le chat du salon"
                    aria-label="Afficher le chat du salon"
                >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
                    </svg>
                </button>
            {/if}
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
            <!-- En fenêtre flottante aussi, on entend l'écran qu'on regarde (et jamais
                 le sien : ce serait un écho). -->
            <video
                use:streamSrc={focusedEntry.stream}
                autoplay playsinline
                muted={focusedEntry.isLocal}
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

    .stage-kbd {
        display: inline-block;
        min-width: 1.1rem;
        padding: 0 0.25rem;
        margin-right: 0.15rem;
        border-radius: 0.2rem;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.18);
        color: rgba(255,255,255,0.9);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px;
        line-height: 1.35;
        text-align: center;
    }

    /* Slider de volume du partage : piste fine, pouce accent Nodyx. */
    .stage-vol {
        -webkit-appearance: none;
        appearance: none;
        width: 84px;
        height: 4px;
        border-radius: 99px;
        background: rgba(255,255,255,0.22);
        cursor: pointer;
        outline: none;
    }
    .stage-vol::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--nx-accent-soft, #818cf8);
        border: 2px solid rgba(0,0,0,0.4);
    }
    .stage-vol::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--nx-accent-soft, #818cf8);
        border: 2px solid rgba(0,0,0,0.4);
    }
</style>
