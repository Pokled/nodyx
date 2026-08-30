/**
 * Tests du relais Nodyx Activities (socket/activity.ts).
 *
 * Couvre l'invariant (hors room vocale ⇒ rien), les plafonds de taille, les
 * rate-limits, l'estampille `from` serveur, l'envoi ciblé `to`, et le fan-out
 * `sync`. Cf SPECS/NODYX_ACTIVITIES_CDC.md §3, §7.
 */

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import { activityRelay } from '../socket/activity'

const CH = randomUUID()
const ROOM = `voice:${CH}`

type Emit = { room: string; ev: string; payload: Record<string, unknown> }

function makeSocket(opts: { userId?: string; inRoom?: boolean } = {}) {
  const userId = opts.userId ?? randomUUID()
  const emits: Emit[] = []
  const rooms = new Set<string>(opts.inRoom === false ? [] : [ROOM])
  const socket = {
    id: 'sock-' + userId.slice(0, 6),
    data: { userId },
    rooms,
    to: (room: string) => ({
      emit: (ev: string, payload: Record<string, unknown>) => { emits.push({ room, ev, payload }) },
    }),
  }
  return { socket: socket as never, emits, userId }
}

function makeServer(inRoomSockets: { id: string; data: { userId: string } }[] = []) {
  const emits: Emit[] = []
  const server = {
    in: (_room: string) => ({ fetchSockets: async () => inRoomSockets }),
    to: (id: string) => ({
      emit: (ev: string, payload: Record<string, unknown>) => { emits.push({ room: id, ev, payload }) },
    }),
  }
  return { server: server as never, emits }
}

describe('invariant : appartenance à la room vocale', () => {
  it('un socket HORS de la room vocale ne relaie rien', async () => {
    const { socket, emits } = makeSocket({ inRoom: false })
    const { server } = makeServer()
    await activityRelay(socket, server, 'send', { channelId: CH, payload: { t: 'king' } })
    expect(emits).toHaveLength(0)
  })

  it('channelId non-UUID ⇒ rien', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'send', { channelId: 'pas-un-uuid', payload: {} })
    expect(emits).toHaveLength(0)
  })

  it('un socket DANS la room relaie', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'send', { channelId: CH, payload: { t: 'king', hp: 40 } })
    expect(emits).toHaveLength(1)
    expect(emits[0]).toMatchObject({ room: ROOM, ev: 'activity:msg' })
  })
})

describe('estampille `from` serveur', () => {
  it('`from` = socket.data.userId, jamais une valeur de l\'invité', async () => {
    const { socket, emits, userId } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'send', {
      channelId: CH, payload: { from: 'usurpé', t: 'x' },
    })
    expect(emits[0].payload.from).toBe(userId)
  })
})

describe('plafonds de taille', () => {
  it('payload > 8 Ko ⇒ rejeté', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'send', { channelId: CH, payload: { big: 'x'.repeat(9000) } })
    expect(emits).toHaveLength(0)
  })

  it('payload sérialisable juste sous le plafond ⇒ passe', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'send', { channelId: CH, payload: { s: 'x'.repeat(4000) } })
    expect(emits).toHaveLength(1)
  })

  it('snapshot blob > 12 Ko ⇒ rejeté', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'snapshot', { channelId: CH, blob: 'A'.repeat(13000) })
    expect(emits).toHaveLength(0)
  })

  it('snapshot blob non-string ⇒ rejeté', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'snapshot', { channelId: CH, blob: { not: 'a string' } as never })
    expect(emits).toHaveLength(0)
  })

  it('snapshot valide ⇒ relayé sur activity:snap', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'snapshot', { channelId: CH, blob: 'AAAA' })
    expect(emits).toHaveLength(1)
    expect(emits[0]).toMatchObject({ room: ROOM, ev: 'activity:snap', payload: { blob: 'AAAA' } })
  })

  it('payload cyclique (JSON.stringify jette) ⇒ rien, pas de crash', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await activityRelay(socket, server, 'send', { channelId: CH, payload: cyclic })
    expect(emits).toHaveLength(0)
  })
})

describe('envoi ciblé `to`', () => {
  it('`to` = un userId ⇒ seuls les sockets de cet utilisateur dans la room', async () => {
    const target = randomUUID()
    const { socket } = makeSocket()
    const { server, emits } = makeServer([
      { id: 's-target-1', data: { userId: target } },
      { id: 's-target-2', data: { userId: target } },
      { id: 's-autre',    data: { userId: randomUUID() } },
    ])
    await activityRelay(socket, server, 'send', { channelId: CH, to: target, payload: { t: 'send' } })
    expect(emits.map(e => e.room).sort()).toEqual(['s-target-1', 's-target-2'])
    expect(emits.every(e => e.ev === 'activity:msg')).toBe(true)
  })

  it('`to` inconnu dans la room ⇒ personne', async () => {
    const { socket } = makeSocket()
    const { server, emits } = makeServer([{ id: 's-x', data: { userId: randomUUID() } }])
    await activityRelay(socket, server, 'send', { channelId: CH, to: randomUUID(), payload: {} })
    expect(emits).toHaveLength(0)
  })
})

describe('sync', () => {
  it('fan-out à la room sur activity:sync_request', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    await activityRelay(socket, server, 'sync', { channelId: CH })
    expect(emits).toHaveLength(1)
    expect(emits[0]).toMatchObject({ room: ROOM, ev: 'activity:sync_request' })
  })
})

describe('rate-limit', () => {
  it('activity:snapshot : la 10e requête en < 1 s est bloquée', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    for (let i = 0; i < 12; i++) {
      await activityRelay(socket, server, 'snapshot', { channelId: CH, blob: 'AA' })
    }
    // règle : 9 / 1 s
    expect(emits.length).toBe(9)
  })

  it('activity:send : borné à 25 / s', async () => {
    const { socket, emits } = makeSocket()
    const { server } = makeServer()
    for (let i = 0; i < 30; i++) {
      await activityRelay(socket, server, 'send', { channelId: CH, payload: { i } })
    }
    expect(emits.length).toBe(25)
  })
})
