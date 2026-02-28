<script lang='ts'>
    import {
        voiceStore, leaveVoice, toggleMute, toggleDeafen, togglePTTMode,
        startPTT, stopPTT, inputLevel, setPeerVolume,
        peerStatsStore, getQuality,
        type VoicePeer, type PeerStats, type NetQuality,
    } from '$lib/voice'

    import MediaCenter    from './MediaCenter.svelte'
    import VoiceSettings from './VoiceSettings.svelte'
    import { onMount } from 'svelte'

    let showMediaHub      = $state(false)
    let showVoiceSettings = $state(false)

    const vs       = $derived($voiceStore)
    const peers    = $derived(vs.peers)
    const muted    = $derived(vs.muted)
    const deafened = $derived(vs.deafened)
    const pttMode  = $derived(vs.pttMode)
    const level    = $derived($inputLevel)
    const statsMap = $derived($peerStatsStore)

    const levelColor = $derived(
        level > 70 ? 'bg-red-500' :
        level > 35 ? 'bg-yellow-400' :
        level > 8  ? 'bg-green-500' :
        'bg-gray-600'
    )

    // ── Popup état ────────────────────────────────────────────────
    let selectedPeer: VoicePeer | null = $state(null)
    let peerVolumes: Record<string, number> = $state({})

    function openPeerPanel(peer: VoicePeer) {
        selectedPeer = selectedPeer?.socketId === peer.socketId ? null : peer
        if (!(peer.socketId in peerVolumes)) peerVolumes[peer.socketId] = 100
    }

    function closePanel() { selectedPeer = null }

    function onVolumeChange(socketId: string, v: number) {
        peerVolumes[socketId] = v
        setPeerVolume(socketId, v / 100)
    }

    // ── Qualité réseau ────────────────────────────────────────────

    const QUALITY_LABELS: Record<NetQuality, string> = {
        excellent: 'Excellent',
        good:      'Bon',
        fair:      'Moyen',
        poor:      'Mauvais',
        unknown:   'Inconnu',
    }

    function qualityBars(q: NetQuality): number {
        return { excellent: 4, good: 3, fair: 2, poor: 1, unknown: 0 }[q]
    }

    function fmtRtt(v: number | null): string   { return v === null ? '—' : `${v} ms` }
    function fmtLoss(v: number | null): string  { return v === null ? '—' : `${v} %` }
    function fmtJitter(v: number | null): string { return v === null ? '—' : `${v} ms` }

    // Inline dot color — safe for Tailwind v4 scanner
    function qualityDotClass(q: NetQuality): string {
        if (q === 'excellent') return 'bg-green-400'
        if (q === 'good')      return 'bg-lime-400'
        if (q === 'fair')      return 'bg-yellow-400'
        if (q === 'poor')      return 'bg-red-500'
        return 'bg-gray-500'
    }
    function qualityBarClass(q: NetQuality, active: boolean): string {
        if (!active) return 'bg-gray-700'
        if (q === 'excellent') return 'bg-green-400'
        if (q === 'good')      return 'bg-lime-400'
        if (q === 'fair')      return 'bg-yellow-400'
        if (q === 'poor')      return 'bg-red-500'
        return 'bg-gray-600'
    }
    function qualityTextClass(q: NetQuality): string {
        if (q === 'poor')    return 'text-red-400'
        if (q === 'fair')    return 'text-yellow-400'
        if (q === 'unknown') return 'text-gray-500'
        return 'text-green-400'
    }

    // ── Tooltip avec position fixed ─────────────────────────────────
    let hoveredPeer = $state<string | null>(null)
    let peerRects = $state<Record<string, DOMRect>>({})

    function updatePeerRect(socketId: string, element: HTMLElement) {
        const rect = element.getBoundingClientRect()
        peerRects[socketId] = rect
    }

    function onMouseEnter(peer: VoicePeer, event: MouseEvent) {
        hoveredPeer = peer.socketId
        const element = event.currentTarget as HTMLElement
        updatePeerRect(peer.socketId, element)
    }

    function onMouseLeave() {
        hoveredPeer = null
    }

    function updateAllRects() {
        if (hoveredPeer) {
            peers.forEach(peer => {
                const element = document.querySelector(`[data-peer-id="${peer.socketId}"]`)
                if (element) {
                    updatePeerRect(peer.socketId, element as HTMLElement)
                }
            })
        }
    }

    onMount(() => {
        window.addEventListener('scroll', updateAllRects, true)
        window.addEventListener('resize', updateAllRects)
        return () => {
            window.removeEventListener('scroll', updateAllRects, true)
            window.removeEventListener('resize', updateAllRects)
        }
    })
