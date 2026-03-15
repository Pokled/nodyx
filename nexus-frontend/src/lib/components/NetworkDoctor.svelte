<script lang="ts">
    import { runNetworkDiagnostic } from '$lib/utils/networkTester';
    import { fade, fly } from 'svelte/transition';
    
    type CheckKeys = 'P2P' | 'RELAY' | 'UDP' | 'SIGNAL';
    const checkList: CheckKeys[] = ['P2P', 'RELAY', 'UDP', 'SIGNAL'];

    let diag = { status: 'idle', p2p: false, relay: false, udp: false, error: null };
    let logs: string[] = ["READY FOR DEPARTURE", "AWAITING COMMAND..."];
    let isJumping = false;
    
    let p2pSegments = 0;
    let relaySegments = 0;
    const maxSegments = 12;

    let visualChecks: Record<CheckKeys, string> = {
        P2P: 'WAIT', RELAY: 'WAIT', UDP: 'WAIT', SIGNAL: 'SEARCH'
    };

    function addLog(msg: string) {
        logs = [`[${new Date().toLocaleTimeString()}] ${msg}`, ...logs].slice(0, 5);
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
        diag = { status: 'testing', p2p: false, relay: false, udp: false, error: null };
        isJumping = true;
        p2pSegments = 0;
        relaySegments = 0;
        visualChecks = { P2P: 'SCANNING', RELAY: 'WAIT', UDP: 'WAIT', SIGNAL: 'SEARCH' };
        
        addLog("INITIATING CORE SYSTEMS CHECK...");
        runNetworkDiagnostic((res) => { diag = res; });

        // --- SEQUENCE CINÉMATIQUE ---
        await new Promise(r => setTimeout(r, 800));
        visualChecks.UDP = 'TESTING';
        addLog("TESTING UDP...");
        await new Promise(r => setTimeout(r, 800));
        visualChecks.UDP = diag.udp ? 'GO' : 'ERROR';

        visualChecks.P2P = 'SCANNING';
        addLog("SCANNING P2P...");
        await fillBar('p2p', 6);
        await new Promise(r => setTimeout(r, 1200));
        if (diag.p2p) {
            await fillBar('p2p', maxSegments);
            visualChecks.P2P = 'READY';
        } else {
            p2pSegments = 2;
            visualChecks.P2P = 'FAILED';
        }

        visualChecks.RELAY = 'SYNCING';
        addLog("VERIFYING RELAY...");
        await fillBar('relay', 5);
        await new Promise(r => setTimeout(r, 1000));
        if (diag.relay) {
            await fillBar('relay', maxSegments);
            visualChecks.RELAY = 'ACTIVE';
        } else {
            relaySegments = 1;
            visualChecks.RELAY = 'OFFLINE';
        }

        await new Promise(r => setTimeout(r, 500));
        visualChecks.SIGNAL = 'LOCKED';
        isJumping = false;
        diag.status = 'finished';
        addLog("SCAN COMPLETE.");
    }

    function getSegmentColor(index: number) {
        if (index < 3) return 'bg-red-500 shadow-[0_0_8px_#ef4444]';
        if (index < 7) return 'bg-orange-500 shadow-[0_0_8px_#f97316]';
        if (index < 10) return 'bg-yellow-400 shadow-[0_0_8px_#facc15]';
        return 'bg-green-500 shadow-[0_0_8px_#22c55e]';
    }
</script>

<div class="relative bg-[#11131f] rounded-2xl border border-white/5 overflow-hidden font-mono shadow-xl transition-all hover:border-indigo-500/30 group">
    
    {#if isJumping}
        <div class="absolute inset-0 z-0 bg-black/40">
            <div class="stars-container">
                {#each Array(40) as _, i}
                    <div class="star" style="--delay: {Math.random()}s; --top: {Math.random() * 100}%; --left: {Math.random() * 100}%; --speed: {0.5}s;"></div>
                {/each}
            </div>
        </div>
    {/if}

    <div class="relative z-10 p-5">
        <header class="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
            <div>
                <h3 class="text-sm font-bold text-indigo-400 uppercase tracking-widest italic">Millennium Falcor Meter</h3>
                <p class="text-[10px] text-gray-500 font-medium">NODE DIAGNOSTICS v2.0</p>
            </div>
            <button
                onclick={startTest}
                disabled={diag.status === 'testing'}
                class="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white text-[10px] font-black px-4 py-1.5 rounded-full transition-all uppercase italic"
            >
                {diag.status === 'testing' ? 'JUMPING...' : 'PUNCH IT !'}
            </button>
        </header>

        <div class="grid grid-cols-4 gap-2 mb-6">
            {#each checkList as key}
                <div class="text-center p-2 rounded bg-black/20 border border-white/5">
                    <div class="text-[8px] text-gray-500 font-bold mb-1">{key}</div>
                    <div class="text-[10px] font-black {['READY', 'ACTIVE', 'GO', 'LOCKED'].includes(visualChecks[key]) ? 'text-green-400' : 'text-gray-600'} italic">
                        {visualChecks[key]}
                    </div>
                </div>
            {/each}
        </div>

        <div class="space-y-4 mb-6">
            <div>
                <div class="flex justify-between text-[9px] font-bold text-gray-400 mb-2 italic uppercase">
                    <span>Sovereignty Index</span>
                    <span class={visualChecks.P2P === 'READY' ? 'text-green-400' : ''}>{visualChecks.P2P === 'READY' ? 'STABLE' : ''}</span>
                </div>
                <div class="flex gap-1 h-3">
                    {#each Array(maxSegments) as _, i}
                        <div class="flex-1 rounded-sm transition-all duration-300 {i < p2pSegments ? getSegmentColor(i) : 'bg-gray-800/40'}"></div>
                    {/each}
                </div>
            </div>
            <div>
                <div class="flex justify-between text-[9px] font-bold text-gray-400 mb-2 italic uppercase">
                    <span>Relay Buffer</span>
                    <span class={visualChecks.RELAY === 'ACTIVE' ? 'text-cyan-400' : ''}>{visualChecks.RELAY === 'ACTIVE' ? 'ROUTING' : ''}</span>
                </div>
                <div class="flex gap-1 h-3">
                    {#each Array(maxSegments) as _, i}
                        <div class="flex-1 rounded-sm transition-all duration-300 {i < relaySegments ? getSegmentColor(i) : 'bg-gray-800/40'}"></div>
                    {/each}
                </div>
            </div>
        </div>

        <div class="bg-black/40 rounded p-3 h-24 overflow-hidden border border-white/5">
            <div class="text-[9px] font-mono space-y-1">
                {#each logs as log}
                    <div in:fly={{y: 5}} class="text-gray-500">
                        <span class="text-indigo-500 font-bold mr-2">>></span> {log}
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>

<style>
    .stars-container { position: absolute; inset: 0; perspective: 400px; }
    .star {
        position: absolute; top: var(--top); left: var(--left);
        width: 1px; height: 80px;
        background: linear-gradient(to bottom, transparent, #fff, #4f46e5);
        opacity: 0; animation: hyper-warp var(--speed) linear infinite;
        animation-delay: var(--delay);
        transform-origin: top;
    }
    @keyframes hyper-warp {
        0% { transform: translateZ(-200px) scaleY(0); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translateZ(1000px) scaleY(10); opacity: 0; }
    }
</style>