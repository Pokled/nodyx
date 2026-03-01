<script lang="ts">
    import { runNetworkDiagnostic } from '$lib/utils/networkTester';
    import { fade, fly } from 'svelte/transition';

    type CheckKeys = 'P2P' | 'RELAY' | 'UDP' | 'SIGNAL';
    const checkList: CheckKeys[] = ['P2P', 'RELAY', 'UDP', 'SIGNAL'];

    let diag = $state({ status: 'idle', p2p: false, relay: false, udp: false, error: null });
    let logs = $state<string[]>(["Système prêt", "En attente de commande..."]);
    let isTesting = $state(false);
    
    let p2pSegments = $state(0);
    let relaySegments = $state(0);
    const maxSegments = 12;

    let visualChecks = $state<Record<CheckKeys, string>>({
        P2P: 'WAIT', RELAY: 'WAIT', UDP: 'WAIT', SIGNAL: 'IDLE'
    });

    function addLog(msg: string) {
        logs = [`[${new Date().toLocaleTimeString()}] ${msg}`, ...logs].slice(0, 8);
    }

    async function fillBar(type: 'p2p' | 'relay', target: number) {
        if (type === 'p2p') p2pSegments = 0;
        else relaySegments = 0;

        for (let i = 0; i < target; i++) {
            await new Promise(r => setTimeout(r, 100)); 
            if (type === 'p2p') p2pSegments++;
            else relaySegments++;
        }
    }

    async function startTest() {
        isTesting = true;
        diag = { status: 'testing', p2p: false, relay: false, udp: false, error: null };
        p2pSegments = 0;
        relaySegments = 0;
        visualChecks = { P2P: 'SCANNING', RELAY: 'WAIT', UDP: 'WAIT', SIGNAL: 'SCANNING' };
        
        addLog("Initialisation du diagnostic réseau...");
        runNetworkDiagnostic((res) => { diag = res; });

        // Séquence synchronisée avec ton UI
        await new Promise(r => setTimeout(r, 800));
        visualChecks.UDP = 'TESTING';
        addLog("Vérification des protocoles UDP...");
        await new Promise(r => setTimeout(r, 800));
        visualChecks.UDP = diag.udp ? 'OK' : 'ERREUR';

        visualChecks.P2P = 'SCANNING';
        addLog("Analyse de la topologie P2P...");
        await fillBar('p2p', 6);
        await new Promise(r => setTimeout(r, 1200));
        if (diag.p2p) {
            await fillBar('p2p', maxSegments);
            visualChecks.P2P = 'STABLE';
        } else {
            p2pSegments = 2;
            visualChecks.P2P = 'ÉCHEC';
        }

        visualChecks.RELAY = 'SYNCING';
        addLog("Test du buffer de relais (TURN)...");
        await fillBar('relay', 5);
        await new Promise(r => setTimeout(r, 1000));
        if (diag.relay) {
            await fillBar('relay', maxSegments);
            visualChecks.RELAY = 'ACTIF';
        } else {
            relaySegments = 1;
            visualChecks.RELAY = 'OFFLINE';
        }

        visualChecks.SIGNAL = 'LOCKED';
        isTesting = false;
        diag.status = 'finished';
        addLog("Diagnostic terminé.");
    }

    function getSegmentColor(index: number) {
        if (index < 3) return 'bg-red-500/80';
        if (index < 7) return 'bg-orange-500/80';
        if (index < 10) return 'bg-yellow-500/80';
        return 'bg-emerald-500/80';
    }
</script>

<svelte:head><title>État Réseau — Admin Nexus</title></svelte:head>

<div class="space-y-6 font-sans">
    <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-white">Connection Status</h1>
        <button 
            onclick={startTest}
            disabled={isTesting}
            class="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition-all flex items-center gap-2"
        >
            {#if isTesting}<span class="animate-spin text-xs">⚙</span>{/if}
            {isTesting ? 'Analyse...' : 'Lancer le diagnostic'}
        </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <div class="space-y-4">
            <div class="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
                <h2 class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 italic">Vérification des modules</h2>
                <div class="grid grid-cols-2 gap-3">
                    {#each checkList as key}
                        <div class="rounded-lg bg-gray-800/50 border border-gray-700/50 p-3 flex flex-col items-center justify-center text-center">
                            <span class="text-[10px] text-gray-500 font-bold mb-1 uppercase tracking-tighter">{key}</span>
                            <span class="text-xs font-black italic {['OK', 'STABLE', 'ACTIF', 'LOCKED'].includes(visualChecks[key]) ? 'text-emerald-400' : 'text-gray-400'}">
                                {visualChecks[key]}
                            </span>
                        </div>
                    {/each}
                </div>
            </div>

            <div class="rounded-xl border border-gray-800 bg-black/40 p-5 h-[168px] flex flex-col">
                <h2 class="text-xs font-bold text-gray-600 uppercase mb-3">Logs de connexion</h2>
                <div class="flex-1 font-mono text-[11px] space-y-1 overflow-hidden">
                    {#each logs as log}
                        <div in:fly={{y: 5}} class="text-gray-400 flex gap-2">
                            <span class="text-indigo-500 font-bold">»</span> {log}
                        </div>
                    {/each}
                </div>
            </div>
        </div>

        <div class="rounded-xl border border-gray-800 bg-gray-900/50 p-6 flex flex-col justify-between">
            <h2 class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-6 italic">Indice de Souveraineté</h2>
            
            <div class="space-y-10">
                <div>
                    <div class="flex justify-between text-[11px] font-bold text-gray-400 mb-3 uppercase">
                        <span>Liaison Directe (P2P)</span>
                        <span class={visualChecks.P2P === 'STABLE' ? 'text-emerald-400' : ''}>{visualChecks.P2P === 'STABLE' ? '100%' : ''}</span>
                    </div>
                    <div class="flex gap-1.5 h-4">
                        {#each Array(maxSegments) as _, i}
                            <div class="flex-1 rounded-sm transition-all duration-300 {i < p2pSegments ? getSegmentColor(i) : 'bg-gray-800'}"></div>
                        {/each}
                    </div>
                </div>

                <div>
                    <div class="flex justify-between text-[11px] font-bold text-gray-400 mb-3 uppercase">
                        <span>Flux de Relais (VPS)</span>
                        <span class={visualChecks.RELAY === 'ACTIF' ? 'text-indigo-400' : ''}>{visualChecks.RELAY === 'ACTIF' ? 'ACTIF' : ''}</span>
                    </div>
                    <div class="flex gap-1.5 h-4">
                        {#each Array(maxSegments) as _, i}
                            <div class="flex-1 rounded-sm transition-all duration-300 {i < relaySegments ? getSegmentColor(i) : 'bg-gray-800'}"></div>
                        {/each}
                    </div>
                </div>
            </div>

            <div class="mt-8 p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
                <p class="text-[10px] text-gray-500 italic leading-relaxed">
                    Nexus privilégie les liaisons directes chiffrées. Le relais n'est utilisé que si les pare-feux locaux bloquent le flux UDP.
                </p>
            </div>
        </div>
    </div>
</div>

<style>
    @keyframes scan {
        0% { left: 0; width: 0; opacity: 0; }
        50% { left: 0; width: 100%; opacity: 0.5; }
        100% { left: 100%; width: 0; opacity: 0; }
    }
</style>