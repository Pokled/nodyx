// « ! » dans l'aide (lot C6) : la réponse du serveur devient des lignes de l'aide.
import { describe, it, expect } from 'vitest'
import { bangToCommands } from './commands'

describe('bangToCommands', () => {
  const api = {
    twitch: 'pokled',
    commands: [
      { name: 'regles', source: 'octoguard' as const, restricted: false },
      { name: 'jeux', source: 'octoguard' as const, restricted: true, channels: [{ id: 'x', name: 'général' }] },
      { name: 'nodyx', source: 'twitch' as const, restricted: false, native: true },
      { name: 'github', source: 'twitch' as const, restricted: false },
      { name: 'so', source: 'twitch' as const, restricted: true, native: true },
      { name: '<img onerror=x>', source: 'twitch' as const, restricted: false },
    ],
  }
  const rows = bangToCommands(api)
  it('OctoGuard : dans le chat, avec ses salons et sa restriction', () => {
    expect(rows.find(r => r.name === 'jeux')).toMatchObject({ trigger: '!', where: ['chat'], channels: ['général'], restricted: true, descKey: 'cmd.bang_og' })
  })
  it('Twitch : la description d’une native, celle d’une commande de l’équipe, la chaîne en variable', () => {
    expect(rows.find(r => r.name === 'nodyx')).toMatchObject({ where: ['twitch'], descKey: 'cmd.bang_tw_nodyx', descVars: { channel: 'pokled' } })
    expect(rows.find(r => r.name === 'github')?.descKey).toBe('cmd.bang_tw_custom')
    expect(rows.find(r => r.name === 'so')?.restricted).toBe(true)
  })
  it('deux commandes de même nom et même source : une seule ligne (sinon la page meurt)', () => {
    const r = bangToCommands({ twitch: 'p', commands: [{ name: 'nodyx', source: 'twitch', restricted: false, native: true }, { name: 'nodyx', source: 'twitch', restricted: false }] })
    expect(r).toHaveLength(1)
    expect(new Set(r.map(x => x.id)).size).toBe(r.length)
  })
  it('un nom hors règle est écarté', () => {
    expect(rows.some(r => r.name.includes('<'))).toBe(false)
  })
  it('réponse vide ou absente : aucune ligne', () => {
    expect(bangToCommands(null)).toEqual([])
    expect(bangToCommands({ commands: [], twitch: null })).toEqual([])
  })
})
