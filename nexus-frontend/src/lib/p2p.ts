import { browser } from '$app/environment'
import { writable } from 'svelte/store'

// ── Status stores ──────────────────────────────────────────────────────────────

export type P2PStatus = 'idle' | 'connecting' | 'p2p'
export const p2pStatus     = writable<P2PStatus>('idle')
export const p2pPeerCount  = writable(0)
// Briefly true when a P2P attempt was made but ICE negotiation failed gracefully
export const p2pFallback   = writable(false)

// ── P2PManager ────────────────────────────────────────────────────────────────

// ICE timeout: if a connection hasn't reached 'connected' within this delay,
// we give up and fall back to the server relay silently.
const ICE_TIMEOUT_MS = 12_000

class P2PManager {
  private connections    = new Map<string, RTCPeerConnection>() // peerId → PC
  private dataChannels   = new Map<string, RTCDataChannel>()    // peerId → DC
  private iceTimers      = new Map<string, ReturnType<typeof setTimeout>>()
  private socket: any    = null
  private channelId: string | null = null

  // Track whether we attempted any connection and whether any succeeded
  // — used to decide if a "fallback" toast is warranted.
  private _hadAttempt    = false
  private _hadSuccess    = false

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

    // Server sends back the list of peers already in the pool
    sock.on('p2p:peers', ({ channelId, peers }: { channelId: string; peers: string[] }) => {
      if (channelId !== this.channelId) return
      if (peers.length === 0) {
        // No one in this channel — immediately idle (don't stay stuck on "connecting")
        p2pStatus.set('idle')
        return
      }
      // We're the newcomer — initiate only where our ID is smaller (deterministic, no glare)
      for (const peerId of peers) {
        if (sock.id < peerId) this.initiate(peerId)
        // else: the existing peer will initiate with us (they receive p2p:new_peer)
      }
    })

    // An existing peer is told a newcomer arrived
    sock.on('p2p:new_peer', ({ channelId, peerId }: { channelId: string; peerId: string }) => {
      if (channelId !== this.channelId) return
      if (sock.id < peerId) this.initiate(peerId)
    })

    // Receive WebRTC offer from a peer (we are the responder)
    sock.on('p2p:offer', async ({ from, sdp, channelId }: { from: string; sdp: RTCSessionDescriptionInit; channelId: string }) => {
      if (channelId !== this.channelId) return
      await this.handleOffer(from, sdp)
    })

    // Receive WebRTC answer
    sock.on('p2p:answer', async ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = this.connections.get(from)
      if (!pc) return
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    })

    // Receive ICE candidate
    sock.on('p2p:ice', async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = this.connections.get(from)
      if (!pc) return
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch { /* ignore stale candidates */ }
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

    // Safety net: if ICE negotiation doesn't complete within ICE_TIMEOUT_MS, drop gracefully
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
        // ICE succeeded — cancel the timeout
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

    // Responder receives DataChannel opened by the initiator
    pc.ondatachannel = (e) => this.setupDC(peerId, e.channel)

    return pc
  }

  // Drop a peer that failed to connect, and optionally signal fallback to UI
  private gracefulDrop(peerId: string, pc: RTCPeerConnection): void {
    const dc       = this.dataChannels.get(peerId)
    const hadOpen  = dc?.readyState === 'open'
    try { dc?.close() } catch {}
    this.dataChannels.delete(peerId)
    this.connections.delete(peerId)
    try { pc.close() } catch {}

    // Signal fallback only if we never had a successful P2P connection
    // (don't alarm when a peer simply leaves an established session)
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
      this.syncStatus()
    }

    dc.onclose = () => {
      this.dataChannels.delete(peerId)
      this.connections.get(peerId)?.close()
      this.connections.delete(peerId)
      this.syncStatus()
    }

    dc.onerror = () => {
      this.dataChannels.delete(peerId)
      this.connections.get(peerId)?.close()
      this.connections.delete(peerId)
      this.syncStatus()
    }

    dc.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string)
        if (browser) window.dispatchEvent(new CustomEvent('p2p:message', { detail: data }))
      } catch { /* ignore malformed frames */ }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  joinChannel(channelId: string): void {
    if (!browser || !this.socket) return
    if (this.channelId === channelId) return
    this.leaveChannel()
    this.channelId      = channelId
    this._hadAttempt    = false
    this._hadSuccess    = false
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
    p2pStatus.set('idle')
    p2pPeerCount.set(0)
  }

  // Send a message over all open DataChannels; returns number of peers reached
  send(payload: unknown): number {
    const frame = JSON.stringify(payload)
    let sent = 0
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === 'open') { dc.send(frame); sent++ }
    }
    return sent
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
