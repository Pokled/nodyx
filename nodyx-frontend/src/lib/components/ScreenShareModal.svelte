<script lang="ts">
    import { startScreenShare, type DisplaySurface, type ShareQuality, type ShareFps } from '$lib/voice'

    let { onclose }: { onclose: () => void } = $props()

    let selectedSurface = $state<DisplaySurface>('monitor')
    let selectedQuality = $state<ShareQuality>('1080p')
    let selectedFps     = $state<ShareFps>(30)
    let starting        = $state(false)

    const SOURCES: { surface: DisplaySurface; icon: string; label: string; desc: string }[] = [
        { surface: 'monitor', icon: '🖥️', label: 'Écran entier',  desc: 'Tout votre bureau'     },
        { surface: 'window',  icon: '🪟',  label: 'Application',   desc: 'Une fenêtre ouverte'   },
        { surface: 'browser', icon: '🌐',  label: 'Onglet',         desc: 'Un onglet navigateur' },
    ]

    const QUALITIES: { id: ShareQuality; label: string; sub: string; color: string }[] = [
        { id: '720p',  label: '720p',  sub: 'HD',      color: 'text-sky-400'    },
        { id: '1080p', label: '1080p', sub: 'Full HD', color: 'text-indigo-400' },
        { id: '4k',    label: '4K',    sub: 'Ultra',   color: 'text-violet-400' },
    ]

    const FPS_OPTIONS: ShareFps[] = [15, 30, 60]

    async function share() {
        starting = true
        try {
            await startScreenShare(selectedSurface, selectedQuality, selectedFps)
            onclose()
        } catch {
            starting = false
        }
    }

    function onOverlayKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') onclose()
    }
</script>

<!-- Overlay -->
<div
    class="fixed inset-0 z-[300] flex items-center justify-center p-4"
    style="background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="Partager votre écran"
    onkeydown={onOverlayKeydown}
>
    <!-- Dismiss click outside -->
    <div class="absolute inset-0" role="presentation" onclick={onclose}></div>

    <!-- Card -->
    <div class="relative w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 rounded-2xl"
         style="background: #0a0a12; border: 1px solid rgba(99,102,241,0.2); box-shadow: 0 25px 60px rgba(0,0,0,0.6);">

        <!-- Top accent line -->
        <div class="absolute top-0 left-0 right-0 h-px"
             style="background: linear-gradient(90deg, transparent, rgba(99,102,241,0.6), transparent)"></div>

        <!-- Header -->
        <div class="flex items-center justify-between px-6 pt-6 pb-4"
             style="border-bottom: 1px solid rgba(255,255,255,0.05)">
            <div>
                <h2 class="text-sm font-bold text-white">Partager votre écran</h2>
                <p class="text-xs text-gray-500 mt-0.5">Choisissez ce que vous souhaitez montrer</p>
            </div>
            <button
                onclick={onclose}
                class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white transition-colors"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);"
                aria-label="Fermer"
            >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>

        <div class="px-6 py-5 space-y-5">

            <!-- Source picker -->
            <div class="grid grid-cols-3 gap-2">
                {#each SOURCES as src}
                    <button
                        onclick={() => selectedSurface = src.surface}
                        class="flex flex-col items-center gap-2.5 p-4 rounded-xl transition-all duration-150"
                        style="
                            border: 2px solid {selectedSurface === src.surface ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.05)'};
                            background: {selectedSurface === src.surface ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)'};
                        "
                    >
                        <span class="text-2xl leading-none">{src.icon}</span>
                        <div class="text-center">
                            <p class="text-xs font-semibold text-gray-200 leading-tight">{src.label}</p>
                            <p class="text-[10px] text-gray-500 mt-0.5 leading-tight">{src.desc}</p>
                        </div>
                        <div class="w-1.5 h-1.5 rounded-full transition-colors"
                             style="background: {selectedSurface === src.surface ? 'rgb(99,102,241)' : 'transparent'}"></div>
                    </button>
                {/each}
            </div>

            <!-- Separator -->
            <div style="height: 1px; background: rgba(255,255,255,0.05)"></div>

            <!-- Quality -->
            <div class="space-y-2.5">
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">Résolution</p>
                <div class="grid grid-cols-3 gap-2">
                    {#each QUALITIES as q}
                        <button
                            onclick={() => selectedQuality = q.id}
                            class="flex flex-col items-center py-2.5 rounded-lg transition-all"
                            style="
                                border: 1px solid {selectedQuality === q.id ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.05)'};
                                background: {selectedQuality === q.id ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)'};
                            "
                        >
                            <span class="text-xs font-bold {q.color}">{q.label}</span>
                            <span class="text-[10px] text-gray-500">{q.sub}</span>
                        </button>
                    {/each}
                </div>
            </div>

            <!-- FPS -->
            <div class="space-y-2.5">
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">Images / seconde</p>
                <div class="flex gap-2">
                    {#each FPS_OPTIONS as fps}
                        <button
                            onclick={() => selectedFps = fps}
                            class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                            style="
                                border: 1px solid {selectedFps === fps ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.05)'};
                                background: {selectedFps === fps ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)'};
                                color: {selectedFps === fps ? 'rgb(165,180,252)' : 'rgb(107,114,128)'};
                            "
                        >
                            {fps} fps
                        </button>
                    {/each}
                </div>
                {#if selectedFps === 60}
                    <p class="text-[10px] text-amber-400/80">
                        60 fps consomme plus de bande passante et de CPU
                    </p>
                {/if}
            </div>

        </div>

        <!-- Footer -->
        <div class="px-6 pb-6">
            <button
                onclick={share}
                disabled={starting}
                class="w-full py-2.5 rounded-xl font-semibold text-sm transition-all"
                style="
                    background: {starting ? 'rgba(55,65,81,1)' : 'rgb(79,70,229)'};
                    color: {starting ? 'rgb(107,114,128)' : 'white'};
                    box-shadow: {starting ? 'none' : '0 4px 24px rgba(79,70,229,0.3)'};
                    cursor: {starting ? 'not-allowed' : 'pointer'};
                "
            >
                {starting ? 'Lancement...' : 'Partager maintenant →'}
            </button>
        </div>
    </div>
</div>
