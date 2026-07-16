<script lang="ts">
    import { startScreenShare, screenShareSupported, type DisplaySurface, type ShareQuality, type ShareFps } from '$lib/voice'

    let { onclose }: { onclose: () => void } = $props()

    // Les navigateurs mobiles ne savent PAS capturer un écran. Plutôt qu'un bouton
    // qui échoue en silence, on l'explique franchement (et on rappelle que REGARDER
    // un partage, lui, fonctionne très bien sur mobile).
    const supported = screenShareSupported()

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
         style="background: #0a0a12; border: 1px solid rgb(var(--nx-accent-rgb) / 0.2); box-shadow: 0 25px 60px rgba(0,0,0,0.6);">

        <!-- Top accent line -->
        <div class="absolute top-0 left-0 right-0 h-px"
             style="background: linear-gradient(90deg, transparent, rgb(var(--nx-accent-rgb) / 0.6), transparent)"></div>

        <!-- Header -->
        <div class="flex items-center justify-between px-6 pt-6 pb-4"
             style="border-bottom: 1px solid rgba(255,255,255,0.05)">
            <div>
                <h2 class="text-sm font-bold text-white">Partager votre écran</h2>
                <p class="text-xs text-gray-500 mt-0.5">
                    {supported ? 'Choisissez ce que vous souhaitez montrer' : 'Indisponible sur cet appareil'}
                </p>
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

        {#if !supported}
            <!-- Impossible sur mobile, et ce n'est PAS un manque de Nodyx : les
                 navigateurs Android et iOS n'implémentent pas la capture d'écran.
                 On l'explique au lieu de laisser un bouton qui échoue en silence. -->
            <div class="space-y-3 py-2">
                <div class="flex items-start gap-3 rounded-lg px-4 py-3"
                     style="background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.2)">
                    <svg class="mt-0.5 h-4 w-4 shrink-0" style="color: rgb(251,191,36)" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                    </svg>
                    <div class="space-y-1.5">
                        <p class="text-sm font-semibold text-white">
                            Le partage d'écran n'est pas possible depuis un téléphone
                        </p>
                        <p class="text-xs leading-relaxed" style="color: rgb(156,163,175)">
                            Ce n'est pas une limite de Nodyx : <strong style="color: rgb(209,213,219)">aucun navigateur
                            mobile ne sait capturer un écran</strong>. Sur Android comme sur iOS, la capture passe par
                            une fonction du système réservée aux applications installées, que les pages web n'ont pas le
                            droit d'utiliser. Aucun site ne peut le faire, quel qu'il soit.
                        </p>
                        <p class="text-xs leading-relaxed" style="color: rgb(156,163,175)">
                            Pour partager, utilisez un <strong style="color: rgb(209,213,219)">ordinateur</strong>.
                            En revanche, <strong style="color: rgb(209,213,219)">regarder</strong> le partage de
                            quelqu'un fonctionne parfaitement ici, son compris.
                        </p>
                    </div>
                </div>
                <button
                    onclick={onclose}
                    class="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors"
                    style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08)"
                >
                    J'ai compris
                </button>
            </div>
        {:else}

            <!-- Source picker -->
            <div class="grid grid-cols-3 gap-2">
                {#each SOURCES as src}
                    <button
                        onclick={() => selectedSurface = src.surface}
                        class="flex flex-col items-center gap-2.5 p-4 rounded-xl transition-all duration-150"
                        style="
                            border: 2px solid {selectedSurface === src.surface ? 'rgb(var(--nx-accent-rgb) / 0.6)' : 'rgba(255,255,255,0.05)'};
                            background: {selectedSurface === src.surface ? 'rgb(var(--nx-accent-rgb) / 0.08)' : 'rgba(255,255,255,0.02)'};
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

            <!-- Rappel audio, contextuel selon la source. Le son d'un partage n'est
                 diffusé que si l'émetteur le capture : Chrome ne propose la case son
                 que pour un ONGLET (une fenêtre n'en a pas ; l'écran entier seulement
                 sous Windows). Sans ce rappel, on partage en silence sans le savoir. -->
            <div class="flex items-start gap-2 rounded-lg px-3 py-2"
                 style="background: rgb(var(--nx-accent-rgb) / 0.06); border: 1px solid rgb(var(--nx-accent-rgb) / 0.15)">
                <svg class="mt-0.5 h-4 w-4 shrink-0" style="color: rgb(var(--nx-accent-soft))" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M11 5 6 9H2v6h4l5 4V5z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
                <p class="text-[11px] leading-relaxed" style="color: rgb(156,163,175)">
                    {#if selectedSurface === 'browser'}
                        Pour partager aussi le son, cochez
                        <strong style="color: rgb(199,210,254)">« Partager aussi l'audio de l'onglet »</strong>
                        dans la fenêtre du navigateur qui suit.
                    {:else}
                        Cette source ne partage pas le son. Pour l'inclure, choisissez plutôt
                        <strong style="color: rgb(209,213,219)">Onglet</strong>.
                    {/if}
                </p>
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
                                border: 1px solid {selectedQuality === q.id ? 'rgb(var(--nx-accent-rgb) / 0.5)' : 'rgba(255,255,255,0.05)'};
                                background: {selectedQuality === q.id ? 'rgb(var(--nx-accent-rgb) / 0.08)' : 'rgba(255,255,255,0.02)'};
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
                                border: 1px solid {selectedFps === fps ? 'rgb(var(--nx-accent-rgb) / 0.5)' : 'rgba(255,255,255,0.05)'};
                                background: {selectedFps === fps ? 'rgb(var(--nx-accent-rgb) / 0.08)' : 'rgba(255,255,255,0.02)'};
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
        {/if}

        </div>

        <!-- Footer -->
        {#if supported}
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
        {/if}
    </div>
</div>
