/**
 * Le comptage des mentions d'un message, sans base de données (pur).
 * Sert au détecteur « Spam de mentions » ; le poids réel des groupes est
 * calculé à côté, dans mentionWeight.ts. Voir l'explication complète là-bas.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// Une marque entière : <span … data-mention="…">texte</span>. Le texte d'une
// marque n'est PAS relu comme un « @mot » (il serait compté deux fois).
// Quantificateurs bornés : un texte hostile ne fait jamais travailler la regex
// plus de quelques centaines de caractères par position.
const MARK_RE = new RegExp(`<span\\b[^>]{0,300}?\\bdata-mention="(u:${UUID}|g:(?:ici|equipe|moderation|tous|grade:${UUID}))"[^>]{0,300}>[^<]{0,200}</span>`, 'gi')
// Tolérant, comme avant ({1,32} : même les « @a » en série), lettres accentuées comprises
const AT_RE = /@[\p{L}\p{N}_-]{1,32}/gu

export interface MentionTally {
  /** Personnes mentionnées par une marque, répétitions comprises. */
  people: number
  /** « @mot » écrits hors marque, répétitions comprises. */
  words: number
  /** Marques de groupe, dans l'ordre, répétitions comprises (clés en minuscules). */
  groups: string[]
  /** Quelques mentions telles qu'écrites, pour l'extrait du journal. */
  sample: string[]
}

export function tallyMentions(content: string): MentionTally {
  const t: MentionTally = { people: 0, words: 0, groups: [], sample: [] }
  const rest = (content ?? '').replace(MARK_RE, (whole, value: string) => {
    const v = value.toLowerCase()
    if (v.startsWith('u:')) t.people++
    else t.groups.push(v.slice(2))
    if (t.sample.length < 3) t.sample.push(whole.replace(/<[^>]+>/g, '').trim() || `@${v.slice(2)}`)
    return ' '
  })
  for (const m of rest.matchAll(AT_RE)) {
    t.words++
    if (t.sample.length < 3) t.sample.push(m[0])
  }
  return t
}

/** Repli sans base : chaque marque et chaque « @mot » pèsent 1. */
export function countMentionsText(content: string): number {
  const t = tallyMentions(content)
  return t.people + t.words + t.groups.length
}
