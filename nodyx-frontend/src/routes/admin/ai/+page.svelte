<script lang="ts">
    import { checkOllamaStatus } from "$lib/utils/aiDetector";
    import { fly, fade } from "svelte/transition";
    import { onMount } from "svelte";

    // 1. Interfaces
    interface OllamaModel {
        name: string;
        size: number;
        modified_at: string;
        digest: string;
    }

    // 2. État réactif (Svelte 5 Runes)
    let status = $state({
        active: false,
        models: [] as OllamaModel[],
        version: "",
        currentModel: "", // Sera peuplé au montage
    });

    let isScanning = $state(false);
    let isUpdating = $state(false);
    let aiPower = $state(0);

    // 3. Fonctions

    /**
     * Scan les modèles disponibles via Ollama
     */
    async function scanIA() {
        isScanning = true;
        aiPower = 0;

        // Animation cinématique de la jauge
        for (let i = 0; i <= 6; i++) {
            await new Promise((r) => setTimeout(r, 100));
            aiPower = i;
        }

        const res = await checkOllamaStatus();

        status = {
            ...status,
            active: res.active,
            models: (res.models as OllamaModel[]) || [],
            version: res.version || "Inconnue",
        };

        if (status.active) {
            aiPower = 12; // Jauge pleine
        } else {
            aiPower = 2; // Alerte rouge (inactif)
        }
        isScanning = false;
    }

    /**
     * TODO: backend /api/v1/admin/neural/set-model non encore implémenté
     * Réservé pour une future intégration Ollama native dans nodyx-core
     */
    function selectModel(_name: string) {
        // no-op intentionnel — backend non implémenté
    }

    /**
     * Gère les couleurs de la jauge en fonction de l'état
     */
    function getAiColor(index: number) {
        if (!status.active && index < 3)
            return "bg-red-500/80 shadow-[0_0_8px_red]";
        if (index < 5) return "bg-indigo-400/60";
        if (index < 9) return "bg-indigo-500/80";
        return "bg-purple-500 shadow-[0_0_10px_#a855f7]";
    }

    // Initialisation
    onMount(async () => {
        await scanIA();

        // Optionnel : Récupérer le modèle actuellement configuré sur le core
        // pour synchroniser la pastille "Actif" au chargement.
        try {
            // Si tu as une route GET pour récupérer la config actuelle, appelle-la ici
            // Sinon, on laisse le scan faire son travail.
        } catch (e) {}
    });
</script>

<svelte:head>
    <title>Neural Engine — Admin Nodyx</title>
</svelte:head>

<div class="space-y-6 font-sans">
    <div class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
        <span class="font-semibold">En développement</span> — L'intégration Ollama dans nodyx-core n'est pas encore disponible. Le scan local fonctionne, mais l'activation d'un modèle n'a pas d'effet.
    </div>
    <div class="flex items-center justify-between">
        <div>
            <h1 class="text-2xl font-bold text-white tracking-tight">
                Neural Engine
            </h1>
            <p class="text-xs text-gray-400">
                Gestion de l'intelligence artificielle locale
            </p>
        </div>
        <button
            onclick={scanIA}
            disabled={isScanning}
            class="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20"
        >
            {#if isScanning}<span class="animate-spin text-xs">⚙</span>{/if}
            {isScanning ? "Synchronisation..." : "Scanner Ollama"}
        </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
            class="rounded-xl border border-gray-800 bg-gray-900/50 p-6 flex flex-col justify-between backdrop-blur-sm"
        >
            <h2
                class="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] mb-6 italic"
            >
                Moteur Neural Local
            </h2>

            <div class="space-y-8">
                <div>
                    <div
                        class="flex justify-between text-[11px] font-bold text-gray-400 mb-3 uppercase"
                    >
                        <span>Disponibilité Ollama</span>
                        <span
                            class={status.active
                                ? "text-purple-400"
                                : "text-red-500 animate-pulse"}
                        >
                            {status.active ? "PRÊT" : "INACTIF"}
                        </span>
                    </div>
                    <div class="flex gap-1.5 h-4">
                        {#each Array(12) as _, i}
                            <div
                                class="flex-1 rounded-sm transition-all duration-500 {i <
                                aiPower
                                    ? getAiColor(i)
                                    : 'bg-gray-800'}"
                            ></div>
                        {/each}
                    </div>
                </div>

                <div class="rounded-lg bg-black/40 p-4 border border-white/5">
                    <p class="text-[10px] text-gray-400 leading-relaxed italic">
                        Le Neural Engine permet à Nodyx d'utiliser ta propre
                        puissance de calcul (GPU RX 570 8GB). Aucune donnée ne
                        quitte ton infrastructure lors des résumés ou des
                        analyses privées.
                    </p>
                </div>
            </div>
        </div>

        <div
            class="rounded-xl border border-gray-800 bg-gray-900/50 p-5 overflow-hidden flex flex-col backdrop-blur-sm"
        >
            <h2
                class="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] mb-4 italic"
            >
                Modèles Détectés
            </h2>

            <div class="space-y-2 h-[220px] overflow-y-auto pr-2 custom-scroll">
                {#if status.models.length > 0}
                    {#each status.models as model (model.digest)}
                        <div
                            in:fly={{ x: 20, duration: 400 }}
                            class="flex justify-between items-center p-3 rounded-lg border transition-all duration-300 group
                            {status.currentModel === model.name
                                ? 'bg-purple-500/10 border-purple-500/50'
                                : 'bg-gray-800/40 border-gray-700/50 hover:border-indigo-500/50'}"
                        >
                            <div class="flex flex-col">
                                <span
                                    class="text-sm font-medium text-white flex items-center gap-2"
                                >
                                    {model.name}
                                    {#if status.currentModel === model.name}
                                        <span
                                            class="w-1.5 h-1.5 rounded-full bg-purple-400 shadow-[0_0_5px_#a855f7] animate-pulse"
                                        ></span>
                                    {/if}
                                </span>
                                <span
                                    class="text-[10px] text-gray-500 font-mono"
                                >
                                    {Math.round((model.size / 1e9) * 10) / 10} GB
                                </span>
                            </div>

                            {#if status.currentModel === model.name}
                                <span
                                    class="text-[9px] text-purple-400 font-bold uppercase tracking-widest"
                                    in:fade>Actif</span
                                >
                            {:else}
                                <button
                                    onclick={() => selectModel(model.name)}
                                    disabled={isUpdating}
                                    class="opacity-0 group-hover:opacity-100 text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition-all uppercase font-bold disabled:opacity-50"
                                >
                                    {isUpdating ? "..." : "Activer"}
                                </button>
                            {/if}
                        </div>
                    {/each}
                {:else}
                    <div
                        class="h-full flex flex-col items-center justify-center opacity-30 italic text-sm text-gray-400"
                    >
                        <span class="text-2xl mb-2">📡</span>
                        <span>Aucun modèle trouvé</span>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    .custom-scroll::-webkit-scrollbar {
        width: 4px;
    }
    .custom-scroll::-webkit-scrollbar-track {
        background: transparent;
    }
    .custom-scroll::-webkit-scrollbar-thumb {
        background: #374151;
        border-radius: 10px;
    }
    .custom-scroll::-webkit-scrollbar-thumb:hover {
        background: #4b5563;
    }
</style>
