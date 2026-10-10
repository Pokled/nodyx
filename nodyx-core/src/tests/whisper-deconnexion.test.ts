/**
 * Chuchotements : un départ brutal (onglet fermé) doit être annoncé aux autres.
 * Même piège que voice-deconnexion.test.ts : à `disconnect`, Socket.IO 4 a
 * déjà vidé `socket.rooms`, personne n'était prévenu (10/10/2026).
 */

import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('../config/database', () => ({ db: { query: vi.fn() }, redis: {} }))
vi.mock('../socket/rateLimiter', () => ({ checkRateLimit: () => false }))

import { registerWhisperHandlers } from '../socket/whisper'

describe('départ brutal d\'un chuchotement', () => {
  it('les autres membres du salon reçoivent whisper:user_leave', async () => {
    const roomId = randomUUID()
    const handlers = new Map<string, Array<(...a: any[]) => any>>()
    const envois: { salon: string; ev: string; payload: any }[] = []
    const rooms = new Set<string>(['sock-1', `whisper:${roomId}`, 'presence'])
    const socket = {
      id: 'sock-1', rooms, data: { userId: 'u1', username: 'Doomguy', avatar: null },
      on: (ev: string, fn: any) => { handlers.set(ev, [...(handlers.get(ev) ?? []), fn]) },
      emit: () => {},
      to: (salon: string) => ({ emit: (ev: string, payload: unknown) => { envois.push({ salon, ev, payload }) } }),
    }
    registerWhisperHandlers({} as never, socket as never)

    // Ordre de Socket.IO 4 : disconnecting, sortie des salons, disconnect.
    for (const fn of handlers.get('disconnecting') ?? []) await fn('transport close')
    rooms.clear()
    for (const fn of handlers.get('disconnect') ?? []) await fn('transport close')

    expect(envois).toEqual([{
      salon: `whisper:${roomId}`, ev: 'whisper:user_leave',
      payload: { roomId, userId: 'u1', username: 'Doomguy' },
    }])
  })
})
