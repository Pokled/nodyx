/**
 * Voix : quelqu'un qui ferme son onglet (ou perd le réseau) pendant un appel
 * doit quitter le salon pour de vrai.
 *
 * Bug reproduit en production le 10/10/2026 : le nettoyage de fin de
 * connexion lisait `socket.rooms` dans `disconnect`, où Socket.IO 4 l'a déjà
 * vidé. Il ne faisait rien : les autres n'étaient jamais prévenus (fantôme
 * dans la liste), la place restait prise (au retour, place 1 au lieu de 0 ;
 * au bout de 25, salon « plein »), et la bascule SFU comptait le fantôme
 * (seuil à 2 en production : un fantôme + une personne seule = bascule).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('../config/database', () => ({
  db: { query: vi.fn(async () => ({ rows: [{ role: 'member' }], rowCount: 1 })) },
  redis: {},
}))
vi.mock('../socket/rateLimiter', () => ({ checkRateLimit: () => false }))
vi.mock('../socket/voiceBascule', () => ({
  channelMode: () => 'mesh', onSeatCount: vi.fn(), onLeave: vi.fn(), onScreenShare: vi.fn(), onSfuReady: vi.fn(),
}))

import { registerVoiceHandlers } from '../socket/voice'
import * as bascule from '../socket/voiceBascule'

// ── Un faux serveur fidèle à Socket.IO 4 ─────────────────────────────────────
//
// À la déconnexion : `disconnecting` (salons encore là), sortie de tous les
// salons, PUIS `disconnect` (salons vides).

type Envoi = { salons: string[]; ev: string; payload: any }
let salons: Map<string, Set<string>>
let sockets: Map<string, any>
let envois: Envoi[]

function serveur() {
  const cible = (rs: string[]) => ({
    to: (r: string) => cible([...rs, r]),
    emit: (ev: string, payload: unknown) => { envois.push({ salons: rs, ev, payload }) },
  })
  return {
    to: (r: string) => cible([r]),
    in: (r: string) => ({ fetchSockets: async () => [...(salons.get(r) ?? [])].map(id => sockets.get(id)) }),
  }
}

function connecter(server: any, username = 'Doomguy') {
  const id = randomUUID()
  const handlers = new Map<string, Array<(...a: any[]) => any>>()
  const rooms = new Set<string>([id])
  const recus: { ev: string; payload: any }[] = []
  const socket = {
    id, rooms, data: { userId: randomUUID(), username, avatar: null },
    on: (ev: string, fn: any) => { handlers.set(ev, [...(handlers.get(ev) ?? []), fn]) },
    emit: (ev: string, payload: unknown) => { recus.push({ ev, payload }) },
    join: (r: string) => { rooms.add(r); (salons.get(r) ?? salons.set(r, new Set()).get(r)!).add(id) },
    leave: (r: string) => { rooms.delete(r); const s = salons.get(r); s?.delete(id); if (s?.size === 0) salons.delete(r) },
    to: (r: string) => ({ emit: (ev: string, payload: unknown) => { envois.push({ salons: [r], ev, payload }) } }),
  }
  sockets.set(id, socket)
  registerVoiceHandlers(socket as never, server as never)
  const fire = async (ev: string, ...a: unknown[]) => { for (const fn of handlers.get(ev) ?? []) await fn(...a) }
  return {
    socket, recus, fire,
    async rejoindre(canal: string) {
      await fire('voice:join', canal)
      return recus.filter(r => r.ev === 'voice:init').at(-1)!.payload
    },
    /** Onglet fermé : aucun voice:leave, la connexion tombe. */
    async couper() {
      await fire('disconnecting', 'transport close')
      for (const r of [...rooms]) socket.leave(r)
      await fire('disconnect', 'transport close')
      sockets.delete(id)
    },
  }
}

let CANAL = randomUUID()
const dernierEtat = () => envois.filter(e => e.ev === 'voice:channel_update' && e.payload.channelId === CANAL).at(-1)

beforeEach(() => {
  salons = new Map(); sockets = new Map(); envois = []; CANAL = randomUUID()
  vi.mocked(bascule.onLeave).mockClear()
})

describe('un participant coupe net (onglet fermé, réseau perdu)', () => {
  it('les autres sont prévenus : il disparaît de la liste du salon', async () => {
    const server = serveur()
    const reste = connecter(server, 'Reste')
    const part  = connecter(server, 'Part')
    await reste.rejoindre(CANAL); await part.rejoindre(CANAL)
    expect(dernierEtat()!.payload.members.map((m: any) => m.username).sort()).toEqual(['Part', 'Reste'])

    await part.couper()
    expect(dernierEtat()!.payload.members.map((m: any) => m.username)).toEqual(['Reste'])
    const parti = envois.find(e => e.ev === 'voice:peer_left')
    expect(parti?.salons).toEqual([`voice:${CANAL}`])
    expect(parti?.payload).toEqual({ channelId: CANAL, socketId: part.socket.id })
  })

  it('sa place est libérée : qui arrive ensuite reprend la place 0', async () => {
    const server = serveur()
    const a = connecter(server)
    expect((await a.rejoindre(CANAL)).mySeatIndex).toBe(0)
    await a.couper()
    const b = connecter(server)
    expect((await b.rejoindre(CANAL)).mySeatIndex).toBe(0)
  })

  it('25 coupures d\'affilée ne rendent pas le salon « plein »', async () => {
    const server = serveur()
    for (let i = 0; i < 25; i++) { const x = connecter(server); await x.rejoindre(CANAL); await x.couper() }
    const dernier = connecter(server)
    await dernier.fire('voice:join', CANAL)
    expect(dernier.recus.map(r => r.ev)).not.toContain('voice:full')
    expect(dernier.recus.find(r => r.ev === 'voice:init')?.payload.mySeatIndex).toBe(0)
  })

  it('la bascule SFU est prévenue du départ, avec le bon compte', async () => {
    const server = serveur()
    const a = connecter(server); const b = connecter(server)
    await a.rejoindre(CANAL); await b.rejoindre(CANAL)
    await b.couper()
    expect(bascule.onLeave).toHaveBeenCalledWith(server, CANAL, b.socket.id, 1)
  })

  it('un salon où il n\'était pas n\'est pas touché', async () => {
    const server = serveur()
    const AUTRE = randomUUID()
    const a = connecter(server)
    await a.rejoindre(AUTRE)
    const b = connecter(server)
    await b.couper()
    expect(envois.filter(e => e.ev === 'voice:peer_left')).toEqual([])
  })
})
