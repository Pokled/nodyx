import { describe, it, expect } from 'vitest'
import { checkRuleParams } from '../services/octoguard/params'
import { BASE_PRESETS } from '../services/octoguard/profile'
import { matchLinkDomain } from '../services/octoguard/matchers'

// Les réglages qu'accepte le serveur, par type de règle (OctoGuard 2).
describe('checkRuleParams', () => {
  it('chaque modèle du profil de base passe : aucune installation ne casse', () => {
    for (const p of BASE_PRESETS) expect(checkRuleParams(p.type, p.params), p.key).toBeNull()
  })

  it('refuse ce qui ferait prendre tous les messages', () => {
    expect(checkRuleParams('flood', { max_repeats: 1 })?.field).toBe('max_repeats')
    expect(checkRuleParams('link_spam', { max_links: -1 })?.field).toBe('max_links')
    expect(checkRuleParams('caps', { min_length: 15, threshold_percent: 10 })?.field).toBe('threshold_percent')
    expect(checkRuleParams('caps', { min_length: 1 })?.field).toBe('min_length')
    expect(checkRuleParams('mention_spam', { max_mentions: 0 })?.field).toBe('max_mentions')
    expect(checkRuleParams('zalgo', { max_combining: 0 })?.field).toBe('max_combining')
  })

  it('refuse les types faux : texte, décimal, null', () => {
    expect(checkRuleParams('link_spam', { max_links: '3' })).not.toBeNull()
    expect(checkRuleParams('link_spam', { max_links: 2.5 })).not.toBeNull()
    expect(checkRuleParams('caps', { threshold_percent: null })).not.toBeNull()
  })

  it('accepte un réglage absent : le moteur prend sa valeur par défaut', () => {
    expect(checkRuleParams('caps', {})).toBeNull()
    expect(checkRuleParams('flood', undefined)).toBeNull()
  })

  it('les sites : domaine, sous-domaines, chemin ; pas n’importe quoi', () => {
    expect(checkRuleParams('link_domain', { domains: ['discord.gg', '*.example.com', 'discord.com/invite', 'chat.whatsapp.com'] })).toBeNull()
    expect(checkRuleParams('link_domain', { domains: ['pas un site'] })?.field).toBe('domains.0')
    expect(checkRuleParams('link_domain', { domains: ['javascript:alert(1)'] })).not.toBeNull()
    expect(checkRuleParams('link_domain', { mode: 'peut-etre', domains: [] })?.field).toBe('mode')
  })

  it('les mots : 500 au plus (ce que lit le moteur), 100 caractères chacun', () => {
    expect(checkRuleParams('keywords', { words: Array(500).fill('mot') })).toBeNull()
    expect(checkRuleParams('keywords', { words: Array(501).fill('mot') })?.field).toBe('words')
    expect(checkRuleParams('keywords', { words: ['x'.repeat(101)] })).not.toBeNull()
  })

  it('l’expression : présente, bornée, drapeaux connus', () => {
    expect(checkRuleParams('regex', { pattern: 'abc', flags: 'i' })).toBeNull()
    expect(checkRuleParams('regex', {})?.field).toBe('pattern')
    expect(checkRuleParams('regex', { pattern: 'abc', flags: 'z' })?.field).toBe('flags')
  })

  it('un type inconnu est refusé', () => {
    expect(checkRuleParams('telepathie', {})?.field).toBe('type')
  })

  it('les clés inconnues sont tolérées (anciens profils)', () => {
    expect(checkRuleParams('caps', { min_length: 15, ancienne_cle: true })).toBeNull()
  })
})

// La règle « Invitations » du profil de base liste discord.com/invite : avant,
// le moteur ne lisait que l'hôte et cette entrée ne correspondait à RIEN.
describe('matchLinkDomain : sites avec chemin', () => {
  const invites = BASE_PRESETS.find(p => p.key === 'base.invites')!.params
  const m = (content: string, params: Record<string, unknown> = invites) => matchLinkDomain({ content } as never, params as never)

  it('attrape enfin les invitations discord.com/invite', () => {
    expect(m('rejoins https://discord.com/invite/abc123')).not.toBeNull()
    expect(m('rejoins https://discordapp.com/invite/abc')).not.toBeNull()
    expect(m('https://DISCORD.com/Invite?code=1')).not.toBeNull()
  })
  it('ne prend pas le reste de discord.com', () => {
    expect(m('la doc https://discord.com/developers/docs')).toBeNull()
    expect(m('https://discord.com/invitement')).toBeNull()
    expect(m('https://discord.com')).toBeNull()
  })
  it('les entrées sans chemin marchent comme avant, sous-domaines compris', () => {
    expect(m('https://discord.gg/xyz')).not.toBeNull()
    expect(m('https://chat.whatsapp.com/abc')).not.toBeNull()
    expect(m('https://t.me/canal')).not.toBeNull()
    expect(m('https://pas-discord.gg.example.org/')).toBeNull()
  })
  it('liste blanche : un chemin autorisé n’autorise que lui', () => {
    const allow = { mode: 'whitelist', domains: ['example.com/docs'] }
    expect(m('https://example.com/docs/page', allow)).toBeNull()
    expect(m('https://example.com/autre', allow)).not.toBeNull()
  })
})
