<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { browser }           from '$app/environment'
    import CanvasToolbar         from './CanvasToolbar.svelte'
    import {
        CanvasState,
        type CanvasTool, type CanvasElement, type CanvasP2PMessage,
        type PathData, type StickyData, type ShapeData,
    } from '$lib/canvas'
    import { p2pManager }  from '$lib/p2p'
    import { voiceStore }  from '$lib/voice'

    // ── Props ─────────────────────────────────────────────────────────────────
    let {
        channelId,      // text channel id for session recap
        voiceChannelId, // voice channel id — used to join the P2P mesh
        socket,         // Socket.IO instance
        userId,
        username,
        onclose = () => {},
    }: {
        channelId:      string | null
        voiceChannelId: string | null
        socket:         any
        userId:         string
        username:       string
        onclose:        () => void
    } = $props()

    // ── Canvas state ──────────────────────────────────────────────────────────
    // Named 'cs' to avoid collision with Svelte 5's $state rune
    let canvasEl: HTMLCanvasElement
    let cs = new CanvasState()

    // ── Tool state ────────────────────────────────────────────────────────────
    let tool:      CanvasTool = $state('pen')
    let color:     string     = $state('#e879f9')
    let lineWidth: number     = $state(3)

    // ── Drawing state (pointer events) ────────────────────────────────────────
    let isDrawing   = false
    let currentPath: [number, number][] = []
    let currentId   = ''
    let dragStart:  { x: number; y: number } | null = null
    let previewEl:  { x: number; y: number; w: number; h: number } | null = null

    // Sticky note editing
    let stickyEdit: { x: number; y: number } | null = $state(null)
    let stickyText  = $state('')

    // Local undo stack (element ids to soft-delete)
    const undoStack: string[] = []

    // ── Remote cursors ────────────────────────────────────────────────────────
    type RemoteCursor = {
        x: number; y: number
        userId: string; username: string
        speaking: boolean
        lastSeen: number
    }
    let remoteCursors: Map<string, RemoteCursor> = $state(new Map())
    let cursorInterval: ReturnType<typeof setInterval>

    // Throttle cursor sends
    let lastCursorSend = 0

    // ── End dialog ────────────────────────────────────────────────────────────
    let showEndDialog = $state(false)

    // ── Canvas size ───────────────────────────────────────────────────────────
    let canvasW = $state(1200)
    let canvasH = $state(700)

    // ── Helpers ───────────────────────────────────────────────────────────────

    function getCtx(): CanvasRenderingContext2D {
        return canvasEl.getContext('2d')!
    }

    function pointerPos(e: PointerEvent): [number, number] {
        const rect = canvasEl.getBoundingClientRect()
        const scaleX = canvasEl.width  / rect.width
        const scaleY = canvasEl.height / rect.height
        return [
            (e.clientX - rect.left) * scaleX,
            (e.clientY - rect.top)  * scaleY,
        ]
    }

    // ── Render ────────────────────────────────────────────────────────────────

    function render() {
        if (!canvasEl) return
        const ctx = getCtx()
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)

        for (const el of cs.snapshot()) {
            drawElement(ctx, el)
        }

        // Draw live preview for shape tools
        if (previewEl && (tool === 'rect' || tool === 'circle')) {
            ctx.save()
            ctx.strokeStyle = color
            ctx.lineWidth   = lineWidth
            ctx.setLineDash([6, 3])
            ctx.globalAlpha = 0.7
            if (tool === 'rect') {
                ctx.strokeRect(previewEl.x, previewEl.y, previewEl.w, previewEl.h)
            } else {
                const rx = previewEl.w / 2
                const ry = previewEl.h / 2
                ctx.beginPath()
                ctx.ellipse(previewEl.x + rx, previewEl.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
                ctx.stroke()
            }
            ctx.restore()
        }
    }

    function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement) {
        ctx.save()
        if (el.kind === 'pen') {
            const d = el.data as PathData
            if (d.points.length < 2) { ctx.restore(); return }
            ctx.strokeStyle = d.color
            ctx.lineWidth   = d.width
            ctx.lineCap     = 'round'
            ctx.lineJoin    = 'round'
            ctx.beginPath()
            ctx.moveTo(d.points[0][0], d.points[0][1])
            for (let i = 1; i < d.points.length; i++) {
                ctx.lineTo(d.points[i][0], d.points[i][1])
            }
            ctx.stroke()
        } else if (el.kind === 'rect') {
            const d = el.data as ShapeData
            ctx.strokeStyle = d.color
            ctx.lineWidth   = lineWidth
            if (d.fill) { ctx.fillStyle = d.color + '33'; ctx.fillRect(d.x, d.y, d.w, d.h) }
            ctx.strokeRect(d.x, d.y, d.w, d.h)
        } else if (el.kind === 'circle') {
            const d = el.data as ShapeData
            const rx = d.w / 2, ry = d.h / 2
            ctx.strokeStyle = d.color
            ctx.lineWidth   = lineWidth
            ctx.beginPath()
            ctx.ellipse(d.x + rx, d.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
            if (d.fill) { ctx.fillStyle = d.color + '33'; ctx.fill() }
            ctx.stroke()
        } else if (el.kind === 'sticky') {
            const d = el.data as StickyData
            const W = 200, H = 120, pad = 12
            ctx.shadowColor  = 'rgba(0,0,0,0.4)'
            ctx.shadowBlur   = 12
            ctx.shadowOffsetY = 4
            ctx.fillStyle    = d.color
            ctx.beginPath()
            ctx.roundRect(d.x, d.y, W, H, 8)
            ctx.fill()
            ctx.shadowColor  = 'transparent'
            // Wrap text
            ctx.fillStyle = '#1a1a2e'
            ctx.font      = '14px system-ui, sans-serif'
            const words = d.text.split(' ')
            let line = ''
            let ty = d.y + pad + 14
            for (const word of words) {
                const test = line + (line ? ' ' : '') + word
                if (ctx.measureText(test).width > W - pad * 2) {
                    if (line) ctx.fillText(line, d.x + pad, ty, W - pad * 2)
                    line = word
                    ty += 18
                    if (ty > d.y + H - pad) break
                } else {
                    line = test
                }
            }
            if (line) ctx.fillText(line, d.x + pad, ty, W - pad * 2)
        }
        ctx.restore()
    }

    // ── Pointer event handlers ────────────────────────────────────────────────

    function onPointerDown(e: PointerEvent) {
        if (e.button !== 0) return
        canvasEl.setPointerCapture(e.pointerId)
        const [x, y] = pointerPos(e)

        if (tool === 'sticky') {
            stickyEdit = { x, y }
            stickyText = ''
            return
        }

        if (tool === 'eraser') {
            eraseAt(x, y)
            isDrawing = true
            return
        }

        isDrawing = true
        currentId = crypto.randomUUID()
        dragStart = { x, y }

        if (tool === 'pen') {
            currentPath = [[x, y]]
        }
    }

    function onPointerMove(e: PointerEvent) {
        const [x, y] = pointerPos(e)

        // Send cursor to peers (throttled 50ms)
        const now = Date.now()
        if (now - lastCursorSend > 50 && p2pManager) {
            lastCursorSend = now
            const vs = $voiceStore as any
            const mySpeaking = vs.mySpeaking ?? false
            p2pManager.send({
                type: 'canvas:cursor',
                x: x / canvasEl.width,
                y: y / canvasEl.height,
                userId,
                username,
                speaking: mySpeaking,
            })
        }

        if (!isDrawing) return

        if (tool === 'eraser') { eraseAt(x, y); return }
        if (tool === 'pen' && currentPath.length > 0) {
            currentPath = [...currentPath, [x, y]]
            const op: CanvasElement = {
                id: currentId, ts: Date.now(), author: userId,
                kind: 'pen', data: { points: currentPath, color, width: lineWidth },
            }
            cs.apply(op)
            render()
            p2pManager.send({ type: 'canvas:op', ...op })
            return
        }
        if ((tool === 'rect' || tool === 'circle') && dragStart) {
            previewEl = {
                x: Math.min(dragStart.x, x),
                y: Math.min(dragStart.y, y),
                w: Math.abs(x - dragStart.x),
                h: Math.abs(y - dragStart.y),
            }
            render()
        }
    }

    function onPointerUp(e: PointerEvent) {
        if (!isDrawing) return
        isDrawing = false
        const [x, y] = pointerPos(e)

        if (tool === 'pen' && currentPath.length > 1) {
            const op: CanvasElement = {
                id: currentId, ts: Date.now(), author: userId,
                kind: 'pen', data: { points: currentPath, color, width: lineWidth },
            }
            cs.apply(op)
            undoStack.push(currentId)
            p2pManager.send({ type: 'canvas:op', ...op })
            currentPath = []
            render()
        } else if ((tool === 'rect' || tool === 'circle') && dragStart && previewEl) {
            const d: ShapeData = { ...previewEl, color, fill: false }
            const op: CanvasElement = {
                id: currentId, ts: Date.now(), author: userId,
                kind: tool, data: d,
            }
            cs.apply(op)
            undoStack.push(currentId)
            p2pManager.send({ type: 'canvas:op', ...op })
            previewEl = null
            dragStart = null
            render()
        }
    }

    function eraseAt(x: number, y: number) {
        const RADIUS = 20
        for (const el of cs.snapshot()) {
            if (hitTest(el, x, y, RADIUS)) {
                const del = { ...el, deleted: true, ts: Date.now() }
                cs.apply(del)
                p2pManager.send({ type: 'canvas:op', ...del })
            }
        }
        render()
    }

    function hitTest(el: CanvasElement, x: number, y: number, r: number): boolean {
        if (el.kind === 'pen') {
            const d = el.data as PathData
            return d.points.some(([px, py]) => Math.hypot(px - x, py - y) < r)
        }
        if (el.kind === 'sticky') {
            const d = el.data as StickyData
            return x >= d.x && x <= d.x + 200 && y >= d.y && y <= d.y + 120
        }
        if (el.kind === 'rect' || el.kind === 'circle') {
            const d = el.data as ShapeData
            return x >= d.x - r && x <= d.x + d.w + r &&
                   y >= d.y - r && y <= d.y + d.h + r
        }
        return false
    }

    // ── Sticky note submit ────────────────────────────────────────────────────

    function submitSticky() {
        if (!stickyEdit || !stickyText.trim()) { stickyEdit = null; return }
        const op: CanvasElement = {
            id: crypto.randomUUID(), ts: Date.now(), author: userId,
            kind: 'sticky',
            data: { x: stickyEdit.x, y: stickyEdit.y, text: stickyText.trim(), color } as StickyData,
        }
        cs.apply(op)
        undoStack.push(op.id)
        p2pManager.send({ type: 'canvas:op', ...op })
        render()
        stickyEdit = null
        stickyText = ''
    }

    // ── Undo ──────────────────────────────────────────────────────────────────

    function undo() {
        const id = undoStack.pop()
        if (!id) return
        const el = cs.elements.get(id)
        if (!el) return
        const del = { ...el, deleted: true, ts: Date.now() }
        cs.apply(del)
        p2pManager.send({ type: 'canvas:op', ...del })
        render()
    }

    // ── Clear all ─────────────────────────────────────────────────────────────

    function clearAll() {
        const ts = Date.now()
        cs.clear(ts)
        p2pManager.send({ type: 'canvas:clear', by: userId, ts })
        render()
    }

    // ── P2P receive ───────────────────────────────────────────────────────────

    function onP2PMessage(e: Event) {
        const msg = (e as CustomEvent<CanvasP2PMessage>).detail
        if (!msg?.type?.startsWith('canvas:')) return

        if (msg.type === 'canvas:op') {
            const { type: _, ...op } = msg
            if (cs.apply(op as CanvasElement)) render()
        } else if (msg.type === 'canvas:clear') {
            cs.clear(msg.ts)
            render()
        } else if (msg.type === 'canvas:cursor') {
            const { userId: uid, username: uname, x, y, speaking } = msg
            if (uid === userId) return
            const next = new Map(remoteCursors)
            next.set(uid, {
                x: x * canvasEl.width,
                y: y * canvasEl.height,
                userId: uid, username: uname, speaking,
                lastSeen: Date.now(),
            })
            remoteCursors = next
        }
    }

    // Handle speaking events from Socket.IO to update cursor speaking state
    function onVoiceSpeaking({ userId: uid, speaking }: { userId: string; speaking: boolean }) {
        const cursor = remoteCursors.get(uid)
        if (!cursor) return
        const next = new Map(remoteCursors)
        next.set(uid, { ...cursor, speaking })
        remoteCursors = next
    }

    // ── Close / end dialog ────────────────────────────────────────────────────

    function requestClose() {
        if (!cs.isEmpty()) {
            showEndDialog = true
        } else {
            onclose()
        }
    }

    async function saveAndClose() {
        showEndDialog = false
        // 1. Export PNG
        const blob = await new Promise<Blob | null>((res) => canvasEl.toBlob(res, 'image/png'))
        if (blob) {
            const url = URL.createObjectURL(blob)
            const a   = document.createElement('a')
            a.href     = url
            a.download = 'nodyx-table.png'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            setTimeout(() => URL.revokeObjectURL(url), 5000)
        }
        // 2. Post recap to text channel
        postRecap()
        onclose()
    }

    function discardAndClose() {
        showEndDialog = false
        onclose()
    }

    function postRecap() {
        if (!channelId || !socket) return
        const authors = cs.authorSet()
        const count   = cs.snapshot().length
        const content = `📋 **Table de travail** — ${count} élément${count > 1 ? 's' : ''} créé${count > 1 ? 's' : ''} par ${authors.join(', ')}.`
        socket.emit('chat:send', { channelId, content })
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────

    function onKeydown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault()
            undo()
        }
        if (e.key === 'Escape') {
            if (stickyEdit) { stickyEdit = null; return }
            requestClose()
        }
        if (e.key === 'Enter' && stickyEdit) {
            e.preventDefault()
            submitSticky()
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onMount(() => {
        if (!browser) return
        render()
        window.addEventListener('p2p:message', onP2PMessage)
        window.addEventListener('keydown', onKeydown)
        socket?.on('voice:speaking', onVoiceSpeaking)
        // Join the voice channel P2P mesh — ICE servers are already set from voice:init
        if (voiceChannelId) p2pManager.joinChannel(voiceChannelId)

        // Periodic cleanup of stale cursors (> 4 s)
        cursorInterval = setInterval(() => {
            const now = Date.now()
            let changed = false
            for (const [id] of remoteCursors) {
                if ((remoteCursors.get(id)?.lastSeen ?? 0) + 4000 < now) {
                    remoteCursors.delete(id)
                    changed = true
                }
            }
            if (changed) remoteCursors = new Map(remoteCursors)
        }, 1000)
    })

    onDestroy(() => {
        if (!browser) return
        window.removeEventListener('p2p:message', onP2PMessage)
        window.removeEventListener('keydown', onKeydown)
        socket?.off('voice:speaking', onVoiceSpeaking)
        clearInterval(cursorInterval)
        // Restore text channel P2P (or leave if no text channel)
        if (channelId) p2pManager.joinChannel(channelId)
        else p2pManager.leaveChannel()
    })
</script>

<!-- ── Overlay backdrop ──────────────────────────────────────────────────────── -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    role="dialog"
    aria-label="Table collaborative"
    tabindex="-1"
    class="fixed inset-0 z-[200] flex items-center justify-center"
    style="background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);"
    onmousedown={(e) => { if (e.target === e.currentTarget) requestClose() }}
>
    <!-- Canvas container -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        class="relative flex items-start gap-3"
        onmousedown={(e) => e.stopPropagation()}
        role="presentation"
    >
        <!-- Toolbar -->
        <CanvasToolbar
            bind:tool
            bind:color
            bind:lineWidth
            onUndo={undo}
            onClear={clearAll}
            onClose={requestClose}
        />

        <!-- Canvas + cursors wrapper -->
        <div class="relative rounded-xl overflow-hidden border border-indigo-500/30 shadow-2xl shadow-black/60"
             style="width:{canvasW}px; height:{canvasH}px; max-width:calc(100vw - 120px); max-height:calc(100vh - 80px);">

            <!-- Background grid -->
            <div class="absolute inset-0 bg-gray-950"
                 style="background-image: radial-gradient(circle, #374151 1px, transparent 1px);
                         background-size: 28px 28px;"></div>

            <!-- HTML5 Canvas -->
            <canvas
                bind:this={canvasEl}
                width={canvasW}
                height={canvasH}
                class="absolute inset-0 w-full h-full touch-none"
                style="cursor: {tool === 'eraser' ? 'cell' : tool === 'sticky' ? 'text' : 'crosshair'};"
                onpointerdown={onPointerDown}
                onpointermove={onPointerMove}
                onpointerup={onPointerUp}
                onpointerleave={onPointerUp}
            ></canvas>

            <!-- Remote cursors -->
            {#each [...remoteCursors.values()] as cursor (cursor.userId)}
                <div
                    class="absolute pointer-events-none select-none"
                    style="left:{cursor.x}px; top:{cursor.y}px; transform:translate(-4px,-4px); z-index:10;"
                >
                    <div class="relative">
                        <div
                            class="w-3 h-3 rounded-full border-2 border-white shadow-lg"
                            class:canvas-cursor-speaking={cursor.speaking}
                            style="background: {cursor.speaking ? '#a855f7' : '#4ade80'};"
                        ></div>
                        <span class="absolute left-4 -top-1 whitespace-nowrap text-xs font-semibold
                                     text-white bg-gray-900/80 px-1.5 py-0.5 rounded shadow"
                        >
                            {cursor.username}
                        </span>
                    </div>
                </div>
            {/each}

            <!-- Sticky input overlay -->
            {#if stickyEdit}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                    class="absolute z-20"
                    style="left:{stickyEdit.x}px; top:{stickyEdit.y}px;"
                    role="presentation"
                    onmousedown={(e) => e.stopPropagation()}
                >
                    <div class="rounded-xl shadow-2xl overflow-hidden border border-yellow-400/40"
                         style="background:{color}; width:200px;">
                        <textarea
                            class="w-full p-3 text-sm font-medium resize-none outline-none bg-transparent
                                   text-gray-900 placeholder-gray-600"
                            rows="4"
                            placeholder="Note..."
                            bind:value={stickyText}
                            onblur={submitSticky}
                        ></textarea>
                        <div class="flex gap-1 p-1 border-t border-black/10">
                            <button
                                class="flex-1 text-xs py-1 rounded bg-black/10 hover:bg-black/20 text-gray-900 font-medium"
                                onmousedown={(e) => { e.preventDefault(); submitSticky() }}
                            >OK</button>
                            <button
                                class="flex-1 text-xs py-1 rounded bg-black/10 hover:bg-black/20 text-gray-900"
                                onmousedown={(e) => { e.preventDefault(); stickyEdit = null }}
                            >✕</button>
                        </div>
                    </div>
                </div>
            {/if}

            <!-- Header badge -->
            <div class="absolute top-3 left-3 flex items-center gap-2 z-10 pointer-events-none">
                <div class="flex items-center gap-1.5 bg-gray-900/80 backdrop-blur px-3 py-1.5 rounded-full
                             border border-violet-500/30 text-xs font-semibold text-violet-300">
                    <span class="w-2 h-2 rounded-full bg-violet-400 animate-pulse"></span>
                    Table collaborative P2P
                </div>
            </div>
        </div>
    </div>

    <!-- ── End dialog ──────────────────────────────────────────────────────── -->
    {#if showEndDialog}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            class="absolute inset-0 flex items-center justify-center z-[201]"
            role="presentation"
            onmousedown={(e) => e.stopPropagation()}
        >
            <div class="bg-gray-900 border border-violet-500/40 rounded-2xl p-8 shadow-2xl
                        flex flex-col items-center gap-5 max-w-sm w-full mx-4
                        ring-1 ring-white/5">
                <div class="text-4xl">🎨</div>
                <div class="text-center">
                    <p class="text-white font-bold text-lg mb-1">Garder la table de travail ?</p>
                    <p class="text-gray-400 text-sm">La session est éphémère — si tu fermes sans garder, tout disparaît.</p>
                </div>
                <div class="flex flex-col gap-2 w-full">
                    <button
                        onclick={saveAndClose}
                        class="w-full py-3 rounded-xl font-bold text-white
                               bg-gradient-to-r from-violet-600 to-purple-600
                               hover:from-violet-500 hover:to-purple-500
                               shadow-lg shadow-violet-500/30
                               transition-all hover:scale-[1.02] active:scale-[0.98]
                               flex items-center justify-center gap-2"
                    >
                        <span>📥</span> Télécharger PNG + résumé chat
                    </button>
                    <button
                        onclick={discardAndClose}
                        class="w-full py-2.5 rounded-xl font-medium text-gray-400 hover:text-white
                               bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700
                               transition-all hover:scale-[1.01] active:scale-[0.99]
                               flex items-center justify-center gap-2"
                    >
                        <span>🗑️</span> Jeter et fermer
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    /* Speaking cursor halo — same nodyx-pulse as VoicePanel avatars */
    .canvas-cursor-speaking {
        animation: avatar-breathe 1.5s ease-in-out infinite;
        filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.9));
    }

    .canvas-cursor-speaking::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 350%;
        height: 350%;
        border-radius: 50%;
        background: radial-gradient(circle,
            rgba(168, 85, 247, 0.9) 0%,
            rgba(74, 222, 128, 0.5) 50%,
            transparent 80%
        );
        animation: nodyx-pulse 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        pointer-events: none;
        z-index: -1;
        filter: blur(3px);
    }

    @keyframes nodyx-pulse {
        0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
        60%  { opacity: 0.6; transform: translate(-50%, -50%) scale(1.8); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(2.5); }
    }

    @keyframes avatar-breathe {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
    }
</style>
