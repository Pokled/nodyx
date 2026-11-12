// ── Les textes des webhooks, rendus par le serveur ───────────────────────────
//
// Comme un e-mail : une fois parti vers Discord ou un téléphone, un message ne se
// retraduit plus. Il est donc rendu ici, dans la langue de l'instance (FR/EN, le
// reste retombe sur EN), cf serverStrings.ts. Les noms (membres, articles, règles)
// sont ceux de la communauté, insérés tels quels : chaque format les échappe.

import type { NodyxEvent } from '../services/webhooks/catalog'
import type { ServerLocale } from './serverStrings'

export interface Rendered {
  title: string
  text: string
  fields: Array<[string, string]>
  /** Couleur de la barre (Discord) : celle du cran ou de la famille. */
  color: number
  /** Priorité (ntfy) : 'high' pour une sanction ou une alerte, sinon 'default'. */
  priority: 'high' | 'default'
  link: string
}

const C = { blue: 0x3b82f6, red: 0xe5484d, orange: 0xf59e0b, violet: 0x8b5cf6, green: 0x22c55e, grey: 0xa1a1aa, amber: 0xffb020 }

type L = Record<string, string>
const FR: L = {
  test: 'Test', field_by: 'Par', field_rule: 'Règle', field_where: 'Où', field_category: 'Catégorie', field_artist: 'Artiste', field_duration: 'Durée',
  field_when: 'Quand', field_step: 'Étape', field_game: 'Jeu', field_text: 'Message', octoguard: 'OctoGuard', someone: 'quelqu\'un', a_member: 'un membre',
  link_open: 'Ouvrir dans la communauté', link_read: 'Lire l\'article', link_listen: 'Écouter', link_event: 'Voir l\'événement', link_live: 'Rejoindre le live',
  link_file: 'Voir la fiche', link_report: 'Ouvrir les signalements', link_appeal: 'Trancher la contestation',
}
const EN: L = {
  test: 'Test', field_by: 'By', field_rule: 'Rule', field_where: 'Where', field_category: 'Category', field_artist: 'Artist', field_duration: 'Duration',
  field_when: 'When', field_step: 'Step', field_game: 'Game', field_text: 'Message', octoguard: 'OctoGuard', someone: 'someone', a_member: 'a member',
  link_open: 'Open in the community', link_read: 'Read the article', link_listen: 'Listen', link_event: 'See the event', link_live: 'Join the live',
  link_file: 'See the member file', link_report: 'Open the reports', link_appeal: 'Decide the appeal',
}

function minutesText(m: number | null | undefined, l: ServerLocale): string {
  if (!m) return ''
  const fr = l === 'fr'
  if (m % 1440 === 0) { const d = m / 1440; return fr ? `${d} jour${d > 1 ? 's' : ''}` : `${d} day${d > 1 ? 's' : ''}` }
  if (m % 60 === 0) { const h = m / 60; return fr ? `${h} heure${h > 1 ? 's' : ''}` : `${h} hour${h > 1 ? 's' : ''}` }
  return fr ? `${m} minutes` : `${m} minutes`
}
function clock(iso: string | null | undefined, l: ServerLocale): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString(l === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Paris' }) } catch { return iso }
}

