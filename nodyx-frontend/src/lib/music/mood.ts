// Palette d'ambiances de la vitrine musique (/musique). Chaque catégorie
// reçoit une identité (couleur, "côté" façon vinyle A/B/C...) dérivée de son
// titre quand un mot-clé correspond, sinon de sa position dans la liste.
// Déterministe : recharger la page ne change rien, ajouter une catégorie
// n'en dérange aucune autre.

export interface Mood {
  name:   string
  accent: string  // couleur pleine, texte/traits
  wash:   string  // même teinte, alpha bas, pour le fond du canevas
}

export const MOODS: Mood[] = [
  { name: 'ember',   accent: '#e0a34a', wash: 'rgba(224,163,74,'  },
  { name: 'glacial', accent: '#4bd0c9', wash: 'rgba(75,208,201,'  },
  { name: 'abyss',   accent: '#4d93c4', wash: 'rgba(77,147,196,'  },
  { name: 'arcane',  accent: '#a879e0', wash: 'rgba(168,121,224,' },
  { name: 'alarm',   accent: '#d9634a', wash: 'rgba(217,99,74,'   },
  { name: 'dusk',    accent: '#d97a94', wash: 'rgba(217,122,148,' },
  { name: 'deep',    accent: '#4aa87c', wash: 'rgba(74,168,124,'  },
  { name: 'void',    accent: '#b34ad9', wash: 'rgba(179,74,217,'  },
]

// mots-clés -> index dans MOODS. Comparaison sur un texte déjà normalisé
// (minuscule, sans accents) : "Ambiance Village" et "village" matchent pareil.
const KEYWORDS: [string[], number][] = [
  [['village', 'foret', 'ferme', 'campagne'], 0],
  [['labo', 'laboratoire', 'glace', 'gel', 'neige', 'gilvre', 'givre'], 1],
  [['mer', 'ocean', 'lac', 'riviere', 'rivage', 'plage', 'eau'], 2],
  [['enigme', 'mystere', 'puzzle', 'secret'], 3],
  [['poursuite', 'chase', 'fuite', 'danger', 'alerte', 'escalier'], 4],
  [['crepuscule', 'aube', 'coucher', 'sunset', 'seul'], 5],
  [['profondeur', 'grotte', 'ruine', 'ombre'], 6],
  [['kraken', 'abysse', 'monstre', 'boss', 'combat', 'fight', 'duel'], 7],
]

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function moodFor(title: string, index: number): Mood {
  const norm = normalize(title)
  for (const [words, moodIndex] of KEYWORDS) {
    if (words.some(w => norm.includes(w))) return MOODS[moodIndex]
  }
  return MOODS[index % MOODS.length]
}

// Lettre de "côté" façon vinyle multi-disque : A, B, C ... puis AA, AB ...
export function sideLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

// PRNG déterministe (mulberry32) à partir d'une chaîne : même seed, même
// disposition du canevas d'ambiance, pour que chaque catégorie garde
// toujours le même "visage" d'un chargement à l'autre.
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}
