// ─── Streamer Hub — Audio track fuzzy matcher ──────────────────────────────
// Trouve une piste dans la bibliothèque à partir d'un texte libre (ex: tapé
// par un viewer dans !nextsound). On vise la robustesse pour les cas réels
// du chat Twitch :
//   - Majuscules/minuscules ignorées
//   - Accents ignorés
//   - Match partiel (substring)
//   - Match au début d'un mot du titre (boost)
//   - Tokenisation : "ixion legacy" → ["ixion", "legacy"], tous les tokens
//     doivent matcher
//   - Tolérance fautes de frappe : Levenshtein ≤ 2 sur le premier mot du titre
//
// Retour : meilleur match unique OU liste d'ambiguïtés (top 3) si le score 1
// et 2 sont trop proches → le bot demande de préciser.

import type { AudioTrack } from './audioLibraryService'

// Normalize : lowercase, strip accents, espaces multiples → un seul, trim.
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')     // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')        // ponctuation → espace
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  const n = normalize(s)
  return n.length ? n.split(' ') : []
}

// Levenshtein simple (matrice). Borné par maxDist pour court-circuiter sur les
// mots très différents (gain perf marginal mais utile sur grosse biblio).
function levenshtein(a: string, b: string, maxDist = 3): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      curr.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > maxDist) return maxDist + 1
    prev = curr
  }
  return prev[b.length]
}

// Score d'un track contre la query. Plus c'est haut, mieux c'est. 0 = pas de
// match du tout. On combine plusieurs signaux pour être tolérant.
function scoreTrack(track: AudioTrack, queryNorm: string, queryTokens: string[]): number {
  const titleNorm  = normalize(track.title)
  const artistNorm = normalize(track.artist ?? '')
  const hay        = `${titleNorm} ${artistNorm}`.trim()
  if (!hay) return 0

  let score = 0

  // 1) Match exact du titre entier → score max.
  if (titleNorm === queryNorm) return 1000

  // 2) Substring du titre → fort. Bonus si en début.
  const idxTitle = titleNorm.indexOf(queryNorm)
  if (idxTitle === 0)       score += 600
  else if (idxTitle > 0)    score += 400

  // 3) Substring dans artiste (un viewer peut chercher par artiste).
  if (artistNorm && artistNorm.includes(queryNorm)) score += 200

  // 4) Tous les tokens de la query présents dans hay (haystack titre + artiste).
  if (queryTokens.length > 0) {
    let tokenHits = 0
    for (const tok of queryTokens) {
      if (!tok) continue
      if (hay.includes(tok)) tokenHits++
    }
    if (tokenHits === queryTokens.length) score += 150
    else if (tokenHits > 0)               score += 50 * tokenHits
  }

  // 5) Levenshtein sur le premier mot du titre. Tolère les fautes ("ixien"
  //    matchera "ixion" avec dist=1).
  const firstWord = titleNorm.split(' ')[0]
  if (firstWord && queryNorm) {
    const dist = levenshtein(firstWord, queryNorm, 2)
    if (dist === 0)       score += 50
    else if (dist === 1)  score += 30
    else if (dist === 2)  score += 10
  }

  return score
}

export interface FuzzyMatchHit {
  track:  AudioTrack
  score:  number
}

export interface FuzzyMatchResult {
  best:        AudioTrack | null         // null = aucun match raisonnable
  ambiguous:   AudioTrack[]              // si plusieurs candidats proches en score (best inclus)
  total:       number                    // nombre total de candidats avec score > 0
}

const MIN_USABLE_SCORE = 100              // en dessous, on considère "pas de match"
const AMBIGUITY_DELTA  = 100              // si score #1 - #2 < delta, ambigu

export function findTrackByQuery(query: string, tracks: AudioTrack[]): FuzzyMatchResult {
  const queryNorm   = normalize(query)
  const queryTokens = tokens(query)
  if (!queryNorm) return { best: null, ambiguous: [], total: 0 }

  const hits: FuzzyMatchHit[] = []
  for (const t of tracks) {
    const score = scoreTrack(t, queryNorm, queryTokens)
    if (score > 0) hits.push({ track: t, score })
  }
  hits.sort((a, b) => b.score - a.score)

  if (hits.length === 0)               return { best: null, ambiguous: [], total: 0 }
  if (hits[0].score < MIN_USABLE_SCORE) return { best: null, ambiguous: [], total: hits.length }

  // Ambiguïté si #2 est trop proche de #1 → on remonte les top 3 pour que le
  // bot propose à l'user de choisir.
  if (hits.length >= 2 && hits[0].score - hits[1].score < AMBIGUITY_DELTA) {
    return {
      best:      null,
      ambiguous: hits.slice(0, 3).map(h => h.track),
      total:     hits.length,
    }
  }
  return { best: hits[0].track, ambiguous: [], total: hits.length }
}
