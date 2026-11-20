// Les liens écrits sans « http(s):// » (trouvé en testant la prod le 20/11/2026) :
// « discord.gg/abc » passait à travers les invitations et les liens des comptes neufs.
import { describe, it, expect } from 'vitest'
import { findLinks, matchLinkDomain, matchLinkSpam } from '../services/octoguard/matchers'
import { BASE_PRESETS } from '../services/octoguard/profile'

const invites = BASE_PRESETS.find(p => p.key === 'base.invites')!.params
const newAccountLinks = BASE_PRESETS.find(p => p.key === 'base.new_account_links')!.params
const inv = (content: string) => matchLinkDomain({ content } as never, invites as never)
const fresh = (content: string) => matchLinkSpam({ content } as never, newAccountLinks as never)

describe('les invitations écrites sans « http »', () => {
  it('discord.gg, discord.com/invite, t.me, WhatsApp : attrapées', () => {
    for (const c of ['Rejoins mon serveur discord.gg/abcdef', 'viens sur discord.com/invite/xyz', 'mon canal : t.me/promo',
      'groupe chat.whatsapp.com/AbCdE', '(discord.gg/abc).', 'DISCORD.GG/ABC', 'www.discord.gg/abc'])
      expect([c, inv(c) !== null]).toEqual([c, true])
  })
  it('les formes avec « https:// » restent attrapées', () => {
    expect(inv('rejoins https://discord.gg/abc')).not.toBeNull()
  })
  it('un mot qui ressemble mais n’est pas le domaine : rien', () => {
    for (const c of ['j’adore discord', 'mydiscord.gg.example.org/x n’est pas discord', 'discord.com/channels/1 est un salon, pas une invitation'])
      expect([c, inv(c)]).toEqual([c, null])
  })
})

describe('les liens des comptes tout neufs, sans « http »', () => {
  it('un domaine avec chemin, « www. », ou une extension de site : un lien', () => {
    for (const c of ['va voir exemple.com', 'regarde www.site.fr', 'boutique.shop/promo', 'nodyx.org', 'free-nitro.xyz', 'Nodyx.org', 'STEAMCOMMUNLTY.COM/gift'])
      expect([c, fresh(c) !== null]).toEqual([c, true])
  })
  it('les faux amis ne sont PAS des liens', () => {
    for (const c of ['Fin.de la phrase', 'j’ai codé en node.js', 'ouvre index.html', 'la version 1.5.2', 'écris à lea@exemple.com',
      'merci @lea.fr', 'M.Dupont arrive', 'e.g. un exemple', 'README.md', '…', 'a.b', 'on passe par Socket.IO.', 'Vue.JS et Node.JS'])
      expect([c, fresh(c)]).toEqual([c, null])
  })
})

describe('findLinks', () => {
  it('lit l’hôte et le chemin, en minuscules, sans la ponctuation collée', () => {
    expect(findLinks('Va sur (Discord.GG/Abc), puis https://Nodyx.org/Doc.')).toEqual([
      { host: 'discord.gg', path: '/abc' }, { host: 'nodyx.org', path: '/doc' },
    ])
  })
  it('les liens dans le HTML d’un message sont lus comme avant', () => {
    expect(findLinks('<p>voir <a href="https://x.com/a">ici</a></p>')).toEqual([{ host: 'x.com', path: '/a' }])
  })
  it('s’arrête à 50 liens (message géant)', () => {
    expect(findLinks('a.com/x '.repeat(500)).length).toBe(51)
  })
  it('un texte hostile de 400 Ko passe vite (aucun retour arrière)', () => {
    for (const hostile of ['a-'.repeat(200_000), 'a.'.repeat(200_000), ('x'.repeat(60) + '.').repeat(6000), 'https://' + 'a'.repeat(400_000)]) {
      const t = performance.now(); findLinks(hostile); expect(performance.now() - t).toBeLessThan(150)
    }
  })
})