export function renderEvent(ev: NodyxEvent, locale: ServerLocale): Rendered {
  const fr = locale === 'fr'
  const t = fr ? FR : EN
  const who = ev.actor?.type === 'octoguard' ? t.octoguard : (ev.actor?.name || t.someone)
  const target = ev.target?.name || t.a_member
  // Un message mis de côté par le bouclier anti-raid n'a pas de règle : son nom réservé se traduit
  if (ev.rule === 'shield') ev = { ...ev, rule: fr ? 'Bouclier anti-raid' : 'Raid shield' }
  const title = ev.item?.title ?? ''
  const f: Array<[string, string]> = []
  const add = (k: string, v: string | null | undefined) => { if (v) f.push([k, v]) }
  let r: Omit<Rendered, 'fields'>

  switch (ev.type) {
    // ─── Vie de la communauté ───
    case 'forum.article':
      r = { title: title || (fr ? 'Nouvel article' : 'New article'), text: fr ? `Nouvel article de ${who}${ev.item?.category ? ` dans ${ev.item.category}` : ''}` : `New article by ${who}${ev.item?.category ? ` in ${ev.item.category}` : ''}`, color: C.blue, priority: 'default', link: t.link_read }
      add(t.field_category, ev.item?.category); add(t.field_by, who); break
    case 'forum.pinned':
      r = { title: title || (fr ? 'Article mis en avant' : 'Pinned article'), text: fr ? 'Cet article est maintenant mis en avant' : 'This article is now pinned', color: C.amber, priority: 'default', link: t.link_read }
      add(t.field_category, ev.item?.category); break
    case 'music.track':
      r = { title: title || (fr ? 'Nouveau morceau' : 'New track'), text: fr ? `Nouveau morceau${ev.item?.artist ? ` de ${ev.item.artist}` : ''}` : `New track${ev.item?.artist ? ` by ${ev.item.artist}` : ''}`, color: C.violet, priority: 'default', link: t.link_listen }
      add(t.field_artist, ev.item?.artist)
      if (ev.item?.duration_seconds) add(t.field_duration, `${Math.floor(ev.item.duration_seconds / 60)}:${String(ev.item.duration_seconds % 60).padStart(2, '0')}`)
      break
    case 'calendar.event':
      r = { title: title || (fr ? 'Nouvel événement' : 'New event'), text: fr ? 'Nouvel événement au calendrier' : 'New event on the calendar', color: C.orange, priority: 'default', link: t.link_event }
      add(t.field_when, clock(ev.item?.starts_at, locale)); add(t.field_where, ev.item?.place); break
    case 'poll.created':
      r = { title: title || (fr ? 'Nouveau sondage' : 'New poll'), text: fr ? `Nouveau sondage de ${who}` : `New poll by ${who}`, color: C.grey, priority: 'default', link: t.link_open }
      break
    case 'wiki.page':
      r = { title: title || (fr ? 'Nouvelle page du wiki' : 'New wiki page'), text: fr ? `Nouvelle page du wiki, par ${who}` : `New wiki page, by ${who}`, color: C.grey, priority: 'default', link: t.link_open }
      break
    case 'live.started':
      r = { title: fr ? `${who} est en live` : `${who} is live`, text: title || (fr ? 'Le live commence' : 'The live is starting'), color: C.red, priority: 'default', link: t.link_live }
      add(t.field_game, ev.item?.game); break
    case 'member.joined':
      r = { title: fr ? `Bienvenue à ${who} !` : `Welcome, ${who}!`, text: fr ? 'Une nouvelle arrivée dans la communauté' : 'A new arrival in the community', color: C.green, priority: 'default', link: t.link_open }
      break

    // ─── Modération (équipe seulement) ───
    case 'sanction.warn':
      r = { title: fr ? 'Avertissement' : 'Warning', text: fr ? `${who} a averti ${target}` : `${who} warned ${target}`, color: C.orange, priority: 'high', link: t.link_file }
      add(t.field_rule, ev.rule); add(t.field_where, ev.place); break
    case 'sanction.mute': {
      const d = minutesText(ev.details?.duration_minutes as number | null, locale)
      r = { title: d ? (fr ? `Sourdine de ${d}` : `${d} mute`) : (fr ? 'Sourdine' : 'Mute'), text: fr ? `${who} a mis ${target} en sourdine${d ? ` ${d}` : ''}` : `${who} muted ${target}${d ? ` for ${d}` : ''}`, color: C.red, priority: 'high', link: t.link_file }
      add(t.field_rule, ev.rule); add(t.field_where, ev.place); add(t.field_by, who); break
    }
    case 'sanction.unmute':
      r = { title: fr ? 'Sourdine levée' : 'Mute lifted', text: fr ? `La sourdine de ${target} est levée` : `${target}'s mute was lifted`, color: C.green, priority: 'default', link: t.link_file }; break
    case 'sanction.ban': {
      const d = minutesText(ev.details?.duration_minutes as number | null, locale)
      r = { title: fr ? 'Exclusion temporaire' : 'Temporary ban', text: fr ? `${who} a exclu ${target}${d ? ` pour ${d}` : ''}` : `${who} banned ${target}${d ? ` for ${d}` : ''}`, color: C.red, priority: 'high', link: t.link_file }
      add(t.field_rule, ev.rule); break
    }
    case 'sanction.delete':
      r = { title: fr ? 'Message retiré' : 'Message removed', text: fr ? `${who} a retiré un message de ${target}` : `${who} removed a message by ${target}`, color: C.red, priority: 'high', link: t.link_file }
      add(t.field_rule, ev.rule); add(t.field_where, ev.place); break
    case 'sanction.undone':
      r = { title: fr ? 'Décision annulée' : 'Decision undone', text: fr ? `Une décision visant ${target} a été annulée` : `A decision about ${target} was undone`, color: C.green, priority: 'default', link: t.link_file }; break
    case 'report.created':
      r = { title: fr ? 'Nouveau signalement' : 'New report', text: fr ? `${who} a signalé un message de ${target}` : `${who} reported a message by ${target}`, color: C.blue, priority: 'default', link: t.link_report }
      add(t.field_rule, ev.rule); add(t.field_where, ev.place); break
    case 'held.created':
      r = { title: fr ? 'Un message attend d\'être relu' : 'A message is waiting for review', text: fr ? `Un message de ${target} est retenu` : `A message by ${target} is held`, color: C.violet, priority: 'default', link: t.link_report }
      add(t.field_rule, ev.rule); break
    case 'held.approved':
      r = { title: fr ? 'Message approuvé' : 'Message approved', text: fr ? `Le message retenu de ${target} est publié` : `${target}'s held message is published`, color: C.green, priority: 'default', link: t.link_report }; break
    case 'held.refused':
      r = { title: fr ? 'Message refusé' : 'Message refused', text: fr ? `Le message retenu de ${target} n'est pas publié` : `${target}'s held message was not published`, color: C.grey, priority: 'default', link: t.link_report }; break
    case 'appeal.filed':
      r = { title: fr ? 'Une contestation à trancher' : 'An appeal to decide', text: fr ? `${target} conteste une décision` : `${target} contests a decision`, color: C.grey, priority: 'default', link: t.link_appeal }; break
    case 'appeal.upheld':
      r = { title: fr ? 'Contestation : décision maintenue' : 'Appeal: decision upheld', text: fr ? `${who} a maintenu la décision contestée par ${target}` : `${who} upheld the decision contested by ${target}`, color: C.grey, priority: 'default', link: t.link_appeal }; break
    case 'appeal.overturned':
      r = { title: fr ? 'Contestation : décision annulée' : 'Appeal: decision overturned', text: fr ? `${who} a annulé la décision contestée par ${target}` : `${who} overturned the decision contested by ${target}`, color: C.green, priority: 'default', link: t.link_appeal }; break
    case 'ladder.applied': case 'ladder.approved':
      r = { title: fr ? `Barème : étape ${ev.details?.step ?? '?'}` : `Ladder: step ${ev.details?.step ?? '?'}`, text: fr ? `${who} a appliqué le barème à ${target}` : `${who} applied the ladder to ${target}`, color: C.orange, priority: 'high', link: t.link_file }
      add(t.field_step, ev.details?.step != null ? String(ev.details.step) : null); add(t.field_rule, ev.rule); break
    case 'ladder.pending':
      r = { title: fr ? 'Une exclusion attend un second avis' : 'A ban awaits a second opinion', text: fr ? `${who} propose d'exclure ${target}` : `${who} proposes to ban ${target}`, color: C.red, priority: 'high', link: t.link_file }; break
    case 'ladder.dropped':
      r = { title: fr ? 'Barème : marche retirée' : 'Ladder: step dropped', text: fr ? `Une marche du barème de ${target} est retirée` : `A ladder step of ${target} was dropped`, color: C.grey, priority: 'default', link: t.link_file }; break
    case 'ladder.alert':
      r = { title: fr ? 'Barème : l\'équipe doit décider' : 'Ladder: the team must decide', text: fr ? `${target} a atteint l'exclusion du barème : OctoGuard n'exclut pas, à toi de voir` : `${target} reached the ban step: OctoGuard does not ban, your call`, color: C.red, priority: 'high', link: t.link_file }
      add(t.field_rule, ev.rule); break
    case 'shield.raised': {
      const d = minutesText(ev.details?.minutes as number | null, locale)
      const auto = ev.details?.reason === 'auto'
      r = { title: fr ? 'Bouclier anti-raid levé' : 'Raid shield raised',
        text: auto
          ? (fr ? `OctoGuard a repéré une vague et a levé le bouclier${d ? ` pour ${d}` : ''}. Les comptes tout neufs lisent sans écrire, les liens attendent d'être relus.` : `OctoGuard spotted a wave and raised the shield${d ? ` for ${d}` : ''}. Brand-new accounts can read but not write, links wait for review.`)
          : (fr ? `${who} a levé le bouclier${d ? ` pour ${d}` : ''}. Les comptes tout neufs lisent sans écrire, les liens attendent d'être relus.` : `${who} raised the shield${d ? ` for ${d}` : ''}. Brand-new accounts can read but not write, links wait for review.`),
        color: C.amber, priority: 'high', link: t.link_open }
      if (!auto) add(t.field_by, who); break
    }
    case 'shield.suggested':
      r = { title: fr ? 'Raid probable' : 'Possible raid', text: fr ? 'Une vague inhabituelle arrive. OctoGuard propose de lever le bouclier anti-raid : un bouton dans OctoGuard, Bouclier.' : 'An unusual wave is coming in. OctoGuard suggests raising the raid shield: one button in OctoGuard, Shield.', color: C.red, priority: 'high', link: t.link_open }; break
    case 'shield.lowered':
      r = { title: fr ? 'Bouclier baissé' : 'Shield lowered', text: fr ? `${who} a baissé le bouclier : tout le monde peut de nouveau écrire` : `${who} lowered the shield: everyone can write again`, color: C.green, priority: 'default', link: t.link_open }; break
    case 'octoguard.enabled':
      r = { title: fr ? 'OctoGuard allumé' : 'OctoGuard turned on', text: fr ? `${who} a allumé OctoGuard` : `${who} turned OctoGuard on`, color: C.green, priority: 'default', link: t.link_open }; break
    case 'octoguard.disabled':
      r = { title: fr ? 'OctoGuard éteint' : 'OctoGuard turned off', text: fr ? `${who} a éteint OctoGuard` : `${who} turned OctoGuard off`, color: C.grey, priority: 'default', link: t.link_open }; break
    case 'octoguard.settings':
      r = { title: fr ? 'Réglages d\'OctoGuard modifiés' : 'OctoGuard settings changed', text: fr ? `${who} a modifié un réglage d'OctoGuard` : `${who} changed an OctoGuard setting`, color: C.grey, priority: 'default', link: t.link_open }
      add(t.field_rule, ev.rule); break
    default:
      if (ev.type.startsWith('observation.')) {
        r = { title: fr ? 'Observation' : 'Observation', text: fr ? `Une règle en observation aurait agi sur ${target}` : `A rule in observation would have acted on ${target}`, color: C.grey, priority: 'default', link: t.link_report }
        add(t.field_rule, ev.rule); break
      }
      r = { title: ev.type, text: '', color: C.grey, priority: 'default', link: t.link_open }
  }
  if (ev.text) add(t.field_text, ev.text.length > 500 ? `${ev.text.slice(0, 500)}…` : ev.text)
  if (ev.test) r = { ...r, title: `[${t.test}] ${r.title}` }
  return { ...r, fields: f }
}
