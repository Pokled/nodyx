import { browser } from '$app/environment'
import { writable } from 'svelte/store'

// ── Status stores ──────────────────────────────────────────────────────────────

export type P2PStatus = 'idle' | 'connecting' | 'p2p'
export const p2pStatus     = writable<P2PStatus>('idle')
export const p2pPeerCount  = writable(0)
// Briefly true when a P2P attempt was made but ICE negotiation failed gracefully
export const p2pFallback   = writable(false)
// Set of assetIds that at least one connected peer holds in memory
export const p2pAssetPeers = writable<Set<string>>(new Set())

// ── P2PManager ────────────────────────────────────────────────────────────────

const ICE_TIMEOUT_MS   = 12_000
const ASSET_CHUNK_SIZE = 32 * 1024       // 32 KB raw per chunk
const ASSET_REQ_TIMEOUT = 15_000         // 15 s before giving up on a P2P asset request
const ASSET_CACHE_MAX   = 50 * 1024 * 1024 // Don't cache assets > 50 MB total

// Helper: encode a Uint8Array slice to base64 without spread (safe for large buffers)
function u8ToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

class P2PManager {
  private connections    = new Map<string, RTCPeerConnection>()
  private dataChannels   = new Map<string, RTCDataChannel>()
  private iceTimers      = new Map<string, ReturnType<typeof setTimeout>>()
  private socket: any    = null
  private channelId: string | null = null

  private _hadAttempt    = false
  private _hadSuccess    = false

  // ── Asset transfer state ──────────────────────────────────────────────────
  // Assets this peer holds in memory (available to serve)
  private assetCache    = new Map<string, ArrayBuffer>()              // assetId → data
  private assetCacheBytes = 0
  // Which assets each connected peer holds
  private peerAssets    = new Map<string, Set<string>>()             // peerId → Set<assetId>
  // Pending outbound requests: reqId → resolve callback
  private assetWaiters  = new Map<string, (buf: ArrayBuffer | null) => void>()
  // Incoming chunks being assembled: reqId → state
  private incomingChunks = new Map<string, { total: number; chunks: string[]; received: number }>()

  // ── ICE configuration ────────────────────────────────────────────────────
  private iceConfig(): RTCConfiguration {
    const turnUrl    = (import.meta.env.PUBLIC_TURN_URL        as string | undefined) ?? ''
    const turnUser   = (import.meta.env.PUBLIC_TURN_USERNAME   as string | undefined) ?? ''
    const turnCred   = (import.meta.env.PUBLIC_TURN_CREDENTIAL as string | undefined) ?? ''
    if (!turnUrl) return { iceServers: [] }
    return { iceServers: [{ urls: turnUrl, username: turnUser, credential: turnCred }] }
  }

  // ── Attach to the existing Socket.IO instance ─────────────────────────────
  init(sock: any): void {
    if (!browser || this.socket) return
    this.socket = sock
    this.listenSignaling()
  }

  private listenSignaling(): void {
    const sock = this.socket

    sock.on('p2p:peers', ({ channelId, peers }: { channelId: string; peers: string[] }) => {
      if (channelId !== this.channelId) return
      if (peers.length === 0) { p2pStatus.set('idle'); return }
      for (const peerId of peers) {
        if (sock.id < peerId) this.initiate(peerId)
      }
    })

    sock.on('p2p:new_peer', ({ channelId, peerId }: { channelId: string; peerId: string }) => {
      if (channelId !== this.channelId) return
      if (sock.id < peerId) this.initiate(peerId)
    })

    sock.on('p2p:offer', async ({ from, sdp, channelId }: { from: string; sdp: RTCSessionDescriptionInit; channelId: string }) => {
      if (channelId !== this.channelId) return
      await this.handleOffer(from, sdp)
    })

    sock.on('p2p:answer', async ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = this.connections.get(from)
      if (!pc) return
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    })

