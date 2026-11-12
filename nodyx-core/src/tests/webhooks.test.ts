import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'crypto'

vi.mock('../config/database', () => ({ db: { query: vi.fn() }, redis: {} }))
vi.mock('../socket/io', () => ({ io: null }))

import { accepts, shapeFor } from '../services/webhooks/dispatch'
import { buildOutgoing } from '../services/webhooks/format'
import { renderEvent } from '../i18n/webhookStrings'
import { fromOctoGuardLog, TEAM_FAMILIES, PUBLIC_FAMILIES, type NodyxEvent } from '../services/webhooks/catalog'

const dest = (o: Record<string, unknown> = {}) => ({ kind: 'team' as 'public' | 'team', events: [...TEAM_FAMILIES, ...PUBLIC_FAMILIES] as string[], enabled: true, paused_at: null as string | null, options: {}, include_text: false, ...o })
const ev = (o: Partial<NodyxEvent> = {}): NodyxEvent => ({ type: 'sanction.mute', family: 'sanctions', at: '2026-11-12T03:04:00Z', actor: { type: 'octoguard' }, target: { type: 'user', name: 'remi' }, rule: 'Inondation', details: { duration_minutes: 60 }, ...o })
const ctx = { community: { name: 'Vieux Looters', url: 'https://vieuxlooters.nodyx.org' }, deliveryId: 'd-1', timestamp: 1794454891, secret: 'un-secret-de-test-assez-long' }

describe('D39 : la modération ne part jamais vers une destination publique', () => {
  it('aucune famille d’équipe n’est acceptée par une destination publique, même cochée par erreur', () => {
    const pub = dest({ kind: 'public' })
    for (const f of TEAM_FAMILIES) expect([f, accepts(pub, { family: f })]).toEqual([f, false])
    for (const f of PUBLIC_FAMILIES) expect([f, accepts(pub, { family: f })]).toEqual([f, true])
  })
  it('une destination d’équipe reçoit ce qu’elle a coché, et seulement ça', () => {
    expect(accepts(dest({ events: ['sanctions'] }), { family: 'sanctions' })).toBe(true)
    expect(accepts(dest({ events: ['sanctions'] }), { family: 'reports' })).toBe(false)
  })
  it('éteinte ou en pause : rien ne part', () => {
    expect(accepts(dest({ enabled: false }), { family: 'sanctions' })).toBe(false)
    expect(accepts(dest({ paused_at: '2026-11-12' }), { family: 'sanctions' })).toBe(false)
  })
  it('forum : seulement les catégories choisies (aucune choisie = toutes)', () => {
    const d = dest({ kind: 'public', options: { forum_categories: ['c1'] } })
    expect(accepts(d, { family: 'forum_article', details: { category_id: 'c1' } })).toBe(true)
    expect(accepts(d, { family: 'forum_article', details: { category_id: 'c2' } })).toBe(false)
    expect(accepts(dest({ kind: 'public' }), { family: 'forum_article', details: { category_id: 'c2' } })).toBe(true)
  })
  it('le texte d’un message ne part que vers une destination d’équipe qui l’a demandé', () => {
    const e = ev({ text: 'sérieux max tu sers à rien' })
    expect(shapeFor(dest({ kind: 'public' }), e).text).toBeUndefined()
    expect(shapeFor(dest({ include_text: false }), e).text).toBeUndefined()
    expect(shapeFor(dest({ include_text: true }), e).text).toBe('sérieux max tu sers à rien')
  })
})

describe('les messages, en français et en anglais', () => {
  it('une sourdine, avec sa durée et sa règle', () => {
    const fr = renderEvent(ev(), 'fr')
    expect(fr.title).toBe('Sourdine de 1 heure')
    expect(fr.text).toBe('OctoGuard a mis remi en sourdine 1 heure')
    expect(fr.fields).toContainEqual(['Règle', 'Inondation'])
    expect(renderEvent(ev(), 'en').text).toBe('OctoGuard muted remi for 1 hour')
  })
  it('un nouvel article, un test marqué comme tel', () => {
    const a = renderEvent(ev({ type: 'forum.article', family: 'forum_article', actor: { type: 'member', name: 'lea' }, item: { title: 'Guide', category: 'Entraide' }, test: true }), 'fr')
    expect(a.title).toBe('[Test] Guide')
    expect(a.text).toBe('Nouvel article de lea dans Entraide')
  })
})

