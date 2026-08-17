<script lang="ts">
    import { voiceSettingsStore, updateLocalAudio } from '$lib/voice'
    import type { VoiceSettings } from '$lib/voice'
    import { t } from '$lib/i18n'

    const tFn = $derived($t)

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
    function setNoiseGateThreshold(e: Event) {
        updateLocalAudio({ noiseGateThreshold: +(e.target as HTMLInputElement).value })
    }

    let { onclose }: { onclose?: () => void } = $props()

    // Sortie portee par le COMPOSANT et non par son conteneur.
    // Le 17/08, deux correctifs successifs ont ajoute une croix aux conteneurs de
    // VoicePanel sans aucun effet : ce composant se rend par un TROISIEME chemin,
    // quasiment nu (sa racine est un simple `<div class="p-4">`, sans decor). La
    // croix voyage donc desormais AVEC le contenu, a cote de son propre titre,
    // la ou l'utilisateur la cherche. Optionnelle : sans `onclose`, rien ne
    // s'affiche et les usages existants ne changent pas.
</script>

<div class="p-4 space-y-5 text-sm select-none">

    <!-- ── Header ────────────────────────────────────────────────── -->
    <!-- COLLE EN HAUT : ce panneau defile, et l'en-tete partait avec lui. Des
         qu'on descendait dans les reglages, la seule sortie disparaissait par le
         haut (signale le 17/08, capture ou il ne restait que l'arc inferieur du
         cercle). Les marges negatives compensent le `p-4` de la racine pour que
         le fond couvre toute la largeur. -->
    <div class="sticky top-0 z-20 -mx-4 -mt-4 px-4 pt-4 pb-2 flex items-center gap-2
                bg-gray-950/95 backdrop-blur-sm border-b border-white/[0.06]">
        <span class="text-base">⚙️</span>
        <h3 class="text-xs font-bold text-indigo-300 uppercase tracking-wider">{tFn('voice_settings.header')}</h3>
        {#if onclose}
            <button
                onclick={onclose}
                aria-label={tFn('voice_panel.close_settings')}
                class="ml-auto shrink-0 w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-full
                       text-gray-200 hover:text-white bg-black/50 border border-gray-600
                       hover:border-amber-500/60 transition-colors"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        {/if}
    </div>

    <!-- ── Gain micro ─────────────────────────────────────────────── -->
    <section class="space-y-2">
        <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-gray-300">{tFn('voice_settings.input_volume')}</span>
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
                {tFn('voice_settings.gain_high')}
            </p>
        {/if}
    </section>

    <div class="border-t border-gray-800"></div>

    <!-- ── Traitement ─────────────────────────────────────────────── -->
    <section class="space-y-3">
        <p class="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            {tFn('voice_settings.processing_title')}
        </p>

        <!-- Filtre passe-haut -->
        <label class="flex items-center justify-between cursor-pointer group">
            <div>
                <p class="text-xs font-medium text-gray-200 group-hover:text-white transition-colors">
                    {tFn('voice_settings.highpass')}
                </p>
                <p class="text-[10px] text-gray-500">{tFn('voice_settings.highpass_desc')}</p>
            </div>
            <button
                role="switch"
                aria-label={tFn('voice_settings.highpass')}
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
                    {tFn('voice_settings.rnnoise_label')}
                    <span class="text-[9px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded-full border border-violet-500/30 font-bold">
                        RNNoise
                    </span>
                </p>
                <p class="text-[10px] text-gray-500">{tFn('voice_settings.rnnoise_desc')}</p>
            </div>
            <button
                role="switch"
                aria-label={tFn('voice_settings.rnnoise_aria')}
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

        <!-- Noise gate -->
        <label class="flex items-center justify-between cursor-pointer group">
            <div>
                <p class="text-xs font-medium text-gray-200 group-hover:text-white transition-colors">
                    {tFn('voice_settings.noise_gate')}
                </p>
                <p class="text-[10px] text-gray-500">{tFn('voice_settings.noise_gate_desc')}</p>
            </div>
            <button
                role="switch"
                aria-label={tFn('voice_settings.noise_gate')}
                aria-checked={s.noiseGateEnabled}
                onclick={() => updateLocalAudio({ noiseGateEnabled: !s.noiseGateEnabled })}
                class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors duration-200
                       {s.noiseGateEnabled
                           ? 'bg-teal-600 border-teal-500'
                           : 'bg-gray-700 border-gray-600'}"
            >
                <span class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
                             transform transition-transform duration-200
                             {s.noiseGateEnabled ? 'translate-x-4' : 'translate-x-0'}">
                </span>
            </button>
        </label>

        {#if s.noiseGateEnabled}
            <div class="space-y-1.5 bg-teal-500/5 border border-teal-500/20 rounded-xl p-3">
                <div class="flex justify-between items-center">
                    <span class="text-[11px] text-teal-300/80 font-medium">{tFn('voice_settings.threshold')}</span>
                    <span class="text-[11px] font-mono text-teal-300 bg-teal-500/10 px-2 py-0.5 rounded-md">
                        {s.noiseGateThreshold} dBFS
                    </span>
                </div>
                <input
                    type="range" min="-80" max="-10" step="1"
                    value={s.noiseGateThreshold}
                    oninput={setNoiseGateThreshold}
                    class="w-full h-1.5 rounded-full appearance-none cursor-pointer
                           bg-gray-700 accent-teal-400"
                />
                <p class="text-[10px] text-gray-500">
                    {s.noiseGateThreshold <= -60
                        ? tFn('voice_settings.thr_sensitive')
                        : s.noiseGateThreshold <= -40
                        ? tFn('voice_settings.thr_balanced')
                        : tFn('voice_settings.thr_aggressive')}
                </p>
            </div>
        {/if}
    </section>

    <div class="border-t border-gray-800"></div>

    <!-- ── Mode Broadcast ✨ ───────────────────────────────────────── -->
    <section class="space-y-3">

        <!-- Header toggle -->
        <div class="flex items-start justify-between">
            <div>
                <p class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    {tFn('voice_settings.broadcast_label')}
                    <span class="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/30 font-bold">
                        {tFn('voice_settings.exclusive_nodyx')}
                    </span>
                </p>
                <p class="text-[10px] text-gray-500 mt-0.5">
                    {tFn('voice_settings.broadcast_desc')}
                </p>
            </div>
            <button
                role="switch"
                aria-label={tFn('voice_settings.broadcast_aria')}
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
                    <span class="text-[11px] text-amber-300/80 font-medium">{tFn('voice_settings.intensity')}</span>
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
                        <span>{tFn('voice_settings.eq_mud')}</span>
                        <span class="font-mono text-red-400/70">200 Hz  −{(3*s.broadcastIntensity).toFixed(1)} dB</span>
                    </div>
                    <div class="flex justify-between">
                        <span>{tFn('voice_settings.presence')}</span>
                        <span class="font-mono text-green-400/70">3 kHz  +{(4*s.broadcastIntensity).toFixed(1)} dB</span>
                    </div>
                    <div class="flex justify-between">
                        <span>{tFn('voice_settings.air')}</span>
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
        <p class="text-[10px] uppercase tracking-widest text-gray-500 font-bold">{tFn('voice_settings.network_quality')}</p>
        <div class="grid grid-cols-4 gap-1.5">
            {#each ([32, 64, 96, 128] as const) as br}
                <button
                    onclick={() => setBitrate(br)}
                    class="flex flex-col items-center py-2 px-1 rounded-lg border text-[10px] font-bold transition-all
                           {s.bitrate === br
                               ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-200'
                               : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'}"
                >
                    <span class="text-sm mb-0.5">
                        {br === 32 ? '🪫' : br === 64 ? '⚡' : br === 96 ? '🎙️' : '💎'}
                    </span>
                    {br}k
                    <span class="font-normal text-[9px] opacity-70 mt-0.5">
                        {br === 32 ? tFn('voice_settings.br_economy') : br === 64 ? tFn('voice_settings.br_standard') : br === 96 ? tFn('voice_settings.br_quality') : tFn('voice_settings.br_studio')}
                    </span>
                </button>
            {/each}
        </div>
        {#if s.bitrate === 32}
            <p class="text-[10px] text-amber-400/80 flex items-center gap-1">
                {tFn('voice_settings.br_warning')}
            </p>
        {:else if s.bitrate !== 64}
            <p class="text-[10px] text-gray-500 flex items-center gap-1">
                {tFn('voice_settings.effective_next')}
            </p>
        {/if}
    </section>

</div>
