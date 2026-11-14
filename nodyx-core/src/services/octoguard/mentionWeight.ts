/**
 * Ce que pèse un message en mentions, pour la règle « Spam de mentions ».
 *
 * Avant : la règle comptait les « @mot » écrits en lettres non accentuées. Une
 * mention de groupe comptait pour une seule personne (`@tous` prévenait toute la
 * communauté et pesait 1), et `@équipe` n'était même pas vu (le « é »).
 *
 * Maintenant, une mesure unique :
 *  - une personne mentionnée (marque `u:` ou ancien « @pseudo ») pèse 1, autant
 *    de fois qu'elle est écrite (répéter un nom en rafale reste du spam) ;
 *  - un groupe pèse le nombre réel de personnes qu'il prévient (plafonné comme
 *    l'envoi lui-même), au moins 1 ; s'il revient plusieurs fois, chaque reprise
 *    pèse 1 de plus (personne n'est prévenu deux fois) ;
 *  - un groupe que l'auteur n'a pas le droit d'utiliser (`@tous` hors équipe) ne
 *    prévient personne : il pèse 1, comme un mot ;
 *  - les lettres accentuées sont lues (`@équipe`, `@Zoé`).
 *
 * `countMentionsText` est la version sans base : elle sert de repli au détecteur
 * quand le moteur n'a pas fourni le poids (chaque marque y pèse 1).
 */

import { groupKeysIn, isTeam, membersOf, MAX_GROUP_RECIPIENTS } from '../mentionGroups'
import { tallyMentions } from './mentionTally'

export { tallyMentions, countMentionsText } from './mentionTally'

/**
 * Le poids réel : les groupes valent les personnes qu'ils préviennent.
 * Ne lève jamais : au moindre souci sur un groupe, il pèse 1 (le repli).
 * `cache` : pour le rejeu, qui pèse des milliers de messages d'affilée (la
 * taille d'un groupe et l'appartenance d'un auteur à l'équipe y sont lues une fois).
 */
export async function mentionWeight(content: string, communityId: string | null, authorId: string, cache?: Map<string, number>): Promise<number> {
  const t = tallyMentions(content)
  let weight = t.people + t.words
  if (!t.groups.length) return weight
  const distinct = groupKeysIn(content)          // cinq au plus, comme l'envoi
  // Une reprise, ou un groupe au-delà des cinq que l'envoi développe, pèse 1
  weight += t.groups.length - distinct.length
  let team: boolean | null = null
  for (const key of distinct) {
    let size = 1
    try {
      if (communityId) {
        if (key === 'tous') team ??= await cached(cache, `team:${authorId}`, async () => (await isTeam(communityId, authorId)) ? 1 : 0) === 1
        if (key !== 'tous' || team) size = Math.max(1, Math.min(MAX_GROUP_RECIPIENTS, await cached(cache, `group:${key}`, async () => (await membersOf(communityId, key)).length)))
      }
    } catch { size = 1 }
    weight += size
  }
  return weight
}

async function cached(cache: Map<string, number> | undefined, key: string, read: () => Promise<number>): Promise<number> {
  const hit = cache?.get(key)
  if (hit !== undefined) return hit
  const v = await read()
  cache?.set(key, v)
  return v
}