describe('les formats', () => {
  it('Discord : aucune mention de masse possible, même si un titre contient @everyone', () => {
    const e = ev({ type: 'forum.article', family: 'forum_article', actor: { type: 'member', name: 'lea' }, item: { title: '@everyone venez voir' } })
    const o = JSON.parse(buildOutgoing('discord', 'https://discord.com/api/webhooks/1/x', e, renderEvent(e, 'fr'), ctx).body)
    expect(o.allowed_mentions).toEqual({ parse: [] })
    expect(o.embeds[0].title).toBe('@everyone venez voir')
    expect(o.username).toBe('Vieux Looters')
    const m = JSON.parse(buildOutgoing('discord', 'https://discord.com/api/webhooks/1/x', ev(), renderEvent(ev(), 'fr'), ctx).body)
    expect(m.username).toBe('OctoGuard')
    expect(m.embeds[0].url).toBe('https://vieuxlooters.nodyx.org')
  })
  it('Slack : < > & échappés (pas de lien piégé dans un pseudo)', () => {
    const e = ev({ target: { type: 'user', name: '<!channel> <http://x|y>' } })
    const o = JSON.parse(buildOutgoing('slack', 'https://hooks.slack.com/services/a', e, renderEvent(e, 'fr'), ctx).body)
    expect(JSON.stringify(o.blocks)).not.toContain('<!channel>')
    expect(JSON.stringify(o.blocks)).toContain('&lt;!channel&gt;')
  })
  it('Matrix : le HTML est échappé', () => {
    const e = ev({ target: { type: 'user', name: '<script>x</script>' } })
    const o = JSON.parse(buildOutgoing('matrix', 'https://hookshot.example/webhook/1', e, renderEvent(e, 'fr'), ctx).body)
    expect(o.html).not.toContain('<script>')
    expect(o.text).toContain('<script>x</script>')
  })
  it('ntfy : publication JSON à la racine, sujet dans le corps, priorité haute pour une sanction', () => {
    const out = buildOutgoing('ntfy', 'https://ntfy.sh/mon-sujet', ev(), renderEvent(ev(), 'fr'), ctx)
    expect(out.url).toBe('https://ntfy.sh/')
    const b = JSON.parse(out.body)
    expect(b.topic).toBe('mon-sujet')
    expect(b.priority).toBe(4)
    expect(b.click).toBe('https://vieuxlooters.nodyx.org')
  })
  it('JSON : signature sur « timestamp.corps », vérifiable avec le secret ; ancienne signature gardée', () => {
    const out = buildOutgoing('json', 'https://n8n.example/hook', ev(), renderEvent(ev(), 'fr'), ctx)
    const want = 'sha256=' + createHmac('sha256', ctx.secret).update(`${ctx.timestamp}.${out.body}`).digest('hex')
    expect(out.headers['X-Nodyx-Signature']).toBe(want)
    expect(out.headers['X-Nodyx-Timestamp']).toBe(String(ctx.timestamp))
    expect(out.headers['X-Nodyx-Event']).toBe('sanction.mute')
    expect(out.headers['X-Octoguard-Signature']).toBe('sha256=' + createHmac('sha256', ctx.secret).update(out.body).digest('hex'))
    expect(JSON.parse(out.body)).toMatchObject({ version: 2, event: 'sanction.mute', family: 'sanctions', delivery: 'd-1' })
    // Sans secret : pas de signature (rien de faux)
    expect(buildOutgoing('json', 'https://n8n.example/hook', ev(), renderEvent(ev(), 'fr'), { ...ctx, secret: null }).headers['X-Nodyx-Signature']).toBeUndefined()
  })
})

