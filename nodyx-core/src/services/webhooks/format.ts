/**
 * Webhooks : un événement mis en forme pour chaque outil. Aucune requête ici,
 * seulement ce qui partira (adresse, en-têtes, corps), pour être testable à sec.
 *
 * Les noms de la communauté (titres, pseudos) sont du texte de membres : chaque
 * format les échappe à sa façon, et aucune mention de masse n'est possible
 * (Discord : allowed_mentions vide ; Slack : < > & échappés).
 */
import { createHmac } from 'crypto'
import { isTeamFamily, type NodyxEvent } from './catalog'
import type { Rendered } from '../../i18n/webhookStrings'

export type Format = 'ntfy' | 'matrix' | 'discord' | 'slack' | 'json'
export interface Outgoing { url: string; headers: Record<string, string>; body: string }

export interface FormatContext {
  community: { name: string; url: string }
  deliveryId: string
  /** Secondes depuis l'époque, pour la signature (format json). */
  timestamp: number
  secret?: string | null
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const absolute = (base: string, path?: string | null) => {
  if (!path) return base
  try { return new URL(path, base.endsWith('/') ? base : `${base}/`).href } catch { return base }
}

export function buildOutgoing(format: Format, url: string, ev: NodyxEvent, r: Rendered, ctx: FormatContext): Outgoing {
  const link = absolute(ctx.community.url, ev.path)
  const json = (body: unknown, extra: Record<string, string> = {}): Outgoing => ({
    url, headers: { 'Content-Type': 'application/json', 'User-Agent': 'Nodyx-Webhooks/2', ...extra }, body: JSON.stringify(body),
  })

  switch (format) {
    case 'discord':
      return json({
        username: cut(isTeamFamily(ev.family) ? 'OctoGuard' : ctx.community.name, 80),
        allowed_mentions: { parse: [] },
        embeds: [{
          title: cut(r.title, 256), description: cut(r.text, 2000), color: r.color, url: link,
          fields: r.fields.slice(0, 10).map(([name, value]) => ({ name: cut(name, 256), value: cut(value, 1024), inline: value.length <= 40 })),
          footer: { text: cut(ctx.community.name, 2048) }, timestamp: ev.at,
        }],
      })

    case 'slack': {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return json({
        text: `${r.title} : ${r.text}`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: cut(`*${esc(r.title)}*\n${esc(r.text)}`, 3000) } },
          ...(r.fields.length ? [{ type: 'section', fields: r.fields.slice(0, 10).map(([k, v]) => ({ type: 'mrkdwn', text: cut(`*${esc(k)}*\n${esc(v)}`, 2000) })) }] : []),
          { type: 'context', elements: [{ type: 'mrkdwn', text: `<${link}|${esc(r.link)}> · ${esc(ctx.community.name)}` }] },
        ],
      })
    }

    case 'matrix': {
      // hookshot (webhook générique) : « text » en clair, « html » mis en forme
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      const plain = [r.title, r.text, ...r.fields.map(([k, v]) => `${k} : ${v}`), link].join('\n')
      const html = `<strong>${esc(r.title)}</strong><br>${esc(r.text)}` +
        (r.fields.length ? `<br>${r.fields.map(([k, v]) => `<em>${esc(k)}</em> ${esc(v)}`).join(' · ')}` : '') +
        `<br><a href="${esc(link)}">${esc(r.link)}</a>`
      return json({ text: plain, html, username: ctx.community.name })
    }

    case 'ntfy': {
      // Publication JSON (les en-têtes HTTP n'acceptent pas les accents) : on poste à
      // la racine du serveur ntfy avec le sujet dans le corps.
      const u = new URL(url)
      const parts = u.pathname.split('/').filter(Boolean)
      const topic = parts.pop() ?? ''
      u.pathname = `/${parts.join('/')}`
      const message = cut([r.text, ...r.fields.map(([k, v]) => `${k} : ${v}`)].join('\n'), 4000)
      const out = json({ topic, title: cut(r.title, 250), message, priority: r.priority === 'high' ? 4 : 3, tags: [ev.family], click: link })
      return { ...out, url: u.href }
    }

    case 'json': {
      const body = JSON.stringify({
        version: 2, event: ev.type, family: ev.family, delivery: ctx.deliveryId, at: ev.at, test: ev.test === true,
        community: ctx.community,
        actor: ev.actor ?? null, target: ev.target ?? null, item: ev.item ?? null, rule: ev.rule ?? null, place: ev.place ?? null,
        details: ev.details ?? null, text: r.text, title: r.title, url: link,
        ...(ev.text ? { message_text: ev.text } : {}),
      })
      const headers: Record<string, string> = {
        'Content-Type': 'application/json', 'User-Agent': 'Nodyx-Webhooks/2',
        'X-Nodyx-Event': ev.type, 'X-Nodyx-Delivery': ctx.deliveryId, 'X-Nodyx-Timestamp': String(ctx.timestamp),
      }
      if (ctx.secret) {
        headers['X-Nodyx-Signature'] = 'sha256=' + createHmac('sha256', ctx.secret).update(`${ctx.timestamp}.${body}`).digest('hex')
        // Compatibilité avec l'ancien webhook d'OctoGuard : signature du corps seul
        headers['X-Octoguard-Signature'] = 'sha256=' + createHmac('sha256', ctx.secret).update(body).digest('hex')
      }
      return { url, headers, body }
    }
  }
}
