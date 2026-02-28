<script lang="ts">
    import { voiceSettingsStore, updateLocalAudio } from '$lib/voice'
    import type { VoiceSettings } from '$lib/voice'

    const s = $derived($voiceSettingsStore)

    // Affichage du gain en dB et en %
    const gainDb  = $derived(Math.round(20 * Math.log10(Math.max(0.01, s.micGain))))
    const gainPct = $derived(Math.round(s.micGain * 100))

    // Intensité Broadcast en %
    const broadcastPct = $derived(Math.round(s.broadcastIntensity * 100))

    function setMicGain(e: Event) {
        updateLocalAudio({ micGain: +(e.target as HTMLInputElement).value })
    }
    function setBroadcastIntensity(e: Event) {
        updateLocalAudio({ broadcastIntensity: +(e.target as HTMLInputElement).value })
    }
    function setBitrate(bitrate: VoiceSettings['bitrate']) {
        updateLocalAudio({ bitrate })
    }
</script>

<div class="p-4 space-y-5 text-sm select-none">

    <!-- ── Header ────────────────────────────────────────────────── -->
    <div class="flex items-center gap-2">
        <span class="text-base">⚙️</span>
        <h3 class="text-xs font-bold text-indigo-300 uppercase tracking-wider">Son & Micro</h3>
    </div>

    <!-- ── Gain micro ─────────────────────────────────────────────── -->
    <section class="space-y-2">
        <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-gray-300">🎙️ Volume d'entrée</span>
            <span class="text-[11px] font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-md">
                {gainPct}% {gainDb >= 0 ? '+' : ''}{gainDb} dB
            </span>
        </div>
        <div class="flex items-center gap-2">
            <span class="text-gray-600 text-xs">🔇</span>
            <input
                type="range" min="0.1" max="2" step="0.02"
                value={s.micGain}
                oninput={setMicGain}
                class="w-full h-1.5 rounded-full appearance-none cursor-pointer
                       bg-gray-700 accent-indigo-500"
            />
            <span class="text-gray-600 text-xs">🔊</span>
        </div>
        {#if s.micGain > 1.3}
            <p class="text-[10px] text-amber-400 flex items-center gap-1">
                ⚠️ Gain élevé — risque de saturation
            </p>
        {/if}
    </section>

    <div class="border-t border-gray-800"></div>

    <!-- ── Traitement ─────────────────────────────────────────────── -->
    <section class="space-y-3">
        <p class="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            Traitement (ce que les autres entendent)
        </p>

        <!-- Filtre passe-haut -->
        <label class="flex items-center justify-between cursor-pointer group">
            <div>
                <p class="text-xs font-medium text-gray-200 group-hover:text-white transition-colors">
                    Filtre passe-haut
                </p>
                <p class="text-[10px] text-gray-500">Supprime grondements et ronronnements (&lt; 80 Hz)</p>
            </div>
            <button
                role="switch"
                aria-checked={s.highPassEnabled}
                onclick={() => updateLocalAudio({ highPassEnabled: !s.highPassEnabled })}
                class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors duration-200
                       {s.highPassEnabled
                           ? 'bg-indigo-600 border-indigo-500'
                           : 'bg-gray-700 border-gray-600'}"
            >
                <span class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
                             transform transition-transform duration-200
                             {s.highPassEnabled ? 'translate-x-4' : 'translate-x-0'}">
                </span>
            </button>
        </label>

        <!-- RNNoise -->
        <label class="flex items-center justify-between cursor-pointer group">
            <div>
                <p class="text-xs font-medium text-gray-200 group-hover:text-white transition-colors flex items-center gap-1.5">
                    Suppression IA
                    <span class="text-[9px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded-full border border-violet-500/30 font-bold">
                        RNNoise
                    </span>
                </p>
                <p class="text-[10px] text-gray-500">Modèle neuronal léger (WASM) — coupe tout bruit</p>
            </div>
            <button
                role="switch"
                aria-checked={s.rnnoiseEnabled}
                onclick={() => updateLocalAudio({ rnnoiseEnabled: !s.rnnoiseEnabled })}
                class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors duration-200
                       {s.rnnoiseEnabled
                           ? 'bg-violet-600 border-violet-500'
                           : 'bg-gray-700 border-gray-600'}"
            >
                <span class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
                             transform transition-transform duration-200
                             {s.rnnoiseEnabled ? 'translate-x-4' : 'translate-x-0'}">
                </span>
            </button>
        </label>
    </section>

    <div class="border-t border-gray-800"></div>

    <!-- ── Mode Broadcast ✨ ───────────────────────────────────────── -->
    <section class="space-y-3">

        <!-- Header toggle -->
        <div class="flex items-start justify-between">
            <div>
                <p class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    ✨ Mode Broadcast
                    <span class="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/30 font-bold">
                        EXCLUSIF NEXUS
                    </span>
                </p>
                <p class="text-[10px] text-gray-500 mt-0.5">
                    EQ 3-bandes calé pour la voix humaine — son radio/podcast
                </p>
            </div>
            <button
                role="switch"
                aria-checked={s.broadcastModeEnabled}
                onclick={() => updateLocalAudio({ broadcastModeEnabled: !s.broadcastModeEnabled })}
                class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors duration-200 mt-0.5
                       {s.broadcastModeEnabled
                           ? 'bg-amber-500 border-amber-400'
                           : 'bg-gray-700 border-gray-600'}"
            >
                <span class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
                             transform transition-transform duration-200
                             {s.broadcastModeEnabled ? 'translate-x-4' : 'translate-x-0'}">
                </span>
            </button>
        </div>

        {#if s.broadcastModeEnabled}
            <!-- Intensité -->
            <div class="space-y-1.5 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                <div class="flex justify-between items-center">
                    <span class="text-[11px] text-amber-300/80 font-medium">Intensité</span>
                    <span class="text-[11px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md">
                        {broadcastPct}%
                    </span>
                </div>
                <input
                    type="range" min="0.1" max="1" step="0.05"
                    value={s.broadcastIntensity}
                    oninput={setBroadcastIntensity}
                    class="w-full h-1.5 rounded-full appearance-none cursor-pointer
                           bg-gray-700 accent-amber-400"
                />
                <!-- Détails EQ -->
                <div class="space-y-1 mt-2 text-[10px] text-gray-500">
                    <div class="flex justify-between">
                        <span>Coupe la boue</span>
                        <span class="font-mono text-red-400/70">200 Hz  −{(3*s.broadcastIntensity).toFixed(1)} dB</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Présence / Clarté</span>
                        <span class="font-mono text-green-400/70">3 kHz  +{(4*s.broadcastIntensity).toFixed(1)} dB</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Air haute fréquence</span>
                        <span class="font-mono text-sky-400/70">8 kHz  +{(3*s.broadcastIntensity).toFixed(1)} dB</span>
                    </div>
                </div>
            </div>
        {:else}
            <!-- Preview quand désactivé -->
            <div class="flex gap-3 text-[10px] text-gray-600">
                <span class="flex-1 bg-gray-800/50 rounded-lg p-2 text-center">200 Hz<br><span class="text-red-400/50">−3 dB</span></span>
                <span class="flex-1 bg-gray-800/50 rounded-lg p-2 text-center">3 kHz<br><span class="text-green-400/50">+4 dB</span></span>
                <span class="flex-1 bg-gray-800/50 rounded-lg p-2 text-center">8 kHz<br><span class="text-sky-400/50">+3 dB</span></span>
            </div>
        {/if}

    </section>

    <div class="border-t border-gray-800"></div>

    <!-- ── Qualité réseau ─────────────────────────────────────────── -->
    <section class="space-y-2">
        <p class="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Qualité réseau</p>
        <div class="grid grid-cols-3 gap-1.5">
            {#each ([32, 64, 128] as const) as br}
                <button
                    onclick={() => setBitrate(br)}
                    class="flex flex-col items-center py-2 px-1 rounded-lg border text-[10px] font-bold transition-all
                           {s.bitrate === br
                               ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-200'
                               : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'}"
                >
                    <span class="text-sm mb-0.5">
                        {br === 32 ? '🪫' : br === 64 ? '⚡' : '💎'}
                    </span>
                    {br} kbps
                    <span class="font-normal text-[9px] opacity-70 mt-0.5">
                        {br === 32 ? 'Économie' : br === 64 ? 'Standard' : 'HD'}
                    </span>
                </button>
            {/each}
        </div>
        {#if s.bitrate !== 64}
            <p class="text-[10px] text-amber-400/80 flex items-center gap-1">
                ⚠️ Effectif à la prochaine connexion vocale
            </p>
        {/if}
    </section>

</div>