describe('le journal d’OctoGuard devient un événement d’équipe', () => {
  it('un signalement d’un membre : c’est le membre qui signale, l’endroit est gardé, pas de texte', () => {
    const e = fromOctoGuardLog({ action: 'octoguard.report_filed', target_type: 'message', target_label: '#jeux', metadata: { actor: 'octoguard:auto', reporter_id: 'u1', category: 'harassment' } })!
    expect(e).toMatchObject({ type: 'report.created', family: 'reports', actor: { type: 'member' }, place: '#jeux', text: null })
  })
  it('une action automatique : l’extrait du message devient le texte (filtré ensuite par shapeFor), jamais le nom', () => {
    const e = fromOctoGuardLog({ action: 'octoguard.delete_message', target_type: 'user', target_label: 'insulte en clair', metadata: { actor: 'octoguard:auto', rule_id: 'r', rule_name: 'Mots interdits' } })!
    expect(e.text).toBe('insulte en clair')
    expect(e.target?.name).toBeNull()
    expect(e.actor).toEqual({ type: 'octoguard' })
  })
  it('une sourdine posée par l’équipe : le motif n’est pas pris pour du texte de message', () => {
    const e = fromOctoGuardLog({ action: 'octoguard.mute_user', target_type: 'user', target_label: 'On se calme une heure', metadata: { actor: 'admin' } })!
    expect(e.text).toBeNull()
    expect(e.actor?.type).toBe('member')
  })
  it('observation, barème, réglages ; et le bruit interne ne part pas', () => {
    expect(fromOctoGuardLog({ action: 'octoguard.would_delete_message', target_type: 'user', target_label: null, metadata: {} })?.family).toBe('observations')
    expect(fromOctoGuardLog({ action: 'octoguard.ladder_applied', target_type: 'user', target_label: 'remi', metadata: { step: 2, sanction: 'mute_1h' } })).toMatchObject({ family: 'ladder', details: { step: 2 } })
    expect(fromOctoGuardLog({ action: 'octoguard.rule_updated', target_type: 'rule', target_label: 'x', metadata: {} })?.family).toBe('og_settings')
    expect(fromOctoGuardLog({ action: 'octoguard.ban_expired', target_type: 'user', target_label: null, metadata: {} })).toBeNull()
  })
})

describe('webhooks : le bouclier anti-raid (lot 6)', () => {
  it('lever, proposer, baisser : famille d’équipe « shield », jamais publique', () => {
    expect(TEAM_FAMILIES).toContain('shield')
    expect(PUBLIC_FAMILIES as readonly string[]).not.toContain('shield')
    const up = fromOctoGuardLog({ action: 'octoguard.shield_raised', target_type: null, target_label: null, actor_id: 'u1', metadata: { event_id: 'e', actor: 'u1', minutes: 30, until: '2026-11-12T21:30:00Z', reason: 'manual' } })
    expect(up).toMatchObject({ type: 'shield.raised', family: 'shield', details: { minutes: 30, reason: 'manual' } })
    expect(fromOctoGuardLog({ action: 'octoguard.shield_suggested', target_type: null, target_label: null, metadata: { event_id: 'e', actor: 'octoguard:auto' } })?.type).toBe('shield.suggested')
    expect(fromOctoGuardLog({ action: 'octoguard.shield_lowered', target_type: null, target_label: null, actor_id: 'u1', metadata: { event_id: 'e', actor: 'u1' } })?.family).toBe('shield')
  })
  it('le texte : clair, en haute priorité, sans jargon', () => {
    const base = { at: '2026-11-12T21:00:00Z', family: 'shield' } as unknown as NodyxEvent
    const auto = renderEvent({ ...base, type: 'shield.raised', actor: { type: 'octoguard' }, details: { minutes: 30, reason: 'auto' } } as NodyxEvent, 'fr')
    expect(auto.title).toBe('Bouclier anti-raid levé')
    expect(auto.text).toContain('OctoGuard a repéré une vague')
    expect(auto.priority).toBe('high')
    const hand = renderEvent({ ...base, type: 'shield.raised', actor: { type: 'member', name: 'lea' }, details: { minutes: 60, reason: 'manual' } } as NodyxEvent, 'en')
    expect(hand.text).toMatch(/^lea raised the shield for 1 hour/)
    expect(renderEvent({ ...base, type: 'shield.suggested', actor: { type: 'octoguard' } } as NodyxEvent, 'fr').title).toBe('Raid probable')
  })
  it('un message mis de côté par le bouclier : la « règle » se traduit', () => {
    const r = renderEvent({ at: '2026-11-12T21:00:00Z', type: 'held.created', family: 'held', actor: { type: 'octoguard' }, rule: 'shield', target: { type: 'user', name: 'neo' } } as unknown as NodyxEvent, 'fr')
    expect(r.fields).toContainEqual(['Règle', 'Bouclier anti-raid'])
  })
})
