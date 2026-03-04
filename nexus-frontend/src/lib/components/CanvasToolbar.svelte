<script lang="ts">
    import type { CanvasTool } from '$lib/canvas'

    let {
        tool     = $bindable<CanvasTool>('pen'),
        color    = $bindable<string>('#e879f9'),
        lineWidth = $bindable<number>(3),
        onUndo   = () => {},
        onClear  = () => {},
        onClose  = () => {},
    }: {
        tool:      CanvasTool
        color:     string
        lineWidth: number
        onUndo:    () => void
        onClear:   () => void
        onClose:   () => void
    } = $props()

    const TOOLS: { id: CanvasTool; label: string; icon: string }[] = [
        { id: 'pen',    label: 'Stylo',      icon: '✏️' },
        { id: 'sticky', label: 'Post-it',    icon: '📝' },
        { id: 'rect',   label: 'Rectangle',  icon: '⬜' },
        { id: 'circle', label: 'Cercle',     icon: '⭕' },
        { id: 'eraser', label: 'Effaceur',   icon: '🗑️' },
    ]

    const PRESET_COLORS = [
        '#e879f9', // violet nexus
        '#4ade80', // vert nexus
        '#f87171', // rouge
        '#facc15', // jaune
        '#60a5fa', // bleu
        '#fb923c', // orange
        '#ffffff', // blanc
        '#1f2937', // noir/gris foncé
    ]
</script>

<!-- Toolbar verticale flottante à gauche du canvas -->
<div class="flex flex-col gap-1 p-2 bg-gray-900/95 backdrop-blur-sm border border-indigo-500/30
            rounded-xl shadow-2xl shadow-black/50 select-none">

    <!-- Outils -->
    {#each TOOLS as t}
        <button
            onclick={() => tool = t.id}
            title={t.label}
            class="w-10 h-10 rounded-lg text-lg flex items-center justify-center
                   transition-all duration-150 hover:scale-110 active:scale-95
                   {tool === t.id
                       ? 'bg-gradient-to-br from-violet-600 to-purple-700 shadow-lg shadow-violet-500/40 ring-2 ring-violet-400/50'
                       : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700 hover:border-violet-500/40'}"
        >
            {t.icon}
        </button>
    {/each}

    <!-- Séparateur -->
    <div class="w-full h-px bg-gray-700/60 my-1"></div>

    <!-- Épaisseur (seulement pour pen) -->
    {#if tool === 'pen'}
        <div class="flex flex-col gap-1 items-center">
            {#each [2, 4, 8] as w}
                <button
                    onclick={() => lineWidth = w}
                    title="{w}px"
                    class="flex items-center justify-center w-10 h-8 rounded-lg transition-all
                           {lineWidth === w
                               ? 'bg-violet-700/60 ring-1 ring-violet-400/50'
                               : 'hover:bg-gray-700/60'}"
                >
                    <span
                        class="rounded-full bg-white block"
                        style="width: {w * 2}px; height: {w * 2}px; max-width:18px; max-height:18px;"
                    ></span>
                </button>
            {/each}
        </div>
        <div class="w-full h-px bg-gray-700/60 my-1"></div>
    {/if}

    <!-- Couleur courante -->
    <div class="w-10 h-10 rounded-lg border-2 border-white/30 shadow-lg overflow-hidden relative cursor-pointer"
         title="Choisir une couleur">
        <input
            type="color"
            bind:value={color}
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            style="padding:0; border:none;"
        />
        <div class="w-full h-full rounded-md" style="background:{color}"></div>
    </div>

    <!-- Couleurs prédéfinies -->
    <div class="flex flex-col gap-1">
        {#each PRESET_COLORS as c}
            <button
                onclick={() => color = c}
                title={c}
                class="w-10 h-5 rounded transition-all hover:scale-110 active:scale-95
                       {color === c ? 'ring-2 ring-white/70' : 'ring-1 ring-white/10'}"
                style="background:{c};"
            ></button>
        {/each}
    </div>

    <!-- Séparateur -->
    <div class="w-full h-px bg-gray-700/60 my-1"></div>

    <!-- Undo -->
    <button
        onclick={onUndo}
        title="Annuler (Ctrl+Z)"
        class="w-10 h-10 rounded-lg text-lg flex items-center justify-center
               bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white
               border border-gray-700 hover:border-gray-500
               transition-all duration-150 hover:scale-110 active:scale-95"
    >
        ↩️
    </button>

    <!-- Clear all -->
    <button
        onclick={onClear}
        title="Effacer tout"
        class="w-10 h-10 rounded-lg text-lg flex items-center justify-center
               bg-gray-800 hover:bg-red-900/60 text-gray-400 hover:text-red-300
               border border-gray-700 hover:border-red-500/40
               transition-all duration-150 hover:scale-110 active:scale-95"
    >
        🗑
    </button>

    <!-- Séparateur -->
    <div class="w-full h-px bg-gray-700/60 my-1"></div>

    <!-- Fermer -->
    <button
        onclick={onClose}
        title="Fermer la table"
        class="w-10 h-10 rounded-lg text-lg flex items-center justify-center
               bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white
               border border-gray-700 hover:border-gray-500
               transition-all duration-150 hover:scale-110 active:scale-95"
    >
        ✕
    </button>
</div>
