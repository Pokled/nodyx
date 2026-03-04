// ── NexusCanvas — Types & CRDT State ─────────────────────────────────────────
// P2P collaborative canvas, session-only by default.
// CRDT strategy: Last-Write-Wins per element (UUID + timestamp).

export type CanvasTool = 'pen' | 'sticky' | 'rect' | 'circle' | 'eraser'

export type PathData = {
  points: [number, number][]
  color: string
  width: number
}

export type StickyData = {
  x: number
  y: number
  text: string
  color: string
}

export type ShapeData = {
  x: number
  y: number
  w: number
  h: number
  color: string
  fill: boolean
}

export type CanvasElement = {
  id: string
  ts: number
  author: string
  kind: CanvasTool
  data: PathData | StickyData | ShapeData
  deleted?: boolean
}

// P2P message types dispatched via p2pManager.send()
export type CanvasOp = {
  type: 'canvas:op'
} & CanvasElement

export type CanvasClear = {
  type: 'canvas:clear'
  by: string
  ts: number
}

export type CanvasCursor = {
  type: 'canvas:cursor'
  x: number
  y: number
  userId: string
  username: string
  speaking: boolean
}

export type CanvasP2PMessage = CanvasOp | CanvasClear | CanvasCursor

// ── CanvasState ───────────────────────────────────────────────────────────────

export class CanvasState {
  elements = new Map<string, CanvasElement>()

  /**
   * Apply a remote (or local) operation.
   * Returns true if the state actually changed (caller should redraw).
   * LWW rule: if an element with the same id already exists and has a
   * higher or equal timestamp, the incoming op is discarded.
   */
  apply(op: CanvasElement): boolean {
    const existing = this.elements.get(op.id)
    if (existing && existing.ts >= op.ts) return false
    this.elements.set(op.id, op)
    return true
  }

  /**
   * Clear all elements (broadcast canvas:clear).
   * Uses the provided timestamp so concurrent ops with higher ts survive.
   */
  clear(ts: number): void {
    // Soft-delete everything with ts <= clear timestamp
    for (const [id, el] of this.elements) {
      if (el.ts <= ts) {
        this.elements.set(id, { ...el, deleted: true, ts })
      }
    }
  }

  /**
   * All non-deleted elements sorted by creation timestamp (oldest first).
   * Used for rendering and export.
   */
  snapshot(): CanvasElement[] {
    return [...this.elements.values()]
      .filter(el => !el.deleted)
      .sort((a, b) => a.ts - b.ts)
  }

  isEmpty(): boolean {
    return this.snapshot().length === 0
  }

  authorSet(): string[] {
    const authors = new Set<string>()
    for (const el of this.elements.values()) {
      if (!el.deleted) authors.add(el.author)
    }
    return [...authors]
  }
}