    sock.on('p2p:ice', async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = this.connections.get(from)
      if (!pc) return
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch { /* stale */ }
    })
  }

  // ── RTCPeerConnection factory ─────────────────────────────────────────────
  private createPC(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(this.iceConfig())
    this.connections.set(peerId, pc)
    this._hadAttempt = true

    pc.onicecandidate = (e) => {
      if (e.candidate && this.channelId) {
        this.socket.emit('p2p:ice', { to: peerId, candidate: e.candidate, channelId: this.channelId })
      }
    }

    const timer = setTimeout(() => {
      if (pc.connectionState !== 'connected' && pc.connectionState !== 'completed') {
        console.log(`[p2p] ⏱ ICE timeout with ${peerId} — falling back to server relay`)
        this.gracefulDrop(peerId, pc)
      }
    }, ICE_TIMEOUT_MS)
    this.iceTimers.set(peerId, timer)

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'connected' || state === 'completed') {
        clearTimeout(this.iceTimers.get(peerId))
        this.iceTimers.delete(peerId)
      } else if (state === 'failed') {
        console.log(`[p2p] ❌ ICE failed with ${peerId} — falling back to server relay`)
        clearTimeout(this.iceTimers.get(peerId))
        this.iceTimers.delete(peerId)
        this.gracefulDrop(peerId, pc)
      }
      this.syncStatus()
    }

    pc.ondatachannel = (e) => this.setupDC(peerId, e.channel)
    return pc
  }

  private gracefulDrop(peerId: string, pc: RTCPeerConnection): void {
    const dc      = this.dataChannels.get(peerId)
    const hadOpen = dc?.readyState === 'open'
    try { dc?.close() } catch {}
    this.dataChannels.delete(peerId)
    this.connections.delete(peerId)
    try { pc.close() } catch {}
    this.removePeerAssets(peerId)

    if (!hadOpen && !this._hadSuccess && browser) {
      const stillOpen = [...this.dataChannels.values()].filter(d => d.readyState === 'open').length
      if (stillOpen === 0) {
        p2pFallback.set(true)
        setTimeout(() => p2pFallback.set(false), 4000)
      }
    }
    this.syncStatus()
  }

  // ── Initiator flow ────────────────────────────────────────────────────────
  private async initiate(peerId: string): Promise<void> {
    const pc = this.createPC(peerId)
    const dc = pc.createDataChannel('nexus-p2p')
    this.setupDC(peerId, dc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.socket.emit('p2p:offer', { to: peerId, sdp: offer, channelId: this.channelId })
  }

  // ── Responder flow ────────────────────────────────────────────────────────
  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.createPC(peerId)
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.socket.emit('p2p:answer', { to: peerId, sdp: answer, channelId: this.channelId })
  }

  // ── DataChannel setup ─────────────────────────────────────────────────────
  private setupDC(peerId: string, dc: RTCDataChannel): void {
    this.dataChannels.set(peerId, dc)

    dc.onopen = () => {
      console.log(`[p2p] ⚡ DataChannel ouvert avec ${peerId}`)
      this._hadSuccess = true
      // Announce all cached assets to the new peer
      for (const [assetId, data] of this.assetCache.entries()) {
        this.sendTo(peerId, { type: 'p2p:asset:have', assetId, size: data.byteLength })
      }
      this.syncStatus()
    }

    dc.onclose = () => {
      this.dataChannels.delete(peerId)
      this.removePeerAssets(peerId)
      this.connections.get(peerId)?.close()
      this.connections.delete(peerId)
      this.syncStatus()
    }

    dc.onerror = () => {
      this.dataChannels.delete(peerId)
      this.removePeerAssets(peerId)
      this.connections.get(peerId)?.close()
      this.connections.delete(peerId)
      this.syncStatus()
    }

    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string)
        // Asset protocol messages handled internally, not dispatched to window
        if (typeof msg?.type === 'string' && msg.type.startsWith('p2p:asset:')) {
          this.handleAssetMessage(peerId, msg)
        } else if (browser) {
          window.dispatchEvent(new CustomEvent('p2p:message', { detail: msg }))
        }
      } catch { /* ignore malformed frames */ }
    }
  }

  // ── Asset transfer protocol ───────────────────────────────────────────────

  private handleAssetMessage(from: string, msg: any): void {
    switch (msg.type) {

      case 'p2p:asset:have': {
        if (!this.peerAssets.has(from)) this.peerAssets.set(from, new Set())
        this.peerAssets.get(from)!.add(msg.assetId)
        p2pAssetPeers.update(s => { s.add(msg.assetId); return new Set(s) })
        console.log(`[p2p] 📦 Peer ${from.slice(0, 6)} has asset ${msg.assetId.slice(0, 8)}… (${(msg.size / 1024).toFixed(0)} Ko)`)
        break
      }

      case 'p2p:asset:want': {
        const data = this.assetCache.get(msg.assetId)
        if (!data) {
          this.sendTo(from, { type: 'p2p:asset:nope', reqId: msg.reqId })
          return
        }
        // Send in chunks
        const bytes = new Uint8Array(data)
        const total = Math.ceil(bytes.length / ASSET_CHUNK_SIZE) || 1
        for (let i = 0; i < total; i++) {
          const slice = bytes.subarray(i * ASSET_CHUNK_SIZE, (i + 1) * ASSET_CHUNK_SIZE)
          this.sendTo(from, { type: 'p2p:asset:chunk', reqId: msg.reqId, idx: i, total, b64: u8ToB64(slice) })
        }
        console.log(`[p2p] 📤 Sent asset ${msg.assetId.slice(0, 8)}… to ${from.slice(0, 6)} (${total} chunks)`)
        break
      }

      case 'p2p:asset:chunk': {
        let state = this.incomingChunks.get(msg.reqId)
        if (!state) {
          state = { total: msg.total, chunks: new Array(msg.total), received: 0 }
          this.incomingChunks.set(msg.reqId, state)
        }
        state.chunks[msg.idx] = msg.b64
        state.received++
        if (state.received === state.total) {
          this.incomingChunks.delete(msg.reqId)
          // Reassemble chunks (each is separately base64-encoded)
          const parts = state.chunks.map(b64 => {
            const bin  = atob(b64)
            const u8   = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
            return u8
          })
          const totalLen = parts.reduce((s, p) => s + p.length, 0)
          const result   = new Uint8Array(totalLen)
          let offset = 0
          for (const part of parts) { result.set(part, offset); offset += part.length }

          const resolve = this.assetWaiters.get(msg.reqId)
          if (resolve) {
            this.assetWaiters.delete(msg.reqId)
            console.log(`[p2p] 📥 Received asset via P2P (${(totalLen / 1024).toFixed(0)} Ko)`)
            resolve(result.buffer)
          }
        }
        break
      }

      case 'p2p:asset:nope': {
        const resolve = this.assetWaiters.get(msg.reqId)
        if (resolve) {
          this.assetWaiters.delete(msg.reqId)
          this.incomingChunks.delete(msg.reqId)
          resolve(null)
        }
        break
      }
    }
  }

  // Remove a disconnected peer's assets from the store
  private removePeerAssets(peerId: string): void {
    const had = this.peerAssets.get(peerId)
    this.peerAssets.delete(peerId)
    if (!had) return
    p2pAssetPeers.update(s => {
      for (const assetId of had) {
        const otherHasIt = [...this.peerAssets.values()].some(set => set.has(assetId))
        if (!otherHasIt) s.delete(assetId)
      }
      return new Set(s)
    })
  }

  // ── Public API ────────────────────────────────────────────────────────────

  joinChannel(channelId: string): void {
    if (!browser || !this.socket) return
    if (this.channelId === channelId) return
    this.leaveChannel()
    this.channelId   = channelId
    this._hadAttempt = false
    this._hadSuccess = false
    this.socket.emit('p2p:join', channelId)
    p2pStatus.set('connecting')
  }

  leaveChannel(): void {
    if (!this.channelId) return
    this.socket?.emit('p2p:leave', this.channelId)
    this.channelId   = null
    this._hadAttempt = false
    this._hadSuccess = false
    for (const timer of this.iceTimers.values()) clearTimeout(timer)
    this.iceTimers.clear()
    for (const pc of this.connections.values()) try { pc.close() } catch {}
    this.connections.clear()
    this.dataChannels.clear()
    this.peerAssets.clear()
    p2pStatus.set('idle')
    p2pPeerCount.set(0)
    p2pAssetPeers.set(new Set())
  }

  // Send to all open DCs; returns peer count reached
  send(payload: unknown): number {
    const frame = JSON.stringify(payload)
    let sent = 0
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === 'open') { dc.send(frame); sent++ }
    }
    return sent
  }

  // Send to a specific peer
  private sendTo(peerId: string, payload: unknown): boolean {
    const dc = this.dataChannels.get(peerId)
    if (dc?.readyState === 'open') { dc.send(JSON.stringify(payload)); return true }
    return false
  }

  // Announce an asset to all connected peers (call after fetching from server)
  announceAsset(assetId: string, data: ArrayBuffer): void {
    if (this.assetCacheBytes + data.byteLength > ASSET_CACHE_MAX) return
    this.assetCache.set(assetId, data)
    this.assetCacheBytes += data.byteLength
    this.send({ type: 'p2p:asset:have', assetId, size: data.byteLength })
  }

  // Try to download an asset from a peer; returns null if no peer has it
  async requestAsset(assetId: string): Promise<ArrayBuffer | null> {
    // Check local cache first
    const cached = this.assetCache.get(assetId)
    if (cached) return cached

    // Find a peer that has it with an open DC
    let targetPeer: string | null = null
    for (const [peerId, assets] of this.peerAssets.entries()) {
      const dc = this.dataChannels.get(peerId)
      if (dc?.readyState === 'open' && assets.has(assetId)) { targetPeer = peerId; break }
    }
    if (!targetPeer) return null

    const reqId = crypto.randomUUID()
    return new Promise<ArrayBuffer | null>((resolve) => {
      this.assetWaiters.set(reqId, resolve)
      this.sendTo(targetPeer!, { type: 'p2p:asset:want', reqId, assetId })
      setTimeout(() => {
        if (this.assetWaiters.has(reqId)) {
          this.assetWaiters.delete(reqId)
          this.incomingChunks.delete(reqId)
          resolve(null)
        }
      }, ASSET_REQ_TIMEOUT)
    })
  }

  // ── Internal status sync ──────────────────────────────────────────────────
  private syncStatus(): void {
    const open = [...this.dataChannels.values()].filter(dc => dc.readyState === 'open').length
    p2pPeerCount.set(open)
    if (open > 0) {
      p2pStatus.set('p2p')
    } else {
      const pending = [...this.connections.values()].some(
        pc => pc.connectionState === 'connecting' || pc.connectionState === 'new'
      )
      p2pStatus.set(pending ? 'connecting' : 'idle')
    }
  }
}

export const p2pManager = new P2PManager()
