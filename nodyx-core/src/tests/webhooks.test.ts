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