</script>

{#if vs.active}
    {#if selectedPeer !== null}
        {@const selPeer = selectedPeer}
        {@const stats   = statsMap.get(selPeer.socketId)}
        {@const quality = getQuality(stats)}
        {@const bars    = qualityBars(quality)}
        {@const vol     = peerVolumes[selPeer.socketId] ?? 100}

        <!-- Overlay de fermeture -->
        <div
            class='fixed inset-0 z-40 backdrop-blur-sm bg-black/20'
            role='button' tabindex='-1'
            onclick={closePanel}
            onkeydown={e => e.key === 'Escape' && closePanel()}
            aria-label='Fermer le panneau'
        ></div>

        <!-- Panneau popup -->
        <div class='fixed bottom-16 left-1/2 -translate-x-1/2 z-50 w-72 rounded-2xl 
                    bg-gradient-to-b from-gray-900 to-gray-950 
                    border border-indigo-500/30 shadow-2xl shadow-indigo-500/20 
                    overflow-hidden backdrop-blur-sm
                    animate-in fade-in slide-in-from-bottom-4 duration-300'>
            
            <!-- Ligne de lumière en haut -->
            <div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>

            <!-- En-tête avec avatar -->
            <div class='flex items-center gap-3 px-4 pt-4 pb-3 border-b border-gray-800/60'>
                {#if selPeer.avatar}
                    <img src={selPeer.avatar} alt={selPeer.username}
                        class='w-11 h-11 rounded-full object-cover ring-2 {qualityDotClass(quality)} 
                               shadow-lg shadow-indigo-500/30 transform hover:scale-110 transition-transform duration-300'/>
                {:else}
                    <div class='w-11 h-11 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 
                                flex items-center justify-center text-sm font-bold text-white 
                                ring-2 {qualityDotClass(quality)} shadow-lg shadow-indigo-500/30
                                transform hover:scale-110 transition-transform duration-300'>
                        {selPeer.username.charAt(0).toUpperCase()}
                    </div>
                {/if}
                
                <div class='flex-1 min-w-0'>
                    <p class='text-sm font-semibold text-white truncate flex items-center gap-2'>
                        {selPeer.username}
                        {#if stats?.connectionType === 'direct'}
                            <span class='text-[8px] px-1.5 py-0.5 rounded-full bg-green-900/60 text-green-400 border border-green-700/50'>P2P</span>
                        {:else if stats?.connectionType === 'relay'}
                            <span class='text-[8px] px-1.5 py-0.5 rounded-full bg-blue-900/60 text-blue-400 border border-blue-700/50'>TURN</span>
                        {/if}
                    </p>
                    
                    <div class='flex items-center gap-1.5 mt-0.5'>
                        <div class='flex items-end gap-0.5 h-3'>
                            {#each [1,2,3,4] as bar}
                                <div class='w-1 rounded-sm transition-all duration-300 {qualityBarClass(quality, bar <= bars)} 
                                            transform origin-bottom hover:scale-y-125'
                                    style='height: {bar * 25}%'></div>
                            {/each}
                        </div>
                        <span class='text-xs {qualityTextClass(quality)} font-medium'>
                            {QUALITY_LABELS[quality]}
                        </span>
                    </div>
                </div>
                
                <button
                    onclick={closePanel}
                    aria-label='Fermer'
                    class='text-gray-500 hover:text-white hover:bg-gray-800/60 rounded-lg p-1.5 transition-all duration-200 transform hover:scale-110'
                >
                    <svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2.5'>
                        <path stroke-linecap='round' stroke-linejoin='round' d='M6 18L18 6M6 6l12 12'/>
                    </svg>
                </button>
            </div>

            <!-- Stats réseau -->
            <div class='px-4 py-3 space-y-1.5 border-b border-gray-800/60'>
                <p class='text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2'>
                    <span class="w-1 h-1 rounded-full bg-indigo-400 animate-pulse"></span>
                    Réseau
                </p>

                <div class='grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs'>
                    <div class='flex justify-between group hover:bg-gray-800/40 p-1 rounded transition-colors'>
                        <span class='text-gray-400'>Votre ping</span>
                        <span class='font-mono text-white group-hover:text-indigo-400 transition-colors'>{fmtRtt(stats?.rtt ?? null)}</span>
                    </div>
                    <div class='flex justify-between group hover:bg-gray-800/40 p-1 rounded transition-colors'>
                        <span class='text-gray-400'>Leur ping</span>
                        <span class='font-mono text-white group-hover:text-indigo-400 transition-colors'>{fmtRtt(stats?.theirRtt ?? null)}</span>
                    </div>
                    <div class='flex justify-between group hover:bg-gray-800/40 p-1 rounded transition-colors'>
                        <span class='text-gray-400'>Perte paquets</span>
                        <span class='font-mono {(stats?.packetLoss ?? 0) > 5 ? "text-red-400" : "text-white group-hover:text-indigo-400"}'>{fmtLoss(stats?.packetLoss ?? null)}</span>
                    </div>
                    <div class='flex justify-between group hover:bg-gray-800/40 p-1 rounded transition-colors'>
                        <span class='text-gray-400'>Gigue</span>
                        <span class='font-mono {(stats?.jitter ?? 0) > 30 ? "text-yellow-400" : "text-white group-hover:text-indigo-400"}'>{fmtJitter(stats?.jitter ?? null)}</span>
                    </div>
                </div>

                <div class='flex items-center justify-between pt-1 mt-1 border-t border-gray-800/40'>
                    <span class='text-xs text-gray-400'>Connexion</span>
                    {#if stats?.connectionType === 'relay'}
                        <span class='text-[10px] px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 font-medium border border-blue-700/50 flex items-center gap-1'>
                            <span class="w-1 h-1 rounded-full bg-blue-400 animate-pulse"></span>
                            Relay TURN
                        </span>
                    {:else if stats?.connectionType === 'direct'}
                        <span class='text-[10px] px-2 py-0.5 rounded-full bg-green-900/60 text-green-300 font-medium border border-green-700/50 flex items-center gap-1'>
                            <span class="w-1 h-1 rounded-full bg-green-400 animate-pulse"></span>
                            Direct P2P
                        </span>
                    {:else}
                        <span class='text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 font-medium border border-gray-700'>
                            Inconnu
                        </span>
                    {/if}
                </div>
            </div>

            <!-- Volume -->
            <div class='px-4 py-3 border-b border-gray-800/60 group'>
                <div class='flex items-center justify-between mb-1.5'>
                    <span class='text-xs text-gray-400 group-hover:text-indigo-400 transition-colors'>Volume local</span>
                    <span class='text-xs font-mono text-white bg-gray-800 px-2 py-0.5 rounded-full border border-gray-700 group-hover:border-indigo-500/50 transition-all'>
                        {vol}%
                    </span>
                </div>
                <input
                    type='range' min='0' max='150' step='5'
                    value={vol}
                    oninput={e => onVolumeChange(selPeer.socketId, Number((e.target as HTMLInputElement).value))}
                    class='w-full h-2 appearance-none rounded-full bg-gray-700 
                           accent-indigo-500 cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none
                           [&::-webkit-slider-thumb]:w-4
                           [&::-webkit-slider-thumb]:h-4
                           [&::-webkit-slider-thumb]:rounded-full
                           [&::-webkit-slider-thumb]:bg-gradient-to-r
                           [&::-webkit-slider-thumb]:from-indigo-500
                           [&::-webkit-slider-thumb]:to-violet-500
                           [&::-webkit-slider-thumb]:shadow-lg
                           [&::-webkit-slider-thumb]:shadow-indigo-500/50
                           [&::-webkit-slider-thumb]:border-2
                           [&::-webkit-slider-thumb]:border-white/20
                           [&::-webkit-slider-thumb]:hover:scale-125
                           [&::-webkit-slider-thumb]:transition-all
                           [&::-webkit-slider-thumb]:duration-200'
                />
            </div>

            <!-- Actions -->
            <div class='px-3 py-3 flex gap-2'>
                <a
                    href='/users/{selPeer.username}'
                    onclick={closePanel}
                    class='flex-1 flex items-center justify-center gap-1.5 py-2 
                           rounded-lg bg-gray-800/80 hover:bg-indigo-600/80 
                           text-gray-300 hover:text-white text-xs font-medium 
                           transition-all duration-200 transform hover:scale-105 active:scale-95
                           border border-gray-700 hover:border-indigo-500/50
                           shadow-lg hover:shadow-indigo-500/20'
                >
                    <svg xmlns='http://www.w3.org/2000/svg' class='w-3.5 h-3.5' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'>
                        <path stroke-linecap='round' stroke-linejoin='round' d='M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'/>
                    </svg>
                    Profil
                </a>
                <a
                    href='/chat?dm={selPeer.username}'
                    onclick={closePanel}
                    class='flex-1 flex items-center justify-center gap-1.5 py-2 
                           rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 
                           hover:from-indigo-500 hover:to-violet-500
                           text-white text-xs font-bold uppercase tracking-wider
                           transition-all duration-200 transform hover:scale-105 active:scale-95
                           border border-indigo-400/30 shadow-lg shadow-indigo-600/30
                           hover:shadow-indigo-500/50'
                >
                    <svg xmlns='http://www.w3.org/2000/svg' class='w-3.5 h-3.5' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'>
                        <path stroke-linecap='round' stroke-linejoin='round' d='M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'/>
                    </svg>
                    Message
                </a>
            </div>
        </div>
    {/if}

    <!-- Barre vocale flottante -->
    <div class='fixed bottom-0 left-0 lg:left-[220px] right-0 z-40 pointer-events-none'>
        <div class='mx-auto max-w-4xl px-4 pb-2 pointer-events-auto'>
            <div class='relative group'>
                <!-- Effet de glow externe -->
                <div class="absolute -inset-1 bg-gradient-to-r from-indigo-600/20 to-violet-600/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                
                <!-- Barre principale -->
                <div class='relative flex items-center gap-3 rounded-xl
                            bg-gradient-to-r from-gray-900/95 via-gray-900/95 to-gray-900/95
                            border border-indigo-500/30 shadow-2xl backdrop-blur-md
                            px-4 py-3
                            transition-all duration-300 hover:border-indigo-500/50'>
                    
                    <!-- Effets de lumière animés -->
                    <div class="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-transparent to-purple-500/5"></div>
                    <div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
                    <div class="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent"></div>

                    <!-- Info vocale + niveau -->
                    <div class='flex items-center gap-3 min-w-0 flex-1'>
                        <div class="relative">
                            <span class='w-2.5 h-2.5 rounded-full shrink-0 
                                         {level > 8 && !muted ? "bg-green-400 animate-pulse shadow-lg shadow-green-500/50" : "bg-gray-600"}'></span>
                            {#if level > 8 && !muted}
                                <span class="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75"></span>
                            {/if}
                        </div>
                        
                        <span class='text-xs text-green-300 font-medium truncate flex items-center gap-1'>
                            <span class="hidden sm:inline">Vocal ·</span> 
                            {peers.length + 1} participant{peers.length > 0 ? 's' : ''}
                        </span>
                        
                        <div class='w-16 h-2 bg-gray-800 rounded-full overflow-hidden shrink-0 ring-1 ring-gray-700'>
                            <div 
                                class='h-full rounded-full transition-all duration-75 relative overflow-hidden
                                       {levelColor}'
                                style='width: {level}%; box-shadow: 0 0 10px currentColor;'
                            >
                                <!-- Effet de brillance sur la barre -->
                                <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Avatars des participants - Version avec tooltip fixed -->
                    <div class='flex items-center -space-x-2 relative' style="z-index: 50; overflow: visible;">
                        {#each peers.slice(0, 6) as peer (peer.socketId)}
                            {@const pStats   = statsMap.get(peer.socketId)}
                            {@const pQuality = getQuality(pStats)}
                            <button
                                onclick={() => openPeerPanel(peer)}
                                onmouseenter={(e) => onMouseEnter(peer, e)}
                                onmouseleave={onMouseLeave}
                                data-peer-id={peer.socketId}
                                class='relative focus:outline-none hover:z-20 group/avatar transition-all duration-200'
                                style="z-index: {10 + peers.indexOf(peer)};"
                                title='{peer.username} — cliquer pour les détails'
                            >
                                {#if peer.avatar}
                                    <img
                                        src={peer.avatar}
                                        alt={peer.username}
                                        class='w-8 h-8 rounded-full object-cover border-2 border-gray-900 
                                               transition-all duration-300 transform 
                                               hover:scale-125 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/50
                                               ring-2 {peer.speaking 
                                                   ? "ring-green-400 ring-offset-1 ring-offset-gray-800 speaking-active small-avatar" 
                                                   : "ring-gray-700 group-hover/avatar:ring-indigo-400/50"}'
                                    />
                                {:else}
                                    <div class='w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 
                                                border-2 border-gray-900 flex items-center justify-center 
                                                text-[10px] font-bold text-white transition-all duration-300
                                                hover:scale-125 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/50
                                                ring-2 {peer.speaking 
                                                    ? "ring-green-400 ring-offset-1 ring-offset-gray-800 speaking-active small-avatar" 
                                                    : "ring-gray-700 group-hover/avatar:ring-indigo-400/50"}'>
                                        {peer.username.charAt(0).toUpperCase()}
                                    </div>
                                {/if}
                                
                                <!-- Point de qualité réseau -->
                                <span class='absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900 
                                             {qualityDotClass(pQuality)} animate-pulse'></span>
                            </button>
                        {/each}
                        
                        {#if peers.length > 6}
                            <div class='relative w-8 h-8 rounded-full 
                                        bg-gradient-to-br from-gray-700 to-gray-800 
                                        border-2 border-gray-900 flex items-center justify-center 
                                        text-[10px] text-gray-300 font-medium
                                        hover:scale-110 transition-transform duration-200
                                        ring-1 ring-gray-600'
                                 style="z-index: 5;">
                                +{peers.length - 6}
                            </div>
                        {/if}
                    </div>

                    <!-- Tooltip avec position fixed - Version qui dépasse TOUT -->
                    {#if hoveredPeer}
                        {@const peer = peers.find(p => p.socketId === hoveredPeer)}
                        {@const rect = peerRects[hoveredPeer]}
                        {#if peer && rect}
                            <div 
                                class="fixed bg-gray-900 text-white text-[10px] py-1.5 px-3 rounded 
                                       border border-indigo-500/50 whitespace-nowrap shadow-2xl
                                       font-medium tracking-wide z-[99999] pointer-events-none
                                       backdrop-blur-sm bg-opacity-95"
                                style="left: {rect.left + rect.width/2}px; 
                                       top: {rect.top - 30}px;
                                       transform: translateX(-50%);
                                       box-shadow: 0 0 15px rgba(99, 102, 241, 0.3);"
                            >
                                <span class="flex items-center gap-1.5">
                                    <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                    {peer.username}
                                </span>
                                <!-- Petite flèche -->
                                <div class="absolute left-1/2 -translate-x-1/2 top-full mt-[-2px] 
                                            w-2 h-2 bg-gray-900 border-r border-b border-indigo-500/50 
                                            transform rotate-45"
                                     style="box-shadow: 2px 2px 5px rgba(0,0,0,0.2);">
                                </div>
                            </div>
                        {/if}
                    {/if}

                    <!-- Contrôles -->
                    <div class='flex items-center gap-1 shrink-0' style="z-index: 100;">

                        <!-- Media Center -->
                        <button
                            onclick={() => showMediaHub = !showMediaHub}
                            class='p-2 rounded-lg transition-all duration-200 transform hover:scale-110 active:scale-95 relative
                                   {showMediaHub
                                       ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/50 ring-2 ring-indigo-400/50'
                                       : 'bg-gray-800/80 text-gray-300 hover:text-white hover:bg-gray-700 hover:shadow-lg hover:shadow-indigo-500/20 border border-gray-700 hover:border-indigo-500/30'}'
                            title="Partage d'écran & Capture"
                            style="pointer-events: auto; position: relative; z-index: 102;"
                        >
                            <span class="text-sm block {showMediaHub ? 'animate-pulse' : ''}">🖥️</span>
                        </button>

                        <!-- Mute -->
                        <button
                            onclick={toggleMute}
                            class='p-2 rounded-lg transition-all duration-200 transform hover:scale-110 active:scale-95 relative
                                   {muted 
                                       ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-900/50 ring-1 ring-red-700/50 animate-pulse' 
                                       : 'bg-gray-800/80 text-gray-300 hover:text-white hover:bg-gray-700 hover:shadow-lg hover:shadow-indigo-500/20 border border-gray-700 hover:border-indigo-500/30'}'
                            title={muted ? 'Réactiver le micro' : 'Couper le micro'}
                            style="pointer-events: auto; position: relative; z-index: 101;"
                        >
                            {#if muted}
                                <svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'>
                                    <line x1='1' y1='1' x2='23' y2='23'/>
                                    <path d='M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6'/>
                                    <path d='M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23'/>
                                    <line x1='12' y1='19' x2='12' y2='23'/><line x1='8' y1='23' x2='16' y2='23'/>
                                </svg>
                            {:else}
                                <svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'>
                                    <path d='M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z'/>
                                    <path d='M19 10v2a7 7 0 0 1-14 0v-2'/>
                                    <line x1='12' y1='19' x2='12' y2='23'/><line x1='8' y1='23' x2='16' y2='23'/>
                                </svg>
                            {/if}
                        </button>

                        <!-- Deafen -->
                        <button
                            onclick={toggleDeafen}
                            class='p-2 rounded-lg transition-all duration-200 transform hover:scale-110 active:scale-95 relative
                                   {deafened 
                                       ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-900/50 ring-1 ring-red-700/50 animate-pulse' 
                                       : 'bg-gray-800/80 text-gray-300 hover:text-white hover:bg-gray-700 hover:shadow-lg hover:shadow-indigo-500/20 border border-gray-700 hover:border-indigo-500/30'}'
                            title={deafened ? 'Réactiver le son' : 'Se rendre sourd'}
                            style="pointer-events: auto; position: relative; z-index: 101;"
                        >
                            <svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'>
                                <path d='M3 18v-6a9 9 0 0 1 18 0v6'/>
                                <path d='M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'/>
                            </svg>
                        </button>

                        <!-- PTT Mode -->
                        <button
                            onclick={togglePTTMode}
                            class='p-2 rounded-lg transition-all duration-200 transform hover:scale-110 active:scale-95 relative
                                   {pttMode 
                                       ? 'bg-gradient-to-r from-orange-600 to-orange-500 text-white shadow-lg shadow-orange-900/50 ring-1 ring-orange-700/50' 
                                       : 'bg-gray-800/80 text-gray-300 hover:text-white hover:bg-gray-700 hover:shadow-lg hover:shadow-indigo-500/20 border border-gray-700 hover:border-indigo-500/30'}'
                            title='Push-to-Talk (Alt pour parler)'
                            style="pointer-events: auto; position: relative; z-index: 101;"
                        >
                            <svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'>
                                <path stroke-linecap='round' stroke-linejoin='round' d='M19 11a7 7 0 0 1-7 7m0 0a7 7 0 0 1-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 0 1-3-3V5a3 3 0 0 1 6 0v6a3 3 0 0 1-3 3z'/>
                            </svg>
                        </button>

                        <!-- Bouton PARLER (PTT) -->
                        {#if pttMode}
                            <button
                                onmousedown={startPTT}
                                onmouseup={stopPTT}
                                onmouseleave={stopPTT}
                                class='px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-wider select-none
                                       transition-all duration-150 transform active:scale-95 relative
                                       bg-gradient-to-r from-orange-600 to-orange-500
                                       hover:from-orange-500 hover:to-orange-400
                                       active:from-orange-700 active:to-orange-600
                                       text-white shadow-lg shadow-orange-900/50
                                       ring-1 ring-orange-400/50 hover:ring-orange-300/50
                                       flex items-center gap-1.5'
                                style="text-shadow: 0 1px 2px rgba(0,0,0,0.3); pointer-events: auto; position: relative; z-index: 101;"
                            >
                                <span class="text-sm">🎤</span>
                                <span class="hidden sm:inline">PARLER</span>
                            </button>
                        {/if}

                        <!-- ⚙️ Paramètres son -->
                        <button
                            onclick={() => { showVoiceSettings = !showVoiceSettings; showMediaHub = false }}
                            class='px-2 py-1.5 rounded-lg transition-all duration-200 transform hover:scale-110 active:scale-95 relative
                                   flex items-center gap-1
                                   {showVoiceSettings
                                       ? "bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-500/50 ring-2 ring-amber-400/50"
                                       : "bg-gray-800/80 text-gray-300 hover:text-white hover:bg-gray-700 border border-gray-700 hover:border-amber-500/30"}'
                            title="Paramètres son & micro"
                            style="pointer-events: auto; position: relative; z-index: 102;"
                        >
                            <span class="text-base leading-none">⚙️</span>
                            <span class="text-[11px] font-medium">Son</span>
                        </button>

                        <!-- Séparateur -->
                        <div class='w-px h-6 bg-gradient-to-b from-transparent via-gray-700 to-transparent mx-1' style="pointer-events: none;"></div>

                        <!-- Quitter -->
                        <button
                            onclick={leaveVoice}
                            class='px-3 py-1.5 rounded-lg font-bold text-xs uppercase tracking-wider
                                   transition-all duration-200 transform hover:scale-105 active:scale-95 relative
                                   bg-gradient-to-r from-red-600 to-red-500
                                   hover:from-red-500 hover:to-red-400
                                   active:from-red-700 active:to-red-600
                                   text-white shadow-lg shadow-red-900/50
                                   flex items-center gap-1.5
                                   ring-1 ring-red-700/50 hover:ring-red-600/50'
                            title='Quitter le salon vocal'
                            style="pointer-events: auto; position: relative; z-index: 101;"
                        >
                            <svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2.5'>
                                <path stroke-linecap='round' stroke-linejoin='round' d='M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1'/>
                            </svg>
                            <span class="hidden sm:inline">Quitter</span>
                        </button>
                    </div>
                </div>

                <!-- ── MediaCenter popup ─────────────────────────────────────────
                     IMPORTANT : placé ICI, en dehors du div overflow-hidden de la
                     barre principale, mais toujours à l'intérieur du div.relative
                     parent, pour que absolute bottom-full soit visible.
                ─────────────────────────────────────────────────────────────── -->
                {#if showMediaHub}
                    <div class="absolute bottom-full mb-2 right-0 w-[400px] z-[200]
                                animate-in fade-in slide-in-from-bottom-4 duration-300"
                         style="pointer-events: auto;">
                        <div class="relative bg-gradient-to-b from-gray-900 to-gray-950
                                    border border-indigo-500/30 rounded-2xl shadow-2xl shadow-indigo-500/20
                                    overflow-hidden backdrop-blur-md">
                            <div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>
                            <MediaCenter />
                            <button
                                onclick={() => showMediaHub = false}
                                class="absolute top-4 right-4 text-gray-500 hover:text-white
                                       bg-black/40 w-7 h-7 rounded-full flex items-center justify-center
                                       backdrop-blur-sm border border-gray-700 hover:border-indigo-500/50
                                       transition-all duration-200 hover:scale-110"
                                style="pointer-events: auto; z-index: 201;"
                            >
                                <span class="text-sm">✕</span>
                            </button>
                        </div>
                    </div>
                {/if}

                <!-- ── VoiceSettings popup ────────────────────────────────────── -->
                {#if showVoiceSettings}
                    <div class="absolute bottom-full mb-2 right-0 w-[340px] z-[200]
                                animate-in fade-in slide-in-from-bottom-4 duration-300"
                         style="pointer-events: auto;">
                        <div class="relative bg-gradient-to-b from-gray-900 to-gray-950
                                    border border-amber-500/30 rounded-2xl shadow-2xl shadow-amber-500/10
                                    overflow-hidden backdrop-blur-md">
                            <div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500 to-transparent"></div>
                            <VoiceSettings />
                            <button
                                onclick={() => showVoiceSettings = false}
                                class="absolute top-4 right-4 text-gray-500 hover:text-white
                                       bg-black/40 w-7 h-7 rounded-full flex items-center justify-center
                                       backdrop-blur-sm border border-gray-700 hover:border-amber-500/50
                                       transition-all duration-200 hover:scale-110"
                                style="pointer-events: auto; z-index: 201;"
                            >
                                <span class="text-sm">✕</span>
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
/* ==============================================
   ANIMATION VOCALE – HALO NEXUS (VERSION UNIFIÉE)
   Tous les avatars, petits et grands, ont le même effet
   ============================================== */

/* Classe de base pour tous les avatars qui parlent */
.speaking-active {
    position: relative;
    z-index: 10;
    /* Ombre subtile qui suit l'avatar */
    filter: drop-shadow(0 0 12px rgba(168, 85, 247, 0.8));
    transition: filter 0.2s ease;
    /* L'avatar respire légèrement */
    animation: avatar-breathe 1.5s ease-in-out infinite;
}

/* Le HALO UNIFIÉ – exactement le même pour tous */
.speaking-active::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 280%;                    /* Même taille pour tous */
    height: 280%;
    border-radius: 50%;
    
    /* Dégradé violet/vert signature Nexus */
    background: radial-gradient(circle at 30% 30%,
        rgba(168, 85, 247, 0.95) 0%,    /* Violet vif */
        rgba(139, 92, 246, 0.8) 25%,    /* Violet moyen */
        rgba(74, 222, 128, 0.7) 50%,    /* Vert Nexus */
        rgba(74, 222, 128, 0.3) 75%,
        transparent 90%
    );
    
    animation: nexus-pulse 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    pointer-events: none;
    z-index: -1;
    
    /* Effets de lumière */
    filter: blur(4px) brightness(1.3);
    mix-blend-mode: screen;
    opacity: 0.9;
    box-shadow: 0 0 20px rgba(168, 85, 247, 0.5);
}

/* Animation principale – dynamique et fluide */
@keyframes nexus-pulse {
    0% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(0.6);
        filter: blur(3px) brightness(1.5);
    }
    30% {
        opacity: 0.9;
        transform: translate(-50%, -50%) scale(1.1);
        filter: blur(4px) brightness(1.3);
    }
    60% {
        opacity: 0.7;
        transform: translate(-50%, -50%) scale(1.6);
        filter: blur(5px) brightness(1.1);
    }
    100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(2.4);
        filter: blur(6px) brightness(0.9);
    }
}

/* Respiration de l'avatar */
@keyframes avatar-breathe {
    0%, 100% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.05);
    }
}

/* Version MUTE – quand l'utilisateur est en sourdine */
.speaking-active.muted::after {
    background: radial-gradient(circle at 30% 30%,
        rgba(239, 68, 68, 0.9) 0%,     /* Rouge vif */
        rgba(239, 68, 68, 0.6) 40%,
        transparent 80%
    );
    filter: blur(4px) brightness(1);
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
}

/* Version DEAFEN – sourdine + sourd */
.speaking-active.deafened::after {
    background: radial-gradient(circle at 30% 30%,
        rgba(107, 114, 128, 0.8) 0%,   /* Gris */
        rgba(75, 85, 99, 0.5) 50%,
        transparent 80%
    );
    filter: blur(4px) brightness(0.7);
    box-shadow: 0 0 20px rgba(107, 114, 128, 0.5);
    animation: none;  /* Pas d'animation quand on est sourd */
    opacity: 0.4;
}

/* Pour les avatars sans image (lettres) */
.speaking-active div, 
.speaking-active .bg-indigo-700 {
    position: relative;
    z-index: 10;
}

/* ==============================================
   ANIMATIONS SUPPLÉMENTAIRES
   ============================================== */

@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-2px); }
}

/* Classes utilitaires */
.animate-shimmer {
    animation: shimmer 2s infinite;
}

.animate-float {
    animation: float 3s infinite;
}

/* Animations d'entrée/sortie (compatibles avec Svelte) */
:global(.animate-in) {
    animation-duration: 300ms;
    animation-timing-function: ease-out;
    animation-fill-mode: forwards;
}

:global(.fade-in) {
    animation-name: fade-in;
}

:global(.slide-in-from-bottom-4) {
    animation-name: slide-in-from-bottom-4;
}

@keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes slide-in-from-bottom-4 {
    from {
        transform: translateY(1rem);
        opacity: 0;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}

/* Style pour le curseur de volume personnalisé */
input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(to right, #6366f1, #8b5cf6);
    cursor: pointer;
    box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
    border: 2px solid rgba(255, 255, 255, 0.2);
    transition: all 0.2s;
}

input[type=range]::-webkit-slider-thumb:hover {
    transform: scale(1.2);
    box-shadow: 0 0 15px rgba(99, 102, 241, 0.8);
}

input[type=range]::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(to right, #6366f1, #8b5cf6);
    cursor: pointer;
    border: 2px solid rgba(255, 255, 255, 0.2);
    transition: all 0.2s;
}

input[type=range]::-moz-range-thumb:hover {
    transform: scale(1.2);
    box-shadow: 0 0 15px rgba(99, 102, 241, 0.8);
}

/* Classes de compatibilité */
.speaking-active.normal,
.speaking-active.test-visible {
    /* Conservé pour d'éventuels usages */
}

/* Anciennes animations désactivées */
@keyframes sound-wave-test {}
@keyframes sound-wave {}
@keyframes sound-wave-small {}
</style>