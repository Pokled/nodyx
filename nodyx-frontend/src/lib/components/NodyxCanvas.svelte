<script lang="ts">
	import { onMount, onDestroy }   from 'svelte'
	import { browser }              from '$app/environment'
	import CanvasLeftToolbar        from './CanvasLeftToolbar.svelte'
	import CanvasTopBar             from './CanvasTopBar.svelte'
	import CanvasBottomBar          from './CanvasBottomBar.svelte'
	import CanvasRightPanel         from './CanvasRightPanel.svelte'
	import { page } from '$app/stores'
	import {
		CanvasState, DEFAULT_TRANSFORM, screenToWorld, worldToScreen, zoomAt,
		type CanvasTool, type CanvasElement, type ViewTransform,
		type PathData, type StickyData, type ShapeData, type TextData, type ArrowData,
		type ImageData, type FrameData, type ConnectorData, type AdvancedShape,
		type CanvasPeer, type CanvasChatMsg,
	} from '$lib/canvas'
	import { voiceStore } from '$lib/voice'
	import { PUBLIC_API_URL } from '$env/static/public'

	// ── Props ─────────────────────────────────────────────────────────────────
	let {
		boardId,
		channelId,
		socket,
		userId,
		username,
		userAvatar = null,
		boardName  = 'Canvas',
		onclose    = () => {},
	}: {
		boardId:     string
		channelId:   string | null
		socket:      any
		userId:      string
		username:    string
		userAvatar?: string | null
		boardName?:  string
		onclose:     () => void
	} = $props()

	// ── Canvas refs ───────────────────────────────────────────────────────────
	let canvasEl:    HTMLCanvasElement
	let containerEl: HTMLDivElement
	let cs = new CanvasState()

	// ── Tool & color ──────────────────────────────────────────────────────────
	let tool      = $state<CanvasTool>('pen')
	let color     = $state('#e879f9')
	let lineWidth = $state(3)

	// ── Text formatting ───────────────────────────────────────────────────────
	let textBold       = $state(false)
	let textItalic     = $state(false)
	let textUnderline  = $state(false)
	let textStrike     = $state(false)
	let textAlign      = $state<'left'|'center'|'right'>('left')
	let textFontSize   = $state(18)
	let textFontFamily = $state<'sans'|'serif'|'mono'>('sans')

	// ── Shape options ─────────────────────────────────────────────────────────
	let shapeFill    = $state(false)
	let shapeStroke  = $state('#7c3aed')
	let shapeStrokeW = $state(2)

	// ── Arrow options ─────────────────────────────────────────────────────────
	let arrowStyle  = $state<'solid'|'dashed'|'dotted'>('solid')
	let arrowEndCap = $state<'arrow'|'none'|'dot'>('arrow')

	// ── Advanced shape ────────────────────────────────────────────────────────
	let shapeType = $state<AdvancedShape>('triangle')

	// ── Connector options ─────────────────────────────────────────────────────
	let connectorType     = $state<'straight'|'bezier'|'elbow'>('bezier')
	let connectorStyle    = $state<'solid'|'dashed'|'dotted'>('solid')
	let connectorStartCap = $state<'none'|'arrow'|'dot'>('none')
	let connectorEndCap   = $state<'none'|'arrow'|'dot'>('arrow')
	let connectorFirstPt: { x: number; y: number } | null = null   // first click for connector

	// ── Image upload ──────────────────────────────────────────────────────────
	let fileInputEl: HTMLInputElement
	let imageClickPt: { x: number; y: number } | null = null
	let imageUploading = $state(false)
	const imgCache = new Map<string, HTMLImageElement>()

	// ── Frame naming overlay ──────────────────────────────────────────────────
	let frameNameOverlay: { id: string; x: number; y: number; w: number } | null = $state(null)
	let frameNameText = $state('')

	// ── Resize handles ────────────────────────────────────────────────────────
	type ResizeHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
	let resizeState: { handle: ResizeHandle; origEl: CanvasElement; startWx: number; startWy: number } | null = null

	const RESIZABLE_KINDS = new Set(['rect','circle','shape','frame','image','sticky'])
	const HANDLE_HALF = 5 // screen px

	function getResizableBounds(el: CanvasElement): { x: number; y: number; w: number; h: number } | null {
		if (!RESIZABLE_KINDS.has(el.kind)) return null
		const d = el.data as { x: number; y: number; w?: number; h?: number }
		return { x: d.x, y: d.y, w: d.w ?? 200, h: d.h ?? 120 }
	}

	function handlePositions(b: { x: number; y: number; w: number; h: number }): Record<ResizeHandle, [number, number]> {
		const { x, y, w, h } = b
		const mx = x + w / 2, my = y + h / 2
		return {
			nw: [x, y],       n: [mx, y],       ne: [x + w, y],
			w:  [x, my],                          e: [x + w, my],
			sw: [x, y + h],   s: [mx, y + h],   se: [x + w, y + h],
		}
	}

	function drawSelectionHandles(ctx: CanvasRenderingContext2D, el: CanvasElement) {
		const bounds = getResizableBounds(el)
		if (!bounds) return
		const pos = handlePositions(bounds)
		ctx.save()
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.fillStyle   = '#ffffff'
		ctx.strokeStyle = '#818cf8'
		ctx.lineWidth   = 1.5
		for (const [hx, hy] of Object.values(pos)) {
			const [sx, sy] = worldToScreen(hx, hy, transform)
			ctx.fillRect(sx - HANDLE_HALF, sy - HANDLE_HALF, HANDLE_HALF * 2, HANDLE_HALF * 2)
			ctx.strokeRect(sx - HANDLE_HALF, sy - HANDLE_HALF, HANDLE_HALF * 2, HANDLE_HALF * 2)
		}
		ctx.restore()
	}

	function hitTestHandle(el: CanvasElement, sx: number, sy: number): ResizeHandle | null {
		const bounds = getResizableBounds(el)
		if (!bounds) return null
		for (const [name, [hx, hy]] of Object.entries(handlePositions(bounds)) as [ResizeHandle, [number,number]][]) {
			const [shx, shy] = worldToScreen(hx, hy, transform)
			if (Math.abs(sx - shx) <= HANDLE_HALF + 2 && Math.abs(sy - shy) <= HANDLE_HALF + 2) return name
		}
		return null
	}

	function applyResize(el: CanvasElement, handle: ResizeHandle, dwx: number, dwy: number): CanvasElement {
		const bounds = getResizableBounds(el)!
		let { x, y, w, h } = bounds
		if (handle === 'se' || handle === 'e' || handle === 'ne') w += dwx
		if (handle === 'sw' || handle === 'w' || handle === 'nw') { x += dwx; w -= dwx }
		if (handle === 'se' || handle === 's' || handle === 'sw') h += dwy
		if (handle === 'ne' || handle === 'n' || handle === 'nw') { y += dwy; h -= dwy }
		w = Math.max(12, w); h = Math.max(12, h)
		const d = el.data as Record<string, unknown>
		return { ...el, ts: Date.now(), data: { ...d, x: snapV(x), y: snapV(y), w: snapV(w), h: snapV(h) } as CanvasElement['data'] }
	}

	// ── View ──────────────────────────────────────────────────────────────────
	let showGrid    = $state(true)
	let snapEnabled = $state(false)
	let transform: ViewTransform = $state({ ...DEFAULT_TRANSFORM })
	let isPanning = false
	let panStart  = { x: 0, y: 0, ox: 0, oy: 0 }
	let spaceDown = false

	// ── Drawing state ─────────────────────────────────────────────────────────
	let isDrawing   = false
	let currentPath: [number, number][] = []
	let currentId   = ''
	let dragStart:   { x: number; y: number } | null = null
	let previewEl:   { x: number; y: number; w: number; h: number } | null = null
	let arrowPreview: { x1: number; y1: number; x2: number; y2: number } | null = null

	// ── Text / sticky overlay ─────────────────────────────────────────────────
	let overlayEdit: { x: number; y: number; kind: 'sticky' | 'text' } | null = $state(null)
	let overlayText  = $state('')

	// ── Undo / Redo ───────────────────────────────────────────────────────────
	type UndoOp = {
		id:     string
		before: CanvasElement | null  // null = element was created
		after:  CanvasElement
	}
	const undoStack: UndoOp[] = []
	const redoStack: UndoOp[] = []
	let canUndo = $state(false)
	let canRedo = $state(false)

	function pushUndo(op: UndoOp) {
		undoStack.push(op)
		redoStack.length = 0
		canUndo = true
		canRedo = false
	}

	// ── Select tool ───────────────────────────────────────────────────────────
	let selectedIds = $state(new Set<string>())
	const selectedId = $derived(selectedIds.size === 1 ? [...selectedIds][0] : null)
	// Multi-drag: stores original snapshot for every selected element
	let dragMove: { startX: number; startY: number; origEls: Map<string, CanvasElement> } | null = null
	// Lasso rectangle (world space)
	let lassoStart: { x: number; y: number } | null = null
	let lassoEnd:   { x: number; y: number } | null = null

	// Anchor badges — positions screen-space, rebuilt every render()
	let anchorBadges = new Map<string, [number, number]>()
	// Lock badges — positions screen-space, rebuilt every render()
	let lockBadges   = new Map<string, [number, number]>()

	// ── Background color ──────────────────────────────────────────────────────
	let bgColor = $state('#0a0a12')

	// ── Minimap ───────────────────────────────────────────────────────────────
	let minimapEl: HTMLCanvasElement | null = null
	const MINIMAP_W = 160, MINIMAP_H = 100

	// ── Brainwave Sync ────────────────────────────────────────────────────────
	let syncMode = $state<'off' | 'leading' | 'following'>('off')
	let syncViewThrottle = 0

	// ── Remote cursors & peers ────────────────────────────────────────────────
	type RemoteCursor = {
		wx: number; wy: number
		userId: string; username: string
		avatar?: string | null
		speaking: boolean; lastSeen: number
	}
	let remoteCursors: Map<string, RemoteCursor> = $state(new Map())
	let cursorThrottle = 0
	let peers = $state<CanvasPeer[]>([])

	const allPeers = $derived<CanvasPeer[]>([
		{ userId, username, avatar: userAvatar, tool, color, active: true },
		...peers,
	])

	// ── Canvas chat ───────────────────────────────────────────────────────────
	const CHAT_STORAGE_KEY  = `canvas:chat:${boardId}`
	const CHAT_MAX_STORED   = 200

	function loadChatHistory(): CanvasChatMsg[] {
		if (!browser) return []
		try {
			const raw = localStorage.getItem(CHAT_STORAGE_KEY)
			return raw ? (JSON.parse(raw) as CanvasChatMsg[]) : []
		} catch { return [] }
	}

	function saveChatHistory(msgs: CanvasChatMsg[]) {
		if (!browser) return
		try {
			localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs.slice(-CHAT_MAX_STORED)))
		} catch {}
	}

	let chatMessages = $state<CanvasChatMsg[]>(loadChatHistory())

	// ── UI ────────────────────────────────────────────────────────────────────
	let showEndDialog   = $state(false)
	let synced          = $state(false)
	let rightPanelOpen  = $state(true)

	// ── Snap to grid ──────────────────────────────────────────────────────────
	const GRID_CELL = 28

	function snapV(v: number): number {
		return snapEnabled ? Math.round(v / GRID_CELL) * GRID_CELL : v
	}
	function snapPt(wx: number, wy: number): [number, number] {
		return [snapV(wx), snapV(wy)]
	}

	// ── Canvas drawing helpers ────────────────────────────────────────────────

	function getCtx(): CanvasRenderingContext2D {
		return canvasEl.getContext('2d')!
	}

	function pointerWorld(e: PointerEvent): [number, number] {
		const rect = canvasEl.getBoundingClientRect()
		return screenToWorld(e.clientX - rect.left, e.clientY - rect.top, transform)
	}

	// ── Image cache ───────────────────────────────────────────────────────────

	function loadImg(url: string): HTMLImageElement {
		if (!imgCache.has(url)) {
			const img = new Image()
			img.crossOrigin = 'anonymous'
			img.src = url
			img.onload = () => render()
			imgCache.set(url, img)
		}
		return imgCache.get(url)!
	}

	// ── Shape Path2D helpers ──────────────────────────────────────────────────

	function shapePath(shape: AdvancedShape, x: number, y: number, w: number, h: number): Path2D {
		const cx = x + w / 2, cy = y + h / 2
		const p  = new Path2D()
		if (shape === 'triangle') {
			p.moveTo(cx, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.closePath()
		} else if (shape === 'diamond') {
			p.moveTo(cx, y); p.lineTo(x + w, cy); p.lineTo(cx, y + h); p.lineTo(x, cy); p.closePath()
		} else if (shape === 'star') {
			const ro = Math.min(w, h) / 2, ri = ro * 0.4, pts = 5
			for (let i = 0; i < pts * 2; i++) {
				const a = (i * Math.PI / pts) - Math.PI / 2
				const r = i % 2 === 0 ? ro : ri
				i === 0 ? p.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
				        : p.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
			}
			p.closePath()
		} else if (shape === 'hexagon') {
			const r = Math.min(w, h) / 2
			for (let i = 0; i < 6; i++) {
				const a = (i * Math.PI / 3) - Math.PI / 6
				i === 0 ? p.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
				        : p.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
			}
			p.closePath()
		} else if (shape === 'cloud') {
			// Nuage approché : 4 cercles qui se chevauchent
			const r1 = w * 0.22, r2 = w * 0.18, r3 = w * 0.20, r4 = w * 0.16
			const by = y + h * 0.72
			p.arc(x + w * 0.28, by - r1, r1, Math.PI, 0)
			p.arc(x + w * 0.50, by - r1 - r2 * 0.5, r2, Math.PI, 0)
			p.arc(x + w * 0.70, by - r3 * 0.8, r3, Math.PI, 0)
			p.arc(x + w * 0.85, by - r4 * 0.2, r4, Math.PI * 0.5, Math.PI * 1.5, true)
			p.lineTo(x + w * 0.15, by)
			p.arc(x + w * 0.15, by - r4 * 0.2, r4, Math.PI * 1.5, Math.PI * 0.5, true)
			p.closePath()
		}
		return p
	}

	function fontFor(d: TextData): string {
		const weight = d.bold   ? 'bold '   : ''
		const style  = d.italic ? 'italic ' : ''
		const size   = `${d.fontSize ?? 18}px `
		const family =
			d.fontFamily === 'serif' ? 'Georgia,serif' :
			d.fontFamily === 'mono'  ? 'monospace'     :
			'Inter,system-ui,sans-serif'
		return `${style}${weight}${size}${family}`
	}

	// ── Render ────────────────────────────────────────────────────────────────

	function render() {
		if (!canvasEl) return
		const ctx = getCtx()
		const W = canvasEl.width, H = canvasEl.height

		// Background fill
		ctx.fillStyle = bgColor
		ctx.fillRect(0, 0, W, H)

		ctx.save()
		ctx.setTransform(transform.scale, 0, 0, transform.scale, transform.x, transform.y)

		if (showGrid) drawGrid(ctx, W, H)

		for (const el of cs.snapshot()) drawElement(ctx, el, selectedIds.has(el.id))

		// Frame membership rings — ring coloré autour des enfants de chaque frame
		for (const frameEl of cs.snapshot()) {
			if (frameEl.kind !== 'frame' || frameEl.deleted) continue
			const fd      = frameEl.data as FrameData
			const children = getFrameChildren(frameEl)
			if (children.length === 0) continue
			const isFrameSelected = selectedIds.has(frameEl.id)
			ctx.save()
			ctx.strokeStyle = fd.color || '#818cf8'
			ctx.lineWidth   = 1.5 / transform.scale
			ctx.globalAlpha = isFrameSelected ? 0.55 : 0.22
			ctx.setLineDash([3 / transform.scale, 2 / transform.scale])
			for (const child of children) {
				const b = getElementBounds(child)
				if (!b) continue
				const pad = 4
				ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
			}
			ctx.setLineDash([])
			ctx.restore()
		}

		// Lasso rectangle (world space)
		if (lassoStart && lassoEnd) {
			ctx.save()
			const lx = Math.min(lassoStart.x, lassoEnd.x)
			const ly = Math.min(lassoStart.y, lassoEnd.y)
			const lw = Math.abs(lassoEnd.x - lassoStart.x)
			const lh = Math.abs(lassoEnd.y - lassoStart.y)
			ctx.fillStyle   = 'rgba(129, 140, 248, 0.08)'
			ctx.strokeStyle = '#818cf8'
			ctx.lineWidth   = 1.5 / transform.scale
			ctx.setLineDash([4 / transform.scale, 3 / transform.scale])
			ctx.fillRect(lx, ly, lw, lh)
			ctx.strokeRect(lx, ly, lw, lh)
			ctx.setLineDash([])
			ctx.restore()
		}

		// Live preview: rect / circle / shape / frame
		if (previewEl && (tool === 'rect' || tool === 'circle' || tool === 'shape' || tool === 'frame')) {
			ctx.save()
			ctx.strokeStyle = shapeStroke
			ctx.lineWidth   = shapeStrokeW
			ctx.setLineDash(tool === 'frame' ? [8, 5] : [6, 3])
			ctx.globalAlpha = 0.7
			if (tool === 'rect') {
				ctx.strokeRect(previewEl.x, previewEl.y, previewEl.w, previewEl.h)
			} else if (tool === 'circle') {
				const rx = previewEl.w / 2, ry = previewEl.h / 2
				ctx.beginPath()
				ctx.ellipse(previewEl.x + rx, previewEl.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
				ctx.stroke()
			} else if (tool === 'shape') {
				ctx.stroke(shapePath(shapeType, previewEl.x, previewEl.y, previewEl.w, previewEl.h))
			} else if (tool === 'frame') {
				ctx.strokeRect(previewEl.x, previewEl.y, previewEl.w, previewEl.h)
			}
			ctx.restore()
		}
		// Connector first-point indicator
		if (connectorFirstPt) {
			ctx.save()
			ctx.fillStyle   = color
			ctx.globalAlpha = 0.8
			ctx.beginPath()
			ctx.arc(connectorFirstPt.x, connectorFirstPt.y, 6 / transform.scale, 0, Math.PI * 2)
			ctx.fill()
			ctx.restore()
		}
		// Live preview: arrow
		if (arrowPreview) {
			drawArrow(ctx, arrowPreview.x1, arrowPreview.y1, arrowPreview.x2, arrowPreview.y2,
				color, lineWidth, 0.6, arrowStyle, arrowEndCap)
		}

		ctx.restore()

		// Selection handles / multi-select box (screen space)
		if (tool === 'select') {
			if (selectedIds.size === 1 && selectedId) {
				const selEl = cs.elements.get(selectedId)
				if (selEl && !selEl.deleted) drawSelectionHandles(ctx, selEl)
			} else if (selectedIds.size > 1) {
				drawMultiSelectionBox(ctx)
			}
		}

		// Anchor badges — coin sup-droit de chaque enfant de frame (screen space)
		anchorBadges = new Map()
		if (tool === 'select') {
			for (const frameEl of cs.snapshot()) {
				if (frameEl.kind !== 'frame' || frameEl.deleted) continue
				for (const child of getFrameChildren(frameEl)) {
					const b = getElementBounds(child)
					if (!b) continue
					const [sx, sy] = worldToScreen(b.x + b.w, b.y, transform)
					const bx = sx + 6, by = sy - 6
					anchorBadges.set(child.id, [bx, by])
					drawAnchorBadge(ctx, bx, by)
				}
			}
		}

		// Lock badges — coin sup-gauche
		// Visible sur : éléments verrouillés (toujours) + éléments sélectionnés en mode select
		lockBadges = new Map()
		if (tool === 'select') {
			for (const el of cs.snapshot()) {
				if (el.deleted) continue
				if (!el.locked && !selectedIds.has(el.id)) continue
				const b = getElementBounds(el)
				if (!b) continue
				const [sx, sy] = worldToScreen(b.x, b.y, transform)
				const bx = sx - 6, by = sy - 6
				lockBadges.set(el.id, [bx, by])
				drawLockBadge(ctx, bx, by, el.locked ?? false)
			}
		} else {
			// Hors mode select : afficher quand même le badge sur les éléments verrouillés
			for (const el of cs.snapshot()) {
				if (!el.locked || el.deleted) continue
				const b = getElementBounds(el)
				if (!b) continue
				const [sx, sy] = worldToScreen(b.x, b.y, transform)
				const bx = sx - 6, by = sy - 6
				lockBadges.set(el.id, [bx, by])
				drawLockBadge(ctx, bx, by, true)
			}
		}

		renderMinimap()
	}

	function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
		const t = transform
		const wxMin = -t.x / t.scale, wyMin = -t.y / t.scale
		const wxMax = (W - t.x) / t.scale, wyMax = (H - t.y) / t.scale

		ctx.strokeStyle = 'rgba(55,65,81,0.5)'
		ctx.lineWidth   = 1 / t.scale
		ctx.beginPath()
		const sx = Math.floor(wxMin / GRID_CELL) * GRID_CELL
		for (let x = sx; x < wxMax; x += GRID_CELL) { ctx.moveTo(x, wyMin); ctx.lineTo(x, wyMax) }
		const sy = Math.floor(wyMin / GRID_CELL) * GRID_CELL
		for (let y = sy; y < wyMax; y += GRID_CELL) { ctx.moveTo(wxMin, y); ctx.lineTo(wxMax, y) }
		ctx.stroke()
	}

	function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, selected = false) {
		ctx.save()
		if (selected) {
			ctx.shadowColor = el.locked ? '#fb923c' : '#818cf8'
			ctx.shadowBlur  = 12 / transform.scale
		}

		if (el.kind === 'pen') {
			const d = el.data as PathData
			if (d.points.length < 2) { ctx.restore(); return }
			ctx.strokeStyle  = d.color
			ctx.lineWidth    = d.width
			ctx.lineCap      = 'round'
			ctx.lineJoin     = 'round'
			ctx.globalAlpha  = d.opacity ?? 1
			ctx.beginPath()
			ctx.moveTo(d.points[0][0], d.points[0][1])
			for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i][0], d.points[i][1])
			ctx.stroke()

		} else if (el.kind === 'rect') {
			const d = el.data as ShapeData
			ctx.globalAlpha = d.opacity ?? 1
			if (d.fill) {
				ctx.fillStyle = d.color + 'cc'
				ctx.fillRect(d.x, d.y, d.w, d.h)
			}
			ctx.strokeStyle = d.strokeColor ?? d.color
			ctx.lineWidth   = d.strokeWidth ?? 2
			ctx.strokeRect(d.x, d.y, d.w, d.h)

		} else if (el.kind === 'circle') {
			const d = el.data as ShapeData
			const rx = d.w / 2, ry = d.h / 2
			ctx.globalAlpha = d.opacity ?? 1
			ctx.beginPath()
			ctx.ellipse(d.x + rx, d.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
			if (d.fill) { ctx.fillStyle = d.color + 'cc'; ctx.fill() }
			ctx.strokeStyle = d.strokeColor ?? d.color
			ctx.lineWidth   = d.strokeWidth ?? 2
			ctx.stroke()

		} else if (el.kind === 'sticky') {
			const d   = el.data as StickyData
			const W   = d.w ?? 200, H = d.h ?? 120
			const pad = 12
			ctx.shadowColor   = 'rgba(0,0,0,0.4)'
			ctx.shadowBlur    = 12
			ctx.shadowOffsetY = 4
			ctx.fillStyle     = d.color
			ctx.beginPath()
			ctx.roundRect(d.x, d.y, W, H, 8)
			ctx.fill()
			ctx.shadowColor = 'transparent'
			ctx.fillStyle   = '#1a1a2e'
			ctx.font        = '14px system-ui, sans-serif'
			wrapText(ctx, d.text, d.x + pad, d.y + pad + 14, W - pad * 2, 18, H - pad * 2)

		} else if (el.kind === 'text') {
			const d     = el.data as TextData
			const fs    = d.fontSize ?? 18
			const lineH = fs + 4
			const maxW  = d.w ?? 600
			ctx.font        = fontFor(d)
			ctx.fillStyle   = d.color
			ctx.shadowColor = 'rgba(0,0,0,0.5)'
			ctx.shadowBlur  = 4
			const lines = buildTextLines(ctx, d.text, maxW)
			let ty = d.y
			for (const line of lines) {
				const lx = d.align === 'center' ? d.x + maxW / 2 :
				           d.align === 'right'  ? d.x + maxW     : d.x
				ctx.textAlign = d.align ?? 'left'
				ctx.fillText(line, lx, ty)
				// Underline & strikethrough (manual)
				if (d.underline || d.strikethrough) {
					const lw = ctx.measureText(line).width
					const x0 = d.align === 'center' ? lx - lw / 2 :
					           d.align === 'right'  ? lx - lw     : lx
					ctx.save()
					ctx.shadowColor = 'transparent'
					ctx.strokeStyle = d.color
					ctx.lineWidth   = Math.max(1, fs * 0.07)
					if (d.underline) {
						ctx.beginPath(); ctx.moveTo(x0, ty + 3); ctx.lineTo(x0 + lw, ty + 3); ctx.stroke()
					}
					if (d.strikethrough) {
						const my = ty - fs * 0.35
						ctx.beginPath(); ctx.moveTo(x0, my); ctx.lineTo(x0 + lw, my); ctx.stroke()
					}
					ctx.restore()
				}
				ty += lineH
				if (ty > d.y + 2000) break
			}
			ctx.textAlign = 'left'

		} else if (el.kind === 'arrow') {
			const d = el.data as ArrowData
			drawArrow(ctx, d.x1, d.y1, d.x2, d.y2, d.color, d.width, 1, d.lineStyle, d.endCap)

		} else if (el.kind === 'image') {
			const d   = el.data as ImageData
			const img = loadImg(d.url)
			ctx.globalAlpha = d.opacity ?? 1
			if (img.complete && img.naturalWidth > 0) {
				ctx.drawImage(img, d.x, d.y, d.w, d.h)
			} else {
				// placeholder while loading
				ctx.fillStyle   = 'rgba(80,80,100,0.3)'
				ctx.strokeStyle = '#555'
				ctx.lineWidth   = 1
				ctx.fillRect(d.x, d.y, d.w, d.h)
				ctx.strokeRect(d.x, d.y, d.w, d.h)
				// crosshair
				ctx.beginPath()
				ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.w, d.y + d.h)
				ctx.moveTo(d.x + d.w, d.y); ctx.lineTo(d.x, d.y + d.h)
				ctx.stroke()
			}
			if (selected) {
				ctx.globalAlpha  = 1
				ctx.strokeStyle  = '#818cf8'
				ctx.lineWidth    = 2 / transform.scale
				ctx.setLineDash([4, 3])
				ctx.strokeRect(d.x - 2, d.y - 2, d.w + 4, d.h + 4)
				ctx.setLineDash([])
			}

		} else if (el.kind === 'frame') {
			const d   = el.data as FrameData
			ctx.save()
			ctx.globalAlpha  = 0.06
			ctx.fillStyle    = d.color || '#818cf8'
			ctx.fillRect(d.x, d.y, d.w, d.h)
			ctx.restore()
			ctx.strokeStyle  = d.color || '#818cf8'
			ctx.lineWidth    = 2 / transform.scale
			ctx.setLineDash([8, 5])
			ctx.globalAlpha  = selected ? 1 : 0.7
			ctx.strokeRect(d.x, d.y, d.w, d.h)
			ctx.setLineDash([])
			// Name label + child count
			{
				const frameChildren = getFrameChildren(el)
				const fs    = Math.max(11, 14 / transform.scale)
				const count = frameChildren.length
				ctx.font        = `700 ${fs}px Inter,system-ui,sans-serif`
				ctx.fillStyle   = d.color || '#818cf8'
				ctx.globalAlpha = 0.9
				const label = (d.name || 'Frame') + (count > 0 ? `  ·  ${count} élément${count > 1 ? 's' : ''}` : '')
				ctx.fillText(label, d.x + 6, d.y - 4)
			}

		} else if (el.kind === 'shape') {
			const d  = el.data as ShapeData
			const sh = d.shape ?? 'triangle'
			const path = shapePath(sh, d.x, d.y, d.w, d.h)
			ctx.globalAlpha = d.opacity ?? 1
			if (d.fill) {
				ctx.fillStyle = d.color + 'cc'
				ctx.fill(path)
			}
			ctx.strokeStyle = d.strokeColor ?? d.color
			ctx.lineWidth   = d.strokeWidth ?? 2
			ctx.stroke(path)
			// Label inside shape
			if (d.label) {
				ctx.font        = `14px Inter,system-ui,sans-serif`
				ctx.fillStyle   = d.strokeColor ?? d.color
				ctx.textAlign   = 'center'
				ctx.shadowColor = 'transparent'
				ctx.fillText(d.label, d.x + d.w / 2, d.y + d.h / 2 + 5, d.w - 10)
				ctx.textAlign   = 'left'
			}

		} else if (el.kind === 'connector') {
			const d = el.data as ConnectorData
			drawConnector(ctx, d, selected)
		}

		ctx.restore()
	}

	function drawConnector(ctx: CanvasRenderingContext2D, d: ConnectorData, selected = false) {
		ctx.save()
		ctx.strokeStyle = d.color
		ctx.fillStyle   = d.color
		ctx.lineWidth   = d.width
		ctx.lineCap     = 'round'
		if (d.style === 'dashed')       ctx.setLineDash([10, 5])
		else if (d.style === 'dotted')  ctx.setLineDash([2, 5])
		else                            ctx.setLineDash([])
		if (selected) {
			ctx.shadowColor = '#818cf8'
			ctx.shadowBlur  = 10 / transform.scale
		}

		ctx.beginPath()
		ctx.moveTo(d.x1, d.y1)
		if (d.type === 'bezier') {
			const cp = (d.x2 - d.x1) / 2
			ctx.bezierCurveTo(d.x1 + cp, d.y1, d.x2 - cp, d.y2, d.x2, d.y2)
		} else if (d.type === 'elbow') {
			const mx = (d.x1 + d.x2) / 2
			ctx.lineTo(mx, d.y1); ctx.lineTo(mx, d.y2); ctx.lineTo(d.x2, d.y2)
		} else {
			ctx.lineTo(d.x2, d.y2)
		}
		ctx.stroke()
		ctx.setLineDash([])

		drawCap(ctx, d.startCap, d.x1, d.y1, d.x2, d.y2, d.width, true)
		drawCap(ctx, d.endCap,   d.x1, d.y1, d.x2, d.y2, d.width, false)
		ctx.restore()
	}

	function drawCap(
		ctx: CanvasRenderingContext2D,
		cap: 'none'|'arrow'|'dot',
		x1: number, y1: number, x2: number, y2: number,
		w: number, atStart: boolean
	) {
		if (cap === 'none') return
		const angle   = atStart
			? Math.atan2(y1 - y2, x1 - x2)
			: Math.atan2(y2 - y1, x2 - x1)
		const px = atStart ? x1 : x2
		const py = atStart ? y1 : y2
		const hl = Math.max(12, w * 4)
		if (cap === 'arrow') {
			ctx.beginPath()
			ctx.moveTo(px, py)
			ctx.lineTo(px - hl * Math.cos(angle - Math.PI / 6), py - hl * Math.sin(angle - Math.PI / 6))
			ctx.lineTo(px - hl * Math.cos(angle + Math.PI / 6), py - hl * Math.sin(angle + Math.PI / 6))
			ctx.closePath(); ctx.fill()
		} else if (cap === 'dot') {
			ctx.beginPath(); ctx.arc(px, py, w * 2.5, 0, Math.PI * 2); ctx.fill()
		}
	}

	/** Split text into wrapped lines (returns array of strings). */
	function buildTextLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
		const result: string[] = []
		for (const para of text.split('\n')) {
			const words = para.split(' ')
			let line = ''
			for (const word of words) {
				const test = line ? `${line} ${word}` : word
				if (ctx.measureText(test).width > maxW && line) {
					result.push(line); line = word
				} else { line = test }
			}
			result.push(line)
		}
		return result
	}

	function wrapText(
		ctx: CanvasRenderingContext2D,
		text: string, x: number, y: number,
		maxW: number, lineH: number, maxH: number
	) {
		const words = text.split(' ')
		let line = '', ty = y
		for (const word of words) {
			const test = line ? `${line} ${word}` : word
			if (ctx.measureText(test).width > maxW && line) {
				ctx.fillText(line, x, ty, maxW); line = word; ty += lineH
				if (ty > y + maxH) break
			} else { line = test }
		}
		if (line) ctx.fillText(line, x, ty, maxW)
	}

	function drawArrow(
		ctx: CanvasRenderingContext2D,
		x1: number, y1: number, x2: number, y2: number,
		col: string, w: number, alpha: number,
		lineStyle?: 'solid'|'dashed'|'dotted',
		endCap?:   'arrow'|'none'|'dot'
	) {
		const angle   = Math.atan2(y2 - y1, x2 - x1)
		const headLen = Math.max(16, w * 4)
		ctx.save()
		ctx.globalAlpha = alpha
		ctx.strokeStyle = col
		ctx.fillStyle   = col
		ctx.lineWidth   = w
		ctx.lineCap     = 'round'

		if (lineStyle === 'dashed')       ctx.setLineDash([10, 5])
		else if (lineStyle === 'dotted')  ctx.setLineDash([2, 5])
		else                              ctx.setLineDash([])

		ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
		ctx.setLineDash([])

		const cap = endCap ?? 'arrow'
		if (cap === 'arrow') {
			ctx.beginPath()
			ctx.moveTo(x2, y2)
			ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
			ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
			ctx.closePath(); ctx.fill()
		} else if (cap === 'dot') {
			ctx.beginPath(); ctx.arc(x2, y2, w * 2.5, 0, Math.PI * 2); ctx.fill()
		}
		ctx.restore()
	}

	// ── Pan / Zoom ────────────────────────────────────────────────────────────

	function onWheel(e: WheelEvent) {
		e.preventDefault()
		const rect = canvasEl.getBoundingClientRect()
		transform  = zoomAt(transform, e.deltaY, e.clientX - rect.left, e.clientY - rect.top)
		if (syncMode === 'leading') socket?.emit('canvas:sync:view', { boardId, transform })
		render()
	}

	function zoomIn() {
		if (!canvasEl) return
		transform = zoomAt(transform, -1, canvasEl.width / 2, canvasEl.height / 2)
		render()
	}
	function zoomOut() {
		if (!canvasEl) return
		transform = zoomAt(transform, 1, canvasEl.width / 2, canvasEl.height / 2)
		render()
	}
	function resetView() { transform = { ...DEFAULT_TRANSFORM }; render() }

	// ── Pointer handlers ──────────────────────────────────────────────────────

	function onPointerDown(e: PointerEvent) {
		if (e.button === 1)              { startPan(e); return }
		if (e.button === 0 && spaceDown) { startPan(e); return }
		if (e.button !== 0) return

		canvasEl.setPointerCapture(e.pointerId)
		const [wx0, wy0] = pointerWorld(e)
		const [wx, wy]   = snapPt(wx0, wy0)

		if (tool === 'sticky' || tool === 'text') {
			overlayEdit = { x: wx, y: wy, kind: tool }
			overlayText = ''
			return
		}
		if (tool === 'image') {
			imageClickPt = { x: wx, y: wy }
			fileInputEl?.click()
			return
		}
		if (tool === 'connector') {
			if (!connectorFirstPt) {
				connectorFirstPt = { x: wx, y: wy }
			} else {
				// Second click → create connector
				const op: CanvasElement = {
					id: crypto.randomUUID(), ts: Date.now(), author: userId,
					kind: 'connector',
					data: {
						x1: connectorFirstPt.x, y1: connectorFirstPt.y, x2: wx, y2: wy,
						type: connectorType, style: connectorStyle, color,
						width: lineWidth, startCap: connectorStartCap, endCap: connectorEndCap,
					} satisfies ConnectorData,
				}
				cs.apply(op); pushUndo({ id: op.id, before: null, after: op })
				socket?.emit('canvas:op', { boardId, op })
				connectorFirstPt = null; render()
			}
			return
		}
		if (tool === 'eraser') { eraseAt(wx, wy); isDrawing = true; return }

		if (tool === 'select') {
			const rect2   = canvasEl.getBoundingClientRect()
			const screenX = e.clientX - rect2.left
			const screenY = e.clientY - rect2.top

			// Lock badge click → toggle verrou
			for (const [id, [bx, by]] of lockBadges) {
				if (Math.hypot(screenX - bx, screenY - by) <= 10) {
					toggleLock(id); render(); return
				}
			}

			// Anchor badge click → détacher l'élément du frame
			for (const [id, [bx, by]] of anchorBadges) {
				if (Math.hypot(screenX - bx, screenY - by) <= 10) {
					detachFromFrame(id); render(); return
				}
			}

			// Resize handle: single selection only (pas sur éléments verrouillés)
			if (selectedId) {
				const selEl = cs.elements.get(selectedId)
				if (selEl && !selEl.deleted && !selEl.locked) {
					const h = hitTestHandle(selEl, screenX, screenY)
					if (h) {
						resizeState = { handle: h, origEl: structuredClone(selEl), startWx: wx, startWy: wy }
						render(); return
					}
				}
			}
			const hit = hitTestAll(wx, wy)
			if (hit) {
				if (e.shiftKey) {
					const next = new Set(selectedIds)
					if (next.has(hit.id)) next.delete(hit.id); else next.add(hit.id)
					selectedIds = next
				} else if (!selectedIds.has(hit.id)) {
					selectedIds = new Set([hit.id])
				}
				// Élément verrouillé : sélection uniquement, pas de drag
				if (hit.locked) { render(); return }
				// Snapshot origEls pour chaque élément sélectionné
				const origEls = new Map<string, CanvasElement>()
				for (const id of selectedIds) {
					const el = cs.elements.get(id)
					if (el && !el.deleted) origEls.set(id, structuredClone(el))
				}
				// Si un frame est sélectionné, inclure ses enfants dans le drag
				for (const id of selectedIds) {
					const frameEl = cs.elements.get(id)
					if (frameEl && frameEl.kind === 'frame') {
						for (const child of getFrameChildren(frameEl)) {
							if (!origEls.has(child.id)) origEls.set(child.id, structuredClone(child))
						}
					}
				}
				dragMove = { startX: wx, startY: wy, origEls }
			} else {
				if (!e.shiftKey) selectedIds = new Set()
				lassoStart = { x: wx, y: wy }
				lassoEnd   = { x: wx, y: wy }
			}
			render(); return
		}

		isDrawing = true
		currentId = crypto.randomUUID()
		dragStart = { x: wx, y: wy }
		if (tool === 'pen') currentPath = [[wx, wy]]
	}

	function onPointerMove(e: PointerEvent) {
		if (isPanning) { updatePan(e); return }

		const [wx, wy] = pointerWorld(e)

		// Throttled cursor broadcast (50ms)
		const now = Date.now()
		if (now - cursorThrottle > 50) {
			cursorThrottle = now
			const vs = $voiceStore as any
			socket?.emit('canvas:cursor', { boardId, x: wx, y: wy, speaking: vs.mySpeaking ?? false, tool, color, avatar: userAvatar })
		}

		if (!isDrawing && !dragMove && !resizeState && !lassoStart) return

		if (tool === 'select' && lassoStart) {
			lassoEnd = { x: wx, y: wy }
			render(); return
		}
		if (tool === 'select' && resizeState && selectedId) {
			const dwx = wx - resizeState.startWx
			const dwy = wy - resizeState.startWy
			const resized = applyResize(resizeState.origEl, resizeState.handle, dwx, dwy)
			cs.apply(resized); render()
			return
		}
		if (tool === 'select' && dragMove) {
			const dx = wx - dragMove.startX, dy = wy - dragMove.startY
			for (const [id, origEl] of dragMove.origEls) {
				const el = cs.elements.get(id)
				if (!el) continue
				const moved = moveElement(el, origEl.data, dx, dy)
				if (moved) cs.apply(moved)
			}
			render(); return
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
		if ((tool === 'rect' || tool === 'circle' || tool === 'shape' || tool === 'frame') && dragStart) {
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

	// Connector first-point cursor indicator is handled in render()

	function onPointerUp(e: PointerEvent) {
		if (isPanning) { isPanning = false; return }

		if (tool === 'select' && resizeState && selectedId) {
			const el = cs.elements.get(selectedId)
			if (el) {
				pushUndo({ id: selectedId, before: resizeState.origEl, after: el })
				socket?.emit('canvas:op', { boardId, op: el })
			}
			resizeState = null; return
		}
		if (tool === 'select' && dragMove) {
			for (const [id, origEl] of dragMove.origEls) {
				const el = cs.elements.get(id)
				if (el && el.ts > origEl.ts) {
					pushUndo({ id, before: origEl, after: el })
					socket?.emit('canvas:op', { boardId, op: el })
				}
			}
			dragMove = null; return
		}
		if (tool === 'select' && lassoStart && lassoEnd) {
			const lx = Math.min(lassoStart.x, lassoEnd.x)
			const ly = Math.min(lassoStart.y, lassoEnd.y)
			const lw = Math.abs(lassoEnd.x - lassoStart.x)
			const lh = Math.abs(lassoEnd.y - lassoStart.y)
			if (lw > 5 && lh > 5) {
				const hits = cs.snapshot().filter(el => !el.deleted && elementInRect(el, { x: lx, y: ly, w: lw, h: lh }))
				if (e.shiftKey) {
					const next = new Set(selectedIds)
					for (const el of hits) next.add(el.id)
					selectedIds = next
				} else {
					selectedIds = new Set(hits.map(el => el.id))
				}
			}
			lassoStart = null; lassoEnd = null; render(); return
		}

		if (!isDrawing) return
		isDrawing = false
		const [wx0, wy0] = pointerWorld(e)
		const [wx, wy]   = snapPt(wx0, wy0)

		if (tool === 'pen' && currentPath.length > 1) {
			const op: CanvasElement = {
				id: currentId, ts: Date.now(), author: userId,
				kind: 'pen', data: { points: currentPath, color, width: lineWidth },
			}
			cs.apply(op); pushUndo({ id: currentId, before: null, after: op })
			socket?.emit('canvas:op', { boardId, op })
			currentPath = []; render()

		} else if ((tool === 'rect' || tool === 'circle') && dragStart && previewEl) {
			const snap = {
				x: snapV(previewEl.x), y: snapV(previewEl.y),
				w: snapV(previewEl.w), h: snapV(previewEl.h),
			}
			const op: CanvasElement = {
				id: currentId, ts: Date.now(), author: userId,
				kind: tool,
				data: { ...snap, color, fill: shapeFill, strokeColor: shapeStroke, strokeWidth: shapeStrokeW },
			}
			cs.apply(op); pushUndo({ id: currentId, before: null, after: op })
			socket?.emit('canvas:op', { boardId, op })
			previewEl = null; dragStart = null; render()

		} else if (tool === 'arrow' && dragStart) {
			if (Math.hypot(wx - dragStart.x, wy - dragStart.y) > 10) {
				const op: CanvasElement = {
					id: currentId, ts: Date.now(), author: userId,
					kind: 'arrow',
					data: {
						x1: dragStart.x, y1: dragStart.y, x2: wx, y2: wy,
						color, width: lineWidth, lineStyle: arrowStyle, endCap: arrowEndCap,
					},
				}
				cs.apply(op); pushUndo({ id: currentId, before: null, after: op })
				socket?.emit('canvas:op', { boardId, op })
			}
			arrowPreview = null; dragStart = null; render()

		} else if (tool === 'shape' && dragStart && previewEl) {
			const snap = { x: snapV(previewEl.x), y: snapV(previewEl.y), w: snapV(previewEl.w), h: snapV(previewEl.h) }
			if (snap.w > 10 && snap.h > 10) {
				const op: CanvasElement = {
					id: currentId, ts: Date.now(), author: userId,
					kind: 'shape',
					data: { ...snap, color, fill: shapeFill, strokeColor: shapeStroke, strokeWidth: shapeStrokeW, shape: shapeType },
				}
				cs.apply(op); pushUndo({ id: currentId, before: null, after: op })
				socket?.emit('canvas:op', { boardId, op })
			}
			previewEl = null; dragStart = null; render()

		} else if (tool === 'frame' && dragStart && previewEl) {
			const snap = { x: snapV(previewEl.x), y: snapV(previewEl.y), w: snapV(previewEl.w), h: snapV(previewEl.h) }
			if (snap.w > 20 && snap.h > 20) {
				const id = currentId
				const op: CanvasElement = {
					id, ts: Date.now(), author: userId,
					kind: 'frame',
					data: { ...snap, name: '', color: shapeStroke } satisfies FrameData,
				}
				cs.apply(op); pushUndo({ id, before: null, after: op })
				socket?.emit('canvas:op', { boardId, op })
				// open name overlay
				frameNameOverlay = { id, x: snap.x, y: snap.y, w: snap.w }
				frameNameText = ''
			}
			previewEl = null; dragStart = null; render()
		}
	}

	// ── Pan ───────────────────────────────────────────────────────────────────

	function startPan(e: PointerEvent) {
		isPanning = true
		panStart  = { x: e.clientX, y: e.clientY, ox: transform.x, oy: transform.y }
		canvasEl.setPointerCapture(e.pointerId)
	}
	function updatePan(e: PointerEvent) {
		transform = { ...transform, x: panStart.ox + (e.clientX - panStart.x), y: panStart.oy + (e.clientY - panStart.y) }
		if (syncMode === 'leading') {
			const now = Date.now()
			if (now - syncViewThrottle > 50) {
				syncViewThrottle = now
				socket?.emit('canvas:sync:view', { boardId, transform })
			}
		}
		render()
	}

	// ── Move element ──────────────────────────────────────────────────────────

	function moveElement(el: CanvasElement, orig: unknown, dx: number, dy: number): CanvasElement | null {
		const d = orig as Record<string, number>
		const ts = Date.now()
		if (el.kind === 'pen') {
			const od = orig as PathData
			return { ...el, ts, data: { ...od, points: od.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) } }
		}
		if (el.kind === 'sticky' || el.kind === 'rect' || el.kind === 'circle' ||
		    el.kind === 'text'   || el.kind === 'image' || el.kind === 'frame' || el.kind === 'shape') {
			return { ...el, ts, data: { ...d, x: snapV(d.x + dx), y: snapV(d.y + dy) } as any }
		}
		if (el.kind === 'arrow') {
			const od = orig as ArrowData
			return { ...el, ts, data: { ...od, x1: od.x1 + dx, y1: od.y1 + dy, x2: od.x2 + dx, y2: od.y2 + dy } }
		}
		if (el.kind === 'connector') {
			const od = orig as ConnectorData
			return { ...el, ts, data: { ...od, x1: od.x1 + dx, y1: od.y1 + dy, x2: od.x2 + dx, y2: od.y2 + dy } }
		}
		return null
	}

	// ── Erase ─────────────────────────────────────────────────────────────────

	function eraseAt(wx: number, wy: number) {
		const R = 20 / transform.scale
		for (const el of cs.snapshot()) {
			if (el.locked) continue
			if (hitTest(el, wx, wy, R)) {
				const del = { ...el, deleted: true, ts: Date.now() }
				pushUndo({ id: el.id, before: el, after: del })
				cs.apply(del)
				socket?.emit('canvas:op', { boardId, op: del })
			}
		}
		render()
	}

	function hitTestAll(wx: number, wy: number): CanvasElement | undefined {
		return [...cs.snapshot()].reverse().find(el => hitTest(el, wx, wy, 8 / transform.scale))
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
			return wx >= d.x - r && wx <= d.x + 600 && wy >= d.y - (d.fontSize ?? 18) - r && wy <= d.y + r
		}
		if (el.kind === 'arrow') {
			const d = el.data as ArrowData
			const ddx = d.x2 - d.x1, ddy = d.y2 - d.y1
			const len2 = ddx * ddx + ddy * ddy
			if (len2 === 0) return Math.hypot(wx - d.x1, wy - d.y1) < r
			const t = Math.max(0, Math.min(1, ((wx - d.x1) * ddx + (wy - d.y1) * ddy) / len2))
			return Math.hypot(wx - (d.x1 + t * ddx), wy - (d.y1 + t * ddy)) < r * 2
		}
		if (el.kind === 'image' || el.kind === 'frame' || el.kind === 'shape') {
			const d = el.data as ShapeData
			return wx >= d.x - r && wx <= d.x + d.w + r && wy >= d.y - r && wy <= d.y + d.h + r
		}
		if (el.kind === 'connector') {
			const d = el.data as ConnectorData
			const ddx = d.x2 - d.x1, ddy = d.y2 - d.y1
			const len2 = ddx * ddx + ddy * ddy
			if (len2 === 0) return Math.hypot(wx - d.x1, wy - d.y1) < r
			const t = Math.max(0, Math.min(1, ((wx - d.x1) * ddx + (wy - d.y1) * ddy) / len2))
			return Math.hypot(wx - (d.x1 + t * ddx), wy - (d.y1 + t * ddy)) < r * 2
		}
		return false
	}

	// ── Element bounds & multi-selection helpers ─────────────────────────────

	function getElementBounds(el: CanvasElement): { x: number; y: number; w: number; h: number } | null {
		if (el.kind === 'pen') {
			const d = el.data as PathData
			if (d.points.length === 0) return null
			const xs = d.points.map(p => p[0]), ys = d.points.map(p => p[1])
			const x = Math.min(...xs), y = Math.min(...ys)
			return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 }
		}
		if (el.kind === 'arrow') {
			const d = el.data as ArrowData
			return { x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2), w: Math.abs(d.x2 - d.x1) || 1, h: Math.abs(d.y2 - d.y1) || 1 }
		}
		if (el.kind === 'connector') {
			const d = el.data as ConnectorData
			return { x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2), w: Math.abs(d.x2 - d.x1) || 1, h: Math.abs(d.y2 - d.y1) || 1 }
		}
		if (el.kind === 'text') {
			const d = el.data as TextData
			return { x: d.x, y: d.y - (d.fontSize ?? 18), w: d.w ?? 300, h: (d.fontSize ?? 18) * 3 }
		}
		return getResizableBounds(el)
	}

	function elementInRect(el: CanvasElement, rect: { x: number; y: number; w: number; h: number }): boolean {
		const b = getElementBounds(el)
		if (!b) return false
		return b.x + b.w >= rect.x && b.x <= rect.x + rect.w &&
		       b.y + b.h >= rect.y && b.y <= rect.y + rect.h
	}

	function getFrameChildren(frameEl: CanvasElement): CanvasElement[] {
		if (frameEl.kind !== 'frame') return []
		const fd = frameEl.data as FrameData
		return cs.snapshot().filter(el => {
			if (el.id === frameEl.id || el.deleted) return false
			const b = getElementBounds(el)
			if (!b) return false
			// L'élément appartient au frame si son centre est dans les bounds
			const cx = b.x + b.w / 2, cy = b.y + b.h / 2
			return cx >= fd.x && cx <= fd.x + fd.w && cy >= fd.y && cy <= fd.y + fd.h
		})
	}

	function drawAnchorBadge(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
		ctx.save()
		ctx.setTransform(1, 0, 0, 1, 0, 0)

		// Cercle de fond violet
		ctx.beginPath()
		ctx.arc(sx, sy, 9, 0, Math.PI * 2)
		ctx.fillStyle = 'rgba(109, 40, 217, 0.92)'
		ctx.fill()
		ctx.strokeStyle = '#a78bfa'
		ctx.lineWidth   = 1
		ctx.stroke()

		// Ancre blanche
		ctx.strokeStyle = 'rgba(255,255,255,0.95)'
		ctx.lineWidth   = 1.3
		ctx.lineCap     = 'round'
		const cx = sx, cy = sy

		// Anneau supérieur
		ctx.beginPath()
		ctx.arc(cx, cy - 3.2, 1.6, 0, Math.PI * 2)
		ctx.stroke()

		// Tige verticale
		ctx.beginPath()
		ctx.moveTo(cx, cy - 1.6)
		ctx.lineTo(cx, cy + 3.2)
		ctx.stroke()

		// Barre transversale (stock)
		ctx.beginPath()
		ctx.moveTo(cx - 3.2, cy - 0.2)
		ctx.lineTo(cx + 3.2, cy - 0.2)
		ctx.stroke()

		// Arc du bas (couronne)
		ctx.beginPath()
		ctx.arc(cx, cy + 1.4, 2.4, 0.15, Math.PI - 0.15)
		ctx.stroke()

		// Extrémités gauche/droite qui remontent
		ctx.beginPath()
		ctx.moveTo(cx - 2.3, cy + 1.4)
		ctx.lineTo(cx - 3.2, cy - 0.4)
		ctx.stroke()
		ctx.beginPath()
		ctx.moveTo(cx + 2.3, cy + 1.4)
		ctx.lineTo(cx + 3.2, cy - 0.4)
		ctx.stroke()

		ctx.restore()
	}

	function detachFromFrame(id: string) {
		const el = cs.elements.get(id)
		if (!el || el.deleted) return
		for (const frameEl of cs.snapshot()) {
			if (frameEl.kind !== 'frame' || frameEl.deleted) continue
			if (!getFrameChildren(frameEl).find(c => c.id === id)) continue
			const fd = frameEl.data as FrameData
			const b  = getElementBounds(el)
			if (!b) return
			// Déplace juste en-dessous du frame
			const dy = (fd.y + fd.h + 32) - b.y
			const moved = moveElement(el, el.data, 0, dy)
			if (moved) {
				pushUndo({ id, before: el, after: moved })
				cs.apply(moved)
				socket?.emit('canvas:op', { boardId, op: moved })
			}
			return
		}
	}

	function drawLockBadge(ctx: CanvasRenderingContext2D, sx: number, sy: number, locked: boolean) {
		ctx.save()
		ctx.setTransform(1, 0, 0, 1, 0, 0)

		// Cercle de fond
		ctx.beginPath()
		ctx.arc(sx, sy, 9, 0, Math.PI * 2)
		ctx.fillStyle   = locked ? 'rgba(154, 52, 18, 0.92)' : 'rgba(25, 25, 40, 0.78)'
		ctx.fill()
		ctx.strokeStyle = locked ? '#fb923c' : 'rgba(255,255,255,0.18)'
		ctx.lineWidth   = 1
		ctx.stroke()

		const cx = sx, cy = sy + 0.5
		ctx.strokeStyle = locked ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)'
		ctx.fillStyle   = locked ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)'
		ctx.lineWidth   = 1.3
		ctx.lineCap     = 'round'
		ctx.lineJoin    = 'round'

		// Corps du cadenas (rectangle)
		ctx.beginPath()
		ctx.roundRect(cx - 2.8, cy - 0.2, 5.6, 4.2, 0.8)
		ctx.fill()

		// Anse (shackle)
		ctx.beginPath()
		if (locked) {
			// Fermé : arc complet en haut
			ctx.moveTo(cx - 2.1, cy - 0.2)
			ctx.lineTo(cx - 2.1, cy - 2)
			ctx.arc(cx, cy - 2, 2.1, Math.PI, 0)
			ctx.lineTo(cx + 2.1, cy - 0.2)
		} else {
			// Ouvert : seul le poteau gauche, anse décalée vers le haut-droite
			ctx.moveTo(cx - 2.1, cy - 0.2)
			ctx.lineTo(cx - 2.1, cy - 2)
			ctx.arc(cx, cy - 2, 2.1, Math.PI, Math.PI * 1.6)
		}
		ctx.stroke()

		// Trou de serrure (uniquement fermé)
		if (locked) {
			ctx.fillStyle = 'rgba(154,52,18,0.88)'
			ctx.beginPath()
			ctx.arc(cx, cy + 1.3, 1, 0, Math.PI * 2)
			ctx.fill()
			ctx.fillRect(cx - 0.5, cy + 1.4, 1, 1.4)
		}

		ctx.restore()
	}

	function toggleLock(id: string) {
		const el = cs.elements.get(id)
		if (!el || el.deleted) return
		const updated = { ...el, ts: Date.now(), locked: !el.locked }
		pushUndo({ id, before: el, after: updated })
		cs.apply(updated)
		socket?.emit('canvas:op', { boardId, op: updated })
	}

	function drawMultiSelectionBox(ctx: CanvasRenderingContext2D) {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
		for (const id of selectedIds) {
			const el = cs.elements.get(id)
			if (!el || el.deleted) continue
			const b = getElementBounds(el)
			if (!b) continue
			minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
			maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
		}
		if (!isFinite(minX)) return
		const pad = 8 / transform.scale
		ctx.save()
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		const [sx, sy]   = worldToScreen(minX - pad, minY - pad, transform)
		const [sx2, sy2] = worldToScreen(maxX + pad, maxY + pad, transform)
		ctx.strokeStyle = '#818cf8'
		ctx.lineWidth   = 1.5
		ctx.setLineDash([5, 3])
		ctx.strokeRect(sx, sy, sx2 - sx, sy2 - sy)
		ctx.setLineDash([])
		ctx.restore()
	}

	// ── Minimap ───────────────────────────────────────────────────────────────

	function renderMinimap() {
		if (!minimapEl) return
		const ctx2 = minimapEl.getContext('2d')
		if (!ctx2) return

		ctx2.fillStyle = bgColor
		ctx2.fillRect(0, 0, MINIMAP_W, MINIMAP_H)

		const els = cs.snapshot()
		if (els.length === 0) return

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
		for (const el of els) {
			const b = getElementBounds(el)
			if (!b) continue
			minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
			maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
		}
		if (!isFinite(minX)) return

		const margin  = 10
		const cW = maxX - minX || 1, cH = maxY - minY || 1
		const mmScale = Math.min((MINIMAP_W - margin * 2) / cW, (MINIMAP_H - margin * 2) / cH, 0.4)
		const ox = margin + ((MINIMAP_W - margin * 2) - cW * mmScale) / 2 - minX * mmScale
		const oy = margin + ((MINIMAP_H - margin * 2) - cH * mmScale) / 2 - minY * mmScale

		// Element blobs
		ctx2.fillStyle = 'rgba(139, 92, 246, 0.6)'
		for (const el of els) {
			const b = getElementBounds(el)
			if (!b) continue
			ctx2.fillRect(b.x * mmScale + ox, b.y * mmScale + oy, Math.max(2, b.w * mmScale), Math.max(2, b.h * mmScale))
		}

		// Viewport rect
		if (!canvasEl) return
		const [vx1, vy1] = screenToWorld(0, 0, transform)
		const [vx2, vy2] = screenToWorld(canvasEl.width, canvasEl.height, transform)
		ctx2.strokeStyle = 'rgba(255,255,255,0.55)'
		ctx2.lineWidth   = 1
		ctx2.setLineDash([3, 2])
		ctx2.strokeRect(vx1 * mmScale + ox, vy1 * mmScale + oy, (vx2 - vx1) * mmScale, (vy2 - vy1) * mmScale)
		ctx2.setLineDash([])
	}

	function onMinimapClick(e: MouseEvent) {
		if (!minimapEl || !canvasEl) return
		const els = cs.snapshot()
		if (els.length === 0) return
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
		for (const el of els) {
			const b = getElementBounds(el)
			if (!b) continue
			minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
			maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
		}
		if (!isFinite(minX)) return
		const margin = 10
		const cW = maxX - minX || 1, cH = maxY - minY || 1
		const mmScale = Math.min((MINIMAP_W - margin * 2) / cW, (MINIMAP_H - margin * 2) / cH, 0.4)
		const ox = margin + ((MINIMAP_W - margin * 2) - cW * mmScale) / 2 - minX * mmScale
		const oy = margin + ((MINIMAP_H - margin * 2) - cH * mmScale) / 2 - minY * mmScale
		const rect = minimapEl.getBoundingClientRect()
		const wx = (e.clientX - rect.left - ox) / mmScale
		const wy = (e.clientY - rect.top  - oy) / mmScale
		transform = {
			...transform,
			x: canvasEl.width  / 2 - wx * transform.scale,
			y: canvasEl.height / 2 - wy * transform.scale,
		}
		render()
	}

	// ── Brainwave Sync ────────────────────────────────────────────────────────

	function toggleBrainwaveSync() {
		if (syncMode === 'off')        syncMode = 'leading'
		else if (syncMode === 'leading') syncMode = 'following'
		else                           syncMode = 'off'
	}

	function handleSyncView({ transform: t }: { boardId: string; transform: ViewTransform }) {
		if (syncMode === 'following') { transform = t; render() }
	}

	// ── Image upload ──────────────────────────────────────────────────────────

	async function handleFileSelected(e: Event) {
		const input = e.target as HTMLInputElement
		const file  = input.files?.[0]
		if (!file || !imageClickPt) return
		input.value = ''
		await placeImage(file, imageClickPt.x, imageClickPt.y)
		imageClickPt = null
	}

	async function handleCanvasDrop(e: DragEvent) {
		e.preventDefault()
		const file = e.dataTransfer?.files?.[0]
		if (!file || !file.type.startsWith('image/')) return
		const rect     = canvasEl.getBoundingClientRect()
		const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, transform)
		await placeImage(file, wx, wy)
	}

	async function placeImage(file: File, wx: number, wy: number) {
		imageUploading = true
		try {
			const token = $page.data?.token ?? null
			const form  = new FormData()
			form.append('name', file.name.replace(/\.[^.]+$/, '') || 'canvas-image')
			form.append('asset_type', 'image')
			form.append('file', file)
			const res  = await fetch(`${PUBLIC_API_URL}/api/v1/assets`, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} })
			if (!res.ok) { console.error('Canvas upload error', res.status, await res.text()); return }
			const data = await res.json()
			const fp   = data?.asset?.file_path
			const url  = fp ? `/uploads/${fp}` : (data?.url ?? null)
			if (!url) return

			const img = await new Promise<HTMLImageElement>(resolve => {
				const i = new Image(); i.src = url; i.onload = () => resolve(i)
			})
			const maxW = 400, ratio = img.naturalHeight / (img.naturalWidth || 1)
			const w = Math.min(maxW, img.naturalWidth), h = Math.round(w * ratio)

			const op: CanvasElement = {
				id: crypto.randomUUID(), ts: Date.now(), author: userId,
				kind: 'image',
				data: { x: snapV(wx), y: snapV(wy), w, h, url } satisfies ImageData,
			}
			cs.apply(op); pushUndo({ id: op.id, before: null, after: op })
			socket?.emit('canvas:op', { boardId, op })
			render()
		} finally {
			imageUploading = false
		}
	}

	// ── Frame name submit ─────────────────────────────────────────────────────

	function submitFrameName() {
		if (!frameNameOverlay) return
		const el = cs.elements.get(frameNameOverlay.id)
		if (el) {
			const updated = { ...el, ts: Date.now(), data: { ...(el.data as FrameData), name: frameNameText.trim() } }
			cs.apply(updated); socket?.emit('canvas:op', { boardId, op: updated })
			render()
		}
		frameNameOverlay = null; frameNameText = ''
	}

	// ── Overlay (sticky / text) ───────────────────────────────────────────────

	function submitOverlay() {
		if (!overlayEdit || !overlayText.trim()) { overlayEdit = null; return }
		const { x, y, kind } = overlayEdit
		let data: StickyData | TextData

		if (kind === 'sticky') {
			data = { x, y, text: overlayText.trim(), color } as StickyData
		} else {
			data = {
				x, y, text: overlayText.trim(), color,
				fontSize:      textFontSize,
				bold:          textBold,
				italic:        textItalic,
				underline:     textUnderline,
				strikethrough: textStrike,
				align:         textAlign,
				fontFamily:    textFontFamily,
			} as TextData
		}

		const op: CanvasElement = { id: crypto.randomUUID(), ts: Date.now(), author: userId, kind, data }
		cs.apply(op); pushUndo({ id: op.id, before: null, after: op })
		socket?.emit('canvas:op', { boardId, op })
		render()
		overlayEdit = null; overlayText = ''
	}

	// ── Undo / Redo ───────────────────────────────────────────────────────────

	function undo() {
		const entry = undoStack.pop(); if (!entry) return
		redoStack.push(entry)
		canUndo = undoStack.length > 0
		canRedo = true

		const restore = entry.before === null
			? { ...entry.after, deleted: true, ts: Date.now() }
			: { ...entry.before, ts: Date.now() }
		cs.apply(restore); socket?.emit('canvas:op', { boardId, op: restore }); render()
	}

	function redo() {
		const entry = redoStack.pop(); if (!entry) return
		undoStack.push(entry)
		canUndo = true
		canRedo = redoStack.length > 0
		cs.apply(entry.after); socket?.emit('canvas:op', { boardId, op: entry.after }); render()
	}

	// ── Clear ─────────────────────────────────────────────────────────────────

	function clearAll() {
		const ts = Date.now(); cs.clear(ts); socket?.emit('canvas:clear', { boardId, ts }); render()
	}

	// ── Socket.IO receive ─────────────────────────────────────────────────────

	function handleSnapshot({ elements }: { boardId: string; elements: CanvasElement[] }) {
		cs.loadSnapshot(elements); synced = true; render()
	}
	function handleRemoteOp({ op }: { boardId: string; op: CanvasElement }) {
		if (cs.apply(op)) render()
	}
	function handleRemoteClear({ ts }: { boardId: string; ts: number }) {
		cs.clear(ts); render()
	}
	function handleRemoteCursor({ userId: uid, username: uname, x, y, speaking, tool: t, color: c, avatar: av }:
		{ boardId: string; userId: string; username: string; x: number; y: number; speaking: boolean; tool?: CanvasTool; color?: string; avatar?: string | null }
	) {
		if (uid === userId) return
		const next = new Map(remoteCursors)
		next.set(uid, { wx: x, wy: y, userId: uid, username: uname, avatar: av, speaking, lastSeen: Date.now() })
		remoteCursors = next

		// Update peers list
		const existing = peers.find(p => p.userId === uid)
		if (existing) {
			peers = peers.map(p => p.userId === uid ? { ...p, avatar: av, tool: t, color: c, active: true } : p)
		} else {
			peers = [...peers, { userId: uid, username: uname, avatar: av, tool: t, color: c, active: true }]
		}
	}
	function handleCanvasChat({ msg }: { msg: CanvasChatMsg }) {
		if (msg.userId !== userId) {
			chatMessages = [...chatMessages, msg]
			saveChatHistory(chatMessages)
		}
	}
	function onVoiceSpeaking({ userId: uid, speaking }: { userId: string; speaking: boolean }) {
		const c = remoteCursors.get(uid); if (!c) return
		const next = new Map(remoteCursors)
		next.set(uid, { ...c, speaking }); remoteCursors = next
	}

	// ── Canvas chat ───────────────────────────────────────────────────────────

	function sendChat(text: string) {
		const msg: CanvasChatMsg = { id: crypto.randomUUID(), userId, username, text, ts: Date.now() }
		chatMessages = [...chatMessages, msg]
		saveChatHistory(chatMessages)
		socket?.emit('canvas:chat', { boardId, msg })
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
		const blob = await new Promise<Blob | null>(res => canvasEl.toBlob(res, 'image/png'))
		if (blob) {
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a'); a.href = url; a.download = 'nodyx-canvas.png'
			document.body.appendChild(a); a.click(); document.body.removeChild(a)
			setTimeout(() => URL.revokeObjectURL(url), 5000)
		}
		if (channelId && socket) {
			const count = cs.snapshot().length, authors = cs.authorSet()
			socket.emit('chat:send', { channelId, content: `🎨 **Canvas** — ${count} élément${count > 1 ? 's' : ''} par ${authors.join(', ')}.` })
		}
		doClose()
	}

	// ── Keyboard ──────────────────────────────────────────────────────────────

	function onKeydown(e: KeyboardEvent) {
		// Ne pas interférer quand l'utilisateur tape dans un input/textarea/chat
		const tag = (e.target as HTMLElement)?.tagName
		if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

		if (e.code === 'Space' && !overlayEdit) { spaceDown = true; e.preventDefault() }
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey)  { e.preventDefault(); undo() }
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
		if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
			// Bloquer le raccourci navigateur "Ajouter aux favoris" même sans sélection
			e.preventDefault()
			if (selectedIds.size > 0) {
				const ts = Date.now()
				const newIds = new Set<string>()
				for (const id of selectedIds) {
					const el = cs.elements.get(id)
					if (!el || el.deleted || el.locked) continue
					// Décalage +20/+20 via moveElement — gère pen/sticky/shape/arrow/connector
					const moved = moveElement(el, el.data, 20, 20)
					if (!moved) continue
					const clone = { ...moved, id: crypto.randomUUID(), ts }
					cs.apply(clone)
					pushUndo({ id: clone.id, before: null, after: clone })
					socket?.emit('canvas:op', { boardId, op: clone })
					newIds.add(clone.id)
				}
				if (newIds.size > 0) { selectedIds = newIds; render() }
			}
		}
		if ((e.key === 'g' || e.key === 'G') && !overlayEdit) { showGrid = !showGrid; render() }
		if (!e.ctrlKey && !e.metaKey && !overlayEdit && !frameNameOverlay) {
			const k = e.key.toLowerCase()
			if (k === 'v') tool = 'select'
			else if (k === 'p') tool = 'pen'
			else if (k === 't') tool = 'text'
			else if (k === 'n') tool = 'sticky'
			else if (k === 'r') tool = 'rect'
			else if (k === 'c') tool = 'circle'
			else if (k === 's') tool = 'shape'
			else if (k === 'a') tool = 'arrow'
			else if (k === 'x') tool = 'connector'
			else if (k === 'i') tool = 'image'
			else if (k === 'f') tool = 'frame'
			else if (k === 'e') tool = 'eraser'
		}
		if (e.key === 'Escape') {
			if (connectorFirstPt)   { connectorFirstPt = null; render(); return }
			if (overlayEdit)        { overlayEdit = null; return }
			if (frameNameOverlay)   { frameNameOverlay = null; return }
			if (lassoStart)         { lassoStart = null; lassoEnd = null; render(); return }
			if (selectedIds.size > 0) { selectedIds = new Set(); render(); return }
			requestClose()
		}
		if (e.key === 'Delete' && selectedIds.size > 0) {
			const ts = Date.now()
			for (const id of selectedIds) {
				const el = cs.elements.get(id)
				if (el && !el.deleted && !el.locked) {
					const del = { ...el, deleted: true, ts }
					pushUndo({ id, before: el, after: del })
					cs.apply(del); socket?.emit('canvas:op', { boardId, op: del })
				}
			}
			selectedIds = new Set(); render()
		}
		if (e.key === 'Enter' && overlayEdit) { e.preventDefault(); submitOverlay() }
	}
	function onKeyup(e: KeyboardEvent) {
		if (e.code === 'Space') spaceDown = false
	}

	// ── Portal ────────────────────────────────────────────────────────────────

	function portal(node: HTMLElement) {
		if (!browser) return
		document.body.appendChild(node)
		return { destroy() { if (document.body.contains(node)) document.body.removeChild(node) } }
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	let cursorCleanup: ReturnType<typeof setInterval>
	let ro: ResizeObserver

	onMount(() => {
		if (!browser) return
		ro = new ResizeObserver(() => {
			if (!canvasEl || !containerEl) return
			canvasEl.width  = containerEl.offsetWidth
			canvasEl.height = containerEl.offsetHeight
			render()
		})
		ro.observe(containerEl)

		socket?.on('canvas:snapshot',  handleSnapshot)
		socket?.on('canvas:op',        handleRemoteOp)
		socket?.on('canvas:clear',     handleRemoteClear)
		socket?.on('canvas:cursor',    handleRemoteCursor)
		socket?.on('canvas:chat',      handleCanvasChat)
		socket?.on('voice:speaking',   onVoiceSpeaking)
		socket?.on('canvas:sync:view', handleSyncView)
		socket?.emit('canvas:join', { boardId })

		window.addEventListener('keydown', onKeydown)
		window.addEventListener('keyup',   onKeyup)

		cursorCleanup = setInterval(() => {
			const now = Date.now(); let changed = false
			for (const [id, c] of remoteCursors) {
				if (c.lastSeen + 4000 < now) {
					remoteCursors.delete(id)
					peers = peers.filter(p => p.userId !== id)
					changed = true
				}
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
		socket?.off('canvas:chat',      handleCanvasChat)
		socket?.off('voice:speaking',   onVoiceSpeaking)
		socket?.off('canvas:sync:view', handleSyncView)
		window.removeEventListener('keydown', onKeydown)
		window.removeEventListener('keyup',   onKeyup)
		clearInterval(cursorCleanup)
	})

	// ── Effects ───────────────────────────────────────────────────────────────

	// Re-render when grid or background changes
	$effect(() => { void showGrid; render() })
	$effect(() => { void bgColor; render() })

	// Cursor style
	$effect(() => {
		if (!canvasEl) return
		canvasEl.style.cursor =
			isPanning || spaceDown ? (isPanning ? 'grabbing' : 'grab') :
			tool === 'eraser'      ? 'cell'     :
			tool === 'select'      ? 'default'  :
			tool === 'sticky' || tool === 'text' ? 'text' : 'crosshair'
	})

	// ── Coordinate helpers ────────────────────────────────────────────────────

	function cursorScreenPos(c: RemoteCursor): [number, number] {
		return worldToScreen(c.wx, c.wy, transform)
	}
	function overlayScreenPos(): [number, number] | null {
		if (!overlayEdit) return null
		return worldToScreen(overlayEdit.x, overlayEdit.y, transform)
	}

	function overlayFontStyle(): string {
		const fw = textBold   ? 'bold'   : 'normal'
		const fs = textItalic ? 'italic' : 'normal'
		const ff = textFontFamily === 'serif' ? 'Georgia,serif' : textFontFamily === 'mono' ? 'monospace' : 'inherit'
		return `color:${color}; font-size:${textFontSize}px; font-weight:${fw}; font-style:${fs}; font-family:${ff};`
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	use:portal
	role="dialog"
	aria-label="Canvas collaboratif"
	tabindex="-1"
	style="position:fixed; inset:0; z-index:9999; background:#0a0a10; display:flex; overflow:hidden;"
	onmousedown={(e) => { if (e.target === e.currentTarget) requestClose() }}
>
	<!-- ── Left toolbar ─────────────────────────────────────────────────────── -->
	<div
		style="display:flex; align-items:center; padding:0 10px; flex-shrink:0; z-index:20;"
		role="presentation"
		onmousedown={(e) => e.stopPropagation()}
	>
		<CanvasLeftToolbar bind:tool onClose={requestClose} />
	</div>

	<!-- ── Center: canvas + overlays ────────────────────────────────────────── -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={containerEl}
		style="flex:1; position:relative; overflow:hidden;"
		role="presentation"
		onmousedown={(e) => e.stopPropagation()}
	>
		<!-- Hidden file input for image upload -->
		<input
			bind:this={fileInputEl}
			type="file"
			accept="image/*"
			style="display:none"
			onchange={handleFileSelected}
		/>

		<!-- HTML5 Canvas -->
		<canvas
			bind:this={canvasEl}
			style="position:absolute; inset:0; width:100%; height:100%; touch-action:none;"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointerleave={onPointerUp}
			onwheel={onWheel}
			ondragover={(e) => e.preventDefault()}
			ondrop={handleCanvasDrop}
		></canvas>

		<!-- Image uploading indicator -->
		{#if imageUploading}
			<div style="position:absolute; top:60px; left:50%; transform:translateX(-50%); z-index:30; pointer-events:none;">
				<div class="flex items-center gap-2 bg-gray-900/90 px-4 py-2 rounded-full border border-violet-500/30 text-violet-300 text-sm">
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
					</svg>
					Upload en cours…
				</div>
			</div>
		{/if}

		<!-- ── Top bar (contextual tool options) ── -->
		<div role="presentation" style="position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:20; pointer-events:auto;"
		     onmousedown={(e) => e.stopPropagation()}>
			<CanvasTopBar
				bind:tool
				bind:color
				bind:lineWidth
				bind:textBold
				bind:textItalic
				bind:textUnderline
				bind:textStrike
				bind:textAlign
				bind:textFontSize
				bind:textFontFamily
				bind:shapeFill
				bind:shapeStroke
				bind:shapeStrokeW
				bind:shapeType
				bind:arrowStyle
				bind:arrowEndCap
				bind:connectorType
				bind:connectorStyle
				bind:connectorStartCap
				bind:connectorEndCap
			/>
		</div>

		<!-- ── Header badge ── -->
		<div style="position:absolute; top:12px; left:12px; z-index:10; pointer-events:none;">
			<div class="flex items-center gap-1.5 bg-gray-900/80 backdrop-blur px-3 py-1.5 rounded-full
			             border border-violet-500/30 text-xs font-semibold text-violet-300">
				<span class="w-2 h-2 rounded-full bg-violet-400 animate-pulse"></span>
				NodyxCanvas
			</div>
		</div>

		<!-- ── Bottom bar ── -->
		<div role="presentation" style="position:absolute; bottom:12px; left:50%; transform:translateX(-50%); z-index:20;"
		     onmousedown={(e) => e.stopPropagation()}>
			<CanvasBottomBar
				{transform}
				{canUndo}
				{canRedo}
				bind:showGrid
				bind:snapEnabled
				bind:bgColor
				onZoomIn={zoomIn}
				onZoomOut={zoomOut}
				onResetView={resetView}
				onUndo={undo}
				onRedo={redo}
			/>
		</div>

		<!-- ── Minimap + Brainwave Sync ── -->
		<div
			role="presentation"
			style="position:absolute; bottom:70px; right:12px; z-index:20; pointer-events:auto;"
			onmousedown={(e) => e.stopPropagation()}
		>
			<div class="minimap-wrap">
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
				<canvas
					bind:this={minimapEl}
					width={MINIMAP_W}
					height={MINIMAP_H}
					style="display:block; cursor:pointer; border-radius:8px 8px 0 0;"
					onclick={onMinimapClick}
					title="Minimap — cliquer pour naviguer"
				></canvas>
				<button
					class="sync-btn"
					class:sync-leading={syncMode === 'leading'}
					class:sync-following={syncMode === 'following'}
					onclick={toggleBrainwaveSync}
					title={syncMode === 'off'
						? 'Brainwave Sync — off (cliquer pour conduire)'
						: syncMode === 'leading'
						? 'Brainwave Sync — Conducteur (cliquer pour suivre)'
						: 'Brainwave Sync — Suiveur (cliquer pour désactiver)'}
				>
					{#if syncMode === 'off'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
							<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/>
						</svg>
					{:else if syncMode === 'leading'}
						<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
							<path d="M12 3a9 9 0 100 18A9 9 0 0012 3zm0 3.5a2 2 0 110 4 2 2 0 010-4zm0 10a6 6 0 01-4.47-2 6 6 0 018.94 0A6 6 0 0112 16.5z"/>
						</svg>
					{:else}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
							<circle cx="12" cy="12" r="2.5"/>
							<path stroke-linecap="round" d="M12 7V5M12 19v-2M7 12H5M19 12h-2M8.46 8.46l-1.41-1.41M16.95 16.95l-1.41-1.41M8.46 15.54l-1.41 1.41M16.95 7.05l-1.41 1.41"/>
						</svg>
					{/if}
					<span style="font-size:9px; font-weight:700; font-family:monospace; letter-spacing:0.05em;">
						{syncMode === 'off' ? 'SYNC' : syncMode === 'leading' ? 'LEAD' : 'FOLLOW'}
					</span>
				</button>
			</div>
		</div>

		<!-- ── Loading indicator ── -->
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

		<!-- ── Remote cursors ── -->
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
						style="background:{cursor.speaking ? '#a855f7' : '#4ade80'};"
					></div>
					<span class="absolute left-4 -top-1 whitespace-nowrap text-xs font-semibold
					             text-white bg-gray-900/80 px-1.5 py-0.5 rounded shadow">
						{cursor.username}
					</span>
				</div>
			</div>
		{/each}

		<!-- ── Sticky / text overlay ── -->
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
							<!-- svelte-ignore a11y_autofocus -->
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
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								class="px-3 py-2 rounded-lg bg-gray-900/95 border border-violet-500/40
								       placeholder-gray-500 outline-none shadow-xl min-w-[240px]"
								style={overlayFontStyle()}
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

		<!-- ── Frame name overlay ── -->
		{#if frameNameOverlay}
			{@const [fx, fy] = worldToScreen(frameNameOverlay.x, frameNameOverlay.y, transform)}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="absolute z-20"
				style="left:{fx}px; top:{fy - 36}px;"
				role="presentation"
				onmousedown={(e) => e.stopPropagation()}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					class="px-3 py-1.5 rounded-lg bg-gray-900/95 border border-violet-500/50
					       text-white placeholder-gray-500 outline-none shadow-xl text-sm font-semibold"
					style="min-width:160px; color:{shapeStroke};"
					placeholder="Nom du frame…"
					bind:value={frameNameText}
					onblur={submitFrameName}
					onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitFrameName() } }}
					autofocus
				/>
			</div>
		{/if}
	</div>

	<!-- ── Right panel (peers + chat) ───────────────────────────────────────── -->
	<div
		role="presentation"
		style="height:100%; flex-shrink:0;"
		onmousedown={(e) => e.stopPropagation()}
	>
		<CanvasRightPanel
			peers={allPeers}
			messages={chatMessages}
			{userId}
			{username}
			{boardName}
			bind:open={rightPanelOpen}
			onSend={sendChat}
		/>
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
	.minimap-wrap {
		background: rgba(10, 10, 18, 0.9);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 10px;
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.06);
	}
	.minimap-wrap canvas {
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.sync-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		width: 100%;
		padding: 5px 8px;
		border: none;
		background: transparent;
		color: #4b5563;
		cursor: pointer;
		transition: all 0.12s;
	}
	.sync-btn:hover { background: rgba(255,255,255,0.05); color: #9ca3af; }
	.sync-btn.sync-leading  { color: #a855f7; background: rgba(168,85,247,0.08); }
	.sync-btn.sync-leading:hover  { background: rgba(168,85,247,0.14); }
	.sync-btn.sync-following { color: #22d3ee; background: rgba(34,211,238,0.08); }
	.sync-btn.sync-following:hover { background: rgba(34,211,238,0.14); }

	.canvas-cursor-speaking {
		animation: avatar-breathe 1.5s ease-in-out infinite;
		filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.9));
	}
	@keyframes avatar-breathe {
		0%, 100% { transform: scale(1); }
		50%       { transform: scale(1.15); }
	}
</style>
