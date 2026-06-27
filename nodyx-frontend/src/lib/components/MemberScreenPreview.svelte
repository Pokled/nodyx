<script lang="ts">
    let {
        stream,
        username,
        avatar = null,
        x,
        y,
        side = 'right',
    }: {
        stream:    MediaStream
        username:  string
        avatar?:   string | null
        x:         number
        y:         number
        side?:     'left' | 'right'
    } = $props()

    const POPUP_W = 244
    const POPUP_H = 160  // ~135px video + 25px footer

    // Clamp dans le viewport
    const px = $derived(
        side === 'right'
            ? x + 10
            : x - POPUP_W - 10
    )
    const py = $derived(
        typeof window !== 'undefined'
            ? Math.min(y - 4, window.innerHeight - POPUP_H - 8)
            : y - 4
    )

    function streamSrc(node: HTMLVideoElement, s: MediaStream) {
        node.srcObject = s
        return {
            update(ns: MediaStream) { node.srcObject = ns },
            destroy()              { node.srcObject = null },
        }
    }
</script>

<div
    class="fixed z-[700] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    style="
        left: {px}px;
        top:  {py}px;
        width: {POPUP_W}px;
        pointer-events: none;
        background: rgba(5,5,11,0.97);
        border: 1px solid rgba(59,130,246,0.25);
        box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04);
        backdrop-filter: blur(12px);
    "
>
    <!-- Video -->
    <div class="relative bg-black" style="aspect-ratio: 16/9">
        <video
            use:streamSrc={stream}
            autoplay playsinline muted
            class="w-full h-full object-contain"
        ></video>
        <!-- ÉCRAN badge -->
        <div class="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5"
             style="background: rgba(0,0,0,0.72); border: 1px solid rgba(59,130,246,0.3)">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
            <span class="text-[9px] font-bold" style="color: rgb(96,165,250); letter-spacing: 0.08em">ÉCRAN</span>
        </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center gap-2 px-2.5 py-1.5"
         style="border-top: 1px solid rgba(255,255,255,0.05)">
        {#if avatar}
            <img src={avatar} alt={username} class="w-4 h-4 rounded-full object-cover shrink-0"/>
        {:else}
            <div class="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[7px] font-bold text-white"
                 style="background: linear-gradient(135deg, var(--nx-accent-strong), var(--nx-cyan-deep))">
                {username[0]?.toUpperCase()}
            </div>
        {/if}
        <span class="text-[11px] font-semibold text-white truncate flex-1">{username}</span>
        <span class="text-[9px] font-medium shrink-0" style="color: rgb(75,85,99)">Double-clic → plein écran</span>
    </div>
</div>
