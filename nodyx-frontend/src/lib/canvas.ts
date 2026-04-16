// ── NodyxCanvas — Types & CRDT State ─────────────────────────────────────────
// Collaborative canvas synced via Socket.IO.
// CRDT strategy: Last-Write-Wins per element (UUID + timestamp).

export type CanvasTool =
  | 'select' | 'pen' | 'text' | 'sticky'
  | 'rect'   | 'circle' | 'arrow' | 'connector'
  | 'image'  | 'frame'  | 'shape' | 'eraser'

export type AdvancedShape = 'triangle' | 'diamond' | 'star' | 'hexagon' | 'cloud'

export type PathData = {
  points: [number, number][]
  color:  string
  width:  number
  opacity?: number
}

export type StickyData = {
  x:     number
  y:     number
  w?:    number
  h?:    number
  text:  string
  color: string
}

export type ShapeData = {
  x:           number
  y:           number
  w:           number
  h:           number
  color:       string   // fill color
  fill:        boolean
  strokeColor?: string
  strokeWidth?: number
  opacity?:    number
  shape?:      AdvancedShape   // undefined = rect/circle (legacy)
  label?:      string          // text inside shape
}

export type TextData = {
  x:              number
  y:              number
  text:           string
  color:          string
  fontSize:       number
  bold?:          boolean
  italic?:        boolean
  underline?:     boolean
  strikethrough?: boolean
  align?:         'left' | 'center' | 'right'
  fontFamily?:    'sans' | 'serif' | 'mono'
  w?:             number   // max width (word-wrap)
}

export type ArrowData = {
  x1:         number
  y1:         number
  x2:         number
  y2:         number
  color:      string
  width:      number
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  startCap?:  'none' | 'arrow' | 'dot'
  endCap?:    'arrow' | 'none' | 'dot'
}

export type ImageData = {
  x:        number
  y:        number
  w:        number
  h:        number
  url:      string
  assetId?: string
  opacity?: number
}

export type FrameData = {
  x:     number
  y:     number
  w:     number
  h:     number
  name:  string
  color: string
}

export type ConnectorData = {
  x1: number; y1: number
  x2: number; y2: number
  type:     'straight' | 'bezier' | 'elbow'
  style:    'solid' | 'dashed' | 'dotted'
  color:    string
  width:    number
  startCap: 'none' | 'arrow' | 'dot'
  endCap:   'none' | 'arrow' | 'dot'
}

export type CanvasElement = {
  id:       string
  ts:       number
  author:   string
  kind:     CanvasTool
  data:     PathData | StickyData | ShapeData | TextData | ArrowData | ImageData | FrameData | ConnectorData
  deleted?: boolean
  url?:     string   // optional link on any element
}

// ── Participants & Chat ───────────────────────────────────────────────────────

export type CanvasPeer = {
  userId:   string
  username: string
  avatar?:  string | null
  tool?:    CanvasTool
  color?:   string
  active:   boolean   // was seen in last 30s
}

export type CanvasChatMsg = {
  id:       string
  userId:   string
  username: string
  text:     string
  ts:       number
}

// Socket.IO message types
export type CanvasSocketOp = {
  boardId: string
  op:      CanvasElement
}

export type CanvasSocketClear = {
  boardId: string
  ts:      number
  by:      string
}

export type CanvasSocketCursor = {
  boardId:  string
  userId:   string
  username: string
  x:        number   // world coordinates
  y:        number
  speaking: boolean
  tool?:    CanvasTool
  color?:   string
}

// ── View transform (pan + zoom) ───────────────────────────────────────────────

export type ViewTransform = {
  x:     number   // pan offset X (screen pixels)
  y:     number   // pan offset Y (screen pixels)
  scale: number   // zoom factor (1 = 100%)
}

export const DEFAULT_TRANSFORM: ViewTransform = { x: 0, y: 0, scale: 1 }
export const MIN_SCALE = 0.05
export const MAX_SCALE = 10

/** Convert screen coordinates → world coordinates */
export function screenToWorld(sx: number, sy: number, t: ViewTransform): [number, number] {
  return [(sx - t.x) / t.scale, (sy - t.y) / t.scale]
}

/** Convert world coordinates → screen coordinates */
export function worldToScreen(wx: number, wy: number, t: ViewTransform): [number, number] {
  return [wx * t.scale + t.x, wy * t.scale + t.y]
}

/** Zoom toward a screen-space pivot point */
export function zoomAt(t: ViewTransform, delta: number, pivotX: number, pivotY: number): ViewTransform {
  const factor   = delta < 0 ? 1.12 : 1 / 1.12
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * factor))
  const ratio    = newScale / t.scale
  return {
    x:     pivotX - (pivotX - t.x) * ratio,
    y:     pivotY - (pivotY - t.y) * ratio,
    scale: newScale,
  }
}

// ── CanvasState ───────────────────────────────────────────────────────────────

export class CanvasState {
  elements = new Map<string, CanvasElement>()

  apply(op: CanvasElement): boolean {
    const existing = this.elements.get(op.id)
    if (existing && existing.ts >= op.ts) return false
    this.elements.set(op.id, op)
    return true
  }

  clear(clearTs: number): void {
    for (const [id, el] of this.elements) {
      if (el.ts <= clearTs) {
        this.elements.set(id, { ...el, deleted: true, ts: clearTs })
      }
    }
  }

  loadSnapshot(elements: CanvasElement[]): void {
    this.elements.clear()
    for (const el of elements) {
      if (el?.id) this.elements.set(el.id, el)
    }
  }

  snapshot(): CanvasElement[] {
    return [...this.elements.values()]
      .filter(el => !el.deleted)
      .sort((a, b) => a.ts - b.ts)
  }

  isEmpty(): boolean { return this.snapshot().length === 0 }

  authorSet(): string[] {
    const s = new Set<string>()
    for (const el of this.elements.values()) {
      if (!el.deleted) s.add(el.author)
    }
    return [...s]
  }
}
