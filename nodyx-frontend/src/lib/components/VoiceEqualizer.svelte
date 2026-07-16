<script lang="ts">
    // ── Équaliseur vocal RÉEL ────────────────────────────────────────────────
    //
    // Remplace les anciennes barres FACTICES (une animation CSS `vc-wave` en
    // boucle, déclenchée par le booléen `speaking` : elles ondulaient pareil
    // qu'on chuchote ou qu'on crie).
    //
    // Ici on lit le VRAI spectre de la personne via son AnalyserNode, en
    // `requestAnimationFrame`. On ne passe PAS par le store : à 60 fps ça
    // re-rendrait tout le roster pour rien. Même patron que le visualiseur du
    // lecteur audio (AudioRecorder), adapté à la voix.

    import { onDestroy } from 'svelte'
    import { getPeerAnalyser, getLocalAnalyser } from '$lib/voice'

    let {
        socketId = null,
        isMe = false,
        bars = 3,
        color = '#4ade80',
    }: {
        socketId?: string | null
        isMe?: boolean
        bars?: number
        color?: string
    } = $props()

    // Repos = barres basses mais visibles (comme l'ancien rendu au repos).
    const FLOOR = 0.2

    let levels = $state<number[]>(Array(bars).fill(FLOOR))
    let raf: number | null = null
    let buf: Uint8Array<ArrayBuffer> | null = null

    function analyser(): AnalyserNode | null {
        if (isMe) return getLocalAnalyser()
        return socketId ? getPeerAnalyser(socketId) : null
    }

    function tick(): void {
        const a = analyser()
        if (a) {
            if (!buf || buf.length !== a.frequencyBinCount) buf = new Uint8Array(a.frequencyBinCount)
            a.getByteFrequencyData(buf)
            // La voix vit dans le BAS du spectre (~85 Hz à 3,5 kHz). L'analyser
            // couvre jusqu'à ~24 kHz : lire tout le spectre écraserait les barres
            // (le haut est vide en permanence). On ne garde donc que le début.
            const usable   = Math.min(buf.length, 36)
            const bandSize = Math.max(1, Math.floor(usable / bars))
            const out: number[] = []
            for (let i = 0; i < bars; i++) {
                let sum = 0
                for (let j = 0; j < bandSize; j++) sum += buf[i * bandSize + j]
                const v = sum / (bandSize * 160)     // 0..255 par bin → ~0..1
                out.push(Math.max(FLOOR, Math.min(1, v)))
            }
            levels = out
        }
        raf = requestAnimationFrame(tick)
    }

    $effect(() => {
        raf = requestAnimationFrame(tick)
        return () => {
            if (raf !== null) cancelAnimationFrame(raf)
            raf = null
        }
    })

    onDestroy(() => { if (raf !== null) cancelAnimationFrame(raf) })
</script>

<div class="vc-eq shrink-0" aria-label="Parle">
    {#each levels as l, i (i)}
        <span class="vc-eq-bar" style="transform: scaleY({l}); background: {color}"></span>
    {/each}
</div>

<style>
    .vc-eq {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 12px;
        width: 14px;
    }
    .vc-eq-bar {
        display: block;
        width: 2.5px;
        height: 100%;
        border-radius: 1px;
        transform-origin: bottom center;
        /* Court, pour lisser le rendu sans traîner derrière la voix. */
        transition: transform 60ms linear;
    }
</style>
