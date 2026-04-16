<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { browser }           from '$app/environment'
	import CanvasToolbar         from './CanvasToolbar.svelte'
	import {
		CanvasState, DEFAULT_TRANSFORM, screenToWorld, worldToScreen, zoomAt,
		type CanvasTool, type CanvasElement, type ViewTransform,
		type PathData, type StickyData, type ShapeData, type TextData, type ArrowData,
	} from '$lib/canvas'
	import { voiceStore } from '$lib/voice'

	// ── Props ─────────────────────────────────────────────────────────────────
	let {
		boardId,
		channelId,    // text channel — for recap message on close
		socket,
		userId,
		username,
		onclose = () => {},
	}: {
		boardId:      string
		channelId:    string | null
		socket:       any
		userId:       string
		username:     string
		onclose:      () => void
	} = $props()

	// ── Canvas refs ───────────────────────────────────────────────────────────
	let canvasEl:       HTMLCanvasElement
	let containerEl:    HTMLDivElement
	let cs = new CanvasState()

	// ── Tool state ────────────────────────────────────────────────────────────
	let tool = $state<CanvasTool>('pen')
	let color:     string     = $state('#e879f9')
	let lineWidth: number     = $state(3)

	// ── View transform (pan + zoom) ───────────────────────────────────────────
	let transform: ViewTransform = $state({ ...DEFAULT_TRANSFORM })
	let isPanning  = false
	let panStart   = { x: 0, y: 0, ox: 0, oy: 0 }
	let spaceDown  = false

	// ── Drawing state ─────────────────────────────────────────────────────────
	let isDrawing    = false
	let currentPath: [number, number][] = []
	let currentId    = ''
	let dragStart:   { x: number; y: number } | null = null
	let previewEl:   { x: number; y: number; w: number; h: number } | null = null
	let arrowPreview: { x1: number; y1: number; x2: number; y2: number } | null = null

	// Sticky / text editing overlay
	let overlayEdit: { x: number; y: number; kind: 'sticky' | 'text' } | null = $state(null)
	let overlayText  = $state('')
	let overlayFontSize = $state(18)

	// Local undo stack
	const undoStack: string[] = []

	// ── Select tool ───────────────────────────────────────────────────────────
	let selectedId:  string | null = $state(null)
	let dragMove:    { startX: number; startY: number; origData: unknown } | null = null

	// ── Remote cursors ────────────────────────────────────────────────────────
	type RemoteCursor = {
		wx: number; wy: number        // world coordinates
		userId: string; username: string
		speaking: boolean
		lastSeen: number
	}
	let remoteCursors: Map<string, RemoteCursor> = $state(new Map())
	let cursorThrottle = 0

	// ── UI state ──────────────────────────────────────────────────────────────
	let showEndDialog = $state(false)
	let synced        = $state(false)   // true once server snapshot received

	// ── Helpers ───────────────────────────────────────────────────────────────

	function getCtx(): CanvasRenderingContext2D {
		return canvasEl.getContext('2d')!
	}

	/** Pointer event → world coordinates */
	function pointerWorld(e: PointerEvent): [number, number] {
		const rect = canvasEl.getBoundingClientRect()
		const sx = e.clientX - rect.left
		const sy = e.clientY - rect.top
		return screenToWorld(sx, sy, transform)
	}

	// ── Render ────────────────────────────────────────────────────────────────

	function render() {
		if (!canvasEl) return
		const ctx = getCtx()
		const W = canvasEl.width
		const H = canvasEl.height

		ctx.clearRect(0, 0, W, H)

		// Apply view transform
		ctx.save()
		ctx.setTransform(transform.scale, 0, 0, transform.scale, transform.x, transform.y)

		// Grid (drawn in world space — no scale correction needed)
		drawGrid(ctx, W, H)

		for (const el of cs.snapshot()) {
			const isSelected = el.id === selectedId
			drawElement(ctx, el, isSelected)
		}

		// Live previews
		if (previewEl && (tool === 'rect' || tool === 'circle')) {
			ctx.save()
			ctx.strokeStyle = color
			ctx.lineWidth   = lineWidth
			ctx.setLineDash([6, 3])
			ctx.globalAlpha = 0.7
			if (tool === 'rect') {
				ctx.strokeRect(previewEl.x, previewEl.y, previewEl.w, previewEl.h)
			} else {
				const rx = previewEl.w / 2, ry = previewEl.h / 2
				ctx.beginPath()
				ctx.ellipse(previewEl.x + rx, previewEl.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
				ctx.stroke()
			}
			ctx.restore()
		}
		if (arrowPreview) {
			drawArrow(ctx, arrowPreview.x1, arrowPreview.y1, arrowPreview.x2, arrowPreview.y2, color, lineWidth, 0.6)
		}

		ctx.restore()
	}

	function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
		// World-space grid origin → convert screen bounds to world space to know what to draw
		const t = transform
		const wxMin = -t.x / t.scale
		const wyMin = -t.y / t.scale
		const wxMax = (W - t.x) / t.scale
		const wyMax = (H - t.y) / t.scale

		const CELL = 28
		ctx.strokeStyle = 'rgba(55,65,81,0.5)'
		ctx.lineWidth   = 1 / t.scale
		ctx.beginPath()

		const startX = Math.floor(wxMin / CELL) * CELL
		for (let x = startX; x < wxMax; x += CELL) {
			ctx.moveTo(x, wyMin)
			ctx.lineTo(x, wyMax)
		}
		const startY = Math.floor(wyMin / CELL) * CELL
		for (let y = startY; y < wyMax; y += CELL) {
			ctx.moveTo(wxMin, y)
			ctx.lineTo(wxMax, y)
		}
		ctx.stroke()
	}

	function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, selected = false) {
		ctx.save()
		if (selected) {
			ctx.shadowColor = '#818cf8'
			ctx.shadowBlur  = 12 / transform.scale
		}

		if (el.kind === 'pen') {
			const d = el.data as PathData
			if (d.points.length < 2) { ctx.restore(); return }
			ctx.strokeStyle = d.color
			ctx.lineWidth   = d.width
			ctx.lineCap     = 'round'
			ctx.lineJoin    = 'round'
			ctx.beginPath()
			ctx.moveTo(d.points[0][0], d.points[0][1])
			for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i][0], d.points[i][1])
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
			const d  = el.data as StickyData
			const W  = d.w ?? 200
			const H  = d.h ?? 120
			const pad = 12
			ctx.shadowColor  = 'rgba(0,0,0,0.4)'
			ctx.shadowBlur   = 12
			ctx.shadowOffsetY = 4
			ctx.fillStyle    = d.color
			ctx.beginPath()
			ctx.roundRect(d.x, d.y, W, H, 8)
			ctx.fill()
			ctx.shadowColor = 'transparent'
			ctx.fillStyle   = '#1a1a2e'
			ctx.font        = '14px system-ui, sans-serif'
			wrapText(ctx, d.text, d.x + pad, d.y + pad + 14, W - pad * 2, 18, H - pad * 2)

		} else if (el.kind === 'text') {
			const d = el.data as TextData
			const style = `${d.italic ? 'italic ' : ''}${d.bold ? 'bold ' : ''}${d.fontSize ?? 18}px system-ui, sans-serif`
			ctx.font        = style
			ctx.fillStyle   = d.color
			ctx.shadowColor = 'rgba(0,0,0,0.5)'
			ctx.shadowBlur  = 4
			wrapText(ctx, d.text, d.x, d.y, 400, (d.fontSize ?? 18) + 4, 2000)

		} else if (el.kind === 'arrow') {
			const d = el.data as ArrowData
			drawArrow(ctx, d.x1, d.y1, d.x2, d.y2, d.color, d.width, 1)
		}

		ctx.restore()
	}

	function drawArrow(
		ctx: CanvasRenderingContext2D,
		x1: number, y1: number, x2: number, y2: number,
		col: string, w: number, alpha: number
	) {
		const angle  = Math.atan2(y2 - y1, x2 - x1)
		const headLen = Math.max(16, w * 4)
		ctx.save()
		ctx.globalAlpha = alpha
		ctx.strokeStyle = col
		ctx.fillStyle   = col
		ctx.lineWidth   = w
		ctx.lineCap     = 'round'
		ctx.beginPath()
		ctx.moveTo(x1, y1)
		ctx.lineTo(x2, y2)
		ctx.stroke()
		// Arrowhead
		ctx.beginPath()
		ctx.moveTo(x2, y2)
		ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
		ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
		ctx.closePath()
		ctx.fill()
		ctx.restore()
	}

	function wrapText(
		ctx: CanvasRenderingContext2D,
		text: string, x: number, y: number,
		maxW: number, lineH: number, maxH: number
	) {
		const words = text.split(' ')
		let line = '', ty = y
		for (const word of words) {
			const test = line + (line ? ' ' : '') + word
			if (ctx.measureText(test).width > maxW && line) {
				ctx.fillText(line, x, ty, maxW)
				line = word; ty += lineH
				if (ty > y + maxH) break
			} else { line = test }
		}
		if (line) ctx.fillText(line, x, ty, maxW)
	}

	// ── Pan / Zoom ────────────────────────────────────────────────────────────

	function onWheel(e: WheelEvent) {
		e.preventDefault()
		const rect = canvasEl.getBoundingClientRect()
		transform  = zoomAt(transform, e.deltaY, e.clientX - rect.left, e.clientY - rect.top)
		render()
	}

	// ── Pointer handlers ──────────────────────────────────────────────────────

	function onPointerDown(e: PointerEvent) {
		// Middle button → pan
		if (e.button === 1) { startPan(e); return }
		// Space + left → pan
		if (e.button === 0 && spaceDown) { startPan(e); return }
		if (e.button !== 0) return

		canvasEl.setPointerCapture(e.pointerId)
		const [wx, wy] = pointerWorld(e)

		if (tool === 'sticky' || tool === 'text') {
			overlayEdit = { x: wx, y: wy, kind: tool }
			overlayText = ''
			return
		}
		if (tool === 'eraser') { eraseAt(wx, wy); isDrawing = true; return }

		if (tool === 'select') {
			const hit = hitTestAll(wx, wy)
			selectedId  = hit?.id ?? null
			if (hit) {
				dragMove = { startX: wx, startY: wy, origData: structuredClone(hit.data) }
			}
			render()
			return
		}

		isDrawing  = true
		currentId  = crypto.randomUUID()
		dragStart  = { x: wx, y: wy }
		if (tool === 'pen') currentPath = [[wx, wy]]
	}

	function onPointerMove(e: PointerEvent) {
		if (isPanning) { updatePan(e); return }

		const [wx, wy] = pointerWorld(e)

		// Throttled cursor broadcast (50 ms)
		const now = Date.now()
		if (now - cursorThrottle > 50) {
			cursorThrottle = now
			const vs = $voiceStore as any
			socket?.emit('canvas:cursor', {
				boardId, x: wx, y: wy,
				speaking: vs.mySpeaking ?? false,
			})
		}

		if (!isDrawing && !dragMove) return

		if (tool === 'select' && dragMove && selectedId) {
			const el = cs.elements.get(selectedId)
			if (!el) return
			const dx = wx - dragMove.startX
			const dy = wy - dragMove.startY
			const moved = moveElement(el, dragMove.origData, dx, dy)
			if (moved) { cs.apply(moved); render() }
			return
		}
		if (tool === 'eraser') { eraseAt(wx, wy); return }
		if (tool === 'pen' && currentPath.length > 0) {
			currentPath = [...currentPath, [wx, wy]]
			const op: CanvasElement = {
				id: currentId, ts: Date.now(), author: userId,
				kind: 'pen', data: { points: currentPath, color, width: lineWidth },
			}
			cs.apply(op); render()
			socket?.emit('canvas:op', { boardId, op })
			return
		}
		if ((tool === 'rect' || tool === 'circle') && dragStart) {
			previewEl = {
				x: Math.min(dragStart.x, wx), y: Math.min(dragStart.y, wy),
				w: Math.abs(wx - dragStart.x), h: Math.abs(wy - dragStart.y),
			}
			render()
		}
		if (tool === 'arrow' && dragStart) {
			arrowPreview = { x1: dragStart.x, y1: dragStart.y, x2: wx, y2: wy }
			render()
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (isPanning) { isPanning = false; return }

		// Finalise select drag
		if (tool === 'select' && dragMove && selectedId) {
			const el = cs.elements.get(selectedId)
			if (el) socket?.emit('canvas:op', { boardId, op: el })
			dragMove = null
			return
		}

		if (!isDrawing) return
		isDrawing = false
		const [wx, wy] = pointerWorld(e)

		if (tool === 'pen' && currentPath.length > 1) {
			const op: CanvasElement = {
				id: currentId, ts: Date.now(), author: userId,
				kind: 'pen', data: { points: currentPath, color, width: lineWidth },
			}
			cs.apply(op); undoStack.push(currentId)
			socket?.emit('canvas:op', { boardId, op })
			currentPath = []; render()

		} else if ((tool === 'rect' || tool === 'circle') && dragStart && previewEl) {
			const op: CanvasElement = {
				id: currentId, ts: Date.now(), author: userId,
				kind: tool, data: { ...previewEl, color, fill: false },
			}
			cs.apply(op); undoStack.push(currentId)
			socket?.emit('canvas:op', { boardId, op })
			previewEl = null; dragStart = null; render()

		} else if (tool === 'arrow' && dragStart) {
			if (Math.hypot(wx - dragStart.x, wy - dragStart.y) > 10) {
				const op: CanvasElement = {
					id: currentId, ts: Date.now(), author: userId,
					kind: 'arrow',
					data: { x1: dragStart.x, y1: dragStart.y, x2: wx, y2: wy, color, width: lineWidth },
				}
				cs.apply(op); undoStack.push(currentId)
				socket?.emit('canvas:op', { boardId, op })
			}
			arrowPreview = null; dragStart = null; render()
		}
	}

	// ── Pan helpers ───────────────────────────────────────────────────────────

	function startPan(e: PointerEvent) {
		isPanning = true
		panStart  = { x: e.clientX, y: e.clientY, ox: transform.x, oy: transform.y }
		canvasEl.setPointerCapture(e.pointerId)
	}

	function updatePan(e: PointerEvent) {
		transform = {
			...transform,
			x: panStart.ox + (e.clientX - panStart.x),
			y: panStart.oy + (e.clientY - panStart.y),
		}
		render()
	}

	// ── Select: move element ──────────────────────────────────────────────────

	function moveElement(el: CanvasElement, orig: unknown, dx: number, dy: number): CanvasElement | null {
		const d = orig as Record<string, number>
		if (!d) return null
		const ts = Date.now()

		if (el.kind === 'pen') {
			const od = orig as PathData
			return { ...el, ts, data: { ...od, points: od.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) } }
		}
		if (el.kind === 'sticky' || el.kind === 'rect' || el.kind === 'circle') {
			return { ...el, ts, data: { ...d, x: d.x + dx, y: d.y + dy } as any }
		}
		if (el.kind === 'text') {
			return { ...el, ts, data: { ...d, x: d.x + dx, y: d.y + dy } as any }
		}
		if (el.kind === 'arrow') {
			const od = orig as ArrowData
			return { ...el, ts, data: { ...od, x1: od.x1 + dx, y1: od.y1 + dy, x2: od.x2 + dx, y2: od.y2 + dy } }
		}
		return null
	}

	// ── Erase ─────────────────────────────────────────────────────────────────

	function eraseAt(wx: number, wy: number) {
		const R = 20 / transform.scale
		for (const el of cs.snapshot()) {
			if (hitTest(el, wx, wy, R)) {
				const del = { ...el, deleted: true, ts: Date.now() }
				cs.apply(del)
				socket?.emit('canvas:op', { boardId, op: del })
			}
		}
		render()
	}

	function hitTestAll(wx: number, wy: number): CanvasElement | undefined {
		const R = 8 / transform.scale
		return [...cs.snapshot()].reverse().find(el => hitTest(el, wx, wy, R))
	}

	function hitTest(el: CanvasElement, wx: number, wy: number, r: number): boolean {
		if (el.kind === 'pen') {
			const d = el.data as PathData
			return d.points.some(([px, py]) => Math.hypot(px - wx, py - wy) < r)
		}
		if (el.kind === 'sticky') {
			const d = el.data as StickyData
			return wx >= d.x && wx <= d.x + (d.w ?? 200) && wy >= d.y && wy <= d.y + (d.h ?? 120)
		}
		if (el.kind === 'rect' || el.kind === 'circle') {
			const d = el.data as ShapeData
			return wx >= d.x - r && wx <= d.x + d.w + r && wy >= d.y - r && wy <= d.y + d.h + r
		}
		if (el.kind === 'text') {
			const d = el.data as TextData
			return wx >= d.x - r && wx <= d.x + 400 && wy >= d.y - (d.fontSize ?? 18) - r && wy <= d.y + r
		}
		if (el.kind === 'arrow') {
			const d = el.data as ArrowData
			// Hit test: distance from point to segment
			const dx = d.x2 - d.x1, dy = d.y2 - d.y1
			const len2 = dx * dx + dy * dy
			if (len2 === 0) return Math.hypot(wx - d.x1, wy - d.y1) < r
			const t = Math.max(0, Math.min(1, ((wx - d.x1) * dx + (wy - d.y1) * dy) / len2))
			const px = d.x1 + t * dx, py = d.y1 + t * dy
			return Math.hypot(wx - px, wy - py) < r * 2
		}
		return false
	}

	// ── Overlay submit (sticky / text) ────────────────────────────────────────

	function submitOverlay() {
		if (!overlayEdit || !overlayText.trim()) { overlayEdit = null; return }
		const { x, y, kind } = overlayEdit
		let data: StickyData | TextData

		if (kind === 'sticky') {
			data = { x, y, text: overlayText.trim(), color } as StickyData
		} else {
			data = { x, y, text: overlayText.trim(), color, fontSize: overlayFontSize, bold: false, italic: false } as TextData
		}

		const op: CanvasElement = {
			id: crypto.randomUUID(), ts: Date.now(), author: userId, kind, data,
		}
		cs.apply(op); undoStack.push(op.id)
		socket?.emit('canvas:op', { boardId, op })
		render()
		overlayEdit = null; overlayText = ''
	}

	// ── Undo ──────────────────────────────────────────────────────────────────

	function undo() {
		const id = undoStack.pop()
		if (!id) return
		const el = cs.elements.get(id)
		if (!el) return
		const del = { ...el, deleted: true, ts: Date.now() }
		cs.apply(del); socket?.emit('canvas:op', { boardId, op: del }); render()
	}

	// ── Clear ─────────────────────────────────────────────────────────────────

	function clearAll() {
		const ts = Date.now()
		cs.clear(ts); socket?.emit('canvas:clear', { boardId, ts }); render()
	}

	// ── Socket.IO receive ─────────────────────────────────────────────────────

	function handleSnapshot({ elements }: { boardId: string; elements: CanvasElement[] }) {
		cs.loadSnapshot(elements)
		synced = true
		render()
	}

	function handleRemoteOp({ op }: { boardId: string; op: CanvasElement }) {
		if (cs.apply(op)) render()
	}

	function handleRemoteClear({ ts }: { boardId: string; ts: number }) {
		cs.clear(ts); render()
	}

	function handleRemoteCursor({ userId: uid, username: uname, x, y, speaking }:
		{ boardId: string; userId: string; username: string; x: number; y: number; speaking: boolean }
	) {
		if (uid === userId) return
		const next = new Map(remoteCursors)
		next.set(uid, { wx: x, wy: y, userId: uid, username: uname, speaking, lastSeen: Date.now() })
		remoteCursors = next
	}

	function onVoiceSpeaking({ userId: uid, speaking }: { userId: string; speaking: boolean }) {
		const c = remoteCursors.get(uid)
		if (!c) return
		const next = new Map(remoteCursors)
		next.set(uid, { ...c, speaking })
		remoteCursors = next
	}

	// ── Save / close ──────────────────────────────────────────────────────────

	function requestClose() {
		if (!cs.isEmpty()) { showEndDialog = true } else { doClose() }
	}

	function doClose() {
		socket?.emit('canvas:save',  { boardId })
		socket?.emit('canvas:leave', { boardId })
		onclose()
	}

	async function saveAndClose() {
		showEndDialog = false
		// Export PNG
		const blob = await new Promise<Blob | null>(res => canvasEl.toBlob(res, 'image/png'))
		if (blob) {
			const url = URL.createObjectURL(blob)
			const a   = document.createElement('a')
			a.href = url; a.download = 'nodyx-canvas.png'
			document.body.appendChild(a); a.click()
			document.body.removeChild(a)
			setTimeout(() => URL.revokeObjectURL(url), 5000)
		}
		// Chat recap
		if (channelId && socket) {
			const count   = cs.snapshot().length
			const authors = cs.authorSet()
			socket.emit('chat:send', {
				channelId,
				content: `🎨 **Canvas** — ${count} élément${count > 1 ? 's' : ''} par ${authors.join(', ')}.`,
			})
		}
		doClose()
	}

	// ── Keyboard ──────────────────────────────────────────────────────────────

	function onKeydown(e: KeyboardEvent) {
		if (e.code === 'Space' && !overlayEdit) {
			spaceDown = true; e.preventDefault()
		}
		if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
		if (e.key === 'Escape') {
			if (overlayEdit) { overlayEdit = null; return }
			if (selectedId)  { selectedId  = null;  render(); return }
			requestClose()
		}
		if (e.key === 'Delete' && selectedId) {
			const el = cs.elements.get(selectedId)
			if (el) {
				const del = { ...el, deleted: true, ts: Date.now() }
				cs.apply(del); socket?.emit('canvas:op', { boardId, op: del }); render()
			}
			selectedId = null
		}
		if (e.key === 'Enter' && overlayEdit) { e.preventDefault(); submitOverlay() }
	}

	function onKeyup(e: KeyboardEvent) {
		if (e.code === 'Space') spaceDown = false
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	let cursorCleanup: ReturnType<typeof setInterval>
	let ro: ResizeObserver

	onMount(() => {
		if (!browser) return

		// Fit canvas to container
		ro = new ResizeObserver(() => {
			if (!canvasEl || !containerEl) return
			canvasEl.width  = containerEl.offsetWidth
			canvasEl.height = containerEl.offsetHeight
			render()
		})
		ro.observe(containerEl)

		// Socket.IO events
		socket?.on('canvas:snapshot',  handleSnapshot)
		socket?.on('canvas:op',        handleRemoteOp)
		socket?.on('canvas:clear',     handleRemoteClear)
		socket?.on('canvas:cursor',    handleRemoteCursor)
		socket?.on('voice:speaking',   onVoiceSpeaking)

		// Join the canvas room → triggers snapshot
		socket?.emit('canvas:join', { boardId })

		window.addEventListener('keydown', onKeydown)
		window.addEventListener('keyup',   onKeyup)

		// Stale cursor cleanup
		cursorCleanup = setInterval(() => {
			const now = Date.now()
			let changed = false
			for (const [id, c] of remoteCursors) {
				if (c.lastSeen + 4000 < now) { remoteCursors.delete(id); changed = true }
			}
			if (changed) remoteCursors = new Map(remoteCursors)
		}, 1000)
	})

	onDestroy(() => {
		if (!browser) return
		ro?.disconnect()
		socket?.off('canvas:snapshot',  handleSnapshot)
		socket?.off('canvas:op',        handleRemoteOp)
		socket?.off('canvas:clear',     handleRemoteClear)
		socket?.off('canvas:cursor',    handleRemoteCursor)
		socket?.off('voice:speaking',   onVoiceSpeaking)
		window.removeEventListener('keydown', onKeydown)
		window.removeEventListener('keyup',   onKeyup)
		clearInterval(cursorCleanup)
	})

	// Cursor screen position (reactive on transform change)
	function cursorScreenPos(c: RemoteCursor): [number, number] {
		return worldToScreen(c.wx, c.wy, transform)
	}

	// Overlay screen position
	function overlayScreenPos(): [number, number] | null {
		if (!overlayEdit) return null
		return worldToScreen(overlayEdit.x, overlayEdit.y, transform)
	}

	// Cursor style
	$effect(() => {
		if (!canvasEl) return
		if (isPanning || spaceDown) {
			canvasEl.style.cursor = isPanning ? 'grabbing' : 'grab'
		} else if (tool === 'eraser') {
			canvasEl.style.cursor = 'cell'
		} else if (tool === 'select') {
			canvasEl.style.cursor = 'default'
		} else if (tool === 'sticky' || tool === 'text') {
			canvasEl.style.cursor = 'text'
		} else {
			canvasEl.style.cursor = 'crosshair'
		}
	})
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	aria-label="Canvas collaboratif"
	tabindex="-1"
	style="position:fixed; inset:0; z-index:9999; background:#0a0a10;"
	onmousedown={(e) => { if (e.target === e.currentTarget) requestClose() }}
>
	<!-- ── Canvas container (full screen) ─────────────────────────────────── -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={containerEl}
		style="position:absolute; inset:0;"
		role="presentation"
		onmousedown={(e) => e.stopPropagation()}
	>
		<!-- HTML5 Canvas -->
		<canvas
			bind:this={canvasEl}
			style="position:absolute; inset:0; width:100%; height:100%; touch-action:none;"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointerleave={onPointerUp}
			onwheel={onWheel}
		></canvas>

		<!-- Toolbar flottante à gauche, centrée verticalement -->
		<div style="position:absolute; left:16px; top:50%; transform:translateY(-50%); z-index:20;">
			<CanvasToolbar
				bind:tool
				bind:color
				bind:lineWidth
				onUndo={undo}
				onClear={clearAll}
				onClose={requestClose}
			/>
		</div>

		<!-- Loading indicator -->
		{#if !synced}
			<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:30; pointer-events:none;">
				<div class="flex items-center gap-2 bg-gray-900/90 px-4 py-2 rounded-full border border-violet-500/30 text-violet-300 text-sm">
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
					</svg>
					Chargement du board…
				</div>
			</div>
		{/if}

		<!-- Remote cursors -->
		{#each [...remoteCursors.values()] as cursor (cursor.userId)}
			{@const [sx, sy] = cursorScreenPos(cursor)}
			<div
				class="absolute pointer-events-none select-none"
				style="left:{sx}px; top:{sy}px; transform:translate(-4px,-4px); z-index:10;"
			>
				<div class="relative">
					<div
						class="w-3 h-3 rounded-full border-2 border-white shadow-lg"
						class:canvas-cursor-speaking={cursor.speaking}
						style="background: {cursor.speaking ? '#a855f7' : '#4ade80'};"
					></div>
					<span class="absolute left-4 -top-1 whitespace-nowrap text-xs font-semibold
					             text-white bg-gray-900/80 px-1.5 py-0.5 rounded shadow">
						{cursor.username}
					</span>
				</div>
			</div>
		{/each}

		<!-- Sticky / text overlay input -->
		{#if overlayEdit}
			{@const sp = overlayScreenPos()}
			{#if sp}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="absolute z-20"
					style="left:{sp[0]}px; top:{sp[1]}px;"
					role="presentation"
					onmousedown={(e) => e.stopPropagation()}
				>
					{#if overlayEdit.kind === 'sticky'}
						<div class="rounded-xl shadow-2xl overflow-hidden border border-yellow-400/40"
						     style="background:{color}; width:200px;">
							<textarea
								class="w-full p-3 text-sm font-medium resize-none outline-none bg-transparent
								       text-gray-900 placeholder-gray-600"
								rows="4" placeholder="Note…"
								bind:value={overlayText}
								onblur={submitOverlay}
								autofocus
							></textarea>
							<div class="flex gap-1 p-1 border-t border-black/10">
								<button class="flex-1 text-xs py-1 rounded bg-black/10 hover:bg-black/20 text-gray-900 font-medium"
								        onmousedown={(e) => { e.preventDefault(); submitOverlay() }}>OK</button>
								<button class="flex-1 text-xs py-1 rounded bg-black/10 hover:bg-black/20 text-gray-900"
								        onmousedown={(e) => { e.preventDefault(); overlayEdit = null }}>✕</button>
							</div>
						</div>
					{:else}
						<div class="flex flex-col gap-1">
							<div class="flex items-center gap-1 mb-1">
								{#each [12, 18, 24, 36] as fs}
									<button
										class="px-2 py-0.5 text-xs rounded {overlayFontSize === fs ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}"
										onmousedown={(e) => { e.preventDefault(); overlayFontSize = fs }}
									>{fs}</button>
								{/each}
							</div>
							<input
								type="text"
								class="px-3 py-2 rounded-lg bg-gray-900/95 border border-violet-500/40
								       text-white placeholder-gray-500 outline-none shadow-xl min-w-[200px]"
								style="color:{color}; font-size:{overlayFontSize}px;"
								placeholder="Texte…"
								bind:value={overlayText}
								onblur={submitOverlay}
								autofocus
							/>
						</div>
					{/if}
				</div>
			{/if}
		{/if}

		<!-- Header badge -->
		<div style="position:absolute; top:12px; left:80px; z-index:10; pointer-events:none;">
			<div class="flex items-center gap-1.5 bg-gray-900/80 backdrop-blur px-3 py-1.5 rounded-full
			             border border-violet-500/30 text-xs font-semibold text-violet-300">
				<span class="w-2 h-2 rounded-full bg-violet-400 animate-pulse"></span>
				NodyxCanvas
			</div>
		</div>

		<!-- Zoom indicator + reset -->
		<div style="position:absolute; bottom:12px; right:12px; z-index:10;">
			<button
				onclick={() => { transform = { ...DEFAULT_TRANSFORM }; render() }}
				class="flex items-center gap-1.5 bg-gray-900/80 backdrop-blur px-2.5 py-1.5 rounded-lg
				       border border-gray-700/50 text-xs text-gray-400 hover:text-white hover:border-gray-500
				       transition-all"
				title="Réinitialiser la vue (100%)"
			>
				{Math.round(transform.scale * 100)}%
			</button>
		</div>

		<!-- Pan hint -->
		<div style="position:absolute; bottom:12px; left:80px; z-index:10; pointer-events:none;"
		     class="text-[10px] text-gray-600">
			Molette: zoom · Espace+drag: déplacer
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
			            flex flex-col items-center gap-5 max-w-sm w-full mx-4 ring-1 ring-white/5">
				<div class="text-4xl">🎨</div>
				<div class="text-center">
					<p class="text-white font-bold text-lg mb-1">Fermer le canvas ?</p>
					<p class="text-gray-400 text-sm">Le board est sauvegardé automatiquement. Tu peux aussi exporter en PNG.</p>
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
						<span>📥</span> Exporter PNG + fermer
					</button>
					<button
						onclick={doClose}
						class="w-full py-2.5 rounded-xl font-medium text-gray-300 hover:text-white
						       bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700
						       transition-all hover:scale-[1.01]
						       flex items-center justify-center gap-2"
					>
						Fermer (board sauvegardé)
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.canvas-cursor-speaking {
		animation: avatar-breathe 1.5s ease-in-out infinite;
		filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.9));
	}
	@keyframes avatar-breathe {
		0%, 100% { transform: scale(1); }
		50%       { transform: scale(1.15); }
	}
</style>
